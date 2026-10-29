import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkerJudgmentReceipt,
  emitWorkerJudgment,
  resolveWorkerJudgmentTurnDir,
  WorkerJudgmentConflictError,
  WORKER_JUDGMENT_OUTBOX_SCHEMA,
  WORKER_JUDGMENT_RECEIPT_SCHEMA,
  WORKER_JUDGMENT_SKIP_SCHEMA,
  type WorkerJudgmentInput,
  type WorkerJudgmentTransport
} from '../src/worker-judgment-emitter.js';
import { JUDGMENT_HISTORY_ENTRYPOINTS } from '../src/judgment-history.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'worker-judgment-'));
  roots.push(root);
  return root;
}

const EFFECTIVE_AFTER = '2026-10-01T00:00:00.000Z';
const NOW = () => new Date('2026-10-20T00:00:00.000Z');

function input(overrides: Partial<WorkerJudgmentInput> = {}): WorkerJudgmentInput {
  return {
    entrypoint: 'claude_code',
    session_id: 'session-abc',
    turn_id: 'turn-123',
    resolved_at: '2026-10-19T12:00:00.000Z',
    project_code: 'brainbase',
    public_frame: { summary: '案Aを採用', reason: 'owner JWT 非依存で Worker に適合するため' },
    meta: { model: 'claude-opus-4-8', agent_member_id: 'agent-worker-1' },
    ...overrides
  };
}

function config() {
  return { effectiveAfter: EFFECTIVE_AFTER, now: NOW };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('shared entrypoint contract', () => {
  it('adds opencode to the shared history entrypoint enum (決定事項 3)', () => {
    expect(JUDGMENT_HISTORY_ENTRYPOINTS).toContain('opencode');
    expect(JUDGMENT_HISTORY_ENTRYPOINTS).toContain('claude_code');
  });
});

describe('buildWorkerJudgmentReceipt determinism (S1 受入)', () => {
  it('yields the same resolution_id and the same receipt for the same input', () => {
    const a = buildWorkerJudgmentReceipt(input(), config());
    const b = buildWorkerJudgmentReceipt(input(), config());
    expect(a.outcome).toBe('receipt');
    expect(b.outcome).toBe('receipt');
    if (a.outcome !== 'receipt' || b.outcome !== 'receipt') return;
    expect(a.receipt).toEqual(b.receipt);
    expect(a.receipt.resolution_id).toBe(b.receipt.resolution_id);
    expect(a.receipt.receipt_digest).toBe(b.receipt.receipt_digest);
  });

  it('derives resolution_id from entrypoint, session, turn, and content_digest', () => {
    const built = buildWorkerJudgmentReceipt(input(), config());
    if (built.outcome !== 'receipt') throw new Error('expected a receipt');
    const canonical = JSON.stringify({
      content_digest: built.receipt.content_digest,
      entrypoint: 'claude_code',
      session_id: 'session-abc',
      turn_id: 'turn-123'
    });
    expect(built.receipt.resolution_id).toBe(sha256Hex(canonical));
    expect(built.receipt.content_digest.startsWith('sha256:')).toBe(true);
    expect(built.receipt.turn_ref).toBe(`${sha256Hex('session-abc')}/${sha256Hex('turn-123')}`);
  });

  it('changes resolution_id when the judgment body changes', () => {
    const base = buildWorkerJudgmentReceipt(input(), config());
    const changed = buildWorkerJudgmentReceipt(
      input({ public_frame: { summary: '別の判断', reason: '別の理由' } }),
      config()
    );
    if (base.outcome !== 'receipt' || changed.outcome !== 'receipt') throw new Error('expected receipts');
    expect(changed.receipt.resolution_id).not.toBe(base.receipt.resolution_id);
  });

  it('passes for the opencode entrypoint', () => {
    const built = buildWorkerJudgmentReceipt(input({ entrypoint: 'opencode' }), config());
    expect(built.outcome).toBe('receipt');
    if (built.outcome !== 'receipt') return;
    expect(built.receipt.entrypoint).toBe('opencode');
  });
});

describe('public_frame rejection (拒否のみ・書き換えない)', () => {
  it('skips when the public_frame is absent', () => {
    const built = buildWorkerJudgmentReceipt(input({ public_frame: undefined }), config());
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_public_frame_absent' });
  });

  it('skips when the public_frame is empty', () => {
    const built = buildWorkerJudgmentReceipt(input({ public_frame: {} }), config());
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_public_frame_absent' });
  });

  it('rejects a credential-like value without rewriting it', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ public_frame: { summary: 'ok', reason: 'Bearer abcdefgh12345678abcd' } }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'frame_public_invalid' });
  });

  it('rejects control characters', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ public_frame: { summary: 'ok', reason: 'linebell' } }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'frame_public_invalid' });
  });

  it('rejects an unknown field', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ public_frame: { summary: 'ok', reason: 'ok', extra: 'x' } }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'frame_public_invalid' });
  });

  it('rejects an over-length field', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ public_frame: { summary: 'ok', reason: 'a'.repeat(2001) } }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'frame_public_invalid' });
  });

  it('rejects a credential-like value in meta', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ meta: { model: 'Bearer abcdefgh12345678abcd' } }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_meta_invalid' });
  });
});

