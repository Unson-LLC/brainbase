import { createHash, randomUUID } from 'node:crypto';
import { link, open, lstat, mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  validateFoundationDefinition,
  type FoundationDefinition,
  type FoundationAcl,
  type FoundationRevision,
  type FoundationScope
} from './ontology-foundation.js';

/**
 * An immutable input bundle for one judgment.
 *
 * The bundle deliberately stores references to canonical objects instead of
 * copying Objective, Model, or Constraint definitions into a second SSOT.
 * Providers validate those references at the boundary of save/load.
 */
export const JUDGMENT_PROBLEM_SNAPSHOT_VERSION = 'judgment-problem-snapshot.v1' as const;
export type JudgmentProblemSnapshotId = `sha256:${string}`;

export type JudgmentProblemReferenceKind =
  | 'entity'
  | 'edge'
  | 'objective'
  | 'criterion'
  | 'variable'
  | 'observation'
  | 'model'
  | 'constraint'
  | 'authority'
  | 'resource'
  | 'deadline'
  | 'dag'
  | 'evidence';

export type JudgmentProblemScopeType = 'personal' | 'project' | 'organization';

export interface JudgmentProblemScope {
  readonly type: JudgmentProblemScopeType;
  readonly id: string;
}

export interface JudgmentProblemEvidenceAccess extends FoundationAcl {}

export type JudgmentProblemJSONValue =
  | null
  | string
  | boolean
  | number
  | JudgmentProblemJSONValue[]
  | { readonly [key: string]: JudgmentProblemJSONValue };

export interface JudgmentProblemEvidenceBinding {
  readonly mode: 'embedded_content' | 'immutable_reference';
  readonly digest: JudgmentProblemSnapshotId;
  readonly reference_id?: string;
  readonly reference_revision?: string;
  readonly content?: JudgmentProblemJSONValue;
  readonly access: JudgmentProblemEvidenceAccess;
}

export interface JudgmentProblemReference {
  readonly kind: JudgmentProblemReferenceKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: JudgmentProblemSnapshotId;
  readonly scope: JudgmentProblemScope;
  readonly valid_from: string;
  readonly valid_to?: string | null;
  readonly evidence?: JudgmentProblemEvidenceBinding;
}

/**
 * Stable name shared by sub-DAG and reservation consumers.  A ProblemRef is
 * intentionally only a versioned, scoped reference; it never carries an
 * execution grant or a mutable canonical definition.
 */
export type ProblemRef = JudgmentProblemReference;

export interface JudgmentProblemSnapshot {
  readonly snapshot_version: typeof JUDGMENT_PROBLEM_SNAPSHOT_VERSION;
  readonly problem_id: string;
  readonly revision: string;
  readonly question: string;
  readonly owner_scope: JudgmentProblemScope;
  readonly references: readonly JudgmentProblemReference[];
  /** A FoundationAcl keeps owner/readers/writers separate from truth status. */
  readonly read_policy: FoundationAcl;
  /** A snapshot never grants execution permission. */
  readonly execution_permission: 'none';
  readonly created_at: string;
}

export interface JudgmentProblemSnapshotAccessContext {
  /** Identity resolved by the caller's trusted boundary. */
  readonly principal: string;
}

/**
 * `current` revalidates canonical references for a new judgment.  `historical`
 * rechecks only the current read ACL and exact digest of each canonical
 * reference, while preserving the recorded use/applicability conditions for
 * audit/replay.  Neither mode grants execution.
 */
export type JudgmentProblemReferenceResolutionMode = 'current' | 'historical';

/** The resolver phase makes historical ACL checks explicit at the port. */
export type JudgmentProblemReferenceResolutionPhase = 'save' | 'read' | 'historical_read';

export type JudgmentProblemSnapshotAccessAction = 'read' | 'write';

/**
 * Organization-specific authorization is a provider boundary.  The default
 * implementation below is intentionally limited to the ACL carried by the
 * snapshot; tenants can inject a provider that checks current authority.
 */
export interface JudgmentProblemSnapshotAccessProvider {
  authorize(input: {
    readonly action: JudgmentProblemSnapshotAccessAction;
    readonly context: JudgmentProblemSnapshotAccessContext;
    readonly acl: FoundationAcl;
    readonly snapshot?: JudgmentProblemSnapshot;
    readonly reference?: JudgmentProblemReference;
  }): void | boolean | Promise<void | boolean>;
}

export type JudgmentProblemReferenceResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'not_applicable'
  | 'unauthorized'
  | 'unresolved';

export interface JudgmentProblemReferenceResolution {
  readonly status: JudgmentProblemReferenceResolutionStatus;
  /** The provider must return the digest of the exact revision it resolved. */
  readonly digest?: JudgmentProblemSnapshotId;
  readonly message?: string;
}

/**
 * A provider is the only place that knows how an Observation, authority,
 * Model, or Constraint is resolved.  This store does not duplicate their
 * validation rules.  It is called on save and on every load.  A
 * `historical_read` must still pass the provider's trusted current read ACL and
 * exact revision/digest check, but must not re-evaluate recorded use or scope
 * applicability.
 */
