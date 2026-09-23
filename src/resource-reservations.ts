import { createHash, randomUUID } from 'node:crypto';
import { initializePersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';

const ledgerVersion = 1 as const;
const defaultSidecarPath = 'resource-reservations/ledger.json';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

export type ResourceReservationAction =
  | 'estimate'
  | 'approve'
  | 'reserve'
  | 'release'
  | 'cancel'
  | 'consume'
  | 'start_external'
  | 'read';

export type ResourceReservationState =
  | 'approved'
  | 'reserved'
  | 'released'
  | 'cancelled'
  | 'consumed';

export type ExternalActionStatus = 'not_started' | 'started' | 'completed' | 'unknown';

export interface ResourceReservationPeriod {
  startsAt: string;
  endsAt: string;
}

/** A fixed reference to Story05's immutable Problem snapshot. */
export interface ResourceReservationProblemReference {
  problem_snapshot_id: string;
  problem_id: string;
  revision: string;
}

export interface ResourceReservationRequest {
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  resourceId: string;
  period: ResourceReservationPeriod;
  amount: number;
  unit: string;
  runId: string;
  problem: ResourceReservationProblemReference;
}

export interface EstimateResourceReservationInput extends ResourceReservationRequest {}

export interface ApproveResourceReservationInput extends ResourceReservationRequest {}

export interface ReserveResourceReservationInput extends ResourceReservationRequest {
  approvalId?: string;
}

export interface ResourceReservationMutationInput {
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  reservationId: string;
}

export interface ResourceReservationAuthorizationRequest {
  action: ResourceReservationAction;
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  resourceId?: string;
  runId?: string;
  problem?: ResourceReservationProblemReference;
  approvalId?: string;
  reservationId?: string;
  reservation?: ResourceReservationRecord;
}

export interface ResourceReservationAuthorizationDecision {
  status: 'approved' | 'denied' | 'expired' | 'revoked';
  approvalId?: string;
  expiresAt?: string | null;
  evidence?: Record<string, string>;
}

/** Organization roles, budgets, and approval workflow stay behind this port. */
export interface ResourceReservationAuthorizationPort {
  authorize(
    request: ResourceReservationAuthorizationRequest,
  ): ResourceReservationAuthorizationDecision | Promise<ResourceReservationAuthorizationDecision>;
}

export interface ResourceReservationProblemSnapshotPort {
  verify(input: {
    tenantId: string;
    principal: string;
    scopeId: string;
    reference: ResourceReservationProblemReference;
  }): void | boolean | Promise<void | boolean>;
}

/**
 * The small part of Story05's immutable snapshot returned by its store.
 *
 * The reservation package keeps this structural so it can consume the
 * snapshot package without copying its model or making the two packages
 * depend on one another's source files.
 */
export interface ResourceReservationProblemSnapshotRecord {
  snapshot_version: 'judgment-problem-snapshot.v1';
  problem_id: string;
  revision: string;
  owner_scope: {
    type: 'personal' | 'project' | 'organization';
    id: string;
  };
  execution_permission: 'none';
}

/** Request shape passed to Story05's loadJudgmentProblemSnapshot function. */
export interface ResourceReservationProblemSnapshotLoadRequest {
  root: string;
  snapshot_id: string;
  access: { principal: string };
  /** New approvals/reservations must revalidate canonical references. */
  reference_resolution: 'current';
}

export type ResourceReservationProblemSnapshotLoader = (
  request: ResourceReservationProblemSnapshotLoadRequest,
) => Promise<ResourceReservationProblemSnapshotRecord>;

/**
 * Adapt the real immutable ProblemSnapshot store to the reservation port.
 *
 * Story05 owns loading, integrity checks, and current read ACL checks.  This
 * adapter only binds the caller's principal, loads the current snapshot, and
 * verifies the fixed problem/revision and scope reference.  The loader must
 * connect Story05's canonical reference provider.  The tenant boundary and
 * execution authorization remain the reservation/auth ports.
 */
export function createResourceReservationProblemSnapshotPort(options: {
  root: string;
  load: ResourceReservationProblemSnapshotLoader;
}): ResourceReservationProblemSnapshotPort {
  if (!options || typeof options !== 'object' || typeof options.root !== 'string' || options.root.length === 0) {
    throw new TypeError('problem snapshot root must be a non-empty path');
  }
  if (typeof options.load !== 'function') {
    throw new TypeError('problem snapshot loader is required');
  }
  return {
    async verify({ principal, scopeId, reference }): Promise<boolean> {
      try {
        const snapshot = await options.load({
          root: options.root,
          snapshot_id: reference.problem_snapshot_id,
          access: { principal },
          reference_resolution: 'current',
        });
        return snapshot.snapshot_version === 'judgment-problem-snapshot.v1'
          && snapshot.problem_id === reference.problem_id
          && snapshot.revision === reference.revision
          && snapshot.owner_scope.id === scopeId
          && snapshot.execution_permission === 'none';
      } catch {
        return false;
      }
    },
  };
}

export interface ResourceReservationCapacityPort {
  read(input: {
    tenantId: string;
    principal: string;
    scopeId: string;
    resourceId: string;
    period: ResourceReservationPeriod;
    unit: string;
  }): number | null | Promise<number | null>;
}

export interface ResourceReservationApproval {
  approvalId: string;
  approvedAt: string;
  expiresAt?: string;
  evidence: Record<string, string>;
}

export interface ResourceReservationExternalAction {
  status: ExternalActionStatus;
  startedAt?: string;
}

export interface ResourceReservationHistoryEntry {
  action: Exclude<ResourceReservationAction, 'estimate' | 'read'>;
  operationId: string;
  principal: string;
  occurredAt: string;
  fromState?: ResourceReservationState;
  toState: ResourceReservationState;
  amount: number;
  externalActionStatus: ExternalActionStatus;
}

export interface ResourceReservationRecord {
  reservationId: string;
  state: ResourceReservationState;
  tenantId: string;
  principal: string;
  scopeId: string;
  resourceId: string;
  period: ResourceReservationPeriod;
  amount: number;
  unit: string;
  runId: string;
  problem: ResourceReservationProblemReference;
  approval: ResourceReservationApproval;
  externalAction: ResourceReservationExternalAction;
  createdAt: string;
  updatedAt: string;
  history: ResourceReservationHistoryEntry[];
}

export interface ResourceReservationEstimate {
  tenantId: string;
  scopeId: string;
  resourceId: string;
  period: ResourceReservationPeriod;
  unit: string;
  requestedAmount: number;
  capacity: number;
  committedAmount: number;
  availableAmount: number;
}

export interface ResourceReservationLedgerSnapshot {
  version: typeof ledgerVersion;
  reservations: ResourceReservationRecord[];
}

export interface ResourceReservationServiceOptions {
  dataDir: string;
  authorization: ResourceReservationAuthorizationPort;
  problemSnapshot: ResourceReservationProblemSnapshotPort;
  capacity: ResourceReservationCapacityPort;
  clock?: () => Date;
  sidecarPath?: string;
}

export type ResourceReservationErrorCode =
  | 'validation_error'
  | 'authorization_denied'
  | 'approval_expired'
  | 'approval_revoked'
  | 'approval_required'
  | 'approval_mismatch'
  | 'capacity_unknown'
  | 'capacity_exceeded'
  | 'operation_conflict'
  | 'scope_mismatch'
  | 'reservation_not_found'
  | 'reservation_state_conflict'
  | 'external_action_reconciliation_required'
  | 'problem_snapshot_invalid'
  | 'ledger_invalid';

export class ResourceReservationError extends Error {
  readonly code: ResourceReservationErrorCode;

  constructor(code: ResourceReservationErrorCode, message: string) {
    super(message);
    this.name = 'ResourceReservationError';
    this.code = code;
  }
}

interface ResourceReservationLedger {
  version: typeof ledgerVersion;
  reservations: ResourceReservationRecord[];
  operations: ResourceReservationStoredOperation[];
}

interface ResourceReservationStoredOperation {
  operationId: string;
  tenantId: string;
  action: Exclude<ResourceReservationAction, 'estimate' | 'read'>;
  payloadDigest: string;
  result: ResourceReservationMutationResult;
  recordedAt: string;
}

export interface ResourceReservationMutationResult {
  reservation: ResourceReservationRecord;
}

export class ResourceReservationService {
  private readonly dataDir: string;
  private readonly authorization: ResourceReservationAuthorizationPort;
  private readonly problemSnapshot: ResourceReservationProblemSnapshotPort;
  private readonly capacity: ResourceReservationCapacityPort;
  private readonly clock: () => Date;
  private readonly sidecarPath: string;

  constructor(options: ResourceReservationServiceOptions) {
    assertText(options.dataDir, 'dataDir');
    this.dataDir = options.dataDir;
    this.authorization = options.authorization;
    this.problemSnapshot = options.problemSnapshot;
    this.capacity = options.capacity;
    this.clock = options.clock ?? (() => new Date());
    this.sidecarPath = options.sidecarPath ?? defaultSidecarPath;
    assertSidecarPath(this.sidecarPath);
  }

  async initialize(): Promise<void> {
    await initializePersonalOs(this.dataDir);
  }

  async estimate(input: EstimateResourceReservationInput): Promise<ResourceReservationEstimate> {
    const request = normalizeRequest(input);
    await this.verifyProblem(request);
    await this.authorize({ action: 'estimate', request });
    await this.initialize();
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const capacity = await this.readCapacity(request);
    const committedAmount = committedAmountFor(ledger, request);
    return {
      tenantId: request.tenantId,
      scopeId: request.scopeId,
      resourceId: request.resourceId,
      period: request.period,
      unit: request.unit,
      requestedAmount: request.amount,
      capacity,
      committedAmount,
      availableAmount: Math.max(0, capacity - committedAmount),
    };
  }

  async approve(input: ApproveResourceReservationInput): Promise<ResourceReservationMutationResult> {
    const request = normalizeRequest(input);
    return this.mutate('approve', request.operationId, request, async (ledger) => {
      await this.verifyProblem(request);
      const decision = await this.authorize({ action: 'approve', request });
      const approval = approvalFromDecision(decision, this.now());
      const now = this.now().toISOString();
      const reservation: ResourceReservationRecord = {
        reservationId: `reservation-${randomUUID()}`,
        state: 'approved',
        ...reservationFields(request),
        approval,
        externalAction: { status: 'not_started' },
        createdAt: now,
        updatedAt: now,
        history: [{
          action: 'approve',
          operationId: request.operationId,
          principal: request.principal,
          occurredAt: now,
          toState: 'approved',
          amount: request.amount,
          externalActionStatus: 'not_started',
        }],
      };
      ledger.reservations.push(reservation);
      return { reservation: clone(reservation) };
    });
  }

  async reserve(input: ReserveResourceReservationInput): Promise<ResourceReservationMutationResult> {
    const request = normalizeRequest(input);
    const approvalId = input.approvalId;
    if (approvalId !== undefined) assertText(approvalId, 'approvalId');
    if (approvalId === undefined) {
      throw new ResourceReservationError('approval_required', 'reserve requires a prior approvalId');
    }
    const payload = { ...request, approvalId };
    return this.mutate('reserve', request.operationId, payload, async (ledger) => {
      await this.verifyProblem(request);
      const reservation = findReservationByApprovalId(ledger, approvalId, request);
      assertRequestMatchesReservation(request, reservation);
      assertApprovalUsable(reservation, this.now());
      if (reservation.state !== 'approved') {
        throw new ResourceReservationError('reservation_state_conflict', `Reservation ${reservation.reservationId} is ${reservation.state}`);
      }
      const approval = reservation.approval;
      await this.authorize({ action: 'reserve', request, approvalId: approval.approvalId, reservation });
      const capacity = await this.readCapacity(request);
      const committedAmount = committedAmountFor(ledger, request, reservation.reservationId);
      if (committedAmount + request.amount > capacity) {
        throw new ResourceReservationError('capacity_exceeded', `Capacity ${capacity} is insufficient for ${request.amount}`);
      }
      const now = this.now().toISOString();
      const previousState = reservation.state;
      reservation.state = 'reserved';
      reservation.updatedAt = now;
      reservation.history.push({
        action: 'reserve',
        operationId: request.operationId,
        principal: request.principal,
        occurredAt: now,
        fromState: previousState,
        toState: 'reserved',
        amount: reservation.amount,
        externalActionStatus: reservation.externalAction.status,
      });
      return { reservation: clone(reservation) };
    });
  }

  async release(input: ResourceReservationMutationInput): Promise<ResourceReservationMutationResult> {
    return this.transition('release', input, 'released');
  }

  async cancel(input: ResourceReservationMutationInput): Promise<ResourceReservationMutationResult> {
    return this.transition('cancel', input, 'cancelled');
  }

  async consume(input: ResourceReservationMutationInput): Promise<ResourceReservationMutationResult> {
    return this.transition('consume', input, 'consumed');
  }

  async startExternalAction(input: ResourceReservationMutationInput): Promise<ResourceReservationMutationResult> {
    const normalized = normalizeMutationInput(input);
    return this.mutate('start_external', normalized.operationId, normalized, async (ledger) => {
      const reservation = findReservationById(ledger, normalized.reservationId, normalized);
      await this.authorize({ action: 'start_external', input: normalized, reservation });
      if (reservation.state !== 'reserved') {
        throw new ResourceReservationError('reservation_state_conflict', `Reservation ${reservation.reservationId} is ${reservation.state}`);
      }
      if (reservation.externalAction.status !== 'not_started') {
        throw new ResourceReservationError('reservation_state_conflict', `External action is already ${reservation.externalAction.status}`);
      }
      const now = this.now().toISOString();
      reservation.externalAction = { status: 'started', startedAt: now };
      reservation.updatedAt = now;
      reservation.history.push({
        action: 'start_external',
        operationId: normalized.operationId,
        principal: normalized.principal,
        occurredAt: now,
        fromState: reservation.state,
        toState: reservation.state,
        amount: reservation.amount,
        externalActionStatus: 'started',
      });
      return { reservation: clone(reservation) };
    });
  }

  async readLedger(input: {
    tenantId: string;
    principal: string;
    scopeId: string;
  }): Promise<ResourceReservationLedgerSnapshot> {
    const normalized = normalizeScopeInput(input);
    await this.authorize({ action: 'read', input: normalized });
    await this.initialize();
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    return {
      version: ledgerVersion,
      reservations: ledger.reservations
        .filter((reservation) => reservation.tenantId === normalized.tenantId
          && reservation.scopeId === normalized.scopeId
          && reservation.principal === normalized.principal)
        .map((reservation) => clone(reservation)),
    };
  }

  private async transition(
    action: 'release' | 'cancel' | 'consume',
    input: ResourceReservationMutationInput,
    targetState: Extract<ResourceReservationState, 'released' | 'cancelled' | 'consumed'>,
  ): Promise<ResourceReservationMutationResult> {
    const normalized = normalizeMutationInput(input);
    return this.mutate(action, normalized.operationId, normalized, async (ledger) => {
      const reservation = findReservationById(ledger, normalized.reservationId, normalized);
      await this.authorize({ action, input: normalized, reservation });
      if (reservation.externalAction.status === 'started' || reservation.externalAction.status === 'unknown') {
        if (action === 'release' || action === 'cancel') {
          throw new ResourceReservationError(
            'external_action_reconciliation_required',
            `Reservation ${reservation.reservationId} has an external action in ${reservation.externalAction.status} state`,
          );
        }
      }
      const allowedStates: ResourceReservationState[] = action === 'consume' ? ['reserved'] : ['approved', 'reserved'];
      if (!allowedStates.includes(reservation.state)) {
        throw new ResourceReservationError('reservation_state_conflict', `Reservation ${reservation.reservationId} is ${reservation.state}`);
      }
      const now = this.now().toISOString();
      const previousState = reservation.state;
      reservation.state = targetState;
      reservation.updatedAt = now;
      if (action === 'consume') reservation.externalAction = { status: 'completed', startedAt: reservation.externalAction.startedAt };
      reservation.history.push({
        action,
        operationId: normalized.operationId,
        principal: normalized.principal,
        occurredAt: now,
        fromState: previousState,
        toState: targetState,
        amount: reservation.amount,
        externalActionStatus: reservation.externalAction.status,
      });
      return { reservation: clone(reservation) };
    });
  }

  private async mutate<T extends ResourceReservationMutationResult>(
    action: Exclude<ResourceReservationAction, 'estimate' | 'read'>,
    operationId: string,
    payload: unknown,
    handler: (ledger: ResourceReservationLedger) => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const payloadDigest = digest({ action, payload });
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, async (current, sidecarContent) => {
      const ledger = parseLedger(sidecarContent);
      const tenantId = extractTenantId(payload);
      const existing = ledger.operations.find((operation) => (
        operation.tenantId === tenantId && operation.operationId === operationId
      ));
      if (existing) {
        // Keep the scope boundary before comparing the payload so a caller in
        // another principal or scope cannot learn whether an operation exists.
        assertReplayScope(payload, existing.result.reservation);
        if (existing.action !== action || existing.payloadDigest !== payloadDigest) {
          throw new ResourceReservationError('operation_conflict', `Operation ${operationId} was already used with a different payload`);
        }
        // Replaying an idempotent operation still reads its stored result. The
        // caller must pass the current authorization check before that result
        // is returned, even though no new write is performed.
        await this.reauthorizeReplay(action, existing);
        return { next: current, sidecarContent: serializeLedger(ledger), result: clone(existing.result) as T };
      }
      const result = await handler(ledger);
      ledger.operations.push({
        operationId,
        tenantId,
        action,
        payloadDigest,
        result: clone(result),
        recordedAt: this.now().toISOString(),
      });
      return { next: current, sidecarContent: serializeLedger(ledger), result };
    });
  }

  private async reauthorizeReplay(
    action: Exclude<ResourceReservationAction, 'estimate' | 'read'>,
    existing: ResourceReservationStoredOperation,
  ): Promise<void> {
    const storedReservation = existing.result.reservation;
    if (action === 'approve') {
      const request = requestFromReservation(storedReservation, existing.operationId);
      await this.authorize({ action, request, reservation: storedReservation });
      return;
    }

    if (action === 'reserve') {
      const request = requestFromReservation(storedReservation, existing.operationId);
      await this.authorize({
        action,
        request,
        approvalId: storedReservation.approval.approvalId,
        reservation: storedReservation,
      });
      return;
    }

    const input: ResourceReservationMutationInput = {
      operationId: existing.operationId,
      tenantId: storedReservation.tenantId,
      principal: storedReservation.principal,
      scopeId: storedReservation.scopeId,
      reservationId: storedReservation.reservationId,
    };
    await this.authorize({ action, input, reservation: storedReservation });
  }

  private async authorize(input: {
    action: ResourceReservationAction;
    request?: ResourceReservationRequest;
    input?: ResourceReservationMutationInput | { tenantId: string; principal: string; scopeId: string };
    approvalId?: string;
    reservation?: ResourceReservationRecord;
  }): Promise<ResourceReservationAuthorizationDecision> {
    const request = input.request;
    const scopeInput = input.input;
    const mutationInput = scopeInput !== undefined && 'reservationId' in scopeInput ? scopeInput : undefined;
    const decision = await this.authorization.authorize({
      action: input.action,
      operationId: request?.operationId ?? mutationInput?.operationId ?? `read-${randomUUID()}`,
      tenantId: request?.tenantId ?? scopeInput?.tenantId ?? input.reservation?.tenantId ?? '',
      principal: request?.principal ?? scopeInput?.principal ?? input.reservation?.principal ?? '',
      scopeId: request?.scopeId ?? scopeInput?.scopeId ?? input.reservation?.scopeId ?? '',
      resourceId: request?.resourceId ?? input.reservation?.resourceId,
      runId: request?.runId ?? input.reservation?.runId,
      problem: request?.problem ?? input.reservation?.problem,
      approvalId: input.approvalId,
      reservationId: mutationInput?.reservationId ?? input.reservation?.reservationId,
      reservation: input.reservation,
    });
    if (decision.status === 'expired') throw new ResourceReservationError('approval_expired', 'Authorization approval is expired');
    if (decision.status === 'revoked') throw new ResourceReservationError('approval_revoked', 'Authorization approval is revoked');
    if (decision.status !== 'approved') throw new ResourceReservationError('authorization_denied', 'Authorization denied the resource operation');
    if (decision.expiresAt !== undefined && decision.expiresAt !== null) {
      assertTimestamp(decision.expiresAt, 'authorization.expiresAt');
      if (Date.parse(decision.expiresAt) <= this.now().getTime()) {
        throw new ResourceReservationError('approval_expired', 'Authorization approval is expired');
      }
    }
    return decision;
  }

  private async verifyProblem(request: ResourceReservationRequest): Promise<void> {
    try {
      const verified = await this.problemSnapshot.verify({
        tenantId: request.tenantId,
        principal: request.principal,
        scopeId: request.scopeId,
        reference: request.problem,
      });
      if (verified === false) throw new Error('snapshot verifier rejected reference');
    } catch {
      throw new ResourceReservationError('problem_snapshot_invalid', 'Problem snapshot reference could not be verified');
    }
  }

  private async readCapacity(request: ResourceReservationRequest): Promise<number> {
    const capacity = await this.capacity.read({
      tenantId: request.tenantId,
      principal: request.principal,
      scopeId: request.scopeId,
      resourceId: request.resourceId,
      period: request.period,
      unit: request.unit,
    });
    if (capacity === null || !Number.isFinite(capacity) || capacity < 0) {
      throw new ResourceReservationError('capacity_unknown', 'Current resource capacity is unknown');
    }
    return capacity;
  }

  private now(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ResourceReservationError('validation_error', 'Clock returned an invalid date');
    return new Date(now);
  }
}

