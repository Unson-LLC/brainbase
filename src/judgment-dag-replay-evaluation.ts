import { createHash } from 'node:crypto';

import type { JudgmentDAG, JudgmentDAGRunnerType } from './judgment-dag-core.js';
import {
  executeJudgmentDAG,
  type JudgmentDAGRunnerRegistration,
  type JudgmentDAGJSONValue,
  type JudgmentDAGRunRecord,
  type JudgmentDAGRunRequest
} from './judgment-dag-runner.js';
import {
  computeJudgmentDAGRunArtifactId,
  type JudgmentDAGRunArtifactId
} from './judgment-dag-artifact-store.js';

export const JUDGMENT_DAG_OUTCOME_ATTACHMENT_VERSION = 'judgment-dag-outcome.v1' as const;
export const JUDGMENT_DAG_EVALUATION_EVENT_SET_VERSION = 'judgment-dag-evaluation-event-set.v1' as const;

const ARTIFACT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type JudgmentDAGReplayEvaluationErrorCode =
  | 'invalid_request'
  | 'runner_version_mismatch'
  | 'artifact_mismatch'
  | 'context_mismatch'
  | 'outcome_mismatch'
  | 'invalid_score';

export class JudgmentDAGReplayEvaluationError extends Error {
  readonly code: JudgmentDAGReplayEvaluationErrorCode;

  constructor(code: JudgmentDAGReplayEvaluationErrorCode, message: string) {
    super(message);
    this.name = 'JudgmentDAGReplayEvaluationError';
    this.code = code;
  }
}

export interface JudgmentDAGRunArtifactReference {
  readonly artifact_id: JudgmentDAGRunArtifactId;
  readonly record: JudgmentDAGRunRecord;
}

export interface ReplayJudgmentDAGRunRequest {
  readonly source: JudgmentDAGRunArtifactReference;
  readonly replay_run_id: string;
  readonly mode: 'historical' | 'candidate';
  readonly candidate_dag?: JudgmentDAG;
  readonly runners: JudgmentDAGRunRequest['runners'];
}

export interface JudgmentDAGReplayResult {
  readonly source_artifact_id: JudgmentDAGRunArtifactId;
  readonly source_run_id: string;
  readonly mode: 'historical' | 'candidate';
  readonly record: JudgmentDAGRunRecord;
}

export interface JudgmentDAGOutcomeObservation {
  readonly metric_id: string;
  readonly scope: 'run' | 'node';
  readonly node_id?: string;
  readonly value: boolean | number;
}

export interface CreateJudgmentDAGOutcomeAttachmentRequest {
  readonly run_artifact_id: JudgmentDAGRunArtifactId;
  readonly record: JudgmentDAGRunRecord;
  readonly observations: readonly JudgmentDAGOutcomeObservation[];
}

export interface JudgmentDAGOutcomeAttachment {
  readonly attachment_version: typeof JUDGMENT_DAG_OUTCOME_ATTACHMENT_VERSION;
  readonly attachment_id: JudgmentDAGRunArtifactId;
  readonly run_artifact_id: JudgmentDAGRunArtifactId;
  readonly run_id: string;
  readonly observations: readonly JudgmentDAGOutcomeObservation[];
}

export interface JudgmentDAGEvaluationRun {
  readonly artifact_id: JudgmentDAGRunArtifactId;
  readonly record: JudgmentDAGRunRecord;
  readonly outcome: JudgmentDAGOutcomeAttachment;
}

export interface JudgmentDAGEvaluationEvent {
  readonly event_id: string;
  readonly baseline: JudgmentDAGEvaluationRun;
  readonly candidate: JudgmentDAGEvaluationRun;
}

export interface CreateJudgmentDAGEvaluationEventSetRequest {
  readonly events: readonly JudgmentDAGEvaluationEvent[];
}

export interface JudgmentDAGEvaluationEventSet {
  readonly event_set_version: typeof JUDGMENT_DAG_EVALUATION_EVENT_SET_VERSION;
  readonly event_set_id: JudgmentDAGRunArtifactId;
  readonly event_ids: readonly string[];
  readonly events: readonly JudgmentDAGEvaluationEvent[];
}

