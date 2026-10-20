import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

export interface CanonicalTaskPgQueryResult {
  rows: any[];
  rowCount?: number | null;
}

export interface CanonicalTaskPgClient {
  query(text: string, values?: unknown[]): Promise<CanonicalTaskPgQueryResult>;
  release?(): void;
}

/** A node-postgres compatible pool. `connect` is needed for guarded updates. */
export interface CanonicalTaskPgPool extends CanonicalTaskPgClient {
  connect?(): Promise<CanonicalTaskPgClient>;
}

/** Identifies rows imported from an earlier table. Tenant configuration, never a default. */
export interface CanonicalTaskLegacyIdentity {
  baseId: string;
  tableId: string;
}

export interface CanonicalTaskTaskLocator {
  column: 'id' | 'legacy_nocodb_id';
  value: string;
}

/**
 * Host-supplied visibility for list and search. It reads the filters the
 * host policy put there (for example a verified organization scope) and
 * returns one SQL condition over `canonical_tasks`, or null. `param` appends a
 * value and returns its placeholder. The adapter does not interpret it.
 */
export type CanonicalTaskScopeCondition = (input: {
  filters: JsonRecord;
  param: (value: unknown) => string;
}) => string | null | undefined;

/**
 * Checked inside the transaction that holds the Task row lock, before an
 * update that completes a Task or changes its completion contract. A host
 * whose typed children (for example agent delegations) take the same row lock
 * can refuse the mutation by throwing; the error reaches the caller unchanged.
 */
export interface CanonicalTaskMutationGuard {
  check(input: {
    client: CanonicalTaskPgClient;
    rowId: string;
    patch: JsonRecord;
    completes: boolean;
    changesCompletionContract: boolean;
  }): Promise<void>;
}

export interface CanonicalTaskPostgresRepositoryOptions {
  pool: CanonicalTaskPgPool;
  schemaVersion: string;
  idSecret: string;
  legacyIdentity?: CanonicalTaskLegacyIdentity | null;
  webBaseUrl?: string | null;
  scopeCondition?: CanonicalTaskScopeCondition | null;
  mutationGuard?: CanonicalTaskMutationGuard | null;
  /** Error codes a mutation guard may raise that must pass through unwrapped. */
  passthroughErrorCodes?: Iterable<string>;
}

export interface CanonicalTaskPurposeLabels {
  labels: Array<{ purpose_label: string; task_count: number }>;
  truncated: boolean;
}

const STATUSES = new Set(['pending', 'in_progress', 'waiting', 'completed', 'cancelled']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const SEARCH_CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTABLE_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assignee_person_id: 'assignee_person_id',
  assignee_display_name: 'assignee_display_name',
  due_at: 'due_at',
  waiting_on: 'waiting_on',
  waiting_on_person_id: 'waiting_on_person_id',
  review_at: 'review_at',
  completed_at: 'completed_at',
  source_refs: 'source_refs',
  project_codes: 'project_codes',
  purpose_label: 'purpose_label',
  completion_contract: 'completion_contract',
  version: 'version',
  idempotency_key: 'idempotency_key',
  payload_fingerprint: 'payload_fingerprint',
  last_operation_key: 'last_operation_key',
  last_operation_fingerprint: 'last_operation_fingerprint',
});

/** Errors that keep their meaning across the store boundary. */
const PASSTHROUGH_ERROR_CODES = new Set([
  'task_not_found',
  'validation_failed',
  'version_conflict',
]);

function storeError(code: string, message: string, status: number, extra: JsonRecord = {}): Error & JsonRecord {
  const error = new Error(message) as Error & JsonRecord;
  Object.assign(error, { code, status, ...extra });
  return error;
}

export function encodeCanonicalTaskCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), 'utf8').toString('base64url');
}

