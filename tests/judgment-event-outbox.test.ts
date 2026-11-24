import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION,
  JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION,
  JUDGMENT_EVENT_READBACK_SCHEMA_VERSION,
  enqueueJudgmentKnowledgeEvent,
  deliverJudgmentKnowledgeEventOutbox,
  isValidJudgmentOutboxCandidateIdPair,
  listKnowledgeEventDeadLetters,
  resolveJudgmentKnowledgeEventOutboxPaths,
  withJudgmentOutboxSenderLock,
  type JudgmentOutboxPaths,
  type JudgmentOutboxReadback
} from '../src/judgment-event-outbox.js';
import type { JudgmentKnowledgeEvent } from '../src/judgment-event-adapter.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(eventId = 'event-1', projectCode = 'brainbase'): JudgmentKnowledgeEvent {
  return {
    schema_version: 'knowledge_event.v1',
    contract_version: 'knowledge_event.v1',
    event_id: eventId,
    occurred_at: '2026-10-18T00:00:00.000Z',
    captured_at: '2026-10-18T00:00:00.000Z',
    source: { type: 'codex_judgment', ref: 'session-1:turn-1' },
    subject: { type: 'judgment_episode', id: 'episode-1' },
    decision_authority: {
      kind: 'judgment_receipt',
      authorized: false,
      graph_promotion_allowed: false
    },
    applicability_scope: { scope: 'judgment_episode', project_code: projectCode },
    permission_snapshot: { knowledge_registration: true, external_action: false },
    source_pointer: { uri: 'codex://threads/session-1#turn=turn-1' },
    body_hash: 'body-hash-1',
    parent_episode_id: 'episode-1',
    payload: { summary: 'A portable judgment event.' }
  };
}

function pathsFor(root: string): JudgmentOutboxPaths {
  return resolveJudgmentKnowledgeEventOutboxPaths({ root });
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await stat(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`file did not appear: ${path}`);
}

