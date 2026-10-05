import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  defaultJudgmentProblemSnapshotAccessProvider,
  type JudgmentProblemScope,
  type JudgmentProblemReferenceResolutionPhase
} from './judgment-problem-snapshot.js';
import type { FoundationAcl } from './ontology-foundation.js';
import { initializePersonalOs, loadPersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';
import type { PersonalOs } from './types.js';

/** Story13's persisted contract. The ledger is deliberately separate from the
 * canonical graph but is committed by the same Personal OS sidecar transaction.
 */
export const DURABLE_WAIT_VERSION = 'durable-wait.v1' as const;
export const DURABLE_WAIT_SIDECAR_PATH = 'durable-waits/ledger.json' as const;
export const DURABLE_WAIT_LEDGER_VERSION = DURABLE_WAIT_VERSION;

export type DurableWaitState =
  | 'waiting'
  | 'claimed'
  | 'resumed'
  | 'handoff_required'
  | 'reconciliation_wait'
  | 'failed'
  | 'cancelled';

export type DurableWaitTrigger = 'event' | 'timer' | 'manual';
export type DurableWaitResumeMethod = 'resume_run' | 'new_problem' | 'reconcile_external_effect' | 'manual_review';
export type DurableWaitFailurePolicy = 'handoff' | 'new_problem' | 'reconciliation_wait' | 'fail';

export interface DurableWaitEventCondition {
  readonly event_type: string;
  readonly event_id?: string;
  readonly predicate?: string;
}

export interface DurableWaitCondition {
  readonly event?: DurableWaitEventCondition;
  readonly expression?: string;
}

export interface DurableWaitDeadline {
  readonly due_at?: string;
  readonly review_interval_ms?: number;
  /** The next periodic review is persisted so a restarted worker does not lose it. */
  readonly next_review_at?: string;
}

export interface DurableWaitResponsible {
  readonly principal: string;
  readonly scope?: string;
}

export interface DurableWaitRunReference {
  readonly run_id: string;
  readonly node_id?: string;
}

/** Structural alias compatible with JudgmentDAG's snapshot locator. */
export interface DurableWaitProblemReference {
  readonly snapshot_id: `sha256:${string}` | string;
  readonly problem_id: string;
  readonly revision: string;
}

export interface DurableWaitLease {
  readonly lease_id: string;
  readonly holder: string;
  readonly token: string;
  readonly expires_at: string;
}

export interface DurableWaitClaim {
  readonly claim_id: string;
  /** Idempotency key for the scheduler/worker claim request. */
  readonly request_id: string;
  readonly trigger: DurableWaitTrigger;
  readonly claimed_by: string;
  readonly claimed_at: string;
  readonly lease: DurableWaitLease;
  readonly event_id?: string;
}

export interface DurableWaitResumeReceipt {
  readonly resume_id: string;
  readonly wait_id: string;
  readonly claim_id: string;
  readonly run_ref: DurableWaitRunReference;
  readonly recorded_at: string;
}

export type DurableWaitHistoryAction =
  | 'create'
  | 'claim'
  | 'handoff'
  | 'premise_changed'
  | 'effect_unknown'
  | 'resume';

export interface DurableWaitHistoryEntry {
  readonly action: DurableWaitHistoryAction;
  readonly occurred_at: string;
  readonly principal: string;
  readonly from_state?: DurableWaitState;
  readonly to_state: DurableWaitState;
  readonly detail?: string;
  readonly responsible?: DurableWaitResponsible;
}

export interface DurableWaitReconciliation {
  readonly reason: string;
  readonly recorded_at: string;
  readonly responsible: DurableWaitResponsible;
}

export interface DurableWaitRecord {
  readonly wait_id: string;
  readonly version: typeof DURABLE_WAIT_VERSION;
  /** Absent on legacy records; due enumeration never infers a tenant for them. */
  readonly tenant_id?: string;
  readonly owner_scope: JudgmentProblemScope;
  readonly read_policy: FoundationAcl;
  readonly problem_snapshot: DurableWaitProblemReference;
  readonly condition: DurableWaitCondition;
  readonly deadline?: DurableWaitDeadline;
  readonly responsible: DurableWaitResponsible;
  readonly resume_method: DurableWaitResumeMethod;
  readonly failure_policy: DurableWaitFailurePolicy;
  readonly run_ref: DurableWaitRunReference;
  readonly state: DurableWaitState;
  readonly created_at: string;
  readonly updated_at: string;
  readonly claim?: DurableWaitClaim;
  readonly resume_receipt?: DurableWaitResumeReceipt;
  readonly next_problem?: DurableWaitProblemReference;
  readonly reconciliation?: DurableWaitReconciliation;
  readonly history: readonly DurableWaitHistoryEntry[];
}

export interface DurableWaitCreateInput {
  readonly wait_id?: string;
  /** Host-authenticated tenant; callers must not copy this from an untrusted body. */
  readonly tenant_id?: string;
  readonly principal: string;
  readonly owner_scope: JudgmentProblemScope;
  readonly read_policy: FoundationAcl;
  readonly problem_snapshot?: DurableWaitProblemReference;
  /** `problem` is an ergonomic alias for adapters using existing run vocabulary. */
  readonly problem?: DurableWaitProblemReference;
  readonly condition: DurableWaitCondition;
  readonly deadline?: DurableWaitDeadline;
  readonly responsible: DurableWaitResponsible;
  readonly resume_method: DurableWaitResumeMethod;
  readonly failure_policy: DurableWaitFailurePolicy;
  readonly run_ref: DurableWaitRunReference;
  readonly created_at?: string;
}

export interface DurableWaitReadInput {
  readonly wait_id: string;
  readonly principal: string;
}

export interface DurableWaitDueCandidatesInput {
  readonly tenant_id: string;
  readonly principal: string;
  readonly owner_scope_type: JudgmentProblemScope['type'];
  readonly owner_scope_id: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface DurableWaitDueCandidate {
  readonly wait_id: string;
  readonly due_at: string;
}

export interface DurableWaitDueCandidatesPage {
  readonly candidates: readonly DurableWaitDueCandidate[];
  readonly next_cursor?: string;
}

export interface DurableWaitClaimInput extends DurableWaitReadInput {
  /** Binds the returned lease/token to this particular claim attempt. */
  readonly request_id: string;
  readonly trigger: DurableWaitTrigger;
  readonly event_type?: string;
  readonly event_id?: string;
  readonly occurred_at?: string;
  readonly lease_ms?: number;
}

export interface DurableWaitClaimResult {
  readonly wait: DurableWaitRecord;
  readonly claim: DurableWaitClaim;
  /** True when an event/timer observed an already claimed wait. */
  readonly duplicate: boolean;
  /** Only this request may call resume with the returned claim credentials. */
  readonly claimed_by_this_request: boolean;
}

export interface DurableWaitHandoffInput extends DurableWaitReadInput {
  /** New idempotency key bound to the replacement lease. */
  readonly request_id: string;
  readonly responsible: DurableWaitResponsible;
  readonly lease_ms?: number;
  readonly now?: string;
  readonly reason?: string;
}

export interface DurableWaitPremiseChangedInput extends DurableWaitReadInput {
  readonly new_problem_snapshot?: DurableWaitProblemReference;
  readonly new_problem?: DurableWaitProblemReference;
  readonly responsible?: DurableWaitResponsible;
  readonly reason: string;
}

export interface DurableWaitEffectUnknownInput extends DurableWaitReadInput {
  readonly reason: string;
  readonly responsible?: DurableWaitResponsible;
}

export interface DurableWaitResumeInput extends DurableWaitReadInput {
  /** Must match the request that won the claim (or the replacement handoff). */
  readonly request_id: string;
  readonly claim_id: string;
  readonly lease_id: string;
  readonly lease_token: string;
}

export interface DurableWaitProblemSnapshotPort {
  /**
   * The adapter owns immutable snapshot lookup, exact identity/digest checks,
   * and current read ACL. It must fail closed when the reference is missing or
   * not readable. `historical_read` is intentionally not accepted here because
   * a live wait is a new continuation, never an audit replay.
   */
  verify(input: {
    readonly principal: string;
    readonly reference: DurableWaitProblemReference;
    readonly phase: Extract<JudgmentProblemReferenceResolutionPhase, 'save' | 'read'>;
  }): void | boolean | Promise<void | boolean>;
}

export type DurableWaitAccessAction = 'read' | 'write' | 'claim';

export interface DurableWaitAccessPort {
  authorize(input: {
    readonly action: DurableWaitAccessAction;
    readonly principal: string;
    readonly acl: FoundationAcl;
    readonly wait?: DurableWaitRecord;
  }): void | boolean | Promise<void | boolean>;
}

export interface DurableWaitStoreOptions {
  readonly dataDir: string;
  readonly problemSnapshot: DurableWaitProblemSnapshotPort;
  readonly access?: DurableWaitAccessPort;
  readonly clock?: () => Date;
  readonly sidecarPath?: string;
  readonly defaultLeaseMs?: number;
}

export type DurableWaitErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'unauthorized'
  | 'authorization_provider_failed'
  | 'ledger_invalid'
  | 'problem_snapshot_invalid'
  | 'condition_unmet'
  | 'lease_active'
  | 'lease_expired'
  | 'state_conflict'
  | 'reconciliation_required';

export class DurableWaitError extends Error {
  readonly code: DurableWaitErrorCode;
  readonly wait_id?: string;

  constructor(code: DurableWaitErrorCode, message: string, wait_id?: string) {
    super(message);
    this.name = 'DurableWaitError';
    this.code = code;
    this.wait_id = wait_id;
  }
}

/** Internal marker for the CAS branch that can reconcile a concurrent claim. */
class DurableWaitPreflightConflict extends DurableWaitError {
  constructor(message: string, wait_id?: string) {
    super('state_conflict', message, wait_id);
  }
}

interface DurableWaitLedger {
  readonly version: typeof DURABLE_WAIT_VERSION;
  readonly waits: DurableWaitRecord[];
}

/**
 * The providers used to authorize a wait or resolve its Problem snapshot may
 * read the same canonical SSOT.  They therefore must run before the mutation
 * lock is acquired.  The mutation callback only performs this CAS check and
 * never awaits an external provider while the lock is held.
 */
interface DurableWaitMutationPreflight {
  readonly aggregateFingerprint: string;
  readonly sidecarFingerprint: string;
  readonly record?: DurableWaitRecord;
  readonly waitFingerprint?: string;
}

const SNAPSHOT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const WAIT_STATES: readonly DurableWaitState[] = [
  'waiting', 'claimed', 'resumed', 'handoff_required', 'reconciliation_wait', 'failed', 'cancelled'
];
const RESUME_METHODS: readonly DurableWaitResumeMethod[] = [
  'resume_run', 'new_problem', 'reconcile_external_effect', 'manual_review'
];
const FAILURE_POLICIES: readonly DurableWaitFailurePolicy[] = [
  'handoff', 'new_problem', 'reconciliation_wait', 'fail'
];
const TRIGGERS: readonly DurableWaitTrigger[] = ['event', 'timer', 'manual'];
const DUE_CURSOR_KEY = randomBytes(32);

function earliestDueAt(deadline: DurableWaitDeadline | undefined): string | undefined {
  const values = [deadline?.due_at, deadline?.next_review_at].filter((value): value is string => value !== undefined);
  return values.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
}

function encodeDueCursor(after: string, tenantId: string, principal: string, scopeType: string, scopeId: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, after, tenantId, principal, scopeType, scopeId }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', DUE_CURSOR_KEY).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeDueCursor(cursor: string | undefined, tenantId: string, principal: string, scopeType: string, scopeId: string): string {
  if (cursor === undefined) return '';
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(cursor)) {
    throw new DurableWaitError('invalid_request', 'cursor is invalid');
  }
  try {
    const [payload, signature] = cursor.split('.');
    const expected = createHmac('sha256', DUE_CURSOR_KEY).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('cursor signature is invalid');
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('cursor is not an object');
    const value = decoded as Record<string, unknown>;
    if (value.v !== 1 || value.tenantId !== tenantId || value.principal !== principal
      || value.scopeType !== scopeType || value.scopeId !== scopeId
      || typeof value.after !== 'string' || value.after.length === 0 || value.after.length > 512) {
      throw new Error('cursor binding is invalid');
    }
    return value.after;
  } catch {
    throw new DurableWaitError('invalid_request', 'cursor is invalid for this principal and scope');
  }
}