export function decodeCanonicalTaskCursor(cursor: unknown): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (value?.v !== 1 || !Number.isInteger(value.offset) || value.offset < 0) throw new Error();
    return value.offset;
  } catch {
    throw storeError('validation_failed', 'Invalid cursor', 422, { fieldErrors: { cursor: ['invalid_cursor'] } });
  }
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function encodeSearchCursor(row: JsonRecord): string {
  return Buffer.from(JSON.stringify({ v: 1, created_at: isoOrNull(row.created_at), id: String(row.id) }), 'utf8')
    .toString('base64url');
}

function decodeSearchCursor(cursor: unknown): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const createdAt = isoOrNull(decoded.created_at);
    if (decoded.v !== 1 || !createdAt || !SEARCH_CURSOR_ID.test(String(decoded.id || ''))) throw new Error();
    return { createdAt, id: String(decoded.id) };
  } catch {
    throw storeError('validation_failed', 'Canonical Task search cursor is invalid', 422, {
      fieldErrors: { cursor: ['invalid_cursor'] },
    });
  }
}

function escapeLikeToken(value: unknown): string {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function normalizeSourceReferences(value: unknown): { references: unknown[]; warnings: JsonRecord[] } {
  if (Array.isArray(value)) return { references: value, warnings: [] };
  if (value == null) return { references: [], warnings: [] };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return { references: parsed, warnings: [] };
  } catch {
    // Report invalid persisted data to the caller instead of hiding it.
  }
  return {
    references: [],
    warnings: [{ code: 'invalid_source_refs_shape', message: 'Task source references must be an array' }],
  };
}

function notFound() {
  return storeError('task_not_found', 'Task not found', 404);
}

