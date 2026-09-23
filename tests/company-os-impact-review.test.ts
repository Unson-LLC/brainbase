import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CompanyOsImpactReviewCoordinator,
  CompanyOsImpactReviewError,
  createCompanyOsImpactReviewNotificationStore,
  computeImpactReviewWaitId,
  type ImpactReviewAffectedPlan,
  type ImpactReviewChange,
  type ImpactReviewIndexPort,
  type ImpactReviewPlan,
  type ImpactReviewReference,
  type ImpactReviewWaitPort,
} from '../src/company-os-impact-review.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const access = { principal: 'person-1', scope: { type: 'project', id: 'project-1' } } as const;

function reference(overrides: Partial<ImpactReviewReference> = {}): ImpactReviewReference {
  return {
    kind: 'model',
    id: 'model-1',
    revision: '2',
    digest: `sha256:${'a'.repeat(64)}`,
    scope: { type: 'project', id: 'project-1' },
    ...overrides,
  };
}

function change(overrides: Partial<ImpactReviewChange> = {}): ImpactReviewChange {
  return {
    change_id: 'change-1',
    source: 'world_model',
    current: reference(),
    significance: 'minor',
    reason: 'A supported model revision was adopted.',
    ...overrides,
  };
}

function plan(overrides: Partial<ImpactReviewPlan> = {}): ImpactReviewPlan {
  return {
    plan_id: 'plan-1',
    owner_scope: { type: 'project', id: 'project-1' },
    read_policy: { ownerId: 'person-1', visibility: 'private', readerIds: [], writerIds: [] },
    problem_snapshot: {
      snapshot_id: `sha256:${'b'.repeat(64)}`,
      problem_id: 'problem-1',
      revision: '1',
    },
    run_id: 'run-1',
    execution_state: 'planned',
    authority_state: 'valid',
    constraint_state: 'valid',
    responsible: { principal: 'person-2', scope: 'project-1' },
    due_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function affected(itemPlan: ImpactReviewPlan, itemChange = 'change-1'): ImpactReviewAffectedPlan {
  return {
    plan: itemPlan,
    matches: [{ change_id: itemChange, relation: 'predicts', domain: 'world_model', evidence: 'model-1 predicts workload-1' }],
  };
}

function indexReturning(items: readonly ImpactReviewAffectedPlan[]): ImpactReviewIndexPort {
  return { findAffectedPlans: vi.fn(async () => items) };
}

function waitPort() {
  return {
    create: vi.fn(async () => undefined),
    read: vi.fn(async ({ wait_id }: { readonly wait_id: string }) => {
      if (wait_id !== 'impact-review-wait-1') throw { code: 'not_found' };
      return {
        wait_id,
        owner_scope: plan().owner_scope,
        read_policy: plan().read_policy,
        problem_snapshot: plan().problem_snapshot,
        condition: { expression: 'impact-review:plan-1:a material premise changed; create a new Problem/run after review' },
        deadline: { due_at: plan().due_at },
        responsible: plan().responsible,
        resume_method: 'new_problem',
        failure_policy: 'new_problem',
        run_ref: { run_id: plan().run_id },
        state: 'waiting',
      };
    }),
    markPremiseChanged: vi.fn(async () => undefined),
  } satisfies ImpactReviewWaitPort;
}

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-impact-review-'));
  dataDirs.push(directory);
  return directory;
}

describe('CompanyOsImpactReviewCoordinator', () => {
  it('resolves current references, keeps relation domains explicit, and idempotently records minor continuation', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
    });
    const current = { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) };
    const index = indexReturning([affected(plan())]);
    const coordinator = new CompanyOsImpactReviewCoordinator({ currentReferences: current, index, notifications });

    const first = await coordinator.review({ access, changes: [change()] });
    const second = await coordinator.review({ access, changes: [change()] });

    expect(first.outcome).toBe('affected');
    expect(first.decisions[0]).toMatchObject({ disposition: 'continue', notification: { notification_id: expect.stringMatching(/^sha256:/u) } });
    expect(second.decisions[0]?.notification.notification_id).toBe(first.decisions[0]?.notification.notification_id);
    expect(await notifications.list()).toHaveLength(1);
    expect(current.readCurrent).toHaveBeenCalledTimes(2);
    expect(index.findAffectedPlans).toHaveBeenCalledWith(expect.objectContaining({
      current_references: [reference()],
    }));
  });

  it('holds a material change with a deterministic durable wait and never duplicates it on retry', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const waits = waitPort();
    const itemPlan = plan();
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([affected(itemPlan)]),
      notifications,
      waits,
    });

    const request = { access, changes: [change({ significance: 'material' })] };
    const first = await coordinator.review(request);
    const second = await coordinator.review(request);

    expect(first.decisions[0]).toMatchObject({ disposition: 'hold', wait_id: expect.stringMatching(/^impact-review-/u) });
    expect(second.decisions[0]?.wait_id).toBe(first.decisions[0]?.wait_id);
    expect(waits.create).toHaveBeenCalledTimes(1);
    expect(waits.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      wait_id: computeImpactReviewWaitId('plan-1', ['change-1'], 'a material premise changed; create a new Problem/run after review', [reference()]),
      resume_method: 'new_problem',
      failure_policy: 'new_problem',
      deadline: { due_at: '2026-10-01T00:00:00.000Z' },
    }));
    expect(await notifications.list()).toHaveLength(1);
  });

  it('stops revoked or constraint-violating plans without creating a wait', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const waits = waitPort();
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([
        affected(plan({ plan_id: 'plan-revoked', authority_state: 'revoked' })),
        affected(plan({ plan_id: 'plan-violated', constraint_state: 'violated' })),
      ]),
      notifications,
      waits,
    });

    const result = await coordinator.review({ access, changes: [change()] });

    expect(result.decisions.map((item) => item.disposition)).toEqual(['stop', 'stop']);
    expect(waits.create).not.toHaveBeenCalled();
    expect(result.decisions.map((item) => item.reason)).toEqual([
      'execution authority is revoked; no further execution is permitted',
      'constraint is violated; no further execution is permitted',
    ]);
  });

  it('keeps completed history immutable even when a later premise is material', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const waits = waitPort();
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([affected(plan({ execution_state: 'completed' }))]),
      notifications,
      waits,
    });

    const result = await coordinator.review({ access, changes: [change({ significance: 'material' })] });

    expect(result.decisions[0]).toMatchObject({
      disposition: 'continue',
      reason: 'completed history remains immutable; no pending execution is changed',
    });
    expect(waits.create).not.toHaveBeenCalled();
  });

  it('reports unresolved current references distinctly from no affected plans', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const index = indexReturning([]);
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async () => null) },
      index,
      notifications,
    });

    const result = await coordinator.review({ access, changes: [change()] });

    expect(result.outcome).toBe('unresolved');
    expect(result.unresolved_changes).toHaveLength(1);
    expect(result.decisions).toEqual([]);
    expect(index.findAffectedPlans).not.toHaveBeenCalled();
  });

  it('creates a new Problem/run and links the wait without mutating the old plan', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const waits = waitPort();
    const rejudgment = {
      createNewProblemAndRun: vi.fn(async () => ({
        problem: { snapshot_id: `sha256:${'c'.repeat(64)}`, problem_id: 'problem-2', revision: '1' },
        run_id: 'run-2',
      })),
    };
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([]),
      notifications,
      waits,
      rejudgment,
    });
    const oldPlan = plan();

    const result = await coordinator.reassess({
      access,
      plan: oldPlan,
      changes: [change({ significance: 'material' })],
      reason: 'The adopted model no longer explains the observed workload.',
      wait_id: 'impact-review-wait-1',
    });

    expect(result).toEqual({
      problem: { snapshot_id: `sha256:${'c'.repeat(64)}`, problem_id: 'problem-2', revision: '1' },
      run_id: 'run-2',
      wait_id: 'impact-review-wait-1',
    });
    expect(rejudgment.createNewProblemAndRun).toHaveBeenCalledWith(expect.objectContaining({ plan: oldPlan }));
    expect(rejudgment.createNewProblemAndRun).toHaveBeenCalledWith(expect.objectContaining({ operation_id: expect.stringMatching(/^impact-review-rejudgment-/u) }));
    expect(waits.markPremiseChanged).toHaveBeenCalledWith(expect.objectContaining({
      wait_id: 'impact-review-wait-1',
      new_problem_snapshot: { snapshot_id: `sha256:${'c'.repeat(64)}`, problem_id: 'problem-2', revision: '1' },
    }));
    expect(oldPlan.problem_snapshot.problem_id).toBe('problem-1');
  });

  it('does not rejudge completed history or an unknown external effect', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([]),
      notifications,
      rejudgment: { createNewProblemAndRun: vi.fn() },
    });

    await expect(coordinator.reassess({ access, plan: plan({ execution_state: 'completed' }), changes: [change()], reason: 'reassess' })).rejects.toMatchObject<CompanyOsImpactReviewError>({ code: 'rejudgment_not_allowed' });
    await expect(coordinator.reassess({ access, plan: plan({ execution_state: 'effect_unknown' }), changes: [change()], reason: 'reassess' })).rejects.toMatchObject<CompanyOsImpactReviewError>({ code: 'rejudgment_not_allowed' });
  });
});

describe('impact review contracts', () => {
  it('rejects a world-model relation declared in the execution domain', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([{
        plan: plan(),
        matches: [{ change_id: 'change-1', relation: 'predicts', domain: 'execution', evidence: 'wrong domain' }],
      }]),
      notifications,
    });

    await expect(coordinator.review({ access, changes: [change()] })).rejects.toMatchObject({ code: 'invalid_provider_result' });
  });

  it('rejects an unknown relation domain instead of treating it as unconstrained', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({ dataDir });
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: vi.fn(async (item: ImpactReviewReference) => item) },
      index: indexReturning([{
        plan: plan(),
        matches: [{ change_id: 'change-1', relation: 'predicts', domain: 'unknown' as never, evidence: 'wrong domain' }],
      }]),
      notifications,
    });

    await expect(coordinator.review({ access, changes: [change()] })).rejects.toMatchObject({ code: 'invalid_provider_result' });
  });
});