export interface JudgmentProblemReferenceProvider {
  resolve(input: {
    readonly reference: JudgmentProblemReference;
    readonly phase: JudgmentProblemReferenceResolutionPhase;
    readonly context: JudgmentProblemSnapshotAccessContext;
  }): JudgmentProblemReferenceResolution | Promise<JudgmentProblemReferenceResolution>;
}

export interface SaveJudgmentProblemSnapshotRequest {
  readonly root: string;
  readonly snapshot: JudgmentProblemSnapshot;
  readonly access: JudgmentProblemSnapshotAccessContext;
  readonly accessProvider?: JudgmentProblemSnapshotAccessProvider;
  readonly referenceProvider: JudgmentProblemReferenceProvider;
}

export interface LoadJudgmentProblemSnapshotRequest {
  readonly root: string;
  readonly snapshot_id?: string;
  readonly problem_id?: string;
  readonly revision?: string;
  readonly access: JudgmentProblemSnapshotAccessContext;
  readonly accessProvider?: JudgmentProblemSnapshotAccessProvider;
  /** Defaults to `current`; historical reads still require the provider for current ACL/digest checks. */
  readonly reference_resolution?: JudgmentProblemReferenceResolutionMode;
  readonly referenceProvider?: JudgmentProblemReferenceProvider;
}

export interface JudgmentProblemSnapshotReceipt {
  readonly snapshot_id: JudgmentProblemSnapshotId;
  readonly snapshot_version: typeof JUDGMENT_PROBLEM_SNAPSHOT_VERSION;
  readonly problem_id: string;
  readonly revision: string;
  readonly status: 'created' | 'existing';
}

export type JudgmentProblemSnapshotErrorCode =
  | 'invalid_request'
  | 'missing_reference'
  | 'not_applicable'
  | 'unresolved_constraint'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'integrity_mismatch'
  | 'storage_io_error';

export class JudgmentProblemSnapshotError extends Error {
  readonly code: JudgmentProblemSnapshotErrorCode;
  readonly reference?: JudgmentProblemReference;

  constructor(
    code: JudgmentProblemSnapshotErrorCode,
    message: string,
    options: { readonly reference?: JudgmentProblemReference } = {}
  ) {
    super(message);
    this.name = 'JudgmentProblemSnapshotError';
    this.code = code;
    this.reference = options.reference;
  }
}

interface JudgmentProblemSnapshotEnvelope {
  readonly snapshot_id: JudgmentProblemSnapshotId;
  readonly snapshot_version: typeof JUDGMENT_PROBLEM_SNAPSHOT_VERSION;
  readonly snapshot: JudgmentProblemSnapshot;
}

interface JudgmentProblemSnapshotLocator {
  readonly key_digest: JudgmentProblemSnapshotId;
  readonly file: string;
}

const SNAPSHOT_ID_PATTERN = /^sha256:([0-9a-f]{64})$/u;
const POSITIVE_REVISION_PATTERN = /^[1-9]\d*$/u;
const SCOPE_TYPES: readonly JudgmentProblemScopeType[] = ['personal', 'project', 'organization'];
const REFERENCE_KINDS: readonly JudgmentProblemReferenceKind[] = [
  'entity',
  'edge',
  'objective',
  'criterion',
  'variable',
  'observation',
  'model',
  'constraint',
  'authority',
  'resource',
  'deadline',
  'dag',
  'evidence'
];
const SNAPSHOT_KEYS = [
  'created_at',
  'execution_permission',
  'owner_scope',
  'problem_id',
  'question',
  'read_policy',
  'references',
  'revision',
  'snapshot_version'
];
const ENVELOPE_KEYS = ['snapshot', 'snapshot_id', 'snapshot_version'];
const REFERENCE_KEYS = ['digest', 'evidence', 'id', 'kind', 'revision', 'scope', 'valid_from', 'valid_to'];
const EVIDENCE_KEYS = ['access', 'content', 'digest', 'mode', 'reference_id', 'reference_revision'];
const SCOPE_KEYS = ['id', 'type'];
const ACL_KEYS = ['ownerId', 'readerIds', 'visibility', 'writerIds'];
const LOCATOR_DIRECTORY = 'judgment-problem-snapshots';
const REVISION_DIRECTORY = 'revisions';

function fail(
  code: JudgmentProblemSnapshotErrorCode,
  message: string,
  reference?: JudgmentProblemReference
): never {
  throw new JudgmentProblemSnapshotError(code, message, reference ? { reference } : undefined);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    fail('invalid_request', `${label} must be a non-empty string`);
  }
  return value;
}

function requireRevision(value: unknown, label: string): string {
  const revision = requireString(value, label);
  if (!POSITIVE_REVISION_PATTERN.test(revision)) {
    fail('invalid_request', `${label} must be a positive canonical decimal revision`);
  }
  return revision;
}

function requireSnapshotId(value: unknown, label: string): JudgmentProblemSnapshotId {
  if (typeof value !== 'string' || !SNAPSHOT_ID_PATTERN.test(value)) {
    fail('invalid_request', `${label} must be sha256:<64 lowercase hex>`);
  }
  return value as JudgmentProblemSnapshotId;
}

