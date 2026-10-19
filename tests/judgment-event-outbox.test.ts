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
  listKnowledgeEventDeadLetters,
  resolveJudgmentKnowledgeEventOutboxPaths,
  withJudgmentOutboxSenderLock,
  type JudgmentKnowledgeEvent,
  type JudgmentOutboxPaths
} from '../src/judgment-event-outbox.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(eventId = 'event-1'): JudgmentKnowledgeEvent {
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
    applicability_scope: { scope: 'judgment_episode', project_code: 'brainbase' },
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

function readback(eventId: string, candidateId: string) {
  return {
    schema_version: JUDGMENT_EVENT_READBACK_SCHEMA_VERSION,
    event_id: eventId,
    candidate_id: candidateId,
    processing_stage: 'retrievable' as const,
    semantic_state: 'active' as const,
    readback_at: '2026-10-18T00:00:01.000Z'
  };
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
      readback: async ({ event: candidate, post }: { event: JudgmentKnowledgeEvent; post: { candidate_id: string } }) => {
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
});
