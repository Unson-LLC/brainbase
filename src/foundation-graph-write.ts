import {
  cloneFoundationDefinition,
  nextFoundationRevision
} from './foundation-catalog.js';
import type {
  FoundationAcl,
  FoundationDefinition,
  FoundationScope,
  FoundationType,
  FoundationValidationIssue
} from './ontology-foundation.js';
import { validateFoundationDefinition } from './ontology-foundation.js';

/**
 * Contract for preparing a Foundation draft for the canonical Graph writer.
 *
 * This module deliberately stops at a pure, fail-closed validation boundary.
 * It does not issue Graph queries, mutate a catalog, or infer a tenant from
 * any value in the payload. The host must provide the already-authenticated
 * principal, selected project, and current revision.
 */
export const FOUNDATION_GRAPH_WRITE_CONTRACT_VERSION = 'foundation-graph-draft-write.v1' as const;

const FOUNDATION_TYPES: readonly FoundationType[] = ['objective', 'variable', 'model', 'constraint'];
const REVISION_PATTERN = /^[1-9]\d*$/u;
const FOUNDATION_USES_DRAFT = ['draft'] as const;

export type FoundationGraphWriteOperation = 'create' | 'update';

export type FoundationGraphWriteIssueCode =
  | 'INVALID_INPUT'
  | 'INVALID_IDENTITY'
  | 'ROW_DEFINITION_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'CURRENT_DEFINITION_REQUIRED'
  | 'DEFINITION_INVALID'
  | 'DRAFT_ADOPTION_REQUIRED'
  | 'CANDIDATE_STORAGE_REQUIRED'
  | 'DRAFT_AUTHORIZATION_REQUIRED'
  | 'PROVENANCE_REQUIRED'
  | 'OWNER_MISMATCH'
  | 'ACL_CHANGE_FORBIDDEN'
  | 'WRITER_NOT_AUTHORIZED'
  | 'SCOPE_VIOLATION'
  | 'PROJECT_MISMATCH';

export interface FoundationGraphWriteIssue {
  readonly code: FoundationGraphWriteIssueCode;
  readonly path: string;
  readonly message: string;
}

/** Trusted context resolved before this pure contract is called. */
export interface FoundationGraphWriteContext {
  /** Host auth boundary value; callers should pass `access.personId`. */
  readonly principal: string;
  /** Selected canonical project code, never taken from the candidate payload. */
  readonly projectCode: string;
  /** Optional trusted subject/time scope for the selected project. */
  readonly scope?: FoundationScope;
}

/**
 * The host's Graph row shape. `type` is the canonical API name; `entityType`
 * is accepted as a compatibility alias for adapters that mirror SQL rows.
 */
export interface FoundationGraphWriteRow {
  readonly id: string;
  readonly type?: string;
  readonly entityType?: string;
  readonly revision: string;
  readonly projectCode: string;
  readonly payload: {
    readonly foundation: unknown;
  };
}

export interface FoundationGraphWriteInput {
  readonly context: FoundationGraphWriteContext;
  readonly row: FoundationGraphWriteRow;
  readonly expectedNextRevision: string;
  readonly currentDefinition?: unknown;
}

export interface FoundationGraphWriteResult {
  readonly contractVersion: typeof FOUNDATION_GRAPH_WRITE_CONTRACT_VERSION;
  readonly operation: FoundationGraphWriteOperation;
  readonly projectCode: string;
  readonly row: {
    readonly id: string;
    readonly type: FoundationType;
    readonly revision: string;
    readonly projectCode: string;
    readonly payload: {
      readonly foundation: FoundationDefinition;
    };
  };
  readonly definition: FoundationDefinition;
}

export interface FoundationGraphWriteValidationResult {
  readonly valid: boolean;
  readonly status: 'valid' | 'invalid';
  readonly operation?: FoundationGraphWriteOperation;
  readonly issues: readonly FoundationGraphWriteIssue[];
  readonly normalized?: FoundationGraphWriteResult;
}

