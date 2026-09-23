/**
 * Constraint resolution boundary for the company judgment foundation.
 *
 * The ontology package is the only owner of the four foundation definitions.
 * This module aliases its ConstraintDefinition and re-exports the shared
 * value contracts for resolver-specific APIs without defining another Graph
 * entity shape.
 */
import type {
  ConstraintDefinition,
  ConstraintException,
  DecisionRevision,
  FoundationAcl,
  FoundationAdoptionState,
  FoundationEpistemicState,
  FoundationProvenance,
  FoundationScope,
  FoundationStorage,
  FoundationUse,
} from './ontology-foundation.js';

export type ConstraintUse = FoundationUse;
export type ConstraintEpistemicState = FoundationEpistemicState;
export type ConstraintAdoptionState = FoundationAdoptionState;
export type ConstraintStorage = FoundationStorage;
export type ConstraintVisibility = FoundationAcl['visibility'];
export type ConstraintProvenanceKind = FoundationProvenance['sourceKind'];
export type ConstraintScope = FoundationScope;
export type ConstraintAcl = FoundationAcl;
export type ConstraintProvenance = FoundationProvenance;
export type ConstraintDecisionReference = DecisionRevision;
export type ConstraintExceptionReference = ConstraintException;
export type ConstraintProjection = ConstraintDefinition;

export interface ConstraintRef {
  readonly id: string;
  readonly revision: string;
}

/** A durable exception record kept by the canonical store adapter. */
export interface ConstraintExceptionRecord {
  readonly id: string;
  readonly constraintRef: ConstraintRef;
  readonly decisionRef: ConstraintDecisionReference;
  readonly approverId: string;
  readonly scope: ConstraintScope;
  readonly expiresAt: string;
  readonly rationale: string;
}

export interface ConstraintStoreQuery {
  readonly ownerId?: string;
  readonly id?: string;
  readonly revision?: string;
}

export interface ConstraintExceptionQuery {
  readonly constraintId?: string;
  readonly constraintRevision?: string;
}

export interface ConstraintStore<TConstraint extends ConstraintProjection = ConstraintProjection> {
  /**
   * Append one immutable revision.  `null` means that the id must not exist;
   * a string is an atomic compare-and-swap against the current revision.
   */
  append(input: {
    record: TConstraint;
    expectedPreviousRevision?: string | null;
  }, context?: ConstraintAuthorizationContext): Promise<TConstraint>;
  get(ref: { id: string; revision: string }, context?: ConstraintAuthorizationContext): Promise<TConstraint | null>;
  getLatest(id: string, context?: ConstraintAuthorizationContext): Promise<TConstraint | null>;
  list(query: ConstraintStoreQuery, context?: ConstraintAuthorizationContext): Promise<readonly TConstraint[]>;
  appendException(
    exception: ConstraintExceptionRecord,
    context?: ConstraintAuthorizationContext,
  ): Promise<ConstraintExceptionRecord>;
  listExceptions(
    query: ConstraintExceptionQuery,
    context?: ConstraintAuthorizationContext,
  ): Promise<readonly ConstraintExceptionRecord[]>;
}

export type ConstraintAction =
  | 'create'
  | 'update'
  | 'read'
  | 'resolve'
  | 'adopt'
  | 'exception';

export interface ConstraintAuthorizationContext {
  readonly actorId: string;
  readonly ownerId: string;
  readonly [key: string]: unknown;
}

export interface ConstraintAuthorizationRequest {
  readonly action: ConstraintAction;
  readonly context: ConstraintAuthorizationContext;
  readonly ownerId?: string;
  readonly constraint?: ConstraintProjection | null;
  readonly input?: unknown;
}

export interface ConstraintAuthorizationPort {
  authorize(request: ConstraintAuthorizationRequest): void | Promise<void>;
}

export interface DecisionRevisionReader {
  exists(
    reference: ConstraintDecisionReference,
    context: ConstraintAuthorizationContext,
  ): Promise<boolean>;
}

export type ConstraintEvaluationResult =
  | { readonly status: 'resolved'; readonly applies: boolean; readonly reason?: string }
  | { readonly status: 'unknown'; readonly reason: string }
  | {
      readonly status: 'conflict';
      readonly reason: string;
      readonly conflictingRefs?: readonly ConstraintRef[];
    };

export interface ConstraintResolutionQuery {
  readonly ownerId: string;
  readonly subjectId?: string;
  readonly targetId?: string;
  readonly asOf: string;
  readonly use?: ConstraintUse;
}

export interface ConstraintEvaluationInput<
  TConstraint extends ConstraintProjection = ConstraintProjection,
> {
  readonly constraint: TConstraint;
  readonly candidates: readonly TConstraint[];
  readonly query: ConstraintResolutionQuery;
  readonly activeExceptions: readonly ConstraintExceptionRecord[];
}

export interface ConstraintEvaluationProvider<
  TConstraint extends ConstraintProjection = ConstraintProjection,
> {
  evaluate(input: ConstraintEvaluationInput<TConstraint>):
    | Promise<ConstraintEvaluationResult>
    | ConstraintEvaluationResult;
}

