import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalTaskPostgresRepository,
  type CanonicalTaskPgPool,
} from '../src/canonical-task-postgres.js';

const persisted = {
  id: '9a92b7f8-a89e-41d0-b275-04cb11fb38e7',
  legacy_nocodb_id: null,
  title: 'PostgreSQL Task',
  description: null,
  status: 'pending',
  priority: 'medium',
  project_codes: ['mana', 'brainbase'],
  purpose_label: null,
  completion_contract: null,
  assignee_person_id: 'person-1',
  assignee_display_name: 'Owner',
  due_at: null,
  waiting_on: null,
  waiting_on_person_id: null,
  review_at: null,
  completed_at: null,
  source_refs: [],
  version: 1,
  idempotency_key: 'api:person-1:create',
  payload_fingerprint: 'payload',
  last_operation_key: null,
  last_operation_fingerprint: null,
  created_at: '2026-07-28T00:00:00Z',
  updated_at: '2026-07-28T00:00:00Z',
};

function repository(pool: CanonicalTaskPgPool, options: Partial<ConstructorParameters<typeof CanonicalTaskPostgresRepository>[0]> = {}) {
  return new CanonicalTaskPostgresRepository({
    pool,
    schemaVersion: '1.0.0',
    idSecret: 'secret',
    legacyIdentity: { baseId: 'base', tableId: 'table' },
    webBaseUrl: 'https://bb.example.test',
    ...options,
  });
}

