import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DURABLE_WAIT_TRANSITIONS,
  DurableWaitError,
  DurableWaitStore,
  transitionWait,
  type DurableWaitExternalEffectOutcome,
  type DurableWaitHistoryAction,
  type DurableWaitRecord,
  type DurableWaitState
} from '../src/durable-waits.js';

const roots: string[] = [];
const snapshotId = `sha256:${'a'.repeat(64)}`;
const nextSnapshotId = `sha256:${'b'.repeat(64)}`;
const ACTIONS: readonly DurableWaitHistoryAction[] = [
  'create', 'claim', 'handoff', 'resume', 'premise_changed', 'effect_unknown', 'effect_reconciled'
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Harness {
  readonly root: string;
  readonly store: DurableWaitStore;
  readonly advance: (milliseconds: number) => void;
  readonly setOutcome: (outcome: DurableWaitExternalEffectOutcome) => void;
}

async function makeHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-wait-transitions-'));
  roots.push(root);
  let current = Date.parse('2026-09-23T00:00:00.000Z');
  let outcome: DurableWaitExternalEffectOutcome = 'unknown';
  const store = new DurableWaitStore({
    dataDir: root,
    problemSnapshot: { verify: () => true },
    access: { authorize: () => true },
    clock: () => new Date(current),
    defaultLeaseMs: 100,
    unknownEffect: {
      verify: ({ wait, claim_id, external_operation_id }) => ({
        wait_id: wait.wait_id, claim_id, run_id: wait.run_ref.run_id, external_operation_id, status: 'unknown' as const
      })
    },
    externalEffect: {
      verify: (input) => ({
        wait_id: input.wait.wait_id, claim_id: input.claim_id, external_operation_id: input.external_operation_id,
        evidence_ref: input.evidence_ref, outcome
      })
    }
  });
  return {
    root,
    store,
    advance: (milliseconds) => { current += milliseconds; },
    setOutcome: (next) => { outcome = next; }
  };
}

async function create(store: DurableWaitStore): Promise<DurableWaitRecord> {
  return store.create({
    wait_id: 'wait-1',
    tenant_id: 'tenant-a',
    principal: 'owner',
    owner_scope: { type: 'organization', id: 'org-1' },
    read_policy: { ownerId: 'owner', visibility: 'private', readerIds: [], writerIds: [] },
    problem_snapshot: { snapshot_id: snapshotId, problem_id: 'problem-1', revision: '1' },
    condition: { event: { event_type: 'evidence.received', event_id: 'event-1' } },
    responsible: { principal: 'owner', scope: 'org-1' },
    resume_method: 'resume_run',
    failure_policy: 'handoff',
    run_ref: { run_id: 'run-1', node_id: 'wait-node' }
  });
}

function claim(store: DurableWaitStore, requestId: string) {
  return store.claim({
    wait_id: 'wait-1', principal: 'owner', request_id: requestId, trigger: 'event',
    event_type: 'evidence.received', event_id: 'event-1'
  });
}

function premiseChanged(store: DurableWaitStore): Promise<DurableWaitRecord> {
  return store.markPremiseChanged({
    wait_id: 'wait-1', principal: 'owner', reason: 'objective revision changed',
    new_problem_snapshot: { snapshot_id: nextSnapshotId, problem_id: 'problem-1', revision: '2' }
  });
}

function effectUnknown(store: DurableWaitStore, externalOperationId?: string): Promise<DurableWaitRecord> {
  return store.markEffectUnknown({
    wait_id: 'wait-1', principal: 'owner', reason: 'response lost',
    ...(externalOperationId === undefined ? {} : { external_operation_id: externalOperationId })
  });
}

function reconcile(store: DurableWaitStore, requestId: string, externalOperationId: string): Promise<DurableWaitRecord> {
  return store.reconcileExternalEffect({
    wait_id: 'wait-1', principal: 'owner', request_id: requestId,
    external_operation_id: externalOperationId, evidence_ref: `evidence-${requestId}`
  });
}

function steps(record: DurableWaitRecord): string[] {
  return record.history.map((entry) => `${entry.action}:${entry.from_state ?? '-'}>${entry.to_state}`);
}

function tableSteps(): string[] {
  return ACTIONS.flatMap((action) => {
    const rule = DURABLE_WAIT_TRANSITIONS[action];
    const from: readonly (DurableWaitState | '-')[] = rule.from.length === 0 ? ['-'] : rule.from;
    return from.flatMap((source) => rule.to.map((target) => `${action}:${source}>${target}`));
  });
}