export interface ConstraintResolutionIssue {
  readonly code:
    | 'scope_violation'
    | 'constraint_store_unavailable'
    | 'scope_unknown'
    | 'target_scope_unknown'
    | 'decision_reference_missing'
    | 'decision_reference_unresolved'
    | 'retired_constraint'
    | 'unauthorized_use'
    | 'exception_invalid'
    | 'exception_store_unavailable'
    | 'evaluation_unknown'
    | 'constraint_conflict'
    | 'evaluation_invalid'
    | 'evaluation_unavailable';
  readonly message: string;
  readonly constraintRef?: ConstraintRef;
  readonly conflictingRefs?: readonly ConstraintRef[];
}

export interface ConstraintResolution<TConstraint extends ConstraintProjection = ConstraintProjection> {
  readonly status: 'resolved' | 'unresolved';
  readonly constraints: readonly TConstraint[];
  readonly unresolvedReasons: readonly ConstraintResolutionIssue[];
  /** Resolution never grants permission to perform an external action. */
  readonly executionAuthority: 'not_granted';
}

export interface ConstraintRevisionSequence {
  next(currentRevision: string): string;
  compare(left: string, right: string): number;
}

export interface ConstraintServiceOptions<
  TConstraint extends ConstraintProjection = ConstraintProjection,
> {
  readonly store: ConstraintStore<TConstraint>;
  readonly authorization: ConstraintAuthorizationPort;
  readonly decisionReader: DecisionRevisionReader;
  readonly evaluator: ConstraintEvaluationProvider<TConstraint>;
  readonly revisionSequence?: ConstraintRevisionSequence;
}

export type ConstraintPatch<TConstraint extends ConstraintProjection = ConstraintProjection> =
  Partial<Omit<TConstraint, 'id' | 'type' | 'revision'>>;

export class ConstraintError extends Error {
  readonly code: ConstraintErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ConstraintErrorCode,
    message: string,
    status = 400,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ConstraintError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ConstraintErrorCode =
  | 'invalid_constraint'
  | 'invalid_scope'
  | 'invalid_revision'
  | 'revision_conflict'
  | 'constraint_not_found'
  | 'decision_reference_unresolved'
  | 'authorization_denied'
  | 'scope_violation'
  | 'exception_invalid'
  | 'exception_not_found'
  | 'constraint_store_unavailable'
  | 'constraint_store_corrupt'
  | 'unsupported_revision_sequence';

const constraintUses = new Set<ConstraintUse>([
  'draft',
  'judgment',
  'evaluation',
  'execution',
]);
const adoptionStates = new Set<ConstraintAdoptionState>([
  'draft',
  'proposed',
  'approved',
  'retired',
]);
const visibilityValues = new Set<ConstraintVisibility>([
  'private',
  'project',
  'organization',
  'public',
]);
const storageValues = new Set<ConstraintStorage>([
  'candidate',
  'ontology',
  'evidence',
  'execution',
]);
const provenanceKinds = new Set<ConstraintProvenanceKind>([
  'candidate',
  'document',
  'observation',
  'decision',
  'import',
]);

function fail(
  code: ConstraintErrorCode,
  message: string,
  status = 400,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new ConstraintError(code, message, status, details);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001F\u007F]/u.test(value)) {
    fail('invalid_constraint', `${field} must be a non-empty text value`, 400, { field });
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}

function parseTimestamp(value: unknown, field: string): number {
  const text = requiredText(value, field);
  const parsed = parseStrictRfc3339(text);
  if (parsed === undefined) {
    fail('invalid_scope', `${field} must be an RFC3339 timestamp`, 400, { field, value });
  }
  return parsed;
}

/**
 * Date.parse accepts calendar values such as 2026-02-30 and silently moves
 * them into March. Scope boundaries are part of the ontology contract, so a
 * resolver must reject the value instead of changing its meaning.
 */
function parseStrictRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  // Date.UTC treats years 0..99 as 1900..1999. The contract accepts a
  // four-digit year, so set those years back explicitly after conversion.
  const milliseconds = Number((fraction + '000').slice(0, 3));
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  if (year < 100) {
    const normalized = new Date(timestamp);
    normalized.setUTCFullYear(year);
    timestamp = normalized.getTime();
  }
  timestamp -= offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validateRevision(value: unknown, field = 'revision'): string {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001F\u007F]/u.test(value)) {
    fail('invalid_revision', `${field} must be a non-empty revision`, 400, { field });
  }
  return value;
}

function validateUniqueIds(value: unknown, field: string, options: { allowEmpty?: boolean } = {}): readonly string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    fail('invalid_scope', `${field} must be a non-empty array`, 400, { field });
  }
  const ids = value.map((item, index) => requiredText(item, `${field}[${index}]`));
  if (new Set(ids).size !== ids.length) {
    fail('invalid_scope', `${field} must not contain duplicate ids`, 400, { field });
  }
  return ids;
}

