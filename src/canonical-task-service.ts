import { createHash } from 'node:crypto';
import {
  canTransitionCanonicalTaskStatus,
  hasInvalidCanonicalTaskProjectCode,
  isCanonicalTaskPriority,
  isCanonicalTaskStatus,
  normalizeCanonicalTaskProjectCodes,
  type CanonicalTaskPriority,
  type CanonicalTaskStatus,
} from './canonical-task-contract.js';
import {
  normalizeCanonicalTaskPrincipal,
  principalNamespace,
  type CanonicalTaskPrincipal,
} from './canonical-task-principal.js';

type JsonRecord = Record<string, unknown>;

type CanonicalTaskDeleteResult = {
  task_id: string;
  deleted: true;
  version: number;
};

/**
 * The operation coordinator persists this private field with a prepared
 * delete result so a completed replay can rebuild its audit envelope after
 * the task row has been removed. It is stripped before the public response.
 */
type CanonicalTaskDeleteOperationResult = CanonicalTaskDeleteResult & {
  _audit_source_refs?: unknown[];
};

export type CanonicalTaskAction =
  | 'list'
  | 'search'
  | 'read'
  | 'create'
  | 'update'
  | 'transition'
  | 'delete';

export type CanonicalTaskAuditAction =
  | 'canonical_task.created'
  | 'canonical_task.updated'
  | 'canonical_task.transitioned'
  | 'canonical_task.deleted';

export interface CanonicalTaskContext extends JsonRecord {
  principal: CanonicalTaskPrincipal;
  authSource?: string | null;
  auditPrincipal?: CanonicalTaskPrincipal | null;
  auditAuthSource?: string | null;
  idempotencyKey?: string | null;
}

export interface CanonicalTaskRecord extends JsonRecord {
  id: string;
  version: number;
  title: string;
  description?: string | null;
  status: CanonicalTaskStatus;
  priority: CanonicalTaskPriority;
  assignee_person_id?: string | null;
  assignee_display_name?: string | null;
  due_at?: string | null;
  waiting_on?: string | null;
  review_at?: string | null;
  completed_at?: string | null;
  source_refs?: unknown[];
  project_codes?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  web_url?: string | null;
}

export interface CanonicalTaskCreateInput extends JsonRecord {
  title: string;
  description?: string | null;
  priority?: CanonicalTaskPriority | string | null;
  assignee_person_id?: string | null;
  due_at?: string | null;
  waiting_on?: string | null;
  review_at?: string | null;
  source_refs?: unknown[];
  project_codes?: unknown;
}

export interface CanonicalTaskUpdateInput extends JsonRecord {
  title?: string;
  description?: string | null;
  priority?: CanonicalTaskPriority | string | null;
  assignee_person_id?: string | null;
  due_at?: string | null;
  waiting_on?: string | null;
  review_at?: string | null;
  source_refs?: unknown[];
  project_codes?: unknown;
}

export interface CanonicalTaskListFilters extends JsonRecord {
  statuses?: unknown;
  status?: unknown;
  priorities?: unknown;
  priority?: unknown;
  projectCodes?: unknown;
  projectCode?: unknown;
  project_code?: unknown;
  assigneePersonId?: string | null;
  dueAfter?: string | null;
  dueBefore?: string | null;
  limit?: number | string | null;
  cursor?: string | null;
}

export interface CanonicalTaskSearchFilters extends CanonicalTaskListFilters {
  q?: string | null;
  query?: string | null;
}