/**
 * Error thrown by the throwing normalizer. The non-throwing validator should
 * be used at HTTP/MCP boundaries when callers need to render all issues.
 */
export class FoundationGraphWriteError extends Error {
  readonly code: FoundationGraphWriteIssueCode;
  readonly issues: readonly FoundationGraphWriteIssue[];

  constructor(issues: readonly FoundationGraphWriteIssue[]) {
    const first = issues[0] ?? {
      code: 'INVALID_INPUT' as const,
      path: 'input',
      message: 'Foundation Graph write input is invalid.'
    };
    super(first.message);
    this.name = 'FoundationGraphWriteError';
    this.code = first.code;
    this.issues = issues;
  }
}

/**
 * Validate and normalize an untrusted Graph upsert candidate.
 *
 * A successful result is safe to hand to a canonical Graph writer only after
 * that writer also enforces its transaction/RLS boundary. This function proves
 * the payload contract, identity, current ACL authorization, scope, and
 * revision identity without performing any I/O.
 */
export function validateFoundationGraphWrite(
  input: unknown
): FoundationGraphWriteValidationResult {
  const issues: FoundationGraphWriteIssue[] = [];
  if (!isRecord(input)) {
    return invalid(issues, {
      code: 'INVALID_INPUT',
      path: 'input',
      message: 'Foundation Graph write input must be an object.'
    });
  }

  const context = input.context;
  const row = input.row;
  if (!isRecord(context)) {
    issues.push({ code: 'INVALID_INPUT', path: 'context', message: 'A trusted write context is required.' });
  }
  if (!isRecord(row)) {
    issues.push({ code: 'INVALID_INPUT', path: 'row', message: 'A Graph row is required.' });
  }
  if (issues.length > 0) return invalid(issues);

  const trustedContext = context as unknown as FoundationGraphWriteContext;
  const graphRow = row as unknown as FoundationGraphWriteRow;
  validateContext(trustedContext, issues);
  validateGraphRow(graphRow, issues);
  if (isNonEmptyString(graphRow.projectCode)
    && isNonEmptyString(trustedContext.projectCode)
    && graphRow.projectCode !== trustedContext.projectCode) {
    issues.push({
      code: 'PROJECT_MISMATCH',
      path: 'row.projectCode',
      message: 'Graph row projectCode must match the trusted selected project.'
    });
  }
  const expectedNextRevision = input.expectedNextRevision;
  if (!isCanonicalRevision(expectedNextRevision)) {
    issues.push({
      code: 'INVALID_IDENTITY',
      path: 'expectedNextRevision',
      message: 'expectedNextRevision must be a positive canonical decimal revision.'
    });
  }
  if (issues.length > 0) return invalid(issues);

  const rowType = resolveRowType(graphRow);
  const rowId = graphRow.id;
  const rowRevision = graphRow.revision;
  const candidate = unwrapFoundation(graphRow.payload.foundation);
  const definitionResult = validateFoundationDefinition(candidate, { use: 'draft' });
  appendDefinitionIssues(issues, 'row.payload.foundation', definitionResult.issues);
  if (!definitionResult.valid) return invalid(issues);

  if (!isFoundationDefinitionRecord(candidate)) {
    issues.push({
      code: 'DEFINITION_INVALID',
      path: 'row.payload.foundation',
      message: 'payload.foundation must be an object containing a registered Foundation definition.'
    });
  }

  if (rowType !== undefined && isFoundationDefinitionRecord(candidate)) {
    if (candidate.type !== rowType) {
      issues.push({
        code: 'ROW_DEFINITION_MISMATCH',
        path: 'row.type',
        message: `Graph row type ${rowType} does not match payload.foundation.type ${String(candidate.type)}.`
      });
    }
  }
  if (isFoundationDefinitionRecord(candidate)) {
    if (candidate.id !== rowId) {
      issues.push({
        code: 'ROW_DEFINITION_MISMATCH',
        path: 'row.id',
        message: `Graph row id ${rowId} does not match payload.foundation.id ${String(candidate.id)}.`
      });
    }
    if (candidate.revision !== rowRevision) {
      issues.push({
        code: 'ROW_DEFINITION_MISMATCH',
        path: 'row.revision',
        message: `Graph row revision ${rowRevision} does not match payload.foundation.revision ${String(candidate.revision)}.`
      });
    }
    if (expectedNextRevision !== rowRevision) {
      issues.push({
        code: 'REVISION_CONFLICT',
        path: 'expectedNextRevision',
        message: `expectedNextRevision ${expectedNextRevision} must equal row.revision ${rowRevision}.`
      });
    }
    validateDraftWriteInvariants(candidate, issues);
    validateCandidateScope(candidate, trustedContext, issues);
  }

  const hasCurrentDefinition = input.currentDefinition !== undefined;
  const operation: FoundationGraphWriteOperation = hasCurrentDefinition ? 'update' : 'create';
  if (hasCurrentDefinition) {
    const current = unwrapFoundation(input.currentDefinition);
    validateCurrentDefinition(current, candidate, rowId, rowType, trustedContext, issues);
    if (isFoundationDefinitionRecord(current) && isCanonicalRevision(current.revision) && isCanonicalRevision(rowRevision)) {
      let expectedRevision: string;
      try {
        expectedRevision = nextFoundationRevision(current.revision);
      } catch {
        expectedRevision = '';
      }
      if (expectedRevision !== rowRevision || expectedNextRevision !== expectedRevision) {
        issues.push({
          code: 'REVISION_CONFLICT',
          path: 'row.revision',
          message: `An update must append revision ${expectedRevision}; received row ${rowRevision} and expectedNextRevision ${expectedNextRevision}.`
        });
      }
    }
  } else {
    if (rowRevision !== '1' || expectedNextRevision !== '1') {
      issues.push({
        code: 'REVISION_CONFLICT',
        path: 'row.revision',
        message: 'A new Foundation Graph row must start at revision 1.'
      });
    }
    if (isFoundationDefinitionRecord(candidate) && candidate.acl.ownerId !== trustedContext.principal) {
      issues.push({
        code: 'OWNER_MISMATCH',
        path: 'row.payload.foundation.acl.ownerId',
        message: 'A new draft must be owned by the trusted principal.'
      });
    }
  }

  if (issues.length > 0 || !isFoundationDefinitionRecord(candidate) || !rowType) {
    return invalid(issues, undefined, operation);
  }

  const normalizedDefinition = cloneFoundationDefinition(candidate as FoundationDefinition);
  // These assignments are intentionally explicit even after validation. They
  // make the invariant visible in the object handed to the Host writer.
  normalizedDefinition.adoptionState = 'draft';
  normalizedDefinition.storage = 'candidate';
  normalizedDefinition.authorizedUses = [...FOUNDATION_USES_DRAFT];

  const normalized: FoundationGraphWriteResult = {
    contractVersion: FOUNDATION_GRAPH_WRITE_CONTRACT_VERSION,
    operation,
    projectCode: trustedContext.projectCode,
    row: {
      id: rowId,
      type: rowType,
      revision: rowRevision,
      projectCode: trustedContext.projectCode,
      payload: { foundation: normalizedDefinition }
    },
    definition: normalizedDefinition
  };
  return {
    valid: true,
    status: 'valid',
    operation,
    issues: [],
    normalized
  };
}

