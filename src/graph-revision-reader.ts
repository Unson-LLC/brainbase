import { createHash } from 'node:crypto';
import { canonicalEdgeId } from './canonical-graph.js';
import { canonicalPortableJson } from './portable-graph.js';
import type { FoundationAcl } from './ontology-foundation.js';
import type {
  JudgmentProblemReference,
  JudgmentProblemReferenceResolution,
  JudgmentProblemReferenceResolutionPhase,
  JudgmentProblemScope,
  JudgmentProblemSnapshotAccessContext
} from './judgment-problem-snapshot.js';
import type { CanonicalEdge, CanonicalEntity, CoreRelation } from './types.js';

/** Immutable Graph entity/edge reads are versioned independently of Graph file releases. */
export const GRAPH_REVISION_READ_CONTRACT_VERSION = 'graph-revision-read.v1' as const;

export type GraphRevisionKind = 'entity' | 'edge';
export type GraphRevisionDigest = `sha256:${string}`;
export type GraphRevisionScope = JudgmentProblemScope;
export type GraphRevisionPayload = CanonicalEntity | CanonicalEdge;

export interface GraphRevisionReference {
  readonly kind: GraphRevisionKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: GraphRevisionDigest;
  /** The tenant/project boundary requested by the judgment. */
  readonly scope: GraphRevisionScope;
}

/**
 * The host supplies this port from its current authorization boundary.  The
 * OSS package does not create tenant history or infer membership from Graph
 * edges.  A caller-provided reference scope is therefore only a requested
 * boundary; the reader must bind it to its trusted tenant/project context.
 */
export interface GraphRevisionReadRequest {
  readonly reference: GraphRevisionReference;
  readonly phase: JudgmentProblemReferenceResolutionPhase;
  readonly context: {
    readonly principal: string;
    readonly scope: GraphRevisionScope;
  };
}

export interface GraphRevisionRecord {
  readonly kind: GraphRevisionKind;
  readonly id: string;
  readonly revision: string;
  /** Digest of the immutable identity and payload, excluding current ACL. */
  readonly digest: GraphRevisionDigest;
  readonly payload: GraphRevisionPayload;
  /** ACL and scope are read-time metadata and must be checked on every read. */
  readonly currentAcl: FoundationAcl;
  readonly currentScope: GraphRevisionScope;
}

export type GraphRevisionReadResult =
  | {
      readonly status: 'resolved';
      readonly record: GraphRevisionRecord;
    }
  | {
      readonly status: 'missing' | 'unauthorized' | 'corrupt';
      readonly message?: string;
    };

/**
 * A repository or organization host implements this port.  Returning a
 * historical payload is allowed only when current ACL and scope are checked
 * by the host; the adapter below repeats those checks before resolving a
 * JudgmentProblem reference.
 */
export interface GraphRevisionReader {
  read(input: GraphRevisionReadRequest): GraphRevisionReadResult | Promise<GraphRevisionReadResult>;
}

export interface JudgmentProblemGraphReferenceResolverInput {
  readonly reference: JudgmentProblemReference;
  readonly phase: JudgmentProblemReferenceResolutionPhase;
  readonly context: JudgmentProblemSnapshotAccessContext;
}

const GRAPH_KINDS: readonly GraphRevisionKind[] = ['entity', 'edge'];
const REVISION_PATTERN = /^[1-9]\d*$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SCOPE_TYPES: readonly JudgmentProblemScope['type'][] = ['personal', 'project', 'organization'];
const ACL_VISIBILITIES: readonly FoundationAcl['visibility'][] = ['private', 'project', 'organization', 'public'];
const CORE_RELATIONS: readonly CoreRelation[] = [
  'member_of',
  'participates_in',
  'accountable_for',
  'owned_by',
  'governs',
  'supersedes'
];
const ENTITY_TYPES = new Set<CanonicalEntity['type']>(['person', 'org', 'project', 'decision']);

/**
 * Computes the stable digest used by a GraphRevisionReference.  Current ACL
 * is intentionally excluded so an ACL change does not create a false content
 * revision; the adapter still checks the current ACL before every read.
 */
export function graphRevisionDigest(input: Pick<GraphRevisionRecord, 'kind' | 'id' | 'revision' | 'payload'>): GraphRevisionDigest {
  assertGraphRevisionIdentity(input);
  assertGraphRevisionPayload(input.kind, input.id, input.payload);
  const content = {
    kind: input.kind,
    id: input.id,
    revision: input.revision,
    payload: input.payload
  };
  return `sha256:${createHash('sha256').update(canonicalPortableJson(content), 'utf8').digest('hex')}`;
}