export interface CanonicalTaskPage {
  items: CanonicalTaskRecord[];
  totalCount?: number | null;
  countStatus?: string | null;
  nextCursor?: string | null;
  readStatus?: string | null;
  total_count?: number | null;
  count_status?: string | null;
  next_cursor?: string | null;
  read_status?: string | null;
  has_more?: boolean;
  as_of?: string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface CanonicalTaskSearchPage extends CanonicalTaskPage {
  query: string;
}

export interface CanonicalTaskAuditEntry extends JsonRecord {
  id: string;
  actor: CanonicalTaskPrincipal;
  actor_id: string;
  actor_type: CanonicalTaskPrincipal['type'];
  actor_principal: CanonicalTaskPrincipal;
  actor_namespace: string;
  auth_source: string | null;
  action: CanonicalTaskAuditAction;
  target_type: 'canonical_task';
  target_id: string;
  changes: JsonRecord;
  source_refs: unknown[];
}

export interface CanonicalTaskRepository {
  list(filters: CanonicalTaskListFilters): Promise<CanonicalTaskPage>;
  search(filters: CanonicalTaskSearchFilters): Promise<CanonicalTaskPage>;
  get(taskId: string): Promise<CanonicalTaskRecord | null>;
  findByIdempotencyKey(key: string): Promise<CanonicalTaskRecord | null>;
  create(input: JsonRecord): Promise<CanonicalTaskRecord>;
  update(taskId: string, patch: JsonRecord): Promise<CanonicalTaskRecord>;
  delete(taskId: string, expectedVersion: number): Promise<void>;
}

export interface CanonicalTaskAuditRepository {
  upsertAuditLog(entry: CanonicalTaskAuditEntry): Promise<void>;
}

export interface CanonicalTaskAuthorizationRequest {
  action: CanonicalTaskAction;
  context: CanonicalTaskContext;
  task?: CanonicalTaskRecord | null;
  input?: unknown;
}

export interface CanonicalTaskPolicy {
  normalizeContext?(context: CanonicalTaskContext): CanonicalTaskContext | Promise<CanonicalTaskContext>;
  authorize(request: CanonicalTaskAuthorizationRequest): void | Promise<void>;
  scopeFilters?(input: {
    operation: 'list' | 'search';
    context: CanonicalTaskContext;
    filters: CanonicalTaskListFilters | CanonicalTaskSearchFilters;
  }):
    | Partial<CanonicalTaskListFilters | CanonicalTaskSearchFilters>
    | void
    | Promise<Partial<CanonicalTaskListFilters | CanonicalTaskSearchFilters> | void>;
}

export type CanonicalTaskClock = () => Date;
export type CanonicalTaskBaseUrl = string | (() => string | null | undefined);

export interface CanonicalTaskOperationRequest<T> {
  scope: string;
  operationKey: string;
  fingerprint: string;
  /**
   * Persist only the stable reference needed to resume an operation. The
   * coordinator must not need to serialize the complete Task payload.
   */
  projectResult?: (result: T) => unknown;
  /**
   * Inspect durable state after a caller or coordinator restart. A recovery
   * result is deliberately explicit so a missing record is not mistaken for
   * a successful replay.
   */
  recover?: () => Promise<CanonicalTaskOperationRecovery<T>>;
  run: () => Promise<T>;
}

export interface CanonicalTaskOperationRecovery<T> {
  recovered: boolean;
  result?: T;
}

export interface CanonicalTaskPreparedDeleteRequest<T> {
  scope?: string;
  operationKey: string;
  fingerprint: string;
  /** Fingerprint for the task-version claim paired with the delete intent. */
  versionFingerprint: string;
  versionClaimKey: string;
  principalNamespace: string;
  prepare: () => Promise<{
    result: T;
    task?: CanonicalTaskRecord | null;
    authorizationSnapshot?: JsonRecord;
  }>;
  findTask: () => Promise<CanonicalTaskRecord | null>;
  removeTask: (task?: CanonicalTaskRecord) => Promise<void>;
  projectResult?: (result: T) => unknown;
  recover?: () => Promise<CanonicalTaskOperationRecovery<T>>;
}

export interface CanonicalTaskOperationRepository {
  execute<T>(request: CanonicalTaskOperationRequest<T>): Promise<T>;
  executePreparedDelete?<T>(request: CanonicalTaskPreparedDeleteRequest<T>): Promise<T>;
}

export interface CanonicalTaskServiceOptions {
  repository: CanonicalTaskRepository;
  auditRepository?: CanonicalTaskAuditRepository;
  policy?: CanonicalTaskPolicy;
  operationRepository?: CanonicalTaskOperationRepository;
  clock?: CanonicalTaskClock;
  baseUrl?: CanonicalTaskBaseUrl;
}

export class CanonicalTaskError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonRecord;
  readonly fieldErrors: Record<string, string[]>;
  readonly currentTask?: CanonicalTaskRecord;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: JsonRecord = {},
    options: { fieldErrors?: Record<string, string[]>; currentTask?: CanonicalTaskRecord } = {},
  ) {
    super(message);
    this.name = 'CanonicalTaskError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.fieldErrors = options.fieldErrors
      ?? (details.fieldErrors as Record<string, string[]> | undefined)
      ?? {};
    this.currentTask = options.currentTask
      ?? (details.currentTask as CanonicalTaskRecord | undefined);
  }
}

const MAX_TITLE_LENGTH = 200;
const MAX_SEARCH_LENGTH = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const RESERVED_IDEMPOTENCY_PREFIXES = ['api:', 'workflow:'];
const CREATE_FIELDS = new Set([
  'title',
  'description',
  'priority',
  'assignee_person_id',
  'due_at',
  'waiting_on',
  'review_at',
  'source_refs',
  'project_codes',
]);
const MUTABLE_FIELDS = new Set([
  'expected_version',
  'title',
  'description',
  'priority',
  'assignee_person_id',
  'due_at',
  'waiting_on',
  'review_at',
  'source_refs',
  'project_codes',
]);

function fail(code: string, message: string, status = 400, details: JsonRecord = {}): never {
  throw new CanonicalTaskError(code, message, status, details);
}

function failValidation(fieldErrors: Record<string, string[]>): never {
  throw new CanonicalTaskError(
    'validation_failed',
    'Canonical Task request is invalid',
    422,
    { fieldErrors },
    { fieldErrors },
  );
}

function normalizeString(
  value: unknown,
  field: string,
  options: { required?: boolean; max?: number; multiline?: boolean } = {},
): string | null {
  const text = value == null ? '' : String(value).normalize('NFKC');
  // Multi-line fields keep line breaks and tabs; CRLF/CR are stored as LF.
  const normalized = (options.multiline ? text.replace(/\r\n?/gu, '\n') : text).trim();
  if (!normalized) {
    if (options.required) fail('validation_error', `${field} is required`, 400, { field });
    return null;
  }
  const controlCharacters = options.multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (controlCharacters.test(normalized)) {
    fail('validation_error', `${field} contains control characters`, 400, { field });
  }
  if (options.max && normalized.length > options.max) {
    fail('validation_error', `${field} exceeds the maximum length`, 400, { field, max: options.max });
  }
  return normalized;
}

function normalizeIsoDate(value: unknown, field: string): string | null {
  const text = normalizeString(value, field);
  if (text == null) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) fail('validation_error', `${field} must be an ISO date`, 400, { field });
  return date.toISOString();
}

function normalizeLimit(value: unknown, max = MAX_LIMIT): number {
  if (value == null || value === '') return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    failValidation({ limit: [`must_be_between_1_and_${max}`] });
  }
  return limit;
}

function normalizeCursor(value: unknown): string | null {
  return normalizeString(value, 'cursor', { max: 500 });
}