export type JudgmentDAGEvaluationScoring =
  | {
      readonly kind: 'pass_fail';
      readonly operator: 'eq' | 'gte' | 'lte';
      readonly target: boolean | number;
    }
  | {
      readonly kind: 'numeric';
      readonly direction: 'higher_is_better' | 'lower_is_better';
    };

export interface JudgmentDAGEvaluationCriterion {
  readonly criterion_id: string;
  readonly goal: string;
  readonly metric_id: string;
  readonly scoring: JudgmentDAGEvaluationScoring;
}

export interface EvaluateJudgmentDAGVersionsRequest {
  readonly event_set: JudgmentDAGEvaluationEventSet;
  readonly criterion: JudgmentDAGEvaluationCriterion;
}

export interface JudgmentDAGScoreSummary {
  readonly baseline: number;
  readonly candidate: number;
  readonly delta: number;
  readonly event_count: number;
}

export type JudgmentDAGNodeCalibrationStatus =
  | 'comparable'
  | 'baseline_only'
  | 'candidate_only'
  | 'no_observation';

export interface JudgmentDAGNodeCalibration {
  readonly node_id: string;
  readonly status: JudgmentDAGNodeCalibrationStatus;
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly delta: number | null;
  readonly event_count: number;
}

export interface JudgmentDAGVersionComparison {
  readonly event_set_id: JudgmentDAGRunArtifactId;
  readonly event_ids: readonly string[];
  readonly criterion: JudgmentDAGEvaluationCriterion;
  readonly overall: JudgmentDAGScoreSummary;
  readonly node_calibration: readonly JudgmentDAGNodeCalibration[];
}

