import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildJudgmentValueProofReviewHome,
  readJudgmentValueProofFeedback,
  readJudgmentValueProofJournal,
  recordJudgmentValueProofFeedback,
  type JudgmentValueProofFeedbackLayer,
  type JudgmentValueProofFeedbackStatus,
  type JudgmentValueProofReviewHome,
  type JudgmentValueProofReviewItem
} from './judgment-value-proof-review.js';

export const VALUE_PROOF_REVIEW_HTTP_VERSION = 'value-proof-review-http.v1' as const;
export const VALUE_PROOF_REVIEW_TOKEN_HEADER = 'x-brainbase-review-token';

const DEFAULT_BASE_PATH = '/api/value-proofs';
const MAX_BODY_BYTES = 16 * 1024;
const UI_FILES: Readonly<Record<string, { readonly file: string; readonly type: string }>> = Object.freeze({
  '/ui/value-proof-review.js': { file: 'value-proof-review.js', type: 'text/javascript; charset=utf-8' },
  '/ui/value-proof-review.css': { file: 'value-proof-review.css', type: 'text/css; charset=utf-8' }
});

export interface ValueProofReviewHttpOptions {
  /** Judgment journal root. Defaults to `~/.brainbase/personal-os/judgment-journal`. */
  readonly journalRoot?: string;
  /** Personal OS data directory that stores owner feedback. */
  readonly dataDir?: string;
  /** Required on mutating requests. */
  readonly token: string;
  readonly basePath?: string;
  readonly now?: () => Date;
}

export type ValueProofReviewHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://localhost');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: HttpError): void {
  writeJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
}

function tokenMatches(expected: string, received: string | string[] | undefined): boolean {
  if (typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'cross_origin_rejected', 'Origin is not allowed');
  }
  if (host !== request.headers.host) throw new HttpError(403, 'cross_origin_rejected', 'Origin is not allowed');
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(request.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function publicHome(home: JudgmentValueProofReviewHome): unknown {
  if (home.status === 'unavailable') return home;
  const strip = (items: Readonly<Record<string, readonly JudgmentValueProofReviewItem[]>>) =>
    Object.fromEntries(Object.entries(items).map(([section, list]) => [
      section,
      list.map(({ section: itemSection, proof, feedback_history }) => ({ section: itemSection, proof, feedback_history }))
    ]));
  return {
    status: home.status,
    root: home.root,
    coverage: home.coverage,
    sections: strip(home.sections),
    // Holds only decision IDs, counts and states; no local paths.
    delegation_map: home.delegation_map,
    rejected: home.rejected.map((entry) => ({ file: relative(home.root, entry.file), reason: entry.reason }))
  };
}

export function createValueProofReviewHttpHandler(options: ValueProofReviewHttpOptions): ValueProofReviewHttpHandler {
  if (typeof options.token !== 'string' || options.token.length < 16) {
    throw new TypeError('token must be at least 16 characters');
  }
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/u, '');
  const now = options.now ?? (() => new Date());

  async function readHome(): Promise<JudgmentValueProofReviewHome> {
    const journal = await readJudgmentValueProofJournal({ root: options.journalRoot });
    const feedback = journal.status === 'available'
      ? await readJudgmentValueProofFeedback({ dataDir: options.dataDir })
      : [];
    return buildJudgmentValueProofReviewHome(journal, feedback, { now: now() });
  }

  async function recordFeedback(request: IncomingMessage): Promise<{ statusCode: number; body: unknown }> {
    assertSameOrigin(request);
    if (!tokenMatches(options.token, request.headers[VALUE_PROOF_REVIEW_TOKEN_HEADER])) {
      throw new HttpError(403, 'review_token_required', 'A valid review token is required');
    }
    const body = await readJsonBody(request);
    const intentId = typeof body.intent_id === 'string' ? body.intent_id : '';
    const attemptId = typeof body.decision_attempt_id === 'string' ? body.decision_attempt_id : '';

    const journal = await readJudgmentValueProofJournal({ root: options.journalRoot });
    if (journal.status === 'unavailable') {
      throw new HttpError(503, 'judgment_journal_unavailable', journal.reason);
    }
    const known = journal.entries.some((entry) => entry.proof.intent_id === intentId
      && entry.proof.decision_attempt_id === attemptId);
    if (!known) throw new HttpError(404, 'value_proof_not_found', 'No saved value proof matches this decision');

    try {
      const result = await recordJudgmentValueProofFeedback({
        dataDir: options.dataDir,
        intent_id: intentId,
        decision_attempt_id: attemptId,
        status: body.status as JudgmentValueProofFeedbackStatus,
        summary: typeof body.summary === 'string' ? body.summary : null,
        target_layer: typeof body.target_layer === 'string' ? body.target_layer as JudgmentValueProofFeedbackLayer : null,
        now: now()
      });
      return { statusCode: result.created ? 201 : 200, body: result };
    } catch (error) {
      if (error instanceof TypeError) throw new HttpError(400, 'invalid_feedback', error.message);
      throw error;
    }
  }

  return async (request, response) => {
    const path = requestUrl(request).pathname;
    if (path !== `${basePath}/home` && path !== `${basePath}/feedback`) return false;
    try {
      if (path === `${basePath}/home`) {
        if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET');
        writeJson(response, 200, publicHome(await readHome()));
        return true;
      }
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
      const result = await recordFeedback(request);
      writeJson(response, result.statusCode, result.body);
    } catch (error) {
      if (error instanceof HttpError) writeError(response, error);
      else writeJson(response, 500, { error: { code: 'internal_error', message: 'Unexpected error' } });
    }
    return true;
  };
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/gu, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[character] ?? character));
}