export const defaultDurableWaitAccessProvider: DurableWaitAccessPort = {
  authorize({ action, principal, acl }) {
    return defaultJudgmentProblemSnapshotAccessProvider.authorize({
      action: action === 'write' ? 'write' : 'read',
      context: { principal },
      acl
    });
  }
};

export class DurableWaitStore {
  private readonly dataDir: string;
  private readonly problemSnapshot: DurableWaitProblemSnapshotPort;
  private readonly access: DurableWaitAccessPort;
  private readonly clock: () => Date;
  private readonly sidecarPath: string;
  private readonly defaultLeaseMs: number;

  constructor(options: DurableWaitStoreOptions) {
    assertText(options?.dataDir, 'dataDir');
    if (!options.problemSnapshot || typeof options.problemSnapshot.verify !== 'function') {
      throw new DurableWaitError('invalid_request', 'problemSnapshot.verify is required');
    }
    this.dataDir = options.dataDir;
    this.problemSnapshot = options.problemSnapshot;
    this.access = options.access ?? defaultDurableWaitAccessProvider;
    this.clock = options.clock ?? (() => new Date());
    this.sidecarPath = options.sidecarPath ?? DURABLE_WAIT_SIDECAR_PATH;
    assertSidecarPath(this.sidecarPath);
    this.defaultLeaseMs = options.defaultLeaseMs ?? DEFAULT_LEASE_MS;
    assertLeaseMs(this.defaultLeaseMs, 'defaultLeaseMs');
  }

  async initialize(): Promise<void> {
    await initializePersonalOs(this.dataDir);
  }