/** Normalize a valid candidate or throw with the complete validation issues. */
export function normalizeFoundationGraphWrite(
  input: unknown
): FoundationGraphWriteResult {
  const result = validateFoundationGraphWrite(input);
  if (!result.valid || !result.normalized) throw new FoundationGraphWriteError(result.issues);
  return result.normalized;
}

/** Descriptive alias for callers that use the validation/normalization pair. */
export const validateAndNormalizeFoundationGraphWrite = normalizeFoundationGraphWrite;

function validateContext(
  context: FoundationGraphWriteContext,
  issues: FoundationGraphWriteIssue[]
): void {
  if (!isNonEmptyString(context.principal)) {
    issues.push({ code: 'INVALID_INPUT', path: 'context.principal', message: 'context.principal must be a non-empty trusted identifier.' });
  }
  if (!isNonEmptyString(context.projectCode)) {
    issues.push({ code: 'INVALID_INPUT', path: 'context.projectCode', message: 'context.projectCode must be a non-empty selected project code.' });
  }
  if (context.scope !== undefined && !isScope(context.scope)) {
    issues.push({ code: 'INVALID_INPUT', path: 'context.scope', message: 'context.scope must be a valid trusted scope.' });
  } else if (context.scope !== undefined && context.scope.subjectIds.length === 0) {
    issues.push({ code: 'INVALID_INPUT', path: 'context.scope.subjectIds', message: 'context.scope must contain at least one trusted subject.' });
  }
}

