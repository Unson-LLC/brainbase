import type {
  JudgmentViewAccessContext,
  JudgmentViewDocument,
} from './judgment-view.js';
import {
  JUDGMENT_HISTORY_CONTRACT_VERSION,
  JUDGMENT_HISTORY_RECORD_SCHEMA,
  type JudgmentHistoryAlternative,
  type JudgmentHistoryExecutionStatus,
  type JudgmentHistoryJudgment,
  type JudgmentHistoryRecord,
  type JudgmentHistoryReference,
  type JudgmentHistorySource,
  type JudgmentHistorySourceSnapshot,
} from './judgment-history.js';

/**
 * The implementation contract for the Company OS slice of the normal
 * judgment-history reader.
 *
 * This module is deliberately a projection adapter.  It does not create a
 * catalog, copy a run, or persist a second history.  A host supplies a
 * trusted `listRun` port backed by the existing Composition run/judgment-view
 * source and keeps the owner/scope check at that source boundary.
 *
 * @see brainbase-project/docs/specs/judgment-history-end-to-end-v1.md
 * @see brainbase-project/docs/architecture/judgment-history-recording-boundary-v1.md
 */

export const COMPANY_OS_JUDGMENT_HISTORY_ADAPTER_VERSION = 'company-os-judgment-history.v1' as const;
export const COMPANY_OS_JUDGMENT_HISTORY_SPEC_REFERENCE =
  'brainbase-project/docs/specs/judgment-history-end-to-end-v1.md' as const;
export const COMPANY_OS_JUDGMENT_HISTORY_RECORD_SCHEMA = JUDGMENT_HISTORY_RECORD_SCHEMA;
export const COMPANY_OS_JUDGMENT_HISTORY_CONTRACT_VERSION = JUDGMENT_HISTORY_CONTRACT_VERSION;

export type CompanyOsJudgmentHistoryListStatus = 'available' | 'partial' | 'unavailable';
export type CompanyOsJudgmentHistoryEntrypoint = 'company_os';
export type CompanyOsJudgmentHistoryExecutionStatus = JudgmentHistoryExecutionStatus;
export type CompanyOsJudgmentHistoryOutcomeStatus = 'unconfirmed' | 'confirmed' | 'unknown';
export type CompanyOsJudgmentHistoryReferenceAvailability =
  | 'recorded'
  | 'permission_denied'
  | 'unavailable'
  | 'unknown';

export type CompanyOsJudgmentHistoryReference = JudgmentHistoryReference;

export type CompanyOsJudgmentHistoryAlternative = JudgmentHistoryAlternative;

export interface CompanyOsStoredJudgment {
  readonly status?: string | null;
  readonly summary?: string | null;
  readonly reason?: string | null;
  readonly selected_references?: readonly CompanyOsJudgmentHistoryReference[] | null;
  readonly alternatives?: readonly CompanyOsJudgmentHistoryAlternative[] | null;
}

export interface CompanyOsStoredExecution {
  readonly status?: CompanyOsJudgmentHistoryExecutionStatus | null;
  readonly result_summary?: string | null;
  readonly outcome_status?: CompanyOsJudgmentHistoryOutcomeStatus | null;
}

/**
 * Public fields already written by the Company OS source.  Free-form source
 * text is accepted only through these fields; the adapter never copies a
 * conclusion, child-run output, or internal execution trace into a summary.
 */
export interface CompanyOsJudgmentHistorySourceRun {
  /** Stable source identity.  If omitted, the historical view's runId is used. */
  readonly source_id?: string;
  /** Stored timestamp; the adapter does not replace it with the current time. */
  readonly recorded_at: string;
  /** Null means the source explicitly recorded that the project is unknown. */
  readonly project_code?: string | null;
  /** Exact source turn identity.  The common record requires this field. */
  readonly turn_ref: string;
  /** The source owner must exactly match the trusted request access context. */
  readonly owner: JudgmentViewAccessContext;
  /** Historical view resolved from the same source run and owner scope. */
  readonly view: JudgmentViewDocument;
  /** Explicit public judgment fields, when the source recorded them. */
  readonly public_judgment?: CompanyOsStoredJudgment;
  /** Explicit public execution fields, when the source recorded them. */
  readonly public_execution?: CompanyOsStoredExecution;
}

