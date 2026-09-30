import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExecutionAuthorityService,
  type ExecutionAttribution,
  type ExecutionCheckKind,
  type ExecutionCheckRequest,
  type ExecutionCheckResult,
  type ExecutionIntentKey,
  type ExecutionIntentRecord,
  type ExecutionIntentStore,
  type ExecutionStartInput,
} from '../src/execution-authority.js';

const dirs: string[] = [];
const problem = {
  problem_snapshot_id: `sha256:${'b'.repeat(64)}`,
  problem_id: 'problem-execution-registration',
  revision: 'r1',
};

const delegated: ExecutionAttribution = {
  mode: 'delegated_service',
  servicePrincipal: 'svc-mana',
  delegationRef: 'delegation-1',
  correlationId: 'cor-1',
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-execution-registration-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function input(operationId: string, overrides: Partial<ExecutionStartInput> = {}): ExecutionStartInput {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'per-owner',
    scopeId: 'scope-a',
    runId: `run-${operationId}`,
    reservationId: 'reservation-a',
    approvalId: 'approval-a',
    authorityRef: 'authority-a',
    constraintRefs: ['constraint-a'],
    problem,
    ...overrides,
  };
}

/** A transactional in-memory store that behaves like a database adapter. */
function memoryStore(options: { failReads?: () => boolean } = {}): ExecutionIntentStore & { rows: Map<string, ExecutionIntentRecord> } {
  const rows = new Map<string, ExecutionIntentRecord>();
  const keyOf = (key: ExecutionIntentKey) => `${key.tenantId}\u0000${key.operationId}`;
  return {
    rows,
    async read(key) {
      if (options.failReads?.()) throw new Error('connection refused');
      const row = rows.get(keyOf(key));
      return row ? structuredClone(row) : undefined;
    },
    async insert(intent) {
      const existing = rows.get(keyOf(intent));
      if (existing) return { intent: structuredClone(existing), created: false };
      rows.set(keyOf(intent), structuredClone(intent));
      return { intent: structuredClone(intent), created: true };
    },
    async update(key, mutate) {
      const existing = rows.get(keyOf(key));
      if (!existing) return undefined;
      const next = mutate(structuredClone(existing));
      rows.set(keyOf(key), structuredClone(next));
      return structuredClone(next);
    },
  };
}

interface Harness {
  service: ExecutionAuthorityService;
  checks: Map<ExecutionCheckKind, ExecutionCheckResult>;
  checkRequests: ExecutionCheckRequest[];
  markCalls: number;
  effectCalls: number;
  now: { value: Date };
}

function makeHarness(options: { store?: ExecutionIntentStore; dataDir?: string; withEffect?: boolean } = {}): Harness {
  const checks = new Map<ExecutionCheckKind, ExecutionCheckResult>(
    (['authority', 'approval', 'constraint', 'reservation'] as const).map((check) => [check, {
      status: 'approved',
      revision: `${check}-r1`,
      fencingToken: `${check}-fence-r1`,
      expiresAt: '2026-10-01T01:00:00.000Z',
    }]),
  );
  const harness = {
    checks,
    checkRequests: [] as ExecutionCheckRequest[],
    markCalls: 0,
    effectCalls: 0,
    now: { value: new Date('2026-10-01T00:00:00.000Z') },
  } as Harness;
  const verify = async (request: ExecutionCheckRequest) => {
    harness.checkRequests.push(structuredClone(request));
    return checks.get(request.check)!;
  };
  harness.service = new ExecutionAuthorityService({
    ...(options.store ? { store: options.store } : { dataDir: options.dataDir }),
    authority: { verify },
    approval: { verify },
    constraint: { verify },
    reservation: {
      verify,
      markStarted: async () => {
        harness.markCalls += 1;
        return { status: 'started' as const };
      },
    },
    readAccess: { verify: async () => ({ status: 'approved' as const, revision: 'read-r1' }) },
    ...(options.withEffect
      ? { effect: { start: async () => { harness.effectCalls += 1; return { status: 'started' as const }; } } }
      : {}),
    clock: () => harness.now.value,
  });
  return harness;
}

