import { createHash } from 'node:crypto';
import { isActiveAt } from './canonical-graph.js';
import { canonicalPortableJson } from './portable-graph.js';
import type {
  JudgmentProblemJSONValue,
  JudgmentProblemReference,
  JudgmentProblemReferenceResolution,
  JudgmentProblemReferenceResolutionPhase,
  JudgmentProblemScope,
  JudgmentProblemSnapshotAccessContext
} from './judgment-problem-snapshot.js';
import type { FoundationStoreContext } from './foundation-store.js';
import type { FoundationAcl } from './ontology-foundation.js';

/** The host owns the canonical philosophy source; this package owns only the read port. */
export const PHILOSOPHY_REVISION_READ_CONTRACT_VERSION = 'philosophy-revision-read.v1' as const;

export type PhilosophyRevisionKind = 'philosophy';
export type PhilosophyRevisionDigest = `sha256:${string}`;
export type PhilosophyRevisionScope = JudgmentProblemScope;
export type PhilosophyRevisionPayload = JudgmentProblemJSONValue;

export interface PhilosophyRevisionApplicability {
  readonly scope: PhilosophyRevisionScope;
  readonly validFrom: string;
  readonly validUntil?: string;
}

/** A snapshot keeps this reference, never a copy of the canonical philosophy. */
export interface PhilosophyRevisionReference {
  readonly kind: PhilosophyRevisionKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: PhilosophyRevisionDigest;
  readonly scope: PhilosophyRevisionScope;
  readonly valid_from: string;
  readonly valid_to?: string | null;
}

/**
 * The host returns the immutable payload with current authorization metadata.
 * `applicability` belongs to the canonical revision and is covered by digest;
 * `currentAcl` and `currentScope` are read-time metadata and are not.
 */
export interface PhilosophyRevisionRecord {
  readonly kind: PhilosophyRevisionKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: PhilosophyRevisionDigest;
  readonly payload: PhilosophyRevisionPayload;
  readonly applicability: PhilosophyRevisionApplicability;
  readonly currentAcl: FoundationAcl;
  readonly currentScope: PhilosophyRevisionScope;
}

export interface PhilosophyRevisionReadRequest {
  readonly reference: PhilosophyRevisionReference;
  readonly phase: JudgmentProblemReferenceResolutionPhase;
  readonly context: {
    readonly principal: string;
    readonly scope: PhilosophyRevisionScope;
  };
}

export type PhilosophyRevisionReadResult =
  | {
      readonly status: 'resolved';
      readonly record: PhilosophyRevisionRecord;
    }
  | {
      readonly status: 'missing' | 'unauthorized' | 'corrupt';
      readonly message?: string;
    };

/** The organization-specific adapter reads this port from its existing philosophy SSOT. */
export interface PhilosophyRevisionReader {
  /** Resolve a canonical pin before its digest is known; current authorization still applies. */
  readCanonical?(input: { readonly id: string; readonly revision: string; readonly context: FoundationStoreContext }): PhilosophyRevisionReadResult | Promise<PhilosophyRevisionReadResult>;
  read(input: PhilosophyRevisionReadRequest): PhilosophyRevisionReadResult | Promise<PhilosophyRevisionReadResult>;
}

export interface JudgmentProblemPhilosophyReferenceResolverInput {
  readonly reference: JudgmentProblemReference;
  readonly phase: JudgmentProblemReferenceResolutionPhase;
  readonly context: JudgmentProblemSnapshotAccessContext;
}

const REVISION_PATTERN = /^[1-9]\d*$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SCOPE_TYPES: readonly PhilosophyRevisionScope['type'][] = ['personal', 'project', 'organization'];
const ACL_VISIBILITIES: readonly FoundationAcl['visibility'][] = ['private', 'project', 'organization', 'public'];

/**
 * Computes the stable identity of a canonical philosophy revision.
 * Current ACL and scope are intentionally excluded so authorization changes do
 * not create a false content revision; they are checked on every read.
 */
export function philosophyRevisionDigest(
  input: Pick<PhilosophyRevisionRecord, 'kind' | 'id' | 'revision' | 'payload' | 'applicability'>
): PhilosophyRevisionDigest {
  assertPhilosophyRevisionIdentity(input);
  assertPhilosophyRevisionPayload(input.payload);
  assertPhilosophyRevisionApplicability(input.applicability);
  const content = {
    kind: input.kind,
    id: input.id,
    revision: input.revision,
    payload: input.payload,
    applicability: canonicalApplicability(input.applicability)
  };
  return `sha256:${createHash('sha256').update(canonicalPortableJson(content), 'utf8').digest('hex')}`;
}