describe('project_code screening (meta と同じ拒否)', () => {
  it('skips when project_code carries a credential-like value', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ project_code: 'password=hunter2hunter2hunter2' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_project_code_invalid' });
  });

  it('skips when project_code carries control characters', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ project_code: 'brainsettinglinebell' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_project_code_invalid' });
  });

  it('skips when project_code is over length', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ project_code: 'a'.repeat(201) }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_project_code_invalid' });
  });

  it('treats an absent or blank project_code as not recorded', () => {
    for (const value of [undefined, null, '   '] as const) {
      const built = buildWorkerJudgmentReceipt(input({ project_code: value as string | null }), config());
      if (built.outcome !== 'receipt') throw new Error('expected a receipt');
      expect(built.receipt.project_code).toBeNull();
    }
  });

  it('never stores the rejected project_code value in the skip marker', async () => {
    const root = await freshRoot();
    const result = await emitWorkerJudgment(
      input({ project_code: 'password=hunter2hunter2hunter2' }),
      { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW }
    );
    expect(result.outcome).toBe('skipped');
    if (result.outcome !== 'skipped') return;
    expect(result.reason_code).toBe('worker_project_code_invalid');
    const raw = await readFile(result.path, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('password=');
  });
});

describe('resolved_at timezone and calendar validity', () => {
  it('rejects a zone-less resolved_at so the host timezone cannot shift the boundary', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2026-10-19T12:00:00' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_invalid' });
  });

  it('rejects a rolled-over calendar date rather than carrying it forward', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2026-02-30T00:00:00.000Z' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_invalid' });
  });

  it('applies the boundary on the real instant, not the wall clock, across offsets', () => {
    // 08:59:59+09:00 is 2026-09-30T23:59:59Z — one second before the boundary.
    const before = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2026-10-01T08:59:59+09:00' }),
      config()
    );
    expect(before).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_before_boundary' });
    // 09:00:00+09:00 is exactly the boundary instant — accepted and normalized to UTC.
    const atBoundary = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2026-10-01T09:00:00.000+09:00' }),
      config()
    );
    if (atBoundary.outcome !== 'receipt') throw new Error('expected a receipt');
    expect(atBoundary.receipt.resolved_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('yields the same receipt_digest for the same instant written with different offsets', () => {
    const utc = buildWorkerJudgmentReceipt(input({ resolved_at: '2026-10-19T12:00:00.000Z' }), config());
    const offset = buildWorkerJudgmentReceipt(input({ resolved_at: '2026-10-19T21:00:00.000+09:00' }), config());
    if (utc.outcome !== 'receipt' || offset.outcome !== 'receipt') throw new Error('expected receipts');
    expect(offset.receipt.resolved_at).toBe(utc.receipt.resolved_at);
    expect(offset.receipt.receipt_digest).toBe(utc.receipt.receipt_digest);
  });
});

describe('resolved_at boundary (§8)', () => {
  it('skips when resolved_at is before effective_after', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2026-09-30T23:59:59.000Z' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_before_boundary' });
  });

  it('skips when resolved_at is missing', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: '' as unknown as string }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_missing' });
  });

  it('skips when resolved_at is not a valid ISO time', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: 'not-a-time' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_invalid' });
  });

  it('skips when resolved_at is far in the future', () => {
    const built = buildWorkerJudgmentReceipt(
      input({ resolved_at: '2027-01-01T00:00:00.000Z' }),
      config()
    );
    expect(built).toMatchObject({ outcome: 'skipped', reason_code: 'worker_resolved_at_invalid' });
  });
});