describe('execution registration', () => {
  it('registers through the checks and the reservation mark without calling an effect', async () => {
    const harness = makeHarness({ store: memoryStore() });
    const request = input('op-register');

    const result = await harness.service.register(request, { attribution: delegated });

    expect(result.replayed).toBe(false);
    expect(harness.markCalls).toBe(1);
    expect(harness.effectCalls).toBe(0);
    expect(harness.checkRequests).toHaveLength(8);
    expect(result.intent).toMatchObject({
      phase: 'registered',
      reservationMark: 'started',
      effect: { operationId: request.operationId, status: 'not_started' },
      attribution: delegated,
    });
    expect(result.capability).toMatchObject({
      kind: 'execution-start',
      operationId: request.operationId,
      principal: 'per-owner',
      attribution: delegated,
      checks: { authority: { fencingToken: 'authority-fence-r1' } },
    });
    expect(result.capabilityDigest).toBe(result.intent.capability?.digest);
    expect(JSON.stringify(result.intent)).not.toContain('fence-r1');
  });

  it('passes the trusted attribution to every check so delegation is verified before the permit', async () => {
    const harness = makeHarness({ store: memoryStore() });

    await harness.service.register(input('op-attribution'), { attribution: delegated });

    expect(harness.checkRequests.every((request) => request.attribution?.delegationRef === 'delegation-1')).toBe(true);
    expect(harness.checkRequests.filter((request) => request.phase === 'final')).toHaveLength(4);
  });

  it.each([
    ['delegated without delegation', { mode: 'delegated_service', servicePrincipal: 'svc-mana' }],
    ['delegated service impersonating the person', { mode: 'delegated_service', servicePrincipal: 'per-owner', delegationRef: 'd' }],
    ['service acting as someone else', { mode: 'service', servicePrincipal: 'svc-job', delegationRef: 'grant-1' }],
    ['person carrying a service principal', { mode: 'person', servicePrincipal: 'svc-mana' }],
    ['unknown mode', { mode: 'robot' }],
  ])('rejects an inconsistent attribution: %s', async (_label, attribution) => {
    const harness = makeHarness({ store: memoryStore() });

    await expect(harness.service.register(input('op-bad-attribution'), {
      attribution: attribution as unknown as ExecutionAttribution,
    })).rejects.toMatchObject({ code: 'validation_error' });
    expect(harness.markCalls).toBe(0);
  });

  it('returns the stored permit on an exact replay and rejects a different attribution', async () => {
    const harness = makeHarness({ store: memoryStore() });
    const request = input('op-replay');
    const first = await harness.service.register(request, { attribution: delegated });

    const second = await harness.service.register(request, { attribution: delegated });

    expect(second.replayed).toBe(true);
    expect(second.capability).toEqual(first.capability);
    expect(harness.markCalls).toBe(1);
    await expect(harness.service.register(request, { attribution: { mode: 'person' } }))
      .rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(harness.service.register(request))
      .rejects.toMatchObject({ code: 'operation_conflict' });
    expect(harness.markCalls).toBe(1);
  });

  it('refuses to replay an expired permit', async () => {
    const harness = makeHarness({ store: memoryStore() });
    const request = input('op-expired');
    await harness.service.register(request, { attribution: { mode: 'person' } });

    harness.now.value = new Date('2026-10-01T02:00:00.000Z');

    await expect(harness.service.register(request, { attribution: { mode: 'person' } }))
      .rejects.toMatchObject({ code: 'capability_expired' });
    expect(harness.markCalls).toBe(1);
  });

  it('records effect reports idempotently and never moves started back to unknown', async () => {
    const harness = makeHarness({ store: memoryStore() });
    const request = input('op-report');
    const registered = await harness.service.register(request, { attribution: { mode: 'person' } });
    const report = {
      operationId: request.operationId,
      tenantId: request.tenantId,
      principal: request.principal,
      scopeId: request.scopeId,
      capabilityDigest: registered.capabilityDigest,
    };

    await expect(harness.service.reportEffect({ ...report, capabilityDigest: 'f'.repeat(64), status: 'started' }))
      .rejects.toMatchObject({ code: 'capability_mismatch' });
    await expect(harness.service.reportEffect({ ...report, scopeId: 'scope-b', status: 'started' }))
      .rejects.toMatchObject({ code: 'scope_mismatch' });

    const started = await harness.service.reportEffect({ ...report, status: 'started' });
    expect(started).toMatchObject({ phase: 'started', effect: { status: 'started' } });
    await expect(harness.service.reportEffect({ ...report, status: 'started' })).resolves.toMatchObject({ phase: 'started' });
    await expect(harness.service.reportEffect({ ...report, status: 'unknown' }))
      .rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(harness.service.readIntent(request)).resolves.toMatchObject({ phase: 'started', attribution: { mode: 'person' } });
  });

  it('keeps an unknown effect until a reconciled started report arrives', async () => {
    const harness = makeHarness({ store: memoryStore() });
    const request = input('op-unknown');
    const registered = await harness.service.register(request);
    const report = {
      operationId: request.operationId,
      tenantId: request.tenantId,
      principal: request.principal,
      scopeId: request.scopeId,
      capabilityDigest: registered.capabilityDigest,
    };

    await expect(harness.service.reportEffect({ ...report, status: 'unknown' }))
      .resolves.toMatchObject({ phase: 'unknown', effect: { status: 'unknown' }, failure: { code: 'effect_unknown' } });
    await expect(harness.service.reportEffect({ ...report, status: 'unknown' })).resolves.toMatchObject({ phase: 'unknown' });
    await expect(harness.service.reportEffect({ ...report, status: 'started' }))
      .resolves.toMatchObject({ phase: 'started', effect: { status: 'started' } });
  });

  it('writes only to the injected store and reads the registration back by the same execution ID', async () => {
    const dataDir = await tempDir();
    const store = memoryStore();
    const harness = makeHarness({ store });
    const request = input('op-store');

    await harness.service.register(request, { attribution: delegated });

    expect(store.rows.size).toBe(1);
    expect(await readdir(dataDir)).toEqual([]);
    const readBack = await harness.service.readIntent(request);
    expect(readBack).toMatchObject({ operationId: 'op-store', phase: 'registered', attribution: delegated });
    expect(readBack?.capability).toEqual({ expiresAt: expect.any(String), digest: expect.any(String) });
  });

  it('fails closed with store_unavailable before the reservation mark when the store is down', async () => {
    let down = true;
    const harness = makeHarness({ store: memoryStore({ failReads: () => down }) });

    await expect(harness.service.register(input('op-down'))).rejects.toMatchObject({ code: 'store_unavailable' });
    expect(harness.markCalls).toBe(0);
    down = false;
    await expect(harness.service.register(input('op-down'))).resolves.toMatchObject({ replayed: false });
  });

  it('rejects malformed records returned by a store', async () => {
    const store = memoryStore();
    const harness = makeHarness({ store });
    await harness.service.register(input('op-corrupt'));
    for (const row of store.rows.values()) (row as unknown as Record<string, unknown>).phase = 'half-done';

    await expect(harness.service.readIntent(input('op-corrupt'))).rejects.toMatchObject({ code: 'ledger_invalid' });
  });

  it('keeps the sidecar default and the in-process start path for existing hosts', async () => {
    const dataDir = await tempDir();
    const harness = makeHarness({ dataDir, withEffect: true });

    await expect(harness.service.start(input('op-start'), { attribution: { mode: 'person' } }))
      .resolves.toMatchObject({ effect: { status: 'started' }, intent: { attribution: { mode: 'person' } } });
    expect(harness.effectCalls).toBe(1);
    expect(await readdir(dataDir)).toContain('execution-authority');
  });

  it('reports effect_unconfigured when start is called without an effect port', async () => {
    const harness = makeHarness({ store: memoryStore() });

    await expect(harness.service.start(input('op-no-effect'))).rejects.toMatchObject({ code: 'effect_unconfigured' });
    expect(harness.markCalls).toBe(0);
  });

  it('requires either a store or a data directory', () => {
    expect(() => new ExecutionAuthorityService({
      authority: { verify: async () => ({ status: 'unknown', revision: null }) },
      approval: { verify: async () => ({ status: 'unknown', revision: null }) },
      constraint: { verify: async () => ({ status: 'unknown', revision: null }) },
      reservation: {
        verify: async () => ({ status: 'unknown', revision: null }),
        markStarted: async () => ({ status: 'unknown' }),
      },
      readAccess: { verify: async () => ({ status: 'unknown', revision: null }) },
    })).toThrow(TypeError);
  });
});