function validateGraphRow(
  row: FoundationGraphWriteRow,
  issues: FoundationGraphWriteIssue[]
): void {
  if (!isNonEmptyString(row.id)) {
    issues.push({ code: 'INVALID_IDENTITY', path: 'row.id', message: 'Graph row id must be a non-empty string.' });
  }
  const rowType = resolveRowType(row);
  if (!rowType || !isFoundationType(rowType)) {
    issues.push({ code: 'INVALID_IDENTITY', path: 'row.type', message: 'Graph row type must be one of objective, variable, model, or constraint.' });
  }
  if (row.type !== undefined && row.entityType !== undefined && row.type !== row.entityType) {
    issues.push({ code: 'ROW_DEFINITION_MISMATCH', path: 'row.type', message: 'row.type and row.entityType must identify the same type.' });
  }
  if (!isCanonicalRevision(row.revision)) {
    issues.push({ code: 'INVALID_IDENTITY', path: 'row.revision', message: 'Graph row revision must be a positive canonical decimal.' });
  }
  if (!isNonEmptyString(row.projectCode)) {
    issues.push({ code: 'INVALID_INPUT', path: 'row.projectCode', message: 'Graph row projectCode must be a non-empty string.' });
  }
  if (!isRecord(row.payload) || !('foundation' in row.payload)) {
    issues.push({ code: 'INVALID_INPUT', path: 'row.payload.foundation', message: 'Graph row payload.foundation is required.' });
  }
}

function validateDraftWriteInvariants(
  definition: FoundationGraphWriteDefinition,
  issues: FoundationGraphWriteIssue[]
): void {
  if (definition.adoptionState !== 'draft') {
    issues.push({ code: 'DRAFT_ADOPTION_REQUIRED', path: 'row.payload.foundation.adoptionState', message: 'Foundation Graph write accepts draft definitions only.' });
  }
  if (definition.storage !== 'candidate') {
    issues.push({ code: 'CANDIDATE_STORAGE_REQUIRED', path: 'row.payload.foundation.storage', message: 'Foundation Graph draft writes require storage=candidate.' });
  }
  if (!sameStringArray(definition.authorizedUses, FOUNDATION_USES_DRAFT)) {
    issues.push({ code: 'DRAFT_AUTHORIZATION_REQUIRED', path: 'row.payload.foundation.authorizedUses', message: 'Foundation Graph draft writes require authorizedUses=[draft].' });
  }
  if (!Array.isArray(definition.provenance) || definition.provenance.length === 0) {
    issues.push({ code: 'PROVENANCE_REQUIRED', path: 'row.payload.foundation.provenance', message: 'At least one non-empty source provenance entry is required.' });
  } else {
    for (const [index, item] of definition.provenance.entries()) {
      if (!isRecord(item) || !isNonEmptyString(item.sourceId)) {
        issues.push({ code: 'PROVENANCE_REQUIRED', path: `row.payload.foundation.provenance[${index}].sourceId`, message: 'Each provenance entry requires a non-empty sourceId.' });
      }
    }
  }
}

