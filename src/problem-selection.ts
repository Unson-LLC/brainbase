/**
 * Problem selection is the comparison boundary between evidence-sidecar
 * candidates and a future JudgmentProblem.
 *
 * The module deliberately does not rank candidates, reserve resources, grant
 * authority, or mutate an Objective. A caller supplies a versioned DAG
 * composition evaluator. This module freezes the selection inputs, checks
 * current candidate access and exact digests, validates the evaluator result,
 * and stores an immutable SelectionRecord.
 */

import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FoundationAcl, FoundationRevision, FoundationScope } from './ontology-foundation.js';
import type {
  ProblemCandidateRecord,
  ProblemCandidateStore,
  ProblemCandidateStoreContext
} from './problem-candidates.js';
import {
  createJudgmentDAGCompositionDefinition,
  executeJudgmentDAGComposition,
  type JudgmentDAGCompositionDefinition,
  type JudgmentDAGCompositionRunRecord,
  type JudgmentDAGCompositionRunRequest,
  type JudgmentDAGProblemSnapshotReference
} from './judgment-dag-composition.js';
import type { JudgmentDAGJSONValue } from './judgment-dag-runner.js';

export const PROBLEM_SELECTION_CONTRACT_VERSION = 'problem-selection.v1' as const;
export const PROBLEM_SELECTION_RECORD_VERSION = 'problem-selection-record.v1' as const;
export const PROBLEM_SELECTION_DIRECTORY = 'problem-selections' as const;

export type ProblemSelectionAction = 'start' | 'continue' | 'observe' | 'hold' | 'stop';
export type ProblemSelectionStatus = 'selected' | 'human_review_required';
export type ProblemSelectionAssessmentStatus =
  | 'eligible'
  | 'incomparable'
  | 'unavailable'
  | 'unknown';

export interface ProblemSelectionKnown<T> {
  readonly status: 'known';
  readonly value: T;
}

export interface ProblemSelectionUnknown {
  readonly status: 'unknown';
  readonly reason: string;
}

/** Unknown is preserved; it is never converted to zero or an empty value. */
export type ProblemSelectionField<T> = ProblemSelectionKnown<T> | ProblemSelectionUnknown;

export interface ProblemSelectionCostTerms {
  readonly switching: ProblemSelectionField<number>;
  readonly opportunity: ProblemSelectionField<number>;
  readonly exploration: ProblemSelectionField<number>;
}

export interface ProblemSelectionExplorationLimit {
  readonly maxCandidates: number;
  readonly maxExplorationCost: ProblemSelectionField<number>;
}

export interface ProblemSelectionFoundationReference extends FoundationRevision {
  readonly digest: string;
}

export interface ProblemSelectionConditionalPreference {
  readonly id: string;
  readonly condition: string;
  readonly preference: string;
}

export interface ProblemSelectionDelegatedJudgment {
  readonly id: string;
  readonly question: string;
  readonly ownerId: string;
}

/** Conditions fixed by the selection meta Problem before comparison begins. */
export interface ProblemSelectionFixedConditions {
  readonly objectiveRefs: readonly ProblemSelectionFoundationReference[];
  readonly constraintRefs: readonly ProblemSelectionFoundationReference[];
  readonly conditionalPreferences: readonly ProblemSelectionConditionalPreference[];
  readonly delegatedJudgments: readonly ProblemSelectionDelegatedJudgment[];
  readonly costs: ProblemSelectionCostTerms;
  readonly explorationLimit: ProblemSelectionExplorationLimit;
  readonly evaluatedAt: string;
}

export interface ProblemSelectionCandidateReference {
  readonly candidateId: string;
  /** Exact candidate payload identity, excluding mutable review status. */
  readonly payloadDigest: string;
  readonly ownerScope: FoundationScope;
}

export interface ProblemSelectionObjectiveConflict {
  readonly objectiveIds: readonly string[];
  readonly reason: string;
}

export interface ProblemSelectionCandidateInput {
  readonly reference: ProblemSelectionCandidateReference;
  readonly record: ProblemCandidateRecord;
}

export interface ProblemSelectionCandidateAssessment {
  readonly reference: ProblemSelectionCandidateReference;
  readonly status: ProblemSelectionAssessmentStatus;
  readonly action?: ProblemSelectionAction;
  readonly rationale: string;
  readonly ownerId?: string;
  readonly conditions: readonly string[];
  readonly reviewAt?: string;
  readonly costs: ProblemSelectionCostTerms;
  readonly unknowns: readonly ProblemSelectionUnknown[];
  readonly objectiveConflicts: readonly ProblemSelectionObjectiveConflict[];
}

/** Result returned by the versioned DAG composition evaluator. */
export interface ProblemSelectionEvaluationResult {
  readonly status: ProblemSelectionStatus;
  readonly selectedCandidateId?: string;
  readonly action?: ProblemSelectionAction;
  readonly reason: string;
  readonly ownerId?: string;
  readonly conditions?: readonly string[];
  readonly reviewAt?: string;
  readonly assessments?: readonly ProblemSelectionCandidateAssessment[];
  readonly unknowns?: readonly ProblemSelectionUnknown[];
  readonly objectiveConflicts?: readonly ProblemSelectionObjectiveConflict[];
}

export interface ProblemSelectionEvaluationRequest {
  readonly selectionId: string;
  readonly selectionProblem: JudgmentDAGProblemSnapshotReference;
  readonly composition: JudgmentDAGCompositionDefinition;
  readonly candidates: readonly ProblemSelectionCandidateInput[];
  readonly fixedConditions: ProblemSelectionFixedConditions;
}

export interface ProblemSelectionEvaluationPort {
  /** The port may call executeJudgmentDAGComposition; it owns DAG adapters. */
  readonly evaluate: (
    request: ProblemSelectionEvaluationRequest
  ) => ProblemSelectionEvaluationResult | Promise<ProblemSelectionEvaluationResult>;
}

export interface ProblemSelectionProblemCreationRequest {
  readonly status: 'required';
  readonly candidate: ProblemSelectionCandidateReference;
  readonly action: 'start' | 'continue';
  readonly requiredConditions: readonly string[];
  /** The future Problem must complete its own exact snapshot before execution. */
  readonly completeSnapshotRequired: true;
}

export interface ProblemSelectionDecision {
  readonly status: ProblemSelectionStatus;
  readonly candidate?: ProblemSelectionCandidateReference;
  readonly action?: ProblemSelectionAction;
  readonly reason: string;
  readonly ownerId?: string;
  readonly conditions: readonly string[];
  readonly reviewAt?: string;
}