describe('local outbox write (organization なしで動く)', () => {
  it('writes a pending receipt locally with no transport', async () => {
    const root = await freshRoot();
    const result = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW });
    expect(result.outcome).toBe('emitted');
    if (result.outcome !== 'emitted') return;
    expect(result.status).toBe('pending');
    expect(result.deduped).toBe(false);

    const dir = resolveWorkerJudgmentTurnDir(root, 'session-abc', 'turn-123');
    expect(result.path).toBe(join(dir, `${result.receipt.resolution_id}.json`));
    // The path uses hashed session/turn; neither raw id appears.
    expect(result.path).not.toContain('session-abc');
    expect(result.path).not.toContain('turn-123');

    const stored = JSON.parse(await readFile(result.path, 'utf8'));
    expect(stored.schema_version).toBe(WORKER_JUDGMENT_OUTBOX_SCHEMA);
    expect(stored.delivery.status).toBe('pending');
    expect(stored.receipt.schema_version).toBe(WORKER_JUDGMENT_RECEIPT_SCHEMA);
    expect(stored.receipt.resolution_id).toBe(result.receipt.resolution_id);

    const fileStat = await stat(result.path);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it('is idempotent when the same turn is re-emitted', async () => {
    const root = await freshRoot();
    const first = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW });
    const second = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW });
    expect(first.outcome).toBe('emitted');
    expect(second.outcome).toBe('emitted');
    if (second.outcome !== 'emitted') return;
    expect(second.deduped).toBe(true);
  });

  it('fails loudly when the same resolution id carries a different receipt', async () => {
    const root = await freshRoot();
    await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW });
    // Same session/turn/entrypoint/body ⇒ same resolution_id, but a different
    // project_code makes a different receipt_digest. That must conflict.
    await expect(
      emitWorkerJudgment(input({ project_code: 'other-project' }), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW })
    ).rejects.toBeInstanceOf(WorkerJudgmentConflictError);
  });

  it('leaves only a reason code when a turn is skipped, never the judgment body', async () => {
    const root = await freshRoot();
    const result = await emitWorkerJudgment(
      input({ public_frame: { summary: 'leak me', reason: 'Bearer abcdefgh12345678abcd' } }),
      { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW }
    );
    expect(result.outcome).toBe('skipped');
    if (result.outcome !== 'skipped') return;
    expect(result.reason_code).toBe('frame_public_invalid');
    const raw = await readFile(result.path, 'utf8');
    const stored = JSON.parse(raw);
    expect(stored.schema_version).toBe(WORKER_JUDGMENT_SKIP_SCHEMA);
    expect(stored.reason_code).toBe('frame_public_invalid');
    // The offending body is never persisted.
    expect(raw).not.toContain('leak me');
    expect(raw).not.toContain('Bearer');
    expect(stored.public_frame).toBeUndefined();
  });
});

describe('injected transport (OSS 既定は注入なし)', () => {
  it('records a saved status when the transport confirms', async () => {
    const root = await freshRoot();
    const transport: WorkerJudgmentTransport = { send: () => ({ status: 'saved' }) };
    const result = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport });
    expect(result.outcome).toBe('emitted');
    if (result.outcome !== 'emitted') return;
    expect(result.status).toBe('saved');
    const stored = JSON.parse(await readFile(result.path, 'utf8'));
    expect(stored.delivery.status).toBe('saved');
  });

  it('records blocked_credential with its reason code', async () => {
    const root = await freshRoot();
    const transport: WorkerJudgmentTransport = {
      send: () => ({ status: 'blocked_credential', reason_code: 'agent_credential_expired' })
    };
    const result = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport });
    expect(result.outcome).toBe('emitted');
    if (result.outcome !== 'emitted') return;
    expect(result.status).toBe('blocked_credential');
    expect(result.last_error_code).toBe('agent_credential_expired');
  });

  it('keeps the receipt and reports failed when the transport throws', async () => {
    const root = await freshRoot();
    const transport: WorkerJudgmentTransport = {
      send: () => { throw new Error('boom'); }
    };
    const result = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport });
    expect(result.outcome).toBe('emitted');
    if (result.outcome !== 'emitted') return;
    expect(result.status).toBe('failed');
    const stored = JSON.parse(await readFile(result.path, 'utf8'));
    expect(stored.receipt.resolution_id).toBe(result.receipt.resolution_id);
  });
});

describe('re-emit never undoes delivery progress (§6/§7)', () => {
  it('keeps a saved receipt saved when a later re-emit would fail', async () => {
    const root = await freshRoot();
    const saving: WorkerJudgmentTransport = { send: () => ({ status: 'saved' }) };
    const first = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport: saving });
    expect(first.outcome).toBe('emitted');
    if (first.outcome !== 'emitted') return;
    expect(first.status).toBe('saved');

    let called = false;
    const failing: WorkerJudgmentTransport = { send: () => { called = true; throw new Error('boom'); } };
    const second = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport: failing });
    expect(second.outcome).toBe('emitted');
    if (second.outcome !== 'emitted') return;
    // The stored success is kept, the failing transport is never consulted, and
    // the on-disk record is not downgraded to failed.
    expect(second.status).toBe('saved');
    expect(second.deduped).toBe(true);
    expect(called).toBe(false);
    const stored = JSON.parse(await readFile(second.path, 'utf8'));
    expect(stored.delivery.status).toBe('saved');
  });

  it('returns the stored status on a no-transport re-run instead of a fresh pending', async () => {
    const root = await freshRoot();
    const saving: WorkerJudgmentTransport = { send: () => ({ status: 'saved' }) };
    await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW, transport: saving });

    const reRun = await emitWorkerJudgment(input(), { journalRoot: root, effectiveAfter: EFFECTIVE_AFTER, now: NOW });
    expect(reRun.outcome).toBe('emitted');
    if (reRun.outcome !== 'emitted') return;
    expect(reRun.status).toBe('saved');
    expect(reRun.deduped).toBe(true);
    const stored = JSON.parse(await readFile(reRun.path, 'utf8'));
    expect(stored.delivery.status).toBe('saved');
  });
});
