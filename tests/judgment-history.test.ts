import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JUDGMENT_HISTORY_CONTRACT_VERSION,
  canonicalJson,
  createJudgmentHistoryReader,
  createLocalJudgmentHistoryFeedbackWriter,
  createLocalJudgmentHistorySource,
  type JudgmentHistoryRecord
} from '../src/judgment-history.js';
import { createJudgmentHistoryHttpHandler } from '../src/judgment-history-http.js';

const roots: string[] = [];
const servers: Server[] = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function adoption(sessionRef: string, turnId: string, resolutionId: string, options: Record<string, unknown> = {}): Record<string, unknown> {
  const request = {
    request: `request-${resolutionId}`,
    turn_id: turnId,
    conversation_context: {
      schema_version: 'brainbase-conversation-context-v1',
      session_ref: sessionRef,
      messages: [],
      prior_receipts: [],
      runtime: { host: 'test', model: null, permission_mode: null, project_binding: null },
      instruction_bindings: [],
      completeness: 'complete',
      source_digest: 'source'
    }
  };
  const receipt = {
    resolution_id: resolutionId,
    resolved_at: '2026-10-07T01:00:00.000Z',
    turn_id: turnId,
    status: 'resolved',
    ...(options.receipt ?? {})
  };
  return {
    schema_version: 'brainbase-judgment-adoption-v2',
    accepted_at: '2026-10-07T01:00:01.000Z',
    request_text_digest: digest(request.request),
    request,
    receipt,
    receipt_digest: digest(canonicalJson(receipt)),
    ...(options.public_judgment ? { public_judgment: options.public_judgment } : {}),
    ...(options.execution ? { execution: options.execution } : {}),
    owner_audit: { decision: `decision-${resolutionId}` }
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-history-'));
  roots.push(root);
  return root;
}

async function save(root: string, sessionRef: string, name: string, value: unknown): Promise<void> {
  const directory = join(root, sessionRef);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), `${JSON.stringify(value)}\n`);
}