describe('CanonicalTaskPostgresRepository', () => {
  it('marks durable persistence as requiring a readiness binding', () => {
    expect(repository({ query: vi.fn() }).requiresReadiness).toBe(true);
  });

  it('runs create and audit in one transaction and rolls back when the audit fails', async () => {
    const statements: string[] = [];
    const clientQuery = vi.fn(async (text: string) => {
      statements.push(text.trim().split(/\s+/)[0].toUpperCase());
      return text.startsWith('INSERT INTO canonical_tasks') ? { rows: [persisted] } : { rows: [] };
    });
    const pool: CanonicalTaskPgPool = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }),
    };
    const repo = repository(pool);

    await repo.createWithAudit({ ...persisted }, async (_task, client) => {
      await client.query('SELECT 1 FROM audit_table');
    });
    expect(statements).toEqual(['BEGIN', 'INSERT', 'SELECT', 'COMMIT']);

    statements.length = 0;
    await expect(repo.createWithAudit({ ...persisted }, async () => {
      throw new Error('audit unavailable');
    })).rejects.toThrow('audit unavailable');
    expect(statements).toEqual(['BEGIN', 'INSERT', 'ROLLBACK']);
  });

  it('normalizes cancelled tasks and signs IDs to one store identity', () => {
    const repo = repository({ query: vi.fn() });
    const normalized = repo.normalize({ ...persisted, status: 'cancelled' });

    expect(normalized).toMatchObject({ status: 'cancelled' });
    expect(normalized?.normalization_warnings).not.toContainEqual(expect.objectContaining({ code: 'unknown_status' }));

    const legacyId = repo.encodeTaskId({ legacy_nocodb_id: '42' });
    expect(repo.decodeTaskLocator(legacyId)).toEqual({ column: 'legacy_nocodb_id', value: '42' });
    expect(repo.normalize({ ...persisted, legacy_nocodb_id: '42' })?.id).toBe(legacyId);

    const foreign = repository({ query: vi.fn() }, { legacyIdentity: { baseId: 'other', tableId: 'table' } })
      .encodeTaskId({ legacy_nocodb_id: '42' });
    expect(() => repo.decodeTaskLocator(foreign)).toThrow(expect.objectContaining({ code: 'task_not_found' }));

    const tampered = `${legacyId.slice(0, -1)}${legacyId.endsWith('a') ? 'b' : 'a'}`;
    expect(() => repo.decodeTaskLocator(tampered)).toThrow(expect.objectContaining({ code: 'task_not_found' }));
  });

  it('applies exact-count filters and the host visibility condition', async () => {
    const pool: CanonicalTaskPgPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [persisted] }),
    };
    const repo = repository(pool, {
      scopeCondition: ({ param }) => `source_refs @> ${param(JSON.stringify([{ tenant: 'tenant-a' }]))}::jsonb`,
    });

    const page = await repo.list({
      statuses: ['pending'],
      priorities: ['medium'],
      projectCodes: ['mana', 'brainbase'],
      assigneePersonId: 'person-1',
      dueAfter: '2026-07-01T00:00:00Z',
      dueBefore: '2026-08-01T00:00:00Z',
      limit: 1,
    });

    expect(page).toMatchObject({
      totalCount: 2,
      countStatus: 'exact',
      readStatus: 'complete',
      items: [{ title: 'PostgreSQL Task' }],
    });
    expect(page.nextCursor).toBeTruthy();
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain('status = ANY($1::text[])');
    expect(calls[0][0]).toContain('project_codes && $3::text[]');
    expect(calls[0][0]).toContain('source_refs @> $7::jsonb');
    expect(calls[1][0]).toContain('LIMIT $8 OFFSET $9');
    expect(calls[1][1]).toEqual([...calls[0][1], 1, 0]);
  });

  it('uses bounded keyset search and rejects an invalid cursor before querying', async () => {
    const second = {
      ...persisted,
      id: '6246fb20-9d7a-42af-9df0-5223e331bc83',
      title: '月次 締め作業',
      created_at: '2026-07-27T00:00:00Z',
    };
    const query = vi.fn().mockResolvedValue({ rows: [persisted, second] });
    const repo = repository({ query });
    const page = await repo.search({
      tokens: ['月次', '締め'],
      statuses: ['pending'],
      projectCodes: ['back-office'],
      assigneePersonId: 'person-1',
      limit: 1,
    });

    expect(page).toMatchObject({
      totalCount: null,
      countStatus: 'not_requested',
      readStatus: 'complete',
      hasMore: true,
      items: [{ title: 'PostgreSQL Task' }],
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("title ILIKE $1 ESCAPE E'\\\\'");
    expect(query.mock.calls[0][0]).toContain('project_codes && $4::text[]');
    expect(query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC');
    expect(query.mock.calls[0][0]).not.toContain('COUNT(');
    expect(query.mock.calls[0][0]).not.toContain('OFFSET');
    expect(query.mock.calls[0][1].at(-1)).toBe(2);

    query.mockClear();
    await repo.search({ tokens: ['月次'], cursor: page.nextCursor, limit: 1 });
    expect(query.mock.calls[0][0]).toContain('(created_at, id) < ($2::timestamptz, $3::uuid)');

    query.mockClear();
    await expect(repo.search({ tokens: ['月次'], cursor: 'not-a-valid-cursor' })).rejects.toMatchObject({
      code: 'validation_failed',
      status: 422,
      fieldErrors: { cursor: ['invalid_cursor'] },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('creates idempotently and keeps operation markers private in the normalized task', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      ...persisted,
      purpose_label: '口コミ',
      waiting_on_person_id: 'per_reviewer',
      completion_contract: { goal: 'ship', criteria: [{ id: 'done', condition: 'deployed' }] },
      last_operation_key: 'update:v1:1',
      last_operation_fingerprint: 'fingerprint',
    }] });
    const created = await repository({ query }).create({
      title: persisted.title,
      status: 'pending',
      priority: 'medium',
      assignee_person_id: 'person-1',
      source_refs: [],
      project_codes: ['mana'],
      purpose_label: '口コミ',
      waiting_on_person_id: 'per_reviewer',
      completion_contract: { goal: 'ship', criteria: [{ id: 'done', condition: 'deployed' }] },
      version: 1,
      idempotency_key: persisted.idempotency_key,
      payload_fingerprint: 'payload',
      last_operation_key: 'update:v1:1',
      last_operation_fingerprint: 'fingerprint',
    });

    expect(created).toMatchObject({
      title: persisted.title,
      purpose_label: '口コミ',
      waiting_on_person_id: 'per_reviewer',
      completion_contract: { goal: 'ship' },
    });
    expect(created).not.toHaveProperty('last_operation_key');
    expect((created as Record<string, unknown>)._last_operation_key).toBe('update:v1:1');
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
    expect(query.mock.calls[0][0]).toContain('completion_contract');
  });

  it('updates a Postgres row with an atomic version check and invokes the host mutation guard', async () => {
    const repo = repository({ query: vi.fn() });
    const taskId = repo.encodeTaskId({ id: persisted.id });
    const guard = vi.fn().mockResolvedValue(undefined);
    const updateRow = { ...persisted, status: 'completed', version: 2, completed_at: '2026-07-28T01:00:00Z' };
    const clientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: persisted.id }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [updateRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() });
    const guarded = repository({ query: vi.fn(), connect }, {
      mutationGuard: { check: guard },
      passthroughErrorCodes: ['task_operator_role_required'],
    });

    const updated = await guarded.update(taskId, {
      status: 'completed',
      completed_at: updateRow.completed_at,
      version: 2,
      _last_operation_key: 'transition:v1:1',
      _last_operation_fingerprint: 'fingerprint',
    });

    expect(updated).toMatchObject({ status: 'completed', version: 2 });
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({
      rowId: persisted.id,
      completes: true,
      changesCompletionContract: false,
    }));
    expect(clientQuery.mock.calls[0][0]).toBe('BEGIN');
    expect(clientQuery.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(clientQuery.mock.calls[2][0]).toContain('UPDATE canonical_tasks');
    expect(clientQuery.mock.calls[2][0]).toContain('AND version =');
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it('preserves an authority error raised by the host mutation guard', async () => {
    const guard = vi.fn().mockRejectedValue(Object.assign(new Error('operator role required'), { code: 'task_operator_role_required' }));
    const repo = repository({ query: vi.fn(), connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ id: persisted.id }], rowCount: 1 }),
      release: vi.fn(),
    }) }, {
      mutationGuard: { check: guard },
      passthroughErrorCodes: ['task_operator_role_required'],
    });
    const taskId = repo.encodeTaskId({ id: persisted.id });

    await expect(repo.update(taskId, { completion_contract: { goal: 'ship', criteria: [] }, version: 2 }))
      .rejects.toMatchObject({ code: 'task_operator_role_required' });
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({
      rowId: persisted.id,
      changesCompletionContract: true,
    }));
  });

  it('deletes only the expected version and reports a stale read as a conflict', async () => {
    const repo = repository({
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [persisted] }),
    });
    const taskId = repo.encodeTaskId({ id: persisted.id });

    await expect(repo.delete(taskId, 2)).rejects.toMatchObject({
      code: 'version_conflict',
      status: 409,
      currentTask: expect.objectContaining({ version: 1 }),
    });
    expect((repo.pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('DELETE FROM canonical_tasks');
    expect((repo.pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('AND version = $2');
  });

  it('fails closed for an unsupported policy storage scope and unavailable PostgreSQL', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    const repo = repository({ query });

    await expect(repo.list({}, 'tenant-a')).rejects.toMatchObject({
      code: 'task_storage_scope_unsupported',
      status: 503,
    });
    await expect(repo.list()).rejects.toMatchObject({ code: 'task_store_unavailable', status: 503 });
  });
});
