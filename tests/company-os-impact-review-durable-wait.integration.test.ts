import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableWaitStore } from '../src/durable-waits.js';
import {
  CompanyOsImpactReviewCoordinator,
  CompanyOsImpactReviewError,
  createCompanyOsImpactReviewDurableWaitPort,
  createCompanyOsImpactReviewNotificationStore,
  type ImpactReviewNotificationStore,
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
    significance: 'material',
    reason: 'The adopted model no longer explains the observed workload.',
    ...overrides,
  };
}

function plan(overrides: Partial<ImpactReviewPlan> = {}): ImpactReviewPlan {
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
    ...overrides,
  };
}

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-impact-review-integration-'));
  dataDirs.push(directory);
  return directory;
}

function createWaitStore(dataDir: string): DurableWaitStore {
  return new DurableWaitStore({
    dataDir,
    clock: () => new Date('2026-09-23T00:00:00.000Z'),
    problemSnapshot: {
      verify: async ({ reference: candidate }) =>
        candidate.snapshot_id === oldProblem.snapshot_id || candidate.snapshot_id === newProblem.snapshot_id,
    },
  });
}

function createCoordinator(options: {
  readonly dataDir: string;
  readonly itemPlan?: ImpactReviewPlan;
  readonly current?: ImpactReviewReference;
  readonly notifications?: ImpactReviewNotificationStore;
  readonly waits?: ReturnType<typeof createCompanyOsImpactReviewDurableWaitPort>;
  readonly rejudgment?: { createNewProblemAndRun: (...args: never[]) => Promise<{ problem: typeof newProblem; run_id: string }> };
}): { readonly coordinator: CompanyOsImpactReviewCoordinator; readonly waitStore: DurableWaitStore } {
  const waitStore = createWaitStore(options.dataDir);
  const notifications = options.notifications ?? createCompanyOsImpactReviewNotificationStore({
    dataDir: options.dataDir,
    clock: () => new Date('2026-09-23T00:00:00.000Z'),
  });
  const waits = options.waits ?? createCompanyOsImpactReviewDurableWaitPort(waitStore);
  const itemPlan = options.itemPlan ?? plan();
  const current = options.current ?? reference();
  return {
    waitStore,
    coordinator: new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: async () => current },
      index: {
        findAffectedPlans: async () => [{
          plan: itemPlan,
          matches: [{ change_id: 'change-1', relation: 'predicts', domain: 'world_model', evidence: 'model-1 predicts workload-1' }],
        }],
      },
      notifications,
      waits,
      rejudgment: options.rejudgment,
    }),
  };
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

  it('rejects duplicate change ids before material significance can be overwritten by a later minor change', async () => {
    const dataDir = await makeDataDir();
    const { coordinator, waitStore } = createCoordinator({ dataDir });

    await expect(coordinator.review({
      access,
      changes: [change({ significance: 'material' }), change({ significance: 'minor' })],
    })).rejects.toMatchObject<CompanyOsImpactReviewError>({ code: 'invalid_request' });
    expect(await waitStore.list({ principal: access.principal })).toHaveLength(0);
  });

  it('holds an unknown external effect for reconciliation even when authority is revoked', async () => {
    const dataDir = await makeDataDir();
    const itemPlan = plan({ execution_state: 'effect_unknown', authority_state: 'revoked' });
    const { coordinator, waitStore } = createCoordinator({ dataDir, itemPlan });

    const result = await coordinator.review({ access, changes: [change()] });
    const waitId = result.decisions[0]?.wait_id;
    expect(result.decisions[0]).toMatchObject({ disposition: 'hold' });
    expect(await waitStore.get({ wait_id: waitId!, principal: access.principal })).toMatchObject({
      state: 'waiting',
      resume_method: 'reconcile_external_effect',
      failure_policy: 'reconciliation_wait',
    });
  });

  it('uses an event condition when a held plan has no due_at deadline', async () => {
    const dataDir = await makeDataDir();
    const { coordinator, waitStore } = createCoordinator({ dataDir, itemPlan: plan({ due_at: undefined }) });

    const result = await coordinator.review({ access, changes: [change()] });
    const wait = await waitStore.get({ wait_id: result.decisions[0]?.wait_id!, principal: access.principal });
    expect(wait.condition).toMatchObject({ event: { event_type: 'impact_review', event_id: wait.wait_id } });
    expect(wait.deadline).toBeUndefined();
  });

  it('reads and reuses a canonical wait when notification persistence fails after wait creation', async () => {
    const dataDir = await makeDataDir();
    const canonicalNotifications = createCompanyOsImpactReviewNotificationStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
    });
    let failOnce = true;
    const notifications: ImpactReviewNotificationStore = {
      read: () => canonicalNotifications.read(),
      list: () => canonicalNotifications.list(),
      record: async (input) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('injected notification failure');
        }
        return canonicalNotifications.record(input);
      },
    };
    const waitStore = createWaitStore(dataDir);
    const waits = createCompanyOsImpactReviewDurableWaitPort(waitStore);
    const createSpy = vi.spyOn(waitStore, 'create');
    const { coordinator } = createCoordinator({ dataDir, notifications, waits });

    await expect(coordinator.review({ access, changes: [change()] })).rejects.toThrow('injected notification failure');
    const retry = await coordinator.review({ access, changes: [change()] });
    expect(retry.decisions[0]?.disposition).toBe('hold');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(await waitStore.list({ principal: access.principal })).toHaveLength(1);
    expect(await canonicalNotifications.list()).toHaveLength(1);
  });

  it('binds the wait id to canonical reference revision and digest', async () => {
    const dataDir = await makeDataDir();
    const first = createCoordinator({ dataDir, current: reference({ revision: '2' }) });
    const firstResult = await first.coordinator.review({ access, changes: [change()] });
    const second = createCoordinator({ dataDir, current: reference({ revision: '3', digest: `sha256:${'d'.repeat(64)}` }) });
    const secondResult = await second.coordinator.review({ access, changes: [change({ current: reference({ revision: '3', digest: `sha256:${'d'.repeat(64)}` }) })] });

    expect(firstResult.decisions[0]?.wait_id).toBeDefined();
    expect(secondResult.decisions[0]?.wait_id).toBeDefined();
    expect(secondResult.decisions[0]?.wait_id).not.toBe(firstResult.decisions[0]?.wait_id);
    expect(await first.waitStore.list({ principal: access.principal })).toHaveLength(2);
  });

  it('validates current ACL and wait plan/run/snapshot before creating a new Problem/run', async () => {
    const dataDir = await makeDataDir();
    const itemPlan = plan();
    const rejudgment = { createNewProblemAndRun: vi.fn(async () => ({ problem: newProblem, run_id: 'run-2' })) };
    const { coordinator } = createCoordinator({ dataDir, itemPlan, rejudgment });
    const first = await coordinator.review({ access, changes: [change()] });
    const waitId = first.decisions[0]?.wait_id!;

    await expect(coordinator.reassess({
      access: { principal: 'person-2', scope: access.scope },
      plan: itemPlan,
      changes: [change()],
      reason: 'reassess after review',
      wait_id: waitId,
    })).rejects.toMatchObject({ name: 'DurableWaitError', code: 'unauthorized' });
    await expect(coordinator.reassess({
      access,
      plan: { ...itemPlan, run_id: 'run-other' },
      changes: [change()],
      reason: 'reassess after review',
      wait_id: waitId,
    })).rejects.toMatchObject<CompanyOsImpactReviewError>({ code: 'wait_conflict' });
    expect(rejudgment.createNewProblemAndRun).not.toHaveBeenCalled();
  });

  it('passes the same operation id when Problem/run creation is retried', async () => {
    const dataDir = await makeDataDir();
    let attempts = 0;
    const rejudgment = {
      createNewProblemAndRun: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient rejudgment failure');
        return { problem: newProblem, run_id: 'run-2' };
      }),
    };
    const { coordinator } = createCoordinator({ dataDir, rejudgment });
    const first = await coordinator.review({ access, changes: [change()] });
    const waitId = first.decisions[0]?.wait_id!;
    const request = { access, plan: plan(), changes: [change()], reason: 'reassess after review', wait_id: waitId };

    await expect(coordinator.reassess(request)).rejects.toThrow('transient rejudgment failure');
    await coordinator.reassess(request);
    expect(rejudgment.createNewProblemAndRun).toHaveBeenCalledTimes(2);
    expect(rejudgment.createNewProblemAndRun.mock.calls[0]?.[0].operation_id).toBe(rejudgment.createNewProblemAndRun.mock.calls[1]?.[0].operation_id);
  });

  it('rejects notification created_at tampering through the immutable record digest', async () => {
    const dataDir = await makeDataDir();
    const notifications = createCompanyOsImpactReviewNotificationStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
    });
    const { coordinator } = createCoordinator({ dataDir, notifications });
    await coordinator.review({ access, changes: [change()] });
    const sidecarPath = join(dataDir, 'impact-review/notifications.json');
    const ledger = JSON.parse(await readFile(sidecarPath, 'utf8')) as { notifications: Array<{ created_at: string }> };
    ledger.notifications[0]!.created_at = '2026-09-24T00:00:00.000Z';
    await writeFile(sidecarPath, `${JSON.stringify(ledger)}\n`, 'utf8');

    await expect(notifications.list()).rejects.toMatchObject<CompanyOsImpactReviewError>({ code: 'corrupt_sidecar' });
  });
});