function requireDate(value: unknown, label: string): string {
  const date = requireString(value, label);
  if (Number.isNaN(Date.parse(date))) fail('invalid_request', `${label} must be an ISO date`);
  return date;
}

function assertScope(value: unknown, label: string): asserts value is JudgmentProblemScope {
  if (!isPlainRecord(value) || !hasExactKeys(value, SCOPE_KEYS) ||
      !SCOPE_TYPES.includes(value.type as JudgmentProblemScopeType) ||
      typeof value.id !== 'string' || value.id.trim().length === 0 || value.id.includes('\0')) {
    fail('invalid_request', `${label} is invalid`);
  }
}

function assertAcl(value: unknown, label: string): asserts value is FoundationAcl {
  if (!isPlainRecord(value) || !hasExactKeys(value, ACL_KEYS) ||
      typeof value.ownerId !== 'string' || value.ownerId.trim().length === 0 || value.ownerId.includes('\0') ||
      !Array.isArray(value.readerIds) || !Array.isArray(value.writerIds) ||
      !['private', 'project', 'organization', 'public'].includes(String(value.visibility))) {
    fail('invalid_request', `${label} is invalid`);
  }
  if (value.readerIds.some((id) => typeof id !== 'string' || id.trim().length === 0) ||
      value.writerIds.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    fail('invalid_request', `${label}.readerIds and writerIds must contain non-empty strings`);
  }
  const readerIds = value.readerIds as string[];
  const writerIds = value.writerIds as string[];
  if (new Set(readerIds).size !== readerIds.length || new Set(writerIds).size !== writerIds.length) {
    fail('invalid_request', `${label}.readerIds and writerIds must not contain duplicates`);
  }
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalValue(
  value: unknown,
  active: Set<object> = new Set()
): JudgmentProblemJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_request', 'snapshot values must be finite JSON numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') fail('invalid_request', 'snapshot values must be JSON-compatible');
  if (active.has(value)) fail('invalid_request', 'snapshot values must not be cyclic');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JudgmentProblemJSONValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) fail('invalid_request', 'snapshot arrays must not be sparse');
        result.push(canonicalValue(value[index], active));
      }
      return result;
    }
    if (!isPlainRecord(value)) fail('invalid_request', 'snapshot objects must be plain records');
    const result: Record<string, JudgmentProblemJSONValue> = Object.create(null) as Record<string, JudgmentProblemJSONValue>;
    for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
      result[key] = canonicalValue(value[key], active);
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function canonicalJson(value: unknown): string {
  const json = JSON.stringify(canonicalValue(value));
  if (json === undefined) fail('invalid_request', 'snapshot is not JSON serializable');
  return json;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function contentDigest(value: unknown): JudgmentProblemSnapshotId {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function payloadFor(snapshot: JudgmentProblemSnapshot): { readonly snapshot_version: typeof JUDGMENT_PROBLEM_SNAPSHOT_VERSION; readonly snapshot: JudgmentProblemSnapshot } {
  return { snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION, snapshot };
}

function validateEvidence(value: unknown, label: string): JudgmentProblemEvidenceBinding {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, EVIDENCE_KEYS) ||
      !Object.prototype.hasOwnProperty.call(value, 'mode') ||
      !Object.prototype.hasOwnProperty.call(value, 'digest') ||
      !Object.prototype.hasOwnProperty.call(value, 'access') ||
      (value.mode !== 'embedded_content' && value.mode !== 'immutable_reference') ||
      typeof value.digest !== 'string' || !SNAPSHOT_ID_PATTERN.test(value.digest)) {
    fail('invalid_request', `${label} is invalid`);
  }
  assertAcl(value.access, `${label}.access`);
  const hasContent = Object.prototype.hasOwnProperty.call(value, 'content') && value.content !== undefined;
  const hasReference = typeof value.reference_id === 'string' && value.reference_id.length > 0 &&
    typeof value.reference_revision === 'string' && value.reference_revision.length > 0;
  if (value.mode === 'embedded_content') {
    if (!hasContent || hasReference) fail('invalid_request', `${label} embedded content binding is invalid`);
    const content = canonicalValue(value.content) as JudgmentProblemJSONValue;
    if (contentDigest(content) !== value.digest) fail('integrity_mismatch', `${label}.content does not match digest`);
    return deepFreeze({
      mode: 'embedded_content',
      digest: value.digest as JudgmentProblemSnapshotId,
      content,
      access: normalizeAcl(value.access)
    });
  }
  if (hasContent || !hasReference) fail('invalid_request', `${label} immutable reference binding is invalid`);
  requireRevision(value.reference_revision, `${label}.reference_revision`);
  return deepFreeze({
    mode: 'immutable_reference',
    digest: value.digest as JudgmentProblemSnapshotId,
    reference_id: value.reference_id as string,
    reference_revision: value.reference_revision as string,
    access: normalizeAcl(value.access)
  });
}

function normalizeAcl(value: FoundationAcl): FoundationAcl {
  return {
    ownerId: value.ownerId,
    visibility: value.visibility,
    readerIds: [...value.readerIds],
    writerIds: [...value.writerIds]
  };
}

