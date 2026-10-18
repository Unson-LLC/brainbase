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
    let saveAttempts = 0;
    const ports = {
      ledger: {
        findByIdempotencyKey: async (key: string) => [...records.values()].find((record) => record.idempotency_key === key) ?? null,
        save: async (record: MeetingAutomationRuntimeRecord) => {
          saveAttempts += 1;
          if (saveAttempts === 1) throw Object.assign(new Error('temporary ledger failure'), { retryable: true });
          records.set(record.record_id, record);
          return record;
        },
        readback: async (recordId: string) => records.get(recordId) ?? null,
      },
      is_retryable: (error: unknown) => Boolean((error as { retryable?: boolean }).retryable),
      now: () => new Date('2026-10-18T00:00:00.000Z'),
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

    const first = await runMeetingAutomationRuntime(input, ports);
    expect(first.status).toBe('persisted');
    expect(first.attempts).toBe(2);
    expect(first.readback).toEqual(first.record);
    expect(first.record.state).toBe('waiting_human');
    expect(first.record.review_package.task_candidates[0].source).toBe('external_meeting_runtime');

    const replay = await runMeetingAutomationRuntime(input, ports);
    expect(replay.status).toBe('replayed');
    expect(replay.idempotent).toBe(true);
    expect(replay.record.record_id).toBe(first.record.record_id);
    expect(saveAttempts).toBe(2);
  });
});
