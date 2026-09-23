import { createHash } from 'node:crypto';
import { initializePersonalOs, mutatePersonalOsWithSidecar, readPersonalOsSidecar } from './ssot.js';
import type { DurableWaitStore } from './durable-waits.js';
import type { FoundationAcl } from './ontology-foundation.js';

/**
 * Story 15 keeps impact review at the port boundary.  It reads adopted
 * references and plans, records an idempotent notification, and asks a
 * durable-wait/rejudgment adapter to continue.  It never owns a canonical
 * Objective, Model, Constraint, run, reservation, or external effect.
 */
export const COMPANY_OS_IMPACT_REVIEW_VERSION = 'company-os-impact-review.v1' as const;
export const COMPANY_OS_IMPACT_REVIEW_NOTIFICATION_SIDECAR = 'impact-review/notifications.json' as const;

export type ImpactReviewReferenceKind = 'objective' | 'model' | 'constraint' | 'method' | 'dag';
export type ImpactReviewChangeSource = 'world_model' | 'objective' | 'constraint' | 'judgment_method';
export type ImpactReviewChangeSignificance = 'minor' | 'material' | 'premise_refuted' | 'unknown';
export type ImpactReviewRelationDomain = 'world_model' | 'execution';
export type ImpactReviewRelationKind =
  | 'uses_as_input'
  | 'predicts'
  | 'adopted'
  | 'applies_to'
  | 'execution_depends_on'
  | 'selected_method';

export interface ImpactReviewScope {
  readonly type: 'personal' | 'project' | 'organization';
  readonly id: string;
}

export interface ImpactReviewAccessContext {
  readonly principal: string;
  readonly scope?: ImpactReviewScope;
}

export interface ImpactReviewReference {
  readonly kind: ImpactReviewReferenceKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
  readonly scope: ImpactReviewScope;
}

export interface ImpactReviewChange {
  readonly change_id: string;
  readonly source: ImpactReviewChangeSource;
  readonly previous?: ImpactReviewReference;
  readonly current: ImpactReviewReference;
  readonly significance: ImpactReviewChangeSignificance;
  readonly reason: string;
}

export interface ImpactReviewProblemReference {
  readonly snapshot_id: string;
  readonly problem_id: string;
  readonly revision: string;
}

export interface ImpactReviewResponsible {
  readonly principal: string;
  readonly scope?: string;
}

export interface ImpactReviewPlan {
  readonly plan_id: string;
  readonly owner_scope: ImpactReviewScope;
  readonly read_policy: FoundationAcl;
  readonly problem_snapshot: ImpactReviewProblemReference;
  readonly run_id: string;
  readonly references?: readonly ImpactReviewReference[];
  readonly execution_state: 'planned' | 'running' | 'completed' | 'effect_unknown';
  readonly authority_state: 'valid' | 'expired' | 'revoked' | 'unknown';
  readonly constraint_state: 'valid' | 'violated' | 'expired' | 'unknown';
  readonly responsible: ImpactReviewResponsible;
  readonly due_at?: string;
}

export interface ImpactReviewPlanMatch {
  readonly change_id: string;
  readonly relation: ImpactReviewRelationKind;
  readonly domain: ImpactReviewRelationDomain;
  readonly evidence: string;
}

export interface ImpactReviewAffectedPlan {
  readonly plan: ImpactReviewPlan;
  readonly matches: readonly ImpactReviewPlanMatch[];
}

/** Read-only current-reference lookup. A null result is unresolved, not no impact. */
export interface ImpactReviewCurrentReferencePort {
  readCurrent(
    reference: ImpactReviewReference,
    access: ImpactReviewAccessContext,
  ): Promise<ImpactReviewReference | null>;
}

/** Read-only reverse lookup. It must not change a plan, run, reservation, or effect. */
export interface ImpactReviewIndexPort {
  findAffectedPlans(input: {
    readonly changes: readonly ImpactReviewChange[];
    readonly current_references: readonly ImpactReviewReference[];
    readonly access: ImpactReviewAccessContext;
  }): Promise<readonly ImpactReviewAffectedPlan[]>;
}

export interface ImpactReviewDurableWaitCreateInput {
  readonly wait_id: string;
  readonly principal: string;
  readonly owner_scope: ImpactReviewScope;
  readonly read_policy: FoundationAcl;
  readonly problem_snapshot: ImpactReviewProblemReference;
  readonly condition: {
    readonly event?: { readonly event_type: string; readonly event_id?: string };
    readonly expression?: string;
  };
  readonly deadline?: { readonly due_at?: string; readonly review_interval_ms?: number };
  readonly responsible: ImpactReviewResponsible;
  readonly resume_method: 'new_problem' | 'reconcile_external_effect' | 'manual_review';
  readonly failure_policy: 'new_problem' | 'reconciliation_wait' | 'handoff' | 'fail';
  readonly run_ref: { readonly run_id: string };
}

/** Structural compatibility with Story 13; this package does not import it before it is merged. */
export interface ImpactReviewWaitPort {
  /** The adapter must treat wait_id as an idempotency key. */
  create(input: ImpactReviewDurableWaitCreateInput): Promise<unknown>;
  /** Read the canonical wait with current ACL and snapshot checks. */
  readonly read?: (input: { readonly wait_id: string; readonly principal: string }) => Promise<unknown>;
  markPremiseChanged(input: {
    readonly wait_id: string;
    readonly principal: string;
    readonly new_problem_snapshot: ImpactReviewProblemReference;
    readonly responsible?: ImpactReviewResponsible;
    readonly reason: string;
  }): Promise<unknown>;
}

