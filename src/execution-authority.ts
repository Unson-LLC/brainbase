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

/**
 * Who started the execution, as resolved by the host from authenticated
 * context. Request bodies never supply it.
 */
export type ExecutionAttributionMode = 'person' | 'delegated_service' | 'service';

export interface ExecutionAttribution {
  /** person: the principal acted directly. delegated_service: a service acted for the principal. service: an automated job acted on its own authority. */
  mode: ExecutionAttributionMode;
  /** Authenticated service principal. Required unless mode is person. */
  servicePrincipal?: string;
  /** Verified delegation, or for mode service the authority grant that the job relies on. */
  delegationRef?: string;
  correlationId?: string;
}

export interface ExecutionRequestOptions {
  attribution?: ExecutionAttribution;
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
  /** Present when the host resolved an attribution; providers verify delegation with it. */
  attribution?: ExecutionAttribution;
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
  attribution?: ExecutionAttribution;
  checks: Record<ExecutionCheckKind, {
    revision: string;
    fencingToken: string;
    expiresAt: string;
  }>;
}

export interface ExecutionEffectResult {
  status: 'started' | 'unknown';
}

/** registered: checks passed and a permit was issued; the effect owner has not reported yet. */
export type ExecutionIntentPhase = 'recovery_required' | 'reservation_marked' | 'registered' | 'started' | 'unknown' | 'rejected';
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
  | 'effect_unconfigured'
  | 'capability_mismatch'
  | 'intent_not_found'
  | 'store_unavailable'
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
  attribution?: ExecutionAttribution;
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
    /** Stored only for registrations so a lost response can be replayed. Never returned to readers. */
    grant?: ExecutionStartCapability;
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

export interface ExecutionRegistrationResult {
  intent: ExecutionIntentRecord;
  capability: ExecutionStartCapability;
  capabilityDigest: string;
  replayed: boolean;
}

export interface ExecutionEffectReport {
  operationId: string;
  tenantId: string;
  principal: string;
  scopeId: string;
  /** Binds the report to the issued permit. It is not a secret. */
  capabilityDigest: string;
  status: 'started' | 'unknown';
}

export interface ExecutionIntentKey {
  tenantId: string;
  operationId: string;
}

/**
 * Durable intent storage. A host injects a database adapter here; the default
 * is the local sidecar. insert and update must each be atomic per key.
 */
export interface ExecutionIntentStore {
  initialize?(): Promise<void>;
  read(key: ExecutionIntentKey): Promise<ExecutionIntentRecord | undefined>;
  /** Stores the intent when the key is absent; otherwise returns the existing record with created false. */
  insert(intent: ExecutionIntentRecord): Promise<{ intent: ExecutionIntentRecord; created: boolean }>;
  /** Writes mutate(current) atomically. Returns undefined when absent. A throwing mutate writes nothing and rethrows. */
  update(
    key: ExecutionIntentKey,
    mutate: (current: ExecutionIntentRecord) => ExecutionIntentRecord,
  ): Promise<ExecutionIntentRecord | undefined>;
}

export interface ExecutionAuthorityServiceOptions {
  /** Used for the default sidecar store when store is omitted. */
  dataDir?: string;
  store?: ExecutionIntentStore;
  authority: ExecutionAuthorityPort;
  approval: ExecutionApprovalPort;
  constraint: ExecutionConstraintPort;
  reservation: ExecutionReservationPort;
  readAccess: ExecutionReadAccessPort;
  /** Required for start. Registration-only hosts leave the effect to its owner. */
  effect?: ExecutionEffectPort;
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
type ExecutionMode = 'start' | 'register';

/**
 * Persists the execution intent before crossing either the reservation or
 * external-effect boundary. The reservation and intent stores are separate
 * transactions; callers must reconcile recovery_required/unknown states.
 */
export class ExecutionAuthorityService {
  private readonly store: ExecutionIntentStore;
  private readonly authority: ExecutionAuthorityPort;
  private readonly approval: ExecutionApprovalPort;
  private readonly constraint: ExecutionConstraintPort;
  private readonly reservation: ExecutionReservationPort;
  private readonly readAccess: ExecutionReadAccessPort;
  private readonly effect: ExecutionEffectPort | undefined;
  private readonly clock: () => Date;