  async create(input: DurableWaitCreateInput): Promise<DurableWaitRecord> {
    const normalized = normalizeCreateInput(input, this.now());
    await this.initialize();
    const preflight = await this.captureMutationPreflight();
    await this.authorize('write', normalized.principal, normalized.read_policy);
    await this.verifyProblem(normalized.principal, normalized.problem_snapshot, 'save');
    return mutatePersonalOsWithSidecar<DurableWaitRecord>(this.dataDir, this.sidecarPath, (current, content) => {
      this.assertMutationPreflight(current, content, preflight);
      const ledger = parseLedger(content);
      if (ledger.waits.some((wait) => wait.wait_id === normalized.wait_id)) {
        throw new DurableWaitError('state_conflict', `Wait ${normalized.wait_id} already exists`, normalized.wait_id);
      }
      const now = normalized.created_at;
      const record: DurableWaitRecord = freezeClone({
        wait_id: normalized.wait_id,
        version: DURABLE_WAIT_VERSION,
        ...(normalized.tenant_id === undefined ? {} : { tenant_id: normalized.tenant_id }),
        owner_scope: normalized.owner_scope,
        read_policy: normalized.read_policy,
        problem_snapshot: normalized.problem_snapshot,
        condition: normalized.condition,
        ...(normalized.deadline === undefined ? {} : { deadline: normalized.deadline }),
        responsible: normalized.responsible,
        resume_method: normalized.resume_method,
        failure_policy: normalized.failure_policy,
        run_ref: normalized.run_ref,
        state: 'waiting',
        created_at: now,
        updated_at: now,
        history: [{
          action: 'create',
          occurred_at: now,
          principal: normalized.principal,
          to_state: 'waiting',
          responsible: normalized.responsible
        }]
      });
      ledger.waits.push(record);
      return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(record) };
    });
  }

  async get(input: DurableWaitReadInput): Promise<DurableWaitRecord> {
    const normalized = normalizeReadInput(input);
    await this.initialize();
    const record = await this.readStored(normalized.wait_id);
    await this.authorize('read', normalized.principal, record.read_policy, record);
    await this.verifyProblem(normalized.principal, record.problem_snapshot);
    return freezeClone(record);
  }

  /** Alias used by adapters that model stores as read operations. */
  async read(input: DurableWaitReadInput): Promise<DurableWaitRecord> {
    return this.get(input);
  }

  async list(input: { readonly principal: string; readonly owner_scope_id?: string }): Promise<readonly DurableWaitRecord[]> {
    assertText(input?.principal, 'principal');
    await this.initialize();
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const result: DurableWaitRecord[] = [];
    for (const record of ledger.waits) {
      if (input.owner_scope_id !== undefined && record.owner_scope.id !== input.owner_scope_id) continue;
      try {
        await this.authorize('read', input.principal, record.read_policy, record);
        await this.verifyProblem(input.principal, record.problem_snapshot);
        result.push(freezeClone(record));
      } catch (error) {
        if (error instanceof DurableWaitError && error.code === 'unauthorized') continue;
        throw error;
      }
    }
    return result;
  }

  /** Discovery only: claim repeats all live authorization and trigger checks. */
  async listDueCandidates(input: DurableWaitDueCandidatesInput): Promise<DurableWaitDueCandidatesPage> {
    assertText(input?.tenant_id, 'tenant_id');
    assertText(input?.principal, 'principal');
    if (!['personal', 'project', 'organization'].includes(input?.owner_scope_type)) {
      throw new DurableWaitError('invalid_request', 'owner_scope_type is invalid');
    }
    assertText(input?.owner_scope_id, 'owner_scope_id');
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DurableWaitError('invalid_request', 'limit must be an integer from 1 to 100');
    }
    const after = decodeDueCursor(input.cursor, input.tenant_id, input.principal, input.owner_scope_type, input.owner_scope_id);
    const nowMs = this.now().getTime();
    await this.initialize();
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    const candidates: DurableWaitDueCandidate[] = [];
    let hasMore = false;
    for (const record of [...ledger.waits].sort((a, b) => a.wait_id < b.wait_id ? -1 : a.wait_id > b.wait_id ? 1 : 0)) {
      if (record.wait_id <= after || record.tenant_id !== input.tenant_id
        || record.owner_scope.type !== input.owner_scope_type
        || record.owner_scope.id !== input.owner_scope_id || record.state !== 'waiting') continue;
      const dueAt = earliestDueAt(record.deadline);
      if (dueAt === undefined || Date.parse(dueAt) > nowMs) continue;
      let allowed: void | boolean;
      try {
        allowed = await this.access.authorize({ action: 'claim', principal: input.principal, acl: record.read_policy, wait: record });
      } catch {
        throw new DurableWaitError('authorization_provider_failed', 'Claim access could not be verified');
      }
      if (allowed === false) continue;
      await this.verifyProblem(input.principal, record.problem_snapshot);
      if (candidates.length === limit) {
        hasMore = true;
        break;
      }
      candidates.push({ wait_id: record.wait_id, due_at: dueAt });
    }
    const last = candidates.at(-1);
    return {
      candidates,
      ...(hasMore && last !== undefined
        ? { next_cursor: encodeDueCursor(last.wait_id, input.tenant_id, input.principal, input.owner_scope_type, input.owner_scope_id) }
        : {})
    };
  }

  async claim(input: DurableWaitClaimInput): Promise<DurableWaitClaimResult> {
    const normalized = normalizeClaimInput(input, this.now(), this.defaultLeaseMs);
    await this.initialize();
    const preflight = await this.captureMutationPreflight(normalized.wait_id);
    const preflightRecord = requireMutationRecord(preflight, normalized.wait_id);
    await this.authorize('claim', normalized.principal, preflightRecord.read_policy, preflightRecord);
    await this.verifyProblem(normalized.principal, preflightRecord.problem_snapshot);
    try {
      return await mutatePersonalOsWithSidecar<DurableWaitClaimResult>(this.dataDir, this.sidecarPath, (current, content) => {
        const ledger = this.assertMutationPreflight(current, content, preflight, normalized.wait_id);
        const record = findWait(ledger, normalized.wait_id);
        if (record.state === 'reconciliation_wait') {
          throw new DurableWaitError('reconciliation_required', `Wait ${record.wait_id} requires external-effect reconciliation`, record.wait_id);
        }
        if (record.state === 'handoff_required' || record.state === 'resumed' || record.state === 'failed' || record.state === 'cancelled') {
          throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} is ${record.state}`, record.wait_id);
        }
        // Validate the incoming event/timer before treating an existing claim as
        // a duplicate. A different, not-yet-ready trigger must not receive a
        // claim it cannot legitimately resume.
        assertTriggerReady(record, normalized);
        if (record.claim !== undefined) {
          if (Date.parse(record.claim.lease.expires_at) > normalized.nowMs) {
            return {
              next: current,
              sidecarContent: serializeLedger(ledger),
              result: {
                wait: freezeClone(record),
                claim: freezeClone(record.claim),
                duplicate: true,
                claimed_by_this_request: record.claim.request_id === normalized.request_id
                  && record.claim.claimed_by === normalized.principal
              }
            };
          }
          throw new DurableWaitError('lease_expired', `Wait ${record.wait_id} requires handoff after lease expiry`, record.wait_id);
        }
        const claim = makeClaim(normalized, this.nowFromMillis(normalized.nowMs), normalized.leaseMs);
        const now = this.timestamp(normalized.nowMs);
        const updated = updateRecord(record, {
          state: 'claimed',
          claim,
          updated_at: now,
          history: appendHistory(record, {
            action: 'claim',
            occurred_at: now,
            principal: normalized.principal,
            from_state: record.state,
            to_state: 'claimed',
            detail: normalized.trigger === 'event' ? `event:${normalized.event_type ?? ''}` : normalized.trigger
          })
        });
        replaceWait(ledger, updated);
        return {
          next: current,
          sidecarContent: serializeLedger(ledger),
          result: { wait: freezeClone(updated), claim: freezeClone(claim), duplicate: false, claimed_by_this_request: true }
        };
      });
    } catch (error) {
      if (!(error instanceof DurableWaitPreflightConflict)) throw error;
      // A concurrent winner has already committed the claim. Re-read once,
      // outside the SSOT mutation lock, and return that winner only after the
      // current ACL, snapshot access, trigger context, and lease are checked.
      return this.reconcileClaimAfterPreflightConflict(normalized);
    }
  }

  async handoff(input: DurableWaitHandoffInput): Promise<DurableWaitRecord> {
    const normalized = normalizeHandoffInput(input, this.now(), this.defaultLeaseMs);
    await this.initialize();
    const preflight = await this.captureMutationPreflight(normalized.wait_id);
    const preflightRecord = requireMutationRecord(preflight, normalized.wait_id);
    await this.authorize('claim', normalized.principal, preflightRecord.read_policy, preflightRecord);
    await this.verifyProblem(normalized.principal, preflightRecord.problem_snapshot);
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, (current, content) => {
      const ledger = this.assertMutationPreflight(current, content, preflight, normalized.wait_id);
      const record = findWait(ledger, normalized.wait_id);
      if (record.state !== 'claimed' || record.claim === undefined) {
        throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} has no active claim to hand off`, record.wait_id);
      }
      if (Date.parse(record.claim.lease.expires_at) > normalized.nowMs) {
        throw new DurableWaitError('lease_active', `Wait ${record.wait_id} lease is still active`, record.wait_id);
      }
      const now = this.timestamp(normalized.nowMs);
      const claim: DurableWaitClaim = {
        ...record.claim,
        request_id: normalized.request_id,
        lease: makeLease(normalized.responsible.principal, this.nowFromMillis(normalized.nowMs), normalized.leaseMs),
        claimed_by: normalized.responsible.principal,
        claimed_at: now
      };
      const updated = updateRecord(record, {
        state: 'claimed',
        claim,
        responsible: normalized.responsible,
        updated_at: now,
        history: appendHistory(record, {
          action: 'handoff',
          occurred_at: now,
          principal: normalized.principal,
          from_state: record.state,
          to_state: 'claimed',
          detail: normalized.reason,
          responsible: normalized.responsible
        })
      });
      replaceWait(ledger, updated);
      return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(updated) };
    });
  }

  /** Explicit name for scheduler adapters that only hand off expired leases. */
  async handoffExpired(input: DurableWaitHandoffInput): Promise<DurableWaitRecord> {
    return this.handoff(input);
  }

  async resume(input: DurableWaitResumeInput): Promise<DurableWaitResumeReceipt> {
    const normalized = normalizeResumeInput(input);
    await this.initialize();
    const preflight = await this.captureMutationPreflight(normalized.wait_id);
    const preflightRecord = requireMutationRecord(preflight, normalized.wait_id);
    await this.authorize('claim', normalized.principal, preflightRecord.read_policy, preflightRecord);
    await this.verifyProblem(normalized.principal, preflightRecord.problem_snapshot);
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, (current, content) => {
      const ledger = this.assertMutationPreflight(current, content, preflight, normalized.wait_id);
      const record = findWait(ledger, normalized.wait_id);
      if (record.resume_receipt !== undefined) {
        assertResumeBinding(record, normalized);
        return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(record.resume_receipt) };
      }
      if (record.state === 'reconciliation_wait') {
        throw new DurableWaitError('reconciliation_required', `Wait ${record.wait_id} requires reconciliation before resume`, record.wait_id);
      }
      if (record.state === 'handoff_required') {
        throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} requires a new Problem before resume`, record.wait_id);
      }
      if (record.state !== 'claimed' || record.claim === undefined) {
        throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} is not claimed`, record.wait_id);
      }
      assertResumeBinding(record, normalized);
      if (Date.parse(record.claim.lease.expires_at) <= this.now().getTime()) {
        throw new DurableWaitError('lease_expired', `Wait ${record.wait_id} lease has expired`, record.wait_id);
      }
      const now = this.timestamp(this.now().getTime());
      const receipt: DurableWaitResumeReceipt = {
        resume_id: `resume-${randomUUID()}`,
        wait_id: record.wait_id,
        claim_id: record.claim.claim_id,
        run_ref: record.run_ref,
        recorded_at: now
      };
      const updated = updateRecord(record, {
        state: 'resumed',
        resume_receipt: receipt,
        updated_at: now,
        history: appendHistory(record, {
          action: 'resume',
          occurred_at: now,
          principal: normalized.principal,
          from_state: record.state,
          to_state: 'resumed'
        })
      });
      replaceWait(ledger, updated);
      return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(receipt) };
    });
  }

  async markPremiseChanged(input: DurableWaitPremiseChangedInput): Promise<DurableWaitRecord> {
    const normalized = normalizePremiseChangedInput(input);
    await this.initialize();
    const preflight = await this.captureMutationPreflight(normalized.wait_id);
    const preflightRecord = requireMutationRecord(preflight, normalized.wait_id);
    await this.authorize('claim', normalized.principal, preflightRecord.read_policy, preflightRecord);
    await this.verifyProblem(normalized.principal, preflightRecord.problem_snapshot);
    await this.verifyProblem(normalized.principal, normalized.new_problem_snapshot);
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, (current, content) => {
      const ledger = this.assertMutationPreflight(current, content, preflight, normalized.wait_id);
      const record = findWait(ledger, normalized.wait_id);
      if (record.state === 'resumed' || record.state === 'cancelled' || record.state === 'failed') {
        throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} is ${record.state}`, record.wait_id);
      }
      const now = this.now().toISOString();
      const updated = updateRecord(record, {
        state: 'handoff_required',
        next_problem: normalized.new_problem_snapshot,
        ...(normalized.responsible === undefined ? {} : { responsible: normalized.responsible }),
        updated_at: now,
        history: appendHistory(record, {
          action: 'premise_changed',
          occurred_at: now,
          principal: normalized.principal,
          from_state: record.state,
          to_state: 'handoff_required',
          detail: normalized.reason,
          ...(normalized.responsible === undefined ? {} : { responsible: normalized.responsible })
        })
      });
      replaceWait(ledger, updated);
      return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(updated) };
    });
  }

  async markEffectUnknown(input: DurableWaitEffectUnknownInput): Promise<DurableWaitRecord> {
    const normalized = normalizeEffectUnknownInput(input);
    await this.initialize();
    const preflight = await this.captureMutationPreflight(normalized.wait_id);
    const preflightRecord = requireMutationRecord(preflight, normalized.wait_id);
    await this.authorize('claim', normalized.principal, preflightRecord.read_policy, preflightRecord);
    await this.verifyProblem(normalized.principal, preflightRecord.problem_snapshot);
    return mutatePersonalOsWithSidecar(this.dataDir, this.sidecarPath, (current, content) => {
      const ledger = this.assertMutationPreflight(current, content, preflight, normalized.wait_id);
      const record = findWait(ledger, normalized.wait_id);
      if (record.state === 'resumed' || record.state === 'cancelled' || record.state === 'failed') {
        throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} is ${record.state}`, record.wait_id);
      }
      const now = this.now().toISOString();
      const responsible = normalized.responsible ?? record.responsible;
      const updated = updateRecord(record, {
        state: 'reconciliation_wait',
        responsible,
        reconciliation: { reason: normalized.reason, recorded_at: now, responsible },
        updated_at: now,
        history: appendHistory(record, {
          action: 'effect_unknown',
          occurred_at: now,
          principal: normalized.principal,
          from_state: record.state,
          to_state: 'reconciliation_wait',
          detail: normalized.reason,
          responsible
        })
      });
      replaceWait(ledger, updated);
      return { next: current, sidecarContent: serializeLedger(ledger), result: freezeClone(updated) };
    });
  }

  private async captureMutationPreflight(waitId?: string): Promise<DurableWaitMutationPreflight> {
    // These reads intentionally happen outside mutatePersonalOsWithSidecar's
    // lock. A trusted provider may use GraphFoundationRevisionStore or read
    // another sidecar rooted at the same dataDir, both of which acquire the
    // canonical lock themselves.
    const sidecarContent = await readPersonalOsSidecar(this.dataDir, this.sidecarPath);
    const ledger = parseLedger(sidecarContent);
    const record = waitId === undefined ? undefined : findWait(ledger, waitId);
    const current = await loadPersonalOs(this.dataDir);
    return {
      aggregateFingerprint: fingerprintPersonalOs(current),
      sidecarFingerprint: fingerprintText(sidecarContent),
      ...(record === undefined ? {} : { record, waitFingerprint: fingerprintRecord(record) })
    };
  }

  private assertMutationPreflight(
    current: PersonalOs,
    sidecarContent: string | undefined,
    preflight: DurableWaitMutationPreflight,
    waitId?: string
  ): DurableWaitLedger {
    // This is the compare-and-swap boundary. Providers have already run, so
    // no external await is permitted in the SSOT lock callback. If either
    // aggregate changed after preflight, retry against the newly authorized
    // state rather than committing a stale decision.
    if (fingerprintPersonalOs(current) !== preflight.aggregateFingerprint
      || fingerprintText(sidecarContent) !== preflight.sidecarFingerprint) {
      throw new DurableWaitPreflightConflict('Personal OS changed while validating the durable wait; retry', waitId);
    }
    const ledger = parseLedger(sidecarContent);
    if (waitId !== undefined) {
      const record = findWait(ledger, waitId);
      if (preflight.waitFingerprint === undefined || fingerprintRecord(record) !== preflight.waitFingerprint) {
        throw new DurableWaitPreflightConflict(`Wait ${waitId} changed while validating the durable wait; retry`, waitId);
      }
    }
    return ledger;
  }

  private async readStored(waitId: string): Promise<DurableWaitRecord> {
    const ledger = parseLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath));
    return findWait(ledger, waitId);
  }

  private async reconcileClaimAfterPreflightConflict(
    input: DurableWaitClaimInput & { readonly nowMs: number }
  ): Promise<DurableWaitClaimResult> {
    const record = await this.readStored(input.wait_id);
    await this.authorize('claim', input.principal, record.read_policy, record);
    await this.verifyProblem(input.principal, record.problem_snapshot);
    if (record.state === 'reconciliation_wait') {
      throw new DurableWaitError('reconciliation_required', `Wait ${record.wait_id} requires external-effect reconciliation`, record.wait_id);
    }
    if (record.state === 'handoff_required' || record.state === 'resumed' || record.state === 'failed' || record.state === 'cancelled') {
      throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} is ${record.state}`, record.wait_id);
    }
    assertTriggerReady(record, input);
    if (record.state !== 'claimed' || record.claim === undefined) {
      throw new DurableWaitError('state_conflict', `Wait ${record.wait_id} has no winning claim`, record.wait_id);
    }
    if (Date.parse(record.claim.lease.expires_at) <= input.nowMs) {
      throw new DurableWaitError('lease_expired', `Wait ${record.wait_id} requires handoff after lease expiry`, record.wait_id);
    }
    return {
      wait: freezeClone(record),
      claim: freezeClone(record.claim),
      duplicate: true,
      claimed_by_this_request: record.claim.request_id === input.request_id
        && record.claim.claimed_by === input.principal
    };
  }

  private async authorize(action: DurableWaitAccessAction, principal: string, acl: FoundationAcl, wait?: DurableWaitRecord): Promise<void> {
    try {
      const allowed = await this.access.authorize({ action, principal, acl, wait });
      if (allowed === false) throw new Error('provider denied access');
    } catch (error) {
      throw new DurableWaitError('unauthorized', `${action} access was denied: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async verifyProblem(
    principal: string,
    reference: DurableWaitProblemReference,
    phase: Extract<JudgmentProblemReferenceResolutionPhase, 'save' | 'read'> = 'read'
  ): Promise<void> {
    try {
      const verified = await this.problemSnapshot.verify({ principal, reference, phase });
      if (verified === false) throw new Error('problem snapshot provider rejected reference');
    } catch (error) {
      if (error instanceof DurableWaitError) throw error;
      throw new DurableWaitError('problem_snapshot_invalid', `Problem snapshot ${reference.problem_id}@${reference.revision} could not be verified`);
    }
  }

  private now(): Date {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new DurableWaitError('invalid_request', 'clock returned an invalid date');
    }
    return new Date(value.getTime());
  }

  private nowFromMillis(value: number): Date {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new DurableWaitError('invalid_request', 'timestamp is invalid');
    return date;
  }

  private timestamp(value: number): string {
    return this.nowFromMillis(value).toISOString();
  }
}