function normalizeRequest(input: ResourceReservationRequest): ResourceReservationRequest {
  assertText(input.operationId, 'operationId');
  assertText(input.tenantId, 'tenantId');
  assertText(input.principal, 'principal');
  assertText(input.scopeId, 'scopeId');
  assertText(input.resourceId, 'resourceId');
  assertText(input.unit, 'unit');
  assertText(input.runId, 'runId');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new ResourceReservationError('validation_error', 'amount must be a positive finite number');
  const period = normalizePeriod(input.period);
  const problem = normalizeProblemReference(input.problem);
  return {
    operationId: input.operationId,
    tenantId: input.tenantId,
    principal: input.principal,
    scopeId: input.scopeId,
    resourceId: input.resourceId,
    period,
    amount: input.amount,
    unit: input.unit,
    runId: input.runId,
    problem,
  };
}

function normalizeMutationInput(input: ResourceReservationMutationInput): ResourceReservationMutationInput {
  assertText(input.operationId, 'operationId');
  assertText(input.tenantId, 'tenantId');
  assertText(input.principal, 'principal');
  assertText(input.scopeId, 'scopeId');
  assertText(input.reservationId, 'reservationId');
  return { ...input };
}

function normalizeScopeInput(input: { tenantId: string; principal: string; scopeId: string }): typeof input {
  assertText(input.tenantId, 'tenantId');
  assertText(input.principal, 'principal');
  assertText(input.scopeId, 'scopeId');
  return { ...input };
}