/** Immutable output of one meta-Problem selection run. */
export interface ProblemSelectionRecord {
  readonly recordVersion: typeof PROBLEM_SELECTION_RECORD_VERSION;
  readonly contractVersion: typeof PROBLEM_SELECTION_CONTRACT_VERSION;
  readonly selectionId: string;
  readonly selectionProblem: JudgmentDAGProblemSnapshotReference;
  readonly selectionComposition: JudgmentDAGCompositionDefinition;
  readonly ownerScope: FoundationScope;
  readonly readPolicy: FoundationAcl;
  readonly fixedConditions: ProblemSelectionFixedConditions;
  readonly candidateRefs: readonly ProblemSelectionCandidateReference[];
  readonly assessments: readonly ProblemSelectionCandidateAssessment[];
  /** Conflicts are retained at record level even when the evaluator did not attach them to an assessment. */
  readonly objectiveConflicts: readonly ProblemSelectionObjectiveConflict[];
  /** All unresolved inputs are retained instead of being collapsed into a status string. */
  readonly unknowns: readonly ProblemSelectionUnknown[];
  readonly status: ProblemSelectionStatus;
  readonly decision: ProblemSelectionDecision;
  readonly problemCreationRequest?: ProblemSelectionProblemCreationRequest;
  /** Selection never grants an execution or resource authority. */
  readonly executionPermission: 'none';
  readonly resourceAuthority: 'none';
  /** Selection never changes the Objective definition. */
  readonly objectiveChange: 'none';
  readonly createdAt: string;
}

export type ProblemSelectionRecordId = `sha256:${string}`;

export interface ProblemSelectionRequest {
  readonly selectionId: string;
  readonly selectionProblem: JudgmentDAGProblemSnapshotReference;
  readonly selectionComposition: JudgmentDAGCompositionDefinition;
  readonly ownerScope: FoundationScope;
  readonly readPolicy: FoundationAcl;
  readonly fixedConditions: ProblemSelectionFixedConditions;
  readonly candidateRefs: readonly ProblemSelectionCandidateReference[];
  readonly candidateStore: ProblemCandidateStore;
  readonly candidateContext: ProblemCandidateStoreContext;
  readonly evaluator: ProblemSelectionEvaluationPort;
  readonly createdAt?: string;
}

export interface ProblemSelectionAccessContext {
  readonly principal: string;
  readonly scope?: FoundationScope;
}

export type ProblemSelectionAccessOperation = 'save' | 'read';

export interface ProblemSelectionAccessProvider {
  authorize(input: {
    readonly operation: ProblemSelectionAccessOperation;
    readonly context: ProblemSelectionAccessContext;
    readonly record: ProblemSelectionRecord;
  }): boolean | void | Promise<boolean | void>;
}

export interface SaveProblemSelectionRecordRequest {
  readonly root: string;
  readonly record: ProblemSelectionRecord;
  readonly access?: ProblemSelectionAccessContext;
  readonly accessProvider?: ProblemSelectionAccessProvider;
}

export interface LoadProblemSelectionRecordRequest {
  readonly root: string;
  readonly recordId: string;
  readonly access: ProblemSelectionAccessContext;
  readonly accessProvider?: ProblemSelectionAccessProvider;
}

export interface ProblemSelectionRecordReceipt {
  readonly recordId: ProblemSelectionRecordId;
  readonly recordVersion: typeof PROBLEM_SELECTION_RECORD_VERSION;
  readonly selectionId: string;
  readonly status: 'created' | 'existing';
}

export interface ProblemSelectionRecordStore {
  save(
    record: ProblemSelectionRecord,
    access: ProblemSelectionAccessContext
  ): Promise<ProblemSelectionRecordReceipt>;
  read(
    recordId: string,
    access: ProblemSelectionAccessContext
  ): Promise<ProblemSelectionRecord>;
}

export type ProblemSelectionErrorCode =
  | 'invalid_request'
  | 'candidate_unavailable'
  | 'candidate_scope_violation'
  | 'candidate_revision_conflict'
  | 'comparison_unavailable'
  | 'access_denied'
  | 'not_found'
  | 'invalid_record'
  | 'integrity_mismatch'
  | 'storage_io_error';

export class ProblemSelectionError extends Error {
  readonly code: ProblemSelectionErrorCode;

  constructor(code: ProblemSelectionErrorCode, message: string) {
    super(message);
    this.name = 'ProblemSelectionError';
    this.code = code;
  }
}