function runEnqueueWorker(directory: string, candidate: JudgmentKnowledgeEvent): Promise<{
  status: string;
  path: string;
}> {
  const worker = fileURLToPath(new URL('./fixtures/judgment-outbox-enqueue-worker.mjs', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, directory, JSON.stringify(candidate)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`enqueue worker failed (${code}): ${stderr}`));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

function readback(
  eventId: string,
  candidateId: string | null,
  extra: Partial<JudgmentOutboxReadback> = {}
): JudgmentOutboxReadback {
  return {
    schema_version: JUDGMENT_EVENT_READBACK_SCHEMA_VERSION,
    event_id: eventId,
    candidate_id: candidateId,
    processing_stage: 'retrievable' as const,
    semantic_state: 'active' as const,
    readback_at: '2026-10-18T00:00:01.000Z',
    ...extra
  };
}

function eventWithSubject(
  eventId: string,
  subjectType: string,
  projectCode = 'brainbase'
): JudgmentKnowledgeEvent {
  return {
    ...event(eventId, projectCode),
    subject: { type: subjectType, id: `${subjectType}-1` }
  } as unknown as JudgmentKnowledgeEvent;
}

describe('portable judgment knowledge event outbox', () => {
  it('injects shared var paths and makes enqueue idempotent with conflict detection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    expect(paths.outboxDir).toBe(join(root, 'var', 'knowledge-event-outbox', 'codex-judgment'));
    expect(paths.lockPath).toBe(`${paths.outboxDir}.sender.lock`);

    const first = enqueueJudgmentKnowledgeEvent(event(), { directory: paths.outboxDir });
    const second = enqueueJudgmentKnowledgeEvent(event(), { directory: paths.outboxDir });
    expect(first.status).toBe('queued');
    expect(second).toEqual({ status: 'existing', path: first.path });
    expect(JSON.parse(await readFile(first.path, 'utf8'))).toMatchObject({
      schema_version: 'judgment_event_outbox.v1',
      event: { event_id: 'event-1' },
      delivery: { attempt: 1 }
    });
    expect(() => enqueueJudgmentKnowledgeEvent({ ...event(), payload: { summary: 'changed' } }, {
      directory: paths.outboxDir
    })).toThrow('knowledge_event_outbox_conflict');
  });

  it('publishes one complete record when two processes enqueue the same event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    const candidate = event('event-concurrent');
    const [first, second] = await Promise.all([
      runEnqueueWorker(paths.outboxDir, candidate),
      runEnqueueWorker(paths.outboxDir, candidate)
    ]);
    expect([first.status, second.status].sort()).toEqual(['existing', 'queued']);
    expect(JSON.parse(await readFile(join(paths.outboxDir, 'event-concurrent.json'), 'utf8'))).toMatchObject({
      schema_version: 'judgment_event_outbox.v1',
      event: candidate,
      delivery: { attempt: 1 }
    });
  }, 15_000);

  it('dead-letters invalid schema, unsafe event ids, and filename mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    expect(() => enqueueJudgmentKnowledgeEvent(event('../escape'), { directory: paths.outboxDir }))
      .toThrow('knowledge event_id is invalid');
    await mkdir(paths.outboxDir, { recursive: true });
    await writeFile(join(paths.outboxDir, 'wrong-name.json'), JSON.stringify({
      schema_version: JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION,
      event: event('event-inside'),
      delivery: { attempt: 1, queued_at: '2026-10-18T00:00:00.000Z' }
    }));
    await writeFile(join(paths.outboxDir, 'bad-schema.json'), JSON.stringify({
      schema_version: 'judgment_event_outbox.legacy',
      event: event('bad-schema'),
      delivery: { attempt: 1, queued_at: '2026-10-18T00:00:00.000Z' }
    }));
    const result = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      delivery: {
        post: async () => { throw new Error('invalid record should not be posted'); },
        readback: async () => { throw new Error('invalid record should not be read back'); }
      }
    });
    expect(result).toMatchObject({ status: 'processed', failed: 2, dead_lettered: 2, pending: 0 });
    expect((await readdir(paths.deadLetterDir)).sort()).toEqual(['bad-schema.json', 'wrong-name.json']);
  });

  it('preserves dead-letter history when the source filename is reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    await mkdir(paths.outboxDir, { recursive: true });
    const duplicateFile = join(paths.outboxDir, 'duplicate-name.json');
    const invalidRecord = (eventId: string) => JSON.stringify({
      schema_version: 'judgment_event_outbox.legacy',
      event: event(eventId),
      delivery: { attempt: 1, queued_at: '2026-10-18T00:00:00.000Z' }
    });

    await writeFile(duplicateFile, invalidRecord('first-dead-letter'));
    const first = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      delivery: {
        post: async () => { throw new Error('invalid record should not be posted'); },
        readback: async () => { throw new Error('invalid record should not be read back'); }
      }
    });
    await writeFile(duplicateFile, invalidRecord('second-dead-letter'));
    const second = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      delivery: {
        post: async () => { throw new Error('invalid record should not be posted'); },
        readback: async () => { throw new Error('invalid record should not be read back'); }
      }
    });

    expect(first).toMatchObject({ status: 'processed', failed: 1, dead_lettered: 1, pending: 0 });
    expect(second).toMatchObject({ status: 'processed', failed: 1, dead_lettered: 1, pending: 0 });
    const deadLetters = (await readdir(paths.deadLetterDir)).filter((file) => file.startsWith('duplicate-name'));
    expect(deadLetters).toHaveLength(2);
    expect(deadLetters).toContain('duplicate-name.json');
    expect(deadLetters.some((file) => file !== 'duplicate-name.json')).toBe(true);
    const contents = await Promise.all(deadLetters.map((file) => readFile(join(paths.deadLetterDir, file), 'utf8')));
    expect(contents.some((content) => content.includes('first-dead-letter'))).toBe(true);
    expect(contents.some((content) => content.includes('second-dead-letter'))).toBe(true);
  });

  it('serializes senders and recovers a stale sender lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const first = withJudgmentOutboxSenderLock({
      lockPath: paths.lockPath,
      run: async () => {
        entered();
        await held;
        return 'first';
      }
    });
    await enteredPromise;
    await waitForFile(paths.lockPath);
    await expect(withJudgmentOutboxSenderLock({
      lockPath: paths.lockPath,
      run: () => 'second'
    })).resolves.toEqual({ status: 'busy' });
    release();
    await expect(first).resolves.toBe('first');

    await (await import('node:fs/promises')).writeFile(paths.lockPath, 'stale\n');
    const stale = new Date('2026-10-17T00:00:00.000Z');
    await utimes(paths.lockPath, stale, stale);
    await expect(withJudgmentOutboxSenderLock({
      lockPath: paths.lockPath,
      now: () => new Date('2026-10-18T00:00:00.000Z'),
      staleAfterMs: 1000,
      run: () => 'recovered'
    })).resolves.toBe('recovered');
  });

  it('posts, reads back, persists a confirmed receipt, and removes the queue item', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    const queued = event();
    enqueueJudgmentKnowledgeEvent(queued, { directory: paths.outboxDir });
    const posted: string[] = [];
    const result = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      delivery: {
        post: async (candidate) => {
          posted.push(candidate.event_id);
          return {
            event_id: candidate.event_id,
            candidate_id: 'candidate-1',
            http_status: 201,
            received_at: '2026-10-18T00:00:00.500Z'
          };
        },
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id)
      },
      now: () => new Date('2026-10-18T00:00:02.000Z')
    });
    expect(result).toMatchObject({ status: 'processed', delivered: 1, failed: 0, pending: 0 });
    expect(posted).toEqual(['event-1']);
    await expect(readdir(paths.outboxDir)).resolves.toEqual([]);
    const receipt = JSON.parse(await readFile(join(paths.deliveryReceiptDir, 'event-1.json'), 'utf8'));
    expect(receipt).toMatchObject({
      schema_version: JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION,
      status: 'confirmed',
      event_id: 'event-1',
      candidate_id: 'candidate-1',
      readback: { processing_stage: 'retrievable', semantic_state: 'active' }
    });
  });

  it('retains a post acknowledgement while retrying readback without reposting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);
    enqueueJudgmentKnowledgeEvent(event(), { directory: paths.outboxDir });
    let posts = 0;
    let readbacks = 0;
    const delivery = {
      post: async (candidate: JudgmentKnowledgeEvent) => {
        posts += 1;
        return {
          event_id: candidate.event_id,
          candidate_id: 'candidate-retry',
          received_at: '2026-10-18T00:00:00.500Z'
        };
      },
      readback: async ({ event: candidate, post }: { event: JudgmentKnowledgeEvent; post: { candidate_id: string | null } }) => {
        readbacks += 1;
        if (readbacks === 1) {
          const error = new Error('readback unavailable') as Error & { code: string; phase: 'readback' };
          error.code = 'readback_unavailable';
          error.phase = 'readback';
          throw error;
        }
        return readback(candidate.event_id, post.candidate_id);
      }
    };
    const first = await deliverJudgmentKnowledgeEventOutbox({ paths, delivery });
    expect(first).toMatchObject({ failed: 1, retryable: 1, pending: 1, delivered: 0 });
    const pending = JSON.parse(await readFile(join(paths.outboxDir, 'event-1.json'), 'utf8'));
    expect(pending.delivery).toMatchObject({ attempt: 1, readback_attempt: 2, post_ack: { candidate_id: 'candidate-retry' } });

    const second = await deliverJudgmentKnowledgeEventOutbox({ paths, delivery });
    expect(second).toMatchObject({ failed: 0, delivered: 1, pending: 0 });
    expect(posts).toBe(1);
    expect(readbacks).toBe(2);
  });

  it('does not consume a post attempt for a transport outage and dead-letters HTTP conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const transportPaths = pathsFor(join(root, 'transport'));
    enqueueJudgmentKnowledgeEvent(event('transport-event'), { directory: transportPaths.outboxDir });
    const transportError = Object.assign(new Error('transport unavailable'), {
      code: 'knowledge_event_delivery_transport_failed',
      phase: 'post' as const,
      transport: true
    });
    const transport = await deliverJudgmentKnowledgeEventOutbox({
      paths: transportPaths,
      delivery: {
        post: async () => { throw transportError; },
        readback: async () => { throw new Error('unreachable'); }
      }
    });
    expect(transport).toMatchObject({ failed: 1, retryable: 1, pending: 1, last_error_code: transportError.code });
    expect(JSON.parse(await readFile(join(transportPaths.outboxDir, 'transport-event.json'), 'utf8')).delivery.attempt).toBe(1);

    const conflictPaths = pathsFor(join(root, 'conflict'));
    enqueueJudgmentKnowledgeEvent(event('conflict-event'), { directory: conflictPaths.outboxDir });
    const conflict = await deliverJudgmentKnowledgeEventOutbox({
      paths: conflictPaths,
      maxAttempts: 1,
      delivery: {
        post: async () => {
          throw Object.assign(new Error('conflict'), {
            code: 'knowledge_event_conflict',
            phase: 'post' as const,
            httpStatus: 409
          });
        },
        readback: async () => { throw new Error('unreachable'); }
      }
    });
    expect(conflict).toMatchObject({ failed: 1, dead_lettered: 1, pending: 0 });
    await expect(listKnowledgeEventDeadLetters({ directory: conflictPaths.deadLetterDir })).resolves.toMatchObject([
      { code: 'knowledge_event_dead_letter', event_id: 'conflict-event' }
    ]);
  });

  it('propagates non-brainbase project_code, scopes delivery by allowedProjectCodes without dead-lettering, and preserves candidate_id contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-'));
    roots.push(root);
    const paths = pathsFor(root);

    // Enqueue conflict catches project_code mutation for the same event_id.
    const outOfScopeEvent = event('event-a-other', 'other-project');
    const inScopeEvent = event('event-b-itsaplan', 'itsaplan');
    enqueueJudgmentKnowledgeEvent(outOfScopeEvent, { directory: paths.outboxDir });
    expect(() => enqueueJudgmentKnowledgeEvent(event('event-a-other', 'itsaplan'), { directory: paths.outboxDir }))
      .toThrow('knowledge_event_outbox_conflict');
    enqueueJudgmentKnowledgeEvent(inScopeEvent, { directory: paths.outboxDir });

    // Deliver with a token scoped only to ['itsaplan'] and limit: 1.
    // The earlier-sorted out-of-scope event must be deferred (not posted, not dead-lettered,
    // not consuming limit/attempts) while the in-scope event is delivered cleanly.
    const posted: Array<{ event_id: string; project_code: string }> = [];
    const firstPass = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      limit: 1,
      allowedProjectCodes: ['itsaplan'],
      delivery: {
        post: async (candidate) => {
          posted.push({ event_id: candidate.event_id, project_code: candidate.applicability_scope.project_code });
          return {
            event_id: candidate.event_id,
            candidate_id: 'cand-itsaplan-1',
            http_status: 202,
            received_at: '2026-11-24T00:00:00.500Z'
          };
        },
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id)
      },
      now: () => new Date('2026-11-24T00:00:02.000Z')
    });

    expect(firstPass).toMatchObject({
      status: 'processed',
      delivered: 1,
      failed: 0,
      retryable: 0,
      dead_lettered: 0,
      deferred: 1,
      out_of_scope: 1,
      pending: 1
    });
    expect(posted).toEqual([{ event_id: 'event-b-itsaplan', project_code: 'itsaplan' }]);
    const itsaplanReceipt = JSON.parse(await readFile(join(paths.deliveryReceiptDir, 'event-b-itsaplan.json'), 'utf8'));
    expect(itsaplanReceipt).toMatchObject({
      status: 'confirmed',
      event_id: 'event-b-itsaplan',
      candidate_id: 'cand-itsaplan-1',
      project_code: 'itsaplan'
    });
    // Deferred out-of-scope record keeps attempt=1 and never enters dead-letter.
    const deferredRecord = JSON.parse(await readFile(join(paths.outboxDir, 'event-a-other.json'), 'utf8'));
    expect(deferredRecord.delivery.attempt).toBe(1);
    await expect(listKnowledgeEventDeadLetters({ directory: paths.deadLetterDir })).resolves.toEqual([]);

    // A subsequent delivery run whose token includes 'other-project' delivers the deferred event.
    const secondPass = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      allowedProjectCodes: ['other-project'],
      delivery: {
        post: async (candidate) => {
          posted.push({ event_id: candidate.event_id, project_code: candidate.applicability_scope.project_code });
          return {
            event_id: candidate.event_id,
            candidate_id: 'cand-other-1',
            http_status: 202,
            received_at: '2026-11-24T00:01:00.500Z'
          };
        },
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id)
      },
      now: () => new Date('2026-11-24T00:01:02.000Z')
    });
    expect(secondPass).toMatchObject({
      status: 'processed',
      delivered: 1,
      failed: 0,
      dead_lettered: 0,
      deferred: 0,
      pending: 0
    });
    expect(secondPass).not.toHaveProperty('out_of_scope');
    const otherReceipt = JSON.parse(await readFile(join(paths.deliveryReceiptDir, 'event-a-other.json'), 'utf8'));
    expect(otherReceipt).toMatchObject({
      status: 'confirmed',
      event_id: 'event-a-other',
      candidate_id: 'cand-other-1',
      project_code: 'other-project'
    });

    // Missing or conflicting project_code is safely deferred under allowedProjectCodes (no post, no dead-letter).
    const missingProjectEvent = {
      ...event('event-c-missing', 'brainbase'),
      applicability_scope: { scope: 'judgment_episode' } as unknown as JudgmentKnowledgeEvent['applicability_scope']
    };
    const conflictingProjectEvent = {
      ...event('event-d-conflict', 'denied-project'),
      project_code: 'itsaplan'
    } as JudgmentKnowledgeEvent;
    enqueueJudgmentKnowledgeEvent(missingProjectEvent, { directory: paths.outboxDir });
    enqueueJudgmentKnowledgeEvent(conflictingProjectEvent, { directory: paths.outboxDir });
    const scopedCheck = await deliverJudgmentKnowledgeEventOutbox({
      paths,
      allowedProjectCodes: ['itsaplan'],
      delivery: {
        post: async () => { throw new Error('out-of-scope or missing project_code should not be posted'); },
        readback: async () => { throw new Error('unreachable'); }
      }
    });
    expect(scopedCheck).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 0,
      dead_lettered: 0,
      deferred: 2,
      out_of_scope: 2,
      pending: 2
    });

    // Critical PR-1 invariant: non-empty candidate_id remains required on post ack for non-brainbase events.
    const candidateCheckPaths = pathsFor(join(root, 'candidate-invariant'));
    enqueueJudgmentKnowledgeEvent(event('event-e-cand', 'itsaplan'), { directory: candidateCheckPaths.outboxDir });
    const missingCandidateAck = await deliverJudgmentKnowledgeEventOutbox({
      paths: candidateCheckPaths,
      maxAttempts: 2,
      allowedProjectCodes: ['itsaplan'],
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: '',
          http_status: 202,
          received_at: '2026-11-24T00:02:00.000Z'
        }),
        readback: async () => { throw new Error('readback should not run when candidate_id is empty'); }
      }
    });
    expect(missingCandidateAck).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_delivery_ack_identity_mismatch'
    });
  });

  it('conditionally accepts candidate_id: null for episode events and strictly enforces non-empty candidate_id for non-episode subjects (RFC-002 PR-3b)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-judgment-outbox-pr3b-'));
    roots.push(root);

    // 1. Pure guard matrix aligned with RFC-002 PR-3 Contract 1
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: null,
      readbackCandidateId: null,
      postCandidateCreated: false,
      postTargetTier: 'episode',
      readbackCandidateCreated: false,
      readbackTargetTier: 'episode'
    })).toBe(true);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: null,
      readbackCandidateId: null
    })).toBe(true);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: 'cand-1',
      readbackCandidateId: 'cand-1'
    })).toBe(true);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: null,
      readbackCandidateId: 'cand-1'
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: 'cand-1',
      readbackCandidateId: null
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: '',
      readbackCandidateId: ''
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: null,
      readbackCandidateId: null,
      postCandidateCreated: true
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'episode',
      postCandidateId: null,
      readbackCandidateId: null,
      readbackTargetTier: 'ledger'
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'decision',
      postCandidateId: null,
      readbackCandidateId: null,
      postCandidateCreated: false,
      postTargetTier: 'episode',
      readbackCandidateCreated: false,
      readbackTargetTier: 'episode'
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'distilled_candidate',
      postCandidateId: null,
      readbackCandidateId: null
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'judgment_episode',
      postCandidateId: null,
      readbackCandidateId: null
    })).toBe(false);
    expect(isValidJudgmentOutboxCandidateIdPair({
      subjectType: 'decision',
      postCandidateId: 'cand-dec-1',
      readbackCandidateId: 'cand-dec-1'
    })).toBe(true);

    // 2. Episode with post.candidate_id = null and readback.candidate_id = null (PR-3a #1584 response contract)
    const episodeNullPaths = pathsFor(join(root, 'episode-null'));
    const epNullEvent = eventWithSubject('event-ep-null', 'episode', 'itsaplan');
    enqueueJudgmentKnowledgeEvent(epNullEvent, { directory: episodeNullPaths.outboxDir });
    const epNullResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: episodeNullPaths,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: null,
          candidate_created: false,
          target_tier: 'episode',
          http_status: 202,
          received_at: '2026-11-24T00:00:00.500Z'
        }),
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id, {
          candidate_created: false,
          target_tier: 'episode'
        })
      },
      now: () => new Date('2026-11-24T00:00:02.000Z')
    });
    expect(epNullResult).toMatchObject({ status: 'processed', delivered: 1, failed: 0, pending: 0 });
    await expect(readdir(episodeNullPaths.outboxDir)).resolves.toEqual([]);
    const epNullReceipt = JSON.parse(
      await readFile(join(episodeNullPaths.deliveryReceiptDir, 'event-ep-null.json'), 'utf8')
    );
    expect(epNullReceipt).toMatchObject({
      schema_version: JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION,
      status: 'confirmed',
      event_id: 'event-ep-null',
      candidate_id: null,
      project_code: 'itsaplan',
      post: { candidate_id: null, candidate_created: false, target_tier: 'episode' },
      readback: {
        candidate_id: null,
        candidate_created: false,
        target_tier: 'episode',
        processing_stage: 'retrievable',
        semantic_state: 'active'
      }
    });

    // 3. Confirmed receipt crash-recovery with candidate_id: null for episode (must not repost or re-read)
    await writeFile(
      join(episodeNullPaths.outboxDir, 'event-ep-null.json'),
      JSON.stringify({
        schema_version: JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION,
        event: epNullEvent,
        delivery: {
          attempt: 1,
          queued_at: '2026-11-24T00:00:00.000Z',
          post_ack: epNullReceipt.post,
          phase: 'readback_pending'
        }
      })
    );
    const epNullRecovery = await deliverJudgmentKnowledgeEventOutbox({
      paths: episodeNullPaths,
      delivery: {
        post: async () => { throw new Error('confirmed null-candidate episode receipt should not repost'); },
        readback: async () => { throw new Error('confirmed null-candidate episode receipt should not re-read'); }
      }
    });
    expect(epNullRecovery).toMatchObject({ status: 'processed', delivered: 1, failed: 0, pending: 0 });
    await expect(readdir(episodeNullPaths.outboxDir)).resolves.toEqual([]);

    // 4. Episode transition compatibility: matching non-empty candidate_id still confirms
    const episodeTransitionPaths = pathsFor(join(root, 'episode-transition'));
    enqueueJudgmentKnowledgeEvent(
      eventWithSubject('event-ep-transition', 'episode', 'itsaplan'),
      { directory: episodeTransitionPaths.outboxDir }
    );
    const epTransitionResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: episodeTransitionPaths,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: 'cand-1',
          http_status: 202,
          received_at: '2026-11-24T00:01:00.500Z'
        }),
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id)
      }
    });
    expect(epTransitionResult).toMatchObject({ status: 'processed', delivered: 1, failed: 0, pending: 0 });
    const epTransitionReceipt = JSON.parse(
      await readFile(join(episodeTransitionPaths.deliveryReceiptDir, 'event-ep-transition.json'), 'utf8')
    );
    expect(epTransitionReceipt).toMatchObject({
      status: 'confirmed',
      event_id: 'event-ep-transition',
      candidate_id: 'cand-1'
    });

    // 5. Episode half-null mismatch: post = null vs readback = 'cand-1' MUST fail
    const halfNullPathsA = pathsFor(join(root, 'episode-half-null-a'));
    enqueueJudgmentKnowledgeEvent(
      eventWithSubject('event-ep-half-a', 'episode', 'itsaplan'),
      { directory: halfNullPathsA.outboxDir }
    );
    const halfNullResultA = await deliverJudgmentKnowledgeEventOutbox({
      paths: halfNullPathsA,
      maxAttempts: 2,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: null,
          candidate_created: false,
          target_tier: 'episode',
          http_status: 202,
          received_at: '2026-11-24T00:02:00.500Z'
        }),
        readback: async ({ event: candidate }) => readback(candidate.event_id, 'cand-1')
      }
    });
    expect(halfNullResultA).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_readback_identity_or_state_mismatch'
    });

    // 6. Episode half-null mismatch (reverse): post = 'cand-1' vs readback = null MUST fail
    const halfNullPathsB = pathsFor(join(root, 'episode-half-null-b'));
    enqueueJudgmentKnowledgeEvent(
      eventWithSubject('event-ep-half-b', 'episode', 'itsaplan'),
      { directory: halfNullPathsB.outboxDir }
    );
    const halfNullResultB = await deliverJudgmentKnowledgeEventOutbox({
      paths: halfNullPathsB,
      maxAttempts: 2,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: 'cand-1',
          http_status: 202,
          received_at: '2026-11-24T00:02:30.500Z'
        }),
        readback: async ({ event: candidate }) => readback(candidate.event_id, null, {
          candidate_created: false,
          target_tier: 'episode'
        })
      }
    });
    expect(halfNullResultB).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_readback_identity_or_state_mismatch'
    });

    // 7. Episode with contradictory flags (candidate_id: null + candidate_created: true or target_tier: 'ledger') MUST fail
    const contradictoryPaths = pathsFor(join(root, 'episode-contradictory'));
    enqueueJudgmentKnowledgeEvent(
      eventWithSubject('event-ep-contradictory', 'episode', 'itsaplan'),
      { directory: contradictoryPaths.outboxDir }
    );
    const contradictoryResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: contradictoryPaths,
      maxAttempts: 2,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: null,
          candidate_created: true,
          target_tier: 'episode',
          http_status: 202,
          received_at: '2026-11-24T00:03:00.500Z'
        }),
        readback: async () => { throw new Error('readback should not run on contradictory post ack'); }
      }
    });
    expect(contradictoryResult).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_delivery_ack_identity_mismatch'
    });

    // 8. Non-episode (decision) with candidate_id: null MUST be rejected even with spoofed flags
    const decisionNullPaths = pathsFor(join(root, 'decision-null'));
    const decisionEvent = eventWithSubject('event-dec-null', 'decision', 'itsaplan');
    enqueueJudgmentKnowledgeEvent(decisionEvent, { directory: decisionNullPaths.outboxDir });
    const decisionNullResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: decisionNullPaths,
      maxAttempts: 2,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: null,
          candidate_created: false,
          target_tier: 'episode',
          http_status: 202,
          received_at: '2026-11-24T00:04:00.500Z'
        }),
        readback: async () => { throw new Error('readback should not run for non-episode candidate_id: null'); }
      }
    });
    expect(decisionNullResult).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_delivery_ack_identity_mismatch'
    });

    // 9. Non-episode (decision) with tampered null-candidate confirmed receipt on disk MUST NOT be accepted
    await mkdir(decisionNullPaths.deliveryReceiptDir, { recursive: true });
    await writeFile(
      join(decisionNullPaths.deliveryReceiptDir, 'event-dec-null.json'),
      JSON.stringify({
        schema_version: JUDGMENT_EVENT_DELIVERY_RECEIPT_SCHEMA_VERSION,
        status: 'confirmed',
        event_id: 'event-dec-null',
        candidate_id: null,
        project_code: 'itsaplan',
        post: {
          event_id: 'event-dec-null',
          candidate_id: null,
          candidate_created: false,
          target_tier: 'episode',
          received_at: '2026-11-24T00:04:00.500Z'
        },
        readback: readback('event-dec-null', null, { candidate_created: false, target_tier: 'episode' }),
        confirmed_at: '2026-11-24T00:04:01.000Z'
      })
    );
    await writeFile(
      join(decisionNullPaths.outboxDir, 'event-dec-null.json'),
      JSON.stringify({
        schema_version: JUDGMENT_EVENT_OUTBOX_SCHEMA_VERSION,
        event: decisionEvent,
        delivery: {
          attempt: 1,
          queued_at: '2026-11-24T00:04:00.000Z',
          post_ack: {
            event_id: 'event-dec-null',
            candidate_id: null,
            candidate_created: false,
            target_tier: 'episode',
            received_at: '2026-11-24T00:04:00.500Z'
          },
          phase: 'readback_pending'
        }
      })
    );
    const tamperedDecisionResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: decisionNullPaths,
      maxAttempts: 2,
      delivery: {
        post: async () => { throw new Error('post should not run when tampered post_ack fails closed'); },
        readback: async () => { throw new Error('readback should not run when tampered post_ack fails closed'); }
      }
    });
    expect(tamperedDecisionResult).toMatchObject({
      status: 'processed',
      delivered: 0,
      failed: 1,
      retryable: 1,
      dead_lettered: 0,
      last_error_code: 'knowledge_event_delivery_ack_identity_mismatch'
    });

    // 10. Non-episode (decision) with non-empty candidate_id continues to confirm normally
    const decisionValidPaths = pathsFor(join(root, 'decision-valid'));
    enqueueJudgmentKnowledgeEvent(
      eventWithSubject('event-dec-valid', 'decision', 'itsaplan'),
      { directory: decisionValidPaths.outboxDir }
    );
    const decisionValidResult = await deliverJudgmentKnowledgeEventOutbox({
      paths: decisionValidPaths,
      delivery: {
        post: async (candidate) => ({
          event_id: candidate.event_id,
          candidate_id: 'cand-dec-1',
          http_status: 202,
          received_at: '2026-11-24T00:05:00.500Z'
        }),
        readback: async ({ event: candidate, post }) => readback(candidate.event_id, post.candidate_id)
      }
    });
    expect(decisionValidResult).toMatchObject({ status: 'processed', delivered: 1, failed: 0, pending: 0 });
    const decisionValidReceipt = JSON.parse(
      await readFile(join(decisionValidPaths.deliveryReceiptDir, 'event-dec-valid.json'), 'utf8')
    );
    expect(decisionValidReceipt).toMatchObject({
      status: 'confirmed',
      event_id: 'event-dec-valid',
      candidate_id: 'cand-dec-1'
    });
  });
});