export interface CompanyOsJudgmentHistoryListRunRequest {
  readonly access: JudgmentViewAccessContext;
  readonly period?: 'week' | 'past30days' | 'all';
  readonly project?: string;
  readonly entrypoint?: CompanyOsJudgmentHistoryEntrypoint;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * This is the only source-side list dependency.  The host owns enumeration,
 * current ACL checks, and source snapshot/cursor semantics.  The adapter does
 * not discover repositories or fall back to a service identity.
 */
export interface CompanyOsJudgmentHistoryListRunPort {
  readonly listRun: (
    request: CompanyOsJudgmentHistoryListRunRequest,
  ) => Promise<CompanyOsJudgmentHistoryListRunResult> | CompanyOsJudgmentHistoryListRunResult;
}

export interface CompanyOsJudgmentHistoryListRunSuccess {
  readonly status?: Exclude<CompanyOsJudgmentHistoryListStatus, 'unavailable'>;
  readonly runs: readonly CompanyOsJudgmentHistorySourceRun[];
  readonly complete?: boolean;
  readonly total?: number | null;
  readonly storage?: 'local' | 'server' | null;
  readonly reason?: string | null;
  /** Stable source revision for cursor binding, when the host can provide it. */
  readonly snapshot_id?: string;
}

export interface CompanyOsJudgmentHistoryListRunUnavailable {
  readonly status: 'unavailable';
  readonly runs?: null;
  readonly complete?: false;
  readonly total?: null;
  readonly storage?: 'local' | 'server' | null;
  readonly reason?: string | null;
}

export type CompanyOsJudgmentHistoryListRunResult =
  | readonly CompanyOsJudgmentHistorySourceRun[]
  | CompanyOsJudgmentHistoryListRunSuccess
  | CompanyOsJudgmentHistoryListRunUnavailable;

export type CompanyOsJudgmentHistoryRecord = JudgmentHistoryRecord;

export interface CompanyOsJudgmentHistoryCoverage {
  readonly complete: boolean;
  readonly storage: 'local' | 'server' | null;
  readonly reason: string | null;
  readonly sources: readonly [{
    readonly entrypoint: CompanyOsJudgmentHistoryEntrypoint;
    readonly status: CompanyOsJudgmentHistoryListStatus;
    readonly reason: string | null;
  }];
  readonly total: number | null;
}

export interface CompanyOsJudgmentHistoryList {
  readonly contract_version: typeof COMPANY_OS_JUDGMENT_HISTORY_CONTRACT_VERSION;
  readonly status: CompanyOsJudgmentHistoryListStatus;
  readonly records: readonly CompanyOsJudgmentHistoryRecord[];
  readonly coverage: CompanyOsJudgmentHistoryCoverage;
  readonly pagination: {
    readonly next_cursor: string | null;
    readonly previous_cursor: string | null;
    readonly limit: number | null;
  };
  readonly filters: {
    readonly period: 'week' | 'past30days' | 'all' | null;
    readonly project: string | null;
    readonly entrypoint: CompanyOsJudgmentHistoryEntrypoint;
  };
  /** Source revision used by the common reader to bind pagination cursors. */
  readonly snapshot_id?: string;
}

export interface CompanyOsJudgmentHistoryAdapter {
  readonly list: (
    request: CompanyOsJudgmentHistoryListRunRequest,
  ) => Promise<CompanyOsJudgmentHistoryList>;
}

export interface CompanyOsJudgmentHistoryAdapterOptions {
  readonly sourcePort?: CompanyOsJudgmentHistoryListRunPort;
}

export interface CompanyOsJudgmentHistorySourceOptions {
  /** Trusted context captured by the host before constructing this source. */
  readonly access: JudgmentViewAccessContext;
  readonly sourcePort?: CompanyOsJudgmentHistoryListRunPort;
}

const EXECUTION_STATUSES: readonly CompanyOsJudgmentHistoryExecutionStatus[] = [
  'pending',
  'completed',
  'failed',
  'held',
  'cancelled',
  'unknown',
];
const OUTCOME_STATUSES: readonly CompanyOsJudgmentHistoryOutcomeStatus[] = [
  'unconfirmed',
  'confirmed',
  'unknown',
];

/**
 * Stable identity helper shared with Host injection tests.  It is derived
 * only from the owner binding and source identity; content and current time
 * are intentionally excluded so retries cannot replace an old record.
 */
export function companyOsJudgmentHistoryRecordId(
  owner: JudgmentViewAccessContext,
  sourceId: string,
): string {
  return [
    'company_os',
    encodeURIComponent(owner.tenantId),
    encodeURIComponent(owner.scopeId),
    encodeURIComponent(sourceId),
  ].join(':');
}

export function createCompanyOsJudgmentHistoryAdapter(
  options: CompanyOsJudgmentHistoryAdapterOptions = {},
): CompanyOsJudgmentHistoryAdapter {
  return {
    async list(request) {
      return readCompanyOsJudgmentHistory(options.sourcePort, request);
    },
  };
}

/**
 * Builds the common reader source expected by `createJudgmentHistoryReader`.
 * The access context is intentionally construction-time state: the common
 * source interface has a zero-argument `read`, so a caller-provided query
 * cannot widen the owner or scope after the trusted host boundary.
 */
export function createCompanyOsJudgmentHistorySource(
  options: CompanyOsJudgmentHistorySourceOptions,
): JudgmentHistorySource {
  assertAccess(options.access);
  return {
    storage: 'server',
    async read(): Promise<JudgmentHistorySourceSnapshot> {
      const result = await readCompanyOsJudgmentHistory(options.sourcePort, {
        access: options.access,
        period: 'all',
        entrypoint: 'company_os',
        limit: 100,
      });
      const storage = 'server' as const;
      const source = result.coverage.sources[0];
      if (result.status === 'unavailable') {
        return {
          status: 'unavailable',
          records: null,
          coverage: {
            complete: false,
            storage,
            reason: result.coverage.reason,
            sources: [{ entrypoint: 'company_os', status: 'unavailable', reason: result.coverage.reason }],
            total: null,
          },
        };
      }
      return {
        status: result.status,
        records: result.records,
        coverage: {
          complete: result.coverage.complete,
          storage,
          reason: result.coverage.reason,
          sources: [{
            entrypoint: 'company_os',
            status: source?.status ?? result.status,
            reason: source?.reason ?? result.coverage.reason,
          }],
          total: result.coverage.total,
        },
        snapshot_id: result.snapshot_id,
      };
    },
  };
}

/**
 * Projects existing Company OS runs to the common list shape.  A missing port
 * is an explicit unavailable source, never an empty successful history.
 */
export async function readCompanyOsJudgmentHistory(
  sourcePort: CompanyOsJudgmentHistoryListRunPort | undefined,
  request: CompanyOsJudgmentHistoryListRunRequest,
): Promise<CompanyOsJudgmentHistoryList> {
  assertAccess(request.access);
  const filters = {
    period: request.period ?? null,
    project: request.project ?? null,
    entrypoint: 'company_os' as const,
  };

  if (!sourcePort || typeof sourcePort.listRun !== 'function') {
    return unavailableList(
      filters,
      'company_os_judgment_history_source_not_injected',
    );
  }

  let sourceResult: CompanyOsJudgmentHistoryListRunResult;
  try {
    sourceResult = await sourcePort.listRun(request);
  } catch {
    return unavailableList(filters, 'company_os_judgment_history_source_read_failed');
  }

  const normalized = normalizeSourceResult(sourceResult);
  if (normalized.status === 'unavailable') {
    return unavailableList(filters, normalized.reason ?? 'company_os_judgment_history_source_unavailable', {
      storage: normalized.storage,
    });
  }

  const records: CompanyOsJudgmentHistoryRecord[] = [];
  let rejected = 0;
  for (const sourceRun of normalized.runs) {
    const projection = projectSourceRun(sourceRun, request.access);
    if (projection.record) {
      records.push(projection.record);
    } else {
      rejected += 1;
    }
  }

  const rejectedReason = rejected > 0 ? 'company_os_judgment_history_source_record_invalid_or_scope_mismatch' : null;
  const status: CompanyOsJudgmentHistoryListStatus =
    normalized.status === 'partial' || rejected > 0 ? 'partial' : 'available';
  const complete = normalized.complete && rejected === 0;
  const total = complete
    ? normalized.total ?? records.length
    : null;
  const reason = rejectedReason ?? normalized.reason ?? null;

  return {
    contract_version: COMPANY_OS_JUDGMENT_HISTORY_CONTRACT_VERSION,
    status,
    records,
    coverage: {
      complete,
      storage: normalized.storage,
      reason,
      sources: [{ entrypoint: 'company_os', status, reason }],
      total,
    },
    pagination: {
      next_cursor: null,
      previous_cursor: null,
      limit: request.limit ?? null,
    },
    filters,
    snapshot_id: normalized.snapshot_id,
  };
}

interface NormalizedSourceResult {
  readonly status: CompanyOsJudgmentHistoryListStatus;
  readonly runs: readonly CompanyOsJudgmentHistorySourceRun[];
  readonly complete: boolean;
  readonly total: number | null;
  readonly storage: 'local' | 'server' | null;
  readonly reason: string | null;
  readonly snapshot_id?: string;
}

function normalizeSourceResult(
  sourceResult: CompanyOsJudgmentHistoryListRunResult,
): NormalizedSourceResult {
  if (Array.isArray(sourceResult)) {
    return {
      status: 'available',
      runs: sourceResult,
      complete: true,
      total: sourceResult.length,
      storage: null,
      reason: null,
      snapshot_id: undefined,
    };
  }

  const runs = Array.isArray(sourceResult.runs) ? sourceResult.runs : [];
  const declaredStatus = sourceResult.status ?? 'available';
  const declaredComplete = sourceResult.complete ?? (declaredStatus === 'available');
  // A source cannot claim an available snapshot while also saying that its
  // scan is incomplete. Normalize contradictory host output to partial so
  // the common reader never advertises a complete count by accident.
  const status: CompanyOsJudgmentHistoryListStatus = declaredStatus === 'unavailable'
    ? 'unavailable'
    : declaredStatus === 'available' && declaredComplete ? 'available' : 'partial';
  const complete = status === 'available' && declaredComplete;
  return {
    status,
    runs,
    complete,
    total: sourceResult.total ?? null,
    storage: sourceResult.storage ?? null,
    reason: sourceResult.reason ?? null,
    snapshot_id: isNonEmptyString(sourceResult.snapshot_id) ? sourceResult.snapshot_id : undefined,
  };
}

interface SourceProjection {
  readonly record?: CompanyOsJudgmentHistoryRecord;
}

function projectSourceRun(
  sourceRun: CompanyOsJudgmentHistorySourceRun,
  access: JudgmentViewAccessContext,
): SourceProjection {
  if (!sameAccess(sourceRun.owner, access)) return {};
  if (!isIsoTimestamp(sourceRun.recorded_at)) return {};
  if (!sourceRun.view || sourceRun.view.run.status !== 'resolved' || !sourceRun.view.run.value) return {};

  const run = sourceRun.view.run.value;
  const sourceId = sourceRun.source_id ?? run.runId;
  if (!isSafeSourceIdentity(sourceId)) return {};

  const missingFields: string[] = [];
  const storedJudgment = sourceRun.public_judgment;
  const judgmentStatus = readJudgmentStatus(storedJudgment?.status);
  if (!readText(storedJudgment?.status)) missingFields.push('judgment.status');

  const summary = readText(storedJudgment?.summary);
  if (summary === null) missingFields.push('judgment.summary');
  const reason = readText(storedJudgment?.reason);
  if (reason === null) missingFields.push('judgment.reason');

  const selectedReferences = projectSelectedReferences(sourceRun.view, storedJudgment, missingFields);
  const alternatives = projectAlternatives(storedJudgment, missingFields);

  const storedExecution = sourceRun.public_execution;
  const executionStatus = readExecutionStatus(storedExecution?.status) ?? mapRunStatus(run.status);
  const resultSummary = readText(storedExecution?.result_summary);
  if (resultSummary === null) missingFields.push('execution.result_summary');

  // Completion is an operational fact.  Without an explicitly stored
  // semantic result, the outcome stays unconfirmed even when a separate
  // historical resultEvaluation is present in the view.
  const outcomeStatus = readOutcomeStatus(storedExecution?.outcome_status) ?? 'unconfirmed';
  if (!readOutcomeStatus(storedExecution?.outcome_status)) {
    missingFields.push('execution.outcome_status');
  }

  if (!hasOwn(sourceRun, 'project_code')) missingFields.push('project_code');
  if (!isNonEmptyString(sourceRun.turn_ref)) return {};

  return {
    record: {
      schema_version: COMPANY_OS_JUDGMENT_HISTORY_RECORD_SCHEMA,
      record_id: companyOsJudgmentHistoryRecordId(access, sourceId),
      entrypoint: 'company_os',
      recorded_at: sourceRun.recorded_at,
      project_code: sourceRun.project_code ?? null,
      turn_ref: sourceRun.turn_ref,
      judgment: {
        status: judgmentStatus,
        summary,
        reason,
        selected_references: selectedReferences,
        alternatives,
      },
      execution: {
        status: executionStatus,
        result_summary: resultSummary,
        outcome_status: outcomeStatus,
      },
      missing_fields: unique(missingFields),
    },
  };
}

function readJudgmentStatus(value: unknown): JudgmentHistoryJudgment['status'] {
  return value === 'resolved' || value === 'needs_clarification' ? value : 'unknown';
}

function projectSelectedReferences(
  view: JudgmentViewDocument,
  storedJudgment: CompanyOsStoredJudgment | undefined,
  missingFields: string[],
): readonly CompanyOsJudgmentHistoryReference[] | null {
  if (storedJudgment && hasOwn(storedJudgment, 'selected_references')) {
    if (storedJudgment.selected_references === null) return null;
    const refs = storedJudgment.selected_references;
    if (!Array.isArray(refs)) {
      missingFields.push('judgment.selected_references');
      return null;
    }
    const cloned = refs.map((reference) => cloneReference(reference));
    if (cloned.some((reference) => reference === null)) {
      missingFields.push('judgment.selected_references');
      return null;
    }
    return cloned as readonly CompanyOsJudgmentHistoryReference[];
  }

  // These references are already present in the historical view as exact
  // versions.  They are projected with their structural usage; no candidate
  // search and no latest-version lookup happens here.
  const references = referencesFromHistoricalView(view);
  if (references.length === 0) {
    if (!historicalReferenceSectionsAreKnownEmpty(view)) {
      missingFields.push('judgment.selected_references');
      return null;
    }
    return [];
  }
  return references;
}

function referencesFromHistoricalView(
  view: JudgmentViewDocument,
): readonly CompanyOsJudgmentHistoryReference[] {
  const references: CompanyOsJudgmentHistoryReference[] = [];
  if (view.problem.status === 'resolved' && view.problem.value) {
    for (const reference of view.problem.value.references) {
      references.push({
        ref: reference.id,
        kind: reference.kind,
        version: reference.revision,
        digest: reference.digest,
        why: null,
        usage: 'problem_snapshot',
        availability: 'recorded',
      });
    }
  }
  if (view.objective.status === 'resolved' && view.objective.value) {
    const reference = view.objective.value.ref;
    references.push({
      ref: reference.id,
      kind: reference.type,
      version: reference.revision,
      digest: reference.digest,
      why: null,
      usage: 'objective',
      availability: 'recorded',
    });
  }
  if (view.evidence.status === 'resolved' && view.evidence.items) {
    for (const evidence of view.evidence.items) {
      references.push({
        ref: evidence.id,
        kind: evidence.kind,
        version: evidence.revision,
        digest: evidence.digest ?? null,
        why: null,
        usage: 'evidence',
        availability: 'recorded',
      });
    }
  }
  return dedupeReferences(references);
}

function historicalReferenceSectionsAreKnownEmpty(view: JudgmentViewDocument): boolean {
  const problemKnown = view.problem.status === 'resolved' && Boolean(view.problem.value);
  const objectiveKnown = view.objective.status === 'resolved' && Boolean(view.objective.value);
  const evidenceKnown = view.evidence.status === 'resolved' && view.evidence.items !== null && view.evidence.absence_confirmed;
  return problemKnown || objectiveKnown || evidenceKnown;
}

function projectAlternatives(
  storedJudgment: CompanyOsStoredJudgment | undefined,
  missingFields: string[],
): readonly CompanyOsJudgmentHistoryAlternative[] | null {
  if (!storedJudgment || !hasOwn(storedJudgment, 'alternatives')) {
    missingFields.push('judgment.alternatives');
    return null;
  }
  if (storedJudgment.alternatives === null) return null;
  if (!Array.isArray(storedJudgment.alternatives)) {
    missingFields.push('judgment.alternatives');
    return null;
  }
  const projected = storedJudgment.alternatives.map((alternative) => {
    if (!alternative || !isNonEmptyString(alternative.label)) return null;
    return {
      label: alternative.label,
      evaluation: readNullableText(alternative.evaluation),
      adopted: typeof alternative.adopted === 'boolean' ? alternative.adopted : null,
    };
  });
  if (projected.some((alternative) => alternative === null)) {
    missingFields.push('judgment.alternatives');
    return null;
  }
  return projected as readonly CompanyOsJudgmentHistoryAlternative[];
}

function cloneReference(reference: CompanyOsJudgmentHistoryReference): CompanyOsJudgmentHistoryReference | null {
  if (!isValidReference(reference)) return null;
  return {
    ref: reference.ref,
    kind: reference.kind,
    version: reference.version,
    digest: reference.digest,
    why: reference.why,
    usage: reference.usage,
    availability: reference.availability,
  };
}

function dedupeReferences(
  references: readonly CompanyOsJudgmentHistoryReference[],
): readonly CompanyOsJudgmentHistoryReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = [reference.ref, reference.kind, reference.version, reference.digest, reference.usage].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapRunStatus(status: unknown): CompanyOsJudgmentHistoryExecutionStatus {
  return isExecutionStatus(status) ? status : 'unknown';
}

function readExecutionStatus(value: unknown): CompanyOsJudgmentHistoryExecutionStatus | null {
  return isExecutionStatus(value) ? value : null;
}

function readOutcomeStatus(value: unknown): CompanyOsJudgmentHistoryOutcomeStatus | null {
  return isOutcomeStatus(value) ? value : null;
}

function isExecutionStatus(value: unknown): value is CompanyOsJudgmentHistoryExecutionStatus {
  return typeof value === 'string' && EXECUTION_STATUSES.includes(value as CompanyOsJudgmentHistoryExecutionStatus);
}

function isOutcomeStatus(value: unknown): value is CompanyOsJudgmentHistoryOutcomeStatus {
  return typeof value === 'string' && OUTCOME_STATUSES.includes(value as CompanyOsJudgmentHistoryOutcomeStatus);
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNullableText(value: unknown): string | null {
  return value === null ? null : readText(value);
}

function isValidReference(value: unknown): value is CompanyOsJudgmentHistoryReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reference = value as Partial<CompanyOsJudgmentHistoryReference>;
  return isNonEmptyString(reference.ref)
    && isNullableText(reference.kind)
    && isNullableText(reference.version)
    && isNullableText(reference.digest)
    && isNullableText(reference.why)
    && isNullableText(reference.usage)
    && (reference.availability === 'recorded'
      || reference.availability === 'permission_denied'
      || reference.availability === 'unavailable'
      || reference.availability === 'unknown');
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function sameAccess(
  owner: JudgmentViewAccessContext,
  access: JudgmentViewAccessContext,
): boolean {
  return owner.tenantId === access.tenantId
    && owner.principal === access.principal
    && owner.scopeId === access.scopeId;
}

function assertAccess(access: JudgmentViewAccessContext): void {
  if (!access || !isNonEmptyString(access.tenantId) || !isNonEmptyString(access.principal) || !isNonEmptyString(access.scopeId)) {
    throw new TypeError('Company OS judgment history requires trusted tenant, principal, and scope');
  }
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeSourceIdentity(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function unavailableList(
  filters: CompanyOsJudgmentHistoryList['filters'],
  reason: string,
  options: { readonly storage?: 'local' | 'server' | null } = {},
): CompanyOsJudgmentHistoryList {
  return {
    contract_version: COMPANY_OS_JUDGMENT_HISTORY_CONTRACT_VERSION,
    status: 'unavailable',
    records: [],
    coverage: {
      complete: false,
      storage: options.storage ?? null,
      reason,
      sources: [{ entrypoint: 'company_os', status: 'unavailable', reason }],
      total: null,
    },
    pagination: {
      next_cursor: null,
      previous_cursor: null,
      limit: null,
    },
    filters,
  };
}