function validateCandidateScope(
  definition: FoundationGraphWriteDefinition,
  context: FoundationGraphWriteContext,
  issues: FoundationGraphWriteIssue[]
): void {
  const scope = definition.scope;
  if (!isScope(scope) || scope.subjectIds.length === 0) {
    issues.push({ code: 'SCOPE_VIOLATION', path: 'row.payload.foundation.scope.subjectIds', message: 'A draft Graph write must identify at least one scoped subject.' });
    return;
  }
  if (context.scope !== undefined) {
    if (!isScope(context.scope) || context.scope.subjectIds.length === 0 || !scopeWithin(scope, context.scope)) {
      issues.push({ code: 'SCOPE_VIOLATION', path: 'row.payload.foundation.scope', message: 'Foundation scope exceeds the trusted principal/project scope.' });
    }
    return;
  }
  if (!scope.subjectIds.every((subject) => subject === context.projectCode)) {
    issues.push({ code: 'SCOPE_VIOLATION', path: 'row.payload.foundation.scope.subjectIds', message: 'Without a trusted scope, the draft scope must contain only the selected projectCode.' });
  }
}

function validateCurrentDefinition(
  current: unknown,
  candidate: unknown,
  rowId: string,
  rowType: FoundationType | undefined,
  context: FoundationGraphWriteContext,
  issues: FoundationGraphWriteIssue[]
): void {
  if (!isFoundationDefinitionRecord(current)) {
    issues.push({ code: 'CURRENT_DEFINITION_REQUIRED', path: 'currentDefinition', message: 'An update requires the current Foundation definition.' });
    return;
  }
  const currentValidation = validateFoundationDefinition(current, { use: 'draft' });
  appendDefinitionIssues(issues, 'currentDefinition', currentValidation.issues);
  if (!currentValidation.valid) return;
  if (current.id !== rowId || (rowType !== undefined && current.type !== rowType)) {
    issues.push({ code: 'ROW_DEFINITION_MISMATCH', path: 'currentDefinition', message: 'currentDefinition identity must match the Graph row.' });
  }
  if (isFoundationDefinitionRecord(candidate) && (current.id !== candidate.id || current.type !== candidate.type)) {
    issues.push({ code: 'ROW_DEFINITION_MISMATCH', path: 'currentDefinition', message: 'currentDefinition identity must match the candidate definition.' });
  }
  if (current.acl.ownerId !== candidateAclOwner(candidate)) {
    issues.push({ code: 'OWNER_MISMATCH', path: 'row.payload.foundation.acl.ownerId', message: 'An update must preserve the current owner.' });
  }
  const canWrite = current.acl.ownerId === context.principal || current.acl.writerIds.includes(context.principal);
  if (!canWrite) {
    issues.push({ code: 'WRITER_NOT_AUTHORIZED', path: 'currentDefinition.acl', message: 'The trusted principal is not an owner or writer in the current ACL.' });
  }
  if (isFoundationDefinitionRecord(candidate) && candidate.acl.ownerId !== current.acl.ownerId) {
    issues.push({ code: 'OWNER_MISMATCH', path: 'row.payload.foundation.acl.ownerId', message: 'An update cannot transfer ownership through a draft write.' });
  }
  if (isFoundationDefinitionRecord(candidate) && isFoundationAcl(candidate.acl)
    && !sameAcl(current.acl, candidate.acl)
    && current.acl.ownerId !== context.principal) {
    issues.push({
      code: 'ACL_CHANGE_FORBIDDEN',
      path: 'row.payload.foundation.acl',
      message: 'Only the current owner may change ACL fields during a draft update.'
    });
  }
  validateCandidateScope(current, context, issues);
}

function candidateAclOwner(value: unknown): string | undefined {
  return isRecord(value) && isRecord(value.acl) && typeof value.acl.ownerId === 'string'
    ? value.acl.ownerId
    : undefined;
}

