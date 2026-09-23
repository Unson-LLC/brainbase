import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DurableWaitError,
  DurableWaitStore,
  type DurableWaitProblemSnapshotPort,
  type DurableWaitRecord
} from '../src/durable-waits.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import type { VariableDefinition } from '../src/ontology-foundation.js';
import { initializePersonalOs, mutatePersonalOs } from '../src/ssot.js';

const roots: string[] = [];
const snapshotId = `sha256:${'a'.repeat(64)}`;
const nextSnapshotId = `sha256:${'b'.repeat(64)}`;

const problemSnapshot: DurableWaitProblemSnapshotPort = {
  verify: () => true
};

function nowClock(initial = '2026-09-23T00:00:00.000Z'): { now: () => Date; advance: (milliseconds: number) => void } {
  let current = Date.parse(initial);
  return {
    now: () => new Date(current),
    advance: (milliseconds) => { current += milliseconds; }
  };
}

async function makeStore(clock = nowClock()): Promise<{ root: string; store: DurableWaitStore; clock: ReturnType<typeof nowClock> }> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-waits-'));
  roots.push(root);
  return {
    root,
    store: new DurableWaitStore({ dataDir: root, problemSnapshot, clock: clock.now, defaultLeaseMs: 100 }),
    clock
  };
}

function createInput(overrides: Partial<Parameters<DurableWaitStore['create']>[0]> = {}): Parameters<DurableWaitStore['create']>[0] {
  return {
    wait_id: 'wait-1',
    principal: 'owner',
    owner_scope: { type: 'organization', id: 'org-1' },
    read_policy: { ownerId: 'owner', visibility: 'private', readerIds: ['reader', 'worker-1', 'worker-2', 'planner-2'], writerIds: [] },
    problem_snapshot: { snapshot_id: snapshotId, problem_id: 'problem-1', revision: '1' },
    condition: { event: { event_type: 'evidence.received', event_id: 'event-1' } },
    deadline: { due_at: '2026-09-23T00:00:10.000Z', review_interval_ms: 50 },
    responsible: { principal: 'worker-1', scope: 'org-1' },
    resume_method: 'resume_run',
    failure_policy: 'handoff',
    run_ref: { run_id: 'run-1', node_id: 'wait-node' },
    ...overrides
  };
}