  constructor(options: ExecutionAuthorityServiceOptions) {
    if (!options.authority || typeof options.authority.verify !== 'function') throw new TypeError('authority port is required');
    if (!options.approval || typeof options.approval.verify !== 'function') throw new TypeError('approval port is required');
    if (!options.constraint || typeof options.constraint.verify !== 'function') throw new TypeError('constraint port is required');
    if (!options.reservation || typeof options.reservation.verify !== 'function' || typeof options.reservation.markStarted !== 'function') {
      throw new TypeError('reservation port is required');
    }
    if (!options.readAccess || typeof options.readAccess.verify !== 'function') throw new TypeError('read access port is required');
    if (options.effect !== undefined && (!options.effect || typeof options.effect.start !== 'function')) {
      throw new TypeError('effect port must implement start');
    }
    if (options.store) {
      if (typeof options.store.read !== 'function' || typeof options.store.insert !== 'function' || typeof options.store.update !== 'function') {
        throw new TypeError('store must implement read, insert, and update');
      }
      this.store = options.store;
    } else {
      if (!isText(options.dataDir)) throw new TypeError('store or dataDir is required');
      this.store = createSidecarExecutionIntentStore({ dataDir: options.dataDir, sidecarPath: options.sidecarPath });
    }
    this.authority = options.authority;
    this.approval = options.approval;
    this.constraint = options.constraint;
    this.reservation = options.reservation;
    this.readAccess = options.readAccess;
    this.effect = options.effect;
    this.clock = options.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await this.storeCall(async () => { await this.store.initialize?.(); });
  }

  /** Runs the checks, marks the reservation, and calls the in-process effect port. */
  async start(input: ExecutionStartInput, options: ExecutionRequestOptions = {}): Promise<ExecutionStartResult> {
    if (!this.effect) throw new ExecutionAuthorityError('effect_unconfigured', 'This host has no effect port; use register instead');
    const normalized = normalizeInput(input);
    const attribution = normalizeAttribution(options.attribution, normalized.principal);
    const payloadDigest = digest(normalized);
    await this.initialize();
    await this.verifyReadAccess(normalized);

    const existing = await this.findIntent(normalized);
    if (existing) return this.handleExisting(existing, payloadDigest, attribution);

    const prepared = await this.prepare(normalized, payloadDigest, attribution, 'start');
    if ('replay' in prepared) return this.handleExisting(prepared.replay, payloadDigest, attribution);

    let effectResult: ExecutionEffectResult;
    try {
      effectResult = normalizeEffectResult(await this.effect.start({ ...normalized, capability: prepared.capability }));
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
        intent: publicIntent(intent),
        effect: { operationId: normalized.operationId, status: 'started' },
        replayed: false,
      };
    } catch {
      throw new ExecutionAuthorityError('recovery_required', 'Effect started but the execution intent could not be finalized');
    }
  }

  /**
   * Registers the execution: runs the checks, marks the reservation, and
   * issues the permit. The effect owner reports the outcome with reportEffect.
   */
  async register(input: ExecutionStartInput, options: ExecutionRequestOptions = {}): Promise<ExecutionRegistrationResult> {
    const normalized = normalizeInput(input);
    const attribution = normalizeAttribution(options.attribution, normalized.principal);
    const payloadDigest = digest(normalized);
    await this.initialize();
    await this.verifyReadAccess(normalized);

    const existing = await this.findIntent(normalized);
    if (existing) return this.replayRegistration(existing, payloadDigest, attribution);

    const prepared = await this.prepare(normalized, payloadDigest, attribution, 'register');
    if ('replay' in prepared) return this.replayRegistration(prepared.replay, payloadDigest, attribution);
    return {
      intent: publicIntent(prepared.intent),
      capability: clone(prepared.capability),
      capabilityDigest: prepared.capabilityDigest,
      replayed: false,
    };
  }

  /** Records the effect owner's outcome for a registered execution. */
  async reportEffect(report: ExecutionEffectReport): Promise<ExecutionIntentRecord> {
    const lookup = normalizeLookup(report);
    if (report.status !== 'started' && report.status !== 'unknown') {
      throw new ExecutionAuthorityError('validation_error', 'status must be started or unknown');
    }
    assertText(report.capabilityDigest, 'capabilityDigest');
    await this.initialize();
    await this.verifyReadAccess(lookup);
    const updated = await this.storeCall(() => this.store.update(intentKey(lookup), (current) => {
      validateStoredIntent(current);
      assertIntentScope(lookup, current);
      if (current.capability?.digest !== report.capabilityDigest) {
        throw new ExecutionAuthorityError('capability_mismatch', 'The report does not match the issued permit');
      }
      const next = clone(current);
      if (report.status === 'started') {
        if (current.phase === 'started') return current;
        if (current.phase !== 'registered' && current.phase !== 'unknown') {
          throw new ExecutionAuthorityError('recovery_required', `Operation ${current.operationId} requires reconciliation before a report`);
        }
        next.phase = 'started';
        next.effect.status = 'started';
        delete next.failure;
      } else {
        if (current.phase === 'unknown') return current;
        if (current.phase === 'started') {
          throw new ExecutionAuthorityError('operation_conflict', `Operation ${current.operationId} already reported a started effect`);
        }
        if (current.phase !== 'registered') {
          throw new ExecutionAuthorityError('recovery_required', `Operation ${current.operationId} requires reconciliation before a report`);
        }
        next.phase = 'unknown';
        next.effect.status = 'unknown';
        next.failure = { code: 'effect_unknown', reason: 'effect owner reported an unknown outcome' };
      }
      next.updatedAt = this.now().toISOString();
      return next;
    }));
    if (!updated) throw new ExecutionAuthorityError('intent_not_found', `Execution intent ${lookup.operationId} was not found`);
    validateStoredIntent(updated);
    return publicIntent(updated);
  }