function finalArtifact(sessionRef: string, turnId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  const withoutDigest = {
    schema_version: 'brainbase-judgment-final-v1',
    session_ref: sessionRef,
    turn_id: turnId,
    finalized_at: '2026-10-07T02:00:00.000Z',
    initial_receipt_digest: 'receipt-digest',
    event_count: 0,
    event_set_digest: digest(canonicalJson([])),
    answer_digest: 'answer-digest',
    completion_status: 'complete',
    ...fields
  };
  return { ...withoutDigest, final_digest: digest(canonicalJson(withoutDigest)) };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('judgment history common reader', () => {
  it('returns an unavailable state for a missing journal and confirmed empty for an empty one', async () => {
    const missing = await makeRoot();
    await rm(missing, { recursive: true, force: true });
    const missingHome = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root: missing })
    }).home();
    expect(missingHome.status).toBe('unavailable');
    expect(missingHome.records).toBeNull();
    expect(missingHome.coverage.complete).toBe(false);

    const empty = await makeRoot();
    const emptyHome = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root: empty })
    }).home();
    expect(emptyHome.status).toBe('available');
    expect(emptyHome.records).toEqual([]);
    expect(emptyHome.coverage).toMatchObject({ complete: true, total: 0 });
  });

  it('projects a valid adoption without exposing request text, and keeps missing collections null', async () => {
    const root = await makeRoot();
    const sessionRef = 'a'.repeat(64);
    await save(root, sessionRef, `${'b'.repeat(64)}.json`, adoption(sessionRef, 'turn-1', 'resolution-1', {
      receipt: { project_code: 'project-a', entrypoint: 'mana' },
      public_judgment: {
        summary: 'Use the approved path',
        reason: 'The current project scope requires it',
        selected_references: [{ ref: 'frame-1', kind: 'frame', version: 'v2', digest: 'd1', why: 'scope', usage: 'selection', availability: 'recorded' }],
        alternatives: [{ label: 'Other path', evaluation: 'not compatible', adopted: false }]
      },
      execution: { status: 'completed', result_summary: 'Saved', outcome_status: 'unconfirmed' }
    }));
    const home = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root })
    }).home();
    expect(home.contract_version).toBe(JUDGMENT_HISTORY_CONTRACT_VERSION);
    expect(home.records).toHaveLength(1);
    const record = home.records?.[0] as JudgmentHistoryRecord;
    expect(record.entrypoint).toBe('mana');
    expect(record.project_code).toBe('project-a');
    expect(record.judgment.selected_references?.[0]).toMatchObject({ ref: 'frame-1', version: 'v2' });
    expect(record.judgment.alternatives?.[0]).toMatchObject({ label: 'Other path', adopted: false });
    expect(record.execution).toMatchObject({ status: 'completed', outcome_status: 'unconfirmed' });
    expect(record.missing_fields).not.toContain('judgment.selected_references');
    expect(record.missing_fields).not.toContain('judgment.alternatives');
    expect(record).not.toHaveProperty('request');
    expect(record).not.toHaveProperty('owner_audit');
  });

  it('marks malformed candidate records partial and leaves unrecorded fields null', async () => {
    const root = await makeRoot();
    const sessionRef = 'c'.repeat(64);
    await save(root, sessionRef, `${'d'.repeat(64)}.json`, adoption(sessionRef, 'turn-1', 'resolution-2'));
    await save(root, sessionRef, `${'e'.repeat(64)}.json`, { malformed: true });
    const home = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root })
    }).home();
    expect(home.status).toBe('partial');
    expect(home.records).toHaveLength(1);
    const record = home.records?.[0] as JudgmentHistoryRecord;
    expect(record.judgment.selected_references).toBeNull();
    expect(record.judgment.alternatives).toBeNull();
    expect(record.execution.status).toBe('unknown');
    expect(record.missing_fields).toEqual(expect.arrayContaining([
      'entrypoint',
      'judgment.selected_references',
      'judgment.alternatives',
      'execution.status'
    ]));
    expect(home.coverage.total).toBeNull();
  });

  it('binds pagination to filters and enforces project authorization', async () => {
    const root = await makeRoot();
    const sessionRef = 'f'.repeat(64);
    for (const [index, project] of ['project-a', 'project-a', 'project-b'].entries()) {
      await save(root, sessionRef, `${String(index + 1).padStart(64, '0')}.json`, adoption(sessionRef, `turn-${index}`, `resolution-${index}`, {
        receipt: { project_code: project }
      }));
    }
    const reader = createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root }),
      authorizeProject: (project) => project === 'project-a'
    });
    const first = await reader.home({ project: 'project-a', limit: 1 });
    expect(first.records).toHaveLength(1);
    expect(first.coverage.total).toBe(2);
    expect(first.pagination.next_cursor).toBeTruthy();
    const second = await reader.home({ project: 'project-a', limit: 1, cursor: first.pagination.next_cursor! });
    expect(second.records).toHaveLength(1);
    await expect(reader.home({ project: 'project-b' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(reader.home({ project: 'project-a', cursor: first.pagination.next_cursor!, entrypoint: 'mana' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('projects a normal final without a value-proof sidecar and binds turn refs with a slash', async () => {
    const root = await makeRoot();
    const sessionRef = '1'.repeat(64);
    await save(root, sessionRef, 'turn-1.final.json', finalArtifact(sessionRef, 'turn-1', {
      project_code: 'project-final',
      entrypoint: 'codex',
      public_judgment: {
        status: 'resolved',
        summary: 'Final selection',
        reason: 'Recorded public reason',
        selected_references: [{ ref: 'frame-1', kind: 'frame', version: 'v1', digest: 'digest-1', why: 'scope', usage: 'selected', availability: 'recorded' }]
      }
    }));
    const home = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root })
    }).home();
    expect(home.status).toBe('available');
    expect(home.records).toHaveLength(1);
    expect(home.records?.[0]).toMatchObject({
      entrypoint: 'codex',
      project_code: 'project-final',
      turn_ref: expect.stringContaining('/'),
      judgment: { status: 'resolved', summary: 'Final selection' },
      execution: { status: 'completed', outcome_status: 'unknown' }
    });
  });

  it('rejects a symlink root and reports a capped scan as partial', async () => {
    const root = await makeRoot();
    const linkedTarget = await makeRoot();
    const linkedRoot = join(root, 'linked-journal');
    await symlink(linkedTarget, linkedRoot);
    const unavailable = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root: linkedRoot })
    }).home();
    expect(unavailable).toMatchObject({ status: 'unavailable', records: null, coverage: { reason: 'journal_symlink_rejected' } });

    const cappedRoot = await makeRoot();
    const sessionRef = '2'.repeat(64);
    for (const turn of ['turn-a', 'turn-b']) {
      await save(cappedRoot, sessionRef, `${turn}.final.json`, finalArtifact(sessionRef, turn));
    }
    const capped = await createJudgmentHistoryReader({
      source: createLocalJudgmentHistorySource({ root: cappedRoot, max_files: 1 })
    }).home();
    expect(capped.status).toBe('partial');
    expect(capped.coverage).toMatchObject({ complete: false, reason: 'journal_scan_capped', total: null });
  });

  it('appends normal feedback beside the journal, reads it back canonically, and is idempotent by event id', async () => {
    const root = await makeRoot();
    const sessionRef = '3'.repeat(64);
    const recordId = 'normal-feedback-1';
    const finalPath = join(root, sessionRef, 'turn-feedback.final.json');
    await save(root, sessionRef, 'turn-feedback.final.json', finalArtifact(sessionRef, 'turn-feedback', {
      record_id: recordId,
      project_code: 'project-feedback',
      public_judgment: { status: 'resolved', summary: 'Recorded selection', reason: 'Scope' }
    }));
    const reader = createJudgmentHistoryReader({ source: createLocalJudgmentHistorySource({ root }) });
    const writer = createLocalJudgmentHistoryFeedbackWriter({
      root,
      reader,
      now: () => new Date('2026-10-07T03:00:00.000Z')
    });
    const input = {
      record_id: recordId,
      event_id: 'event-feedback-1',
      kind: 'result' as const,
      content: { summary: '利用者の返信を確認した', outcome_status: 'confirmed' as const }
    };
    const before = await readFile(finalPath, 'utf8');
    const first = await writer(input);
    expect(first).toMatchObject({ created: true, status: 'saved', event: input });
    const detail = await reader.detail(recordId);
    expect(detail.record?.feedback_events).toEqual([input]);
    expect(await readFile(finalPath, 'utf8')).toBe(before);

    const repeated = await writer({ ...input });
    expect(repeated).toMatchObject({ created: false, status: 'already_saved', event: input });
    await expect(writer({ ...input, content: { summary: '別の結果' } })).rejects.toMatchObject({
      statusCode: 409,
      code: 'feedback_conflict'
    });
    await expect(writer({ ...input, owner_id: 'other-owner' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_feedback'
    });
  });

  it('serves feedback POST through the common HTTP route and returns the canonical detail on readback', async () => {
    const root = await makeRoot();
    const sessionRef = '4'.repeat(64);
    const recordId = 'normal-feedback-http-1';
    await save(root, sessionRef, 'turn-http.final.json', finalArtifact(sessionRef, 'turn-http', { record_id: recordId }));
    const reader = createJudgmentHistoryReader({ source: createLocalJudgmentHistorySource({ root }) });
    const writer = createLocalJudgmentHistoryFeedbackWriter({ root, reader });
    const server = createServer((request, response) => {
      void createJudgmentHistoryHttpHandler({
        reader,
        writeFeedback: writer,
        assertWriteAllowed: () => undefined
      })(request, response);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const input = {
      record_id: recordId,
      event_id: 'event-http-1',
      kind: 'feedback',
      content: { summary: '画面で保存済みを確認した' }
    };
    const created = await fetch(`${base}/api/judgment-history/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ status: 'saved', saved: true, feedback_event: input });
    const detail = await fetch(`${base}/api/judgment-history/records/${recordId}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).record.feedback_events).toEqual([input]);
    const repeated = await fetch(`${base}/api/judgment-history/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    expect(repeated.status).toBe(200);
    const conflict = await fetch(`${base}/api/judgment-history/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, content: { summary: '別内容' } })
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('feedback_conflict');
  });
});