/**
 * Adapt Story 13's canonical durable-wait ledger to the impact-review port.
 * The coordinator remains independent from the ledger implementation; this
 * boundary only forwards the wait operations it is allowed to request.
 */
export function createCompanyOsImpactReviewDurableWaitPort(
  store: Pick<DurableWaitStore, 'create' | 'get' | 'markPremiseChanged'>,
): ImpactReviewWaitPort {
  if (!store || typeof store.create !== 'function' || typeof store.get !== 'function' || typeof store.markPremiseChanged !== 'function') {
    throw new CompanyOsImpactReviewError('invalid_request', 'durable wait store is required');
  }
  return {
    create(input) {
      return store.create(input);
    },
    read(input) {
      return store.get(input);
    },
    markPremiseChanged(input) {
      return store.markPremiseChanged(input);
    },
  };
}

export interface ImpactReviewNewProblemAndRun {
  readonly problem: ImpactReviewProblemReference;
  readonly run_id: string;
}

export interface ImpactReviewRejudgmentPort {
  createNewProblemAndRun(input: {
    readonly access: ImpactReviewAccessContext;
    readonly plan: ImpactReviewPlan;
    readonly changes: readonly ImpactReviewChange[];
    readonly reason: string;
    /** Stable across retries so the provider can make Problem/run creation idempotent. */
    readonly operation_id: string;
  }): Promise<ImpactReviewNewProblemAndRun>;
}

export type ImpactReviewDisposition = 'continue' | 'hold' | 'stop';

export interface ImpactReviewNotificationInput {
  readonly plan_id: string;
  readonly disposition: ImpactReviewDisposition;
  readonly change_ids: readonly string[];
  readonly reason: string;
  readonly references: readonly ImpactReviewReference[];
  readonly wait_id?: string;
  readonly created_at?: string;
}

export interface ImpactReviewNotificationRecord extends Omit<ImpactReviewNotificationInput, 'created_at'> {
  readonly version: typeof COMPANY_OS_IMPACT_REVIEW_VERSION;
  readonly notification_id: string;
  readonly created_at: string;
}

export interface ImpactReviewNotificationReceipt {
  readonly record: ImpactReviewNotificationRecord;
  readonly status: 'created' | 'existing';
}

export interface ImpactReviewNotificationStore {
  record(input: ImpactReviewNotificationInput): Promise<ImpactReviewNotificationReceipt>;
  read(): Promise<readonly ImpactReviewNotificationRecord[]>;
  list(): Promise<readonly ImpactReviewNotificationRecord[]>;
}

export class CompanyOsImpactReviewError extends Error {
  readonly code:
    | 'invalid_request'
    | 'invalid_provider_result'
    | 'unresolved_reference'
    | 'notification_conflict'
    | 'wait_conflict'
    | 'corrupt_sidecar'
    | 'missing_dependency'
    | 'rejudgment_not_allowed';

  constructor(code: CompanyOsImpactReviewError['code'], message: string) {
    super(message);
    this.name = 'CompanyOsImpactReviewError';
    this.code = code;
  }
}

interface NotificationLedger {
  readonly version: typeof COMPANY_OS_IMPACT_REVIEW_VERSION;
  readonly notifications: readonly ImpactReviewNotificationRecord[];
}

export interface CompanyOsImpactReviewNotificationStoreOptions {
  readonly dataDir: string;
  readonly sidecarPath?: string;
  readonly clock?: () => Date;
}

/**
 * Transactional, reference-only notification storage. The sidecar never
 * stores an Objective/Model/Constraint body and never changes canonical SSOT.
 */
export class AtomicCompanyOsImpactReviewNotificationStore implements ImpactReviewNotificationStore {
  private readonly dataDir: string;
  private readonly sidecarPath: string;
  private readonly clock: () => Date;

  constructor(options: CompanyOsImpactReviewNotificationStoreOptions) {
    if (!options || typeof options.dataDir !== 'string' || options.dataDir.trim() === '') {
      throw new CompanyOsImpactReviewError('invalid_request', 'impact review notification dataDir is required');
    }
    this.dataDir = options.dataDir;
    this.sidecarPath = options.sidecarPath ?? COMPANY_OS_IMPACT_REVIEW_NOTIFICATION_SIDECAR;
    this.clock = options.clock ?? (() => new Date());
  }

  async record(input: ImpactReviewNotificationInput): Promise<ImpactReviewNotificationReceipt> {
    const normalized = normalizeNotificationInput(input, this.clock);
    const notification_id = computeImpactReviewNotificationId(normalized);
    const candidate: ImpactReviewNotificationRecord = {
      version: COMPANY_OS_IMPACT_REVIEW_VERSION,
      notification_id,
      ...normalized,
    };

    await initializePersonalOs(this.dataDir);
    return mutatePersonalOsWithSidecar<ImpactReviewNotificationReceipt>(this.dataDir, this.sidecarPath, async (current, content) => {
      const ledger = parseNotificationLedger(content);
      const existing = ledger.notifications.find((item) => item.notification_id === notification_id);
      if (existing) {
        if (!sameNotificationPayload(existing, candidate)) {
          throw new CompanyOsImpactReviewError(
            'notification_conflict',
            `impact review notification ${notification_id} has a different payload`,
          );
        }
        return { next: current, sidecarContent: serializeNotificationLedger(ledger), result: { record: clone(existing), status: 'existing' as const } };
      }
      const notifications = [...ledger.notifications, candidate].sort((left, right) => left.notification_id.localeCompare(right.notification_id, 'en'));
      return {
        next: current,
        sidecarContent: serializeNotificationLedger({ version: COMPANY_OS_IMPACT_REVIEW_VERSION, notifications }),
        result: { record: clone(candidate), status: 'created' as const },
      };
    });
  }