function isFoundationAcl(value: unknown): value is FoundationAcl {
  return isRecord(value)
    && isNonEmptyString(value.ownerId)
    && (value.visibility === 'private'
      || value.visibility === 'project'
      || value.visibility === 'organization'
      || value.visibility === 'public')
    && Array.isArray(value.readerIds)
    && value.readerIds.every(isNonEmptyString)
    && Array.isArray(value.writerIds)
    && value.writerIds.every(isNonEmptyString);
}

function sameAcl(left: FoundationAcl, right: FoundationAcl): boolean {
  return left.ownerId === right.ownerId
    && left.visibility === right.visibility
    && sameStringArray(left.readerIds, right.readerIds)
    && sameStringArray(left.writerIds, right.writerIds);
}

function appendDefinitionIssues(
  issues: FoundationGraphWriteIssue[],
  prefix: string,
  validationIssues: readonly FoundationValidationIssue[]
): void {
  for (const issue of validationIssues) {
    issues.push({
      code: 'DEFINITION_INVALID',
      path: `${prefix}.${issue.path}`,
      message: issue.message
    });
  }
}

function invalid(
  issues: FoundationGraphWriteIssue[],
  first?: FoundationGraphWriteIssue,
  operation?: FoundationGraphWriteOperation
): FoundationGraphWriteValidationResult {
  if (first) issues.unshift(first);
  return {
    valid: false,
    status: 'invalid',
    ...(operation === undefined ? {} : { operation }),
    issues
  };
}

function resolveRowType(row: FoundationGraphWriteRow): FoundationType | undefined {
  const candidate = row.type ?? row.entityType;
  return isFoundationType(candidate) ? candidate : undefined;
}

function isFoundationDefinitionRecord(value: unknown): value is FoundationGraphWriteDefinition {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isFoundationType(value.type)
    && isNonEmptyString(value.revision);
}

type FoundationGraphWriteDefinition = FoundationDefinition & Record<string, unknown>;

type FoundationGraphWriteRecord = Record<string, unknown>;

function unwrapFoundation(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.foundation)) return value.foundation;
  return value;
}

function isFoundationType(value: unknown): value is FoundationType {
  return typeof value === 'string' && FOUNDATION_TYPES.includes(value as FoundationType);
}

function isCanonicalRevision(value: unknown): value is string {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is FoundationGraphWriteRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScope(value: unknown): value is FoundationScope {
  if (!isRecord(value) || !Array.isArray(value.subjectIds) || !value.subjectIds.every(isNonEmptyString)) return false;
  if (!isNonEmptyString(value.validFrom) || !isRfc3339(value.validFrom)) return false;
  if (value.validUntil !== undefined && (!isNonEmptyString(value.validUntil) || !isRfc3339(value.validUntil))) return false;
  if (value.validUntil === undefined) return true;
  return parseRfc3339(value.validUntil)! > parseRfc3339(value.validFrom)!;
}

function scopeWithin(inner: FoundationScope, outer: FoundationScope): boolean {
  if (!inner.subjectIds.every((subject) => outer.subjectIds.includes(subject))) return false;
  const innerFrom = parseRfc3339(inner.validFrom);
  const outerFrom = parseRfc3339(outer.validFrom);
  if (innerFrom === undefined || outerFrom === undefined || innerFrom < outerFrom) return false;
  if (inner.validUntil === undefined) return outer.validUntil === undefined;
  const innerUntil = parseRfc3339(inner.validUntil);
  if (innerUntil === undefined || outer.validUntil === undefined) return innerUntil !== undefined && outer.validUntil === undefined;
  const outerUntil = parseRfc3339(outer.validUntil);
  return outerUntil !== undefined && innerUntil <= outerUntil;
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index]);
}

function isRfc3339(value: string): boolean {
  return parseRfc3339(value) !== undefined;
}

function parseRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return undefined;
  const zone = match[8]!;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const milliseconds = Number(((match[7] ?? '') + '000').slice(0, 3));
  return Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - offsetMinutes * 60_000;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