function validateScope(value: unknown, field = 'scope'): ConstraintScope {
  if (!isRecord(value)) fail('invalid_scope', `${field} must be an object`, 400, { field });
  const validFrom = requiredText(value.validFrom, `${field}.validFrom`);
  const validUntil = optionalText(value.validUntil, `${field}.validUntil`);
  const from = parseTimestamp(validFrom, `${field}.validFrom`);
  if (validUntil !== undefined && parseTimestamp(validUntil, `${field}.validUntil`) <= from) {
    fail('invalid_scope', `${field}.validUntil must be after validFrom`, 400, { field });
  }
  return {
    subjectIds: validateUniqueIds(value.subjectIds, `${field}.subjectIds`),
    validFrom,
    ...(validUntil === undefined ? {} : { validUntil }),
  };
}

function validateDecisionReference(value: unknown, field: string): ConstraintDecisionReference {
  if (!isRecord(value) || value.type !== 'decision') {
    fail('invalid_constraint', `${field} must reference a decision revision`, 400, { field });
  }
  return {
    id: requiredText(value.id, `${field}.id`),
    type: 'decision',
    revision: validateRevision(value.revision, `${field}.revision`),
  };
}

function validateConstraintRef(value: unknown, field: string): ConstraintRef {
  if (!isRecord(value)) fail('invalid_constraint', `${field} must be a constraint reference`, 400, { field });
  return {
    id: requiredText(value.id, `${field}.id`),
    revision: validateRevision(value.revision, `${field}.revision`),
  };
}

function validateAcl(value: unknown): ConstraintAcl {
  if (!isRecord(value)) fail('invalid_constraint', 'acl must be an object', 400, { field: 'acl' });
  const visibility = value.visibility;
  if (typeof visibility !== 'string' || !visibilityValues.has(visibility as ConstraintVisibility)) {
    fail('invalid_constraint', 'acl.visibility is unsupported', 400, { field: 'acl.visibility' });
  }
  return {
    ownerId: requiredText(value.ownerId, 'acl.ownerId'),
    visibility: visibility as ConstraintVisibility,
    readerIds: validateUniqueIds(value.readerIds, 'acl.readerIds', { allowEmpty: true }),
    writerIds: validateUniqueIds(value.writerIds, 'acl.writerIds', { allowEmpty: true }),
  };
}

function validateProvenance(value: unknown): readonly ConstraintProvenance[] {
  if (!Array.isArray(value)) {
    fail('invalid_constraint', 'provenance must be an array', 400, { field: 'provenance' });
  }
  return value.map((item, index) => {
    if (!isRecord(item)) fail('invalid_constraint', 'provenance entry must be an object', 400, { index });
    const sourceKind = item.sourceKind;
    if (typeof sourceKind !== 'string' || !provenanceKinds.has(sourceKind as ConstraintProvenanceKind)) {
      fail('invalid_constraint', 'provenance.sourceKind is unsupported', 400, { index });
    }
    return {
      sourceId: requiredText(item.sourceId, `provenance[${index}].sourceId`),
      sourceKind: sourceKind as ConstraintProvenanceKind,
      evidenceIds: validateUniqueIds(item.evidenceIds, `provenance[${index}].evidenceIds`, {
        allowEmpty: true,
      }),
    };
  });
}

function validateConstraint<TConstraint extends ConstraintProjection>(record: TConstraint): TConstraint {
  if (!isRecord(record)) fail('invalid_constraint', 'constraint must be an object');
  if (record.type !== 'constraint') fail('invalid_constraint', 'constraint.type must be constraint');
  requiredText(record.id, 'id');
  validateRevision(record.revision);
  requiredText(record.meaning, 'meaning');
  if (!adoptionStates.has(record.adoptionState)) {
    fail('invalid_constraint', 'adoptionState is unsupported', 400, { field: 'adoptionState' });
  }
  if (!Array.isArray(record.authorizedUses) || record.authorizedUses.length === 0) {
    fail('invalid_constraint', 'authorizedUses must be non-empty', 400, { field: 'authorizedUses' });
  }
  for (const use of record.authorizedUses) {
    if (!constraintUses.has(use)) {
      fail('invalid_constraint', 'authorizedUses contains an unsupported value', 400, { use });
    }
  }
  validateAcl(record.acl);
  if (!storageValues.has(record.storage)) {
    fail('invalid_constraint', 'storage is unsupported', 400, { field: 'storage' });
  }
  validateProvenance(record.provenance);
  validateScope(record.scope);
  requiredText(record.condition, 'condition');
  validateUniqueIds(record.appliesTo, 'appliesTo');
  if (!Array.isArray(record.exceptions)) {
    fail('invalid_constraint', 'exceptions must be an array', 400, { field: 'exceptions' });
  }
  record.exceptions.forEach((exception, index) => {
    if (!isRecord(exception)) fail('invalid_constraint', 'exception must be an object', 400, { index });
    validateDecisionReference(exception.decisionRef, `exceptions[${index}].decisionRef`);
    const exceptionScope = validateScope(exception.scope, `exceptions[${index}].scope`);
    if (!scopeIsWithin(exceptionScope, record.scope)) {
      fail(
        'invalid_scope',
        'constraint exception scope must be non-empty and remain within the parent constraint scope',
        400,
        { field: `exceptions[${index}].scope` },
      );
    }
  });
  if (!Array.isArray(record.adoptionBasis)) {
    fail('invalid_constraint', 'adoptionBasis must be an array', 400, { field: 'adoptionBasis' });
  }
  record.adoptionBasis.forEach((reference, index) => {
    validateDecisionReference(reference, `adoptionBasis[${index}]`);
  });
  if (record.adoptionState === 'approved' && record.adoptionBasis.length === 0) {
    fail('invalid_constraint', 'approved constraint requires adoptionBasis', 400, {
      field: 'adoptionBasis',
    });
  }
  return record;
}