  async read(): Promise<readonly ImpactReviewNotificationRecord[]> {
    await initializePersonalOs(this.dataDir);
    return parseNotificationLedger(await readPersonalOsSidecar(this.dataDir, this.sidecarPath)).notifications.map(clone);
  }

  async list(): Promise<readonly ImpactReviewNotificationRecord[]> {
    return this.read();
  }
}

export function createCompanyOsImpactReviewNotificationStore(
  options: CompanyOsImpactReviewNotificationStoreOptions,
): ImpactReviewNotificationStore {
  return new AtomicCompanyOsImpactReviewNotificationStore(options);
}

export interface ImpactReviewPlanDecision {
  readonly plan: ImpactReviewPlan;
  readonly matches: readonly ImpactReviewPlanMatch[];
  readonly disposition: ImpactReviewDisposition;
  readonly reason: string;
  readonly notification: ImpactReviewNotificationRecord;
  readonly wait_id?: string;
}

export interface ImpactReviewUnresolvedChange {
  readonly change: ImpactReviewChange;
  readonly reason: string;
}

export interface ImpactReviewResult {
  readonly outcome: 'affected' | 'no_affected_plans' | 'unresolved' | 'affected_and_unresolved';
  readonly decisions: readonly ImpactReviewPlanDecision[];
  readonly resolved_change_ids: readonly string[];
  readonly unresolved_changes: readonly ImpactReviewUnresolvedChange[];
}

export interface ImpactReviewRequest {
  readonly access: ImpactReviewAccessContext;
  readonly changes: readonly ImpactReviewChange[];
}

export interface ImpactReviewReassessRequest {
  readonly access: ImpactReviewAccessContext;
  readonly plan: ImpactReviewPlan;
  readonly changes: readonly ImpactReviewChange[];
  readonly reason: string;
  readonly wait_id?: string;
}

export interface ImpactReviewReassessResult extends ImpactReviewNewProblemAndRun {
  readonly wait_id?: string;
}

export interface CompanyOsImpactReviewCoordinatorOptions {
  readonly currentReferences: ImpactReviewCurrentReferencePort;
  readonly index: ImpactReviewIndexPort;
  readonly notifications: ImpactReviewNotificationStore;
  readonly waits?: ImpactReviewWaitPort;
  readonly rejudgment?: ImpactReviewRejudgmentPort;
}

export class CompanyOsImpactReviewCoordinator {
  private readonly currentReferences: ImpactReviewCurrentReferencePort;
  private readonly index: ImpactReviewIndexPort;
  private readonly notifications: ImpactReviewNotificationStore;
  private readonly waits?: ImpactReviewWaitPort;
  private readonly rejudgment?: ImpactReviewRejudgmentPort;

  constructor(options: CompanyOsImpactReviewCoordinatorOptions) {
    if (!options || !options.currentReferences || typeof options.currentReferences.readCurrent !== 'function') {
      throw new CompanyOsImpactReviewError('invalid_request', 'current reference port is required');
    }
    if (!options.index || typeof options.index.findAffectedPlans !== 'function') {
      throw new CompanyOsImpactReviewError('invalid_request', 'impact index port is required');
    }
    if (!options.notifications || typeof options.notifications.record !== 'function') {
      throw new CompanyOsImpactReviewError('invalid_request', 'notification store is required');
    }
    this.currentReferences = options.currentReferences;
    this.index = options.index;
    this.notifications = options.notifications;
    this.waits = options.waits;
    this.rejudgment = options.rejudgment;
  }

  async review(request: ImpactReviewRequest): Promise<ImpactReviewResult> {
    validateAccess(request.access);
    if (!Array.isArray(request.changes) || request.changes.length === 0) {
      throw new CompanyOsImpactReviewError('invalid_request', 'at least one impact change is required');
    }
    const changes = request.changes.map(validateChange);
    validateUniqueChangeIds(changes);
    const resolved: ImpactReviewChange[] = [];
    const references: ImpactReviewReference[] = [];
    const unresolved_changes: ImpactReviewUnresolvedChange[] = [];

    for (const change of changes) {
      try {
        const current = await this.currentReferences.readCurrent(change.current, request.access);
        if (!current) {
          unresolved_changes.push({ change, reason: 'current reference could not be resolved' });
          continue;
        }
        if (!sameReference(current, change.current)) {
          unresolved_changes.push({ change, reason: 'current reference digest or revision does not match the requested change' });
          continue;
        }
        resolved.push(change);
        references.push(clone(current));
      } catch (error) {
        unresolved_changes.push({
          change,
          reason: error instanceof Error ? `current reference read failed: ${error.message}` : 'current reference read failed',
        });
      }
    }

    const affected = resolved.length === 0
      ? []
      : await this.index.findAffectedPlans({ changes: resolved, current_references: references, access: request.access });
    const grouped = groupAffectedPlans(affected, resolved);
    const decisions: ImpactReviewPlanDecision[] = [];
    for (const entry of grouped) {
      const classification = classifyPlan(entry.plan, entry.matches, new Map(resolved.map((change) => [change.change_id, change])));
      const planReferences = referencesForPlan(entry.plan, references);
      let wait_id: string | undefined;
      if (classification.disposition === 'hold') {
        if (!this.waits) throw new CompanyOsImpactReviewError('missing_dependency', 'durable wait port is required for a held plan');
        wait_id = computeImpactReviewWaitId(entry.plan.plan_id, entry.matches.map((match) => match.change_id), classification.reason, planReferences);
      }
      const notificationInput: ImpactReviewNotificationInput = {
        plan_id: entry.plan.plan_id,
        disposition: classification.disposition,
        change_ids: entry.matches.map((match) => match.change_id),
        reason: classification.reason,
        references: planReferences,
        ...(wait_id ? { wait_id } : {}),
      };
      const existing = (await this.notifications.read()).find((record) => sameNotificationContent(record, notificationInput));
      if (classification.disposition === 'hold' && !existing) {
        const waitInput = buildWaitInput(entry.plan, request.access, wait_id!, classification.reason);
        const existingWait = this.waits?.read
          ? await readWaitOrMissing(this.waits, { wait_id: wait_id!, principal: request.access.principal })
          : undefined;
        if (existingWait !== undefined) {
          assertWaitPayload(existingWait, waitInput);
        } else {
          await this.waits!.create(waitInput);
        }
      }
      const notification = existing
        ? { record: existing, status: 'existing' as const }
        : await this.notifications.record(notificationInput);
      decisions.push({
        plan: clone(entry.plan),
        matches: entry.matches.map(clone),
        disposition: classification.disposition,
        reason: classification.reason,
        notification: notification.record,
        ...(wait_id ? { wait_id } : {}),
      });
    }

    const outcome = unresolved_changes.length > 0
      ? (decisions.length > 0 ? 'affected_and_unresolved' : 'unresolved')
      : (decisions.length > 0 ? 'affected' : 'no_affected_plans');
    return {
      outcome,
      decisions,
      resolved_change_ids: resolved.map((change) => change.change_id),
      unresolved_changes,
    };
  }