function normalizePeriod(period: ResourceReservationPeriod): ResourceReservationPeriod {
  assertText(period?.startsAt, 'period.startsAt');
  assertText(period?.endsAt, 'period.endsAt');
  assertTimestamp(period.startsAt, 'period.startsAt');
  assertTimestamp(period.endsAt, 'period.endsAt');
  if (Date.parse(period.endsAt) <= Date.parse(period.startsAt)) {
    throw new ResourceReservationError('validation_error', 'period.endsAt must be after period.startsAt');
  }
  return { startsAt: period.startsAt, endsAt: period.endsAt };
}

function normalizeProblemReference(reference: ResourceReservationProblemReference): ResourceReservationProblemReference {
  assertText(reference?.problem_snapshot_id, 'problem.problem_snapshot_id');
  assertText(reference?.problem_id, 'problem.problem_id');
  assertText(reference?.revision, 'problem.revision');
  if (!snapshotIdPattern.test(reference.problem_snapshot_id)) {
    throw new ResourceReservationError('validation_error', 'problem.problem_snapshot_id must be a sha256 snapshot ID');
  }
  return {
    problem_snapshot_id: reference.problem_snapshot_id,
    problem_id: reference.problem_id,
    revision: reference.revision,
  };
}

function reservationFields(request: ResourceReservationRequest): Omit<ResourceReservationRequest, 'operationId'> {
  const { operationId: _operationId, ...fields } = request;
  return fields;
}