export function createDurableWaitStore(options: DurableWaitStoreOptions): DurableWaitStore {
  return new DurableWaitStore(options);
}

function normalizeCreateInput(input: DurableWaitCreateInput, now: Date): Required<Pick<DurableWaitCreateInput, 'wait_id' | 'principal' | 'owner_scope' | 'read_policy' | 'problem_snapshot' | 'condition' | 'responsible' | 'resume_method' | 'failure_policy' | 'run_ref'>> & { readonly tenant_id?: string; readonly deadline?: DurableWaitDeadline; readonly created_at: string } {
  assertText(input?.principal, 'principal');
  if (input.tenant_id !== undefined) assertText(input.tenant_id, 'tenant_id');
  const waitId = input.wait_id ?? `wait-${randomUUID()}`;
  assertText(waitId, 'wait_id');
  const ownerScope = normalizeScope(input.owner_scope, 'owner_scope');
  const readPolicy = normalizeAcl(input.read_policy, 'read_policy');
  const problem = input.problem_snapshot ?? input.problem;
  if (problem === undefined) throw new DurableWaitError('invalid_request', 'problem_snapshot is required');
  const problemSnapshot = normalizeProblemReference(problem, 'problem_snapshot');
  const condition = normalizeCondition(input.condition);
  const deadline = input.deadline === undefined ? undefined : normalizeDeadline(input.deadline, now);
  if (condition.event === undefined && deadline === undefined) {
    throw new DurableWaitError('invalid_request', 'event condition or deadline is required');
  }
  if (input.problem_snapshot !== undefined && input.problem !== undefined && !sameProblem(input.problem_snapshot, input.problem)) {
    throw new DurableWaitError('invalid_request', 'problem and problem_snapshot must identify the same immutable snapshot');
  }
  const responsible = normalizeResponsible(input.responsible, 'responsible');
  const resumeMethod = enumValue(input.resume_method, RESUME_METHODS, 'resume_method');
  const failurePolicy = enumValue(input.failure_policy, FAILURE_POLICIES, 'failure_policy');
  const runRef = normalizeRunReference(input.run_ref);
  const createdAt = input.created_at ?? now.toISOString();
  assertTimestamp(createdAt, 'created_at');
  return {
    wait_id: waitId,
    ...(input.tenant_id === undefined ? {} : { tenant_id: input.tenant_id }),
    principal: input.principal,
    owner_scope: ownerScope,
    read_policy: readPolicy,
    problem_snapshot: problemSnapshot,
    condition,
    ...(deadline === undefined ? {} : { deadline }),
    responsible,
    resume_method: resumeMethod,
    failure_policy: failurePolicy,
    run_ref: runRef,
    created_at: createdAt
  };
}