function validateContext(context: ConstraintAuthorizationContext): void {
  requiredText(context.actorId, 'context.actorId');
  requiredText(context.ownerId, 'context.ownerId');
}

function validateQuery(query: ConstraintResolutionQuery): void {
  requiredText(query.ownerId, 'query.ownerId');
  parseTimestamp(query.asOf, 'query.asOf');
  if (query.subjectId !== undefined) requiredText(query.subjectId, 'query.subjectId');
  if (query.targetId !== undefined) requiredText(query.targetId, 'query.targetId');
  if (query.use !== undefined && !constraintUses.has(query.use)) {
    fail('invalid_constraint', 'query.use is unsupported', 400, { field: 'query.use' });
  }
}

function scopeContains(scope: ConstraintScope, query: ConstraintResolutionQuery): boolean {
  const asOf = parseTimestamp(query.asOf, 'query.asOf');
  const from = parseTimestamp(scope.validFrom, 'scope.validFrom');
  const until = scope.validUntil === undefined ? Number.POSITIVE_INFINITY : parseTimestamp(scope.validUntil, 'scope.validUntil');
  if (asOf < from || asOf >= until) return false;
  if (scope.subjectIds.length === 0) return false;
  if (query.subjectId === undefined) return false;
  return scope.subjectIds.includes(query.subjectId);
}

function exceptionScopeContains(scope: ConstraintScope, query: ConstraintResolutionQuery): boolean {
  return scopeContains(scope, query);
}

function isExceptionActive(exception: ConstraintExceptionRecord, query: ConstraintResolutionQuery): boolean {
  const expiresAt = parseTimestamp(exception.expiresAt, 'exception.expiresAt');
  return expiresAt > parseTimestamp(query.asOf, 'query.asOf') && exceptionScopeContains(exception.scope, query);
}

function refFor<TConstraint extends ConstraintProjection>(constraint: TConstraint): ConstraintRef {
  return { id: constraint.id, revision: constraint.revision };
}

function sameDecision(left: ConstraintDecisionReference, right: ConstraintDecisionReference): boolean {
  return left.id === right.id && left.revision === right.revision;
}

function includesDecision(
  references: readonly ConstraintDecisionReference[],
  target: ConstraintDecisionReference,
): boolean {
  return references.some((reference) => sameDecision(reference, target));
}