function validateReference(value: unknown, index: number): JudgmentProblemReference {
  const label = `references[${index}]`;
  if (!isPlainRecord(value) || !hasOnlyKeys(value, REFERENCE_KEYS) ||
      !Object.prototype.hasOwnProperty.call(value, 'kind') ||
      !Object.prototype.hasOwnProperty.call(value, 'id') ||
      !Object.prototype.hasOwnProperty.call(value, 'revision') ||
      !Object.prototype.hasOwnProperty.call(value, 'digest') ||
      !Object.prototype.hasOwnProperty.call(value, 'scope') ||
      !Object.prototype.hasOwnProperty.call(value, 'valid_from') ||
      !REFERENCE_KINDS.includes(value.kind as JudgmentProblemReferenceKind)) {
    fail('invalid_request', `${label} is invalid`);
  }
  const id = requireString(value.id, `${label}.id`);
  const revision = requireRevision(value.revision, `${label}.revision`);
  const digest = requireSnapshotId(value.digest, `${label}.digest`);
  assertScope(value.scope, `${label}.scope`);
  const validFrom = requireDate(value.valid_from, `${label}.valid_from`);
  const validTo = value.valid_to === undefined || value.valid_to === null
    ? undefined
    : requireDate(value.valid_to, `${label}.valid_to`);
  if (validTo !== undefined && Date.parse(validTo) < Date.parse(validFrom)) {
    fail('invalid_request', `${label}.valid_to precedes valid_from`);
  }
  const evidence = value.evidence === undefined ? undefined : validateEvidence(value.evidence, `${label}.evidence`);
  return deepFreeze({
    kind: value.kind as JudgmentProblemReferenceKind,
    id,
    revision,
    digest,
    scope: { type: value.scope.type, id: value.scope.id },
    valid_from: validFrom,
    ...(validTo === undefined ? {} : { valid_to: validTo }),
    ...(evidence === undefined ? {} : { evidence })
  });
}

function validateSnapshot(value: unknown): JudgmentProblemSnapshot {
  if (!isPlainRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS) ||
      value.snapshot_version !== JUDGMENT_PROBLEM_SNAPSHOT_VERSION ||
      value.execution_permission !== 'none') {
    fail('invalid_request', 'snapshot shape or version is invalid');
  }
  const problemId = requireString(value.problem_id, 'snapshot.problem_id');
  const revision = requireRevision(value.revision, 'snapshot.revision');
  const question = requireString(value.question, 'snapshot.question');
  assertScope(value.owner_scope, 'snapshot.owner_scope');
  assertAcl(value.read_policy, 'snapshot.read_policy');
  if (!Array.isArray(value.references) || value.references.length === 0) {
    fail('missing_reference', 'snapshot.references must contain required references');
  }
  const references = value.references.map((reference, index) => validateReference(reference, index));
  const createdAt = requireDate(value.created_at, 'snapshot.created_at');
  return deepFreeze({
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    problem_id: problemId,
    revision,
    question,
    owner_scope: { type: value.owner_scope.type, id: value.owner_scope.id },
    references,
    read_policy: normalizeAcl(value.read_policy),
    execution_permission: 'none',
    created_at: createdAt
  });
}

function requiredKinds(references: readonly JudgmentProblemReference[]): Set<JudgmentProblemReferenceKind> {
  return new Set(references.map((reference) => reference.kind));
}

function validateRequiredReferences(snapshot: JudgmentProblemSnapshot): void {
  const kinds = requiredKinds(snapshot.references);
  const required: readonly JudgmentProblemReferenceKind[] = [
    'objective',
    'criterion',
    'observation',
    'model',
    'constraint',
    'authority',
    'resource',
    'deadline'
  ];
  const missing = required.filter((kind) => !kinds.has(kind));
  if (missing.length > 0) fail('missing_reference', `snapshot is missing required references: ${missing.join(', ')}`);
}

function requireRoot(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    fail('invalid_request', 'artifact root must be a non-empty filesystem path');
  }
  return path.resolve(value);
}

function locatorFor(root: string, problemId: string, revision: string): JudgmentProblemSnapshotLocator {
  const keyDigest = contentDigest({ problem_id: problemId, revision });
  const hex = keyDigest.slice('sha256:'.length);
  return {
    key_digest: keyDigest,
    file: path.join(root, LOCATOR_DIRECTORY, REVISION_DIRECTORY, `${hex}.json`)
  };
}

function providerResultError(
  reference: JudgmentProblemReference,
  result: JudgmentProblemReferenceResolution
): JudgmentProblemSnapshotError {
  if (result.status === 'missing') {
    return new JudgmentProblemSnapshotError('missing_reference', result.message ?? `Reference ${reference.kind}/${reference.id}@${reference.revision} is missing`, { reference });
  }
  if (result.status === 'not_applicable') {
    return new JudgmentProblemSnapshotError('not_applicable', result.message ?? `Reference ${reference.kind}/${reference.id}@${reference.revision} is not applicable`, { reference });
  }
  if (result.status === 'unauthorized') {
    return new JudgmentProblemSnapshotError('unauthorized', result.message ?? `Reference ${reference.kind}/${reference.id}@${reference.revision} is not readable`, { reference });
  }
  return new JudgmentProblemSnapshotError('unresolved_constraint', result.message ?? `Reference ${reference.kind}/${reference.id}@${reference.revision} is unresolved`, { reference });
}