function normalizeReadInput(input: DurableWaitReadInput): DurableWaitReadInput {
  assertText(input?.wait_id, 'wait_id');
  assertText(input?.principal, 'principal');
  return { wait_id: input.wait_id, principal: input.principal };
}

function normalizeClaimInput(input: DurableWaitClaimInput, now: Date, defaultLeaseMs: number): DurableWaitClaimInput & { readonly nowMs: number; readonly leaseMs: number } {
  const base = normalizeReadInput(input);
  const requestId = boundedText(input.request_id, 'request_id');
  const trigger = enumValue(input.trigger, TRIGGERS, 'trigger');
  const leaseMs = input.lease_ms ?? defaultLeaseMs;
  assertLeaseMs(leaseMs, 'lease_ms');
  const nowMs = now.getTime();
  if (input.occurred_at !== undefined) assertTimestamp(input.occurred_at, 'occurred_at');
  if (input.event_type !== undefined) assertText(input.event_type, 'event_type');
  if (input.event_id !== undefined) assertText(input.event_id, 'event_id');
  return { ...base, request_id: requestId, trigger, ...(input.event_type === undefined ? {} : { event_type: input.event_type }), ...(input.event_id === undefined ? {} : { event_id: input.event_id }), ...(input.occurred_at === undefined ? {} : { occurred_at: input.occurred_at }), lease_ms: leaseMs, nowMs, leaseMs };
}