function requestFromReservation(
  reservation: ResourceReservationRecord,
  operationId: string,
): ResourceReservationRequest {
  return {
    operationId,
    tenantId: reservation.tenantId,
    principal: reservation.principal,
    scopeId: reservation.scopeId,
    resourceId: reservation.resourceId,
    period: { ...reservation.period },
    amount: reservation.amount,
    unit: reservation.unit,
    runId: reservation.runId,
    problem: { ...reservation.problem },
  };
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ResourceReservationError('validation_error', `${label} must be a bounded text value`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new ResourceReservationError('validation_error', `${label} must be an ISO timestamp`);
}

function assertSidecarPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ResourceReservationError('validation_error', 'sidecarPath must remain relative to the SSOT root');
  }
}

function approvalFromDecision(
  decision: ResourceReservationAuthorizationDecision,
  now: Date,
): ResourceReservationApproval {
  const approvalId = decision.approvalId ?? `approval-${randomUUID()}`;
  assertText(approvalId, 'authorization.approvalId');
  const expiresAt = decision.expiresAt ?? undefined;
  if (expiresAt !== undefined) assertTimestamp(expiresAt, 'authorization.expiresAt');
  const evidence = decision.evidence ?? {};
  for (const [key, value] of Object.entries(evidence)) {
    assertText(key, 'authorization.evidence key');
    assertText(value, 'authorization.evidence value');
  }
  return {
    approvalId,
    approvedAt: now.toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
    evidence: { ...evidence },
  };
}