async function createWait(store: DurableWaitStore, overrides: Partial<Parameters<DurableWaitStore['create']>[0]> = {}): Promise<DurableWaitRecord> {
  return store.create(createInput(overrides));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DurableWaitStore', () => {
  it('persists the wait contract in the Personal OS sidecar and reads it after restart', async () => {
    const { root, store } = await makeStore();
    const created = await createWait(store);
    expect(created.state).toBe('waiting');
    expect(created.problem_snapshot).toEqual({ snapshot_id: snapshotId, problem_id: 'problem-1', revision: '1' });
    expect(created.condition.event?.event_type).toBe('evidence.received');
    expect(created.deadline?.review_interval_ms).toBe(50);

    const restarted = new DurableWaitStore({ dataDir: root, problemSnapshot });
    await expect(restarted.get({ wait_id: created.wait_id, principal: 'owner' })).resolves.toMatchObject({
      wait_id: created.wait_id,
      run_ref: { run_id: 'run-1' },
      responsible: { principal: 'worker-1' }
    });
    const sidecar = await readFile(join(root, 'durable-waits/ledger.json'), 'utf8');
    expect(sidecar).toContain('durable-wait.v1');
  });

  it('atomically deduplicates event and timer claims for one wait', async () => {
    const { store, clock } = await makeStore();
    await createWait(store);
    clock.advance(10_000);

    const eventClaim = await store.claim({
      wait_id: 'wait-1', principal: 'worker-1', trigger: 'event',
      request_id: 'request-event-1', event_type: 'evidence.received', event_id: 'event-1', lease_ms: 100
    });
    const timerClaim = await store.claim({ wait_id: 'wait-1', principal: 'worker-2', trigger: 'timer', request_id: 'request-timer-1', lease_ms: 100 });
    expect(eventClaim.duplicate).toBe(false);
    expect(eventClaim.claimed_by_this_request).toBe(true);
    expect(timerClaim.duplicate).toBe(true);
    expect(timerClaim.claimed_by_this_request).toBe(false);
    expect(timerClaim.claim.claim_id).toBe(eventClaim.claim.claim_id);
    expect(timerClaim.wait.history.filter((entry) => entry.action === 'claim')).toHaveLength(1);
    const retryClaim = await store.claim({
      wait_id: 'wait-1', principal: 'worker-1', trigger: 'event', request_id: 'request-event-1',
      event_type: 'evidence.received', event_id: 'event-1', lease_ms: 100
    });
    expect(retryClaim.duplicate).toBe(true);
    expect(retryClaim.claimed_by_this_request).toBe(true);
  });

  it('binds the winning request to the lease so a losing worker cannot resume', async () => {
    const { root, clock } = await makeStore();
    await createWait(new DurableWaitStore({ dataDir: root, problemSnapshot, clock: clock.now, defaultLeaseMs: 100 }));
    clock.advance(10_000);
    const left = new DurableWaitStore({ dataDir: root, problemSnapshot, clock: clock.now, defaultLeaseMs: 100 });
    const right = new DurableWaitStore({ dataDir: root, problemSnapshot, clock: clock.now, defaultLeaseMs: 100 });
    const attempts = [
      { store: left, principal: 'worker-1', request_id: 'parallel-request-1', trigger: 'event' as const, event_type: 'evidence.received', event_id: 'event-1' },
      { store: right, principal: 'worker-2', request_id: 'parallel-request-2', trigger: 'timer' as const }
    ];
    const results = await Promise.all(attempts.map(({ store, ...input }) => store.claim({ wait_id: 'wait-1', ...input, lease_ms: 100 })));
    expect(results.filter((result) => result.claimed_by_this_request)).toHaveLength(1);
    expect(results.filter((result) => !result.claimed_by_this_request)).toHaveLength(1);
    const winnerIndex = results.findIndex((result) => result.claimed_by_this_request);
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = results[winnerIndex];
    const loser = results[loserIndex];
    const winnerInput = attempts[winnerIndex];
    const loserInput = attempts[loserIndex];

    await expect((loserIndex === 0 ? left : right).resume({
      wait_id: 'wait-1',
      // Even a copied owner/token cannot substitute the losing request id.
      principal: winner.claim.claimed_by,
      request_id: loserInput.request_id,
      claim_id: winner.claim.claim_id,
      lease_id: winner.claim.lease.lease_id,
      lease_token: winner.claim.lease.token
    })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect((loserIndex === 0 ? left : right).resume({
      wait_id: 'wait-1',
      principal: loserInput.principal,
      request_id: loserInput.request_id,
      claim_id: loser.claim.claim_id,
      lease_id: loser.claim.lease.lease_id,
      lease_token: loser.claim.lease.token
    })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect((winnerIndex === 0 ? left : right).resume({
      wait_id: 'wait-1',
      principal: winnerInput.principal,
      request_id: winnerInput.request_id,
      claim_id: winner.claim.claim_id,
      lease_id: winner.claim.lease.lease_id,
      lease_token: winner.claim.lease.token
    })).resolves.toMatchObject({ claim_id: winner.claim.claim_id });
  });

  it('hands off an expired lease and accepts one idempotent resume receipt', async () => {
    const { store, clock } = await makeStore();
    await createWait(store);
    const first = await store.claim({ wait_id: 'wait-1', principal: 'worker-1', trigger: 'event', request_id: 'request-worker-1', event_type: 'evidence.received', event_id: 'event-1', lease_ms: 100 });
    clock.advance(101);
    await expect(store.claim({ wait_id: 'wait-1', principal: 'worker-2', trigger: 'event', request_id: 'request-worker-2', event_type: 'evidence.received', event_id: 'event-1' })).rejects.toMatchObject({ code: 'lease_expired' });

    const handedOff = await store.handoff({ wait_id: 'wait-1', principal: 'owner', request_id: 'request-handoff-2', responsible: { principal: 'worker-2' }, lease_ms: 100, reason: 'worker-1 stopped' });
    expect(handedOff.claim?.lease.lease_id).not.toBe(first.claim.lease.lease_id);
    expect(handedOff.responsible.principal).toBe('worker-2');
    await expect(store.resume({ wait_id: 'wait-1', principal: 'worker-1', request_id: 'request-worker-1', claim_id: first.claim.claim_id, lease_id: first.claim.lease.lease_id, lease_token: first.claim.lease.token })).rejects.toMatchObject({ code: 'unauthorized' });

    const receiptInput = {
      wait_id: 'wait-1', principal: 'worker-2', request_id: 'request-handoff-2', claim_id: handedOff.claim!.claim_id,
      lease_id: handedOff.claim!.lease.lease_id, lease_token: handedOff.claim!.lease.token
    };
    const receipt = await store.resume(receiptInput);
    await expect(store.resume(receiptInput)).resolves.toEqual(receipt);
    await expect(store.get({ wait_id: 'wait-1', principal: 'owner' })).resolves.toMatchObject({ state: 'resumed', resume_receipt: receipt });
  });

  it('records premise changes as a new Problem and blocks resume until handoff', async () => {
    const { store } = await makeStore();
    await createWait(store);
    const changed = await store.markPremiseChanged({
      wait_id: 'wait-1', principal: 'owner', reason: 'objective revision changed',
      new_problem_snapshot: { snapshot_id: nextSnapshotId, problem_id: 'problem-1', revision: '2' },
      responsible: { principal: 'planner-2' }
    });
    expect(changed.state).toBe('handoff_required');
    expect(changed.problem_snapshot.revision).toBe('1');
    expect(changed.next_problem?.revision).toBe('2');
    await expect(store.claim({ wait_id: 'wait-1', principal: 'planner-2', trigger: 'manual', request_id: 'request-planner-2' })).rejects.toMatchObject({ code: 'state_conflict' });
  });

  it('moves unknown external effects to reconciliation_wait without retrying them', async () => {
    const { store } = await makeStore();
    await createWait(store);
    const unknown = await store.markEffectUnknown({ wait_id: 'wait-1', principal: 'owner', reason: 'external call outcome was lost' });
    expect(unknown.state).toBe('reconciliation_wait');
    expect(unknown.reconciliation?.reason).toBe('external call outcome was lost');
    await expect(store.resume({ wait_id: 'wait-1', principal: 'owner', request_id: 'request-owner', claim_id: 'claim-1', lease_id: 'lease-1', lease_token: 'token-1' })).rejects.toMatchObject({ code: 'reconciliation_required' });
  });

  it('rechecks current ACL on reads and mutations after a restart', async () => {
    let allowed = true;
    const access = {
      authorize: () => allowed
    };
    const { root, store } = await makeStore();
    const created = await createWait(store);
    const restarted = new DurableWaitStore({ dataDir: root, problemSnapshot, access });
    allowed = false;
    await expect(restarted.get({ wait_id: created.wait_id, principal: 'owner' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(restarted.handoff({ wait_id: created.wait_id, principal: 'owner', request_id: 'request-owner', responsible: { principal: 'worker-2' } })).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('fails closed when the Problem snapshot port is missing or rejects a reference', async () => {
    expect(() => new DurableWaitStore({ dataDir: '/tmp/durable-wait-invalid', problemSnapshot: undefined as never })).toThrow(DurableWaitError);
    const { root } = await makeStore();
    const rejecting = new DurableWaitStore({ dataDir: root, problemSnapshot: { verify: () => false } });
    await expect(createWait(rejecting)).rejects.toMatchObject({ code: 'problem_snapshot_invalid' });
  });

  it('runs a same-SSOT Problem provider outside the mutation lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-durable-waits-foundation-'));
    roots.push(root);
    await initializePersonalOs(root);
    const foundationStore = createFoundationRevisionStore({ dataDir: root });
    const variable: VariableDefinition = {
      id: 'variable-same-ssot',
      type: 'variable',
      revision: '1',
      meaning: 'A variable used to prove the canonical reader can be called during a wait mutation.',
      adoptionState: 'approved',
      authorizedUses: ['draft', 'judgment', 'evaluation'],
      acl: { ownerId: 'owner', visibility: 'private', readerIds: ['owner'], writerIds: ['owner'] },
      storage: 'ontology',
      provenance: [{ sourceId: 'story-company-os-durable-waits-v1', sourceKind: 'document', evidenceIds: [] }],
      scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' },
      subject: 'front-desk',
      valueKind: 'number',
      unit: 'minute',
      aggregation: 'sum',
      granularity: 'week',
      measurementMethod: 'weekly event aggregation'
    };
    const reference = await foundationStore.create(variable, { principal: 'owner' });
    const sameSsotProblemSnapshot: DurableWaitProblemSnapshotPort = {
      verify: async ({ principal, reference: problem }) => {
        const resolved = await foundationStore.read({
          id: reference.id,
          type: reference.type,
          revision: reference.revision
        }, { principal });
        return resolved?.digest === problem.snapshot_id;
      }
    };
    const store = new DurableWaitStore({ dataDir: root, problemSnapshot: sameSsotProblemSnapshot });
    const created = await createWait(store, {
      problem_snapshot: { snapshot_id: reference.digest, problem_id: 'problem-same-ssot', revision: '1' }
    });

    const claimed = await store.claim({
      wait_id: created.wait_id,
      principal: 'owner',
      trigger: 'event',
      request_id: 'request-same-ssot',
      event_type: 'evidence.received',
      event_id: 'event-1'
    });
    expect(claimed.claimed_by_this_request).toBe(true);
  });

  it('rejects a mutation when the canonical aggregate changes after provider preflight', async () => {
    const { root, store, clock } = await makeStore();
    await createWait(store);
    let mutateDuringClaimAuthorization = true;
    const access = {
      authorize: async ({ action }: { action: string }) => {
        if (action === 'claim' && mutateDuringClaimAuthorization) {
          mutateDuringClaimAuthorization = false;
          await mutatePersonalOs(root, (current) => ({
            ...current,
            personalKg: [...current.personalKg, { id: 'cas-marker', type: 'judgment', text: 'preflight changed' }]
          }));
        }
        return true;
      }
    };
    const guarded = new DurableWaitStore({ dataDir: root, problemSnapshot, access, clock: clock.now, defaultLeaseMs: 100 });
    clock.advance(10_000);

    await expect(guarded.claim({
      wait_id: 'wait-1',
      principal: 'worker-1',
      trigger: 'event',
      request_id: 'request-cas',
      event_type: 'evidence.received',
      event_id: 'event-1'
    })).rejects.toMatchObject({ code: 'state_conflict' });
    await expect(store.get({ wait_id: 'wait-1', principal: 'owner' })).resolves.toMatchObject({ state: 'waiting' });
  });
});