describe('durable wait transition table', () => {
  it('lists every history action once and cannot be changed at run time', () => {
    expect(Object.keys(DURABLE_WAIT_TRANSITIONS).sort()).toEqual([...ACTIONS].sort());
    expect(Object.isFrozen(DURABLE_WAIT_TRANSITIONS)).toBe(true);
    for (const action of ACTIONS) {
      expect(Object.isFrozen(DURABLE_WAIT_TRANSITIONS[action])).toBe(true);
      expect(Object.isFrozen(DURABLE_WAIT_TRANSITIONS[action].from)).toBe(true);
      expect(Object.isFrozen(DURABLE_WAIT_TRANSITIONS[action].to)).toBe(true);
    }
  });

  it('has no way out of a finished wait and no operation that fails or cancels one', () => {
    const sources = new Set(ACTIONS.flatMap((action) => DURABLE_WAIT_TRANSITIONS[action].from));
    const targets = new Set(ACTIONS.flatMap((action) => DURABLE_WAIT_TRANSITIONS[action].to));
    for (const finished of ['resumed', 'effect_confirmed', 'failed', 'cancelled'] as const) {
      expect(sources.has(finished)).toBe(false);
    }
    expect(targets.has('failed')).toBe(false);
    expect(targets.has('cancelled')).toBe(false);
  });

  it('rejects a write the table does not list before anything is stored', async () => {
    const { store } = await makeHarness();
    const waiting = await create(store);
    const step = { at: '2026-09-23T00:00:01.000Z', principal: 'owner' };
    const outsideSource = () => transitionWait(waiting, { ...step, action: 'resume', to: 'resumed' });
    const outsideTarget = () => transitionWait(waiting, { ...step, action: 'claim', to: 'resumed' });
    expect(outsideSource).toThrow(DurableWaitError);
    expect(outsideSource).toThrow(expect.objectContaining({ code: 'state_conflict', wait_id: 'wait-1' }));
    expect(outsideTarget).toThrow(expect.objectContaining({ code: 'state_conflict', wait_id: 'wait-1' }));
    await expect(store.get({ wait_id: 'wait-1', principal: 'owner' })).resolves.toMatchObject({ state: 'waiting' });
  });

  it('writes state, time and history from one step', async () => {
    const { store } = await makeHarness();
    const waiting = await create(store);
    const moved = transitionWait(
      waiting,
      { action: 'premise_changed', to: 'handoff_required', at: '2026-09-23T00:00:01.000Z', principal: 'owner', detail: 'why' },
      { next_problem: { snapshot_id: nextSnapshotId, problem_id: 'problem-1', revision: '2' } }
    );
    expect(moved.state).toBe('handoff_required');
    expect(moved.updated_at).toBe('2026-09-23T00:00:01.000Z');
    expect(moved.next_problem?.revision).toBe('2');
    expect(moved.history.at(-1)).toEqual({
      action: 'premise_changed', occurred_at: '2026-09-23T00:00:01.000Z', principal: 'owner',
      from_state: 'waiting', to_state: 'handoff_required', detail: 'why'
    });
    expect(waiting.state).toBe('waiting');
    expect(waiting.history).toHaveLength(1);
  });

  it('matches what the store operations really write, in both directions', async () => {
    const seen = new Set<string>();
    const record = (wait: DurableWaitRecord) => { for (const step of steps(wait)) seen.add(step); };

    // create, claim, resume
    const resumed = await makeHarness();
    await create(resumed.store);
    const won = await claim(resumed.store, 'claim-1');
    await resumed.store.resume({
      wait_id: 'wait-1', principal: 'owner', request_id: 'claim-1', claim_id: won.claim.claim_id,
      lease_id: won.claim.lease.lease_id, lease_token: won.claim.lease.token
    });
    record(await resumed.store.get({ wait_id: 'wait-1', principal: 'owner' }));

    // an expired lease is handed off, the premise changes twice, then the effect is unknown
    const handed = await makeHarness();
    await create(handed.store);
    await claim(handed.store, 'claim-1');
    handed.advance(101);
    await handed.store.handoff({ wait_id: 'wait-1', principal: 'owner', request_id: 'handoff-1', responsible: { principal: 'owner' } });
    await premiseChanged(handed.store);
    await premiseChanged(handed.store);
    record(await effectUnknown(handed.store, 'effect-1'));

    // the premise changes before anyone claims
    const early = await makeHarness();
    await create(early.store);
    record(await premiseChanged(early.store));

    // an unbound unknown effect, reported twice
    const unbound = await makeHarness();
    await create(unbound.store);
    await effectUnknown(unbound.store);
    record(await effectUnknown(unbound.store));

    // a bound unknown effect is still unknown, then proven not performed, then performed
    const bound = await makeHarness();
    await create(bound.store);
    await claim(bound.store, 'claim-1');
    await effectUnknown(bound.store, 'effect-1');
    await reconcile(bound.store, 'check-1', 'effect-1');
    bound.setOutcome('not_performed');
    await reconcile(bound.store, 'check-2', 'effect-1');
    await claim(bound.store, 'claim-2');
    await effectUnknown(bound.store, 'effect-2');
    bound.setOutcome('performed');
    record(await reconcile(bound.store, 'check-3', 'effect-2'));

    // a hand-edited ledger: claimed without a claim can still be claimed
    const edited = await makeHarness();
    await create(edited.store);
    const path = join(edited.root, 'durable-waits/ledger.json');
    const ledger = JSON.parse(await readFile(path, 'utf8')) as { waits: Array<{ state: string }> };
    ledger.waits[0].state = 'claimed';
    await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
    record((await claim(edited.store, 'claim-1')).wait);

    expect([...seen].sort()).toEqual(tableSteps().sort());
  });
});