function evidenceReference(
  owner: JudgmentProblemReference,
  evidence: JudgmentProblemEvidenceBinding
): JudgmentProblemReference {
  if (evidence.mode !== 'immutable_reference' || evidence.reference_id === undefined || evidence.reference_revision === undefined) {
    fail('invalid_request', 'immutable evidence reference is incomplete', owner);
  }
  return {
    kind: 'evidence',
    id: evidence.reference_id,
    revision: evidence.reference_revision,
    digest: evidence.digest,
    scope: owner.scope,
    valid_from: owner.valid_from,
    ...(owner.valid_to === undefined ? {} : { valid_to: owner.valid_to })
  };
}

async function resolveOneReference(
  reference: JudgmentProblemReference,
  phase: JudgmentProblemReferenceResolutionPhase,
  context: JudgmentProblemSnapshotAccessContext,
  provider: JudgmentProblemReferenceProvider,
  errorReference: JudgmentProblemReference = reference
): Promise<void> {
  let result: JudgmentProblemReferenceResolution;
  try {
    result = await provider.resolve({ reference, phase, context });
  } catch (error) {
    if (error instanceof JudgmentProblemSnapshotError) throw error;
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
    if (code === 'authorization_denied' || code === 'unauthorized') {
      fail(
        'unauthorized',
        `Reference provider denied ${reference.kind}/${reference.id}@${reference.revision}: ${error instanceof Error ? error.message : String(error)}`,
        errorReference
      );
    }
    fail(
      'unresolved_constraint',
      `Reference provider failed for ${reference.kind}/${reference.id}@${reference.revision}: ${error instanceof Error ? error.message : String(error)}`,
      errorReference
    );
  }
  if (!result || !['resolved', 'missing', 'not_applicable', 'unauthorized', 'unresolved'].includes(result.status)) {
    fail('invalid_request', `Reference provider returned an invalid result for ${reference.kind}/${reference.id}@${reference.revision}`, errorReference);
  }
  if (result.status !== 'resolved') throw providerResultError(errorReference, result);
  if (result.digest === undefined) {
    fail('integrity_mismatch', `Reference provider did not return the exact revision digest for ${reference.kind}/${reference.id}@${reference.revision}`, errorReference);
  }
  if (result.digest !== reference.digest) {
    fail('integrity_mismatch', `Reference provider digest does not match ${reference.kind}/${reference.id}@${reference.revision}`, errorReference);
  }
}

async function resolveReferences(
  snapshot: JudgmentProblemSnapshot,
  phase: JudgmentProblemReferenceResolutionPhase,
  context: JudgmentProblemSnapshotAccessContext,
  provider: JudgmentProblemReferenceProvider
): Promise<void> {
  for (const reference of snapshot.references) {
    await resolveOneReference(reference, phase, context, provider);
    if (reference.evidence?.mode === 'immutable_reference') {
      await resolveOneReference(evidenceReference(reference, reference.evidence), phase, context, provider, reference);
    }
  }
}

