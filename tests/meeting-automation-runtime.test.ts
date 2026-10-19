import { describe, expect, it } from 'vitest';

import { MEETING_REVIEW_HUMAN_STEP_DEFINITIONS, MEETING_REVIEW_OUTPUT_DEFINITIONS } from '../src/meeting-automation.js';
import { runMeetingAutomationRuntime, type MeetingAutomationRuntimeRecord } from '../src/meeting-automation-runtime.js';

function reviewPackage() {
  const loopIntentIds: Record<string, string> = {};
  for (const definition of [...MEETING_REVIEW_OUTPUT_DEFINITIONS, ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS]) {
    loopIntentIds[definition.loop_intent_key] = `intent-${definition.loop_intent_key}`;
  }
  return {
    meeting_note_summary: { title: 'Weekly review' },
    task_candidates: [{ title: 'Prepare proposal', owner_hint: 'owner@example.test' }],
    decision_candidates: [{ title: 'Use the new process', decision_type: 'policy' }],
    follow_up_draft: { body: 'Draft only' },
    promotion_candidates: [{ title: 'Candidate' }],
    loop_intent_ids: loopIntentIds,
  };
}

describe('meeting automation runtime common core', () => {
  it('normalizes, retries, persists, reads back, and replays the same record', async () => {
    const records = new Map<string, MeetingAutomationRuntimeRecord>();
    const executions = new Map<string, {
      record: MeetingAutomationRuntimeRecord;
      attempts: number;
      workflow: Record<string, unknown> | null;
      knowledge: Record<string, unknown> | null;
    }>();
    const effects = new Map<string, unknown>();
    const pendingEffects = new Map<string, Promise<unknown>>();
    let claimTail = Promise.resolve();
    let saveAttempts = 0;
    let prepareCalls = 0;
    let bridgeCalls = 0;
    const events: string[] = [];
    const ports = {
      ledger: {
        findByIdempotencyKey: async (key: string) => [...records.values()].find((record) => record.idempotency_key === key) ?? null,
        claimOrReplay: async (request: {
          idempotency_key: string;
          execute: () => Promise<{
            record: MeetingAutomationRuntimeRecord;
            attempts: number;
            workflow: Record<string, unknown> | null;
            knowledge: Record<string, unknown> | null;
          }>;
        }) => {
          const previous = claimTail;
          let release!: () => void;
          claimTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            const replay = executions.get(request.idempotency_key);
            if (replay) return { status: 'replayed' as const, execution: replay };
            const execution = await request.execute();
            executions.set(request.idempotency_key, execution);
            records.set(execution.record.record_id, execution.record);
            return { status: 'persisted' as const, execution };
          } finally {
            release();
          }
        },
        save: async (record: MeetingAutomationRuntimeRecord) => {
          events.push('save');
          saveAttempts += 1;
          if (saveAttempts === 1) throw Object.assign(new Error('temporary ledger failure'), { retryable: true });
          records.set(record.record_id, record);
          return record;
        },
        readback: async (recordId: string) => {
          events.push('readback');
          return records.get(recordId) ?? null;
        },
      },
      is_retryable: (error: unknown) => Boolean((error as { retryable?: boolean }).retryable),
      now: () => new Date('2026-10-18T00:00:00.000Z'),
      prepareWorkflow: async () => {
        prepareCalls += 1;
        return { workflow_id: 'workflow-test' };
      },
      bridgeKnowledge: async () => {
        events.push('bridge');
        bridgeCalls += 1;
        return { bridge_id: 'bridge-test' };
      },
      runOnce: async <T>(key: string, effect: () => T | Promise<T>) => {
        events.push('runOnce');
        if (effects.has(key)) return effects.get(key) as T;
        const pending = pendingEffects.get(key);
        if (pending) return pending as Promise<T>;
        const next = Promise.resolve().then(effect);
        pendingEffects.set(key, next);
        try {
          const value = await next;
          effects.set(key, value);
          return value;
        } finally {
          pendingEffects.delete(key);
        }
      },
    };
    const input = {
      org_id: 'org-test',
      project_id: 'project-test',
      review_package: reviewPackage(),
      loop_intent_repository: {
        getLoopIntent(id: string) {
          return { id, org_id: 'org-test', project_id: 'project-test' };
        },
      },
      idempotency_key: 'meeting-runtime-test-1',
    };

    const [first, concurrentReplay] = await Promise.all([
      runMeetingAutomationRuntime(input, ports),
      runMeetingAutomationRuntime(input, ports),
    ]);
    expect(new Set([first.status, concurrentReplay.status])).toEqual(new Set(['persisted', 'replayed']));
    const persisted = first.status === 'persisted' ? first : concurrentReplay;
    const replay = first.status === 'replayed' ? first : concurrentReplay;
    expect(persisted.attempts).toBe(2);
    expect(persisted.readback).toEqual(persisted.record);
    expect(persisted.record.state).toBe('waiting_human');
    expect(persisted.record.review_package.task_candidates[0].source).toBe('external_meeting_runtime');
    expect(replay.idempotent).toBe(true);
    expect(replay.record.record_id).toBe(persisted.record.record_id);
    const laterReplay = await runMeetingAutomationRuntime(input, ports);
    expect(laterReplay.status).toBe('replayed');
    expect(laterReplay.record.record_id).toBe(persisted.record.record_id);
    await expect(runMeetingAutomationRuntime({
      ...input,
      review_package: {
        ...input.review_package,
        meeting_note_summary: { title: 'Different input' },
      },
    }, ports)).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(runMeetingAutomationRuntime({
      ...input,
      idempotency_key: 'meeting-runtime-readback-failure',
    }, {
      ...ports,
      prepareWorkflow: undefined,
      bridgeKnowledge: undefined,
      ledger: {
        ...ports.ledger,
        save: async (record: MeetingAutomationRuntimeRecord) => record,
        readback: async () => null,
      },
    })).rejects.toMatchObject({ code: 'readback_mismatch' });
    expect(saveAttempts).toBe(2);
    expect(prepareCalls).toBe(1);
    expect(bridgeCalls).toBe(1);
    expect(events.indexOf('readback')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('readback')).toBeLessThan(events.indexOf('runOnce'));
    expect(events.indexOf('runOnce')).toBeLessThan(events.indexOf('bridge'));
  });

  it('revalidates the resolved owner package before claiming or saving', async () => {
    const loopIntentIds: Record<string, string> = {};
    for (const definition of [...MEETING_REVIEW_OUTPUT_DEFINITIONS, ...MEETING_REVIEW_HUMAN_STEP_DEFINITIONS]) {
      loopIntentIds[definition.loop_intent_key] = `intent-${definition.loop_intent_key}`;
    }
    let claimCalls = 0;
    let saveCalls = 0;
    const input = {
      org_id: 'org-owner-revalidation',
      project_id: 'project-owner-revalidation',
      review_package: {
        meeting_note_summary: { title: 'Owner revalidation' },
        task_candidates: [{ title: 'Prepare proposal' }],
        decision_candidates: [{ title: 'Use the new process' }],
        follow_up_draft: { body: 'Draft only' },
        promotion_candidates: [{ title: 'Candidate' }],
        loop_intent_ids: loopIntentIds,
      },
      loop_intent_repository: {
        getLoopIntent(id: string) {
          return { id, org_id: 'org-owner-revalidation', project_id: 'project-owner-revalidation' };
        },
      },
    };
    const ports = {
      ledger: {
        claimOrReplay: async () => {
          claimCalls += 1;
          throw new Error('claim must not run for an invalid owner result');
        },
        save: async (record: MeetingAutomationRuntimeRecord) => {
          saveCalls += 1;
          return record;
        },
        readback: async () => null,
      },
      resolveTaskOwners: async () => ({ task_candidates: [{ title: 42 }] }),
    };
    await expect(runMeetingAutomationRuntime(input, ports)).rejects.toMatchObject({ code: 'validation_error' });
    expect(claimCalls).toBe(0);
    expect(saveCalls).toBe(0);
  });
});
