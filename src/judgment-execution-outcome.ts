/**
 * Portable execution outcome contract shared by a judgment Host and its
 * adapters.  The contract deliberately carries references only; transcript,
 * process, Task, and delivery details stay at the Host boundary.
 */

export const JUDGMENT_EXECUTION_OUTCOME_SCHEMA_VERSION = 'judgment_execution_outcome.v1' as const;

export type JudgmentExecutionHostType = 'codex' | 'claude-code';
export type JudgmentExecutionScope = 'host_turn' | 'external_effect';
export type JudgmentExecutionStatus = 'completed' | 'partial' | 'failed' | 'blocked' | 'unknown';
export type JudgmentExecutionStage = 'open' | 'resolve' | 'execute' | 'finalize' | 'deliver' | 'readback';
export type JudgmentExecutionEvidenceState = 'confirmed' | 'unconfirmed' | 'no_data';

export interface JudgmentExecutionHost {
  type: JudgmentExecutionHostType;
  adapter_id: string;
  adapter_version: string;
}

export interface JudgmentExecutionFailure {
  code: string;
  summary: string;
  upstream_code: string | null;
  retryable: boolean;
}

export interface JudgmentExecutionEvidence {
  state: JudgmentExecutionEvidenceState;
  refs: string[];
}

export interface JudgmentExecutionOutcome {
  schema_version: typeof JUDGMENT_EXECUTION_OUTCOME_SCHEMA_VERSION;
  host: JudgmentExecutionHost;
  execution_id: string;
  turn_id: string;
  scope: JudgmentExecutionScope;
  status: JudgmentExecutionStatus;
  stage: JudgmentExecutionStage;
  failure: JudgmentExecutionFailure | null;
  resume_from: string | null;
  evidence: JudgmentExecutionEvidence;
}

const FIELDS = new Set([
  'schema_version', 'host', 'execution_id', 'turn_id', 'scope', 'status', 'stage',
  'failure', 'resume_from', 'evidence'
]);
const HOST_FIELDS = new Set(['type', 'adapter_id', 'adapter_version']);
const FAILURE_FIELDS = new Set(['code', 'summary', 'upstream_code', 'retryable']);
const EVIDENCE_FIELDS = new Set(['state', 'refs']);
const STATUSES = new Set<JudgmentExecutionStatus>(['completed', 'partial', 'failed', 'blocked', 'unknown']);
const STAGES = new Set<JudgmentExecutionStage>(['open', 'resolve', 'execute', 'finalize', 'deliver', 'readback']);
const EVIDENCE_STATES = new Set<JudgmentExecutionEvidenceState>(['confirmed', 'unconfirmed', 'no_data']);
const HOST_TYPES = new Set<JudgmentExecutionHostType>(['codex', 'claude-code']);
const SCOPES = new Set<JudgmentExecutionScope>(['host_turn', 'external_effect']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type UnknownRecord = Record<string, unknown>;

function object(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as UnknownRecord;
}

function exact(value: unknown, allowed: Set<string>, field: string): UnknownRecord {
  const record = object(value, field);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${field}.${key} is not allowed`);
  }
  return record;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${field} is invalid`);
  return value;
}

function text(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > 1000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function ref(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > 512
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function evidenceRef(value: unknown, field: string): string {
  const normalized = ref(value, field);
  if (normalized.startsWith('/') || /^file:/iu.test(normalized)) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

/**
 * Validate and normalize a host execution outcome.
 *
 * The function intentionally rejects unknown keys and unsafe filesystem
 * references so adapters cannot accidentally turn private runtime state into
 * a public contract.
 */
export function normalizeJudgmentExecutionOutcome(input: unknown): JudgmentExecutionOutcome {
  const outcome = exact(input, FIELDS, 'outcome');
  if (outcome.schema_version !== JUDGMENT_EXECUTION_OUTCOME_SCHEMA_VERSION) {
    throw new TypeError('schema_version is invalid');
  }

  const hostInput = exact(outcome.host, HOST_FIELDS, 'host');
  const host = {
    type: id(hostInput.type, 'host.type'),
    adapter_id: id(hostInput.adapter_id, 'host.adapter_id'),
    adapter_version: id(hostInput.adapter_version, 'host.adapter_version')
  } as JudgmentExecutionHost;
  if (!HOST_TYPES.has(host.type)) throw new TypeError('host.type is not registered');
  if (!SCOPES.has(outcome.scope as JudgmentExecutionScope)) throw new TypeError('scope is invalid');
  if (!STATUSES.has(outcome.status as JudgmentExecutionStatus)) throw new TypeError('status is invalid');
  if (!STAGES.has(outcome.stage as JudgmentExecutionStage)) throw new TypeError('stage is invalid');

  const evidenceInput = exact(outcome.evidence, EVIDENCE_FIELDS, 'evidence');
  if (!EVIDENCE_STATES.has(evidenceInput.state as JudgmentExecutionEvidenceState)) {
    throw new TypeError('evidence.state is invalid');
  }
  if (!Array.isArray(evidenceInput.refs)) throw new TypeError('evidence.refs is invalid');
  let evidenceRefs: string[];
  try {
    evidenceRefs = evidenceInput.refs.map((reference, index) => evidenceRef(reference, `evidence.refs[${index}]`));
  } catch {
    throw new TypeError('evidence.refs is invalid');
  }

  const status = outcome.status as JudgmentExecutionStatus;
  const scope = outcome.scope as JudgmentExecutionScope;
  const stage = outcome.stage as JudgmentExecutionStage;
  const evidenceState = evidenceInput.state as JudgmentExecutionEvidenceState;
  const incomplete = status !== 'completed';
  if (incomplete && (!outcome.failure || !outcome.resume_from)) {
    throw new TypeError('failure and resume_from are required for a non-completed outcome');
  }

  let failure: JudgmentExecutionFailure | null = null;
  if (outcome.failure != null) {
    const failureInput = exact(outcome.failure, FAILURE_FIELDS, 'failure');
    failure = {
      code: id(failureInput.code, 'failure.code'),
      summary: text(failureInput.summary, 'failure.summary'),
      upstream_code: failureInput.upstream_code == null
        ? null
        : id(failureInput.upstream_code, 'failure.upstream_code'),
      retryable: failureInput.retryable as boolean
    };
    if (typeof failure.retryable !== 'boolean') throw new TypeError('failure.retryable is invalid');
  }

  if (status === 'completed' && (failure || outcome.resume_from != null)) {
    throw new TypeError('completed outcome cannot have failure or resume_from');
  }
  if (status === 'completed' && (evidenceState !== 'confirmed' || evidenceRefs.length === 0)) {
    throw new TypeError('completed outcome requires confirmed evidence refs');
  }
  if (status === 'completed' && scope === 'external_effect' && stage !== 'readback') {
    throw new TypeError('completed external effect requires readback');
  }
  if (status === 'completed' && scope === 'host_turn' && stage !== 'finalize') {
    throw new TypeError('completed host turn requires finalize');
  }

  return {
    schema_version: JUDGMENT_EXECUTION_OUTCOME_SCHEMA_VERSION,
    host,
    execution_id: ref(outcome.execution_id, 'execution_id'),
    turn_id: ref(outcome.turn_id, 'turn_id'),
    scope,
    status,
    stage,
    failure,
    resume_from: outcome.resume_from == null ? null : id(outcome.resume_from, 'resume_from'),
    evidence: { state: evidenceState, refs: evidenceRefs }
  };
}