async function authorize(
  action: JudgmentProblemSnapshotAccessAction,
  snapshot: JudgmentProblemSnapshot,
  context: JudgmentProblemSnapshotAccessContext,
  provider: JudgmentProblemSnapshotAccessProvider
): Promise<void> {
  try {
    const result = await provider.authorize({
      action,
      context,
      acl: snapshot.read_policy,
      snapshot
    });
    if (result === false) throw new Error('provider denied access');
  } catch (error) {
    if (error instanceof JudgmentProblemSnapshotError) throw error;
    fail('unauthorized', `${action} access was denied: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const defaultJudgmentProblemSnapshotAccessProvider: JudgmentProblemSnapshotAccessProvider = {
  authorize({ action, context, acl }) {
    const principal = context.principal;
    if (action === 'write') {
      return acl.ownerId === principal || acl.writerIds.includes(principal);
    }
    return acl.visibility === 'public' || acl.ownerId === principal ||
      acl.readerIds.includes(principal) || acl.writerIds.includes(principal);
  }
};

async function assertRevisionDirectory(root: string, create: boolean): Promise<string> {
  let rootDetails;
  try {
    rootDetails = await lstat(root);
  } catch {
    fail('invalid_request', 'artifact root must be an existing regular directory');
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    fail('invalid_request', 'artifact root must be an existing regular directory');
  }
  const base = path.join(root, LOCATOR_DIRECTORY);
  const revisions = path.join(base, REVISION_DIRECTORY);
  if (!create) {
    const details = await lstat(revisions).catch(() => undefined);
    if (details === undefined) fail('not_found', 'judgment problem snapshot was not found');
    if (!details.isDirectory() || details.isSymbolicLink()) fail('integrity_mismatch', 'snapshot revision directory is invalid');
    return revisions;
  }
  for (const directory of [base, revisions]) {
    let details = await lstat(directory).catch(() => undefined);
    if (details === undefined) {
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail('storage_io_error', 'snapshot directory could not be prepared');
      }
      details = await lstat(directory).catch(() => undefined);
    }
    if (!details || !details.isDirectory() || details.isSymbolicLink()) {
      fail('integrity_mismatch', 'snapshot directory must be a regular directory');
    }
  }
  return revisions;
}

async function readRegular(file: string): Promise<string> {
  const details = await lstat(file).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('not_found', 'judgment problem snapshot was not found');
    fail('storage_io_error', 'snapshot metadata could not be read');
  });
  if (!details.isFile() || details.isSymbolicLink()) fail('integrity_mismatch', 'snapshot must be a regular file');
  try {
    return await readFile(file, 'utf8');
  } catch {
    fail('storage_io_error', 'snapshot bytes could not be read');
  }
}

function envelopeBytes(envelope: JudgmentProblemSnapshotEnvelope): string {
  return `${canonicalJson(envelope)}\n`;
}

function parseEnvelope(bytes: string): { envelope: JudgmentProblemSnapshotEnvelope; bytes: string } {
  if (!bytes.endsWith('\n')) fail('integrity_mismatch', 'stored snapshot bytes are not canonical');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.slice(0, -1));
  } catch {
    fail('integrity_mismatch', 'stored snapshot bytes are not complete JSON');
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ENVELOPE_KEYS) ||
      parsed.snapshot_version !== JUDGMENT_PROBLEM_SNAPSHOT_VERSION ||
      typeof parsed.snapshot_id !== 'string') {
    fail('integrity_mismatch', 'stored snapshot envelope is invalid');
  }
  const snapshot = validateSnapshot(parsed.snapshot);
  validateRequiredReferences(snapshot);
  const snapshotId = requireSnapshotId(parsed.snapshot_id, 'stored snapshot_id');
  const expectedId = computeJudgmentProblemSnapshotId(snapshot);
  if (snapshotId !== expectedId) fail('integrity_mismatch', 'stored snapshot identity does not match its content');
  const canonicalBytes = envelopeBytes({
    snapshot_id: expectedId,
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    snapshot
  });
  if (bytes !== canonicalBytes) fail('integrity_mismatch', 'stored snapshot bytes are not canonical');
  return {
    envelope: deepFreeze({
      snapshot_id: expectedId,
      snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
      snapshot
    }),
    bytes
  };
}

async function findById(root: string, snapshotId: JudgmentProblemSnapshotId): Promise<{ envelope: JudgmentProblemSnapshotEnvelope; bytes: string }> {
  const directory = await assertRevisionDirectory(root, false);
  const direct = path.join(directory, `${snapshotId.slice('sha256:'.length)}.json`);
  const directBytes = await readRegular(direct).catch((error) => {
    if (error instanceof JudgmentProblemSnapshotError && error.code === 'not_found') return undefined;
    throw error;
  });
  if (directBytes !== undefined) return parseEnvelope(directBytes);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    fail('storage_io_error', 'snapshot revision directory could not be listed');
  });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
    const bytes = await readRegular(path.join(directory, entry.name));
    const parsed = parseEnvelope(bytes);
    if (parsed.envelope.snapshot_id === snapshotId) return parsed;
  }
  fail('not_found', 'judgment problem snapshot was not found');
}

function receipt(
  snapshot: JudgmentProblemSnapshot,
  snapshotId: JudgmentProblemSnapshotId,
  status: JudgmentProblemSnapshotReceipt['status']
): JudgmentProblemSnapshotReceipt {
  return deepFreeze({
    snapshot_id: snapshotId,
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    problem_id: snapshot.problem_id,
    revision: snapshot.revision,
    status
  });
}

/**
 * Derive the content address without writing.  This validates only the
 * snapshot shape; canonical reference resolution belongs to providers.
 */
export function computeJudgmentProblemSnapshotId(
  value: JudgmentProblemSnapshot
): JudgmentProblemSnapshotId {
  return contentDigest(payloadFor(validateSnapshot(value)));
}

export async function saveJudgmentProblemSnapshot(
  request: SaveJudgmentProblemSnapshotRequest
): Promise<JudgmentProblemSnapshotReceipt> {
  if (!isPlainRecord(request)) fail('invalid_request', 'save request must be a plain object');
  const root = requireRoot(request.root);
  const snapshot = validateSnapshot(request.snapshot);
  validateRequiredReferences(snapshot);
  if (!request.referenceProvider || typeof request.referenceProvider.resolve !== 'function') {
    fail('invalid_request', 'referenceProvider.resolve is required');
  }
  const context = validateAccessContext(request.access);
  const accessProvider = request.accessProvider ?? defaultJudgmentProblemSnapshotAccessProvider;
  await authorize('write', snapshot, context, accessProvider);
  for (const reference of snapshot.references) {
    if (reference.evidence === undefined) continue;
    try {
      const allowed = await accessProvider.authorize({
        action: 'read',
        context,
        acl: reference.evidence.access,
        snapshot,
        reference
      });
      if (allowed === false) {
        fail('unauthorized', `evidence read access was denied for ${reference.kind}/${reference.id}@${reference.revision}`, reference);
      }
    } catch (error) {
      if (error instanceof JudgmentProblemSnapshotError) throw error;
      fail('unauthorized', `evidence read access was denied for ${reference.kind}/${reference.id}@${reference.revision}`, reference);
    }
  }
  await resolveReferences(snapshot, 'save', context, request.referenceProvider);

  const snapshotId = computeJudgmentProblemSnapshotId(snapshot);
  const envelope: JudgmentProblemSnapshotEnvelope = {
    snapshot_id: snapshotId,
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    snapshot
  };
  const bytes = envelopeBytes(envelope);
  const directory = await assertRevisionDirectory(root, true);
  const file = locatorFor(root, snapshot.problem_id, snapshot.revision).file;
  const temporary = path.join(directory, `.tmp-${process.pid}-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, file);
      return receipt(snapshot, snapshotId, 'created');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existingBytes = await readRegular(file);
      const existing = parseEnvelope(existingBytes).envelope;
      if (existing.snapshot.problem_id !== snapshot.problem_id || existing.snapshot.revision !== snapshot.revision) {
        fail('integrity_mismatch', 'snapshot revision locator points to a different problem revision');
      }
      if (existing.snapshot_id !== snapshotId || existingBytes !== bytes) {
        fail('conflict', `Problem ${snapshot.problem_id}@${snapshot.revision} already has a different snapshot`);
      }
      return receipt(snapshot, snapshotId, 'existing');
    }
  } catch (error) {
    if (error instanceof JudgmentProblemSnapshotError) throw error;
    throw new JudgmentProblemSnapshotError('storage_io_error', 'judgment problem snapshot could not be saved');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function loadJudgmentProblemSnapshot(
  request: LoadJudgmentProblemSnapshotRequest
): Promise<JudgmentProblemSnapshot> {
  if (!isPlainRecord(request)) fail('invalid_request', 'load request must be a plain object');
  const root = requireRoot(request.root);
  const context = validateAccessContext(request.access);
  const referenceResolution = request.reference_resolution ?? 'current';
  if (referenceResolution !== 'current' && referenceResolution !== 'historical') {
    fail('invalid_request', 'reference_resolution must be current or historical');
  }
  if (request.snapshot_id === undefined && (request.problem_id === undefined || request.revision === undefined)) {
    fail('invalid_request', 'load requires snapshot_id or problem_id and revision');
  }
  const suppliedId = request.snapshot_id === undefined ? undefined : requireSnapshotId(request.snapshot_id, 'snapshot_id');
  const suppliedProblemId = request.problem_id === undefined ? undefined : requireString(request.problem_id, 'problem_id');
  const suppliedRevision = request.revision === undefined ? undefined : requireRevision(request.revision, 'revision');
  const parsed = suppliedProblemId !== undefined && suppliedRevision !== undefined
    ? parseEnvelope(await readRegular(locatorFor(root, suppliedProblemId, suppliedRevision).file))
    : await findById(root, suppliedId as JudgmentProblemSnapshotId);
  const { envelope } = parsed;
  if (suppliedId !== undefined && envelope.snapshot_id !== suppliedId) fail('integrity_mismatch', 'requested snapshot_id does not match stored content');
  if (suppliedProblemId !== undefined && envelope.snapshot.problem_id !== suppliedProblemId) fail('integrity_mismatch', 'requested problem_id does not match stored content');
  if (suppliedRevision !== undefined && envelope.snapshot.revision !== suppliedRevision) fail('integrity_mismatch', 'requested revision does not match stored content');

  const accessProvider = request.accessProvider ?? defaultJudgmentProblemSnapshotAccessProvider;
  await authorize('read', envelope.snapshot, context, accessProvider);
  for (const reference of envelope.snapshot.references) {
    if (reference.evidence !== undefined) {
      try {
        const allowed = await accessProvider.authorize({
          action: 'read',
          context,
          acl: reference.evidence.access,
          snapshot: envelope.snapshot,
          reference
        });
        if (allowed === false) fail('unauthorized', `evidence access was denied for ${reference.kind}/${reference.id}@${reference.revision}`, reference);
      } catch (error) {
        if (error instanceof JudgmentProblemSnapshotError) throw error;
        fail('unauthorized', `evidence access was denied for ${reference.kind}/${reference.id}@${reference.revision}`, reference);
      }
    }
  }
  if (!request.referenceProvider || typeof request.referenceProvider.resolve !== 'function') {
    fail('invalid_request', `referenceProvider.resolve is required for ${referenceResolution} reference resolution`);
  }
  await resolveReferences(
    envelope.snapshot,
    referenceResolution === 'current' ? 'read' : 'historical_read',
    context,
    request.referenceProvider
  );
  return envelope.snapshot;
}

function validateAccessContext(value: unknown): JudgmentProblemSnapshotAccessContext {
  if (!isPlainRecord(value) || typeof value.principal !== 'string' || value.principal.trim().length === 0 || value.principal.includes('\0')) {
    fail('unauthorized', 'a trusted principal is required');
  }
  return { principal: value.principal };
}

/** Structural adapter for FoundationRevisionStore-like readers. */
export interface JudgmentProblemFoundationReferenceReader {
  read(
    reference: FoundationRevision,
    context: { readonly principal: string }
  ): Promise<{ readonly digest: string; readonly definition?: unknown } | null>;
}

/**
 * Adapt the generic foundation store to the snapshot resolver.  The store
 * read and exact digest check always run before an optional caller validator.
 * `save`/`read` additionally validate the definition for judgment use and
 * reference scope.  `historical_read` deliberately skips those past-use and
 * applicability checks, but the trusted store must still enforce its current
 * read ACL; an old revision cannot be read through a revoked current ACL.
 * The optional validator can add organization-specific policy, but cannot
 * bypass the canonical store or digest check.
 */
export function createJudgmentProblemFoundationReferenceProvider(options: {
  readonly store: JudgmentProblemFoundationReferenceReader;
  readonly validate?: (input: {
    readonly reference: JudgmentProblemReference;
    readonly phase: JudgmentProblemReferenceResolutionPhase;
    readonly context: JudgmentProblemSnapshotAccessContext;
    readonly record: {
      readonly definition: FoundationDefinition;
      readonly digest: string;
    };
  }) => JudgmentProblemReferenceResolution | Promise<JudgmentProblemReferenceResolution>;
  readonly resolveOther?: (input: {
    readonly reference: JudgmentProblemReference;
    readonly phase: JudgmentProblemReferenceResolutionPhase;
    readonly context: JudgmentProblemSnapshotAccessContext;
  }) => JudgmentProblemReferenceResolution | Promise<JudgmentProblemReferenceResolution>;
}): JudgmentProblemReferenceProvider {
  return {
    async resolve(input) {
      if (!['objective', 'variable', 'model', 'constraint'].includes(input.reference.kind)) {
        if (options.resolveOther) return options.resolveOther(input);
        return { status: 'unresolved', message: `No provider is registered for ${input.reference.kind}` };
      }
      const resolved = await options.store.read(
        {
          id: input.reference.id,
          type: input.reference.kind as FoundationRevision['type'],
          revision: input.reference.revision
        },
        { principal: input.context.principal }
      );
      if (!resolved) return { status: 'missing', message: 'Foundation revision was not found' };
      if (resolved.digest !== input.reference.digest) return { status: 'unresolved', message: 'Foundation digest changed' };
      if (!isPlainRecord(resolved.definition) || resolved.definition.type !== input.reference.kind) {
        return { status: 'unresolved', message: 'Foundation revision did not return a matching definition' };
      }
      const definition = resolved.definition as unknown as FoundationDefinition;
      if (input.phase !== 'historical_read') {
        const validation = validateFoundationDefinition(definition, { use: 'judgment' });
        if (!validation.valid) {
          const notApplicable = validation.issues.some((issue) => (
            issue.code === 'UNAUTHORIZED_USE' || issue.code === 'UNVERIFIED_MODEL'
          ));
          return {
            status: notApplicable ? 'not_applicable' : 'unresolved',
            message: validation.issues.map((issue) => issue.message).join('; ')
          };
        }
        const applicability = validateFoundationReferenceApplicability(input.reference, definition);
        if (!applicability.valid) {
          return { status: 'not_applicable', message: applicability.message };
        }
      }
      if (options.validate) {
        return options.validate({
          ...input,
          record: { definition, digest: resolved.digest }
        });
      }
      return { status: 'resolved', digest: resolved.digest as JudgmentProblemSnapshotId };
    }
  };
}

interface ApplicabilityResult {
  readonly valid: boolean;
  readonly message?: string;
}

function validateFoundationReferenceApplicability(
  reference: JudgmentProblemReference,
  definition: FoundationDefinition
): ApplicabilityResult {
  const scopes: readonly FoundationScope[] = definition.type === 'model'
    ? [definition.scope, definition.applicability]
    : [definition.scope];
  for (const scope of scopes) {
    if (!scopeContainsReference(scope, reference)) {
      return {
        valid: false,
        message: `Foundation ${definition.type}/${definition.id}@${definition.revision} is outside the reference scope or validity period`
      };
    }
  }
  return { valid: true };
}

function scopeContainsReference(scope: FoundationScope, reference: JudgmentProblemReference): boolean {
  if (!scope.subjectIds.includes(reference.scope.id)) return false;
  const sourceFrom = Date.parse(scope.validFrom);
  const sourceUntil = scope.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(scope.validUntil);
  const referenceFrom = Date.parse(reference.valid_from);
  const referenceUntil = reference.valid_to == null ? Number.POSITIVE_INFINITY : Date.parse(reference.valid_to);
  // Open-ended source/reference periods are represented by +Infinity.  Only
  // supplied timestamps must be finite; rejecting Infinity here would make
  // every valid open-ended Foundation scope look inapplicable.
  if (!Number.isFinite(sourceFrom) || !Number.isFinite(referenceFrom)) return false;
  if (scope.validUntil !== undefined && !Number.isFinite(sourceUntil)) return false;
  if (reference.valid_to != null && !Number.isFinite(referenceUntil)) return false;
  return sourceFrom <= referenceFrom && sourceUntil >= referenceUntil;
}