function assertApprovalUsable(reservation: ResourceReservationRecord, now = new Date()): void {
  if (reservation.approval.expiresAt !== undefined && Date.parse(reservation.approval.expiresAt) <= now.getTime()) {
    throw new ResourceReservationError('approval_expired', `Approval ${reservation.approval.approvalId} is expired`);
  }
}

function assertRequestMatchesReservation(request: ResourceReservationRequest, reservation: ResourceReservationRecord): void {
  if (request.tenantId !== reservation.tenantId || request.scopeId !== reservation.scopeId) {
    throw new ResourceReservationError('scope_mismatch', `Reservation ${reservation.reservationId} is outside the requested scope`);
  }
  const same = request.resourceId === reservation.resourceId
    && request.unit === reservation.unit
    && request.runId === reservation.runId
    && request.amount === reservation.amount
    && request.period.startsAt === reservation.period.startsAt
    && request.period.endsAt === reservation.period.endsAt
    && digest(request.problem) === digest(reservation.problem);
  if (!same) throw new ResourceReservationError('approval_mismatch', `Reservation ${reservation.reservationId} does not match the requested payload`);
}

function assertReplayScope(payload: unknown, reservation: ResourceReservationRecord): void {
  if (!isRecord(payload)
    || payload.tenantId !== reservation.tenantId
    || payload.principal !== reservation.principal
    || payload.scopeId !== reservation.scopeId) {
    throw new ResourceReservationError('scope_mismatch', `Stored operation ${reservation.reservationId} is outside the requested scope`);
  }
}

