import { createHash } from 'node:crypto';
import { initializePersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';
import type {
  ResourceReservationMutationInput,
  ResourceReservationProblemReference,
  ResourceReservationService,
} from './resource-reservations.js';

const ledgerVersion = 1 as const;
const defaultSidecarPath = 'execution-authority/intents.json';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

export type ExecutionProblemReference = ResourceReservationProblemReference;

export interface ExecutionStartInput {
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  runId: string;
  reservationId: string;
  approvalId: string;
  authorityRef: string;
  constraintRefs: readonly string[];
  /** Evidence reference only. It never grants execution permission. */
  problem: ExecutionProblemReference;
}

export type ExecutionCheckKind = 'authority' | 'approval' | 'constraint' | 'reservation';
export type ExecutionVerificationPhase = 'initial' | 'final';
export type ExecutionCheckStatus = 'approved' | 'revoked' | 'expired' | 'unknown';
export type ExecutionReadAccessStatus = 'approved' | 'revoked' | 'expired' | 'unknown';

export interface ExecutionCheckRequest extends ExecutionStartInput {
  check: ExecutionCheckKind;
  phase: ExecutionVerificationPhase;
  /** The revision returned by the first check. Providers may fence on it. */
  expectedRevision?: string;
}

export interface ExecutionCheckResult {
  status: ExecutionCheckStatus;
  revision: string | null;
  /** Opaque token that the effect owner must consume and validate at start. */
  fencingToken?: string;
  /** Short validity bound for the fencing token. */
  expiresAt?: string;
  evidence?: Readonly<Record<string, string>>;
}

export interface ExecutionReadAccessRequest {
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  phase: 'read';
}

export interface ExecutionReadAccessResult {
  status: ExecutionReadAccessStatus;
  revision: string | null;
}

export interface ExecutionReadAccessPort {
  verify(input: ExecutionReadAccessRequest): ExecutionReadAccessResult | Promise<ExecutionReadAccessResult>;
}

export interface ExecutionAuthorityPort {
  verify(input: ExecutionCheckRequest): ExecutionCheckResult | Promise<ExecutionCheckResult>;
}

export interface ExecutionApprovalPort {
  verify(input: ExecutionCheckRequest): ExecutionCheckResult | Promise<ExecutionCheckResult>;
}

export interface ExecutionConstraintPort {
  verify(input: ExecutionCheckRequest): ExecutionCheckResult | Promise<ExecutionCheckResult>;
}

export interface ExecutionReservationPort {
  verify(input: ExecutionCheckRequest): ExecutionCheckResult | Promise<ExecutionCheckResult>;
  /** The returned revision is the read fence; the reservation store is the start linearization point. */
  markStarted(input: ExecutionReservationMarkRequest): ExecutionReservationMarkResult | Promise<ExecutionReservationMarkResult>;
}

export interface ExecutionReservationMarkRequest extends ExecutionStartInput {
  expectedRevision: string;
}

export interface ExecutionReservationMarkResult {
  status: 'started' | 'unknown';
}

export interface ExecutionEffectPort {
  /** The effect owner must consume and validate this capability at its own start boundary. */
  start(input: ExecutionEffectRequest): ExecutionEffectResult | Promise<ExecutionEffectResult>;
}

export interface ExecutionEffectRequest extends ExecutionStartInput {
  capability: ExecutionStartCapability;
}

export interface ExecutionStartCapability {
  kind: 'execution-start';
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  issuedAt: string;
  expiresAt: string;
  checks: Record<ExecutionCheckKind, {
    revision: string;
    fencingToken: string;
    expiresAt: string;
  }>;
}

export interface ExecutionEffectResult {
  status: 'started' | 'unknown';
}

export type ExecutionIntentPhase = 'recovery_required' | 'reservation_marked' | 'started' | 'unknown' | 'rejected';
export type ExecutionIntentEffectStatus = 'not_started' | 'started' | 'unknown';
export type ExecutionIntentReservationMarkStatus = 'not_started' | 'started' | 'unknown';

export interface ExecutionCheckRecord {
  check: ExecutionCheckKind;
  status: ExecutionCheckStatus;
  revision: string | null;
  fencingTokenDigest?: string;
  expiresAt?: string;
  evidence: Record<string, string>;
}

export type ExecutionAuthorityErrorCode =
  | 'validation_error'
  | 'authority_revoked'
  | 'authority_expired'
  | 'authority_unknown'
  | 'approval_revoked'
  | 'approval_expired'
  | 'approval_unknown'
  | 'constraint_revoked'
  | 'constraint_expired'
  | 'constraint_unknown'
  | 'reservation_revoked'
  | 'reservation_expired'
  | 'reservation_unknown'
  | 'read_revoked'
  | 'read_expired'
  | 'read_unknown'
  | 'revision_conflict'
  | 'fencing_unsupported'
  | 'capability_expired'
  | 'operation_conflict'
  | 'scope_mismatch'
  | 'recovery_required'
  | 'reservation_mark_unknown'
  | 'effect_unknown'
  | 'ledger_invalid';

export interface ExecutionIntentFailure {
  code: ExecutionAuthorityErrorCode;
  reason: string;
}

export interface ExecutionIntentRecord {
  version: typeof ledgerVersion;
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  runId: string;
  reservationId: string;
  approvalId: string;
  authorityRef: string;
  constraintRefs: string[];
  problem: ExecutionProblemReference;
  payloadDigest: string;
  phase: ExecutionIntentPhase;
  reservationMark: ExecutionIntentReservationMarkStatus;
  effect: {
    operationId: string;
    status: ExecutionIntentEffectStatus;
  };
  verification: {
    initial: ExecutionCheckRecord[];
    final?: ExecutionCheckRecord[];
  };
  capability?: {
    expiresAt: string;
    digest: string;
  };
  failure?: ExecutionIntentFailure;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionStartResult {
  intent: ExecutionIntentRecord;
  effect: { operationId: string; status: 'started' };
  replayed: boolean;
}

export interface ExecutionAuthorityServiceOptions {
  dataDir: string;
  authority: ExecutionAuthorityPort;
  approval: ExecutionApprovalPort;
  constraint: ExecutionConstraintPort;
  reservation: ExecutionReservationPort;
  readAccess: ExecutionReadAccessPort;
  effect: ExecutionEffectPort;
  clock?: () => Date;
  sidecarPath?: string;
}

export class ExecutionAuthorityError extends Error {
  readonly code: ExecutionAuthorityErrorCode;

  constructor(code: ExecutionAuthorityErrorCode, message: string) {
    super(message);
    this.name = 'ExecutionAuthorityError';
    this.code = code;
  }
}

interface ExecutionIntentLedger {
  version: typeof ledgerVersion;
  intents: ExecutionIntentRecord[];
}

interface VerificationResult {
  checks: ExecutionCheckRecord[];
  capability?: ExecutionStartCapability;
  failure?: ExecutionIntentFailure;
}

interface NormalizedCheck {
  record: ExecutionCheckRecord;
  fencingToken: string | null;
  expiresAt: string | null;
}

type IntentMutation = (intent: ExecutionIntentRecord) => void;

/**
 * Persists the execution intent before crossing either the reservation or
 * external-effect boundary. The reservation and intent sidecars are separate
 * transactions; callers must reconcile recovery_required/unknown states.
 */
export class ExecutionAuthorityService {
  private readonly dataDir: string;
  private readonly authority: ExecutionAuthorityPort;
  private readonly approval: ExecutionApprovalPort;
  private readonly constraint: ExecutionConstraintPort;
  private readonly reservation: ExecutionReservationPort;
  private readonly readAccess: ExecutionReadAccessPort;
  private readonly effect: ExecutionEffectPort;
  private readonly clock: () => Date;
  private readonly sidecarPath: string;

  constructor(options: ExecutionAuthorityServiceOptions) {
    assertText(options.dataDir, 'dataDir');
    if (!options.authority || typeof options.authority.verify !== 'function') throw new TypeError('authority port is required');
    if (!options.approval || typeof options.approval.verify !== 'function') throw new TypeError('approval port is required');
    if (!options.constraint || typeof options.constraint.verify !== 'function') throw new TypeError('constraint port is required');
    if (!options.reservation || typeof options.reservation.verify !== 'function' || typeof options.reservation.markStarted !== 'function') {
      throw new TypeError('reservation port is required');
    }
    if (!options.readAccess || typeof options.readAccess.verify !== 'function') throw new TypeError('read access port is required');
    if (!options.effect || typeof options.effect.start !== 'function') throw new TypeError('effect port is required');
    this.dataDir = options.dataDir;
    this.authority = options.authority;
    this.approval = options.approval;
    this.constraint = options.constraint;
    this.reservation = options.reservation;
    this.readAccess = options.readAccess;
    this.effect = options.effect;
    this.clock = options.clock ?? (() => new Date());
    this.sidecarPath = options.sidecarPath ?? defaultSidecarPath;
    assertSidecarPath(this.sidecarPath);
  }

  async initialize(): Promise<void> {
    await initializePersonalOs(this.dataDir);
  }

  async start(input: ExecutionStartInput): Promise<ExecutionStartResult> {
    const normalized = normalizeInput(input);
    const payloadDigest = digest(normalized);
    await this.initialize();
    await this.verifyReadAccess(normalized);

    const existing = await this.findIntent(normalized);
    if (existing) return this.handleExisting(existing, payloadDigest);

    const initial = await this.verifyAll(normalized, 'initial');
    if (initial.failure) throw errorFromFailure(initial.failure);

    const recorded = await this.recordIntent(normalized, payloadDigest, initial.checks);
    if (!recorded.created) return this.handleExisting(recorded.intent, payloadDigest);

    const expectedRevisions = Object.fromEntries(initial.checks.map((check) => [check.check, check.revision ?? ''])) as Record<ExecutionCheckKind, string>;
    const final = await this.verifyAll(normalized, 'final', expectedRevisions);
    if (final.failure) {
      await this.tryUpdateIntent(normalized, payloadDigest, (intent) => {
        intent.verification.final = final.checks;
        intent.phase = 'rejected';
        intent.failure = final.failure;
      });
      throw errorFromFailure(final.failure);
    }

    if (!final.capability) {
      const failure: ExecutionIntentFailure = {
        code: 'fencing_unsupported',
        reason: 'Final execution checks did not provide a fencing capability',
      };
      await this.tryUpdateIntent(normalized, payloadDigest, (intent) => {
        intent.verification.final = final.checks;
        intent.phase = 'rejected';
        intent.failure = failure;
      });
      throw errorFromFailure(failure);
    }

    await this.updateIntent(normalized, payloadDigest, (intent) => {
      intent.verification.final = final.checks;
      intent.capability = {
        expiresAt: final.capability!.expiresAt,
        digest: digest(final.capability!),
      };
    });

    let mark: ExecutionReservationMarkResult;
    try {
      const reservationCheck = final.checks.find((check) => check.check === 'reservation');
      if (!reservationCheck || reservationCheck.status !== 'approved' || reservationCheck.revision === null) {
        throw new ExecutionAuthorityError('ledger_invalid', 'Reservation verification did not provide a start fence');
      }
      mark = normalizeMarkResult(await this.reservation.markStarted({
        ...normalized,
        expectedRevision: reservationCheck.revision,
      }));
    } catch {
      await this.persistRecovery(normalized, payloadDigest, {
        code: 'reservation_mark_unknown',
        reason: 'reservation start mark may have committed before the provider failed',
        reservationMark: 'unknown',
        effect: 'unknown',
      });
      throw new ExecutionAuthorityError('reservation_mark_unknown', 'Reservation start could not be determined; reconciliation is required');
    }
    if (mark.status !== 'started') {
      await this.persistRecovery(normalized, payloadDigest, {
        code: 'reservation_mark_unknown',
        reason: 'reservation provider returned an unknown start state',
        reservationMark: 'unknown',
        effect: 'unknown',
      });
      throw new ExecutionAuthorityError('reservation_mark_unknown', 'Reservation start is unknown; reconciliation is required');
    }

    try {
      await this.updateIntent(normalized, payloadDigest, (intent) => {
        intent.phase = 'reservation_marked';
        intent.reservationMark = 'started';
        // A crash after this write and during effect.start is ambiguous.
        intent.effect.status = 'unknown';
      });
    } catch {
      throw new ExecutionAuthorityError('recovery_required', 'Reservation started but the execution intent could not be advanced');
    }

    let effectResult: ExecutionEffectResult;
    try {
      effectResult = normalizeEffectResult(await this.effect.start({ ...normalized, capability: final.capability }));
    } catch {
      await this.persistRecovery(normalized, payloadDigest, {
        code: 'effect_unknown',
        reason: 'effect provider failed after the reservation start boundary',
        reservationMark: 'started',
        effect: 'unknown',
        phase: 'unknown',
      });
      throw new ExecutionAuthorityError('effect_unknown', 'External effect start is unknown; reconciliation is required');
    }
    if (effectResult.status !== 'started') {
      await this.persistRecovery(normalized, payloadDigest, {
        code: 'effect_unknown',
        reason: 'effect provider returned an unknown start state',
        reservationMark: 'started',
        effect: 'unknown',
        phase: 'unknown',
      });
      throw new ExecutionAuthorityError('effect_unknown', 'External effect start is unknown; reconciliation is required');
    }

    try {
      const intent = await this.updateIntent(normalized, payloadDigest, (next) => {
        next.phase = 'started';
        next.reservationMark = 'started';
        next.effect.status = 'started';
      });
      return {
        intent,
        effect: { operationId: normalized.operationId, status: 'started' },
        replayed: false,
      };
    } catch {
      throw new ExecutionAuthorityError('recovery_required', 'Effect started but the execution intent could not be finalized');
    }
  }

  async readIntent(input: Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'>): Promise<ExecutionIntentRecord | undefined> {
    const lookup = normalizeLookup(input);
    await this.initialize();
    await this.verifyReadAccess(lookup);
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const intent = ledger.intents.find((candidate) => candidate.tenantId === lookup.tenantId && candidate.operationId === lookup.operationId);
    if (!intent) return undefined;
    assertIntentScope(lookup, intent);
    return clone(intent);
  }

  private async findIntent(input: ExecutionStartInput): Promise<ExecutionIntentRecord | undefined> {
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const intent = ledger.intents.find((candidate) => candidate.tenantId === input.tenantId && candidate.operationId === input.operationId);
    if (!intent) return undefined;
    assertIntentScope(input, intent);
    return clone(intent);
  }

  private async verifyReadAccess(input: Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'>): Promise<void> {
    let result: ExecutionReadAccessResult;
    try {
      result = await this.readAccess.verify({ ...input, phase: 'read' });
    } catch {
      result = { status: 'unknown', revision: null };
    }
    const status = result && typeof result === 'object' && ['approved', 'revoked', 'expired', 'unknown'].includes(result.status)
      ? result.status
      : 'unknown';
    if (status === 'approved') return;
    const code = status === 'revoked' ? 'read_revoked' : status === 'expired' ? 'read_expired' : 'read_unknown';
    throw new ExecutionAuthorityError(code, `Current execution intent read access is ${status}`);
  }

  private async recordIntent(
    input: ExecutionStartInput,
    payloadDigest: string,
    checks: ExecutionCheckRecord[],
  ): Promise<{ intent: ExecutionIntentRecord; created: boolean }> {
    return mutatePersonalOsWithSidecar<{ intent: ExecutionIntentRecord; created: boolean }>(this.dataDir, this.sidecarPath, async (current, sidecarContent) => {
      const ledger = parseLedger(sidecarContent);
      const existing = ledger.intents.find((candidate) => candidate.tenantId === input.tenantId && candidate.operationId === input.operationId);
      if (existing) {
        assertIntentScope(input, existing);
        if (existing.payloadDigest !== payloadDigest) {
          throw new ExecutionAuthorityError('operation_conflict', `Operation ${input.operationId} was already used with a different payload`);
        }
        return { next: current, sidecarContent: serializeLedger(ledger), result: { intent: clone(existing), created: false } };
      }
      const now = this.now().toISOString();
      const intent: ExecutionIntentRecord = {
        version: ledgerVersion,
        operationId: input.operationId,
        tenantId: input.tenantId,
        principal: input.principal,
        scopeId: input.scopeId,
        runId: input.runId,
        reservationId: input.reservationId,
        approvalId: input.approvalId,
        authorityRef: input.authorityRef,
        constraintRefs: [...input.constraintRefs],
        problem: { ...input.problem },
        payloadDigest,
        // This is deliberately a non-replayable durable state. The current
        // call may continue in memory; a later caller must reconcile it.
        phase: 'recovery_required',
        reservationMark: 'not_started',
        effect: { operationId: input.operationId, status: 'not_started' },
        verification: { initial: clone(checks) },
        createdAt: now,
        updatedAt: now,
      };
      ledger.intents.push(intent);
      return { next: current, sidecarContent: serializeLedger(ledger), result: { intent: clone(intent), created: true } };
    });
  }

  private async updateIntent(input: ExecutionStartInput, payloadDigest: string, mutation: IntentMutation): Promise<ExecutionIntentRecord> {
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, async (current, sidecarContent) => {
      const ledger = parseLedger(sidecarContent);
      const index = ledger.intents.findIndex((candidate) => candidate.tenantId === input.tenantId && candidate.operationId === input.operationId);
      if (index < 0) throw new ExecutionAuthorityError('ledger_invalid', `Execution intent ${input.operationId} was not found`);
      const existing = ledger.intents[index];
      assertIntentScope(input, existing);
      if (existing.payloadDigest !== payloadDigest) {
        throw new ExecutionAuthorityError('operation_conflict', `Operation ${input.operationId} was already used with a different payload`);
      }
      const nextIntent = clone(existing);
      mutation(nextIntent);
      nextIntent.updatedAt = this.now().toISOString();
      ledger.intents[index] = nextIntent;
      return { next: current, sidecarContent: serializeLedger(ledger), result: clone(nextIntent) };
    });
  }

  private async tryUpdateIntent(input: ExecutionStartInput, payloadDigest: string, mutation: IntentMutation): Promise<void> {
    try {
      await this.updateIntent(input, payloadDigest, mutation);
    } catch {
      // The durable recovery_required state is safer than retrying a failed
      // cross-sidecar transition. Preserve the original denial to the caller.
    }
  }

  private async persistRecovery(
    input: ExecutionStartInput,
    payloadDigest: string,
    options: {
      code: ExecutionAuthorityErrorCode;
      reason: string;
      reservationMark: ExecutionIntentReservationMarkStatus;
      effect: ExecutionIntentEffectStatus;
      phase?: ExecutionIntentPhase;
    },
  ): Promise<void> {
    await this.tryUpdateIntent(input, payloadDigest, (intent) => {
      intent.phase = options.phase ?? 'recovery_required';
      intent.reservationMark = options.reservationMark;
      intent.effect.status = options.effect;
      intent.failure = { code: options.code, reason: options.reason };
    });
  }

  private async verifyAll(
    input: ExecutionStartInput,
    phase: ExecutionVerificationPhase,
    expectedRevisions?: Record<ExecutionCheckKind, string>,
  ): Promise<VerificationResult> {
    const providers: Array<[ExecutionCheckKind, ExecutionAuthorityPort]> = [
      ['authority', this.authority],
      ['approval', this.approval],
      ['constraint', this.constraint],
      ['reservation', this.reservation],
    ];
    const normalizedChecks = await Promise.all(providers.map(async ([check, provider]) => {
      let result: ExecutionCheckResult;
      try {
        result = await provider.verify({
          ...input,
          check,
          phase,
          expectedRevision: expectedRevisions?.[check],
        });
      } catch {
        result = { status: 'unknown', revision: null };
      }
      return normalizeCheckResult(check, result);
    }));
    const checks = normalizedChecks.map(({ record }) => record);

    const denied = checks.find((check) => check.status !== 'approved');
    if (denied) {
      return {
        checks,
        failure: {
          code: checkFailureCode(denied.check, denied.status as Exclude<ExecutionCheckStatus, 'approved'>),
          reason: `${denied.check} provider returned ${denied.status}`,
        },
      };
    }
    if (expectedRevisions) {
      const changed = checks.find((check) => check.revision !== expectedRevisions[check.check]);
      if (changed) {
        return { checks, failure: { code: 'revision_conflict', reason: `${changed.check} revision changed before execution start` } };
      }
    }
    if (phase !== 'final') return { checks };

    const missingFence = normalizedChecks.find(({ fencingToken, expiresAt }) => fencingToken === null || expiresAt === null);
    if (missingFence) {
      return { checks, failure: { code: 'fencing_unsupported', reason: `${missingFence.record.check} provider did not return an execution fencing capability` } };
    }
    const now = this.now();
    const expirationTimes = normalizedChecks.map(({ expiresAt }) => Date.parse(expiresAt!));
    const earliestExpiration = Math.min(...expirationTimes);
    if (!Number.isFinite(earliestExpiration) || earliestExpiration <= now.getTime()) {
      return { checks, failure: { code: 'capability_expired', reason: 'Execution fencing capability is already expired' } };
    }
    const capability: ExecutionStartCapability = {
      kind: 'execution-start',
      operationId: input.operationId,
      tenantId: input.tenantId,
      principal: input.principal,
      scopeId: input.scopeId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(earliestExpiration).toISOString(),
      checks: Object.fromEntries(normalizedChecks.map(({ record, fencingToken, expiresAt }) => [record.check, {
        revision: record.revision!,
        fencingToken: fencingToken!,
        expiresAt: expiresAt!,
      }])) as ExecutionStartCapability['checks'],
    };
    return { checks, capability };
  }

  private handleExisting(intent: ExecutionIntentRecord, payloadDigest: string): ExecutionStartResult {
    if (intent.payloadDigest !== payloadDigest) {
      throw new ExecutionAuthorityError('operation_conflict', `Operation ${intent.operationId} was already used with a different payload`);
    }
    if (intent.phase === 'started' && intent.effect.status === 'started') {
      return {
        intent: clone(intent),
        effect: { operationId: intent.operationId, status: 'started' },
        replayed: true,
      };
    }
    if (intent.phase === 'rejected' && intent.failure) throw errorFromFailure(intent.failure);
    if (intent.phase === 'unknown' && intent.failure?.code === 'effect_unknown') {
      throw errorFromFailure(intent.failure);
    }
    throw new ExecutionAuthorityError('recovery_required', `Operation ${intent.operationId} requires reconciliation before another attempt`);
  }

  private now(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ExecutionAuthorityError('validation_error', 'Clock returned an invalid date');
    return new Date(now);
  }
}

/**
 * Binds the existing reservation store to the execution port without calling
 * it from inside the execution sidecar transaction. The store remains the
 * owner of its current authorization and reservation-state checks.
 */
export function createResourceReservationExecutionPort(options: {
  service: Pick<ResourceReservationService, 'readLedger' | 'startExternalAction'>;
}): ExecutionReservationPort {
  if (!options || !options.service || typeof options.service.readLedger !== 'function' || typeof options.service.startExternalAction !== 'function') {
    throw new TypeError('resource reservation service is required');
  }
  return {
    async verify(input): Promise<ExecutionCheckResult> {
      try {
        const snapshot = await options.service.readLedger({
          tenantId: input.tenantId,
          principal: input.principal,
          scopeId: input.scopeId,
        });
        const reservation = snapshot.reservations.find((candidate) => candidate.reservationId === input.reservationId);
        if (!reservation || reservation.state !== 'reserved') return { status: 'revoked', revision: 'missing' };
        const revision = `${reservation.reservationId}:${reservation.updatedAt}`;
        if (reservation.externalAction.status !== 'not_started') return { status: 'unknown', revision };
        const expiresAt = reservation.approval.expiresAt;
        if (!expiresAt) return { status: 'unknown', revision };
        return {
          status: 'approved',
          revision,
          fencingToken: `reservation:${revision}`,
          expiresAt,
        };
      } catch {
        return { status: 'unknown', revision: null };
      }
    },
    async markStarted(input: ExecutionReservationMarkRequest): Promise<ExecutionReservationMarkResult> {
      try {
        const snapshot = await options.service.readLedger({
          tenantId: input.tenantId,
          principal: input.principal,
          scopeId: input.scopeId,
        });
        const reservation = snapshot.reservations.find((candidate) => candidate.reservationId === input.reservationId);
        if (!reservation || reservation.state !== 'reserved' || reservation.externalAction.status !== 'not_started') {
          return { status: 'unknown' };
        }
        const currentRevision = `${reservation.reservationId}:${reservation.updatedAt}`;
        if (currentRevision !== input.expectedRevision) return { status: 'unknown' };
        const result = await options.service.startExternalAction(toReservationMutationInput(input));
        return { status: result.reservation.externalAction.status === 'started' ? 'started' : 'unknown' };
      } catch {
        return { status: 'unknown' };
      }
    },
  };
}

function toReservationMutationInput(input: ExecutionStartInput): ResourceReservationMutationInput {
  return {
    operationId: input.operationId,
    tenantId: input.tenantId,
    principal: input.principal,
    scopeId: input.scopeId,
    reservationId: input.reservationId,
  };
}

function normalizeInput(input: ExecutionStartInput): ExecutionStartInput {
  if (!input || typeof input !== 'object') throw new ExecutionAuthorityError('validation_error', 'execution input is required');
  assertText(input.operationId, 'operationId');
  assertText(input.tenantId, 'tenantId');
  assertText(input.principal, 'principal');
  assertText(input.scopeId, 'scopeId');
  assertText(input.runId, 'runId');
  assertText(input.reservationId, 'reservationId');
  assertText(input.approvalId, 'approvalId');
  assertText(input.authorityRef, 'authorityRef');
  if (!Array.isArray(input.constraintRefs)) throw new ExecutionAuthorityError('validation_error', 'constraintRefs must be an array');
  const constraintRefs = input.constraintRefs.map((ref, index) => {
    assertText(ref, `constraintRefs[${index}]`);
    return ref;
  });
  const problem = normalizeProblem(input.problem);
  return {
    operationId: input.operationId,
    tenantId: input.tenantId,
    principal: input.principal,
    scopeId: input.scopeId,
    runId: input.runId,
    reservationId: input.reservationId,
    approvalId: input.approvalId,
    authorityRef: input.authorityRef,
    constraintRefs,
    problem,
  };
}

function normalizeLookup(input: Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'>): Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'> {
  if (!input || typeof input !== 'object') throw new ExecutionAuthorityError('validation_error', 'execution lookup is required');
  assertText(input.operationId, 'operationId');
  assertText(input.tenantId, 'tenantId');
  assertText(input.principal, 'principal');
  assertText(input.scopeId, 'scopeId');
  return { operationId: input.operationId, tenantId: input.tenantId, principal: input.principal, scopeId: input.scopeId };
}

function normalizeProblem(problem: ExecutionProblemReference): ExecutionProblemReference {
  assertText(problem?.problem_snapshot_id, 'problem.problem_snapshot_id');
  assertText(problem?.problem_id, 'problem.problem_id');
  assertText(problem?.revision, 'problem.revision');
  if (!snapshotIdPattern.test(problem.problem_snapshot_id)) {
    throw new ExecutionAuthorityError('validation_error', 'problem.problem_snapshot_id must be a sha256 snapshot ID');
  }
  return {
    problem_snapshot_id: problem.problem_snapshot_id,
    problem_id: problem.problem_id,
    revision: problem.revision,
  };
}

function normalizeCheckResult(check: ExecutionCheckKind, result: ExecutionCheckResult): NormalizedCheck {
  const status = result && typeof result === 'object' && ['approved', 'revoked', 'expired', 'unknown'].includes(result.status)
    ? result.status
    : 'unknown';
  const revision = typeof result?.revision === 'string' && result.revision.length > 0 ? result.revision : null;
  const fencingToken = isText(result?.fencingToken) ? result.fencingToken : null;
  const expiresAt = normalizeExpiration(result?.expiresAt);
  const evidence = normalizeEvidence(result?.evidence);
  if (status === 'approved' && revision === null) {
    return {
      record: { check, status: 'unknown', revision: null, fencingTokenDigest: fencingToken ? digest(fencingToken) : undefined, expiresAt: expiresAt ?? undefined, evidence },
      fencingToken,
      expiresAt,
    };
  }
  return {
    record: { check, status, revision, fencingTokenDigest: fencingToken ? digest(fencingToken) : undefined, expiresAt: expiresAt ?? undefined, evidence },
    fencingToken,
    expiresAt,
  };
}

function normalizeExpiration(value: unknown): string | null {
  if (!isText(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function normalizeMarkResult(result: ExecutionReservationMarkResult): ExecutionReservationMarkResult {
  if (!result || (result.status !== 'started' && result.status !== 'unknown')) return { status: 'unknown' };
  return { status: result.status };
}

function normalizeEffectResult(result: ExecutionEffectResult): ExecutionEffectResult {
  if (!result || (result.status !== 'started' && result.status !== 'unknown')) return { status: 'unknown' };
  return { status: result.status };
}

function normalizeEvidence(evidence: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (isText(key) && isText(value)) normalized[key] = value;
  }
  return normalized;
}

function checkFailureCode(check: ExecutionCheckKind, status: Exclude<ExecutionCheckStatus, 'approved'>): ExecutionAuthorityErrorCode {
  if (status === 'revoked') return `${check}_revoked` as ExecutionAuthorityErrorCode;
  if (status === 'expired') return `${check}_expired` as ExecutionAuthorityErrorCode;
  return `${check}_unknown` as ExecutionAuthorityErrorCode;
}

function errorFromFailure(failure: ExecutionIntentFailure): ExecutionAuthorityError {
  return new ExecutionAuthorityError(failure.code, failure.reason);
}

function assertIntentScope(input: Pick<ExecutionStartInput, 'tenantId' | 'principal' | 'scopeId'>, intent: ExecutionIntentRecord): void {
  if (input.tenantId !== intent.tenantId || input.principal !== intent.principal || input.scopeId !== intent.scopeId) {
    throw new ExecutionAuthorityError('scope_mismatch', `Execution intent ${intent.operationId} is outside the requested scope`);
  }
}

function parseLedger(content: string | undefined): ExecutionIntentLedger {
  if (!content || content.trim() === '') return { version: ledgerVersion, intents: [] };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new ExecutionAuthorityError('ledger_invalid', 'Execution intent ledger is not valid JSON');
  }
  if (!isRecord(value) || value.version !== ledgerVersion || !Array.isArray(value.intents)) {
    throw new ExecutionAuthorityError('ledger_invalid', 'Execution intent ledger has an unsupported shape');
  }
  for (const intent of value.intents) validateStoredIntent(intent);
  return value as ExecutionIntentLedger;
}

function validateStoredIntent(value: unknown): void {
  if (!isRecord(value)
    || value.version !== ledgerVersion
    || !isText(value.operationId)
    || !isText(value.tenantId)
    || !isText(value.principal)
    || !isText(value.scopeId)
    || !isText(value.payloadDigest)
    || !['recovery_required', 'reservation_marked', 'started', 'unknown', 'rejected'].includes(value.phase)
    || !['not_started', 'started', 'unknown'].includes(value.reservationMark)
    || !isRecord(value.effect)
    || value.effect.operationId !== value.operationId
    || !['not_started', 'started', 'unknown'].includes(value.effect.status)
    || !isRecord(value.verification)
    || !Array.isArray(value.verification.initial)
    || !Array.isArray(value.constraintRefs)
    || !isRecord(value.problem)
    || !isText(value.createdAt)
    || !isText(value.updatedAt)) {
    throw new ExecutionAuthorityError('ledger_invalid', 'Execution intent ledger contains an invalid record');
  }
}

function serializeLedger(ledger: ExecutionIntentLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
}

function assertText(value: unknown, label: string): asserts value is string {
  if (!isText(value)) throw new ExecutionAuthorityError('validation_error', `${label} must be a bounded text value`);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function assertSidecarPath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ExecutionAuthorityError('validation_error', 'sidecarPath must remain relative to the SSOT root');
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