  async reassess(request: ImpactReviewReassessRequest): Promise<ImpactReviewReassessResult> {
    validateAccess(request.access);
    validatePlan(request.plan);
    if (!Array.isArray(request.changes) || request.changes.length === 0) throw new CompanyOsImpactReviewError('invalid_request', 'at least one change is required to reassess');
    if (request.reason.trim() === '') throw new CompanyOsImpactReviewError('invalid_request', 'reassessment reason is required');
    if (request.plan.execution_state === 'completed') {
      throw new CompanyOsImpactReviewError('rejudgment_not_allowed', 'completed plan history is immutable and does not need rejudgment');
    }
    if (request.plan.execution_state === 'effect_unknown') {
      throw new CompanyOsImpactReviewError('rejudgment_not_allowed', 'reconcile the unknown external effect before rejudgment');
    }
    if (!this.rejudgment) throw new CompanyOsImpactReviewError('missing_dependency', 'rejudgment port is required');

    const changes = request.changes.map(validateChange);
    validateUniqueChangeIds(changes);
    for (const change of changes) {
      const current = await this.currentReferences.readCurrent(change.current, request.access);
      if (!current || !sameReference(current, change.current)) {
        throw new CompanyOsImpactReviewError('unresolved_reference', `cannot reassess with unresolved reference ${change.current.id}`);
      }
    }
    if (request.wait_id) {
      if (!this.waits || !this.waits.read) {
        throw new CompanyOsImpactReviewError('missing_dependency', 'durable wait read port is required to validate reassessment');
      }
      const wait = await this.waits.read({ wait_id: request.wait_id, principal: request.access.principal });
      assertReassessmentWait(wait, request);
    }
    const operation_id = computeImpactReviewRejudgmentOperationId({
      access: request.access,
      plan: request.plan,
      changes,
      reason: request.reason,
      wait_id: request.wait_id,
    });
    const created = await this.rejudgment.createNewProblemAndRun({
      access: request.access,
      plan: clone(request.plan),
      changes,
      reason: request.reason,
      operation_id,
    });
    validateNewProblemAndRun(created);
    if (request.wait_id) {
      if (!this.waits) throw new CompanyOsImpactReviewError('missing_dependency', 'durable wait port is required to link reassessment');
      await this.waits.markPremiseChanged({
        wait_id: request.wait_id,
        principal: request.access.principal,
        new_problem_snapshot: clone(created.problem),
        responsible: request.plan.responsible,
        reason: request.reason,
      });
    }
    return { ...clone(created), ...(request.wait_id ? { wait_id: request.wait_id } : {}) };
  }
}

export function computeImpactReviewNotificationId(input: ImpactReviewNotificationInput): string {
  const normalized = normalizeNotificationPayload(input);
  return `sha256:${createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex')}`;
}

export function computeImpactReviewWaitId(
  planId: string,
  changeIds: readonly string[],
  reason: string,
  references: readonly ImpactReviewReference[] = [],
): string {
  if (!isNonEmpty(planId) || !isNonEmpty(reason) || changeIds.length === 0) {
    throw new CompanyOsImpactReviewError('invalid_request', 'plan id, change ids, and reason are required for a wait id');
  }
  const canonicalReferences = references.map((reference, index) => validateReference(reference, `wait references[${index}]`)).sort(compareReferences);
  const digest = createHash('sha256').update(canonicalJson({
    plan_id: planId,
    change_ids: [...new Set(changeIds)].sort(),
    reason,
    references: canonicalReferences,
  }), 'utf8').digest('hex');
  return `impact-review-${digest}`;
}

export function computeImpactReviewRejudgmentOperationId(input: {
  readonly access: ImpactReviewAccessContext;
  readonly plan: ImpactReviewPlan;
  readonly changes: readonly ImpactReviewChange[];
  readonly reason: string;
  readonly wait_id?: string;
}): string {
  if (!input || !isNonEmpty(input.plan.plan_id) || !isNonEmpty(input.plan.run_id) || !isNonEmpty(input.reason)) {
    throw new CompanyOsImpactReviewError('invalid_request', 'plan, run, and reassessment reason are required for an operation id');
  }
  const digest = createHash('sha256').update(canonicalJson({
    principal: input.access.principal,
    plan_id: input.plan.plan_id,
    run_id: input.plan.run_id,
    problem_snapshot: input.plan.problem_snapshot,
    wait_id: input.wait_id,
    changes: input.changes.map((change) => ({
      change_id: change.change_id,
      source: change.source,
      previous: change.previous,
      current: change.current,
      significance: change.significance,
      reason: change.reason,
    })).sort((left, right) => left.change_id.localeCompare(right.change_id, 'en')),
    reason: input.reason.trim(),
  }), 'utf8').digest('hex');
  return `impact-review-rejudgment-${digest}`;
}