/** Structural check for callers that need to validate a reference before I/O. */
export function isPhilosophyRevisionReference(value: unknown): value is PhilosophyRevisionReference {
  if (!isPlainRecord(value) || value.kind !== 'philosophy') return false;
  if (!isNonEmptyString(value.id) || !isPositiveRevision(value.revision) || !isDigest(value.digest)) return false;
  if (!isPhilosophyRevisionScope(value.scope) || !isRfc3339(value.valid_from)) return false;
  if (value.valid_to === undefined || value.valid_to === null) return true;
  return typeof value.valid_to === 'string' && isValidInterval(value.valid_from, value.valid_to);
}

/**
 * Adapt canonical philosophy reads to `JudgmentProblemReferenceProvider.resolveOther`.
 * Unknown reference kinds remain unresolved so the caller can compose other
 * providers explicitly.
 */
export function createJudgmentProblemPhilosophyReferenceResolver(options: {
  readonly reader: PhilosophyRevisionReader;
}): (input: JudgmentProblemPhilosophyReferenceResolverInput) => Promise<JudgmentProblemReferenceResolution> {
  if (!options || !options.reader || typeof options.reader.read !== 'function') {
    throw new TypeError('A PhilosophyRevisionReader is required');
  }

  return async (input) => {
    if ((input.reference.kind as string) !== 'philosophy') {
      return { status: 'unresolved', message: `Philosophy revision resolver does not handle ${input.reference.kind}` };
    }
    if (!isNonEmptyString(input.context.principal)) {
      return { status: 'unauthorized', message: 'A trusted principal is required for philosophy revision reads' };
    }

    const reference: PhilosophyRevisionReference = {
      kind: 'philosophy',
      id: input.reference.id,
      revision: input.reference.revision,
      digest: input.reference.digest,
      scope: cloneScope(input.reference.scope),
      valid_from: input.reference.valid_from,
      ...(input.reference.valid_to == null ? {} : { valid_to: input.reference.valid_to })
    };
    if (!isPhilosophyRevisionReference(reference)) {
      return { status: 'unresolved', message: 'Philosophy revision reference is invalid' };
    }

    let result: PhilosophyRevisionReadResult;
    try {
      result = await options.reader.read({
        reference,
        phase: input.phase,
        // Snapshot access has no caller-supplied mutable scope. The reference
        // scope is the requested boundary; the host must bind it to its trusted
        // current tenant/project context before returning a record.
        context: { principal: input.context.principal, scope: cloneScope(reference.scope) }
      });
    } catch {
      return { status: 'unresolved', message: 'Philosophy revision reader failed closed' };
    }

    if (!isPlainRecord(result) || typeof result.status !== 'string') {
      return { status: 'unresolved', message: 'Philosophy revision reader returned an invalid result' };
    }
    if (result.status === 'missing') {
      return { status: 'missing', message: result.message ?? 'Philosophy revision was not found' };
    }
    if (result.status === 'unauthorized') {
      return { status: 'unauthorized', message: result.message ?? 'Philosophy revision is not readable' };
    }
    if (result.status === 'corrupt') {
      return { status: 'unresolved', message: result.message ?? 'Philosophy revision failed integrity validation' };
    }
    if (result.status !== 'resolved' || !isPlainRecord(result.record)) {
      return { status: 'unresolved', message: 'Philosophy revision reader returned an invalid resolved record' };
    }

    const integrity = validateResolvedRecord(
      result.record as PhilosophyRevisionRecord,
      reference,
      input.context.principal,
      input.phase
    );
    if (integrity.status !== 'resolved') return integrity;
    return { status: 'resolved', digest: reference.digest };
  };
}

function validateResolvedRecord(
  record: PhilosophyRevisionRecord,
  reference: PhilosophyRevisionReference,
  principal: string,
  phase: JudgmentProblemReferenceResolutionPhase
): JudgmentProblemReferenceResolution {
  if (record.kind !== 'philosophy' || record.id !== reference.id || record.revision !== reference.revision) {
    return { status: 'unresolved', message: 'Philosophy revision identity does not match the requested reference' };
  }
  if (!isDigest(record.digest) || record.digest !== reference.digest) {
    return { status: 'unresolved', message: 'Philosophy revision digest does not match the requested reference' };
  }
  try {
    assertPhilosophyRevisionPayload(record.payload);
    assertPhilosophyRevisionApplicability(record.applicability);
    if (philosophyRevisionDigest(record) !== record.digest) {
      return { status: 'unresolved', message: 'Philosophy revision payload digest is corrupt' };
    }
  } catch {
    return { status: 'unresolved', message: 'Philosophy revision payload or applicability is corrupt' };
  }
  if (!isPhilosophyRevisionAcl(record.currentAcl) || !isPhilosophyRevisionScope(record.currentScope)) {
    return { status: 'unresolved', message: 'Philosophy revision authorization metadata is corrupt' };
  }
  if (!sameScope(record.currentScope, reference.scope)) {
    return { status: 'unauthorized', message: 'Philosophy revision is outside the requested tenant/project scope' };
  }
  // A current save/read must prove that the revision applies to this
  // judgment.  Historical reads preserve the original reference and only
  // re-check immutable content plus the current ACL/scope, matching the
  // snapshot provider contract; applicability is not re-evaluated against a
  // later policy boundary.
  if (phase !== 'historical_read') {
    if (!sameScope(record.applicability.scope, reference.scope)) {
      return { status: 'not_applicable', message: 'Philosophy revision is outside the requested applicability scope' };
    }
    const referenceApplicability = referenceApplicabilityFrom(reference);
    if (!periodContains(record.applicability, referenceApplicability)) {
      return { status: 'not_applicable', message: 'Philosophy revision does not cover the requested applicability period' };
    }
  }
  if (!canReadPhilosophyRevision(record.currentAcl, principal)) {
    return { status: 'unauthorized', message: 'Philosophy revision is not readable by the current principal' };
  }
  return { status: 'resolved', digest: reference.digest };
}