function shellHtml(token: string, basePath: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="brainbase-review-token" content="${escapeAttribute(token)}">
<meta name="brainbase-review-base-path" content="${escapeAttribute(basePath)}">
<title>Brainbase 判断の見返し</title>
<link rel="stylesheet" href="/ui/value-proof-review.css">
</head>
<body>
<main id="brainbase-value-proof-review"></main>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

const BOOTSTRAP_JS = `import { createValueProofReviewUI } from '/ui/value-proof-review.js';
const meta = (name) => document.querySelector(\`meta[name="\${name}"]\`)?.getAttribute('content') ?? '';
createValueProofReviewUI({
  root: document.getElementById('brainbase-value-proof-review'),
  basePath: meta('brainbase-review-base-path'),
  token: meta('brainbase-review-token')
});
`;

export interface ValueProofReviewHostOptions extends Omit<ValueProofReviewHttpOptions, 'token'> {
  readonly token?: string;
  /** Directory containing the packaged `ui/` files. */
  readonly uiDir?: string;
}

/** Local single-owner host. The caller owns `listen()` and must bind to a loopback address. */
export function createValueProofReviewHost(options: ValueProofReviewHostOptions = {}): { readonly server: Server; readonly token: string } {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/u, '');
  const uiDir = options.uiDir ?? fileURLToPath(new URL('../ui/', import.meta.url));
  const handler = createValueProofReviewHttpHandler({ ...options, token, basePath });

  const server = createServer((request, response) => {
    void (async () => {
      if (await handler(request, response)) return;
      const path = requestUrl(request).pathname;
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET' } });
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.end(shellHtml(token, basePath));
        return;
      }
      if (path === '/app.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(BOOTSTRAP_JS);
        return;
      }
      const asset = UI_FILES[path];
      if (!asset) {
        writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } });
        return;
      }
      response.setHeader('Content-Type', asset.type);
      response.end(await readFile(join(uiDir, asset.file)));
    })().catch(() => {
      writeJson(response, 500, { error: { code: 'internal_error', message: 'Unexpected error' } });
    });
  });
  return { server, token };
}
