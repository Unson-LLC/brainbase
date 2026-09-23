import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createResourceReservationProblemSnapshotPort,
  ResourceReservationService,
  type ResourceReservationAuthorizationPort,
  type ResourceReservationProblemSnapshotPort,
  type ResourceReservationProblemSnapshotRecord,
  type ResourceReservationRequest,
} from '../src/resource-reservations.js';
import {
  JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
  loadJudgmentProblemSnapshot,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
} from '../src/judgment-problem-snapshot.js';

const dirs: string[] = [];
const problem = {
  problem_snapshot_id: `sha256:${'a'.repeat(64)}`,
  problem_id: 'problem-resource-capacity',
  revision: 'r1',
};
const period = {
  startsAt: '2026-09-23T10:00:00.000Z',
  endsAt: '2026-09-23T18:00:00.000Z',
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-reservations-'));
  dirs.push(dir);
  return dir;
}

function request(operationId: string, overrides: Partial<ResourceReservationRequest> = {}): ResourceReservationRequest {
  return {
    operationId,
    tenantId: 'tenant-a',
    principal: 'owner-a',
    scopeId: 'scope-a',
    resourceId: 'calendar-hours',
    period,
    amount: 8,
    unit: 'hour',
    runId: `run-${operationId}`,
    problem,
    ...overrides,
  };
}