const RECORD_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
/** All existing Brainbase content digests are algorithm-qualified. */
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) as number);
  const b = Array.from(right, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function error(code: ProblemSelectionErrorCode, message: string): ProblemSelectionError {
  return new ProblemSelectionError(code, message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw error('invalid_request', `${field} must be a non-empty string without control characters`);
  }
  return value;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) throw error('invalid_request', `${field} must be an ISO timestamp`);
  return timestamp;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw error('invalid_request', `${field} must be a finite non-negative number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw error('invalid_request', `${field}.${key} is not allowed`);
  }
}

function cloneJson(value: unknown, field: string, active: Set<object> = new Set()): JudgmentDAGJSONValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw error('invalid_request', `${field} must contain finite numbers`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw error('invalid_request', `${field} must be JSON-compatible`);
  if (active.has(value)) throw error('invalid_request', `${field} must not contain cycles`);
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry, index) => cloneJson(entry, `${field}[${index}]`, active));
    if (!isPlainRecord(value)) throw error('invalid_request', `${field} must contain plain objects`);
    const result: Record<string, JudgmentDAGJSONValue> = Object.create(null) as Record<string, JudgmentDAGJSONValue>;
    for (const key of Object.keys(value).sort(compareCodePoints)) result[key] = cloneJson(value[key], `${field}.${key}`, active);
    return result;
  } finally {
    active.delete(value);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(cloneJson(value, 'value'));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function normalizeScope(value: unknown, field: string): FoundationScope {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['subjectIds', 'validFrom', 'validUntil'], field);
  if (!Array.isArray(value.subjectIds) || value.subjectIds.length === 0) throw error('invalid_request', `${field}.subjectIds must be non-empty`);
  const subjectIds = value.subjectIds.map((entry, index) => requireString(entry, `${field}.subjectIds[${index}]`));
  if (new Set(subjectIds).size !== subjectIds.length) throw error('invalid_request', `${field}.subjectIds must be unique`);
  const scope: FoundationScope = {
    subjectIds: [...subjectIds].sort(compareCodePoints),
    validFrom: requireIsoTimestamp(value.validFrom, `${field}.validFrom`),
    ...(value.validUntil === undefined ? {} : { validUntil: requireIsoTimestamp(value.validUntil, `${field}.validUntil`) })
  };
  if (scope.validUntil !== undefined && Date.parse(scope.validUntil) < Date.parse(scope.validFrom)) {
    throw error('invalid_request', `${field}.validUntil cannot precede validFrom`);
  }
  return scope;
}

function normalizeAcl(value: unknown, field: string): FoundationAcl {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['ownerId', 'visibility', 'readerIds', 'writerIds'], field);
  const ownerId = requireString(value.ownerId, `${field}.ownerId`);
  if (!['private', 'project', 'organization', 'public'].includes(value.visibility as string)) throw error('invalid_request', `${field}.visibility is invalid`);
  const readIds = (entry: unknown, child: string): readonly string[] => {
    if (!Array.isArray(entry)) throw error('invalid_request', `${child} must be an array`);
    const ids = entry.map((id, index) => requireString(id, `${child}[${index}]`));
    if (new Set(ids).size !== ids.length) throw error('invalid_request', `${child} must be unique`);
    return [...ids].sort(compareCodePoints);
  };
  return {
    ownerId,
    visibility: value.visibility as FoundationAcl['visibility'],
    readerIds: readIds(value.readerIds, `${field}.readerIds`),
    writerIds: readIds(value.writerIds, `${field}.writerIds`)
  };
}

function equalScope(left: FoundationScope, right: FoundationScope): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeDigest(value: unknown, field: string): string {
  const digest = requireString(value, field);
  if (!DIGEST_PATTERN.test(digest)) throw error('invalid_request', `${field} must be a sha256:<64 lowercase hex> digest`);
  return digest;
}

function normalizeSnapshotReference(value: unknown): JudgmentDAGProblemSnapshotReference {
  if (!isPlainRecord(value)) throw error('invalid_request', 'selectionProblem must be an object');
  exactKeys(value, ['snapshot_id', 'problem_id', 'revision'], 'selectionProblem');
  const snapshotId = requireString(value.snapshot_id, 'selectionProblem.snapshot_id');
  if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) throw error('invalid_request', 'selectionProblem.snapshot_id is invalid');
  const revision = requireString(value.revision, 'selectionProblem.revision');
  if (!/^[1-9]\d*$/u.test(revision)) throw error('invalid_request', 'selectionProblem.revision is invalid');
  return { snapshot_id: snapshotId as `sha256:${string}`, problem_id: requireString(value.problem_id, 'selectionProblem.problem_id'), revision };
}

function normalizeFoundationReference(value: unknown, field: string): ProblemSelectionFoundationReference {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['id', 'type', 'revision', 'digest'], field);
  const type = requireString(value.type, `${field}.type`);
  if (!['objective', 'variable', 'model', 'constraint'].includes(type)) throw error('invalid_request', `${field}.type is invalid`);
  const revision = requireString(value.revision, `${field}.revision`);
  if (!/^[1-9]\d*$/u.test(revision)) throw error('invalid_request', `${field}.revision is invalid`);
  return { id: requireString(value.id, `${field}.id`), type: type as FoundationRevision['type'], revision, digest: normalizeDigest(value.digest, `${field}.digest`) };
}

function normalizeKnownOrUnknown<T>(value: unknown, field: string, parse: (value: unknown, field: string) => T): ProblemSelectionField<T> {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['status', 'value', 'reason'], field);
  if (value.status === 'unknown') return { status: 'unknown', reason: requireString(value.reason, `${field}.reason`) };
  if (value.status !== 'known') throw error('invalid_request', `${field}.status is invalid`);
  return { status: 'known', value: parse(value.value, `${field}.value`) };
}

function parseNumber(value: unknown, field: string): number { return requireFiniteNumber(value, field); }

function normalizeCosts(value: unknown, field: string): ProblemSelectionCostTerms {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['switching', 'opportunity', 'exploration'], field);
  return {
    switching: normalizeKnownOrUnknown(value.switching, `${field}.switching`, parseNumber),
    opportunity: normalizeKnownOrUnknown(value.opportunity, `${field}.opportunity`, parseNumber),
    exploration: normalizeKnownOrUnknown(value.exploration, `${field}.exploration`, parseNumber)
  };
}

function normalizeConditions(value: unknown): ProblemSelectionFixedConditions {
  if (!isPlainRecord(value)) throw error('invalid_request', 'fixedConditions must be an object');
  exactKeys(value, ['objectiveRefs', 'constraintRefs', 'conditionalPreferences', 'delegatedJudgments', 'costs', 'explorationLimit', 'evaluatedAt'], 'fixedConditions');
  if (!Array.isArray(value.objectiveRefs) || !Array.isArray(value.constraintRefs)) throw error('invalid_request', 'fixedConditions references must be arrays');
  const objectiveRefs = value.objectiveRefs.map((entry, index) => normalizeFoundationReference(entry, `fixedConditions.objectiveRefs[${index}]`));
  const constraintRefs = value.constraintRefs.map((entry, index) => normalizeFoundationReference(entry, `fixedConditions.constraintRefs[${index}]`));
  if (objectiveRefs.some((entry) => entry.type !== 'objective')) throw error('invalid_request', 'objectiveRefs must reference Objectives');
  if (constraintRefs.some((entry) => entry.type !== 'constraint')) throw error('invalid_request', 'constraintRefs must reference Constraints');
  const parseList = (entry: unknown, field: string): readonly Record<string, string>[] => {
    if (!Array.isArray(entry)) throw error('invalid_request', `${field} must be an array`);
    return entry.map((item, index) => {
      if (!isPlainRecord(item)) throw error('invalid_request', `${field}[${index}] must be an object`);
      return item as Record<string, string>;
    });
  };
  const conditionalPreferences = parseList(value.conditionalPreferences, 'fixedConditions.conditionalPreferences').map((item, index) => {
    exactKeys(item, ['id', 'condition', 'preference'], `fixedConditions.conditionalPreferences[${index}]`);
    return { id: requireString(item.id, `fixedConditions.conditionalPreferences[${index}].id`), condition: requireString(item.condition, `fixedConditions.conditionalPreferences[${index}].condition`), preference: requireString(item.preference, `fixedConditions.conditionalPreferences[${index}].preference`) };
  });
  const delegatedJudgments = parseList(value.delegatedJudgments, 'fixedConditions.delegatedJudgments').map((item, index) => {
    exactKeys(item, ['id', 'question', 'ownerId'], `fixedConditions.delegatedJudgments[${index}]`);
    return { id: requireString(item.id, `fixedConditions.delegatedJudgments[${index}].id`), question: requireString(item.question, `fixedConditions.delegatedJudgments[${index}].question`), ownerId: requireString(item.ownerId, `fixedConditions.delegatedJudgments[${index}].ownerId`) };
  });
  if (!isPlainRecord(value.explorationLimit)) throw error('invalid_request', 'fixedConditions.explorationLimit must be an object');
  exactKeys(value.explorationLimit, ['maxCandidates', 'maxExplorationCost'], 'fixedConditions.explorationLimit');
  const maxCandidates = requireFiniteNumber(value.explorationLimit.maxCandidates, 'fixedConditions.explorationLimit.maxCandidates');
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw error('invalid_request', 'maxCandidates must be a positive integer');
  return deepFreeze({
    objectiveRefs,
    constraintRefs,
    conditionalPreferences,
    delegatedJudgments,
    costs: normalizeCosts(value.costs, 'fixedConditions.costs'),
    explorationLimit: { maxCandidates, maxExplorationCost: normalizeKnownOrUnknown(value.explorationLimit.maxExplorationCost, 'fixedConditions.explorationLimit.maxExplorationCost', parseNumber) },
    evaluatedAt: requireIsoTimestamp(value.evaluatedAt, 'fixedConditions.evaluatedAt')
  });
}

function normalizeCandidateReference(value: unknown, field: string): ProblemSelectionCandidateReference {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['candidateId', 'payloadDigest', 'ownerScope'], field);
  return deepFreeze({
    candidateId: requireString(value.candidateId, `${field}.candidateId`),
    payloadDigest: normalizeDigest(value.payloadDigest, `${field}.payloadDigest`),
    ownerScope: normalizeScope(value.ownerScope, `${field}.ownerScope`)
  });
}

function normalizeUnknowns(value: unknown, field: string): readonly ProblemSelectionUnknown[] {
  if (!Array.isArray(value)) throw error('invalid_record', `${field} must be an array`);
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw error('invalid_record', `${field}[${index}] must be an object`);
    exactKeys(entry, ['status', 'reason'], `${field}[${index}]`);
    if (entry.status !== 'unknown') throw error('invalid_record', `${field}[${index}].status must be unknown`);
    return { status: 'unknown' as const, reason: requireString(entry.reason, `${field}[${index}].reason`) };
  });
}

function normalizeObjectiveConflicts(value: unknown, field: string): readonly ProblemSelectionObjectiveConflict[] {
  if (!Array.isArray(value)) throw error('invalid_record', `${field} must be an array`);
  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) throw error('invalid_record', `${field}[${index}] must be an object`);
    exactKeys(entry, ['objectiveIds', 'reason'], `${field}[${index}]`);
    if (!Array.isArray(entry.objectiveIds)) throw error('invalid_record', `${field}[${index}].objectiveIds must be an array`);
    return {
      objectiveIds: entry.objectiveIds.map((id, idIndex) => requireString(id, `${field}[${index}].objectiveIds[${idIndex}]`)),
      reason: requireString(entry.reason, `${field}[${index}].reason`)
    };
  });
}

function normalizeRecordCandidateAssessment(value: unknown, field: string): ProblemSelectionCandidateAssessment {
  if (!isPlainRecord(value)) throw error('invalid_request', `${field} must be an object`);
  exactKeys(value, ['reference', 'status', 'action', 'rationale', 'ownerId', 'conditions', 'reviewAt', 'costs', 'unknowns', 'objectiveConflicts'], field);
  const status = value.status as ProblemSelectionAssessmentStatus;
  if (!['eligible', 'incomparable', 'unavailable', 'unknown'].includes(status)) throw error('invalid_request', `${field}.status is invalid`);
  const conditions = value.conditions === undefined ? [] : value.conditions;
  if (!Array.isArray(conditions)) throw error('invalid_request', `${field}.conditions must be an array`);
  const unknowns = value.unknowns === undefined ? [] : value.unknowns;
  if (!Array.isArray(unknowns)) throw error('invalid_request', `${field}.unknowns must be an array`);
  const parsedUnknowns = unknowns.map((entry, index) => {
    if (!isPlainRecord(entry)) throw error('invalid_request', `${field}.unknowns[${index}] must be an object`);
    exactKeys(entry, ['status', 'reason'], `${field}.unknowns[${index}]`);
    if (entry.status !== 'unknown') throw error('invalid_request', `${field}.unknowns[${index}].status must be unknown`);
    return { status: 'unknown' as const, reason: requireString(entry.reason, `${field}.unknowns[${index}].reason`) };
  });
  const conflicts = value.objectiveConflicts === undefined ? [] : value.objectiveConflicts;
  if (!Array.isArray(conflicts)) throw error('invalid_request', `${field}.objectiveConflicts must be an array`);
  const parsedConflicts = conflicts.map((entry, index) => {
    if (!isPlainRecord(entry)) throw error('invalid_request', `${field}.objectiveConflicts[${index}] must be an object`);
    exactKeys(entry, ['objectiveIds', 'reason'], `${field}.objectiveConflicts[${index}]`);
    if (!Array.isArray(entry.objectiveIds)) throw error('invalid_request', `${field}.objectiveConflicts[${index}].objectiveIds must be an array`);
    return { objectiveIds: entry.objectiveIds.map((id, idIndex) => requireString(id, `${field}.objectiveConflicts[${index}].objectiveIds[${idIndex}]`)), reason: requireString(entry.reason, `${field}.objectiveConflicts[${index}].reason`) };
  });
  return deepFreeze({
    reference: normalizeCandidateReference(value.reference, `${field}.reference`),
    status,
    ...(value.action === undefined ? {} : { action: requireAction(value.action, `${field}.action`) }),
    rationale: requireString(value.rationale, `${field}.rationale`),
    ...(value.ownerId === undefined ? {} : { ownerId: requireString(value.ownerId, `${field}.ownerId`) }),
    conditions: conditions.map((entry, index) => requireString(entry, `${field}.conditions[${index}]`)),
    ...(value.reviewAt === undefined ? {} : { reviewAt: requireIsoTimestamp(value.reviewAt, `${field}.reviewAt`) }),
    costs: normalizeCosts(value.costs, `${field}.costs`),
    unknowns: parsedUnknowns,
    objectiveConflicts: parsedConflicts
  });
}

function requireAction(value: unknown, field: string): ProblemSelectionAction {
  if (!['start', 'continue', 'observe', 'hold', 'stop'].includes(value as string)) throw error('invalid_request', `${field} is invalid`);
  return value as ProblemSelectionAction;
}

function assertCandidateReferencesUnique(refs: readonly ProblemSelectionCandidateReference[]): void {
  const ids = refs.map((ref) => ref.candidateId);
  if (new Set(ids).size !== ids.length) throw error('invalid_request', 'candidateRefs must not contain duplicates');
}

function assessableCandidate(
  reference: ProblemSelectionCandidateReference,
  costs: ProblemSelectionCostTerms
): ProblemSelectionCandidateAssessment {
  return { reference, status: 'eligible', rationale: 'candidate resolved and its exact digest is current', conditions: [], costs, unknowns: [], objectiveConflicts: [] };
}

function reviewAssessment(reference: ProblemSelectionCandidateReference, reason: string, costs: ProblemSelectionCostTerms): ProblemSelectionCandidateAssessment {
  return { reference, status: 'unavailable', rationale: reason, conditions: [], costs, unknowns: [{ status: 'unknown', reason }], objectiveConflicts: [] };
}

function assertReviewAt(decision: ProblemSelectionDecision): void {
  if (decision.action === 'hold' && decision.reviewAt === undefined) throw error('invalid_request', 'hold decisions require reviewAt');
}

function normalizeEvaluationResult(
  raw: ProblemSelectionEvaluationResult,
  candidateRefs: readonly ProblemSelectionCandidateReference[],
  fixedConditions: ProblemSelectionFixedConditions
): ProblemSelectionEvaluationResult {
  if (!isPlainRecord(raw)) throw error('comparison_unavailable', 'selection evaluator returned a non-object result');
  exactKeys(raw, ['status', 'selectedCandidateId', 'action', 'reason', 'ownerId', 'conditions', 'reviewAt', 'assessments', 'unknowns', 'objectiveConflicts'], 'evaluation result');
  const status = raw.status;
  if (status !== 'selected' && status !== 'human_review_required') throw error('comparison_unavailable', 'selection evaluator returned an invalid status');
  const reason = requireString(raw.reason, 'evaluation result.reason');
  const selectedCandidateId = raw.selectedCandidateId === undefined ? undefined : requireString(raw.selectedCandidateId, 'evaluation result.selectedCandidateId');
  if (selectedCandidateId !== undefined && !candidateRefs.some((ref) => ref.candidateId === selectedCandidateId)) throw error('comparison_unavailable', 'evaluator selected a candidate outside the fixed candidate set');
  const action = raw.action === undefined ? undefined : requireAction(raw.action, 'evaluation result.action');
  if (status === 'selected' && (selectedCandidateId === undefined || action === undefined)) {
    throw error('comparison_unavailable', 'selected evaluation must include selectedCandidateId and action');
  }
  const conditions = raw.conditions === undefined ? [] : raw.conditions;
  if (!Array.isArray(conditions)) throw error('comparison_unavailable', 'evaluation result.conditions must be an array');
  const unknowns = raw.unknowns === undefined ? [] : raw.unknowns;
  if (!Array.isArray(unknowns)) throw error('comparison_unavailable', 'evaluation result.unknowns must be an array');
  const parsedUnknowns = unknowns.map((entry, index) => {
    if (!isPlainRecord(entry) || entry.status !== 'unknown') throw error('comparison_unavailable', `evaluation result.unknowns[${index}] is invalid`);
    return { status: 'unknown' as const, reason: requireString(entry.reason, `evaluation result.unknowns[${index}].reason`) };
  });
  const conflicts = raw.objectiveConflicts === undefined ? [] : raw.objectiveConflicts;
  if (!Array.isArray(conflicts)) throw error('comparison_unavailable', 'evaluation result.objectiveConflicts must be an array');
  const parsedConflicts = conflicts.map((entry, index) => {
    if (!isPlainRecord(entry) || !Array.isArray(entry.objectiveIds)) throw error('comparison_unavailable', `evaluation result.objectiveConflicts[${index}] is invalid`);
    return { objectiveIds: entry.objectiveIds.map((id, idIndex) => requireString(id, `evaluation result.objectiveConflicts[${index}].objectiveIds[${idIndex}]`)), reason: requireString(entry.reason, `evaluation result.objectiveConflicts[${index}].reason`) };
  });
  const assessments = raw.assessments === undefined
    ? candidateRefs.map((ref) => assessableCandidate(ref, fixedConditions.costs))
    : raw.assessments.map((entry, index) => normalizeRecordCandidateAssessment(entry, `evaluation result.assessments[${index}]`));
  if (assessments.length !== candidateRefs.length) throw error('comparison_unavailable', 'evaluator must return one assessment per candidate');
  for (const ref of candidateRefs) {
    const assessment = assessments.find((item) => item.reference.candidateId === ref.candidateId);
    if (assessment === undefined) throw error('comparison_unavailable', `evaluator omitted assessment for ${ref.candidateId}`);
    if (canonicalJson(assessment.reference) !== canonicalJson(ref)) {
      throw error('comparison_unavailable', `evaluator changed the fixed reference for ${ref.candidateId}`);
    }
  }
  return deepFreeze({
    status,
    ...(selectedCandidateId === undefined ? {} : { selectedCandidateId }),
    ...(action === undefined ? {} : { action }),
    reason,
    ...(raw.ownerId === undefined ? {} : { ownerId: requireString(raw.ownerId, 'evaluation result.ownerId') }),
    conditions: conditions.map((entry, index) => requireString(entry, `evaluation result.conditions[${index}]`)),
    ...(raw.reviewAt === undefined ? {} : { reviewAt: requireIsoTimestamp(raw.reviewAt, 'evaluation result.reviewAt') }),
    assessments,
    unknowns: parsedUnknowns,
    objectiveConflicts: parsedConflicts
  });
}

function canonicalCandidateDigest(record: ProblemCandidateRecord): string {
  return record.payloadDigest;
}

function decisionFromEvaluation(
  result: ProblemSelectionEvaluationResult,
  candidateRefs: readonly ProblemSelectionCandidateReference[],
  assessments: readonly ProblemSelectionCandidateAssessment[]
): ProblemSelectionDecision {
  const candidate = result.selectedCandidateId === undefined ? undefined : candidateRefs.find((ref) => ref.candidateId === result.selectedCandidateId);
  const assessment = candidate === undefined ? undefined : assessments.find((item) => item.reference.candidateId === candidate.candidateId);
  const status = result.status;
  const decision: ProblemSelectionDecision = {
    status,
    ...(candidate === undefined ? {} : { candidate }),
    ...(result.action === undefined ? {} : { action: result.action }),
    reason: result.reason,
    ...(result.ownerId === undefined ? {} : { ownerId: result.ownerId }),
    conditions: result.conditions ?? [],
    ...(result.reviewAt === undefined ? {} : { reviewAt: result.reviewAt })
  };
  if (assessment?.status === 'incomparable' || assessment?.status === 'unavailable') {
    return { ...decision, status: 'human_review_required', reason: `${result.reason}; selected candidate is not comparable or available` };
  }
  assertReviewAt(decision);
  return decision;
}

function fixedUnknowns(fixed: ProblemSelectionFixedConditions): readonly ProblemSelectionUnknown[] {
  const unknowns: ProblemSelectionUnknown[] = [];
  for (const [key, value] of Object.entries(fixed.costs)) if ((value as ProblemSelectionField<number>).status === 'unknown') unknowns.push(value as ProblemSelectionUnknown);
  if (fixed.explorationLimit.maxExplorationCost.status === 'unknown') unknowns.push(fixed.explorationLimit.maxExplorationCost);
  return unknowns;
}

/**
 * Resolve candidates and create one immutable selection record. Candidate
 * bodies are used only inside the evaluator call and are never copied into
 * the record; the record keeps exact candidate references and digests.
 */
export async function createProblemSelection(request: ProblemSelectionRequest): Promise<ProblemSelectionRecord> {
  if (!isPlainRecord(request)) throw error('invalid_request', 'selection request must be an object');
  const selectionId = requireString(request.selectionId, 'selectionId');
  const selectionProblem = normalizeSnapshotReference(request.selectionProblem);
  const composition = createJudgmentDAGCompositionDefinition(request.selectionComposition);
  const ownerScope = normalizeScope(request.ownerScope, 'ownerScope');
  const readPolicy = normalizeAcl(request.readPolicy, 'readPolicy');
  const fixedConditions = normalizeConditions(request.fixedConditions);
  if (!Array.isArray(request.candidateRefs)) throw error('invalid_request', 'candidateRefs must be an array');
  const candidateRefs = request.candidateRefs.map((entry, index) => normalizeCandidateReference(entry, `candidateRefs[${index}]`));
  assertCandidateReferencesUnique(candidateRefs);
  if (candidateRefs.length === 0) throw error('invalid_request', 'candidateRefs must contain at least one candidate');
  if (candidateRefs.length > fixedConditions.explorationLimit.maxCandidates) {
    const reason = `candidate count ${candidateRefs.length} exceeds the fixed exploration limit ${fixedConditions.explorationLimit.maxCandidates}`;
    return deepFreeze({
      recordVersion: PROBLEM_SELECTION_RECORD_VERSION,
      contractVersion: PROBLEM_SELECTION_CONTRACT_VERSION,
      selectionId,
      selectionProblem,
      selectionComposition: composition,
      ownerScope,
      readPolicy,
      fixedConditions,
      candidateRefs,
      assessments: candidateRefs.map((ref) => reviewAssessment(ref, reason, fixedConditions.costs)),
      objectiveConflicts: [],
      unknowns: [],
      status: 'human_review_required',
      decision: { status: 'human_review_required', reason, conditions: [] },
      executionPermission: 'none',
      resourceAuthority: 'none',
      objectiveChange: 'none',
      createdAt: request.createdAt === undefined ? new Date().toISOString() : requireIsoTimestamp(request.createdAt, 'createdAt')
    });
  }
  if (!request.candidateStore || typeof request.candidateStore.readCandidate !== 'function') throw error('invalid_request', 'candidateStore.readCandidate is required');
  const resolved: ProblemSelectionCandidateInput[] = [];
  const assessments: ProblemSelectionCandidateAssessment[] = [];
  let resolutionFailure = false;
  for (const reference of candidateRefs) {
    try {
      const record = await request.candidateStore.readCandidate(reference.candidateId, request.candidateContext);
      if (record === null) {
        resolutionFailure = true;
        assessments.push(reviewAssessment(reference, 'candidate is unavailable under the current access policy', fixedConditions.costs));
        continue;
      }
      if (record.status !== 'candidate') {
        resolutionFailure = true;
        assessments.push(reviewAssessment(reference, `candidate status ${record.status} is not selectable`, fixedConditions.costs));
        continue;
      }
      if (canonicalCandidateDigest(record) !== reference.payloadDigest) {
        resolutionFailure = true;
        assessments.push(reviewAssessment(reference, 'candidate payload digest no longer matches the fixed selection input', fixedConditions.costs));
        continue;
      }
      if (!equalScope(record.ownerScope, reference.ownerScope)) {
        resolutionFailure = true;
        assessments.push(reviewAssessment(reference, 'candidate owner scope no longer matches the fixed selection input', fixedConditions.costs));
        continue;
      }
      resolved.push({ reference, record });
      assessments.push(assessableCandidate(reference, fixedConditions.costs));
    } catch (cause) {
      resolutionFailure = true;
      const message = cause instanceof Error ? cause.message : 'candidate access failed';
      assessments.push(reviewAssessment(reference, `candidate access could not be verified: ${message}`, fixedConditions.costs));
    }
  }
  if (resolutionFailure) {
    const reason = 'one or more candidates could not be resolved with their fixed digest and current access';
    return deepFreeze({
      recordVersion: PROBLEM_SELECTION_RECORD_VERSION,
      contractVersion: PROBLEM_SELECTION_CONTRACT_VERSION,
      selectionId,
      selectionProblem,
      selectionComposition: composition,
      ownerScope,
      readPolicy,
      fixedConditions,
      candidateRefs,
      assessments,
      objectiveConflicts: [],
      unknowns: [],
      status: 'human_review_required',
      decision: { status: 'human_review_required', reason, conditions: [] },
      executionPermission: 'none',
      resourceAuthority: 'none',
      objectiveChange: 'none',
      createdAt: request.createdAt === undefined ? new Date().toISOString() : requireIsoTimestamp(request.createdAt, 'createdAt')
    });
  }
  let evaluation: ProblemSelectionEvaluationResult;
  try {
    if (!request.evaluator || typeof request.evaluator.evaluate !== 'function') throw new Error('evaluator.evaluate is required');
    evaluation = normalizeEvaluationResult(
      await request.evaluator.evaluate({ selectionId, selectionProblem, composition, candidates: resolved, fixedConditions }),
      candidateRefs,
      fixedConditions
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'comparison evaluator failed';
    evaluation = {
      status: 'human_review_required',
      reason: `comparison could not be completed: ${message}`,
      assessments,
      unknowns: [{ status: 'unknown', reason: message }],
      objectiveConflicts: []
    };
  }
  const normalizedAssessments = evaluation.assessments ?? assessments;
  const anyConflict = normalizedAssessments.some((item) => item.objectiveConflicts.length > 0) || (evaluation.objectiveConflicts?.length ?? 0) > 0;
  const unknowns = [...(evaluation.unknowns ?? []), ...fixedUnknowns(fixedConditions), ...normalizedAssessments.flatMap((item) => item.unknowns)];
  const objectiveConflicts = [...(evaluation.objectiveConflicts ?? []), ...normalizedAssessments.flatMap((item) => item.objectiveConflicts)];
  const hasUnavailable = normalizedAssessments.some((item) => item.status === 'unavailable' || item.status === 'incomparable');
  const selectedObserve = evaluation.action === 'observe';
  const shouldRequireReview = evaluation.status === 'human_review_required' || anyConflict || hasUnavailable || (unknowns.length > 0 && !selectedObserve);
  const effectiveEvaluation: ProblemSelectionEvaluationResult = shouldRequireReview && evaluation.status !== 'human_review_required'
    ? { ...evaluation, status: 'human_review_required', reason: anyConflict ? `${evaluation.reason}; objective criteria are incomparable` : unknowns.length > 0 ? `${evaluation.reason}; unresolved unknowns remain` : `${evaluation.reason}; comparison is not fully available` }
    : evaluation;
  const decision = decisionFromEvaluation(effectiveEvaluation, candidateRefs, normalizedAssessments);
  const problemCreationRequest = decision.status === 'selected' && (decision.action === 'start' || decision.action === 'continue') && decision.candidate !== undefined
    ? { status: 'required' as const, candidate: decision.candidate, action: decision.action, requiredConditions: decision.conditions, completeSnapshotRequired: true as const }
    : undefined;
  return deepFreeze({
    recordVersion: PROBLEM_SELECTION_RECORD_VERSION,
    contractVersion: PROBLEM_SELECTION_CONTRACT_VERSION,
    selectionId,
    selectionProblem,
    selectionComposition: composition,
    ownerScope,
    readPolicy,
    fixedConditions,
    candidateRefs,
    assessments: normalizedAssessments,
    objectiveConflicts,
    unknowns,
    status: decision.status,
    decision,
    ...(problemCreationRequest === undefined ? {} : { problemCreationRequest }),
    executionPermission: 'none',
    resourceAuthority: 'none',
    objectiveChange: 'none',
    createdAt: request.createdAt === undefined ? new Date().toISOString() : requireIsoTimestamp(request.createdAt, 'createdAt')
  });
}

/** Alias for callers that name the operation as a run. */
export const runProblemSelection = createProblemSelection;
/** Alias for callers that name the operation as a selection. */
export const selectProblem = createProblemSelection;

/**
 * Adapter helper for a composition whose designated child returns the
 * selection contract in its conclusion. The meta Problem remains the exact
 * snapshot supplied to the composition request; a selected candidate still
 * requires a later Problem creation request.
 */
export async function evaluateProblemSelectionWithComposition(input: {
  readonly compositionRequest: JudgmentDAGCompositionRunRequest;
  readonly resultInvocationId?: string;
}): Promise<ProblemSelectionEvaluationResult> {
  let run: JudgmentDAGCompositionRunRecord;
  try {
    run = await executeJudgmentDAGComposition(input.compositionRequest);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'DAG composition failed';
    return { status: 'human_review_required', reason: `selection composition unavailable: ${reason}`, unknowns: [{ status: 'unknown', reason }], objectiveConflicts: [] };
  }
  if (run.status !== 'completed') {
    const reason = `selection composition status is ${run.status}`;
    return { status: 'human_review_required', reason, unknowns: [{ status: 'unknown', reason }], objectiveConflicts: [] };
  }
  const child = input.resultInvocationId === undefined
    ? run.children[run.children.length - 1]
    : run.children.find((entry) => entry.invocation_id === input.resultInvocationId);
  if (child === undefined) return { status: 'human_review_required', reason: 'selection composition returned no designated result child', unknowns: [{ status: 'unknown', reason: 'missing selection result child' }], objectiveConflicts: [] };
  if (child.result.status !== 'completed' || !isPlainRecord(child.result.conclusion)) {
    const reason = child.result.reason ?? `selection child status is ${child.result.status}`;
    return { status: 'human_review_required', reason, unknowns: [{ status: 'unknown', reason }], objectiveConflicts: [] };
  }
  return child.result.conclusion as unknown as ProblemSelectionEvaluationResult;
}

function selectionRecordPayload(record: ProblemSelectionRecord): ProblemSelectionRecord {
  return record;
}

function recordIdForPayload(record: ProblemSelectionRecord): ProblemSelectionRecordId {
  const digest = createHash('sha256').update(canonicalJson(selectionRecordPayload(record))).digest('hex');
  return `sha256:${digest}`;
}

export function computeProblemSelectionRecordId(record: ProblemSelectionRecord): ProblemSelectionRecordId {
  validateProblemSelectionRecord(record);
  return recordIdForPayload(record);
}

function defaultAuthorize(operation: ProblemSelectionAccessOperation, context: ProblemSelectionAccessContext, record: ProblemSelectionRecord): boolean {
  const acl = record.readPolicy;
  if (operation === 'save') return context.principal === acl.ownerId || acl.writerIds.includes(context.principal);
  if (acl.visibility === 'public') return true;
  if (context.principal === acl.ownerId || acl.readerIds.includes(context.principal) || acl.writerIds.includes(context.principal)) return true;
  return acl.visibility === 'organization' && context.scope !== undefined && equalScope(context.scope, record.ownerScope);
}

async function authorize(
  provider: ProblemSelectionAccessProvider | undefined,
  operation: ProblemSelectionAccessOperation,
  context: ProblemSelectionAccessContext,
  record: ProblemSelectionRecord
): Promise<void> {
  const allowed = provider === undefined
    ? defaultAuthorize(operation, context, record)
    : await provider.authorize({ operation, context, record });
  if (allowed !== undefined && !allowed) throw error('access_denied', `problem selection ${operation} is not authorized`);
}

function assertRoot(root: unknown): string {
  if (typeof root !== 'string' || root.trim().length === 0) throw error('invalid_request', 'root is required');
  return path.resolve(root);
}

function directory(root: string): string { return path.join(root, PROBLEM_SELECTION_DIRECTORY); }

function locator(root: string, recordId: ProblemSelectionRecordId): string {
  return path.join(directory(root), `${recordId.slice('sha256:'.length)}.json`);
}

async function regularFile(file: string): Promise<string> {
  try {
    const stats = await lstat(file);
    if (!stats.isFile()) throw error('integrity_mismatch', 'selection record path is not a regular file');
    return await readFile(file, 'utf8');
  } catch (cause) {
    if (cause instanceof ProblemSelectionError) throw cause;
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw error('not_found', 'selection record was not found');
    throw error('storage_io_error', 'selection record could not be read');
  }
}

async function ensureDirectory(root: string): Promise<string> {
  const target = directory(root);
  try {
    await mkdir(target, { recursive: true, mode: 0o700 });
    const stats = await lstat(target);
    if (!stats.isDirectory()) throw error('storage_io_error', 'selection record directory is not a directory');
    return target;
  } catch (cause) {
    if (cause instanceof ProblemSelectionError) throw cause;
    throw error('storage_io_error', 'selection record directory could not be prepared');
  }
}

function validateProblemSelectionRecord(value: unknown): ProblemSelectionRecord {
  if (!isPlainRecord(value)) throw error('invalid_record', 'selection record must be a plain object');
  exactKeys(value, ['recordVersion', 'contractVersion', 'selectionId', 'selectionProblem', 'selectionComposition', 'ownerScope', 'readPolicy', 'fixedConditions', 'candidateRefs', 'assessments', 'objectiveConflicts', 'unknowns', 'status', 'decision', 'problemCreationRequest', 'executionPermission', 'resourceAuthority', 'objectiveChange', 'createdAt'], 'record');
  if (value.recordVersion !== PROBLEM_SELECTION_RECORD_VERSION || value.contractVersion !== PROBLEM_SELECTION_CONTRACT_VERSION) throw error('invalid_record', 'selection record version is unsupported');
  const selectionId = requireString(value.selectionId, 'record.selectionId');
  const selectionProblem = normalizeSnapshotReference(value.selectionProblem);
  const selectionComposition = createJudgmentDAGCompositionDefinition(value.selectionComposition);
  const ownerScope = normalizeScope(value.ownerScope, 'record.ownerScope');
  const readPolicy = normalizeAcl(value.readPolicy, 'record.readPolicy');
  const fixedConditions = normalizeConditions(value.fixedConditions);
  if (!Array.isArray(value.candidateRefs) || !Array.isArray(value.assessments)) throw error('invalid_record', 'record candidate arrays are invalid');
  const candidateRefs = value.candidateRefs.map((entry, index) => normalizeCandidateReference(entry, `record.candidateRefs[${index}]`));
  assertCandidateReferencesUnique(candidateRefs);
  const assessments = value.assessments.map((entry, index) => normalizeRecordCandidateAssessment(entry, `record.assessments[${index}]`));
  if (assessments.length !== candidateRefs.length) throw error('invalid_record', 'record assessments do not match candidates');
  for (const ref of candidateRefs) {
    const assessment = assessments.find((item) => item.reference.candidateId === ref.candidateId);
    if (assessment === undefined || canonicalJson(assessment.reference) !== canonicalJson(ref)) {
      throw error('invalid_record', `record assessment reference does not match ${ref.candidateId}`);
    }
  }
  const objectiveConflicts = normalizeObjectiveConflicts(value.objectiveConflicts, 'record.objectiveConflicts');
  const unknowns = normalizeUnknowns(value.unknowns, 'record.unknowns');
  if (value.status !== 'selected' && value.status !== 'human_review_required') throw error('invalid_record', 'record.status is invalid');
  if (value.executionPermission !== 'none' || value.resourceAuthority !== 'none' || value.objectiveChange !== 'none') throw error('invalid_record', 'selection record cannot carry authority');
  if (!isPlainRecord(value.decision)) throw error('invalid_record', 'record.decision is invalid');
  exactKeys(value.decision, ['status', 'candidate', 'action', 'reason', 'ownerId', 'conditions', 'reviewAt'], 'record.decision');
  const decisionStatus = value.decision.status;
  if (decisionStatus !== value.status) throw error('invalid_record', 'record decision status must match record status');
  const decision: ProblemSelectionDecision = {
    status: decisionStatus as ProblemSelectionStatus,
    ...(value.decision.candidate === undefined ? {} : { candidate: normalizeCandidateReference(value.decision.candidate, 'record.decision.candidate') }),
    ...(value.decision.action === undefined ? {} : { action: requireAction(value.decision.action, 'record.decision.action') }),
    reason: requireString(value.decision.reason, 'record.decision.reason'),
    ...(value.decision.ownerId === undefined ? {} : { ownerId: requireString(value.decision.ownerId, 'record.decision.ownerId') }),
    conditions: Array.isArray(value.decision.conditions) ? value.decision.conditions.map((entry, index) => requireString(entry, `record.decision.conditions[${index}]`)) : (() => { throw error('invalid_record', 'record.decision.conditions is invalid'); })(),
    ...(value.decision.reviewAt === undefined ? {} : { reviewAt: requireIsoTimestamp(value.decision.reviewAt, 'record.decision.reviewAt') })
  };
  assertReviewAt(decision);
  if (decision.candidate !== undefined
    && !candidateRefs.some((ref) => canonicalJson(ref) === canonicalJson(decision.candidate))) {
    throw error('invalid_record', 'record.decision.candidate is outside the fixed candidate set');
  }
  let problemCreationRequest: ProblemSelectionProblemCreationRequest | undefined;
  if (value.problemCreationRequest !== undefined) {
    if (!isPlainRecord(value.problemCreationRequest)) throw error('invalid_record', 'record.problemCreationRequest is invalid');
    exactKeys(value.problemCreationRequest, ['status', 'candidate', 'action', 'requiredConditions', 'completeSnapshotRequired'], 'record.problemCreationRequest');
    if (value.problemCreationRequest.status !== 'required' || value.problemCreationRequest.completeSnapshotRequired !== true) throw error('invalid_record', 'problemCreationRequest flags are invalid');
    const action = requireAction(value.problemCreationRequest.action, 'record.problemCreationRequest.action');
    if (action !== 'start' && action !== 'continue') throw error('invalid_record', 'problemCreationRequest action is invalid');
    if (!Array.isArray(value.problemCreationRequest.requiredConditions)) throw error('invalid_record', 'problemCreationRequest.requiredConditions is invalid');
    problemCreationRequest = { status: 'required', candidate: normalizeCandidateReference(value.problemCreationRequest.candidate, 'record.problemCreationRequest.candidate'), action, requiredConditions: value.problemCreationRequest.requiredConditions.map((entry, index) => requireString(entry, `record.problemCreationRequest.requiredConditions[${index}]`)), completeSnapshotRequired: true };
    if (value.status !== 'selected' || decision.candidate === undefined
      || canonicalJson(problemCreationRequest.candidate) !== canonicalJson(decision.candidate)
      || decision.action !== problemCreationRequest.action) {
      throw error('invalid_record', 'problemCreationRequest must match a selected decision');
    }
  }
  return deepFreeze({
    recordVersion: PROBLEM_SELECTION_RECORD_VERSION,
    contractVersion: PROBLEM_SELECTION_CONTRACT_VERSION,
    selectionId,
    selectionProblem,
    selectionComposition,
    ownerScope,
    readPolicy,
    fixedConditions,
    candidateRefs,
    assessments,
    objectiveConflicts,
    unknowns,
    status: value.status as ProblemSelectionStatus,
    decision,
    ...(problemCreationRequest === undefined ? {} : { problemCreationRequest }),
    executionPermission: 'none',
    resourceAuthority: 'none',
    objectiveChange: 'none',
    createdAt: requireIsoTimestamp(value.createdAt, 'record.createdAt')
  });
}

function envelope(recordId: ProblemSelectionRecordId, record: ProblemSelectionRecord): Record<string, unknown> {
  return { recordId, recordVersion: PROBLEM_SELECTION_RECORD_VERSION, record };
}

export async function saveProblemSelectionRecord(request: SaveProblemSelectionRecordRequest): Promise<ProblemSelectionRecordReceipt> {
  if (!isPlainRecord(request)) throw error('invalid_request', 'save request must be an object');
  const root = assertRoot(request.root);
  const record = validateProblemSelectionRecord(request.record);
  const access = request.access ?? { principal: record.readPolicy.ownerId };
  await authorize(request.accessProvider, 'save', access, record);
  const recordId = recordIdForPayload(record);
  const targetDirectory = await ensureDirectory(root);
  const file = locator(root, recordId);
  const bytes = `${canonicalJson(envelope(recordId, record))}\n`;
  try {
    const existing = await regularFile(file);
    if (existing !== bytes) throw error('integrity_mismatch', 'existing selection record bytes do not match its content address');
    return { recordId, recordVersion: PROBLEM_SELECTION_RECORD_VERSION, selectionId: record.selectionId, status: 'existing' };
  } catch (cause) {
    if (!(cause instanceof ProblemSelectionError) || cause.code !== 'not_found') throw cause;
  }
  const temporary = path.join(targetDirectory, `.tmp-${process.pid}-${randomUUID()}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, file);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      const existing = await regularFile(file);
      if (existing !== bytes) throw error('integrity_mismatch', 'existing selection record bytes do not match its content address');
      return { recordId, recordVersion: PROBLEM_SELECTION_RECORD_VERSION, selectionId: record.selectionId, status: 'existing' };
    }
    return { recordId, recordVersion: PROBLEM_SELECTION_RECORD_VERSION, selectionId: record.selectionId, status: 'created' };
  } catch (cause) {
    if (cause instanceof ProblemSelectionError) throw cause;
    throw error('storage_io_error', 'selection record could not be saved');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function loadProblemSelectionRecord(request: LoadProblemSelectionRecordRequest): Promise<ProblemSelectionRecord> {
  if (!isPlainRecord(request)) throw error('invalid_request', 'load request must be an object');
  const root = assertRoot(request.root);
  const recordId = requireString(request.recordId, 'recordId');
  if (!RECORD_ID_PATTERN.test(recordId)) throw error('invalid_request', 'recordId must be sha256:<64 lowercase hex>');
  const bytes = await regularFile(locator(root, recordId as ProblemSelectionRecordId));
  if (!bytes.endsWith('\n')) throw error('integrity_mismatch', 'selection record bytes are not canonical');
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.slice(0, -1)); } catch { throw error('integrity_mismatch', 'selection record bytes are invalid JSON'); }
  if (!isPlainRecord(parsed) || Object.keys(parsed).sort().join(',') !== ['record', 'recordId', 'recordVersion'].sort().join(',') || parsed.recordVersion !== PROBLEM_SELECTION_RECORD_VERSION || parsed.recordId !== recordId) throw error('invalid_record', 'selection record envelope is invalid');
  const record = validateProblemSelectionRecord(parsed.record);
  const computed = recordIdForPayload(record);
  if (computed !== recordId) throw error('integrity_mismatch', 'selection record content address does not match its content');
  const canonical = `${canonicalJson(envelope(computed, record))}\n`;
  if (bytes !== canonical) throw error('integrity_mismatch', 'selection record bytes are not canonical');
  await authorize(request.accessProvider, 'read', request.access, record);
  return record;
}

export function createProblemSelectionRecordStore(options: {
  readonly root: string;
  readonly accessProvider?: ProblemSelectionAccessProvider;
}): ProblemSelectionRecordStore {
  if (!isPlainRecord(options)) throw error('invalid_request', 'store options must be an object');
  const root = assertRoot(options.root);
  return {
    save: (record, access) => saveProblemSelectionRecord({ root, record, access, accessProvider: options.accessProvider }),
    read: (recordId, access) => loadProblemSelectionRecord({ root, recordId, access, accessProvider: options.accessProvider })
  };
}

/** Compatibility aliases for consumers that use SelectionRecord terminology. */
export const saveSelectionRecord = saveProblemSelectionRecord;
export const loadSelectionRecord = loadProblemSelectionRecord;
export const computeSelectionRecordId = computeProblemSelectionRecordId;