function versionConflict(currentTask: unknown) {
  return storeError('version_conflict', 'Task version is stale', 409, { currentTask });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Canonical Task PostgreSQL ${name} is required`);
  return value;
}

/** The disabled backend: every operation reports that no store is configured. */
export class CanonicalTaskUnavailableRepository {
  private unavailable(): never {
    throw storeError('canonical_task_backend_not_configured', 'CANONICAL_TASK_BACKEND is not configured', 503);
  }
  assertAvailable(): never { return this.unavailable(); }
  list(): never { return this.unavailable(); }
  search(): never { return this.unavailable(); }
  get(): never { return this.unavailable(); }
  findByIdempotencyKey(): never { return this.unavailable(); }
  create(): never { return this.unavailable(); }
  update(): never { return this.unavailable(); }
  delete(): never { return this.unavailable(); }
  listPurposeLabels(): never { return this.unavailable(); }
}

/**
 * PostgreSQL persistence for Canonical Tasks (`canonical_tasks`, see
 * `contracts/canonical-task/store-schema.sql`).
 *
 * Task IDs are opaque HMAC-signed `ct1.` tokens. The adapter does not decide
 * who may see a Task: list/search visibility comes from the host's
 * `scopeCondition`, and authorization stays in the service policy.
 */
export class CanonicalTaskPostgresRepository {
  /**
   * PostgreSQL is a durable mutation boundary. Services must bind it to the
   * persisted release readiness gate before exposing mutations.
   */
  readonly requiresReadiness = true;
  readonly pool: CanonicalTaskPgPool;
  readonly schemaVersion: string;
  readonly legacyIdentity: CanonicalTaskLegacyIdentity | null;
  readonly webBaseUrl: string | null;
  private readonly idSecret: string;
  private readonly scopeCondition: CanonicalTaskScopeCondition | null;
  private readonly mutationGuard: CanonicalTaskMutationGuard | null;
  private readonly passthroughErrorCodes: Set<string>;

  constructor(options: CanonicalTaskPostgresRepositoryOptions) {
    if (!options?.pool) throw new Error('Canonical Task PostgreSQL pool is required');
    this.pool = options.pool;
    this.schemaVersion = requireString(options.schemaVersion, 'schema version');
    this.idSecret = requireString(options.idSecret, 'opaque ID secret');
    const legacy = options.legacyIdentity ?? null;
    if (legacy) {
      requireString(legacy.baseId, 'legacy base ID');
      requireString(legacy.tableId, 'legacy table ID');
    }
    this.legacyIdentity = legacy ? Object.freeze({ baseId: legacy.baseId, tableId: legacy.tableId }) : null;
    this.webBaseUrl = options.webBaseUrl ?? null;
    this.scopeCondition = options.scopeCondition ?? null;
    this.mutationGuard = options.mutationGuard ?? null;
    this.passthroughErrorCodes = new Set([...PASSTHROUGH_ERROR_CODES, ...(options.passthroughErrorCodes ?? [])]);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.idSecret).update(payload).digest('base64url');
  }

  private encodePayload(value: JsonRecord): string {
    const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    return `ct1.${payload}.${this.sign(payload)}`;
  }

  /** The public ID of a stored row. */
  encodeTaskId(row: { id?: unknown; legacy_nocodb_id?: unknown }): string {
    if (row.legacy_nocodb_id && this.legacyIdentity) {
      return this.encodePayload({
        v: this.schemaVersion,
        b: this.legacyIdentity.baseId,
        t: this.legacyIdentity.tableId,
        r: String(row.legacy_nocodb_id),
      });
    }
    return this.encodePayload({ v: this.schemaVersion, s: 'postgres', r: String(row.id) });
  }

  /** The stored row a public ID names. A tampered or foreign ID is task_not_found. */
  decodeTaskLocator(taskId: unknown): CanonicalTaskTaskLocator {
    try {
      const [prefix, payload, signature] = String(taskId).split('.');
      if (prefix !== 'ct1' || !payload || !signature) throw new Error();
      const actual = Buffer.from(signature);
      const expected = Buffer.from(this.sign(payload));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (decoded.v !== this.schemaVersion || !decoded.r) throw new Error();
      if (decoded.s === 'postgres') return { column: 'id', value: String(decoded.r) };
      if (this.legacyIdentity && decoded.b === this.legacyIdentity.baseId && decoded.t === this.legacyIdentity.tableId) {
        return { column: 'legacy_nocodb_id', value: String(decoded.r) };
      }
      throw new Error();
    } catch {
      throw notFound();
    }
  }

  normalize(row: JsonRecord | null | undefined): JsonRecord | null {
    if (!row) return null;
    const warnings: JsonRecord[] = [];
    let status = row.status;
    let priority = row.priority;
    if (!STATUSES.has(status as string)) {
      warnings.push({ code: 'unknown_status', message: `Unknown Task status: ${status || ''}` });
      status = String(status || 'unknown');
    }
    if (!PRIORITIES.has(priority as string)) {
      warnings.push({ code: 'unknown_priority', message: `Unknown Task priority: ${priority || ''}` });
      priority = String(priority || 'unknown');
    }
    if (!row.assignee_person_id && row.assignee_display_name) {
      warnings.push({ code: 'assignee_unresolved', message: 'Legacy assignee has no Graph person ID' });
    }
    const sourceReferences = normalizeSourceReferences(row.source_refs);
    warnings.push(...sourceReferences.warnings);
    const id = this.encodeTaskId(row);
    const task: JsonRecord = {
      id,
      version: Number(row.version ?? 1),
      title: String(row.title ?? ''),
      description: row.description ?? null,
      status,
      priority,
      project_codes: Array.isArray(row.project_codes) ? row.project_codes : [],
      purpose_label: row.purpose_label ?? null,
      completion_contract: row.completion_contract ?? null,
      assignee_person_id: row.assignee_person_id ?? null,
      assignee_display_name: row.assignee_display_name ?? null,
      due_at: isoOrNull(row.due_at),
      waiting_on: row.waiting_on ?? null,
      waiting_on_person_id: row.waiting_on_person_id ?? null,
      review_at: isoOrNull(row.review_at),
      completed_at: isoOrNull(row.completed_at),
      source_refs: sourceReferences.references,
      created_at: isoOrNull(row.created_at) || new Date(0).toISOString(),
      updated_at: isoOrNull(row.updated_at) || new Date(0).toISOString(),
      web_url: this.webBaseUrl
        ? new URL(`/api/companion/tasks/${encodeURIComponent(id)}`, this.webBaseUrl).toString()
        : null,
      normalization_warnings: warnings,
    };
    Object.defineProperties(task, {
      _payload_fingerprint: { value: row.payload_fingerprint ?? null, enumerable: false },
      _last_operation_key: { value: row.last_operation_key ?? null, enumerable: false },
      _last_operation_fingerprint: { value: row.last_operation_fingerprint ?? null, enumerable: false },
    });
    return task;
  }

  /** Store failures become task_store_unavailable; meaningful errors pass through. */
  private unavailable(error: any): Error {
    if (this.passthroughErrorCodes.has(error?.code)) return error;
    return storeError('task_store_unavailable', 'PostgreSQL Task store is unavailable', 503, { cause: error });
  }

  async query(text: string, values: unknown[] = []): Promise<CanonicalTaskPgQueryResult> {
    try {
      return await this.pool.query(text, values);
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  async withTransaction<T>(callback: (client: CanonicalTaskPgClient) => Promise<T>): Promise<T> {
    if (typeof this.pool.connect !== 'function') {
      throw this.unavailable(new Error('PostgreSQL transaction client is unavailable'));
    }
    let client: CanonicalTaskPgClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client?.query('ROLLBACK'); } catch { /* preserve transaction error */ }
      throw this.unavailable(error);
    } finally {
      client?.release?.();
    }
  }

  private rejectStorageScope(storageScope: unknown): void {
    // This adapter keeps one table per store. Accepting a policy storage
    // scope here would silently mix scopes, so refuse it.
    if (storageScope !== undefined) {
      throw storeError('task_storage_scope_unsupported', 'The PostgreSQL Task store does not partition by storage scope', 503);
    }
  }

  private visibility(filters: JsonRecord, param: (value: unknown) => string): string | null {
    if (!this.scopeCondition) return null;
    const condition = this.scopeCondition({ filters, param });
    return typeof condition === 'string' && condition.trim() ? `(${condition})` : null;
  }

  async list(filters: JsonRecord = {}, storageScope?: string): Promise<JsonRecord> {
    this.rejectStorageScope(storageScope);
    const statuses = (filters.statuses as string[] | undefined) ?? [];
    const priorities = (filters.priorities as string[] | undefined) ?? [];
    const projectCodes = (filters.projectCodes as string[] | undefined) ?? [];
    const { assigneePersonId, dueAfter, dueBefore, cursor } = filters;
    const limit = Number(filters.limit ?? 50);
    const offset = decodeCanonicalTaskCursor(cursor);
    const conditions: string[] = [];
    const values: unknown[] = [];
    const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const add = (sql: string, value: unknown) => conditions.push(sql.replace('?', param(value)));
    if (statuses.length) add('status = ANY(?::text[])', statuses);
    if (priorities.length) add('priority = ANY(?::text[])', priorities);
    if (projectCodes.length) add('project_codes && ?::text[]', projectCodes);
    if (assigneePersonId != null && assigneePersonId !== '') add('assignee_person_id = ?', assigneePersonId);
    if (dueAfter) add('due_at >= ?::timestamptz', dueAfter);
    if (dueBefore) add('due_at <= ?::timestamptz', dueBefore);
    const visible = this.visibility(filters, param);
    if (visible) conditions.push(visible);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await this.query(`SELECT COUNT(*)::integer AS count FROM canonical_tasks ${where}`, values);
    const rows = await this.query(
      `SELECT * FROM canonical_tasks ${where}
       ORDER BY created_at ASC, id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const totalCount = Number(countResult.rows[0]?.count || 0);
    return {
      items: rows.rows.map((row) => this.normalize(row)),
      totalCount,
      countStatus: 'exact',
      readStatus: 'complete',
      nextCursor: offset + rows.rows.length < totalCount ? encodeCanonicalTaskCursor(offset + rows.rows.length) : null,
    };
  }

  async search(filters: JsonRecord = {}, storageScope?: string): Promise<JsonRecord> {
    this.rejectStorageScope(storageScope);
    const tokens = (filters.tokens as string[] | undefined) ?? [];
    const statuses = (filters.statuses as string[] | undefined) ?? [];
    const priorities = (filters.priorities as string[] | undefined) ?? [];
    const projectCodes = (filters.projectCodes as string[] | undefined) ?? [];
    const { assigneePersonId } = filters;
    const limit = Number(filters.limit ?? 20);
    const after = decodeSearchCursor(filters.cursor);
    const conditions: string[] = [];
    const values: unknown[] = [];
    const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const add = (sql: string, value: unknown) => conditions.push(sql.replace('?', param(value)));
    for (const token of tokens) add("title ILIKE ? ESCAPE E'\\\\'", `%${escapeLikeToken(token)}%`);
    if (statuses.length) add('status = ANY(?::text[])', statuses);
    if (priorities.length) add('priority = ANY(?::text[])', priorities);
    if (projectCodes.length) add('project_codes && ?::text[]', projectCodes);
    if (assigneePersonId != null && assigneePersonId !== '') add('assignee_person_id = ?', assigneePersonId);
    const visible = this.visibility(filters, param);
    if (visible) conditions.push(visible);
    if (after) {
      const createdAt = param(after.createdAt);
      const id = param(after.id);
      conditions.push(`(created_at, id) < (${createdAt}::timestamptz, ${id}::uuid)`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit + 1);
    const result = await this.query(
      `SELECT * FROM canonical_tasks ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map((row) => this.normalize(row)),
      totalCount: null,
      countStatus: 'not_requested',
      readStatus: 'complete',
      hasMore,
      nextCursor: hasMore && rows.length ? encodeSearchCursor(rows.at(-1)) : null,
    };
  }

  async get(taskId: string, storageScope?: string): Promise<JsonRecord | null> {
    this.rejectStorageScope(storageScope);
    const locator = this.decodeTaskLocator(taskId);
    const result = await this.query(`SELECT * FROM canonical_tasks WHERE ${locator.column} = $1 LIMIT 1`, [locator.value]);
    return this.normalize(result.rows[0] || null);
  }

  /** Tasks one meeting run created in one project, matched on the source reference. */
  async listByMeetingMinutesRun({ projectCode, runId, limit = 50 }: { projectCode?: unknown; runId?: unknown; limit?: number } = {}) {
    if (typeof projectCode !== 'string' || !projectCode || typeof runId !== 'string' || !runId) return [];
    const result = await this.query(
      `SELECT * FROM canonical_tasks
       WHERE project_codes && $1::text[]
         AND source_refs @> $2::jsonb
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [[projectCode], JSON.stringify([{ type: 'meeting_minutes', run_id: runId }]), limit],
    );
    return result.rows.map((row) => this.normalize(row));
  }

  async findByIdempotencyKey(key: string, storageScope?: string): Promise<JsonRecord | null> {
    this.rejectStorageScope(storageScope);
    const result = await this.query('SELECT * FROM canonical_tasks WHERE idempotency_key = $1 LIMIT 1', [key]);
    return this.normalize(result.rows[0] || null);
  }

  private buildInsert(input: JsonRecord): { sql: string; values: unknown[] } {
    const columns: Array<[string, unknown, string?]> = [
      ['id', randomUUID()],
      ['title', input.title],
      ['description', input.description ?? null],
      ['status', input.status],
      ['priority', input.priority],
      ['assignee_person_id', input.assignee_person_id ?? null],
      ['assignee_display_name', input.assignee_display_name ?? null],
      ['due_at', input.due_at ?? null],
      ['waiting_on', input.waiting_on ?? null],
      ['review_at', input.review_at ?? null],
      ['completed_at', input.completed_at ?? null],
      ['source_refs', JSON.stringify(input.source_refs ?? []), '::jsonb'],
      ['project_codes', input.project_codes ?? [], '::text[]'],
      // Written only when given, so creating a Task keeps working on a
      // database where an additive column has not been added yet.
      ...(input.purpose_label != null ? [['purpose_label', input.purpose_label] as [string, unknown]] : []),
      ...(input.waiting_on_person_id != null ? [['waiting_on_person_id', input.waiting_on_person_id] as [string, unknown]] : []),
      ...(input.completion_contract != null
        ? [['completion_contract', JSON.stringify(input.completion_contract), '::jsonb'] as [string, unknown, string]]
        : []),
      ['version', input.version ?? 1],
      ['idempotency_key', input.idempotency_key],
      ['payload_fingerprint', input.payload_fingerprint ?? null],
      ['last_operation_key', input.last_operation_key ?? null],
      ['last_operation_fingerprint', input.last_operation_fingerprint ?? null],
    ];
    return {
      sql: `INSERT INTO canonical_tasks (${columns.map(([column]) => column).join(', ')})
       VALUES (${columns.map(([, , cast = ''], index) => `$${index + 1}${cast}`).join(', ')})
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      values: columns.map(([, value]) => value),
    };
  }

  async create(input: JsonRecord, storageScope?: string): Promise<JsonRecord> {
    this.rejectStorageScope(storageScope);
    const { sql, values } = this.buildInsert(input);
    const result = await this.query(sql, values);
    if (result.rows[0]) return this.normalize(result.rows[0])!;
    return (await this.findByIdempotencyKey(String(input.idempotency_key)))!;
  }

  /**
   * Create the Task and run its audit writer in one transaction. A throwing
   * writer rolls back the Task insert; the caller maps the audit error.
   */
  async createWithAudit(
    input: JsonRecord,
    runAudit: (created: JsonRecord, client: CanonicalTaskPgClient) => Promise<void>,
    storageScope?: string,
  ): Promise<JsonRecord> {
    this.rejectStorageScope(storageScope);
    if (typeof this.pool.connect !== 'function') {
      throw this.unavailable(new Error('PostgreSQL transaction client is unavailable'));
    }
    const { sql, values } = this.buildInsert(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(sql, values);
      const row = result.rows[0] ?? (await client.query(
        'SELECT * FROM canonical_tasks WHERE idempotency_key = $1 LIMIT 1',
        [input.idempotency_key],
      )).rows[0];
      if (!row) throw storeError('task_store_unavailable', 'PostgreSQL Task store is unavailable', 503);
      const created = this.normalize(row)!;
      await runAudit(created, client);
      await client.query('COMMIT');
      return created;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve transaction error */ }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async update(taskId: string, patch: JsonRecord, storageScope?: string): Promise<JsonRecord> {
    this.rejectStorageScope(storageScope);
    // The public kernel marks an applied mutation with `_last_operation_key`
    // and `_last_operation_fingerprint`. Persist them, or a retried update
    // cannot be recognized as already applied and fails as a stale version.
    const input: JsonRecord = {
      ...patch,
      last_operation_key: patch.last_operation_key ?? patch._last_operation_key,
      last_operation_fingerprint: patch.last_operation_fingerprint ?? patch._last_operation_fingerprint,
    };
    const locator = this.decodeTaskLocator(taskId);
    const entries = Object.entries(MUTABLE_COLUMNS).filter(([field]) => input[field] !== undefined);
    if (!entries.length) return (await this.get(taskId))!;
    // The kernel sends the next row version after validating the caller's
    // expected_version. Convert it back so the UPDATE itself stays atomic.
    // Legacy IDs keep their historical unversioned update behavior.
    const proposedVersion = Number(input.version);
    const expectedVersion = locator.column === 'id' && Number.isSafeInteger(proposedVersion) && proposedVersion > 1
      ? proposedVersion - 1
      : null;
    const values: unknown[] = entries.map(([field]) => {
      if (field === 'completion_contract') return input[field] == null ? null : JSON.stringify(input[field]);
      return field === 'source_refs' ? JSON.stringify(input[field]) : input[field];
    });
    const assignments = entries.map(([field, column], index) => `${column} = $${index + 1}${
      field === 'source_refs' || field === 'completion_contract' ? '::jsonb' : field === 'project_codes' ? '::text[]' : ''
    }`);
    values.push(locator.value);
    const locatorParameter = values.length;
    if (expectedVersion !== null) values.push(expectedVersion);
    const versionParameter = values.length;

    const apply = async (client: CanonicalTaskPgClient) => {
      const result = await client.query(
        `UPDATE canonical_tasks
         SET ${assignments.join(', ')}, updated_at = NOW()
         WHERE ${locator.column} = $${locatorParameter}
         ${expectedVersion === null ? '' : `AND version = $${versionParameter}`}
         RETURNING *`,
        values,
      );
      if (result.rows[0]) return this.normalize(result.rows[0])!;
      if (expectedVersion !== null) {
        const current = await client.query(`SELECT * FROM canonical_tasks WHERE ${locator.column} = $1 LIMIT 1`, [locator.value]);
        if (current.rows[0]) throw versionConflict(this.normalize(current.rows[0]));
      }
      throw notFound();
    };

    const completes = input.status === 'completed';
    const changesCompletionContract = input.completion_contract !== undefined;
    if (this.mutationGuard && locator.column === 'id' && (completes || changesCompletionContract)) {
      return this.withTransaction(async (client) => {
        // Typed children take this same row lock before they change, so the
        // guard observes their serialized state.
        const row = await client.query('SELECT id FROM canonical_tasks WHERE id = $1 LIMIT 1 FOR UPDATE', [locator.value]);
        if (!row.rows[0]) throw notFound();
        await this.mutationGuard!.check({ client, rowId: locator.value, patch: input, completes, changesCompletionContract });
        return apply(client);
      });
    }
    return apply({ query: (text, queryValues) => this.query(text, queryValues) });
  }

  async listPurposeLabels({ projectCode, assigneePersonId, limit = 200 }: { projectCode: string; assigneePersonId?: string | null; limit?: number }): Promise<CanonicalTaskPurposeLabels> {
    const values: unknown[] = [[projectCode]];
    const conditions = ['project_codes && $1::text[]', 'purpose_label IS NOT NULL'];
    if (assigneePersonId !== undefined) {
      values.push(assigneePersonId);
      conditions.push(`assignee_person_id IS NOT DISTINCT FROM $${values.length}`);
    }
    values.push(limit + 1);
    const result = await this.query(
      `SELECT purpose_label, COUNT(*)::integer AS task_count
       FROM canonical_tasks
       WHERE ${conditions.join(' AND ')}
       GROUP BY purpose_label
       ORDER BY task_count DESC, purpose_label ASC
       LIMIT $${values.length}`,
      values,
    );
    const rows = result.rows.slice(0, limit);
    return {
      labels: rows.map((row) => ({ purpose_label: String(row.purpose_label), task_count: Number(row.task_count) })),
      truncated: result.rows.length > limit,
    };
  }

  async delete(taskId: string, expectedVersion: number, storageScope?: string): Promise<void> {
    this.rejectStorageScope(storageScope);
    const locator = this.decodeTaskLocator(taskId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw storeError('validation_failed', 'Expected Task version is required', 422);
    }
    const result = await this.query(
      `DELETE FROM canonical_tasks WHERE ${locator.column} = $1 AND version = $2 RETURNING id`,
      [locator.value, expectedVersion],
    );
    if (result.rows[0]) return;
    const currentTask = await this.get(taskId);
    if (!currentTask) throw notFound();
    throw versionConflict(currentTask);
  }
}