function fail(code: JudgmentDAGReplayEvaluationErrorCode, message: string): never {
  throw new JudgmentDAGReplayEvaluationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotJSON(value: unknown, label: string, seen = new WeakSet<object>()): JudgmentDAGJSONValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_request', `${label} must contain only finite numbers`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') fail('invalid_request', `${label} must be JSON-compatible`);
  if (seen.has(value)) fail('invalid_request', `${label} must not contain cycles`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result: JudgmentDAGJSONValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail('invalid_request', `${label} must not contain sparse arrays`);
        result.push(snapshotJSON(value[index], `${label}[${index}]`, seen));
      }
      return result;
    }
    if (!isPlainObject(value)) fail('invalid_request', `${label} must contain only plain objects`);
    const result: Record<string, JudgmentDAGJSONValue> = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        fail('invalid_request', `${label}.${key} must be a data property`);
      }
      result[key] = snapshotJSON(descriptor.value, `${label}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function canonicalJSON(value: unknown, label: string): string {
  return JSON.stringify(snapshotJSON(value, label));
}

function detached<T>(value: T, label: string): T {
  return JSON.parse(canonicalJSON(value, label)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('invalid_request', `${label} must be a non-empty string`);
  }
  return value;
}

function requireArtifactId(value: unknown, label: string): JudgmentDAGRunArtifactId {
  if (typeof value !== 'string' || !ARTIFACT_ID_PATTERN.test(value)) {
    fail('invalid_request', `${label} must be a sha256 artifact ID`);
  }
  return value as JudgmentDAGRunArtifactId;
}

function contentId(value: unknown, label: string): JudgmentDAGRunArtifactId {
  return `sha256:${createHash('sha256').update(canonicalJSON(value, label), 'utf8').digest('hex')}`;
}

function detachedRecord(record: JudgmentDAGRunRecord, label: string): JudgmentDAGRunRecord {
  const snapshot = detached(record, label);
  requireNonEmptyString(snapshot.run_id, `${label}.run_id`);
  return deepFreeze(snapshot);
}

function verifiedArtifactRecord(
  artifactIdValue: unknown,
  recordValue: JudgmentDAGRunRecord,
  label: string
): { readonly artifactId: JudgmentDAGRunArtifactId; readonly record: JudgmentDAGRunRecord } {
  const artifactId = requireArtifactId(artifactIdValue, `${label}.artifact_id`);
  const record = detachedRecord(recordValue, `${label}.record`);
  let expectedArtifactId: JudgmentDAGRunArtifactId;
  try {
    expectedArtifactId = computeJudgmentDAGRunArtifactId(record);
  } catch {
    fail('invalid_request', `${label}.record is not a valid run artifact record`);
  }
  if (artifactId !== expectedArtifactId) {
    fail('artifact_mismatch', `${label}.artifact_id does not match the run record content`);
  }
  return { artifactId, record };
}

function requiredHistoricalVersions(record: JudgmentDAGRunRecord): Map<JudgmentDAGRunnerType, string> {
  const versions = new Map<JudgmentDAGRunnerType, string>();
  for (const entry of record.runner_versions) {
    if (versions.has(entry.runner_type)) fail('invalid_request', 'historical runner versions must be unique');
    versions.set(entry.runner_type, requireNonEmptyString(entry.version, 'historical runner version'));
  }
  return versions;
}

function captureRunnerRegistrations(
  request: ReplayJudgmentDAGRunRequest,
  dag: JudgmentDAG,
  expectedVersions?: ReadonlyMap<JudgmentDAGRunnerType, string>
): JudgmentDAGRunRequest['runners'] {
  try {
    const runnersDescriptor = Object.getOwnPropertyDescriptor(request, 'runners');
    if (runnersDescriptor === undefined || !('value' in runnersDescriptor) ||
        !isPlainObject(runnersDescriptor.value)) {
      fail('invalid_request', 'runners must be an own data property containing a plain object');
    }
    const runners = runnersDescriptor.value;
    const captured: Partial<Record<JudgmentDAGRunnerType, JudgmentDAGRunnerRegistration>> = {};
    const runnerTypes = [...new Set(dag.nodes.map((node) => node.runner_type))]
      .sort((left, right) => left.localeCompare(right));
    for (const runnerType of runnerTypes) {
      const registrationDescriptor = Object.getOwnPropertyDescriptor(runners, runnerType);
      if (registrationDescriptor === undefined || !('value' in registrationDescriptor) ||
          !isPlainObject(registrationDescriptor.value)) {
        fail('invalid_request', `runner ${runnerType} must be an own data property`);
      }
      const versionDescriptor = Object.getOwnPropertyDescriptor(registrationDescriptor.value, 'version');
      const runDescriptor = Object.getOwnPropertyDescriptor(registrationDescriptor.value, 'run');
      if (versionDescriptor === undefined || !('value' in versionDescriptor) ||
          runDescriptor === undefined || !('value' in runDescriptor) ||
          typeof runDescriptor.value !== 'function') {
        fail('invalid_request', `runner ${runnerType} must expose version and run as data properties`);
      }
      const version = requireNonEmptyString(versionDescriptor.value, `runner ${runnerType} version`);
      const expectedVersion = expectedVersions?.get(runnerType);
      if (expectedVersion !== undefined && version !== expectedVersion) {
        fail(
          'runner_version_mismatch',
          `historical runner ${runnerType} must use recorded version ${expectedVersion}`
        );
      }
      captured[runnerType] = { version, run: runDescriptor.value };
    }
    return Object.freeze(captured) as JudgmentDAGRunRequest['runners'];
  } catch (error) {
    if (error instanceof JudgmentDAGReplayEvaluationError) throw error;
    fail('invalid_request', 'runner registrations could not be captured safely');
  }
}

export async function replayJudgmentDAGRun(
  request: ReplayJudgmentDAGRunRequest
): Promise<JudgmentDAGReplayResult> {
  if (!isPlainObject(request) || !isPlainObject(request.source)) {
    fail('invalid_request', 'replay request and source must be plain objects');
  }
  const { artifactId, record: sourceRecord } = verifiedArtifactRecord(
    request.source.artifact_id,
    request.source.record,
    'source'
  );
  const replayRunId = requireNonEmptyString(request.replay_run_id, 'replay_run_id');
  if (replayRunId === sourceRecord.run_id) fail('invalid_request', 'replay_run_id must differ from source run_id');
  if (request.mode !== 'historical' && request.mode !== 'candidate') fail('invalid_request', 'mode is invalid');

  let replayDAG: JudgmentDAG;
  let expectedVersions: ReadonlyMap<JudgmentDAGRunnerType, string> | undefined;
  if (request.mode === 'historical') {
    if (request.candidate_dag !== undefined) fail('invalid_request', 'historical replay cannot provide candidate_dag');
    expectedVersions = requiredHistoricalVersions(sourceRecord);
    replayDAG = sourceRecord.dag;
  } else {
    if (request.candidate_dag === undefined) fail('invalid_request', 'candidate replay requires candidate_dag');
    replayDAG = detached(request.candidate_dag, 'candidate_dag');
  }
  const capturedRunners = captureRunnerRegistrations(request, replayDAG, expectedVersions);

  const record = await executeJudgmentDAG({
    run_id: replayRunId,
    dag: replayDAG,
    input: sourceRecord.input,
    runners: capturedRunners
  });
  return deepFreeze({
    source_artifact_id: artifactId,
    source_run_id: sourceRecord.run_id,
    mode: request.mode,
    record
  });
}

function normalizedObservations(
  record: JudgmentDAGRunRecord,
  observations: readonly JudgmentDAGOutcomeObservation[]
): readonly JudgmentDAGOutcomeObservation[] {
  if (!Array.isArray(observations) || observations.length === 0) {
    fail('invalid_request', 'observations must be a non-empty array');
  }
  const nodeIds = new Set(record.nodes.map((node) => node.node_id));
  const identities = new Set<string>();
  return observations.map((raw, index) => {
    if (!isPlainObject(raw)) fail('invalid_request', `observations[${index}] must be a plain object`);
    const metricId = requireNonEmptyString(raw.metric_id, `observations[${index}].metric_id`);
    if (raw.scope !== 'run' && raw.scope !== 'node') fail('invalid_request', 'observation scope is invalid');
    if (typeof raw.value !== 'boolean' && (typeof raw.value !== 'number' || !Number.isFinite(raw.value))) {
      fail('invalid_request', 'observation value must be boolean or a finite number');
    }
    let nodeId: string | undefined;
    if (raw.scope === 'node') {
      nodeId = requireNonEmptyString(raw.node_id, `observations[${index}].node_id`);
      if (!nodeIds.has(nodeId)) fail('invalid_request', `observation references unknown node ${nodeId}`);
    } else if (raw.node_id !== undefined) {
      fail('invalid_request', 'run observation cannot have node_id');
    }
    const identity = `${metricId}\u0000${raw.scope}\u0000${nodeId ?? ''}`;
    if (identities.has(identity)) fail('invalid_request', 'observations must be unique by metric, scope, and node');
    identities.add(identity);
    return nodeId === undefined
      ? { metric_id: metricId, scope: raw.scope, value: raw.value }
      : { metric_id: metricId, scope: raw.scope, node_id: nodeId, value: raw.value };
  });
}

export function createJudgmentDAGOutcomeAttachment(
  request: CreateJudgmentDAGOutcomeAttachmentRequest
): JudgmentDAGOutcomeAttachment {
  if (!isPlainObject(request)) fail('invalid_request', 'outcome request must be a plain object');
  const { artifactId, record } = verifiedArtifactRecord(
    request.run_artifact_id,
    request.record,
    'run_artifact'
  );
  const observations = normalizedObservations(record, request.observations);
  const payload = {
    attachment_version: JUDGMENT_DAG_OUTCOME_ATTACHMENT_VERSION,
    run_artifact_id: artifactId,
    run_id: record.run_id,
    observations
  };
  return deepFreeze({ ...payload, attachment_id: contentId(payload, 'outcome attachment') });
}

function validateOutcome(
  outcome: JudgmentDAGOutcomeAttachment,
  artifactId: JudgmentDAGRunArtifactId,
  record: JudgmentDAGRunRecord,
  label: string
): JudgmentDAGOutcomeAttachment {
  const snapshot = detached(outcome, label);
  if (snapshot.attachment_version !== JUDGMENT_DAG_OUTCOME_ATTACHMENT_VERSION ||
      snapshot.run_artifact_id !== artifactId || snapshot.run_id !== record.run_id) {
    fail('outcome_mismatch', `${label} does not bind to its run artifact`);
  }
  const normalized = createJudgmentDAGOutcomeAttachment({
    run_artifact_id: artifactId,
    record,
    observations: snapshot.observations
  });
  if (normalized.attachment_id !== snapshot.attachment_id) {
    fail('outcome_mismatch', `${label} content identity is invalid`);
  }
  return normalized;
}

function normalizedEvaluationRun(value: JudgmentDAGEvaluationRun, label: string): JudgmentDAGEvaluationRun {
  if (!isPlainObject(value)) fail('invalid_request', `${label} must be a plain object`);
  const { artifactId, record } = verifiedArtifactRecord(value.artifact_id, value.record, label);
  const outcome = validateOutcome(value.outcome, artifactId, record, `${label}.outcome`);
  return { artifact_id: artifactId, record, outcome };
}

export function createJudgmentDAGEvaluationEventSet(
  request: CreateJudgmentDAGEvaluationEventSetRequest
): JudgmentDAGEvaluationEventSet {
  if (!isPlainObject(request) || !Array.isArray(request.events) || request.events.length === 0) {
    fail('invalid_request', 'evaluation event set requires a non-empty events array');
  }
  const eventIds = new Set<string>();
  const events = request.events.map((event, index): JudgmentDAGEvaluationEvent => {
    if (!isPlainObject(event)) fail('invalid_request', `events[${index}] must be a plain object`);
    const typedEvent = event as unknown as JudgmentDAGEvaluationEvent;
    const eventId = requireNonEmptyString(typedEvent.event_id, `events[${index}].event_id`);
    if (eventIds.has(eventId)) fail('invalid_request', `duplicate event_id ${eventId}`);
    eventIds.add(eventId);
    const baseline = normalizedEvaluationRun(typedEvent.baseline, `events[${index}].baseline`);
    const candidate = normalizedEvaluationRun(typedEvent.candidate, `events[${index}].candidate`);
    if (canonicalJSON(baseline.record.input, 'baseline input') !==
        canonicalJSON(candidate.record.input, 'candidate input')) {
      fail('context_mismatch', `event ${eventId} does not compare the same recorded context`);
    }
    return { event_id: eventId, baseline, candidate };
  });
  const payload = {
    event_set_version: JUDGMENT_DAG_EVALUATION_EVENT_SET_VERSION,
    events
  };
  return deepFreeze({
    ...payload,
    event_set_id: contentId(payload, 'evaluation event set'),
    event_ids: events.map((event) => event.event_id)
  });
}

function validateEventSet(eventSet: JudgmentDAGEvaluationEventSet): JudgmentDAGEvaluationEventSet {
  const rebuilt = createJudgmentDAGEvaluationEventSet({ events: eventSet.events });
  if (eventSet.event_set_version !== JUDGMENT_DAG_EVALUATION_EVENT_SET_VERSION ||
      eventSet.event_set_id !== rebuilt.event_set_id ||
      canonicalJSON(eventSet.event_ids, 'event_ids') !== canonicalJSON(rebuilt.event_ids, 'event_ids')) {
    fail('invalid_request', 'evaluation event set identity is invalid');
  }
  return rebuilt;
}

function validateCriterion(value: JudgmentDAGEvaluationCriterion): JudgmentDAGEvaluationCriterion {
  if (!isPlainObject(value) || !isPlainObject(value.scoring)) {
    fail('invalid_request', 'criterion and scoring must be plain objects');
  }
  const criterionId = requireNonEmptyString(value.criterion_id, 'criterion_id');
  const goal = requireNonEmptyString(value.goal, 'goal');
  const metricId = requireNonEmptyString(value.metric_id, 'metric_id');
  let scoring: JudgmentDAGEvaluationScoring;
  if (value.scoring.kind === 'numeric') {
    if (value.scoring.direction !== 'higher_is_better' && value.scoring.direction !== 'lower_is_better') {
      fail('invalid_request', 'numeric direction is invalid');
    }
    scoring = { kind: 'numeric', direction: value.scoring.direction };
  } else if (value.scoring.kind === 'pass_fail') {
    if (!['eq', 'gte', 'lte'].includes(value.scoring.operator)) fail('invalid_request', 'pass_fail operator is invalid');
    if (typeof value.scoring.target !== 'boolean' &&
        (typeof value.scoring.target !== 'number' || !Number.isFinite(value.scoring.target))) {
      fail('invalid_request', 'pass_fail target must be boolean or a finite number');
    }
    if (typeof value.scoring.target === 'boolean' && value.scoring.operator !== 'eq') {
      fail('invalid_request', 'boolean pass_fail target only supports eq');
    }
    scoring = { kind: 'pass_fail', operator: value.scoring.operator, target: value.scoring.target };
  } else {
    fail('invalid_request', 'scoring kind is invalid');
  }
  return deepFreeze({ criterion_id: criterionId, goal, metric_id: metricId, scoring });
}

function scoreValue(value: boolean | number, scoring: JudgmentDAGEvaluationScoring): number {
  if (scoring.kind === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail('invalid_score', 'numeric scoring requires finite number observations');
    }
    return value;
  }
  if (scoring.operator === 'eq') return value === scoring.target ? 1 : 0;
  if (typeof value !== 'number' || typeof scoring.target !== 'number') {
    fail('invalid_score', 'ordered pass_fail scoring requires number observations and target');
  }
  return scoring.operator === 'gte'
    ? (value >= scoring.target ? 1 : 0)
    : (value <= scoring.target ? 1 : 0);
}

function observation(
  attachment: JudgmentDAGOutcomeAttachment,
  metricId: string,
  scope: 'run' | 'node',
  nodeId?: string
): JudgmentDAGOutcomeObservation | undefined {
  return attachment.observations.find((item) =>
    item.metric_id === metricId && item.scope === scope && item.node_id === nodeId
  );
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateJudgmentDAGVersions(
  request: EvaluateJudgmentDAGVersionsRequest
): JudgmentDAGVersionComparison {
  if (!isPlainObject(request)) fail('invalid_request', 'evaluation request must be a plain object');
  const eventSet = validateEventSet(request.event_set);
  const criterion = validateCriterion(request.criterion);
  const baselineOverall: number[] = [];
  const candidateOverall: number[] = [];
  const allNodeIds = new Set<string>();

  for (const event of eventSet.events) {
    const baselineRun = observation(event.baseline.outcome, criterion.metric_id, 'run');
    const candidateRun = observation(event.candidate.outcome, criterion.metric_id, 'run');
    if (baselineRun === undefined || candidateRun === undefined) {
      fail('outcome_mismatch', `event ${event.event_id} is missing the run observation for ${criterion.metric_id}`);
    }
    baselineOverall.push(scoreValue(baselineRun.value, criterion.scoring));
    candidateOverall.push(scoreValue(candidateRun.value, criterion.scoring));
    for (const node of event.baseline.record.nodes) allNodeIds.add(node.node_id);
    for (const node of event.candidate.record.nodes) allNodeIds.add(node.node_id);
  }

  const nodeCalibration = [...allNodeIds].sort().map((nodeId): JudgmentDAGNodeCalibration => {
    const baselineScores: number[] = [];
    const candidateScores: number[] = [];
    let baselinePresent = false;
    let candidatePresent = false;
    for (const event of eventSet.events) {
      baselinePresent ||= event.baseline.record.nodes.some((node) => node.node_id === nodeId);
      candidatePresent ||= event.candidate.record.nodes.some((node) => node.node_id === nodeId);
      const baselineNode = observation(event.baseline.outcome, criterion.metric_id, 'node', nodeId);
      const candidateNode = observation(event.candidate.outcome, criterion.metric_id, 'node', nodeId);
      if (baselineNode !== undefined && candidateNode !== undefined) {
        baselineScores.push(scoreValue(baselineNode.value, criterion.scoring));
        candidateScores.push(scoreValue(candidateNode.value, criterion.scoring));
      }
    }
    if (!baselinePresent) {
      return { node_id: nodeId, status: 'candidate_only', baseline: null, candidate: null, delta: null, event_count: 0 };
    }
    if (!candidatePresent) {
      return { node_id: nodeId, status: 'baseline_only', baseline: null, candidate: null, delta: null, event_count: 0 };
    }
    if (baselineScores.length === 0) {
      return { node_id: nodeId, status: 'no_observation', baseline: null, candidate: null, delta: null, event_count: 0 };
    }
    const baseline = average(baselineScores);
    const candidate = average(candidateScores);
    return {
      node_id: nodeId,
      status: 'comparable',
      baseline,
      candidate,
      delta: candidate - baseline,
      event_count: baselineScores.length
    };
  });

  const baseline = average(baselineOverall);
  const candidate = average(candidateOverall);
  return deepFreeze({
    event_set_id: eventSet.event_set_id,
    event_ids: eventSet.event_ids.slice(),
    criterion,
    overall: { baseline, candidate, delta: candidate - baseline, event_count: eventSet.events.length },
    node_calibration: nodeCalibration
  });
}