function assertPhilosophyRevisionIdentity(
  value: Pick<PhilosophyRevisionRecord, 'kind' | 'id' | 'revision'>
): void {
  if (value.kind !== 'philosophy' || !isNonEmptyString(value.id) || !isPositiveRevision(value.revision)) {
    throw new TypeError('Philosophy revision identity requires kind, id, and a positive revision');
  }
}

function assertPhilosophyRevisionPayload(value: unknown): asserts value is PhilosophyRevisionPayload {
  try {
    // canonicalPortableJson rejects undefined, non-JSON objects, non-finite
    // numbers, and cyclic values while preserving opaque philosophy shape.
    canonicalPortableJson(value);
  } catch {
    throw new TypeError('Philosophy revision payload must be a JSON value');
  }
}

function assertPhilosophyRevisionApplicability(value: unknown): asserts value is PhilosophyRevisionApplicability {
  if (!isPlainRecord(value) || !isPhilosophyRevisionScope(value.scope) || !isRfc3339(value.validFrom) ||
      (value.validUntil !== undefined && !isRfc3339(value.validUntil)) ||
      (typeof value.validUntil === 'string' && Date.parse(value.validFrom) > Date.parse(value.validUntil))) {
    throw new TypeError('Philosophy revision applicability is invalid');
  }
}

function referenceApplicabilityFrom(reference: PhilosophyRevisionReference): PhilosophyRevisionApplicability {
  return {
    scope: cloneScope(reference.scope),
    validFrom: reference.valid_from,
    ...(reference.valid_to == null ? {} : { validUntil: reference.valid_to })
  };
}

function canonicalApplicability(value: PhilosophyRevisionApplicability): Record<string, unknown> {
  return {
    scope: cloneScope(value.scope),
    validFrom: value.validFrom,
    ...(value.validUntil === undefined ? {} : { validUntil: value.validUntil })
  };
}

function periodContains(source: PhilosophyRevisionApplicability, requested: PhilosophyRevisionApplicability): boolean {
  const sourceFrom = Date.parse(source.validFrom);
  const sourceUntil = source.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(source.validUntil);
  const requestedFrom = Date.parse(requested.validFrom);
  const requestedUntil = requested.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(requested.validUntil);
  return sourceFrom <= requestedFrom && sourceUntil >= requestedUntil;
}

function isValidInterval(from: string, to: string): boolean {
  return isRfc3339(from) && isRfc3339(to) && Date.parse(from) <= Date.parse(to);
}

function isPhilosophyRevisionAcl(value: unknown): value is FoundationAcl {
  if (!isPlainRecord(value) || !isNonEmptyString(value.ownerId) ||
      !ACL_VISIBILITIES.includes(value.visibility as FoundationAcl['visibility']) ||
      !isStringArray(value.readerIds) || !isStringArray(value.writerIds)) return false;
  return new Set(value.readerIds).size === value.readerIds.length && new Set(value.writerIds).size === value.writerIds.length;
}

function canReadPhilosophyRevision(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public' || acl.ownerId === principal ||
    acl.readerIds.includes(principal) || acl.writerIds.includes(principal);
}

function isPhilosophyRevisionScope(value: unknown): value is PhilosophyRevisionScope {
  return isPlainRecord(value) && SCOPE_TYPES.includes(value.type as PhilosophyRevisionScope['type']) && isNonEmptyString(value.id);
}

function sameScope(left: PhilosophyRevisionScope, right: PhilosophyRevisionScope): boolean {
  return left.type === right.type && left.id === right.id;
}

function cloneScope(scope: PhilosophyRevisionScope): PhilosophyRevisionScope {
  return { type: scope.type, id: scope.id };
}

function isDigest(value: unknown): value is PhilosophyRevisionDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isPositiveRevision(value: unknown): value is string {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function isRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    // Reuse the canonical Graph calendar validation so philosophy revision
    // periods reject the same malformed timestamps as Graph records.
    isActiveAt({ validFrom: value }, value);
    return true;
  } catch {
    return false;
  }
}