  async readIntent(input: Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'>): Promise<ExecutionIntentRecord | undefined> {
    const lookup = normalizeLookup(input);
    await this.initialize();
    await this.verifyReadAccess(lookup);
    const intent = await this.findIntent(lookup);
    return intent ? publicIntent(intent) : undefined;
  }

  /**
   * Shared path for start and register: initial checks, durable intent,
   * fenced final checks, permit, and the reservation mark.
   */
  private async prepare(
    normalized: ExecutionStartInput,
    payloadDigest: string,
    attribution: ExecutionAttribution | undefined,
    mode: ExecutionMode,
  ): Promise<{ replay: ExecutionIntentRecord } | { intent: ExecutionIntentRecord; capability: ExecutionStartCapability; capabilityDigest: string }> {
    const initial = await this.verifyAll(normalized, 'initial', undefined, attribution);
    if (initial.failure) throw errorFromFailure(initial.failure);

    const recorded = await this.recordIntent(normalized, payloadDigest, initial.checks, attribution);
    if (!recorded.created) return { replay: recorded.intent };

    const expectedRevisions = Object.fromEntries(initial.checks.map((check) => [check.check, check.revision ?? ''])) as Record<ExecutionCheckKind, string>;
    const final = await this.verifyAll(normalized, 'final', expectedRevisions, attribution);
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
    const capability = final.capability;
    const capabilityDigest = digest(capability);

    await this.updateIntent(normalized, payloadDigest, (intent) => {
      intent.verification.final = final.checks;
      intent.capability = {
        expiresAt: capability.expiresAt,
        digest: capabilityDigest,
        ...(mode === 'register' ? { grant: clone(capability) } : {}),
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
      const intent = await this.updateIntent(normalized, payloadDigest, (next) => {
        next.reservationMark = 'started';
        if (mode === 'register') {
          // The permit is issued; the effect owner has not started yet.
          next.phase = 'registered';
          next.effect.status = 'not_started';
        } else {
          next.phase = 'reservation_marked';
          // A crash after this write and during effect.start is ambiguous.
          next.effect.status = 'unknown';
        }
      });
      return { intent, capability, capabilityDigest };
    } catch {
      throw new ExecutionAuthorityError('recovery_required', 'Reservation started but the execution intent could not be advanced');
    }
  }

  private async findIntent(input: Pick<ExecutionStartInput, 'operationId' | 'tenantId' | 'principal' | 'scopeId'>): Promise<ExecutionIntentRecord | undefined> {
    const intent = await this.storeCall(() => this.store.read(intentKey(input)));
    if (!intent) return undefined;
    validateStoredIntent(intent);
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
    attribution: ExecutionAttribution | undefined,
  ): Promise<{ intent: ExecutionIntentRecord; created: boolean }> {
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
      ...(attribution ? { attribution: clone(attribution) } : {}),
      // This is deliberately a non-replayable durable state. The current
      // call may continue in memory; a later caller must reconcile it.
      phase: 'recovery_required',
      reservationMark: 'not_started',
      effect: { operationId: input.operationId, status: 'not_started' },
      verification: { initial: clone(checks) },
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.storeCall(() => this.store.insert(intent));
    validateStoredIntent(result.intent);
    if (!result.created) {
      assertIntentScope(input, result.intent);
      if (result.intent.payloadDigest !== payloadDigest) {
        throw new ExecutionAuthorityError('operation_conflict', `Operation ${input.operationId} was already used with a different payload`);
      }
    }
    return { intent: clone(result.intent), created: result.created };
  }

  private async updateIntent(input: ExecutionStartInput, payloadDigest: string, mutation: IntentMutation): Promise<ExecutionIntentRecord> {
    const updated = await this.storeCall(() => this.store.update(intentKey(input), (existing) => {
      validateStoredIntent(existing);
      assertIntentScope(input, existing);
      if (existing.payloadDigest !== payloadDigest) {
        throw new ExecutionAuthorityError('operation_conflict', `Operation ${input.operationId} was already used with a different payload`);
      }
      const nextIntent = clone(existing);
      mutation(nextIntent);
      nextIntent.updatedAt = this.now().toISOString();
      return nextIntent;
    }));
    if (!updated) throw new ExecutionAuthorityError('ledger_invalid', `Execution intent ${input.operationId} was not found`);
    validateStoredIntent(updated);
    return clone(updated);
  }

  private async tryUpdateIntent(input: ExecutionStartInput, payloadDigest: string, mutation: IntentMutation): Promise<void> {
    try {
      await this.updateIntent(input, payloadDigest, mutation);
    } catch {
      // The durable recovery_required state is safer than retrying a failed
      // cross-store transition. Preserve the original denial to the caller.
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
    expectedRevisions: Record<ExecutionCheckKind, string> | undefined,
    attribution: ExecutionAttribution | undefined,
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
          ...(attribution ? { attribution: clone(attribution) } : {}),
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
      ...(attribution ? { attribution: clone(attribution) } : {}),
      checks: Object.fromEntries(normalizedChecks.map(({ record, fencingToken, expiresAt }) => [record.check, {
        revision: record.revision!,
        fencingToken: fencingToken!,
        expiresAt: expiresAt!,
      }])) as ExecutionStartCapability['checks'],
    };
    return { checks, capability };
  }

  private handleExisting(
    intent: ExecutionIntentRecord,
    payloadDigest: string,
    attribution: ExecutionAttribution | undefined,
  ): ExecutionStartResult {
    assertSameRequest(intent, payloadDigest, attribution);
    if (intent.phase === 'started' && intent.effect.status === 'started') {
      return {
        intent: publicIntent(intent),
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

  private replayRegistration(
    intent: ExecutionIntentRecord,
    payloadDigest: string,
    attribution: ExecutionAttribution | undefined,
  ): ExecutionRegistrationResult {
    assertSameRequest(intent, payloadDigest, attribution);
    const grant = intent.capability?.grant;
    const replayable = intent.phase === 'registered' || intent.phase === 'started' || intent.phase === 'unknown';
    if (replayable && grant && intent.capability) {
      if (intent.phase === 'registered' && Date.parse(grant.expiresAt) <= this.now().getTime()) {
        throw new ExecutionAuthorityError('capability_expired', `The permit for operation ${intent.operationId} has expired`);
      }
      return {
        intent: publicIntent(intent),
        capability: clone(grant),
        capabilityDigest: intent.capability.digest,
        replayed: true,
      };
    }
    if (intent.phase === 'rejected' && intent.failure) throw errorFromFailure(intent.failure);
    throw new ExecutionAuthorityError('recovery_required', `Operation ${intent.operationId} requires reconciliation before another attempt`);
  }

  /** Store failures are never success and never switch to another ledger. */
  private async storeCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ExecutionAuthorityError) throw error;
      throw new ExecutionAuthorityError('store_unavailable', 'Execution intent store is unavailable');
    }
  }

  private now(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ExecutionAuthorityError('validation_error', 'Clock returned an invalid date');
    return new Date(now);
  }
}

/** The default store: a JSON sidecar under the local SSOT lock. */
export function createSidecarExecutionIntentStore(options: { dataDir: string; sidecarPath?: string }): ExecutionIntentStore {
  assertText(options?.dataDir, 'dataDir');
  const dataDir = options.dataDir;
  const sidecarPath = options.sidecarPath ?? defaultSidecarPath;
  assertSidecarPath(sidecarPath);
  const findIndex = (ledger: ExecutionIntentLedger, key: ExecutionIntentKey) => ledger.intents
    .findIndex((candidate) => candidate.tenantId === key.tenantId && candidate.operationId === key.operationId);
  return {
    async initialize() {
      await initializePersonalOs(dataDir);
    },
    async read(key) {
      const ledger = parseLedger(await readPersonalOsSidecar(dataDir, sidecarPath));
      const index = findIndex(ledger, key);
      return index < 0 ? undefined : clone(ledger.intents[index]);
    },
    async insert(intent) {
      return mutatePersonalOsWithSidecar<{ intent: ExecutionIntentRecord; created: boolean }>(dataDir, sidecarPath, async (current, sidecarContent) => {
        const ledger = parseLedger(sidecarContent);
        const index = findIndex(ledger, intent);
        if (index >= 0) {
          return { next: current, sidecarContent: serializeLedger(ledger), result: { intent: clone(ledger.intents[index]), created: false } };
        }
        ledger.intents.push(clone(intent));
        return { next: current, sidecarContent: serializeLedger(ledger), result: { intent: clone(intent), created: true } };
      });
    },
    async update(key, mutate) {
      return mutatePersonalOsWithSidecar<ExecutionIntentRecord | undefined>(dataDir, sidecarPath, async (current, sidecarContent) => {
        const ledger = parseLedger(sidecarContent);
        const index = findIndex(ledger, key);
        if (index < 0) return { next: current, sidecarContent: serializeLedger(ledger), result: undefined };
        const next = mutate(clone(ledger.intents[index]));
        ledger.intents[index] = clone(next);
        return { next: current, sidecarContent: serializeLedger(ledger), result: clone(next) };
      });
    },
  };
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

const attributionModes: readonly ExecutionAttributionMode[] = ['person', 'delegated_service', 'service'];

/** Enforces who may appear in which role; a service never passes as the person. */
function normalizeAttribution(value: ExecutionAttribution | undefined, principal: string): ExecutionAttribution | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ExecutionAuthorityError('validation_error', 'attribution must be an object');
  const known = new Set(['mode', 'servicePrincipal', 'delegationRef', 'correlationId']);
  if (Object.keys(value).some((key) => !known.has(key))) {
    throw new ExecutionAuthorityError('validation_error', 'attribution contains an unknown field');
  }
  if (!attributionModes.includes(value.mode)) throw new ExecutionAuthorityError('validation_error', 'attribution.mode is invalid');
  for (const field of ['servicePrincipal', 'delegationRef', 'correlationId'] as const) {
    if (value[field] !== undefined) assertText(value[field], `attribution.${field}`);
  }
  if (value.mode === 'person') {
    if (value.servicePrincipal !== undefined || value.delegationRef !== undefined) {
      throw new ExecutionAuthorityError('validation_error', 'A person attribution cannot carry a service principal or delegation');
    }
  } else {
    if (value.servicePrincipal === undefined || value.delegationRef === undefined) {
      throw new ExecutionAuthorityError('validation_error', `A ${value.mode} attribution requires servicePrincipal and delegationRef`);
    }
    if (value.mode === 'delegated_service' && value.servicePrincipal === principal) {
      throw new ExecutionAuthorityError('validation_error', 'A delegated service must differ from the principal it acts for');
    }
    if (value.mode === 'service' && value.servicePrincipal !== principal) {
      throw new ExecutionAuthorityError('validation_error', 'A service attribution must name the service as the principal');
    }
  }
  return {
    mode: value.mode,
    ...(value.servicePrincipal !== undefined ? { servicePrincipal: value.servicePrincipal } : {}),
    ...(value.delegationRef !== undefined ? { delegationRef: value.delegationRef } : {}),
    ...(value.correlationId !== undefined ? { correlationId: value.correlationId } : {}),
  };
}

function assertSameRequest(intent: ExecutionIntentRecord, payloadDigest: string, attribution: ExecutionAttribution | undefined): void {
  if (intent.payloadDigest !== payloadDigest || digest(intent.attribution ?? null) !== digest(attribution ?? null)) {
    throw new ExecutionAuthorityError('operation_conflict', `Operation ${intent.operationId} was already used with a different payload or attribution`);
  }
}

/** Readers see the permit's expiry and digest, never its fencing tokens. */
function publicIntent(intent: ExecutionIntentRecord): ExecutionIntentRecord {
  const next = clone(intent);
  if (next.capability) next.capability = { expiresAt: next.capability.expiresAt, digest: next.capability.digest };
  return next;
}

function intentKey(input: Pick<ExecutionStartInput, 'tenantId' | 'operationId'>): ExecutionIntentKey {
  return { tenantId: input.tenantId, operationId: input.operationId };
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
    || !['recovery_required', 'reservation_marked', 'registered', 'started', 'unknown', 'rejected'].includes(value.phase)
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
  if (value.attribution !== undefined) {
    try {
      normalizeAttribution(value.attribution, value.principal);
    } catch {
      throw new ExecutionAuthorityError('ledger_invalid', 'Execution intent ledger contains an invalid attribution');
    }
  }
  if (value.capability !== undefined && (!isRecord(value.capability)
    || !isText(value.capability.expiresAt)
    || !isText(value.capability.digest)
    || (value.capability.grant !== undefined && (!isRecord(value.capability.grant) || value.capability.grant.kind !== 'execution-start')))) {
    throw new ExecutionAuthorityError('ledger_invalid', 'Execution intent ledger contains an invalid capability');
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
