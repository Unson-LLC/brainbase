import type { JudgmentToolEvent } from './judgment-host.js';

export interface TaskProgressValidationIssue {
  path: (string | number)[];
  message: string;
}

export class TaskProgressValidationError extends Error {
  readonly issues: readonly TaskProgressValidationIssue[];

  constructor(issues: readonly TaskProgressValidationIssue[]) {
    const summary = issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    super(summary || 'Invalid task progress value');
    this.name = 'TaskProgressValidationError';
    this.issues = issues;
  }
}

export type TaskProgressSafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: TaskProgressValidationError };

export interface TaskProgressSchema<T> {
  parse(input: unknown): T;
  safeParse(input: unknown): TaskProgressSafeParseResult<T>;
}

export interface TaskProgressScope {
  task_ref: string;
  criterion_ref: string;
  contract_revision: string;
}

export type TaskProgressVerifiedOutcome = 'criterion_advanced' | 'new_negative_result';

export type TaskProgressObservation =
  | { kind: 'preparation_only'; evidence_tool_use_ids: string[] }
  | { kind: 'waiting' }
  | {
      kind: 'verified_outcome';
      outcome: TaskProgressVerifiedOutcome;
      evidence_tool_use_ids: string[];
      verification_ref: string;
    };

const MAX_REFERENCE_LENGTH = 512;
const SCOPE_KEYS = new Set(['task_ref', 'criterion_ref', 'contract_revision']);
const PREPARATION_ONLY_KEYS = new Set(['kind', 'evidence_tool_use_ids']);
const WAITING_KEYS = new Set(['kind']);
const VERIFIED_OUTCOME_KEYS = new Set(['kind', 'outcome', 'evidence_tool_use_ids', 'verification_ref']);
const VERIFIED_OUTCOMES = new Set<TaskProgressVerifiedOutcome>(['criterion_advanced', 'new_negative_result']);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
    && !(value instanceof RegExp)
    && !(value instanceof Map)
    && !(value instanceof Set)
    && !(value instanceof WeakMap)
    && !(value instanceof WeakSet)
    && !(value instanceof Promise)
    && !(value instanceof Error)
    && !(value instanceof ArrayBuffer)
    && !ArrayBuffer.isView(value)
  );
}

function collectUnknownKeyIssues(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  issues: TaskProgressValidationIssue[]
): void {
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    issues.push({
      path: [],
      message: `Unrecognized key(s) in object: ${unknownKeys.map((key) => `'${key}'`).join(', ')}`
    });
  }
}

function parseReference(
  value: unknown,
  path: (string | number)[],
  issues: TaskProgressValidationIssue[]
): string | undefined {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'Expected string' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    issues.push({ path, message: 'String must contain at least 1 character(s)' });
    return undefined;
  }
  if (trimmed.length > MAX_REFERENCE_LENGTH) {
    issues.push({ path, message: `String must contain at most ${MAX_REFERENCE_LENGTH} character(s)` });
    return undefined;
  }
  return trimmed;
}

function parseEvidenceIds(
  value: unknown,
  path: (string | number)[],
  issues: TaskProgressValidationIssue[]
): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected array' });
    return undefined;
  }
  if (value.length < 1) {
    issues.push({ path, message: 'Array must contain at least 1 element(s)' });
    return undefined;
  }
  const parsed: string[] = [];
  const startIssueCount = issues.length;
  for (let index = 0; index < value.length; index += 1) {
    const item = parseReference(value[index], [...path, index], issues);
    if (item !== undefined) {
      parsed.push(item);
    }
  }
  if (issues.length > startIssueCount) {
    return undefined;
  }
  if (new Set(parsed).size !== parsed.length) {
    issues.push({ path, message: 'Array elements must be unique' });
    return undefined;
  }
  return parsed;
}

function createSchema<T>(validate: (input: unknown, issues: TaskProgressValidationIssue[]) => T | undefined): TaskProgressSchema<T> {
  const safeParse = (input: unknown): TaskProgressSafeParseResult<T> => {
    const issues: TaskProgressValidationIssue[] = [];
    const data = validate(input, issues);
    if (issues.length > 0 || data === undefined) {
      return {
        success: false,
        error: new TaskProgressValidationError(
          issues.length > 0 ? issues : [{ path: [], message: 'Invalid value' }]
        )
      };
    }
    return { success: true, data };
  };

  return {
    safeParse,
    parse(input: unknown): T {
      const result = safeParse(input);
      if (!result.success) {
        throw result.error;
      }
      return result.data;
    }
  };
}

