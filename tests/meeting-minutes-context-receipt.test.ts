import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createMeetingMinutesContextReceipt,
  readMeetingMinutesContextReceipt,
  type MeetingMinutesContextReceipt,
} from '../src/meeting-minutes-context-receipt.js';

describe('meeting minutes context receipt common core', () => {
  it('preserves identity, filters open tasks, retries persistence, and reads back', async () => {
    const receipts = new Map<string, MeetingMinutesContextReceipt>();
    const claims = new Map<string, MeetingMinutesContextReceipt>();
    let claimTail = Promise.resolve();
    let putAttempts = 0;
    let graphCalls = 0;
    let taskCalls = 0;
    let actorCalls = 0;
    let authCalls = 0;
    let tenantCalls = 0;
    let projectCalls = 0;
    const identity = {
      run_id: 'run-2026-10-18',
      project_code: 'project-test',
      transcript_sha256: createHash('sha256').update('transcript').digest('hex'),
    };
    const ports = {
      graph: async () => {
        graphCalls += 1;
        return ({
        graph: {
          entities: [
            { id: 'project-1', entity_type: 'project', name: 'Project' },
            { id: 'decision-1', entity_type: 'decision', title: 'Decision' },
            { id: 'minutes-1', entity_type: 'meeting_minutes', title: 'Minutes' },
          ],
          edges: [],
        },
        retrieval: { mode: 'project_scoped', mention_count: 0 },
        status: 'resolved',
        });
      },
      tasks: async () => {
        taskCalls += 1;
        return { items: [{ id: 'task-1', status: 'pending', title: 'Open' }, { id: 'task-2', status: 'completed', title: 'Done' }] };
      },
      actor: {
        resolve: async () => {
          actorCalls += 1;
          return { actor_id: 'actor-test' };
        },
      },
      auth: { authorize: async () => { authCalls += 1; } },
      tenant: { authorize: async () => { tenantCalls += 1; } },
      project: { authorize: async () => { projectCalls += 1; } },
      repository: {
        claimOrReplay: async (request: {
          receipt_id: string;
          execute: () => Promise<MeetingMinutesContextReceipt>;
        }) => {
          const previous = claimTail;
          let release!: () => void;
          claimTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            const replay = claims.get(request.receipt_id);
            if (replay) return { status: 'replayed' as const, receipt: replay };
            const receipt = await request.execute();
            claims.set(request.receipt_id, receipt);
            return { status: 'persisted' as const, receipt };
          } finally {
            release();
          }
        },
        put: async (receipt: MeetingMinutesContextReceipt) => {
          putAttempts += 1;
          if (putAttempts === 1) throw Object.assign(new Error('temporary receipt failure'), { retryable: true });
          receipts.set(receipt.receipt_id, receipt);
          return receipt;
        },
        get: async (receiptId: string) => receipts.get(receiptId) ?? null,
      },
      is_retryable: (error: unknown) => Boolean((error as { retryable?: boolean }).retryable),
      now: () => new Date('2026-10-18T00:00:00.000Z'),
      scope: { org_id: 'org-test', project_id: 'project-test' },
    };

    const [receipt, concurrentReplay] = await Promise.all([
      createMeetingMinutesContextReceipt({ ...identity, retrieval_context: { mention_candidates: ['Project'] } }, ports),
      createMeetingMinutesContextReceipt({ ...identity, retrieval_context: { mention_candidates: ['Project'] } }, ports),
    ]);
    expect(receipt.schema_version).toBe('meeting_minutes_context_receipt.v1');
    expect(receipt.status).toBe('resolved');
    expect(receipt.context.open_tasks).toHaveLength(1);
    expect(receipt.context.approved_minutes_refs).toEqual([{ id: 'minutes-1', title: 'Minutes' }]);
    expect(receipt.context.source_refs).toContainEqual({ type: 'meeting_minutes', id: 'minutes-1' });
    expect(receipt.context.retrieval).toEqual({ mode: 'project_scoped', mention_count: 0 });
    expect(putAttempts).toBe(2);
    expect(concurrentReplay).toEqual(receipt);
    expect(graphCalls).toBe(1);
    expect(taskCalls).toBe(1);
    expect(actorCalls).toBe(2);
    expect(authCalls).toBe(2);
    expect(tenantCalls).toBe(2);
    expect(projectCalls).toBe(2);

    const readback = await readMeetingMinutesContextReceipt(receipt.receipt_id, identity, ports);
    expect(readback).toEqual(receipt);
    await expect(createMeetingMinutesContextReceipt({ ...identity, retrieval_context: { mention_candidates: ['Project'] } }, {
      ...ports,
      repository: {
        ...ports.repository,
        get: async () => null,
      },
    })).rejects.toMatchObject({ code: 'meeting_minutes_context_readback_mismatch' });
  });

  it('emits confirmed_empty when both injected sources return empty data', async () => {
    const receipts = new Map<string, MeetingMinutesContextReceipt>();
    const claims = new Map<string, MeetingMinutesContextReceipt>();
    let claimTail = Promise.resolve();
    const ports = {
      graph: async () => ({ entities: [], edges: [] }),
      tasks: async () => ({ items: [] }),
      actor: { resolve: async () => ({ actor_id: 'actor-test' }) },
      auth: { authorize: async () => {} },
      tenant: { authorize: async () => {} },
      project: { authorize: async () => {} },
      repository: {
        claimOrReplay: async (request: {
          receipt_id: string;
          execute: () => Promise<MeetingMinutesContextReceipt>;
        }) => {
          const previous = claimTail;
          let release!: () => void;
          claimTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            const replay = claims.get(request.receipt_id);
            if (replay) return { status: 'replayed' as const, receipt: replay };
            const receipt = await request.execute();
            claims.set(request.receipt_id, receipt);
            return { status: 'persisted' as const, receipt };
          } finally {
            release();
          }
        },
        put: async (receipt: MeetingMinutesContextReceipt) => { receipts.set(receipt.receipt_id, receipt); return receipt; },
        get: async (receiptId: string) => receipts.get(receiptId) ?? null,
      },
      now: () => new Date('2026-10-18T00:00:00.000Z'),
    };
    const receipt = await createMeetingMinutesContextReceipt({
      run_id: 'run-empty',
      project_code: 'project-test',
      transcript_sha256: createHash('sha256').update('empty').digest('hex'),
    }, ports);
    expect(receipt.status).toBe('confirmed_empty');
  });

  it('does not convert unfetched sources into confirmed_empty', async () => {
    const receipts = new Map<string, MeetingMinutesContextReceipt>();
    const claims = new Map<string, MeetingMinutesContextReceipt>();
    const ports = {
      actor: { resolve: async () => ({ actor_id: 'actor-test' }) },
      auth: { authorize: async () => {} },
      tenant: { authorize: async () => {} },
      project: { authorize: async () => {} },
      repository: {
        claimOrReplay: async (request: { receipt_id: string; execute: () => Promise<MeetingMinutesContextReceipt> }) => {
          const replay = claims.get(request.receipt_id);
          if (replay) return { status: 'replayed' as const, receipt: replay };
          const receipt = await request.execute();
          claims.set(request.receipt_id, receipt);
          return { status: 'persisted' as const, receipt };
        },
        put: async (receipt: MeetingMinutesContextReceipt) => { receipts.set(receipt.receipt_id, receipt); return receipt; },
        get: async (receiptId: string) => receipts.get(receiptId) ?? null,
      },
    };
    const receipt = await createMeetingMinutesContextReceipt({
      run_id: 'run-unavailable',
      project_code: 'project-test',
      transcript_sha256: createHash('sha256').update('unavailable').digest('hex'),
    }, ports);
    expect(receipt.status).toBe('unavailable');
    expect(receipt.source_status).toEqual({ graph: 'unavailable', tasks: 'unavailable' });
  });
});