function normalizeCollection(value: unknown, field: string): string[] | undefined {
  if (value == null || value === '') return undefined;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.flatMap((item) => String(item).split(','))
    .map((item) => item.normalize('NFKC').trim())
    .filter(Boolean);
  if (normalized.length === 0) return undefined;
  if (normalized.some((item) => /[\u0000-\u001f\u007f]/u.test(item))) {
    fail('validation_error', `${field} contains control characters`, 400, { field });
  }
  return [...new Set(normalized)];
}

function normalizeProjectCodes(value: unknown): string[] | undefined {
  if (value == null || value === '') return undefined;
  if (hasInvalidCanonicalTaskProjectCode(value)) {
    failValidation({ project_codes: ['invalid_project_code'] });
  }
  return normalizeCanonicalTaskProjectCodes(value);
}

function normalizeSourceRefs(value: unknown): unknown[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) fail('validation_error', 'source_refs must be an array', 400, { field: 'source_refs' });
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as JsonRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function operationKey(principal: CanonicalTaskPrincipal, clientKey: string, prefix: string): string {
  return `${prefix}${principalNamespace(principal)}:${clientKey}`;
}

function extractPersistedFingerprint(task: CanonicalTaskRecord): string | null {
  const value = task.payload_fingerprint ?? task._payload_fingerprint;
  return typeof value === 'string' ? value : null;
}

function projectTaskResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const candidate = result as JsonRecord;
  if (typeof candidate.id === 'string' && Number.isInteger(candidate.version)) {
    return { task_id: candidate.id, task_version: candidate.version };
  }
  if (typeof candidate.task_id === 'string' && Number.isInteger(candidate.version)) {
    return { task_id: candidate.task_id, task_version: candidate.version };
  }
  return result;
}

