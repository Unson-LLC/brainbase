import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createResourceReservationExecutionPort,
  ExecutionAuthorityError,
  ExecutionAuthorityService,
  type ExecutionCheckKind,
  type ExecutionCheckRequest,
  type ExecutionCheckResult,
  type ExecutionEffectPort,
  type ExecutionEffectRequest,
  type ExecutionReadAccessRequest,
  type ExecutionReadAccessResult,
  type ExecutionStartInput,
} from '../src/execution-authority.js';
import type {
  ResourceReservationMutationResult,
  ResourceReservationService,
} from '../src/resource-reservations.js';

const dirs: string[] = [];
const problem = {
  problem_snapshot_id: `sha256:${'a'.repeat(64)}`,
  problem_id: 'problem-execution-authority',
  revision: 'r1',
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-execution-authority-'));
  dirs.push(dir);
  return dir;
}

function input(operationId: string, overrides: Partial<ExecutionStartInput> = {}): ExecutionStartInput {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
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

type CheckCall = Pick<ExecutionCheckRequest, 'check' | 'phase' | 'expectedRevision'>;

interface Harness {
  service: ExecutionAuthorityService;
  checks: Map<ExecutionCheckKind, ExecutionCheckResult>;
  checkCalls: CheckCall[];
  markCalls: Array<ExecutionStartInput & { expectedRevision: string }>;
  effectCalls: ExecutionEffectRequest[];
}

function makeHarness(
  dataDir: string,
  options: {
    onVerify?: (request: ExecutionCheckRequest, checks: Map<ExecutionCheckKind, ExecutionCheckResult>) => ExecutionCheckResult;
    markStarted?: () => { status: 'started' | 'unknown' } | Promise<{ status: 'started' | 'unknown' }>;
    readAccess?: (request: ExecutionReadAccessRequest) => ExecutionReadAccessResult | Promise<ExecutionReadAccessResult>;
    effect?: (request: ExecutionEffectRequest, checks: Map<ExecutionCheckKind, ExecutionCheckResult>) => ReturnType<ExecutionEffectPort['start']>;
  } = {},
): Harness {
  const checks = new Map<ExecutionCheckKind, ExecutionCheckResult>([
    ['authority', { status: 'approved', revision: 'authority-r1', fencingToken: 'authority-token-r1', expiresAt: '2099-01-01T00:00:00.000Z' }],
    ['approval', { status: 'approved', revision: 'approval-r1', fencingToken: 'approval-token-r1', expiresAt: '2099-01-01T00:00:00.000Z' }],
    ['constraint', { status: 'approved', revision: 'constraint-r1', fencingToken: 'constraint-token-r1', expiresAt: '2099-01-01T00:00:00.000Z' }],
    ['reservation', { status: 'approved', revision: 'reservation-r1', fencingToken: 'reservation-token-r1', expiresAt: '2099-01-01T00:00:00.000Z' }],
  ]);
  const checkCalls: CheckCall[] = [];
  const markCalls: Array<ExecutionStartInput & { expectedRevision: string }> = [];
  const effectCalls: ExecutionEffectRequest[] = [];
  const verify = async (request: ExecutionCheckRequest): Promise<ExecutionCheckResult> => {
    checkCalls.push({ check: request.check, phase: request.phase, expectedRevision: request.expectedRevision });
    return options.onVerify?.(request, checks) ?? checks.get(request.check)!;
  };
  const reservation = {
    verify,
    markStarted: async (request: ExecutionStartInput & { expectedRevision: string }) => {
      markCalls.push(request);
      if (options.markStarted) return options.markStarted();
      return { status: 'started' as const };
    },
  };
  const effect = {
    start: async (request: ExecutionEffectRequest) => {
      effectCalls.push(request);
      return options.effect?.(request, checks) ?? { status: 'started' as const };
    },
  };
  const service = new ExecutionAuthorityService({
    dataDir,
    authority: { verify },
    approval: { verify },
    constraint: { verify },
    reservation,
    readAccess: { verify: async (request) => options.readAccess?.(request) ?? { status: 'approved' as const, revision: 'read-r1' } },
    effect,
  });
  return { service, checks, checkCalls, markCalls, effectCalls };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('execution authority', () => {
  it('revalidates all current providers, fences revisions, and persists before the effect', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir);
    const request = input('execute-happy');

    const result = await harness.service.start(request);

    expect(result.replayed).toBe(false);
    expect(result.effect).toEqual({ operationId: request.operationId, status: 'started' });
    expect(harness.effectCalls).toHaveLength(1);
    expect(harness.effectCalls[0]).toMatchObject({ operationId: request.operationId });
    expect(harness.markCalls).toHaveLength(1);
    expect(harness.markCalls[0].expectedRevision).toBe('reservation-r1');
    expect(harness.checkCalls).toHaveLength(8);
    expect(harness.checkCalls.filter(({ phase }) => phase === 'initial')).toHaveLength(4);
    expect(harness.checkCalls.filter(({ phase }) => phase === 'final')).toHaveLength(4);
    expect(harness.checkCalls.filter(({ phase }) => phase === 'final').every(({ expectedRevision }) => expectedRevision)).toBe(true);
    await expect(harness.service.readIntent(request)).resolves.toMatchObject({
      phase: 'started',
      reservationMark: 'started',
      effect: { operationId: request.operationId, status: 'started' },
      problem,
    });

    const sidecar = JSON.parse(await readFile(join(dir, 'execution-authority/intents.json'), 'utf8')) as {
      intents: Array<{ operationId: string; phase: string; effect: { status: string } }>;
    };
    expect(sidecar.intents).toHaveLength(1);
    expect(sidecar.intents[0]).toMatchObject({ operationId: request.operationId, phase: 'started', effect: { status: 'started' } });
  });

  it.each([
    ['authority', 'revoked', 'authority_revoked'],
    ['approval', 'expired', 'approval_expired'],
    ['constraint', 'unknown', 'constraint_unknown'],
    ['reservation', 'revoked', 'reservation_revoked'],
  ] as const)('fails closed when the current %s provider is %s', async (kind, status, code) => {
    const dir = await tempDir();
    const harness = makeHarness(dir);
    harness.checks.set(kind, { status, revision: `${kind}-r2` });

    await expect(harness.service.start(input(`execute-${kind}`))).rejects.toMatchObject({
      name: 'ExecutionAuthorityError',
      code,
    } satisfies Partial<ExecutionAuthorityError>);
    expect(harness.markCalls).toHaveLength(0);
    expect(harness.effectCalls).toHaveLength(0);
    await expect(harness.service.readIntent(input(`execute-${kind}`))).resolves.toBeUndefined();
  });

  it('rejects a revision change between the initial and final current checks', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir, {
      onVerify: (request, checks) => {
        if (request.phase === 'final' && request.check === 'authority') {
          return { status: 'approved', revision: 'authority-r2' };
        }
        return checks.get(request.check)!;
      },
    });
    const request = input('execute-revision-change');

    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(harness.markCalls).toHaveLength(0);
    expect(harness.effectCalls).toHaveLength(0);
    const intent = await harness.service.readIntent(request);
    expect(intent?.phase).toBe('rejected');
    expect(intent?.failure?.code).toBe('revision_conflict');
    expect(intent?.verification.final).toEqual(expect.arrayContaining([{ check: 'authority', revision: 'authority-r2', status: 'approved', evidence: {} }]));
  });

  it('returns the durable result for an exact replay and rejects payload or scope changes', async () => {
    const dir = await tempDir();
    let readStatus: 'approved' | 'revoked' = 'approved';
    const harness = makeHarness(dir, { readAccess: () => ({ status: readStatus, revision: 'read-r1' }) });
    const request = input('execute-replay');

    await expect(harness.service.start(request)).resolves.toMatchObject({ replayed: false });
    readStatus = 'revoked';
    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'read_revoked' });
    await expect(harness.service.readIntent(request)).rejects.toMatchObject({ code: 'read_revoked' });
    expect(harness.effectCalls).toHaveLength(1);
    readStatus = 'approved';
    await expect(harness.service.start(request)).resolves.toMatchObject({ replayed: true, effect: { status: 'started' } });
    await expect(harness.service.start(input(request.operationId, { runId: 'different-run' }))).rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(harness.service.start(input(request.operationId, { scopeId: 'scope-other' }))).rejects.toMatchObject({ code: 'scope_mismatch' });
    expect(harness.markCalls).toHaveLength(1);
    expect(harness.effectCalls).toHaveLength(1);
  });

  it('records an unknown reservation mark and forbids an automatic retry', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir, { markStarted: () => { throw new Error('provider timeout'); } });
    const request = input('execute-reservation-unknown');

    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'reservation_mark_unknown' });
    await expect(harness.service.readIntent(request)).resolves.toMatchObject({
      phase: 'recovery_required',
      reservationMark: 'unknown',
      effect: { status: 'unknown' },
      failure: { code: 'reservation_mark_unknown' },
    });
    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'recovery_required' });
    expect(harness.markCalls).toHaveLength(1);
    expect(harness.effectCalls).toHaveLength(0);
  });

  it('records an unknown effect after the reservation boundary and never treats it as unexecuted', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir, {
      effect: () => { throw new Error('effect provider timeout'); },
    });
    const request = input('execute-effect-unknown');

    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'effect_unknown' });
    await expect(harness.service.readIntent(request)).resolves.toMatchObject({
      phase: 'unknown',
      reservationMark: 'started',
      effect: { status: 'unknown' },
      failure: { code: 'effect_unknown' },
    });
    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'effect_unknown' });
    expect(harness.markCalls).toHaveLength(1);
    expect(harness.effectCalls).toHaveLength(1);
  });

  it('requires the effect boundary to consume the final capability after a post-check revocation', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir, {
      effect: (request, checks) => {
        checks.set('authority', {
          status: 'revoked',
          revision: 'authority-r2',
          fencingToken: 'authority-token-r2',
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
        const current = checks.get('authority')!;
        const capability = request.capability.checks.authority;
        if (current.status !== 'approved' || current.fencingToken !== capability.fencingToken) return { status: 'unknown' as const };
        return { status: 'started' as const };
      },
    });
    const request = input('execute-post-check-revocation');

    await expect(harness.service.start(request)).rejects.toMatchObject({ code: 'effect_unknown' });
    expect(harness.effectCalls[0].capability).toMatchObject({
      kind: 'execution-start',
      operationId: request.operationId,
      checks: { authority: { revision: 'authority-r1', fencingToken: 'authority-token-r1' } },
    });
    await expect(harness.service.readIntent(request)).resolves.toMatchObject({ phase: 'unknown', effect: { status: 'unknown' } });
  });

  it('does not treat a Problem snapshot reference as an execution grant', async () => {
    const dir = await tempDir();
    const harness = makeHarness(dir);
    harness.checks.set('authority', { status: 'revoked', revision: 'authority-revoked' });

    await expect(harness.service.start(input('execute-snapshot-evidence'))).rejects.toMatchObject({ code: 'authority_revoked' });
    expect(harness.effectCalls).toHaveLength(0);
  });

  it('adapts the current reservation store and forwards the reservation revision fence', async () => {
    const calls: Array<Record<string, string>> = [];
    let startCalls = 0;
    const reservation = {
      reservationId: 'reservation-a',
      state: 'reserved' as const,
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      updatedAt: '2026-09-23T10:00:00.000Z',
      approval: {
        approvalId: 'approval-a',
        approvedAt: '2026-09-23T09:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        evidence: {},
      },
      externalAction: { status: 'not_started' as const },
    };
    const service = {
      readLedger: async (request: { tenantId: string; principal: string; scopeId: string }) => {
        calls.push(request);
        return { version: 1 as const, reservations: [reservation] };
      },
      startExternalAction: async (request: { operationId: string; tenantId: string; principal: string; scopeId: string; reservationId: string }): Promise<ResourceReservationMutationResult> => {
        startCalls += 1;
        return { reservation: { ...reservation, externalAction: { status: 'started' as const } } } as ResourceReservationMutationResult;
      },
    } as unknown as Pick<ResourceReservationService, 'readLedger' | 'startExternalAction'>;
    const port = createResourceReservationExecutionPort({ service });
    const request = input('execute-adapter');
    const check = await port.verify({ ...request, check: 'reservation', phase: 'final' });

    expect(check).toEqual({
      status: 'approved',
      revision: 'reservation-a:2026-09-23T10:00:00.000Z',
      fencingToken: 'reservation:reservation-a:2026-09-23T10:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await expect(port.markStarted({ ...request, expectedRevision: 'reservation-a:stale' })).resolves.toEqual({ status: 'unknown' });
    expect(startCalls).toBe(0);
    await expect(port.markStarted({ ...request, expectedRevision: check.revision! })).resolves.toEqual({ status: 'started' });
    expect(startCalls).toBe(1);
    expect(calls).toEqual([
      { tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' },
      { tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' },
      { tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' },
    ]);
  });
});