function normalizeHandoffInput(input: DurableWaitHandoffInput, now: Date, defaultLeaseMs: number): DurableWaitHandoffInput & { readonly nowMs: number; readonly leaseMs: number } {
  const base = normalizeReadInput(input);
  const requestId = boundedText(input.request_id, 'request_id');
  const responsible = normalizeResponsible(input.responsible, 'responsible');
  const leaseMs = input.lease_ms ?? defaultLeaseMs;
  assertLeaseMs(leaseMs, 'lease_ms');
  if (input.now !== undefined) assertTimestamp(input.now, 'now');
  if (input.reason !== undefined) assertText(input.reason, 'reason');
  const nowMs = input.now === undefined ? now.getTime() : Date.parse(input.now);
  return { ...base, request_id: requestId, responsible, lease_ms: leaseMs, now: input.now, ...(input.reason === undefined ? {} : { reason: input.reason }), nowMs, leaseMs };
}

function normalizeResumeInput(input: DurableWaitResumeInput): DurableWaitResumeInput {
  const base = normalizeReadInput(input);
  const requestId = boundedText(input.request_id, 'request_id');
  assertText(input.claim_id, 'claim_id');
  assertText(input.lease_id, 'lease_id');
  assertText(input.lease_token, 'lease_token');
  return { ...base, request_id: requestId, claim_id: input.claim_id, lease_id: input.lease_id, lease_token: input.lease_token };
}

function normalizePremiseChangedInput(input: DurableWaitPremiseChangedInput): DurableWaitPremiseChangedInput & { readonly new_problem_snapshot: DurableWaitProblemReference } {
  const base = normalizeReadInput(input);
  const problem = input.new_problem_snapshot ?? input.new_problem;
  if (problem === undefined) throw new DurableWaitError('invalid_request', 'new_problem_snapshot is required');
  const newProblem = normalizeProblemReference(problem, 'new_problem_snapshot');
  if (input.new_problem_snapshot !== undefined && input.new_problem !== undefined && !sameProblem(input.new_problem_snapshot, input.new_problem)) {
    throw new DurableWaitError('invalid_request', 'new_problem and new_problem_snapshot must identify the same snapshot');
  }
  assertText(input.reason, 'reason');
  const responsible = input.responsible === undefined ? undefined : normalizeResponsible(input.responsible, 'responsible');
  return { ...base, new_problem_snapshot: newProblem, reason: input.reason, ...(responsible === undefined ? {} : { responsible }) };
}

function normalizeEffectUnknownInput(input: DurableWaitEffectUnknownInput): DurableWaitEffectUnknownInput {
  const base = normalizeReadInput(input);
  assertText(input.reason, 'reason');
  const responsible = input.responsible === undefined ? undefined : normalizeResponsible(input.responsible, 'responsible');
  return { ...base, reason: input.reason, ...(responsible === undefined ? {} : { responsible }) };
}

function normalizeCondition(value: DurableWaitCondition): DurableWaitCondition {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', 'condition is required');
  const event = value.event === undefined ? undefined : normalizeEventCondition(value.event);
  const expression = value.expression === undefined ? undefined : boundedText(value.expression, 'condition.expression');
  if (event === undefined && expression === undefined) throw new DurableWaitError('invalid_request', 'condition must contain an event or expression');
  return { ...(event === undefined ? {} : { event }), ...(expression === undefined ? {} : { expression }) };
}

function normalizeEventCondition(value: DurableWaitEventCondition): DurableWaitEventCondition {
  const eventType = boundedText(value?.event_type, 'condition.event.event_type');
  const eventId = value.event_id === undefined ? undefined : boundedText(value.event_id, 'condition.event.event_id');
  const predicate = value.predicate === undefined ? undefined : boundedText(value.predicate, 'condition.event.predicate');
  return { event_type: eventType, ...(eventId === undefined ? {} : { event_id: eventId }), ...(predicate === undefined ? {} : { predicate }) };
}

function normalizeDeadline(value: DurableWaitDeadline, now: Date): DurableWaitDeadline {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', 'deadline must be an object');
  const dueAt = value.due_at === undefined ? undefined : boundedText(value.due_at, 'deadline.due_at');
  if (dueAt !== undefined) assertTimestamp(dueAt, 'deadline.due_at');
  const interval = value.review_interval_ms;
  if (dueAt === undefined && interval === undefined) throw new DurableWaitError('invalid_request', 'deadline requires due_at or review_interval_ms');
  if (interval !== undefined) assertLeaseMs(interval, 'deadline.review_interval_ms');
  const nextReviewAt = interval === undefined ? undefined : new Date(now.getTime() + interval).toISOString();
  return { ...(dueAt === undefined ? {} : { due_at: dueAt }), ...(interval === undefined ? {} : { review_interval_ms: interval }), ...(nextReviewAt === undefined ? {} : { next_review_at: nextReviewAt }) };
}

function normalizeScope(value: JudgmentProblemScope, label: string): JudgmentProblemScope {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', `${label} is required`);
  assertText(value.type, `${label}.type`);
  if (!['personal', 'project', 'organization'].includes(value.type)) throw new DurableWaitError('invalid_request', `${label}.type is invalid`);
  assertText(value.id, `${label}.id`);
  return { type: value.type, id: value.id };
}

function normalizeAcl(value: FoundationAcl, label: string): FoundationAcl {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', `${label} is required`);
  assertText(value.ownerId, `${label}.ownerId`);
  if (!['private', 'project', 'organization', 'public'].includes(value.visibility)) throw new DurableWaitError('invalid_request', `${label}.visibility is invalid`);
  if (!Array.isArray(value.readerIds) || !Array.isArray(value.writerIds)) throw new DurableWaitError('invalid_request', `${label}.readerIds and writerIds are required`);
  const readerIds = value.readerIds.map((id) => boundedText(id, `${label}.readerIds`));
  const writerIds = value.writerIds.map((id) => boundedText(id, `${label}.writerIds`));
  if (new Set(readerIds).size !== readerIds.length || new Set(writerIds).size !== writerIds.length) throw new DurableWaitError('invalid_request', `${label} ACL ids must be unique`);
  return { ownerId: value.ownerId, visibility: value.visibility, readerIds, writerIds };
}

function normalizeProblemReference(value: DurableWaitProblemReference, label: string): DurableWaitProblemReference {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', `${label} is required`);
  const snapshotId = boundedText(value.snapshot_id, `${label}.snapshot_id`);
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) throw new DurableWaitError('invalid_request', `${label}.snapshot_id must be a sha256 snapshot ID`);
  assertText(value.problem_id, `${label}.problem_id`);
  assertText(value.revision, `${label}.revision`);
  if (!/^[1-9]\d*$/u.test(value.revision)) throw new DurableWaitError('invalid_request', `${label}.revision must be a positive decimal revision`);
  return { snapshot_id: snapshotId, problem_id: value.problem_id, revision: value.revision };
}