/** Structural check for callers that need to validate a reference before I/O. */
export function isGraphRevisionReference(value: unknown): value is GraphRevisionReference {
  if (!isPlainRecord(value) || !GRAPH_KINDS.includes(value.kind as GraphRevisionKind)) return false;
  if (!isNonEmptyString(value.id) || !isPositiveRevision(value.revision) || !isDigest(value.digest)) return false;
  return isGraphRevisionScope(value.scope);
}

/**
 * Adapt Graph entity/edge reads to `JudgmentProblemReferenceProvider.resolveOther`.
 * Unknown reference kinds remain unresolved so another provider can be composed
 * explicitly by the caller; this resolver never treats an unhandled kind as
 * resolved.
 */
export function createJudgmentProblemGraphReferenceResolver(options: {
  readonly reader: GraphRevisionReader;
}): (input: JudgmentProblemGraphReferenceResolverInput) => Promise<JudgmentProblemReferenceResolution> {
  if (!options || !options.reader || typeof options.reader.read !== 'function') {
    throw new TypeError('A GraphRevisionReader is required');
  }

  return async (input) => {
    const kind = input.reference.kind as GraphRevisionKind;
    if (!GRAPH_KINDS.includes(kind)) {
      return { status: 'unresolved', message: `Graph revision resolver does not handle ${input.reference.kind}` };
    }
    if (!isNonEmptyString(input.context.principal)) {
      return { status: 'unauthorized', message: 'A trusted principal is required for Graph revision reads' };
    }

    const reference: GraphRevisionReference = {
      kind,
      id: input.reference.id,
      revision: input.reference.revision,
      digest: input.reference.digest,
      scope: cloneScope(input.reference.scope)
    };
    if (!isGraphRevisionReference(reference)) {
      return { status: 'unresolved', message: 'Graph revision reference is invalid' };
    }

    let result: GraphRevisionReadResult;
    try {
      result = await options.reader.read({
        reference,
        phase: input.phase,
        // The scope is a requested boundary.  The host reader must bind it to
        // its trusted tenant/project context before returning a record.
        context: { principal: input.context.principal, scope: cloneScope(reference.scope) }
      });
    } catch {
      return { status: 'unresolved', message: 'Graph revision reader failed closed' };
    }

    if (!isPlainRecord(result) || typeof result.status !== 'string') {
      return { status: 'unresolved', message: 'Graph revision reader returned an invalid result' };
    }
    if (result.status === 'missing') {
      return { status: 'missing', message: result.message ?? 'Graph revision was not found' };
    }
    if (result.status === 'unauthorized') {
      return { status: 'unauthorized', message: result.message ?? 'Graph revision is not readable' };
    }
    if (result.status === 'corrupt') {
      return { status: 'unresolved', message: result.message ?? 'Graph revision failed integrity validation' };
    }
    if (result.status !== 'resolved' || !isPlainRecord(result.record)) {
      return { status: 'unresolved', message: 'Graph revision reader returned an invalid resolved record' };
    }

    const record = result.record as GraphRevisionRecord;
    const integrity = validateResolvedRecord(record, reference, input.context.principal);
    if (integrity.status !== 'resolved') return integrity;
    return { status: 'resolved', digest: reference.digest };
  };
}

function validateResolvedRecord(
  record: GraphRevisionRecord,
  reference: GraphRevisionReference,
  principal: string
): JudgmentProblemReferenceResolution {
  if (!GRAPH_KINDS.includes(record.kind) || record.kind !== reference.kind ||
      record.id !== reference.id || record.revision !== reference.revision) {
    return { status: 'unresolved', message: 'Graph revision identity does not match the requested reference' };
  }
  if (!isDigest(record.digest) || record.digest !== reference.digest) {
    return { status: 'unresolved', message: 'Graph revision digest does not match the requested reference' };
  }
  try {
    assertGraphRevisionPayload(record.kind, record.id, record.payload);
    if (graphRevisionDigest(record) !== record.digest) {
      return { status: 'unresolved', message: 'Graph revision payload digest is corrupt' };
    }
  } catch {
    return { status: 'unresolved', message: 'Graph revision payload is corrupt' };
  }
  if (!isGraphRevisionAcl(record.currentAcl) || !isGraphRevisionScope(record.currentScope)) {
    return { status: 'unresolved', message: 'Graph revision authorization metadata is corrupt' };
  }
  if (!sameScope(record.currentScope, reference.scope)) {
    return { status: 'unauthorized', message: 'Graph revision is outside the requested tenant/project scope' };
  }
  if (!canReadGraphRevision(record.currentAcl, principal)) {
    return { status: 'unauthorized', message: 'Graph revision is not readable by the current principal' };
  }
  return { status: 'resolved', digest: reference.digest };
}