function buildWaitInput(
  plan: ImpactReviewPlan,
  access: ImpactReviewAccessContext,
  wait_id: string,
  reason: string,
): ImpactReviewDurableWaitCreateInput {
  const effectUnknown = plan.execution_state === 'effect_unknown';
  const authorizationUnknown = plan.authority_state === 'unknown' || plan.constraint_state === 'unknown';
  return {
    wait_id,
    principal: access.principal,
    owner_scope: clone(plan.owner_scope),
    read_policy: clone(plan.read_policy),
    problem_snapshot: clone(plan.problem_snapshot),
    condition: {
      ...(plan.due_at ? {} : { event: { event_type: 'impact_review', event_id: wait_id } }),
      expression: `impact-review:${plan.plan_id}:${reason}`,
    },
    ...(plan.due_at ? { deadline: { due_at: plan.due_at } } : {}),
    responsible: clone(plan.responsible),
    resume_method: effectUnknown ? 'reconcile_external_effect' : authorizationUnknown ? 'manual_review' : 'new_problem',
    failure_policy: effectUnknown ? 'reconciliation_wait' : authorizationUnknown ? 'handoff' : 'new_problem',
    run_ref: { run_id: plan.run_id },
  };
}

function classifyPlan(
  plan: ImpactReviewPlan,
  matches: readonly ImpactReviewPlanMatch[],
  changes: ReadonlyMap<string, ImpactReviewChange>,
): { disposition: ImpactReviewDisposition; reason: string } {
  if (plan.execution_state === 'effect_unknown') {
    return { disposition: 'hold', reason: 'external effect is unknown; reconciliation is required before any rejudgment' };
  }
  if (plan.authority_state === 'revoked' || plan.authority_state === 'expired') {
    return { disposition: 'stop', reason: `execution authority is ${plan.authority_state}; no further execution is permitted` };
  }
  if (plan.constraint_state === 'violated' || plan.constraint_state === 'expired') {
    return { disposition: 'stop', reason: `constraint is ${plan.constraint_state}; no further execution is permitted` };
  }
  if (plan.execution_state === 'completed') {
    return { disposition: 'continue', reason: 'completed history remains immutable; no pending execution is changed' };
  }
  if (plan.authority_state === 'unknown' || plan.constraint_state === 'unknown') {
    return { disposition: 'hold', reason: 'current authority or constraint status is unknown; responsible review is required' };
  }
  const severities = matches.map((match) => changes.get(match.change_id)?.significance);
  if (severities.includes('premise_refuted')) return { disposition: 'hold', reason: 'an adopted premise was refuted; create a new Problem/run after review' };
  if (severities.includes('material')) return { disposition: 'hold', reason: 'a material premise changed; create a new Problem/run after review' };
  if (severities.includes('unknown') || severities.some((value) => value === undefined)) {
    return { disposition: 'hold', reason: 'impact significance is unknown; responsible review is required' };
  }
  return { disposition: 'continue', reason: 'only minor changes were found and current authority and constraints remain valid' };
}

function groupAffectedPlans(
  affected: readonly ImpactReviewAffectedPlan[],
  changes: readonly ImpactReviewChange[],
): Array<{ plan: ImpactReviewPlan; matches: ImpactReviewPlanMatch[] }> {
  if (!Array.isArray(affected)) throw new CompanyOsImpactReviewError('invalid_provider_result', 'impact index must return an array');
  const changeIds = new Set(changes.map((change) => change.change_id));
  const grouped = new Map<string, { plan: ImpactReviewPlan; matches: ImpactReviewPlanMatch[] }>();
  for (const item of affected) {
    if (!item || typeof item !== 'object') throw new CompanyOsImpactReviewError('invalid_provider_result', 'impact index returned an invalid plan');
    const plan = validatePlan(item.plan);
    if (!Array.isArray(item.matches) || item.matches.length === 0) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${plan.plan_id} has no impact matches`);
    const matches = item.matches.map((match: ImpactReviewPlanMatch) => validateMatch(match, changeIds));
    const existing = grouped.get(plan.plan_id);
    if (existing) {
      if (canonicalJson(existing.plan) !== canonicalJson(plan)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${plan.plan_id} was returned with conflicting definitions`);
      existing.matches.push(...matches);
    } else {
      grouped.set(plan.plan_id, { plan: clone(plan), matches: [...matches] });
    }
  }
  return [...grouped.values()].map((entry) => ({
    plan: entry.plan,
    matches: deduplicateMatches(entry.matches),
  })).sort((left, right) => left.plan.plan_id.localeCompare(right.plan.plan_id, 'en'));
}

function referencesForPlan(plan: ImpactReviewPlan, current: readonly ImpactReviewReference[]): ImpactReviewReference[] {
  const refs = plan.references && plan.references.length > 0 ? plan.references : current;
  return [...refs].map(clone).sort(compareReferences);
}

async function readWaitOrMissing(
  waits: ImpactReviewWaitPort,
  input: { readonly wait_id: string; readonly principal: string },
): Promise<unknown | undefined> {
  if (!waits.read) return undefined;
  try {
    return await waits.read(input);
  } catch (error) {
    if (isWaitNotFoundError(error)) return undefined;
    throw error;
  }
}

function isWaitNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { readonly code?: unknown }).code === 'not_found');
}

function assertWaitPayload(value: unknown, expected: ImpactReviewDurableWaitCreateInput): void {
  if (!value || typeof value !== 'object') throw new CompanyOsImpactReviewError('invalid_provider_result', 'durable wait read returned an invalid record');
  const actual = value as Record<string, unknown>;
  const comparableActual = {
    wait_id: actual.wait_id,
    owner_scope: actual.owner_scope,
    read_policy: actual.read_policy,
    problem_snapshot: actual.problem_snapshot,
    condition: actual.condition,
    deadline: actual.deadline,
    responsible: actual.responsible,
    resume_method: actual.resume_method,
    failure_policy: actual.failure_policy,
    run_ref: actual.run_ref,
  };
  const comparableExpected = {
    wait_id: expected.wait_id,
    owner_scope: expected.owner_scope,
    read_policy: expected.read_policy,
    problem_snapshot: expected.problem_snapshot,
    condition: expected.condition,
    deadline: expected.deadline,
    responsible: expected.responsible,
    resume_method: expected.resume_method,
    failure_policy: expected.failure_policy,
    run_ref: expected.run_ref,
  };
  if (canonicalJson(comparableActual) !== canonicalJson(comparableExpected)) {
    throw new CompanyOsImpactReviewError('wait_conflict', `durable wait ${expected.wait_id} has a different payload`);
  }
}

function assertReassessmentWait(value: unknown, request: ImpactReviewReassessRequest): void {
  if (!value || typeof value !== 'object') throw new CompanyOsImpactReviewError('invalid_provider_result', 'durable wait read returned an invalid record');
  const record = value as {
    readonly wait_id?: unknown;
    readonly problem_snapshot?: unknown;
    readonly run_ref?: { readonly run_id?: unknown };
    readonly condition?: { readonly expression?: unknown };
    readonly state?: unknown;
  };
  if (record.wait_id !== request.wait_id) {
    throw new CompanyOsImpactReviewError('wait_conflict', 'durable wait id does not match the reassessment request');
  }
  if (canonicalJson(record.problem_snapshot) !== canonicalJson(request.plan.problem_snapshot)) {
    throw new CompanyOsImpactReviewError('wait_conflict', 'durable wait Problem snapshot does not match the plan');
  }
  if (record.run_ref?.run_id !== request.plan.run_id) {
    throw new CompanyOsImpactReviewError('wait_conflict', 'durable wait run does not match the plan');
  }
  const expression = record.condition?.expression;
  if (!isNonEmpty(expression) || !expression.startsWith(`impact-review:${request.plan.plan_id}:`)) {
    throw new CompanyOsImpactReviewError('wait_conflict', 'durable wait plan does not match the reassessment request');
  }
  if (record.state === 'reconciliation_wait') {
    throw new CompanyOsImpactReviewError('rejudgment_not_allowed', 'reconcile the durable wait external effect before rejudgment');
  }
  if (record.state === 'resumed' || record.state === 'failed' || record.state === 'cancelled') {
    throw new CompanyOsImpactReviewError('rejudgment_not_allowed', `durable wait is ${String(record.state)} and cannot be reassessed`);
  }
}

function validateAccess(access: ImpactReviewAccessContext): void {
  if (!access || !isNonEmpty(access.principal)) throw new CompanyOsImpactReviewError('invalid_request', 'access principal is required');
  if (access.scope) validateScope(access.scope, 'access.scope');
}

function validateChange(input: ImpactReviewChange): ImpactReviewChange {
  if (!input || typeof input !== 'object') throw new CompanyOsImpactReviewError('invalid_request', 'impact change is required');
  if (!isNonEmpty(input.change_id) || !isNonEmpty(input.reason)) throw new CompanyOsImpactReviewError('invalid_request', 'change id and reason are required');
  if (!['world_model', 'objective', 'constraint', 'judgment_method'].includes(input.source)) throw new CompanyOsImpactReviewError('invalid_request', 'invalid change source');
  if (!['minor', 'material', 'premise_refuted', 'unknown'].includes(input.significance)) throw new CompanyOsImpactReviewError('invalid_request', 'invalid change significance');
  const current = validateReference(input.current, 'change.current');
  if (input.previous) {
    const previous = validateReference(input.previous, 'change.previous');
    if (previous.kind !== current.kind || previous.id !== current.id) throw new CompanyOsImpactReviewError('invalid_request', 'previous and current references must identify the same canonical item');
  }
  return clone({ ...input, current });
}

function validateUniqueChangeIds(changes: readonly ImpactReviewChange[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    if (seen.has(change.change_id)) throw new CompanyOsImpactReviewError('invalid_request', `change id ${change.change_id} appears more than once`);
    seen.add(change.change_id);
  }
}

function validateReference(input: ImpactReviewReference, label: string): ImpactReviewReference {
  if (!input || typeof input !== 'object' || !isNonEmpty(input.id) || !isNonEmpty(input.revision) || !isNonEmpty(input.digest)) {
    throw new CompanyOsImpactReviewError('invalid_request', `${label} must contain id, revision, and digest`);
  }
  if (!['objective', 'model', 'constraint', 'method', 'dag'].includes(input.kind)) throw new CompanyOsImpactReviewError('invalid_request', `${label}.kind is invalid`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.digest)) throw new CompanyOsImpactReviewError('invalid_request', `${label}.digest must be sha256:<64 lowercase hex>`);
  validateScope(input.scope, `${label}.scope`);
  return clone(input);
}