// Repositories report warnings as `{ code, message }` objects or legacy strings.
// The page contract is string[], so keep the code rather than "[object Object]".
function warningCode(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  const code = (warning as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code ? code : JSON.stringify(warning);
}

function normalizePage(page: CanonicalTaskPage, normalize: (task: CanonicalTaskRecord) => CanonicalTaskRecord): CanonicalTaskPage {
  const items = Array.isArray(page.items) ? page.items.map(normalize) : [];
  // An explicit null means that the backend did not request or cannot provide
  // a count. Preserve that evidence instead of turning it into a false exact
  // count derived from the current page.
  const totalCount = page.totalCount !== undefined
    ? page.totalCount
    : (page.total_count !== undefined ? page.total_count : items.length);
  const countStatus = page.countStatus ?? page.count_status ?? 'exact';
  const nextCursor = page.nextCursor ?? page.next_cursor ?? null;
  const readStatus = page.readStatus ?? page.read_status ?? 'complete';
  return {
    ...page,
    items,
    totalCount,
    countStatus,
    nextCursor,
    readStatus,
    total_count: totalCount,
    count_status: countStatus,
    next_cursor: nextCursor,
    read_status: readStatus,
    warnings: items.flatMap((task) => Array.isArray(task.normalization_warnings) ? task.normalization_warnings.map(warningCode) : []),
  };
}

export class CanonicalTaskService {
  private readonly repository: CanonicalTaskRepository;
  private readonly auditRepository?: CanonicalTaskAuditRepository;
  private readonly policy: CanonicalTaskPolicy;
  private readonly operationRepository?: CanonicalTaskOperationRepository;
  private readonly clock: CanonicalTaskClock;
  private readonly baseUrl?: CanonicalTaskBaseUrl;

  constructor(options: CanonicalTaskServiceOptions) {
    if (!options?.repository) throw new Error('Canonical Task repository is required');
    this.repository = options.repository;
    this.auditRepository = options.auditRepository;
    this.policy = options.policy ?? { authorize: () => undefined };
    this.operationRepository = options.operationRepository;
    this.clock = options.clock ?? (() => new Date());
    this.baseUrl = options.baseUrl;
    if (typeof options.baseUrl === 'string' && options.baseUrl && !validHttpUrl(options.baseUrl)) {
      throw new Error('Canonical Task baseUrl must be an HTTP(S) URL');
    }
  }

  async listTasks(filters: CanonicalTaskListFilters = {}, context: CanonicalTaskContext): Promise<CanonicalTaskPage> {
    const normalizedContext = await this.normalizeContext(context);
    const normalizedFilters = this.normalizeListFilters(filters);
    await this.authorize('list', normalizedContext, undefined, normalizedFilters);
    const scoped = await this.scopeFilters('list', normalizedContext, normalizedFilters);
    const page = await this.read(() => this.repository.list(scoped));
    return {
      ...normalizePage(page, (task) => this.normalizeResponse(task)),
      as_of: this.clock().toISOString(),
    };
  }

  async searchTasks(filters: CanonicalTaskSearchFilters = {}, context: CanonicalTaskContext): Promise<CanonicalTaskSearchPage> {
    const normalizedContext = await this.normalizeContext(context);
    const normalizedFilters = this.normalizeSearchFilters(filters);
    await this.authorize('search', normalizedContext, undefined, normalizedFilters);
    const scoped = await this.scopeFilters('search', normalizedContext, normalizedFilters);
    if (typeof this.repository.search !== 'function') {
      throw new CanonicalTaskError(
        'task_search_unavailable',
        'Canonical Task search is unavailable',
        503,
      );
    }
    const page = await this.read(() => this.repository.search(scoped));
    const normalizedPage = normalizePage(page, (task) => this.normalizeResponse(task));
    return {
      ...normalizedPage,
      query: normalizedFilters.q ?? '',
      has_more: Boolean(page.hasMore ?? page.has_more),
      as_of: this.clock().toISOString(),
    };
  }

  async getTask(taskId: string, context: CanonicalTaskContext): Promise<CanonicalTaskRecord> {
    const normalizedId = normalizeString(taskId, 'task_id', { required: true, max: 200 }) as string;
    const normalizedContext = await this.normalizeContext(context);
    const task = await this.read(() => this.repository.get(normalizedId));
    if (!task) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: normalizedId });
    await this.authorize('read', normalizedContext, task);
    return this.normalizeResponse(task);
  }

  async createTask(input: CanonicalTaskCreateInput, context: CanonicalTaskContext): Promise<CanonicalTaskRecord> {
    const normalizedContext = await this.normalizeContext(context);
    const clientKey = this.requireIdempotencyKey(normalizedContext);
    const payload = this.normalizeCreateInput(input);
    await this.authorize('create', normalizedContext, undefined, payload);
    const operation = operationKey(normalizedContext.principal, clientKey, 'api:');
    const inputFingerprint = fingerprint(payload);
    const recover = async (): Promise<CanonicalTaskOperationRecovery<CanonicalTaskRecord>> => {
      const existing = await this.read(() => this.repository.findByIdempotencyKey(operation));
      if (!existing) return { recovered: false };
      const existingFingerprint = extractPersistedFingerprint(existing);
      if (existingFingerprint && existingFingerprint !== inputFingerprint) {
        throw new CanonicalTaskError('idempotency_conflict', 'The idempotency key was already used for another task', 409, {
          idempotency_key: clientKey,
        });
      }
      // Recovery is a fresh authorization boundary. A persisted operation is
      // never trusted merely because its idempotency key matches.
      await this.authorize('read', normalizedContext, existing);
      return { recovered: true, result: this.normalizeResponse(existing) };
    };
    const run = async (): Promise<CanonicalTaskRecord> => {
      const recovered = await recover();
      if (recovered.recovered && recovered.result) return recovered.result;
      const created = await this.read(() => this.repository.create({
        ...payload,
        status: 'pending',
        version: 1,
        idempotency_key: operation,
        payload_fingerprint: inputFingerprint,
      }));
      return this.normalizeResponse(created);
    };
    const result = await this.executeOperation({
      scope: 'canonical_task',
      operationKey: operation,
      fingerprint: inputFingerprint,
      projectResult: projectTaskResult,
      recover,
      run,
    });
    const normalized = this.normalizeResponse(result);
    // Audit each invocation, including a replay/recovery. The deterministic
    // entry id lets an upsert sink collapse retries without losing evidence
    // that the audit write was attempted again.
    await this.audit(
      normalizedContext,
      'canonical_task.created',
      normalized,
      { before: null, after: normalized },
      operation,
      inputFingerprint,
    );
    return normalized;
  }

  async updateTask(taskId: string, input: CanonicalTaskUpdateInput & { expected_version?: number }, expectedVersion: number, context: CanonicalTaskContext): Promise<CanonicalTaskRecord>;
  async updateTask(taskId: string, input: CanonicalTaskUpdateInput & { expected_version?: number }, context: CanonicalTaskContext): Promise<CanonicalTaskRecord>;
  async updateTask(taskId: string, input: CanonicalTaskUpdateInput & { expected_version?: number }, expectedVersionOrContext: number | CanonicalTaskContext, maybeContext?: CanonicalTaskContext): Promise<CanonicalTaskRecord> {
    const expectedVersion = typeof expectedVersionOrContext === 'number'
      ? expectedVersionOrContext
      : input.expected_version;
    const context = typeof expectedVersionOrContext === 'number' ? maybeContext : expectedVersionOrContext;
    const normalizedContext = await this.normalizeContext(context as CanonicalTaskContext);
    const patch = this.normalizeUpdateInput(input);
    const expected = this.requireExpectedVersion(expectedVersion);
    return this.versionedMutation({
      taskId,
      expectedVersion: expected,
      context: normalizedContext,
      action: 'update',
      patch,
    });
  }

  async transitionTask(taskId: string, status: unknown, expectedVersion: number, context: CanonicalTaskContext, input?: {
    waitingOn?: unknown;
    reviewAt?: unknown;
  }): Promise<CanonicalTaskRecord>;
  async transitionTask(taskId: string, input: {
    to_status?: unknown;
    expected_version?: number;
    waiting_on?: unknown;
    review_at?: unknown;
  }, context: CanonicalTaskContext): Promise<CanonicalTaskRecord>;
  async transitionTask(taskId: string, statusOrInput: unknown, expectedVersionOrContext: number | CanonicalTaskContext, maybeContext?: CanonicalTaskContext, maybeInput: {
    waitingOn?: unknown;
    reviewAt?: unknown;
  } = {}): Promise<CanonicalTaskRecord> {
    const legacyInput = statusOrInput && typeof statusOrInput === 'object' ? statusOrInput as Record<string, unknown> : null;
    const status = legacyInput ? legacyInput.to_status : statusOrInput;
    const expectedVersion = legacyInput ? legacyInput.expected_version : expectedVersionOrContext;
    const context = legacyInput ? expectedVersionOrContext : maybeContext;
    const input = legacyInput
      ? { waitingOn: legacyInput.waiting_on, reviewAt: legacyInput.review_at }
      : maybeInput;
    const normalizedContext = await this.normalizeContext(context as CanonicalTaskContext);
    const expected = this.requireExpectedVersion(expectedVersion);
    if (!isCanonicalTaskStatus(status)) failValidation({ to_status: ['invalid_status'] });
    const patch: JsonRecord = { status };
    if (status === 'waiting') {
      if (input.waitingOn == null || !String(input.waitingOn).normalize('NFKC').trim()) {
        failValidation({ waiting_on: ['required_for_waiting'] });
      }
      patch.waiting_on = normalizeString(input.waitingOn, 'waiting_on', { required: true, max: 500 });
      patch.review_at = normalizeIsoDate(input.reviewAt, 'review_at');
    } else {
      patch.waiting_on = input.waitingOn === undefined ? null : normalizeString(input.waitingOn, 'waiting_on', { max: 500 });
      patch.review_at = input.reviewAt === undefined ? null : normalizeIsoDate(input.reviewAt, 'review_at');
    }
    return this.versionedMutation({
      taskId,
      expectedVersion: expected,
      context: normalizedContext,
      action: 'transition',
      patch,
      transitionStatus: status,
    });
  }

  async deleteTask(taskId: string, expectedVersion: number, context: CanonicalTaskContext): Promise<{ task_id: string; deleted: true; version: number }>;
  async deleteTask(taskId: string, input: { expected_version?: number }, context: CanonicalTaskContext): Promise<{ task_id: string; deleted: true; version: number }>;
  async deleteTask(taskId: string, expectedVersionOrInput: number | { expected_version?: number }, context: CanonicalTaskContext): Promise<{ task_id: string; deleted: true; version: number }> {
    const normalizedId = normalizeString(taskId, 'task_id', { required: true, max: 200 }) as string;
    const normalizedContext = await this.normalizeContext(context);
    const version = this.requireExpectedVersion(typeof expectedVersionOrInput === 'number'
      ? expectedVersionOrInput
      : expectedVersionOrInput.expected_version);
    const clientKey = this.requireIdempotencyKey(normalizedContext);
    // A prepared-delete coordinator owns the durable operation lookup. Do not
    // require the row to remain visible before entering it: a completed
    // operation may legitimately recover after the delete removed the row.
    // The fallback path still performs the ordinary read and authorization
    // checks before invoking the local operation runner.
    let task: CanonicalTaskRecord | null = null;
    if (!this.operationRepository?.executePreparedDelete) {
      task = await this.read(() => this.repository.get(normalizedId));
      if (!task) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: normalizedId });
      await this.authorize('delete', normalizedContext, task);
      this.assertVersion(task, version);
    }
    // The client key identifies the delete command. The task/version claim is
    // carried separately so an operation coordinator can atomically claim the
    // exact row version without allowing another actor to replay the command.
    const operation = operationKey(normalizedContext.principal, clientKey, 'delete:');
    const versionClaimKey = `task-version:${normalizedId}:${version}`;
    const versionFingerprint = fingerprint({
      kind: 'delete',
      taskId: normalizedId,
      expectedVersion: version,
    });
    const actorNamespace = principalNamespace(normalizedContext.principal);
    const operationFingerprint = fingerprint({
      kind: 'delete',
      taskId: normalizedId,
      expectedVersion: version,
      principalNamespace: actorNamespace,
    });
    const result: CanonicalTaskDeleteResult = {
      task_id: normalizedId,
      deleted: true,
      version: version + 1,
    };
    const prepare = async (): Promise<{
      result: CanonicalTaskDeleteOperationResult;
      task: CanonicalTaskRecord;
      authorizationSnapshot: JsonRecord;
    }> => {
      const current = await this.read(() => this.repository.get(normalizedId));
      if (!current) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: normalizedId });
      await this.authorize('delete', normalizedContext, current);
      this.assertVersion(current, version);
      task = current;
      return {
        result: {
          ...result,
          _audit_source_refs: Array.isArray(current.source_refs) ? current.source_refs : [],
        },
        task: current,
        authorizationSnapshot: {
          task_id: normalizedId,
          task_version: current.version,
          actor: normalizedContext.principal,
          auth_source: normalizedContext.authSource ?? null,
        },
      };
    };
    const findTask = async (): Promise<CanonicalTaskRecord | null> =>
      this.read(() => this.repository.get(normalizedId)).then((current) => {
        if (current) task = current;
        return current;
      });
    const removeTask = async (current?: CanonicalTaskRecord): Promise<void> => {
      const taskToRemove = current ?? await this.read(() => this.repository.get(normalizedId));
      if (!taskToRemove) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: normalizedId });
      task = taskToRemove;
      // The coordinator may call removeTask after an earlier prepare step.
      // Recheck the current policy at the destructive boundary so a revoked
      // actor cannot delete a task using a previously prepared authorization.
      await this.authorize('delete', normalizedContext, taskToRemove);
      this.assertVersion(taskToRemove, version);
      await this.read(() => this.repository.delete(normalizedId, version));
    };
    let deleted: CanonicalTaskDeleteOperationResult;
    if (this.operationRepository?.executePreparedDelete) {
      deleted = await this.operationRepository.executePreparedDelete({
        scope: 'canonical_task',
        operationKey: operation,
        fingerprint: operationFingerprint,
        versionFingerprint,
        versionClaimKey,
        principalNamespace: actorNamespace,
        prepare,
        findTask,
        removeTask,
        projectResult: projectTaskResult,
      });
    } else {
      deleted = await this.executeOperation({
        scope: 'canonical_task',
        operationKey: operation,
        fingerprint: operationFingerprint,
        projectResult: projectTaskResult,
        run: async () => {
          const prepared = await prepare();
          await removeTask(prepared.task);
          return prepared.result;
        },
      });
    }
    // A completed replay may return without prepare/findTask, because the
    // durable operation result is sufficient. Keep the audit target stable in
    // that case while avoiding a second task-store read that would turn a
    // successful replay into task_not_found.
    const publicDeleted: CanonicalTaskDeleteResult = {
      task_id: deleted.task_id,
      deleted: true,
      version: deleted.version,
    };
    const auditSourceRefs = Array.isArray(task?.source_refs)
      ? task.source_refs
      : (Array.isArray(deleted._audit_source_refs) ? deleted._audit_source_refs : null);
    // A legacy completed operation may only contain the public delete result.
    // Do not synthesize source_refs: [] in that case, because an audit upsert
    // would erase the source references recorded by the original execution.
    if (!task && auditSourceRefs === null) return publicDeleted;
    const auditTask = task ?? {
      id: normalizedId,
      version,
      title: '',
      status: 'pending' as const,
      priority: 'medium' as const,
      source_refs: auditSourceRefs ?? [],
    };
    await this.audit(
      normalizedContext,
      'canonical_task.deleted',
      auditTask,
      { before: { task_id: normalizedId, version }, after: null },
      operation,
      operationFingerprint,
    );
    return publicDeleted;
  }

  private async versionedMutation(input: {
    taskId: string;
    expectedVersion: number;
    context: CanonicalTaskContext;
    action: 'update' | 'transition';
    patch: JsonRecord;
    transitionStatus?: CanonicalTaskStatus;
  }): Promise<CanonicalTaskRecord> {
    const taskId = normalizeString(input.taskId, 'task_id', { required: true, max: 200 }) as string;
    const expectedVersion = this.requireExpectedVersion(input.expectedVersion);
    const current = await this.read(() => this.repository.get(taskId));
    if (!current) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: taskId });
    await this.authorize(input.action, input.context, current, input.patch);
    const operation = operationKey(input.context.principal, `${taskId}:${expectedVersion}`, `${input.action}:`);
    const mutationTimestamp = this.clock().toISOString();
    const patch = {
      ...input.patch,
      version: expectedVersion + 1,
      updated_at: mutationTimestamp,
      ...(input.action === 'transition'
        ? { completed_at: input.transitionStatus === 'completed' ? mutationTimestamp : null }
        : {}),
    };
    // Keep this fingerprint independent of the wall clock. A restart may
    // reconstruct the same command at a different instant, while the marker
    // must still identify the already-applied mutation.
    const operationFingerprint = fingerprint({
      action: input.action,
      taskId,
      expectedVersion,
      patch: input.patch,
      transitionStatus: input.transitionStatus ?? null,
      principal: input.context.principal,
    });
    const wasApplied = (candidate: CanonicalTaskRecord): boolean =>
      candidate.version === expectedVersion + 1
      && candidate._last_operation_key === operation
      && candidate._last_operation_fingerprint === operationFingerprint;
    if (!wasApplied(current)) {
      this.assertVersion(current, expectedVersion);
      if (input.transitionStatus && !canTransitionCanonicalTaskStatus(current.status, input.transitionStatus)) {
        throw new CanonicalTaskError('invalid_transition', `Cannot transition task from ${current.status} to ${input.transitionStatus}`, 409, {
          from: current.status,
          to: input.transitionStatus,
        }, { currentTask: this.normalizeResponse(current) });
      }
    }
    const recover = async (): Promise<CanonicalTaskOperationRecovery<CanonicalTaskRecord>> => {
      const latest = await this.read(() => this.repository.get(taskId));
      if (!latest) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: taskId });
      await this.authorize(input.action, input.context, latest, input.patch);
      if (wasApplied(latest)) return { recovered: true, result: this.normalizeResponse(latest) };
      this.assertVersion(latest, expectedVersion);
      if (input.transitionStatus && !canTransitionCanonicalTaskStatus(latest.status, input.transitionStatus)) {
        throw new CanonicalTaskError('invalid_transition', `Cannot transition task from ${latest.status} to ${input.transitionStatus}`, 409, {
          from: latest.status,
          to: input.transitionStatus,
        }, { currentTask: this.normalizeResponse(latest) });
      }
      return { recovered: false };
    };
    const run = async (): Promise<CanonicalTaskRecord> => {
      const latest = await this.read(() => this.repository.get(taskId));
      if (!latest) throw new CanonicalTaskError('task_not_found', 'Task was not found', 404, { task_id: taskId });
      if (wasApplied(latest)) return this.normalizeResponse(latest);
      this.assertVersion(latest, expectedVersion);
      if (input.transitionStatus && !canTransitionCanonicalTaskStatus(latest.status, input.transitionStatus)) {
        throw new CanonicalTaskError('invalid_transition', `Cannot transition task from ${latest.status} to ${input.transitionStatus}`, 409, {
          from: latest.status,
          to: input.transitionStatus,
        }, { currentTask: this.normalizeResponse(latest) });
      }
      const updated = await this.read(() => this.repository.update(taskId, {
        ...patch,
        _last_operation_key: operation,
        _last_operation_fingerprint: operationFingerprint,
      }));
      return this.normalizeResponse(updated);
    };
    const result = await this.executeOperation({
      scope: 'canonical_task',
      operationKey: operation,
      fingerprint: operationFingerprint,
      projectResult: projectTaskResult,
      recover,
      run,
    });
    const normalized = this.normalizeResponse(result);
    const auditAction: CanonicalTaskAuditAction = input.action === 'update'
      ? 'canonical_task.updated'
      : 'canonical_task.transitioned';
    const changes: JsonRecord = input.action === 'update'
      ? {
          before: { version: expectedVersion },
          after: { version: normalized.version },
          fields: input.patch,
        }
      : {
          before: { version: expectedVersion },
          after: { status: normalized.status, version: normalized.version },
          transition: {
            to_status: input.transitionStatus,
            ...(input.patch.waiting_on !== undefined ? { waiting_on: input.patch.waiting_on } : {}),
            ...(input.patch.review_at !== undefined ? { review_at: input.patch.review_at } : {}),
          },
        };
    await this.audit(input.context, auditAction, normalized, changes, operation, operationFingerprint);
    return normalized;
  }

  private normalizeCreateInput(input: CanonicalTaskCreateInput): JsonRecord {
    if (!input || typeof input !== 'object') fail('validation_error', 'Task input is required');
    const unknownFields = Object.keys(input).filter((field) => !CREATE_FIELDS.has(field));
    if (unknownFields.length > 0) fail('validation_error', 'Task input contains unsupported fields', 400, { fields: unknownFields });
    const title = normalizeString(input.title, 'title', { required: true, max: MAX_TITLE_LENGTH }) as string;
    const priority = input.priority == null || input.priority === '' ? 'medium' : String(input.priority);
    if (!isCanonicalTaskPriority(priority)) fail('validation_error', 'priority is invalid', 400, { field: 'priority' });
    return {
      title,
      description: normalizeString(input.description, 'description', { max: 10000, multiline: true }),
      priority,
      assignee_person_id: normalizeString(input.assignee_person_id, 'assignee_person_id', { max: 200 }),
      due_at: normalizeIsoDate(input.due_at, 'due_at'),
      waiting_on: normalizeString(input.waiting_on, 'waiting_on', { max: 500 }),
      review_at: normalizeIsoDate(input.review_at, 'review_at'),
      source_refs: normalizeSourceRefs(input.source_refs) ?? [],
      project_codes: normalizeProjectCodes(input.project_codes) ?? [],
    };
  }

  private normalizeUpdateInput(input: CanonicalTaskUpdateInput): JsonRecord {
    if (!input || typeof input !== 'object') fail('validation_error', 'Task update is required');
    const unknownFields = Object.keys(input).filter((field) => !MUTABLE_FIELDS.has(field));
    if (unknownFields.length > 0) fail('validation_error', 'Task update contains unsupported fields', 400, { fields: unknownFields });
    const patch: JsonRecord = {};
    if ('title' in input) patch.title = normalizeString(input.title, 'title', { required: true, max: MAX_TITLE_LENGTH });
    if ('description' in input) patch.description = normalizeString(input.description, 'description', { max: 10000, multiline: true });
    if ('priority' in input) {
      const priority = input.priority == null || input.priority === '' ? null : String(input.priority);
      if (priority != null && !isCanonicalTaskPriority(priority)) fail('validation_error', 'priority is invalid', 400, { field: 'priority' });
      patch.priority = priority;
    }
    if ('assignee_person_id' in input) patch.assignee_person_id = normalizeString(input.assignee_person_id, 'assignee_person_id', { max: 200 });
    if ('due_at' in input) patch.due_at = normalizeIsoDate(input.due_at, 'due_at');
    if ('waiting_on' in input) patch.waiting_on = normalizeString(input.waiting_on, 'waiting_on', { max: 500 });
    if ('review_at' in input) patch.review_at = normalizeIsoDate(input.review_at, 'review_at');
    if ('source_refs' in input) patch.source_refs = normalizeSourceRefs(input.source_refs) ?? [];
    if ('project_codes' in input) patch.project_codes = normalizeProjectCodes(input.project_codes) ?? [];
    if (Object.keys(patch).length === 0) fail('validation_error', 'Task update must include at least one mutable field');
    return patch;
  }

  private normalizeListFilters(filters: CanonicalTaskListFilters): CanonicalTaskListFilters {
    const {
      status: _status,
      priority: _priority,
      projectCode: _projectCode,
      project_code: _project_code,
      ...canonicalFilters
    } = filters;
    const statuses = normalizeCollection(filters.statuses ?? filters.status, 'statuses');
    const priorities = normalizeCollection(filters.priorities ?? filters.priority, 'priorities');
    const projectCodes = normalizeProjectCodes(filters.projectCodes ?? filters.projectCode ?? filters.project_code);
    return {
      ...canonicalFilters,
      statuses,
      priorities,
      projectCodes,
      assigneePersonId: normalizeString(filters.assigneePersonId, 'assigneePersonId', { max: 200 }),
      dueAfter: normalizeIsoDate(filters.dueAfter, 'dueAfter'),
      dueBefore: normalizeIsoDate(filters.dueBefore, 'dueBefore'),
      limit: normalizeLimit(filters.limit),
      cursor: normalizeCursor(filters.cursor),
    };
  }

  private normalizeSearchFilters(filters: CanonicalTaskSearchFilters): CanonicalTaskSearchFilters {
    const normalized = this.normalizeListFilters(filters);
    const rawQuery = filters.q ?? filters.query;
    const query = typeof rawQuery === 'string' ? rawQuery.normalize('NFKC').trim() : '';
    if (!query) failValidation({ query: ['required'] });
    if (/[\u0000-\u001f\u007f]/u.test(query)) failValidation({ query: ['contains_control_characters'] });
    if (query.length > MAX_SEARCH_LENGTH) failValidation({ query: ['too_long'] });
    const q = normalizeString(query, 'query', { required: true, max: MAX_SEARCH_LENGTH }) as string;
    const tokens = q.split(/\s+/u).filter(Boolean);
    const limit = normalizeLimit(filters.limit, 20);
    return { ...normalized, q, query: q, tokens, limit };
  }

  private async normalizeContext(context: CanonicalTaskContext): Promise<CanonicalTaskContext> {
    if (!context || typeof context !== 'object') {
      throw new CanonicalTaskError('unauthenticated_context', 'A task context is required', 401);
    }
    let normalized: CanonicalTaskContext;
    try {
      normalized = {
        ...context,
        principal: normalizeCanonicalTaskPrincipal(context.principal),
      };
    } catch (error) {
      throw new CanonicalTaskError('unauthenticated_context', error instanceof Error ? error.message : 'Principal is invalid', 401);
    }
    const fromPolicy = this.policy.normalizeContext
      ? await this.policy.normalizeContext(normalized)
      : normalized;
    try {
      return { ...fromPolicy, principal: normalizeCanonicalTaskPrincipal(fromPolicy.principal) };
    } catch (error) {
      throw new CanonicalTaskError('unauthenticated_context', error instanceof Error ? error.message : 'Principal is invalid', 401);
    }
  }

  private async authorize(action: CanonicalTaskAction, context: CanonicalTaskContext, task?: CanonicalTaskRecord | null, input?: unknown): Promise<void> {
    await this.policy.authorize({ action, context, task, input });
  }

  private async scopeFilters<T extends CanonicalTaskListFilters | CanonicalTaskSearchFilters>(operation: 'list' | 'search', context: CanonicalTaskContext, filters: T): Promise<T> {
    if (!this.policy.scopeFilters) return filters;
    const scoped = await this.policy.scopeFilters({ operation, context, filters });
    return { ...filters, ...(scoped ?? {}) } as T;
  }

  private requireIdempotencyKey(context: CanonicalTaskContext): string {
    const key = normalizeString(context.idempotencyKey, 'idempotency_key', { required: true, max: 200 }) as string;
    if (RESERVED_IDEMPOTENCY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      fail('validation_error', 'idempotency_key uses a reserved prefix', 400, { field: 'idempotency_key' });
    }
    return key;
  }

  private requireExpectedVersion(value: unknown): number {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1) fail('validation_error', 'expected_version must be a positive integer', 400, { field: 'expected_version' });
    return version;
  }

  private assertVersion(task: CanonicalTaskRecord, expectedVersion: number): void {
    if (task.version !== expectedVersion) {
      throw new CanonicalTaskError('version_conflict', 'Task version is stale', 409, {
        expected_version: expectedVersion,
        actual_version: task.version,
      }, { currentTask: this.normalizeResponse(task) });
    }
  }

  private async executeOperation<T>(request: CanonicalTaskOperationRequest<T>): Promise<T> {
    return this.operationRepository
      ? this.operationRepository.execute(request)
      : request.run();
  }

  private async audit(
    context: CanonicalTaskContext,
    action: CanonicalTaskAuditAction,
    task: CanonicalTaskRecord,
    changes: JsonRecord,
    operationKey: string,
    operationFingerprint: string,
  ): Promise<void> {
    if (!this.auditRepository) return;
    const actor = context.auditPrincipal
      ? normalizeCanonicalTaskPrincipal(context.auditPrincipal)
      : context.principal;
    const entry: CanonicalTaskAuditEntry = {
      // The operation identity, rather than the returned task payload, is the
      // replay key. A retried command therefore upserts the same audit row
      // even when a repository adds timestamps or other response fields.
      id: `canonical-task:${fingerprint({ action, operationKey, operationFingerprint })}`,
      actor,
      actor_id: actor.id,
      actor_type: actor.type,
      actor_principal: actor,
      actor_namespace: principalNamespace(actor),
      auth_source: context.auditAuthSource ?? context.authSource ?? null,
      action,
      target_type: 'canonical_task',
      target_id: task.id,
      changes,
      source_refs: Array.isArray(task.source_refs) ? task.source_refs : [],
    };
    try {
      await this.auditRepository.upsertAuditLog(entry);
    } catch {
      throw new CanonicalTaskError('task_audit_unavailable', 'Task audit is unavailable', 503);
    }
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof CanonicalTaskError) throw error;
      // Keep the fail-closed backend selection contract observable to the
      // host boundary while still hiding arbitrary storage details.
      if (error && typeof error === 'object'
        && (error as { code?: unknown }).code === 'canonical_task_backend_not_configured') {
        throw new CanonicalTaskError(
          'canonical_task_backend_not_configured',
          'Canonical Task backend is not configured',
          503,
        );
      }
      throw new CanonicalTaskError('task_store_unavailable', 'Task store is unavailable', 503);
    }
  }

  private normalizeResponse(task: CanonicalTaskRecord): CanonicalTaskRecord {
    const response = { ...task } as CanonicalTaskRecord & JsonRecord;
    delete response._payload_fingerprint;
    delete response._last_operation_key;
    delete response._last_operation_fingerprint;
    const baseUrl = typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl;
    const existingUrl = validHttpUrl(response.web_url);
    const fallbackBaseUrl = validHttpUrl(baseUrl);
    response.web_url = existingUrl
      ?? (fallbackBaseUrl ? `${fallbackBaseUrl.replace(/\/$/u, '')}/api/tasks/${encodeURIComponent(task.id)}` : null);
    if (response.description === undefined) response.description = null;
    if (response.assignee_person_id === undefined) response.assignee_person_id = null;
    if (response.due_at === undefined) response.due_at = null;
    if (response.waiting_on === undefined) response.waiting_on = null;
    if (response.review_at === undefined) response.review_at = null;
    if (response.completed_at === undefined) response.completed_at = null;
    if (response.source_refs === undefined) response.source_refs = [];
    if (response.project_codes === undefined) response.project_codes = [];
    return response;
  }
}
