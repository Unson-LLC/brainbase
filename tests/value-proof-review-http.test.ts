import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
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
    expect(await shell.text()).toContain(`content="${TOKEN}"`);
    expect((await fetch(`${base}/ui/value-proof-review.js`)).status).toBe(200);
    expect((await fetch(`${base}/ui/value-proof-review.css`)).status).toBe(200);
    expect((await fetch(`${base}/ui/judgment-view.js`)).status).toBe(404);
    expect((await fetch(`${base}/../package.json`)).status).toBe(404);
  });

  it('reports a missing journal as unavailable rather than an empty home', async () => {
    const base = await start(join(directory, 'missing'));
    const body = await (await fetch(`${base}/api/value-proofs/home`)).json();
    expect(body).toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
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
