import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JudgmentValueProof } from '../src/judgment-value-proof.js';
import { createValueProofReviewHost, VALUE_PROOF_REVIEW_TOKEN_HEADER } from '../src/value-proof-review-http.js';

const TOKEN = 'test-review-token-0123456789';

function proof(): JudgmentValueProof {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: 'intent-1',
    decision_attempt_id: 'attempt-1',
    recorded_at: '2026-09-20T00:00:00.000Z',
    state: 'unconfirmed',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '稼働中の設定へ反映してよいですか？',
      question_digest: 'sha256:question',
      reason_code: 'routine_reversible_work',
      human_reason: null
    },
    decision: {
      summary: '安全上必要な停止は維持したまま反映する',
      work_impact: '確認で止めず反映まで進めた',
      basis: [],
      prior_learning_reused: 'unconfirmed'
    },
    execution: { status: 'completed', summary: '設定を反映した', artifact_refs: [] },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null }
  };
}

let directory: string;
let journal: string;
let dataDir: string;
let proofFile: string;
let server: Server | null = null;

async function start(journalRoot = journal): Promise<string> {
  const host = createValueProofReviewHost({ journalRoot, dataDir, token: TOKEN });
  server = host.server;
  await new Promise<void>((resolve) => host.server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`;
}

function postFeedback(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/value-proofs/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [VALUE_PROOF_REVIEW_TOKEN_HEADER]: TOKEN, ...headers },
    body: JSON.stringify(body)
  });
}

// fetch() cannot override Host, so a rebound DNS name is simulated with a raw request.
function rawRequest(
  base: string,
  path: string,
  options: { host: string | null; method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: options.method ?? 'GET',
      setHost: options.host !== null,
      headers: { ...(options.host === null ? {} : { Host: options.host }), ...options.headers }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-value-proof-http-'));
  journal = join(directory, 'journal');
  dataDir = join(directory, 'personal-os');
  await mkdir(join(journal, 'session'), { recursive: true });
  proofFile = join(journal, 'session', 'turn.value-proof.json');
  await writeFile(proofFile, JSON.stringify(proof()), 'utf8');
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(directory, { recursive: true, force: true });
});

describe('value proof review host', () => {
  it('serves the shell with the review token, a strict CSP and only the packaged UI files', async () => {
    const base = await start();
    const shell = await fetch(`${base}/`);
    expect(shell.headers.get('content-security-policy')).toContain("script-src 'self'");
    const html = await shell.text();
    expect(html).toContain(`content="${TOKEN}"`);
    // The part is drawn with the shared screen pattern, which reads the shared tokens.
    expect(html.indexOf('/ui/brainbase-tokens.css')).toBeGreaterThan(-1);
    expect(html.indexOf('/ui/brainbase-tokens.css')).toBeLessThan(html.indexOf('/ui/workspace-kit.css'));
    expect(html.indexOf('/ui/workspace-kit.css')).toBeLessThan(html.indexOf('/ui/value-proof-review.css'));
    const part = await fetch(`${base}/ui/value-proof-review.js`);
    expect(part.status).toBe(200);
    expect((await fetch(`${base}/ui/value-proof-review.css`)).status).toBe(200);
    // Every module the part imports must be served, or the page cannot start.
    const imports = [...(await part.text()).matchAll(/from '\.\/([^']+)'/gu)].map((match) => match[1]);
    expect(imports).toContain('workspace-kit.js');
    for (const file of imports) expect((await fetch(`${base}/ui/${file}`)).status, file).toBe(200);
    expect((await fetch(`${base}/ui/workspace-kit.css`)).status).toBe(200);
    expect((await fetch(`${base}/ui/judgment-view.js`)).status).toBe(404);
    expect((await fetch(`${base}/../package.json`)).status).toBe(404);
  });

  it('reports a missing journal as unavailable rather than an empty home', async () => {
    const base = await start(join(directory, 'missing'));
    const body = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(body).toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
  });

  it('shows proofs saved after an earlier read of the home, and a journal removed later as unavailable', async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(join(journal, 'session'), hourAgo, hourAgo);
    const base = await start();
    expect((await (await fetch(`${base}/api/value-proofs/home`)).json()).coverage.saved).toBe(1);

    await writeFile(join(journal, 'session', 'turn-next.value-proof.json'),
      JSON.stringify({ ...proof(), intent_id: 'intent-3', decision_attempt_id: 'attempt-3' }), 'utf8');
    await mkdir(join(journal, 'session-later'));
    await writeFile(join(journal, 'session-later', 'turn.value-proof.json'),
      JSON.stringify({ ...proof(), intent_id: 'intent-4', decision_attempt_id: 'attempt-4' }), 'utf8');
    expect((await (await fetch(`${base}/api/value-proofs/home`)).json()).coverage.saved).toBe(3);

    await rm(journal, { recursive: true });
    expect(await (await fetch(`${base}/api/value-proofs/home`)).json())
      .toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
  });

  it('returns the classified home without local file paths for each item', async () => {
    const base = await start();
    const body = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(body.status).toBe('available');
    expect(body.coverage.saved).toBe(1);
    expect(body.sections.continued).toHaveLength(1);
    expect(body.sections.continued[0]).not.toHaveProperty('file');
    expect(body.delegation_map.rows).toHaveLength(1);
    expect(body.delegation_map.rows[0].items).toEqual([expect.objectContaining({
      intent_id: body.sections.continued[0].proof.intent_id,
      decision_attempt_id: body.sections.continued[0].proof.decision_attempt_id,
    })]);
    expect(JSON.stringify(body.delegation_map)).not.toContain(directory);
  });

  it('rejects feedback without the token, from another origin, or for an unknown decision', async () => {
    const base = await start();
    const valid = { intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'accepted' };
    expect((await postFeedback(base, valid, { [VALUE_PROOF_REVIEW_TOKEN_HEADER]: 'wrong-token-0123456789' })).status).toBe(403);
    expect((await postFeedback(base, valid, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await postFeedback(base, { ...valid, decision_attempt_id: 'attempt-x' })).status).toBe(404);
    expect((await postFeedback(base, { ...valid, status: 'corrected' })).status).toBe(400);
  });

  it('refuses a rebound DNS name so another site cannot read the token, the home or write feedback', async () => {
    const base = await start();
    const rebound = `evil.example:${new URL(base).port}`;

    const shell = await rawRequest(base, '/', { host: rebound });
    expect(shell.status).toBe(403);
    expect(shell.body).not.toContain(TOKEN);
    expect((await rawRequest(base, '/api/value-proofs/home', { host: rebound })).status).toBe(403);

    const feedback = await rawRequest(base, '/api/value-proofs/feedback', {
      host: rebound,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `http://${rebound}`, [VALUE_PROOF_REVIEW_TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'accepted' })
    });
    expect(feedback.status).toBe(403);
    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(home.sections.continued[0].proof.feedback.status).toBe('none');

    expect((await rawRequest(base, '/', { host: '127.0.0.1:1' })).status).toBe(403);
    const missing = await rawRequest(base, '/', { host: null });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.body).not.toContain(TOKEN);
  });

  it('accepts the loopback names a browser sends for this port', async () => {
    const base = await start();
    const port = new URL(base).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
      expect((await rawRequest(base, '/', { host })).status).toBe(200);
    }
  });

  it('records feedback once, reflects it on reload and leaves the journal untouched', async () => {
    const base = await start();
    const before = await readFile(proofFile, 'utf8');
    const body = { intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'next_time_ask', summary: '本番設定は次回は聞く' };

    const created = await postFeedback(base, body);
    expect(created.status).toBe(201);
    const repeated = await postFeedback(base, body);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).created).toBe(false);

    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(home.sections.continued[0].proof.feedback).toMatchObject({ status: 'next_time_ask', summary: '本番設定は次回は聞く' });
    expect(await readFile(proofFile, 'utf8')).toBe(before);
  });
});

