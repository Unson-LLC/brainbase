import { describe, expect, it } from 'vitest';

import {
  CANONICAL_TASK_LIVE_APPROVAL_FIXTURE,
  seedCanonicalTaskLiveApprovalFixture,
} from '../../../scripts/seed-canonical-task-live-approval-fixture.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

describe('seedCanonicalTaskLiveApprovalFixture', () => {
  it('creates the fixed approval contract records idempotently', () => {
    const repository = new InMemoryWorkflowRepository();

    const first = seedCanonicalTaskLiveApprovalFixture({ repository, ownerPersonId: 'per_owner' });
    const second = seedCanonicalTaskLiveApprovalFixture({ repository, ownerPersonId: 'per_owner' });

    expect(first).toEqual(CANONICAL_TASK_LIVE_APPROVAL_FIXTURE);
    expect(second).toEqual(first);
    expect(repository.listRuns({ workflowId: first.workflowId, limit: null })).toHaveLength(1);
    expect(repository.listOutputs(first.runId)).toHaveLength(1);
    expect(repository.getOutput(first.outputId).payload[0].evidence_refs).toEqual([{
      type: 'meeting_note',
      id: first.meetingNoteId,
      url: `https://brainbase.local/meeting-notes/${first.meetingNoteId}`,
    }]);
    expect(repository.listHumanSteps(first.runId)).toHaveLength(1);
    expect(repository.getHumanStep(first.stepId)).toMatchObject({
      status: 'pending',
      requested_to: 'per_owner',
      metadata: { write_back_target: 'task_store', output_id: first.outputId },
    });
  });

  it('refuses to silently reopen a fixture that was already consumed', () => {
    const repository = new InMemoryWorkflowRepository();
    const fixture = seedCanonicalTaskLiveApprovalFixture({ repository, ownerPersonId: 'per_owner' });
    repository.updateHumanStep(fixture.stepId, { status: 'approved' });
    repository.updateRun(fixture.runId, {
      status: 'completed',
      closure_state: 'closed',
      human_waiting: false,
      action_required: null,
    });

    expect(() => seedCanonicalTaskLiveApprovalFixture({ repository, ownerPersonId: 'per_owner' }))
      .toThrow('Canonical Task live approval fixture was already consumed');
    expect(repository.getRun(fixture.runId)).toMatchObject({
      status: 'completed',
      closure_state: 'closed',
      human_waiting: false,
      action_required: null,
    });
  });
});