function validateScope(scope: ImpactReviewScope, label: string): ImpactReviewScope {
  if (!scope || !['personal', 'project', 'organization'].includes(scope.type) || !isNonEmpty(scope.id)) throw new CompanyOsImpactReviewError('invalid_request', `${label} is invalid`);
  return clone(scope);
}

function validatePlan(input: ImpactReviewPlan): ImpactReviewPlan {
  if (!input || typeof input !== 'object' || !isNonEmpty(input.plan_id) || !isNonEmpty(input.run_id)) throw new CompanyOsImpactReviewError('invalid_provider_result', 'plan id and run id are required');
  validateScope(input.owner_scope, `plan ${input.plan_id}.owner_scope`);
  if (!input.read_policy || !isNonEmpty(input.read_policy.ownerId) || !['private', 'project', 'organization', 'public'].includes(input.read_policy.visibility)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.read_policy is invalid`);
  if (!Array.isArray(input.read_policy.readerIds) || !Array.isArray(input.read_policy.writerIds)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.read_policy lists are invalid`);
  if (!input.problem_snapshot || !isNonEmpty(input.problem_snapshot.snapshot_id) || !isNonEmpty(input.problem_snapshot.problem_id) || !isNonEmpty(input.problem_snapshot.revision)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.problem_snapshot is invalid`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.problem_snapshot.snapshot_id)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.problem_snapshot.snapshot_id is invalid`);
  if (!['planned', 'running', 'completed', 'effect_unknown'].includes(input.execution_state)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.execution_state is invalid`);
  if (!['valid', 'expired', 'revoked', 'unknown'].includes(input.authority_state)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.authority_state is invalid`);
  if (!['valid', 'violated', 'expired', 'unknown'].includes(input.constraint_state)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.constraint_state is invalid`);
  if (!input.responsible || !isNonEmpty(input.responsible.principal)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.responsible is invalid`);
  if (input.due_at !== undefined && !isNonEmpty(input.due_at)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.due_at is invalid`);
  if (input.references !== undefined && !Array.isArray(input.references)) throw new CompanyOsImpactReviewError('invalid_provider_result', `plan ${input.plan_id}.references must be an array`);
  if (input.references) input.references.forEach((reference, index) => validateReference(reference, `plan ${input.plan_id}.references[${index}]`));
  return clone(input);
}

function validateMatch(input: ImpactReviewPlanMatch, changeIds: ReadonlySet<string>): ImpactReviewPlanMatch {
  if (!input || !changeIds.has(input.change_id) || !isNonEmpty(input.evidence)) throw new CompanyOsImpactReviewError('invalid_provider_result', 'impact match is invalid or refers to an unresolved change');
  const worldModelRelations: readonly ImpactReviewRelationKind[] = ['uses_as_input', 'predicts', 'adopted', 'applies_to'];
  const executionRelations: readonly ImpactReviewRelationKind[] = ['execution_depends_on', 'selected_method'];
  if (!['world_model', 'execution'].includes(input.domain)) throw new CompanyOsImpactReviewError('invalid_provider_result', `relation domain ${input.domain} is invalid`);
  if ((input.domain === 'world_model' && !worldModelRelations.includes(input.relation)) || (input.domain === 'execution' && !executionRelations.includes(input.relation))) {
    throw new CompanyOsImpactReviewError('invalid_provider_result', `relation ${input.relation} is invalid for domain ${input.domain}`);
  }
  return clone(input);
}

function validateNewProblemAndRun(value: ImpactReviewNewProblemAndRun): void {
  if (!value || !value.problem || !isNonEmpty(value.problem.snapshot_id) || !isNonEmpty(value.problem.problem_id) || !isNonEmpty(value.problem.revision) || !/^sha256:[0-9a-f]{64}$/u.test(value.problem.snapshot_id) || !isNonEmpty(value.run_id)) {
    throw new CompanyOsImpactReviewError('invalid_provider_result', 'rejudgment port returned an invalid Problem/run');
  }
}

function normalizeNotificationInput(input: ImpactReviewNotificationInput, clock: () => Date): ImpactReviewNotificationInput & { created_at: string } {
  if (!input || !isNonEmpty(input.plan_id) || !isNonEmpty(input.reason) || !Array.isArray(input.change_ids) || input.change_ids.length === 0 || !Array.isArray(input.references)) {
    throw new CompanyOsImpactReviewError('invalid_request', 'notification plan, reason, change ids, and references are required');
  }
  if (!['continue', 'hold', 'stop'].includes(input.disposition)) throw new CompanyOsImpactReviewError('invalid_request', 'notification disposition is invalid');
  const change_ids = [...new Set(input.change_ids.map((id) => String(id).trim()))].sort((left, right) => left.localeCompare(right, 'en'));
  if (change_ids.some((id) => id === '')) throw new CompanyOsImpactReviewError('invalid_request', 'notification change ids must be non-empty');
  const references = input.references.map((reference, index) => validateReference(reference, `notification.references[${index}]`)).sort(compareReferences);
  const created_at = input.created_at ?? clock().toISOString();
  if (!isNonEmpty(created_at) || Number.isNaN(Date.parse(created_at))) throw new CompanyOsImpactReviewError('invalid_request', 'notification created_at must be a valid timestamp');
  return {
    plan_id: input.plan_id.trim(),
    disposition: input.disposition,
    change_ids,
    reason: input.reason.trim(),
    references,
    ...(input.wait_id ? { wait_id: input.wait_id } : {}),
    created_at,
  };
}

function normalizeNotificationPayload(input: ImpactReviewNotificationInput): ImpactReviewNotificationInput {
  return {
    plan_id: input.plan_id.trim(),
    disposition: input.disposition,
    change_ids: [...new Set(input.change_ids.map((id) => String(id).trim()))].sort((left, right) => left.localeCompare(right, 'en')),
    reason: input.reason.trim(),
    references: [...input.references].map(clone).sort(compareReferences),
    ...(input.wait_id ? { wait_id: input.wait_id } : {}),
    ...(input.created_at !== undefined ? { created_at: input.created_at } : {}),
  };
}

function parseNotificationLedger(content: string | undefined): NotificationLedger {
  if (content === undefined || content.trim() === '') return { version: COMPANY_OS_IMPACT_REVIEW_VERSION, notifications: [] };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new CompanyOsImpactReviewError('corrupt_sidecar', 'impact review notification sidecar is not valid JSON');
  }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== COMPANY_OS_IMPACT_REVIEW_VERSION || !Array.isArray((value as { notifications?: unknown }).notifications)) {
    throw new CompanyOsImpactReviewError('corrupt_sidecar', 'impact review notification sidecar has an invalid envelope');
  }
  const notifications = (value as { notifications: unknown[] }).notifications.map((item, index) => parseNotificationRecord(item, index));
  const ids = new Set<string>();
  for (const record of notifications) {
    if (ids.has(record.notification_id)) throw new CompanyOsImpactReviewError('corrupt_sidecar', `duplicate notification id ${record.notification_id}`);
    ids.add(record.notification_id);
  }
  return { version: COMPANY_OS_IMPACT_REVIEW_VERSION, notifications: notifications.sort((left, right) => left.notification_id.localeCompare(right.notification_id, 'en')) };
}

function parseNotificationRecord(value: unknown, index: number): ImpactReviewNotificationRecord {
  if (!value || typeof value !== 'object') throw new CompanyOsImpactReviewError('corrupt_sidecar', `notification ${index + 1} is invalid`);
  const item = value as Partial<ImpactReviewNotificationRecord>;
  if (item.version !== COMPANY_OS_IMPACT_REVIEW_VERSION || !isNonEmpty(item.created_at) || Number.isNaN(Date.parse(item.created_at))) {
    throw new CompanyOsImpactReviewError('corrupt_sidecar', `notification ${index + 1} has invalid version or created_at`);
  }
  let normalized: ImpactReviewNotificationInput & { created_at: string };
  try {
    normalized = normalizeNotificationInput(item as ImpactReviewNotificationInput, () => new Date(item.created_at as string));
  } catch (error) {
    if (error instanceof CompanyOsImpactReviewError && error.code === 'corrupt_sidecar') throw error;
    throw new CompanyOsImpactReviewError('corrupt_sidecar', `notification ${index + 1} has an invalid payload`);
  }
  if (!isNonEmpty(item.notification_id) || item.notification_id !== computeImpactReviewNotificationId(normalized)) throw new CompanyOsImpactReviewError('corrupt_sidecar', `notification ${index + 1} has an invalid id`);
  return { version: COMPANY_OS_IMPACT_REVIEW_VERSION, notification_id: item.notification_id, ...normalized };
}

function serializeNotificationLedger(ledger: NotificationLedger): string {
  return `${JSON.stringify({ version: ledger.version, notifications: ledger.notifications })}\n`;
}

function sameNotificationPayload(left: ImpactReviewNotificationRecord, right: ImpactReviewNotificationRecord): boolean {
  return canonicalJson({ ...left, notification_id: undefined }) === canonicalJson({ ...right, notification_id: undefined });
}

function sameNotificationContent(left: ImpactReviewNotificationRecord, right: ImpactReviewNotificationInput): boolean {
  return canonicalJson(notificationContentPayload(left)) === canonicalJson(notificationContentPayload(right));
}

function notificationContentPayload(input: Pick<ImpactReviewNotificationInput, 'plan_id' | 'disposition' | 'change_ids' | 'reason' | 'references' | 'wait_id'>): unknown {
  return {
    plan_id: input.plan_id.trim(),
    disposition: input.disposition,
    change_ids: [...new Set(input.change_ids.map((id) => String(id).trim()))].sort((left, right) => left.localeCompare(right, 'en')),
    reason: input.reason.trim(),
    references: [...input.references].map(clone).sort(compareReferences),
    ...(input.wait_id ? { wait_id: input.wait_id } : {}),
  };
}

function deduplicateMatches(matches: readonly ImpactReviewPlanMatch[]): ImpactReviewPlanMatch[] {
  const map = new Map<string, ImpactReviewPlanMatch>();
  for (const match of matches) map.set(`${match.change_id}\u0000${match.domain}\u0000${match.relation}\u0000${match.evidence}`, match);
  return [...map.values()].sort((left, right) => `${left.change_id}\u0000${left.domain}\u0000${left.relation}\u0000${left.evidence}`.localeCompare(`${right.change_id}\u0000${right.domain}\u0000${right.relation}\u0000${right.evidence}`, 'en'));
}

function sameReference(left: ImpactReviewReference, right: ImpactReviewReference): boolean {
  return left.kind === right.kind && left.id === right.id && left.revision === right.revision && left.digest === right.digest && canonicalJson(left.scope) === canonicalJson(right.scope);
}

function compareReferences(left: ImpactReviewReference, right: ImpactReviewReference): number {
  return `${left.kind}\u0000${left.id}\u0000${left.revision}\u0000${left.digest}\u0000${left.scope.type}\u0000${left.scope.id}`.localeCompare(`${right.kind}\u0000${right.id}\u0000${right.revision}\u0000${right.digest}\u0000${right.scope.type}\u0000${right.scope.id}`, 'en');
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, item]) => [key, canonicalize(item)]));
}
