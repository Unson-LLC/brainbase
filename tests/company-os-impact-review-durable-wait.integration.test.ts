import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DurableWaitStore } from '../src/durable-waits.js';
import {
  CompanyOsImpactReviewCoordinator,
  createCompanyOsImpactReviewDurableWaitPort,
  createCompanyOsImpactReviewNotificationStore,
  type ImpactReviewChange,
  type ImpactReviewPlan,
  type ImpactReviewReference,
} from '../src/company-os-impact-review.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const access = { principal: 'person-1', scope: { type: 'project', id: 'project-1' } } as const;
const oldProblem = {
  snapshot_id: `sha256:${'b'.repeat(64)}`,
  problem_id: 'problem-1',
  revision: '1',
} as const;
const newProblem = {
  snapshot_id: `sha256:${'c'.repeat(64)}`,
  problem_id: 'problem-2',
  revision: '1',
} as const;

function reference(): ImpactReviewReference {
  return {
    kind: 'model',
    id: 'model-1',
    revision: '2',
    digest: `sha256:${'a'.repeat(64)}`,
    scope: { type: 'project', id: 'project-1' },
  };
}

function change(): ImpactReviewChange {
  return {
    change_id: 'change-1',
    source: 'world_model',
    current: reference(),
    significance: 'material',
    reason: 'The adopted model no longer explains the observed workload.',
  };
}

function plan(): ImpactReviewPlan {
  return {
    plan_id: 'plan-1',
    owner_scope: { type: 'project', id: 'project-1' },
    read_policy: { ownerId: 'person-1', visibility: 'private', readerIds: [], writerIds: [] },
    problem_snapshot: oldProblem,
    run_id: 'run-1',
    execution_state: 'planned',
    authority_state: 'valid',
    constraint_state: 'valid',
    responsible: { principal: 'person-2', scope: 'project-1' },
    due_at: '2026-10-01T00:00:00.000Z',
  };
}

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-impact-review-integration-'));
  dataDirs.push(directory);
  return directory;
}

describe('CompanyOsImpactReviewCoordinator with Story 13 durable waits', () => {
  it('persists a hold and moves the canonical wait to handoff on rejudgment', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const waitStore = new DurableWaitStore({
      dataDir,
      problemSnapshot: {
        verify: async ({ reference: candidate }) =>
          candidate.snapshot_id === oldProblem.snapshot_id || candidate.snapshot_id === newProblem.snapshot_id,
      },
    });
    const waits = createCompanyOsImpactReviewDurableWaitPort(waitStore);
    const current = reference();
    const itemPlan = plan();
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: async () => current },
      index: {
        findAffectedPlans: async () => [{
          plan: itemPlan,
          matches: [{ change_id: 'change-1', relation: 'predicts', domain: 'world_model', evidence: 'model-1 predicts workload-1' }],
        }],
      },
      notifications,
      waits,
      rejudgment: {
        createNewProblemAndRun: async () => ({ problem: newProblem, run_id: 'run-2' }),
      },
    });

    const first = await coordinator.review({ access, changes: [change()] });
    const waitId = first.decisions[0]?.wait_id;
    expect(first.decisions[0]?.disposition).toBe('hold');
    expect(waitId).toMatch(/^impact-review-/u);
    expect(await waitStore.get({ wait_id: waitId!, principal: access.principal })).toMatchObject({
      wait_id: waitId,
      state: 'waiting',
      problem_snapshot: oldProblem,
    });

    const retry = await coordinator.review({ access, changes: [change()] });
    expect(retry.decisions[0]?.wait_id).toBe(waitId);
    expect((await waitStore.list({ principal: access.principal })).filter((wait) => wait.wait_id === waitId)).toHaveLength(1);

    const reassessed = await coordinator.reassess({
      access,
      plan: itemPlan,
      changes: [change()],
      reason: 'The adopted model no longer explains the observed workload.',
      wait_id: waitId,
    });
    expect(reassessed).toEqual({ problem: newProblem, run_id: 'run-2', wait_id: waitId });
    expect(await waitStore.get({ wait_id: waitId!, principal: access.principal })).toMatchObject({
      wait_id: waitId,
      state: 'handoff_required',
      next_problem: newProblem,
    });
    expect(itemPlan.problem_snapshot).toEqual(oldProblem);
  });
});