function findReservationById(
  ledger: ResourceReservationLedger,
  reservationId: string,
  scope: { tenantId: string; principal: string; scopeId: string },
): ResourceReservationRecord {
  const reservation = ledger.reservations.find((item) => item.reservationId === reservationId);
  if (!reservation) throw new ResourceReservationError('reservation_not_found', `Reservation ${reservationId} was not found`);
  if (reservation.tenantId !== scope.tenantId || reservation.principal !== scope.principal || reservation.scopeId !== scope.scopeId) {
    throw new ResourceReservationError('scope_mismatch', `Reservation ${reservationId} is outside the requested scope`);
  }
  return reservation;
}

function findReservationByApprovalId(
  ledger: ResourceReservationLedger,
  approvalId: string,
  scope: { tenantId: string; principal: string; scopeId: string },
): ResourceReservationRecord {
  const reservation = ledger.reservations.find((item) => item.approval.approvalId === approvalId);
  if (!reservation) throw new ResourceReservationError('approval_required', `Approval ${approvalId} was not found`);
  if (reservation.tenantId !== scope.tenantId || reservation.principal !== scope.principal || reservation.scopeId !== scope.scopeId) {
    throw new ResourceReservationError('scope_mismatch', `Approval ${approvalId} is outside the requested scope`);
  }
  return reservation;
}