function assertGraphRevisionIdentity(value: Pick<GraphRevisionRecord, 'kind' | 'id' | 'revision'>): void {
  if (!GRAPH_KINDS.includes(value.kind) || !isNonEmptyString(value.id) || !isPositiveRevision(value.revision)) {
    throw new TypeError('Graph revision identity requires kind, id, and a positive revision');
  }
}

function assertGraphRevisionPayload(kind: GraphRevisionKind, id: string, payload: unknown): asserts payload is GraphRevisionPayload {
  if (!isPlainRecord(payload) || payload.id !== id) throw new TypeError('Graph revision payload id does not match its reference');
  if (kind === 'entity') {
    if (!ENTITY_TYPES.has(payload.type as CanonicalEntity['type']) || !isNonEmptyString(payload.name)) {
      throw new TypeError('Graph entity revision payload is invalid');
    }
    assertOptionalStringArray(payload.aliases);
    assertOptionalString(payload.summary);
    assertOptionalStringArray(payload.tags);
    assertOptionalRecord(payload.metadata);
    assertOptionalValidity(payload.validFrom, payload.validTo);
    return;
  }
  if (!isNonEmptyString(payload.fromId) || !isNonEmptyString(payload.toId) ||
      !CORE_RELATIONS.includes(payload.relation as CoreRelation) ||
      canonicalEdgeId({
        fromId: payload.fromId,
        relation: payload.relation as CoreRelation,
        toId: payload.toId
      }) !== id) {
    throw new TypeError('Graph edge revision payload is invalid');
  }
  assertOptionalString(payload.role);
  assertOptionalString(payload.context);
  assertOptionalValidity(payload.validFrom, payload.validTo);
  if (payload.provenance !== undefined) {
    if (!isPlainRecord(payload.provenance) ||
        !['user_approved', 'migration', 'import', 'onboarding'].includes(String(payload.provenance.sourceKind))) {
      throw new TypeError('Graph edge provenance is invalid');
    }
    assertOptionalString(payload.provenance.sourceId);
    assertOptionalString(payload.provenance.evidenceHash);
  }
}

function isGraphRevisionAcl(value: unknown): value is FoundationAcl {
  if (!isPlainRecord(value) || !isNonEmptyString(value.ownerId) ||
      !ACL_VISIBILITIES.includes(value.visibility as FoundationAcl['visibility']) ||
      !isStringArray(value.readerIds) || !isStringArray(value.writerIds)) return false;
  return new Set(value.readerIds).size === value.readerIds.length && new Set(value.writerIds).size === value.writerIds.length;
}

function canReadGraphRevision(acl: FoundationAcl, principal: string): boolean {
  return acl.visibility === 'public' || acl.ownerId === principal ||
    acl.readerIds.includes(principal) || acl.writerIds.includes(principal);
}

function isGraphRevisionScope(value: unknown): value is GraphRevisionScope {
  return isPlainRecord(value) && SCOPE_TYPES.includes(value.type as GraphRevisionScope['type']) && isNonEmptyString(value.id);
}

function sameScope(left: GraphRevisionScope, right: GraphRevisionScope): boolean {
  return left.type === right.type && left.id === right.id;
}

function cloneScope(scope: GraphRevisionScope): GraphRevisionScope {
  return { type: scope.type, id: scope.id };
}

function isDigest(value: unknown): value is GraphRevisionDigest {
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

function assertOptionalString(value: unknown): void {
  if (value !== undefined && typeof value !== 'string') throw new TypeError('Optional Graph revision text must be a string');
}

function assertOptionalStringArray(value: unknown): void {
  if (value !== undefined && !isStringArray(value)) throw new TypeError('Optional Graph revision string array is invalid');
}

function assertOptionalRecord(value: unknown): void {
  if (value !== undefined && !isPlainRecord(value)) throw new TypeError('Optional Graph revision metadata must be a record');
}

function assertOptionalValidity(from: unknown, to: unknown): void {
  if (from !== undefined && !isRfc3339(from)) throw new TypeError('Graph revision validFrom is invalid');
  if (to !== undefined && !isRfc3339(to)) throw new TypeError('Graph revision validTo is invalid');
  if (typeof from === 'string' && typeof to === 'string' && Date.parse(from) > Date.parse(to)) {
    throw new TypeError('Graph revision validity interval is invalid');
  }
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}