function normalizeResponsible(value: DurableWaitResponsible, label: string): DurableWaitResponsible {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', `${label} is required`);
  const principal = boundedText(value.principal, `${label}.principal`);
  const scope = value.scope === undefined ? undefined : boundedText(value.scope, `${label}.scope`);
  return { principal, ...(scope === undefined ? {} : { scope }) };
}

function normalizeRunReference(value: DurableWaitRunReference): DurableWaitRunReference {
  if (value === undefined || value === null || typeof value !== 'object') throw new DurableWaitError('invalid_request', 'run_ref is required');
  const runId = boundedText(value.run_id, 'run_ref.run_id');
  const nodeId = value.node_id === undefined ? undefined : boundedText(value.node_id, 'run_ref.node_id');
  return { run_id: runId, ...(nodeId === undefined ? {} : { node_id: nodeId }) };
}

function assertTriggerReady(record: DurableWaitRecord, input: DurableWaitClaimInput & { readonly nowMs: number }): void {
  if (input.trigger === 'event') {
    const condition = record.condition.event;
    if (condition === undefined || input.event_type !== condition.event_type || (condition.event_id !== undefined && input.event_id !== condition.event_id)) {
      throw new DurableWaitError('condition_unmet', `Event does not satisfy Wait ${record.wait_id}`, record.wait_id);
    }
    return;
  }
  if (input.trigger === 'timer') {
    const due = record.deadline?.due_at === undefined ? undefined : Date.parse(record.deadline.due_at);
    const review = record.deadline?.next_review_at === undefined ? undefined : Date.parse(record.deadline.next_review_at);
    if ((due === undefined || due > input.nowMs) && (review === undefined || review > input.nowMs)) {
      throw new DurableWaitError('condition_unmet', `Wait ${record.wait_id} is not due`, record.wait_id);
    }
  }
}

function makeClaim(input: DurableWaitClaimInput & { readonly nowMs: number }, now: Date, leaseMs: number): DurableWaitClaim {
  return {
    claim_id: `claim-${randomUUID()}`,
    request_id: input.request_id,
    trigger: input.trigger,
    claimed_by: input.principal,
    claimed_at: now.toISOString(),
    lease: makeLease(input.principal, now, leaseMs),
    ...(input.event_id === undefined ? {} : { event_id: input.event_id })
  };
}

function makeLease(holder: string, now: Date, leaseMs: number): DurableWaitLease {
  return {
    lease_id: `lease-${randomUUID()}`,
    holder,
    token: randomUUID(),
    expires_at: new Date(now.getTime() + leaseMs).toISOString()
  };
}

function assertResumeBinding(record: DurableWaitRecord, input: DurableWaitResumeInput): void {
  const claim = record.claim;
  if (claim === undefined
    || claim.claim_id !== input.claim_id
    || claim.claimed_by !== input.principal
    || claim.request_id !== input.request_id
    || claim.lease.holder !== input.principal
    || claim.lease.lease_id !== input.lease_id
    || claim.lease.token !== input.lease_token) {
    throw new DurableWaitError('unauthorized', `Resume lease does not match Wait ${record.wait_id}`, record.wait_id);
  }
}

function updateRecord(record: DurableWaitRecord, changes: Partial<DurableWaitRecord>): DurableWaitRecord {
  return { ...record, ...changes };
}

function appendHistory(record: DurableWaitRecord, entry: DurableWaitHistoryEntry): readonly DurableWaitHistoryEntry[] {
  return [...record.history, entry];
}

function findWait(ledger: DurableWaitLedger, waitId: string): DurableWaitRecord {
  const record = ledger.waits.find((wait) => wait.wait_id === waitId);
  if (record === undefined) throw new DurableWaitError('not_found', `Wait ${waitId} was not found`, waitId);
  return record;
}

function replaceWait(ledger: DurableWaitLedger, updated: DurableWaitRecord): void {
  const index = ledger.waits.findIndex((wait) => wait.wait_id === updated.wait_id);
  if (index < 0) throw new DurableWaitError('not_found', `Wait ${updated.wait_id} was not found`, updated.wait_id);
  ledger.waits[index] = updated;
}

