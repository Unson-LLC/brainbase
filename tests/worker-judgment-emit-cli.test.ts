import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runWorkerJudgmentEmitCli } from '../src/worker-judgment-emit-cli.js';
import { resolveWorkerJudgmentTurnDir } from '../src/worker-judgment-emitter.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worker-judgment-cli-'));
  roots.push(root);
  return root;
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
      stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

const ENV = {
  BRAINBASE_WORKER_JUDGMENT_EFFECTIVE_AFTER: '2026-10-01T00:00:00.000Z'
};

describe('worker judgment emit CLI', () => {
  it('never echoes a credential carried by an invalid JSON turn descriptor', async () => {
    const out = capture();
    // The input is not valid JSON but still contains a secret-looking fragment.
    const raw = '{ "input": { "public_frame": { "reason": "Bearer abcdefgh12345678abcd" } '; // truncated on purpose
    const code = await runWorkerJudgmentEmitCli(raw, out.io, ENV);

    expect(code).toBe(2);
    expect(out.stdout()).toBe('');
    // Only the fixed, input-free reason is reported.
    const report = JSON.parse(out.stderr());
    expect(report.error).toBe('worker_judgment_cli_input_invalid');
    expect(out.stderr()).not.toContain('Bearer');
    expect(out.stderr()).not.toContain('abcdefgh12345678abcd');
  });

  it('reports missing config without echoing input and writes nothing', async () => {
    const out = capture();
    const raw = JSON.stringify({ input: { entrypoint: 'claude_code' } });
    const code = await runWorkerJudgmentEmitCli(raw, out.io, {});
    expect(code).toBe(2);
    const report = JSON.parse(out.stderr());
    expect(report.error).toBe('worker_judgment_cli_config_missing');
  });

  it('emits a valid turn through the common port and prints only safe fields', async () => {
    const root = await freshRoot();
    const out = capture();
    const raw = JSON.stringify({
      input: {
        entrypoint: 'opencode',
        session_id: 'session-abc',
        turn_id: 'turn-123',
        resolved_at: '2026-10-19T12:00:00.000Z',
        project_code: 'brainbase',
        public_frame: { summary: '案Aを採用', reason: 'owner JWT 非依存で Worker に適合するため' },
        meta: { model: 'deepseek/deepseek-flash', agent_member_id: 'agent-worker-1' }
      },
      journalRoot: root
    });
    const code = await runWorkerJudgmentEmitCli(raw, out.io, ENV);
    expect(code).toBe(0);

    const summary = JSON.parse(out.stdout());
    expect(summary.outcome).toBe('emitted');
    expect(summary.status).toBe('pending');
    // The judgment body never reaches stdout; only hashed identifiers and status do.
    expect(out.stdout()).not.toContain('案Aを採用');
    expect(out.stdout()).not.toContain('owner JWT');
    expect(summary.resolution_id).toMatch(/^[a-f0-9]{64}$/);
    // The absolute outbox path (which embeds journalRoot) is never printed.
    expect(summary.path).toBeUndefined();
    expect(out.stdout()).not.toContain(root);

    const dir = resolveWorkerJudgmentTurnDir(root, 'session-abc', 'turn-123');
    const stored = JSON.parse(await readFile(join(dir, `${summary.resolution_id}.json`), 'utf8'));
    expect(stored.receipt.resolution_id).toBe(summary.resolution_id);
  });

  it('reports a corrupt outbox with a fixed code and never prints the outbox path', async () => {
    const root = await freshRoot();
    const payload = JSON.stringify({
      input: {
        entrypoint: 'claude_code',
        session_id: 'session-abc',
        turn_id: 'turn-123',
        resolved_at: '2026-10-19T12:00:00.000Z',
        project_code: 'brainbase',
        public_frame: { summary: 'ok', reason: 'ok' },
        meta: { model: 'm' }
      },
      journalRoot: root
    });

    const first = capture();
    expect(await runWorkerJudgmentEmitCli(payload, first.io, ENV)).toBe(0);
    const summary = JSON.parse(first.stdout());
    const dir = resolveWorkerJudgmentTurnDir(root, 'session-abc', 'turn-123');
    const path = join(dir, `${summary.resolution_id}.json`);
    // Tamper the stored body so the recomputed digest no longer matches.
    const stored = JSON.parse(await readFile(path, 'utf8'));
    stored.receipt.project_code = 'tampered';
    await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`);

    const out = capture();
    const code = await runWorkerJudgmentEmitCli(payload, out.io, ENV);
    expect(code).toBe(1);
    const report = JSON.parse(out.stderr());
    expect(report.error).toBe('worker_judgment_outbox_corrupt');
    // The absolute path (which embeds journalRoot) must never leak into the report.
    expect(out.stderr()).not.toContain(root);
    expect(out.stderr()).not.toContain(path);
    expect(out.stdout()).toBe('');
  });
});