function committedAmountFor(
  ledger: ResourceReservationLedger,
  request: Pick<ResourceReservationRequest, 'tenantId' | 'scopeId' | 'resourceId' | 'period' | 'unit'>,
  excludingReservationId?: string,
): number {
  return ledger.reservations
    .filter((reservation) => reservation.reservationId !== excludingReservationId)
    .filter((reservation) => reservation.state === 'reserved')
    .filter((reservation) => reservation.tenantId === request.tenantId && reservation.scopeId === request.scopeId)
    .filter((reservation) => reservation.resourceId === request.resourceId && reservation.unit === request.unit)
    .filter((reservation) => overlaps(reservation.period, request.period))
    .reduce((sum, reservation) => sum + reservation.amount, 0);
}

function overlaps(left: ResourceReservationPeriod, right: ResourceReservationPeriod): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

function parseLedger(content: string | undefined): ResourceReservationLedger {
  if (!content || content.trim() === '') return { version: ledgerVersion, reservations: [], operations: [] };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ResourceReservationError('ledger_invalid', 'Resource reservation ledger is not valid JSON');
  }
  if (!isRecord(value) || value.version !== ledgerVersion || !Array.isArray(value.reservations) || !Array.isArray(value.operations)) {
    throw new ResourceReservationError('ledger_invalid', 'Resource reservation ledger has an unsupported shape');
  }
  return value as ResourceReservationLedger;
}

function serializeLedger(ledger: ResourceReservationLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function extractTenantId(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.tenantId !== 'string') {
    throw new ResourceReservationError('validation_error', 'operation payload must include tenantId');
  }
  return payload.tenantId;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