function defaultCompareRevisions(left: string, right: string): number {
  const parse = (value: string): number | null => {
    const match = /^(?:r)?([1-9][0-9]*)$/u.exec(value);
    return match ? Number(match[1]) : null;
  };
  const leftNumber = parse(left);
  const rightNumber = parse(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return left < right ? -1 : left > right ? 1 : 0;
}

export const numericConstraintRevisionSequence: ConstraintRevisionSequence = {
  next(currentRevision) {
    const match = /^(r?)([1-9][0-9]*)$/u.exec(currentRevision);
    if (!match) {
      fail('unsupported_revision_sequence', 'revision sequence requires rN or N revisions', 400, {
        currentRevision,
      });
    }
    return `${match[1]}${Number(match[2]) + 1}`;
  },
  compare: defaultCompareRevisions,
};

export interface InMemoryConstraintStoreOptions {
  readonly compareRevisions?: (left: string, right: string) => number;
}

/** In-memory adapter used by contract tests; production uses the injected canonical store. */
export class InMemoryConstraintStore<
  TConstraint extends ConstraintProjection = ConstraintProjection,
> implements ConstraintStore<TConstraint> {
  private readonly records = new Map<string, Map<string, TConstraint>>();
  private readonly exceptions = new Map<string, ConstraintExceptionRecord>();
  private readonly compareRevisions: (left: string, right: string) => number;

  constructor(options: InMemoryConstraintStoreOptions = {}) {
    this.compareRevisions = options.compareRevisions ?? defaultCompareRevisions;
  }

  async append(input: {
    record: TConstraint;
    expectedPreviousRevision?: string | null;
  }): Promise<TConstraint> {
    validateConstraint(input.record);
    const current = await this.getLatest(input.record.id);
    const expected = input.expectedPreviousRevision;
    if (current === null) {
      if (expected !== null) {
        fail('revision_conflict', 'new constraint requires expectedPreviousRevision=null', 409, {
          id: input.record.id,
          expectedPreviousRevision: expected,
        });
      }
    } else if (expected === undefined || expected !== current.revision) {
      fail('revision_conflict', 'constraint revision compare-and-swap failed', 409, {
        id: input.record.id,
        expectedPreviousRevision: expected,
        currentRevision: current.revision,
      });
    }
    const revisions = this.records.get(input.record.id) ?? new Map<string, TConstraint>();
    if (revisions.has(input.record.revision)) {
      fail('revision_conflict', 'constraint revision already exists', 409, {
        id: input.record.id,
        revision: input.record.revision,
      });
    }
    revisions.set(input.record.revision, clone(input.record));
    this.records.set(input.record.id, revisions);
    return clone(input.record);
  }

  async get(ref: { id: string; revision: string }): Promise<TConstraint | null> {
    const record = this.records.get(ref.id)?.get(ref.revision);
    return record ? clone(record) : null;
  }

  async getLatest(id: string): Promise<TConstraint | null> {
    const revisions = this.records.get(id);
    if (!revisions || revisions.size === 0) return null;
    let latest: TConstraint | undefined;
    for (const record of revisions.values()) {
      if (!latest || this.compareRevisions(record.revision, latest.revision) > 0) latest = record;
    }
    return latest ? clone(latest) : null;
  }

  async list(query: ConstraintStoreQuery): Promise<readonly TConstraint[]> {
    const records: TConstraint[] = [];
    const ids = query.id === undefined ? [...this.records.keys()] : [query.id];
    for (const id of ids) {
      const revisions = this.records.get(id);
      if (!revisions) continue;
      if (query.revision !== undefined) {
        const record = revisions.get(query.revision);
        if (record) records.push(record);
        continue;
      }
      let latest: TConstraint | undefined;
      for (const record of revisions.values()) {
        if (!latest || this.compareRevisions(record.revision, latest.revision) > 0) latest = record;
      }
      if (latest) records.push(latest);
    }
    return records
      .filter((record) => query.ownerId === undefined || record.acl.ownerId === query.ownerId)
      .map((record) => clone(record));
  }

  async appendException(exception: ConstraintExceptionRecord): Promise<ConstraintExceptionRecord> {
    validateExceptionRecord(exception);
    if (this.exceptions.has(exception.id)) {
      fail('revision_conflict', 'exception id already exists', 409, { id: exception.id });
    }
    this.exceptions.set(exception.id, clone(exception));
    return clone(exception);
  }

  async listExceptions(query: ConstraintExceptionQuery): Promise<readonly ConstraintExceptionRecord[]> {
    return [...this.exceptions.values()]
      .filter((exception) => query.constraintId === undefined || exception.constraintRef.id === query.constraintId)
      .filter(
        (exception) =>
          query.constraintRevision === undefined || exception.constraintRef.revision === query.constraintRevision,
      )
      .map((exception) => clone(exception));
  }
}

function validateExceptionRecord(exception: ConstraintExceptionRecord): void {
  if (!isRecord(exception)) fail('exception_invalid', 'exception must be an object');
  requiredText(exception.id, 'exception.id');
  validateConstraintRef(exception.constraintRef, 'exception.constraintRef');
  validateDecisionReference(exception.decisionRef, 'exception.decisionRef');
  requiredText(exception.approverId, 'exception.approverId');
  validateScope(exception.scope, 'exception.scope');
  parseTimestamp(exception.expiresAt, 'exception.expiresAt');
  requiredText(exception.rationale, 'exception.rationale');
}

/** Validate a durable exception before a persistence adapter writes it. */
export function validateConstraintExceptionRecord(exception: ConstraintExceptionRecord): void {
  validateExceptionRecord(exception);
}

function scopeIsWithin(inner: ConstraintScope, outer: ConstraintScope): boolean {
  if (inner.subjectIds.length === 0 || outer.subjectIds.length === 0) return false;
  if (!inner.subjectIds.every((subjectId) => outer.subjectIds.includes(subjectId))) return false;
  const innerFrom = parseTimestamp(inner.validFrom, 'exception.scope.validFrom');
  const outerFrom = parseTimestamp(outer.validFrom, 'scope.validFrom');
  if (innerFrom < outerFrom) return false;
  if (outer.validUntil !== undefined) {
    const outerUntil = parseTimestamp(outer.validUntil, 'scope.validUntil');
    const innerUntil = inner.validUntil === undefined
      ? Number.POSITIVE_INFINITY
      : parseTimestamp(inner.validUntil, 'exception.scope.validUntil');
    if (innerUntil > outerUntil) return false;
  }
  return true;
}

export function createSingleOwnerConstraintAuthorization(): ConstraintAuthorizationPort {
  return {
    authorize(request) {
      validateContext(request.context);
      if (request.context.actorId !== request.context.ownerId) {
        fail('authorization_denied', 'single-owner authorization requires actorId to equal ownerId', 403);
      }
      if (request.action === 'exception' && isRecord(request.input)) {
        if (request.input.approverId !== request.context.actorId) {
          fail('authorization_denied', 'single-owner authorization requires approverId to equal actorId', 403);
        }
      }
      const targetOwner = request.ownerId ?? request.constraint?.acl.ownerId;
      if (targetOwner !== undefined && targetOwner !== request.context.ownerId) {
        fail('scope_violation', 'constraint owner is outside the authorization context', 403, {
          ownerId: targetOwner,
          contextOwnerId: request.context.ownerId,
        });
      }
    },
  };
}

export class ConstraintService<
  TConstraint extends ConstraintProjection = ConstraintProjection,
> {
  private readonly revisionSequence: ConstraintRevisionSequence;

  constructor(private readonly options: ConstraintServiceOptions<TConstraint>) {
    this.revisionSequence = options.revisionSequence ?? numericConstraintRevisionSequence;
  }

  async createConstraint(record: TConstraint, context: ConstraintAuthorizationContext): Promise<TConstraint> {
    validateContext(context);
    validateConstraint(record);
    if (record.acl.ownerId !== context.ownerId) {
      fail('scope_violation', 'constraint owner is outside the authorization context', 403);
    }
    await this.authorize({
      action: 'create',
      context,
      ownerId: record.acl.ownerId,
      input: record,
    });
    return this.appendAndReadback(record, null, context);
  }

  async getConstraint(
    ref: ConstraintRef,
    context: ConstraintAuthorizationContext,
  ): Promise<TConstraint | null> {
    validateContext(context);
    validateConstraintRef(ref, 'constraintRef');
    const record = await this.options.store.get(ref, context);
    await this.authorize({ action: 'read', context, ownerId: record?.acl.ownerId ?? context.ownerId, constraint: record });
    if (!record) return null;
    if (record.acl.ownerId !== context.ownerId) {
      fail('scope_violation', 'constraint owner is outside the authorization context', 403);
    }
    return record;
  }

  async updateConstraint(
    id: string,
    expectedRevision: string,
    patch: ConstraintPatch<TConstraint>,
    context: ConstraintAuthorizationContext,
  ): Promise<TConstraint> {
    validateContext(context);
    requiredText(id, 'id');
    validateRevision(expectedRevision, 'expectedRevision');
    const current = await this.requireLatest(id, context);
    this.assertOwner(current, context);
    await this.authorize({ action: 'update', context, ownerId: current.acl.ownerId, constraint: current, input: patch });
    if (current.revision !== expectedRevision) {
      fail('revision_conflict', 'expected constraint revision is stale', 409, {
        id,
        expectedRevision,
        currentRevision: current.revision,
      });
    }
    if (!isRecord(patch)) fail('invalid_constraint', 'constraint patch must be an object');
    const nextRevision = this.revisionSequence.next(current.revision);
    const next = {
      ...current,
      ...patch,
      id: current.id,
      type: 'constraint' as const,
      revision: nextRevision,
    } as TConstraint;
    if (next.acl.ownerId !== current.acl.ownerId) {
      fail('scope_violation', 'constraint owner cannot change across revisions', 403);
    }
    validateConstraint(next);
    return this.appendAndReadback(next, expectedRevision, context);
  }

  async adoptConstraint(
    id: string,
    expectedRevision: string,
    decisionRef: ConstraintDecisionReference,
    context: ConstraintAuthorizationContext,
  ): Promise<TConstraint> {
    validateContext(context);
    requiredText(id, 'id');
    validateRevision(expectedRevision, 'expectedRevision');
    const validatedDecision = validateDecisionReference(decisionRef, 'decisionRef');
    const current = await this.requireLatest(id, context);
    this.assertOwner(current, context);
    await this.authorize({
      action: 'adopt',
      context,
      ownerId: current.acl.ownerId,
      constraint: current,
      input: validatedDecision,
    });
    if (current.revision !== expectedRevision) {
      fail('revision_conflict', 'expected constraint revision is stale', 409, {
        id,
        expectedRevision,
        currentRevision: current.revision,
      });
    }
    let decisionExists = false;
    try {
      decisionExists = await this.options.decisionReader.exists(validatedDecision, context);
    } catch {
      decisionExists = false;
    }
    if (!decisionExists) {
      fail('decision_reference_unresolved', 'adoption decision revision could not be resolved', 409, {
        decisionRef: validatedDecision,
      });
    }
    const next = {
      ...current,
      revision: this.revisionSequence.next(current.revision),
      adoptionState: 'approved' as const,
      adoptionBasis: includesDecision(current.adoptionBasis, validatedDecision)
        ? current.adoptionBasis
        : [...current.adoptionBasis, validatedDecision],
    } as TConstraint;
    validateConstraint(next);
    return this.appendAndReadback(next, expectedRevision, context);
  }

  async registerException(
    exception: ConstraintExceptionRecord,
    context: ConstraintAuthorizationContext,
  ): Promise<ConstraintExceptionRecord> {
    validateContext(context);
    validateExceptionRecord(exception);
    const target = await this.options.store.get(exception.constraintRef, context);
    if (!target) fail('constraint_not_found', 'constraint revision for exception was not found', 404, {
      constraintRef: exception.constraintRef,
    });
    this.assertOwner(target, context);
    if (!scopeIsWithin(exception.scope, target.scope)) {
      fail('exception_invalid', 'exception scope must be contained by constraint scope', 400, {
        constraintRef: exception.constraintRef,
      });
    }
    if (parseTimestamp(exception.expiresAt, 'exception.expiresAt') <= parseTimestamp(exception.scope.validFrom, 'exception.scope.validFrom')) {
      fail('exception_invalid', 'exception expiresAt must be after scope.validFrom', 400);
    }
    await this.authorize({
      action: 'exception',
      context,
      ownerId: target.acl.ownerId,
      constraint: target,
      input: exception,
    });
    let decisionExists = false;
    try {
      decisionExists = await this.options.decisionReader.exists(exception.decisionRef, context);
    } catch {
      decisionExists = false;
    }
    if (!decisionExists) {
      fail('decision_reference_unresolved', 'exception decision revision could not be resolved', 409, {
        decisionRef: exception.decisionRef,
      });
    }
    try {
      const stored = await this.options.store.appendException(clone(exception), context);
      if (stored.id !== exception.id || stored.constraintRef.id !== exception.constraintRef.id || stored.constraintRef.revision !== exception.constraintRef.revision) {
        fail('constraint_store_corrupt', 'exception store readback identity did not match', 500, {
          id: exception.id,
        });
      }
      return stored;
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      fail('constraint_store_unavailable', 'exception store failed', 503);
    }
  }

  async resolveConstraints(
    query: ConstraintResolutionQuery,
    context: ConstraintAuthorizationContext,
  ): Promise<ConstraintResolution<TConstraint>> {
    validateContext(context);
    validateQuery(query);
    const unresolvedReasons: ConstraintResolutionIssue[] = [];
    const executionAuthority = 'not_granted' as const;
    try {
      await this.authorize({ action: 'resolve', context, ownerId: query.ownerId, input: query });
    } catch (error) {
      const issue = this.authorizationIssue(error);
      return { status: 'unresolved', constraints: [], unresolvedReasons: [issue], executionAuthority };
    }
    if (query.ownerId !== context.ownerId) {
      return {
        status: 'unresolved',
        constraints: [],
        unresolvedReasons: [{ code: 'scope_violation', message: 'query owner is outside the authorization context' }],
        executionAuthority,
      };
    }
    let candidates: readonly TConstraint[];
    try {
      candidates = await this.options.store.list({ ownerId: query.ownerId }, context);
    } catch {
      return {
        status: 'unresolved',
        constraints: [],
        unresolvedReasons: [{ code: 'constraint_store_unavailable', message: 'constraint store could not be read' }],
        executionAuthority,
      };
    }
    const applicable: TConstraint[] = [];
    for (const candidate of candidates) {
      const ref = refFor(candidate);
      if (candidate.acl.ownerId !== query.ownerId) {
        unresolvedReasons.push({
          code: 'scope_violation',
          message: 'constraint returned outside query owner scope',
          constraintRef: ref,
        });
        continue;
      }
      if (candidate.scope.subjectIds.length === 0 || query.subjectId === undefined) {
        unresolvedReasons.push({
          code: 'scope_unknown',
          message: 'constraint subject scope cannot be established for this query',
          constraintRef: ref,
        });
        continue;
      }
      if (!scopeContains(candidate.scope, query)) continue;
      if (query.targetId === undefined) {
        unresolvedReasons.push({
          code: 'target_scope_unknown',
          message: 'constraint target scope cannot be established without targetId',
          constraintRef: ref,
        });
        continue;
      }
      if (!candidate.appliesTo.includes(query.targetId)) continue;
      if (candidate.adoptionState === 'retired') {
        unresolvedReasons.push({ code: 'retired_constraint', message: 'retired constraint cannot be applied', constraintRef: ref });
        continue;
      }
      const requestedUse = query.use ?? 'judgment';
      if (!candidate.authorizedUses.includes(requestedUse)) {
        unresolvedReasons.push({
          code: 'unauthorized_use',
          message: `constraint is not authorized for ${requestedUse} use`,
          constraintRef: ref,
        });
        continue;
      }
      if (candidate.adoptionState !== 'approved' || candidate.adoptionBasis.length === 0) {
        unresolvedReasons.push({
          code: 'decision_reference_missing',
          message: 'constraint has no approved decision basis',
          constraintRef: ref,
        });
        continue;
      }
      let decisionUnresolved = false;
      for (const decisionRef of candidate.adoptionBasis) {
        let decisionExists = false;
        try {
          decisionExists = await this.options.decisionReader.exists(decisionRef, context);
        } catch {
          decisionExists = false;
        }
        if (!decisionExists) {
          unresolvedReasons.push({
            code: 'decision_reference_unresolved',
            message: 'constraint adoption decision revision could not be resolved',
            constraintRef: ref,
          });
          decisionUnresolved = true;
        }
      }
      if (decisionUnresolved) continue;
      let activeExceptions: readonly ConstraintExceptionRecord[];
      try {
        activeExceptions = (await this.options.store.listExceptions({
          constraintId: candidate.id,
          constraintRevision: candidate.revision,
        }, context)).filter((exception) => {
          try {
            validateExceptionRecord(exception);
            return isExceptionActive(exception, query);
          } catch {
            unresolvedReasons.push({
              code: 'exception_invalid',
              message: 'exception timestamp or scope could not be evaluated',
              constraintRef: ref,
            });
            return false;
          }
        });
      } catch {
        unresolvedReasons.push({
          code: 'exception_store_unavailable',
          message: 'exception store could not be read',
          constraintRef: ref,
        });
        continue;
      }
      let exceptionDecisionUnresolved = false;
      for (const exception of activeExceptions) {
        let decisionExists = false;
        try {
          decisionExists = await this.options.decisionReader.exists(exception.decisionRef, context);
        } catch {
          decisionExists = false;
        }
        if (!decisionExists) {
          unresolvedReasons.push({
            code: 'decision_reference_unresolved',
            message: 'exception decision revision could not be resolved',
            constraintRef: ref,
          });
          exceptionDecisionUnresolved = true;
        }
      }
      if (exceptionDecisionUnresolved) continue;
      let exceptionAuthorizationUnresolved = false;
      for (const exception of activeExceptions) {
        try {
          await this.authorize({
            action: 'exception',
            context,
            ownerId: candidate.acl.ownerId,
            constraint: candidate,
            input: exception,
          });
        } catch {
          unresolvedReasons.push({
            code: 'exception_invalid',
            message: 'exception approval could not be authorized for this resolution',
            constraintRef: ref,
          });
          exceptionAuthorizationUnresolved = true;
        }
      }
      if (exceptionAuthorizationUnresolved) continue;
      applicable.push(candidate);
      try {
        const evaluation = await this.options.evaluator.evaluate({
          constraint: candidate,
          candidates,
          query,
          activeExceptions,
        });
        if (!isEvaluationResult(evaluation)) {
          unresolvedReasons.push({
            code: 'evaluation_invalid',
            message: 'constraint evaluator returned an invalid result',
            constraintRef: ref,
          });
          continue;
        }
        if (evaluation.status === 'unknown') {
          unresolvedReasons.push({
            code: 'evaluation_unknown',
            message: evaluation.reason,
            constraintRef: ref,
          });
        } else if (evaluation.status === 'conflict') {
          unresolvedReasons.push({
            code: 'constraint_conflict',
            message: evaluation.reason,
            constraintRef: ref,
            conflictingRefs: evaluation.conflictingRefs,
          });
        } else if (!evaluation.applies) {
          applicable.pop();
        }
      } catch {
        unresolvedReasons.push({
          code: 'evaluation_unavailable',
          message: 'constraint evaluator failed closed',
          constraintRef: ref,
        });
      }
    }
    return {
      status: unresolvedReasons.length === 0 ? 'resolved' : 'unresolved',
      constraints: unresolvedReasons.length === 0 ? applicable : [],
      unresolvedReasons,
      executionAuthority,
    };
  }

  private async requireLatest(id: string, context: ConstraintAuthorizationContext): Promise<TConstraint> {
    let current: TConstraint | null;
    try {
      current = await this.options.store.getLatest(id, context);
    } catch {
      fail('constraint_store_unavailable', 'constraint store could not be read', 503, { id });
    }
    if (!current) fail('constraint_not_found', 'constraint was not found', 404, { id });
    return current;
  }

  private assertOwner(record: TConstraint, context: ConstraintAuthorizationContext): void {
    if (record.acl.ownerId !== context.ownerId) {
      fail('scope_violation', 'constraint owner is outside the authorization context', 403);
    }
  }

  private async authorize(request: ConstraintAuthorizationRequest): Promise<void> {
    try {
      await this.options.authorization.authorize(request);
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      fail('authorization_denied', 'constraint authorization was denied', 403);
    }
  }

  private authorizationIssue(error: unknown): ConstraintResolutionIssue {
    if (error instanceof ConstraintError && error.code === 'scope_violation') {
      return { code: 'scope_violation', message: error.message };
    }
    return { code: 'scope_violation', message: 'constraint authorization could not be established' };
  }

  private async appendAndReadback(
    record: TConstraint,
    expectedPreviousRevision: string | null,
    context: ConstraintAuthorizationContext,
  ): Promise<TConstraint> {
    let stored: TConstraint;
    try {
      stored = await this.options.store.append({ record: clone(record), expectedPreviousRevision }, context);
    } catch (error) {
      if (error instanceof ConstraintError) throw error;
      fail('constraint_store_unavailable', 'constraint store append failed', 503, { id: record.id });
    }
    const readback = await this.options.store.get({ id: record.id, revision: record.revision }, context);
    if (!readback || JSON.stringify(readback) !== JSON.stringify(stored) || JSON.stringify(readback) !== JSON.stringify(record)) {
      fail('constraint_store_corrupt', 'constraint store readback did not match append result', 500, {
        id: record.id,
        revision: record.revision,
      });
    }
    return readback;
  }
}

function isEvaluationResult(value: unknown): value is ConstraintEvaluationResult {
  if (!isRecord(value) || typeof value.status !== 'string') return false;
  if (value.status === 'resolved') return typeof value.applies === 'boolean';
  if (value.status === 'unknown' || value.status === 'conflict') return typeof value.reason === 'string' && value.reason.length > 0;
  return false;
}