function waitingProof(): JudgmentValueProof {
  return {
    ...proof(),
    intent_id: 'intent-2',
    decision_attempt_id: 'attempt-2',
    state: 'waiting_human',
    interruption: {
      resolution: 'human_required',
      question_display_text: '本番へデプロイしてよいですか？',
      question_digest: 'sha256:deploy',
      reason_code: 'irreversible_action',
      human_reason: '本番への外部作用になるため'
    },
    execution: { status: 'not_started', summary: null, artifact_refs: [] },
    outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
    human_decision: {
      question: '本番へデプロイしてよいですか？',
      why_human: '本番への外部作用になるため',
      options: [
        { id: 'deploy', label: '本番へ反映する', impact: '利用者に即時反映される' },
        { id: 'keep_local', label: '反映を保留する', impact: '変更はローカルに残る' }
      ]
    }
  };
}

function postAnswer(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/api/value-proofs/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [VALUE_PROOF_REVIEW_TOKEN_HEADER]: TOKEN, ...headers },
    body: JSON.stringify(body)
  });
}

describe('answering a judgment returned to the owner', () => {
  let waitingFile: string;
  beforeEach(async () => {
    waitingFile = join(journal, 'session', 'turn-waiting.value-proof.json');
    await writeFile(waitingFile, JSON.stringify(waitingProof()), 'utf8');
  });

  const answer = { intent_id: 'intent-2', decision_attempt_id: 'attempt-2', kind: 'select', selected_option_id: 'deploy', confirmed: true };

  it('records the confirmed answer once, shows it on the home and leaves the judgment record untouched', async () => {
    const base = await start();
    const before = await readFile(waitingFile, 'utf8');

    const created = await postAnswer(base, answer);
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.record).toMatchObject({ kind: 'select', selected_option_id: 'deploy', resume: 'not_started' });

    const repeated = await postAnswer(base, answer);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).created).toBe(false);

    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(home.capabilities).toEqual({ answer: 'record_only' });
    const waiting = home.sections.needs_human.find((item: { proof: JudgmentValueProof }) => item.proof.decision_attempt_id === 'attempt-2');
    expect(waiting.answer).toEqual(createdBody.record);
    expect(home.sections.continued[0].answer).toBeNull();
    expect(await readFile(waitingFile, 'utf8')).toBe(before);
  });

  it('refuses a different answer to an answered judgment and returns the recorded one', async () => {
    const base = await start();
    const first = await (await postAnswer(base, answer)).json();
    const conflict = await postAnswer(base, { ...answer, selected_option_id: 'keep_local' });
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.error.code).toBe('answer_conflict');
    expect(body.existing).toEqual(first.record);
  });

  it('rejects answers without the token, from another origin, unconfirmed, for unknown or not-returned judgments', async () => {
    const base = await start();
    expect((await postAnswer(base, answer, { [VALUE_PROOF_REVIEW_TOKEN_HEADER]: 'wrong-token-0123456789' })).status).toBe(403);
    expect((await postAnswer(base, answer, { Origin: 'http://evil.example' })).status).toBe(403);
    expect((await postAnswer(base, { ...answer, confirmed: false })).status).toBe(400);
    expect((await postAnswer(base, { ...answer, selected_option_id: 'other' })).status).toBe(400);
    expect((await postAnswer(base, { ...answer, decision_attempt_id: 'attempt-x' })).status).toBe(404);
    const notReturned = await postAnswer(base, { intent_id: 'intent-1', decision_attempt_id: 'attempt-1', kind: 'reject', confirmed: true });
    expect(notReturned.status).toBe(422);
    expect((await notReturned.json()).error.code).toBe('not_answerable');
    expect((await fetch(`${base}/api/value-proofs/answers`)).status).toBe(405);

    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(home.sections.needs_human[0].answer).toBeNull();
    expect(home.sections.needs_human[0].conversation_moved_on_at).toBeNull();
  });

  it('refuses answers to a judgment whose conversation moved on after the question, and shows when it moved on', async () => {
    await writeFile(
      join(journal, 'session', 'turn-later.final.json'),
      JSON.stringify({ schema_version: 'brainbase-judgment-episode-final-v2', finalized_at: '2026-09-20T01:00:00.000Z' }),
      'utf8'
    );
    const base = await start();

    const home = await (await fetch(`${base}/api/value-proofs/home`)).json();
    const waiting = home.sections.needs_human.find((item: { proof: JudgmentValueProof }) => item.proof.decision_attempt_id === 'attempt-2');
    expect(waiting.conversation_moved_on_at).toBe('2026-09-20T01:00:00.000Z');

    const refused = await postAnswer(base, answer);
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.code).toBe('conversation_moved_on');
  });
});