export const taskProgressScopeSchema: TaskProgressSchema<TaskProgressScope> = createSchema((input, issues) => {
  if (!isObjectRecord(input)) {
    issues.push({ path: [], message: 'Expected object' });
    return undefined;
  }
  collectUnknownKeyIssues(input, SCOPE_KEYS, issues);
  const task_ref = parseReference(input['task_ref'], ['task_ref'], issues);
  const criterion_ref = parseReference(input['criterion_ref'], ['criterion_ref'], issues);
  const contract_revision = parseReference(input['contract_revision'], ['contract_revision'], issues);
  if (issues.length > 0 || task_ref === undefined || criterion_ref === undefined || contract_revision === undefined) {
    return undefined;
  }
  return { task_ref, criterion_ref, contract_revision };
});

export const taskProgressObservationSchema: TaskProgressSchema<TaskProgressObservation> = createSchema((input, issues) => {
  if (!isObjectRecord(input)) {
    issues.push({ path: [], message: 'Expected object' });
    return undefined;
  }
  const kind = input['kind'];
  if (kind === 'preparation_only') {
    collectUnknownKeyIssues(input, PREPARATION_ONLY_KEYS, issues);
    const evidence_tool_use_ids = parseEvidenceIds(
      input['evidence_tool_use_ids'],
      ['evidence_tool_use_ids'],
      issues
    );
    if (issues.length > 0 || evidence_tool_use_ids === undefined) {
      return undefined;
    }
    return { kind: 'preparation_only', evidence_tool_use_ids };
  }
  if (kind === 'waiting') {
    collectUnknownKeyIssues(input, WAITING_KEYS, issues);
    if (issues.length > 0) {
      return undefined;
    }
    return { kind: 'waiting' };
  }
  if (kind === 'verified_outcome') {
    collectUnknownKeyIssues(input, VERIFIED_OUTCOME_KEYS, issues);
    const rawOutcome = input['outcome'];
    let outcome: TaskProgressVerifiedOutcome | undefined;
    if (typeof rawOutcome === 'string' && VERIFIED_OUTCOMES.has(rawOutcome as TaskProgressVerifiedOutcome)) {
      outcome = rawOutcome as TaskProgressVerifiedOutcome;
    } else {
      issues.push({
        path: ['outcome'],
        message: "Expected 'criterion_advanced' | 'new_negative_result'"
      });
    }
    const evidence_tool_use_ids = parseEvidenceIds(
      input['evidence_tool_use_ids'],
      ['evidence_tool_use_ids'],
      issues
    );
    const verification_ref = parseReference(input['verification_ref'], ['verification_ref'], issues);
    if (
      issues.length > 0
      || outcome === undefined
      || evidence_tool_use_ids === undefined
      || verification_ref === undefined
    ) {
      return undefined;
    }
    return {
      kind: 'verified_outcome',
      outcome,
      evidence_tool_use_ids,
      verification_ref
    };
  }
  issues.push({
    path: ['kind'],
    message: "Invalid discriminator value. Expected 'preparation_only' | 'waiting' | 'verified_outcome'"
  });
  return undefined;
});

export interface JudgmentTaskProgressSnapshot {
  episode_digest: string;
  event_set_digest: string;
  request: string;
  events: readonly JudgmentToolEvent[];
}

/** Host configuration, never fields copied from a model's Stop payload.
 * assess owns semantic classification; verifyOutcome must independently check
 * the actual result against this task/criterion, not accept a declaration.
 * Neither callback is provided by default or invokes a paid model internally.
 */
export interface JudgmentTaskProgressAdapter {
  scope: TaskProgressScope;
  assess(snapshot: JudgmentTaskProgressSnapshot): Promise<TaskProgressObservation>;
  verifyOutcome(snapshot: JudgmentTaskProgressSnapshot & {
    observation: Extract<TaskProgressObservation, { kind: 'verified_outcome' }>;
  }): Promise<boolean>;
}