function ports(options: { expiresAt?: string | null; capacity?: number | null } = {}): {
  authorization: ResourceReservationAuthorizationPort;
  problemSnapshot: ResourceReservationProblemSnapshotPort;
  capacity: { read: () => number | null };
} {
  return {
    authorization: {
      authorize: (input) => ({
        status: 'approved',
        approvalId: input.approvalId ?? `approval-${input.operationId}`,
        expiresAt: options.expiresAt,
        evidence: { source: 'test' },
      }),
    },
    problemSnapshot: { verify: () => true },
    capacity: { read: () => options.capacity === undefined ? 10 : options.capacity },
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resource reservations', () => {
  it('connects the public ProblemSnapshot port to a persisted snapshot loader', async () => {
    const snapshotRoot = await tempDir();
    const snapshotFile = join(snapshotRoot, 'snapshot.json');
    const persistedSnapshot: ResourceReservationProblemSnapshotRecord = {
      snapshot_version: 'judgment-problem-snapshot.v1',
      problem_id: problem.problem_id,
      revision: '1',
      owner_scope: { type: 'project', id: 'scope-a' },
      execution_permission: 'none',
    };
    await writeFile(snapshotFile, `${JSON.stringify(persistedSnapshot)}\n`);

    const problemSnapshot = createResourceReservationProblemSnapshotPort({
      root: snapshotRoot,
      load: async (input) => {
        expect(input.root).toBe(snapshotRoot);
        expect(input.snapshot_id).toBe(problem.problem_snapshot_id);
        expect(input.access).toEqual({ principal: 'owner-a' });
        expect(input.reference_resolution).toBe('current');
        return JSON.parse(await readFile(snapshotFile, 'utf8')) as ResourceReservationProblemSnapshotRecord;
      },
    });
    const service = new ResourceReservationService({
      dataDir: await tempDir(),
      ...ports(),
      problemSnapshot,
    });

    await expect(service.approve(request('approve-persisted', {
      problem: { ...problem, revision: '1' },
    }))).resolves.toMatchObject({ reservation: { state: 'approved' } });
    await expect(problemSnapshot.verify({
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-other',
      reference: { ...problem, revision: '1' },
    })).resolves.toBe(false);
  });

  it('loads an immutable ProblemSnapshot from the real store through the reservation port', async () => {
    const snapshotRoot = await tempDir();
    const snapshotKinds: readonly JudgmentProblemReference['kind'][] = [
      'objective',
      'criterion',
      'observation',
      'model',
      'constraint',
      'authority',
      'resource',
      'deadline',
    ];
    const snapshot: JudgmentProblemSnapshot = {
      snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
      problem_id: problem.problem_id,
      revision: '1',
      question: 'Which resource allocation should be approved?',
      owner_scope: { type: 'project', id: 'scope-a' },
      references: snapshotKinds.map((kind, index) => ({
        kind,
        id: `${kind}-resource-capacity`,
        revision: '1',
        digest: `sha256:${(index + 1).toString(16).padStart(2, '0').repeat(32)}` as `sha256:${string}`,
        scope: { type: 'project', id: 'scope-a' },
        valid_from: '2026-01-01T00:00:00.000Z',
      })),
      read_policy: {
        ownerId: 'owner-a',
        visibility: 'private',
        readerIds: [],
        writerIds: ['owner-a'],
      },
      execution_permission: 'none',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const saveReferenceProvider: JudgmentProblemReferenceProvider = {
      resolve: ({ reference }) => ({ status: 'resolved', digest: reference.digest }),
    };
    const receipt = await saveJudgmentProblemSnapshot({
      root: snapshotRoot,
      snapshot,
      access: { principal: 'owner-a' },
      referenceProvider: saveReferenceProvider,
    });
    const loadReferenceProvider: JudgmentProblemReferenceProvider = {
      resolve: ({ reference }) => ({ status: 'resolved', digest: reference.digest }),
    };
    const loadCalls: Array<{ root: string; snapshot_id: string; principal: string; reference_resolution: string }> = [];
    const problemSnapshot = createResourceReservationProblemSnapshotPort({
      root: snapshotRoot,
      load: async (input) => {
        loadCalls.push({
          root: input.root,
          snapshot_id: input.snapshot_id,
          principal: input.access.principal,
          reference_resolution: input.reference_resolution,
        });
        return loadJudgmentProblemSnapshot({
          root: input.root,
          snapshot_id: input.snapshot_id,
          access: input.access,
          reference_resolution: input.reference_resolution,
          referenceProvider: loadReferenceProvider,
        });
      },
    });
    const realProblem = {
      problem_snapshot_id: receipt.snapshot_id,
      problem_id: receipt.problem_id,
      revision: receipt.revision,
    };
    const service = new ResourceReservationService({
      dataDir: await tempDir(),
      ...ports(),
      problemSnapshot,
    });

    await expect(service.approve(request('approve-real-snapshot', { problem: realProblem })))
      .resolves.toMatchObject({ reservation: { state: 'approved', problem: realProblem } });
    expect(loadCalls).toEqual([{
      root: snapshotRoot,
      snapshot_id: receipt.snapshot_id,
      principal: 'owner-a',
      reference_resolution: 'current',
    }]);
    await expect(problemSnapshot.verify({
      tenantId: 'tenant-a',
      principal: 'other-owner',
      scopeId: 'scope-a',
      reference: realProblem,
    })).resolves.toBe(false);
  });

  it.each([
    { label: 'denied', status: 'unauthorized' as const },
    { label: 'missing', status: 'missing' as const },
  ])('rejects a new approval when the current canonical reference is $label', async ({ label, status }) => {
    const snapshotRoot = await tempDir();
    const snapshot: JudgmentProblemSnapshot = {
      snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
      problem_id: problem.problem_id,
      revision: '1',
      question: 'Which resource allocation should be approved?',
      owner_scope: { type: 'project', id: 'scope-a' },
      references: [
        'objective',
        'criterion',
        'observation',
        'model',
        'constraint',
        'authority',
        'resource',
        'deadline',
      ].map((kind, index) => ({
        kind: kind as JudgmentProblemReference['kind'],
        id: `${kind}-resource-capacity`,
        revision: '1',
        digest: `sha256:${(index + 1).toString(16).padStart(2, '0').repeat(32)}` as `sha256:${string}`,
        scope: { type: 'project', id: 'scope-a' },
        valid_from: '2026-01-01T00:00:00.000Z',
      })),
      read_policy: {
        ownerId: 'owner-a',
        visibility: 'private',
        readerIds: [],
        writerIds: ['owner-a'],
      },
      execution_permission: 'none',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const resolvedReferenceProvider: JudgmentProblemReferenceProvider = {
      resolve: ({ reference }) => ({ status: 'resolved', digest: reference.digest }),
    };
    const receipt = await saveJudgmentProblemSnapshot({
      root: snapshotRoot,
      snapshot,
      access: { principal: 'owner-a' },
      referenceProvider: resolvedReferenceProvider,
    });
    const problemSnapshot = createResourceReservationProblemSnapshotPort({
      root: snapshotRoot,
      load: (input) => loadJudgmentProblemSnapshot({
        ...input,
        referenceProvider: {
          resolve: () => ({ status, message: `canonical reference is ${label}` }),
        },
      }),
    });
    const service = new ResourceReservationService({
      dataDir: await tempDir(),
      ...ports(),
      problemSnapshot,
    });

    await expect(service.approve(request(`approve-current-${label}`, {
      problem: {
        problem_snapshot_id: receipt.snapshot_id,
        problem_id: receipt.problem_id,
        revision: receipt.revision,
      },
    }))).rejects.toMatchObject({ code: 'problem_snapshot_invalid' });
    await expect(service.readLedger({
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
    })).resolves.toMatchObject({ reservations: [] });
  });

  it('keeps estimate, approval, reservation and consumption distinct in the persistent ledger', async () => {
    const dir = await tempDir();
    const service = new ResourceReservationService({ dataDir: dir, ...ports() });
    const approved = await service.approve(request('approve-1'));

    await expect(service.estimate(request('estimate-1'))).resolves.toMatchObject({
      requestedAmount: 8,
      committedAmount: 0,
      availableAmount: 10,
    });
    const reserved = await service.reserve({
      ...request('reserve-1', { runId: 'run-approve-1' }),
      approvalId: approved.reservation.approval.approvalId,
    });
    expect(reserved.reservation.state).toBe('reserved');
    expect(reserved.reservation.history.map((entry) => entry.action)).toEqual(['approve', 'reserve']);

    const consumed = await service.consume({
      operationId: 'consume-1',
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      reservationId: reserved.reservation.reservationId,
    });
    expect(consumed.reservation.state).toBe('consumed');
    expect(consumed.reservation.history.at(-1)?.action).toBe('consume');

    const ledger = await service.readLedger({ tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' });
    expect(ledger.reservations).toHaveLength(1);
    expect(ledger.reservations[0]).toMatchObject({
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      resourceId: 'calendar-hours',
      amount: 8,
      unit: 'hour',
      runId: 'run-approve-1',
      problem,
    });
  });

  it('requires a separate approval, makes retries idempotent, and rejects a changed payload', async () => {
    const dir = await tempDir();
    let revoked = false;
    const servicePorts = ports();
    const originalAuthorize = servicePorts.authorization.authorize;
    servicePorts.authorization = {
      authorize: (input) => revoked
        ? { status: 'denied' }
        : originalAuthorize(input),
    };
    const service = new ResourceReservationService({ dataDir: dir, ...servicePorts });
    await expect(service.reserve(request('reserve-without-approval'))).rejects.toMatchObject({ code: 'approval_required' });
    const approved = await service.approve(request('approve-2'));
    const reserveInput = {
      ...request('reserve-2', { runId: 'run-approve-2' }),
      approvalId: approved.reservation.approval.approvalId,
    };
    const first = await service.reserve(reserveInput);
    const retry = await service.reserve(reserveInput);
    expect(retry).toEqual(first);

    revoked = true;
    await expect(service.reserve({ ...reserveInput, amount: 7 })).rejects.toMatchObject({ code: 'operation_conflict' });
    await expect(service.reserve(reserveInput)).rejects.toMatchObject({ code: 'authorization_denied' });
    revoked = false;
    const ledger = await service.readLedger({ tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' });
    expect(ledger.reservations).toHaveLength(1);
    expect(ledger.reservations[0].amount).toBe(8);
  });

  it('rejects expired approval, unknown capacity, and cross-principal or cross-tenant mutations', async () => {
    let now = new Date('2026-09-23T00:00:00.000Z');
    const dir = await tempDir();
    const service = new ResourceReservationService({
      dataDir: dir,
      ...ports({ expiresAt: '2026-09-23T01:00:00.000Z' }),
      clock: () => now,
    });
    const approved = await service.approve(request('approve-expiring'));
    now = new Date('2026-09-23T02:00:00.000Z');
    await expect(service.reserve({
      ...request('reserve-expired', { runId: 'run-approve-expiring' }),
      approvalId: approved.reservation.approval.approvalId,
    }))
      .rejects.toMatchObject({ code: 'approval_expired' });

    const unknownCapacity = new ResourceReservationService({ dataDir: await tempDir(), ...ports({ capacity: null }) });
    const unknownApproved = await unknownCapacity.approve(request('approve-unknown'));
    await expect(unknownCapacity.reserve({
      ...request('reserve-unknown', { runId: 'run-approve-unknown' }),
      approvalId: unknownApproved.reservation.approval.approvalId,
    }))
      .rejects.toMatchObject({ code: 'capacity_unknown' });

    const boundaryService = new ResourceReservationService({ dataDir: await tempDir(), ...ports() });
    const knownApproved = await boundaryService.approve(request('approve-boundary'));
    const reservation = await boundaryService.reserve({
      ...request('reserve-boundary', { runId: 'run-approve-boundary' }),
      approvalId: knownApproved.reservation.approval.approvalId,
    });
    expect(reservation.reservation.state).toBe('reserved');
    await expect(boundaryService.release({
      operationId: 'release-cross-tenant',
      tenantId: 'tenant-b',
      principal: 'owner-a',
      scopeId: 'scope-a',
      reservationId: reservation.reservation.reservationId,
    })).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(boundaryService.release({
      operationId: 'release-cross-principal',
      tenantId: 'tenant-a',
      principal: 'owner-b',
      scopeId: 'scope-a',
      reservationId: reservation.reservation.reservationId,
    })).rejects.toMatchObject({ code: 'scope_mismatch' });
  });

  it('does not release a reservation after an external action has started', async () => {
    const dir = await tempDir();
    const service = new ResourceReservationService({ dataDir: dir, ...ports() });
    const approved = await service.approve(request('approve-external'));
    const reserved = await service.reserve({
      ...request('reserve-external', { runId: 'run-approve-external' }),
      approvalId: approved.reservation.approval.approvalId,
    });
    const started = await service.startExternalAction({
      operationId: 'start-external',
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      reservationId: reserved.reservation.reservationId,
    });
    expect(started.reservation.externalAction.status).toBe('started');
    await expect(service.release({
      operationId: 'release-after-external',
      tenantId: 'tenant-a',
      principal: 'owner-a',
      scopeId: 'scope-a',
      reservationId: reserved.reservation.reservationId,
    })).rejects.toMatchObject({ code: 'external_action_reconciliation_required' });
  });

  it('serializes two processes against the same store so only one 8 hour reservation fits in 10 hours', async () => {
    const dir = await tempDir();
    const setup = new ResourceReservationService({ dataDir: dir, ...ports() });
    const approvalA = await setup.approve(request('approve-process-a', { runId: 'run-process-a' }));
    const approvalB = await setup.approve(request('approve-process-b', { runId: 'run-process-b' }));
    const barrier = join(dir, 'start-barrier');
    const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'resource-reservations.worker.ts');
    const children = [
      startWorker(workerPath, dir, barrier, 'reserve-process-a', approvalA.reservation.approval.approvalId, 'run-process-a'),
      startWorker(workerPath, dir, barrier, 'reserve-process-b', approvalB.reservation.approval.approvalId, 'run-process-b'),
    ];
    await Promise.all(children.map((child) => child.ready));
    await writeFile(barrier, 'go');
    const results = await Promise.all(children.map((child) => child.result));
    expect(results.filter((result) => result.status === 'ok')).toHaveLength(1);
    expect(results.filter((result) => result.code === 'capacity_exceeded')).toHaveLength(1);
    const ledger = await setup.readLedger({ tenantId: 'tenant-a', principal: 'owner-a', scopeId: 'scope-a' });
    expect(ledger.reservations.filter((item) => item.state === 'reserved').reduce((sum, item) => sum + item.amount, 0)).toBe(8);
  });
});

interface WorkerResult {
  status: 'ok' | 'error';
  code?: string;
}

interface WorkerHandle {
  process: ChildProcess;
  ready: Promise<void>;
  result: Promise<WorkerResult>;
}

function startWorker(
  workerPath: string,
  dataDir: string,
  barrier: string,
  operationId: string,
  approvalId: string,
  runId: string,
): WorkerHandle {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', workerPath, dataDir, barrier, operationId, approvalId, runId], {
    cwd: dirname(dirname(workerPath)),
    env: { ...process.env, BRAINBASE_SSOT_LOCK_TIMEOUT_MS: '10000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker did not become ready: ${errorOutput}`)), 10_000);
    const poll = setInterval(() => {
      if (output.includes('\nREADY\n') || output.startsWith('READY\n')) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 5);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(error);
    });
  });
  const result = new Promise<WorkerResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      const line = output.trim().split('\n').reverse().find((value) => value.startsWith('{'));
      if (!line) {
        reject(new Error(`Worker exited without a result (code=${code}): ${errorOutput}\n${output}`));
        return;
      }
      try {
        resolve(JSON.parse(line) as WorkerResult);
      } catch (error) {
        reject(new Error(`Worker returned invalid JSON: ${line}`, { cause: error }));
      }
    });
  });
  return { process: child, ready, result };
}
