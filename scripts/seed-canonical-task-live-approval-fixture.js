#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemoryWorkflowRepository,
  JsonFileWorkflowRepository,
} from '../server/services/workflow/workflow-repository.js';
import { createCanonicalTaskStoreConfig } from '../server/services/companion/canonical-task-store-config.js';

export const CANONICAL_TASK_LIVE_APPROVAL_FIXTURE = Object.freeze({
  workflowId: 'wf-live-task-review',
  runId: 'run-live-task-review',
  outputId: 'out-live-task-review',
  stepId: 'human-live-task-review',
  meetingNoteId: 'meeting-note-live-task-review',
});

export function seedCanonicalTaskLiveApprovalFixture({
  repository = new InMemoryWorkflowRepository(),
  ownerPersonId,
} = {}) {
  if (!ownerPersonId) throw new Error('ownerPersonId is required');
  const fixture = CANONICAL_TASK_LIVE_APPROVAL_FIXTURE;
  const existingStep = repository.getHumanStep(fixture.stepId);
  if (existingStep && existingStep.status !== 'pending') {
    throw new Error('Canonical Task live approval fixture was already consumed');
  }

  repository.upsertWorkflow({
    id: fixture.workflowId,
    workspace_id: 'default',
    project_id: 'brainbase',
    name: 'Canonical Task live contract review',
    owner_id: ownerPersonId,
    implementation_key: 'manual-placeholder',
  });

  const existingRun = repository.getRun(fixture.runId);
  if (existingRun) {
    repository.updateRun(fixture.runId, {
      status: 'waiting_human',
      closure_state: 'open',
      human_waiting: true,
      action_required: 'approve',
    });
  } else {
    repository.createRun({
      id: fixture.runId,
      workspace_id: 'default',
      project_id: 'brainbase',
      workflow_id: fixture.workflowId,
      status: 'waiting_human',
      closure_state: 'open',
      human_waiting: true,
      action_required: 'approve',
    });
  }

  const output = {
    workspace_id: 'default',
    project_id: 'brainbase',
    workflow_id: fixture.workflowId,
    workflow_run_id: fixture.runId,
    type: 'task_candidates',
    metadata: { write_back_target: 'task_store' },
    payload: [{
      id: 'candidate-live-task-review',
      title: '承認から作る正本Task',
      selected_owner_id: ownerPersonId,
      evidence_refs: [{
        type: 'meeting_note',
        id: fixture.meetingNoteId,
        url: `https://brainbase.local/meeting-notes/${fixture.meetingNoteId}`,
      }],
    }],
  };
  if (repository.getOutput(fixture.outputId)) {
    repository.updateOutput(fixture.outputId, output);
  } else {
    repository.createOutput({ id: fixture.outputId, ...output });
  }

  const step = {
    workspace_id: 'default',
    project_id: 'brainbase',
    workflow_id: fixture.workflowId,
    workflow_run_id: fixture.runId,
    requested_by: 'system',
    requested_to: ownerPersonId,
    status: 'pending',
    metadata: {
      write_back_target: 'task_store',
      output_id: fixture.outputId,
    },
  };
  if (existingStep) {
    repository.updateHumanStep(fixture.stepId, step);
  } else {
    repository.createHumanStep({ id: fixture.stepId, ...step });
  }

  return { ...fixture };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--ledger') parsed.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parsed.ledgerPath) throw new Error('--ledger is required');
  return parsed;
}

async function main() {
  try {
    if (process.env.BRAINBASE_CANONICAL_TASK_LIVE_FIXTURE !== '1') {
      throw new Error('BRAINBASE_CANONICAL_TASK_LIVE_FIXTURE=1 is required');
    }
    if (process.env.BRAINBASE_TEST_MODE !== 'true' && process.env.TEST_MODE !== 'true') {
      throw new Error('BRAINBASE_TEST_MODE=true or TEST_MODE=true is required');
    }
    const args = parseArgs(process.argv.slice(2));
    const repository = new JsonFileWorkflowRepository({
      filePath: path.resolve(args.ledgerPath),
    });
    const { ownerPersonId } = createCanonicalTaskStoreConfig();
    const fixture = seedCanonicalTaskLiveApprovalFixture({
      repository,
      ownerPersonId,
    });
    process.stdout.write(`${JSON.stringify({ pass: true, fixture })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ pass: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