function parseLedger(content: string | undefined): DurableWaitLedger {
  if (content === undefined || content.trim() === '') return { version: DURABLE_WAIT_VERSION, waits: [] };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new DurableWaitError('ledger_invalid', 'Durable wait ledger is not valid JSON');
  }
  if (!isRecord(value) || value.version !== DURABLE_WAIT_VERSION || !Array.isArray(value.waits)) {
    throw new DurableWaitError('ledger_invalid', 'Durable wait ledger has an unsupported shape');
  }
  try {
    const waits = value.waits.map((item) => validateStoredRecord(item));
    const ids = new Set(waits.map((wait) => wait.wait_id));
    if (ids.size !== waits.length) throw new Error('duplicate wait_id');
    return { version: DURABLE_WAIT_VERSION, waits };
  } catch (error) {
    if (error instanceof DurableWaitError) throw error;
    throw new DurableWaitError('ledger_invalid', `Durable wait ledger is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateStoredRecord(value: unknown): DurableWaitRecord {
  if (!isRecord(value)) throw new Error('wait record must be an object');
  const state = enumValue(value.state, WAIT_STATES, 'wait.state');
  if (value.version !== DURABLE_WAIT_VERSION) throw new Error('wait.version is unsupported');
  assertText(value.wait_id, 'wait.wait_id');
  if (value.tenant_id !== undefined) assertText(value.tenant_id, 'wait.tenant_id');
  const ownerScope = normalizeScope(value.owner_scope as JudgmentProblemScope, 'wait.owner_scope');
  const acl = normalizeAcl(value.read_policy as FoundationAcl, 'wait.read_policy');
  const problem = normalizeProblemReference(value.problem_snapshot as DurableWaitProblemReference, 'wait.problem_snapshot');
  const condition = normalizeCondition(value.condition as DurableWaitCondition);
  const deadline = value.deadline === undefined ? undefined : normalizeStoredDeadline(value.deadline as DurableWaitDeadline);
  const responsible = normalizeResponsible(value.responsible as DurableWaitResponsible, 'wait.responsible');
  const resumeMethod = enumValue(value.resume_method, RESUME_METHODS, 'wait.resume_method');
  const failurePolicy = enumValue(value.failure_policy, FAILURE_POLICIES, 'wait.failure_policy');
  const runRef = normalizeRunReference(value.run_ref as DurableWaitRunReference);
  assertTimestamp(value.created_at as string, 'wait.created_at');
  assertTimestamp(value.updated_at as string, 'wait.updated_at');
  if (!Array.isArray(value.history)) throw new Error('wait.history must be an array');
  const history = value.history.map((entry) => validateHistory(entry));
  const claim = value.claim === undefined ? undefined : validateClaim(value.claim);
  const resumeReceipt = value.resume_receipt === undefined ? undefined : validateResumeReceipt(value.resume_receipt);
  const nextProblem = value.next_problem === undefined ? undefined : normalizeProblemReference(value.next_problem as DurableWaitProblemReference, 'wait.next_problem');
  const reconciliation = value.reconciliation === undefined ? undefined : validateReconciliation(value.reconciliation);
  return {
    wait_id: value.wait_id,
    version: DURABLE_WAIT_VERSION,
    ...(value.tenant_id === undefined ? {} : { tenant_id: value.tenant_id }),
    owner_scope: ownerScope,
    read_policy: acl,
    problem_snapshot: problem,
    condition,
    ...(deadline === undefined ? {} : { deadline }),
    responsible,
    resume_method: resumeMethod,
    failure_policy: failurePolicy,
    run_ref: runRef,
    state,
    created_at: value.created_at,
    updated_at: value.updated_at,
    ...(claim === undefined ? {} : { claim }),
    ...(resumeReceipt === undefined ? {} : { resume_receipt: resumeReceipt }),
    ...(nextProblem === undefined ? {} : { next_problem: nextProblem }),
    ...(reconciliation === undefined ? {} : { reconciliation }),
    history
  };
}

function normalizeStoredDeadline(value: DurableWaitDeadline): DurableWaitDeadline {
  if (value === undefined || value === null || typeof value !== 'object') throw new Error('wait.deadline must be an object');
  const dueAt = value.due_at === undefined ? undefined : boundedText(value.due_at, 'wait.deadline.due_at');
  if (dueAt !== undefined) assertTimestamp(dueAt, 'wait.deadline.due_at');
  if (value.review_interval_ms !== undefined) assertLeaseMs(value.review_interval_ms, 'wait.deadline.review_interval_ms');
  const nextReviewAt = value.next_review_at === undefined ? undefined : boundedText(value.next_review_at, 'wait.deadline.next_review_at');
  if (nextReviewAt !== undefined) assertTimestamp(nextReviewAt, 'wait.deadline.next_review_at');
  if (dueAt === undefined && value.review_interval_ms === undefined) throw new Error('wait.deadline has no trigger');
  return { ...(dueAt === undefined ? {} : { due_at: dueAt }), ...(value.review_interval_ms === undefined ? {} : { review_interval_ms: value.review_interval_ms }), ...(nextReviewAt === undefined ? {} : { next_review_at: nextReviewAt }) };
}

function validateClaim(value: unknown): DurableWaitClaim {
  if (!isRecord(value)) throw new Error('wait.claim must be an object');
  assertText(value.claim_id, 'wait.claim.claim_id');
  assertText(value.request_id, 'wait.claim.request_id');
  const trigger = enumValue(value.trigger, TRIGGERS, 'wait.claim.trigger');
  assertText(value.claimed_by, 'wait.claim.claimed_by');
  assertTimestamp(value.claimed_at as string, 'wait.claim.claimed_at');
  if (value.event_id !== undefined) assertText(value.event_id, 'wait.claim.event_id');
  if (!isRecord(value.lease)) throw new Error('wait.claim.lease must be an object');
  const lease: DurableWaitLease = {
    lease_id: boundedText(value.lease.lease_id, 'wait.claim.lease.lease_id'),
    holder: boundedText(value.lease.holder, 'wait.claim.lease.holder'),
    token: boundedText(value.lease.token, 'wait.claim.lease.token'),
    expires_at: boundedText(value.lease.expires_at, 'wait.claim.lease.expires_at')
  };
  assertTimestamp(lease.expires_at, 'wait.claim.lease.expires_at');
  if (lease.holder !== value.claimed_by) throw new Error('wait.claim.lease.holder must match claimed_by');
  return { claim_id: value.claim_id, request_id: value.request_id, trigger, claimed_by: value.claimed_by, claimed_at: value.claimed_at, lease, ...(value.event_id === undefined ? {} : { event_id: value.event_id }) };
}

function validateResumeReceipt(value: unknown): DurableWaitResumeReceipt {
  if (!isRecord(value)) throw new Error('wait.resume_receipt must be an object');
  assertText(value.resume_id, 'wait.resume_receipt.resume_id');
  assertText(value.wait_id, 'wait.resume_receipt.wait_id');
  assertText(value.claim_id, 'wait.resume_receipt.claim_id');
  const runRef = normalizeRunReference(value.run_ref as DurableWaitRunReference);
  assertTimestamp(value.recorded_at as string, 'wait.resume_receipt.recorded_at');
  return { resume_id: value.resume_id, wait_id: value.wait_id, claim_id: value.claim_id, run_ref: runRef, recorded_at: value.recorded_at };
}

function validateHistory(value: unknown): DurableWaitHistoryEntry {
  if (!isRecord(value)) throw new Error('wait.history entry must be an object');
  const action = enumValue(value.action, ['create', 'claim', 'handoff', 'premise_changed', 'effect_unknown', 'resume'] as const, 'wait.history.action');
  assertTimestamp(value.occurred_at as string, 'wait.history.occurred_at');
  assertText(value.principal, 'wait.history.principal');
  const toState = enumValue(value.to_state, WAIT_STATES, 'wait.history.to_state');
  const fromState = value.from_state === undefined ? undefined : enumValue(value.from_state, WAIT_STATES, 'wait.history.from_state');
  const detail = value.detail === undefined ? undefined : boundedText(value.detail, 'wait.history.detail');
  const responsible = value.responsible === undefined ? undefined : normalizeResponsible(value.responsible as DurableWaitResponsible, 'wait.history.responsible');
  return { action, occurred_at: value.occurred_at, principal: value.principal, ...(fromState === undefined ? {} : { from_state: fromState }), to_state: toState, ...(detail === undefined ? {} : { detail }), ...(responsible === undefined ? {} : { responsible }) };
}

function validateReconciliation(value: unknown): DurableWaitReconciliation {
  if (!isRecord(value)) throw new Error('wait.reconciliation must be an object');
  const reason = boundedText(value.reason, 'wait.reconciliation.reason');
  const recordedAt = boundedText(value.recorded_at, 'wait.reconciliation.recorded_at');
  assertTimestamp(recordedAt, 'wait.reconciliation.recorded_at');
  const responsible = normalizeResponsible(value.responsible as DurableWaitResponsible, 'wait.reconciliation.responsible');
  return { reason, recorded_at: recordedAt, responsible };
}

function serializeLedger(ledger: DurableWaitLedger): string {
  const sorted: DurableWaitLedger = {
    version: DURABLE_WAIT_VERSION,
    waits: [...ledger.waits].sort((left, right) => left.wait_id.localeCompare(right.wait_id))
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function sameProblem(left: DurableWaitProblemReference, right: DurableWaitProblemReference): boolean {
  return left.snapshot_id === right.snapshot_id && left.problem_id === right.problem_id && left.revision === right.revision;
}

function requireMutationRecord(preflight: DurableWaitMutationPreflight, waitId: string): DurableWaitRecord {
  if (preflight.record === undefined) {
    throw new DurableWaitError('not_found', `Wait ${waitId} was not found`, waitId);
  }
  return preflight.record;
}

function fingerprintPersonalOs(value: PersonalOs): string {
  return fingerprintValue({
    graph: value.graph,
    personalKg: value.personalKg,
    relationships: value.relationships,
    decisions: value.decisions,
    sourceCount: value.sourceCount
  });
}

function fingerprintRecord(value: DurableWaitRecord): string {
  return fingerprintValue(value);
}

function fingerprintText(value: string | undefined): string {
  return fingerprintValue(value === undefined ? { missing: true } : { content: value });
}

function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new DurableWaitError('invalid_request', `${label} is invalid`);
  return value as T;
}

function boundedText(value: unknown, label: string): string {
  assertText(value, label);
  return value;
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DurableWaitError('invalid_request', `${label} must be a bounded text value`);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  assertText(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new DurableWaitError('invalid_request', `${label} must be an ISO timestamp`);
}

function assertLeaseMs(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 31_536_000_000) {
    throw new DurableWaitError('invalid_request', `${label} must be a positive millisecond interval`);
  }
}

function assertSidecarPath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new DurableWaitError('invalid_request', 'sidecarPath must remain relative to the SSOT root');
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freezeClone<T>(value: T): T {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
