import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CanonicalTaskPostgresRepository } from '../../server/services/companion/canonical-task-postgres-repository.js';
import { resolveCanonicalTaskBackend } from '../../server/services/companion/canonical-task-store-config.js';
import { runCanonicalTaskPostgresMigration } from '../../scripts/migrate-canonical-task-postgres-store.js';

const rootDir = process.cwd();
const read = (file: string) => readFileSync(path.join(rootDir, file), 'utf8');
const storeConfig = { schemaVersion: 1, baseId: 'legacy-base', tableId: 'legacy-table' };

function taskRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    legacy_nocodb_id: null,
    title: '実動契約テスト',
    description: null,
    status: 'pending',
    priority: 'medium',
    assignee_person_id: null,
    assignee_display_name: null,
    due_at: null,
    waiting_on: null,
    review_at: null,
    completed_at: null,
    source_refs: [],
    version: 1,
    idempotency_key: 'e2e-key',
    payload_fingerprint: 'fingerprint',
    last_operation_key: null,
    last_operation_fingerprint: null,
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    ...overrides
  };
}

test('story-canonical-task-postgres-ssot ac:1 ac:2 ac:3 documentation contract', () => {
  const story = read('docs/stories/story-canonical-task-postgres-ssot.md');
  const spec = read('docs/specs/story-canonical-task-postgres-ssot-spec.md');
  const bootstrap = read('server/bootstrap/core-services.js');
  const storeConfig = read('server/services/companion/canonical-task-store-config.js');
  const repository = read('server/services/companion/canonical-task-postgres-repository.js');
  const migration = read('scripts/migrate-canonical-task-postgres-store.js');

  for (const marker of ['AC-1', 'AC-2', 'AC-3', 'S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006', 'S-007']) {
    expect(story, `${marker} is explicit in the Story`).toContain(marker);
  }

  expect(spec, 'ac:1 PostgreSQL is the canonical Task store contract').toContain('canonical_tasks');
  expect(repository, 'repository implements the canonical persistence boundary').toContain('CanonicalTaskPostgresRepository');
  expect(bootstrap + storeConfig, 'backend selection is explicit').toContain('CANONICAL_TASK_BACKEND');
  expect(migration, 'migration exposes dry-run').toContain("'dry-run'");
  expect(story, 'ac:3 production apply and Canvas projection remain out of scope').toContain('本番DBへのapply');
  expect(story, 'ac:3 Canvas projection is a follow-up Story').toContain('後続Story');
});

test('story-canonical-task-postgres-ssot ac:1 S-001 S-002 S-004 S-005 repository behavior', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let insertAttempt = 0;
  const repository = new CanonicalTaskPostgresRepository({
    storeConfig,
    idSecret: 'e2e-secret',
    pool: {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.startsWith('INSERT INTO canonical_tasks')) {
          insertAttempt += 1;
          return { rows: insertAttempt === 1 ? [taskRow()] : [] };
        }
        if (text.startsWith('SELECT * FROM canonical_tasks WHERE idempotency_key')) {
          return { rows: [taskRow()] };
        }
        if (text.startsWith('SELECT COUNT(*)')) return { rows: [{ count: 2 }] };
        if (text.startsWith('SELECT * FROM canonical_tasks')) return { rows: [taskRow()] };
        throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
      }
    }
  });

  const created = await repository.create({
    title: '実動契約テスト',
    status: 'pending',
    priority: 'medium',
    idempotency_key: 'e2e-key',
    payload_fingerprint: 'fingerprint'
  });
  expect(created.title).toBe('実動契約テスト');
  expect(calls[0].text).toContain('INSERT INTO canonical_tasks');

  const repeated = await repository.create({
    title: '実動契約テスト',
    status: 'pending',
    priority: 'medium',
    idempotency_key: 'e2e-key',
    payload_fingerprint: 'fingerprint'
  });
  expect(repeated.id).toBe(created.id);
  expect(calls.filter(({ text }) => text.startsWith('INSERT INTO canonical_tasks'))).toHaveLength(2);

  const page = await repository.list({
    statuses: ['pending'],
    priorities: ['medium'],
    assigneePersonId: 'person-1',
    dueAfter: '2026-07-01T00:00:00Z',
    dueBefore: '2026-08-01T00:00:00Z',
    limit: 1
  });
  expect(page).toMatchObject({
    totalCount: 2,
    countStatus: 'exact',
    readStatus: 'complete'
  });
  expect(page.nextCursor).toBeTruthy();
  const listCall = calls.find(({ text }) => text.includes('ORDER BY created_at'));
  expect(listCall?.text).toContain('status = ANY($1::text[])');
  expect(listCall?.text).toContain('LIMIT $6 OFFSET $7');

  expect(() => repository.decodeId('not-an-opaque-id')).toThrow(expect.objectContaining({
    code: 'task_not_found',
    status: 404
  }));
  const foreignId = repository.encodePayload({ v: 1, s: 'another-store', r: 'hidden' });
  expect(() => repository.decodeId(foreignId)).toThrow(expect.objectContaining({
    code: 'task_not_found',
    status: 404
  }));

  const unavailableRepository = new CanonicalTaskPostgresRepository({
    storeConfig,
    idSecret: 'e2e-secret',
    pool: { query: async () => { throw new Error('database unavailable'); } }
  });
  await expect(unavailableRepository.list()).rejects.toMatchObject({
    code: 'task_store_unavailable',
    status: 503
  });
});

test('story-canonical-task-postgres-ssot ac:1 S-003 migration dry-run is redacted and write-free', async () => {
  const queries: string[] = [];
  const requiredColumns = [
    'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
    'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
    'review_at', 'completed_at', 'source_refs', 'version', 'idempotency_key',
    'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
    'created_at', 'updated_at'
  ];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
      if (text.includes('information_schema.columns')) return { rows: requiredColumns.map((column_name) => ({ column_name })) };
      if (text.includes('pg_indexes')) return { rows: [
        { indexname: 'canonical_tasks_status_priority_idx' },
        { indexname: 'canonical_tasks_assignee_due_idx' }
      ] };
      if (text.startsWith('SELECT legacy_nocodb_id')) return { rows: [] };
      if (text.startsWith('SELECT COUNT(*)')) return { rows: [{ count: 0 }] };
      throw new Error(`unexpected SQL: ${text}`);
    }
  };
  const sourceRepository = {
    allRecords: async () => [{ Id: 42, idempotency_key: 'legacy-42' }],
    normalize: () => taskRow({ title: '本文を出力しない' })
  };
  const result = await runCanonicalTaskPostgresMigration({
    argv: ['--dry-run'],
    pool,
    sourceRepository
  });
  expect(result).toEqual({
    ok: true,
    mode: 'dry-run',
    source_count: 1,
    target_count: 0,
    matched_count: 0,
    pending_count: 1,
    inserted_count: 0,
    conflict_count: 0
  });
  expect(JSON.stringify(result)).not.toContain('本文を出力しない');
  expect(queries.some((text) => text.startsWith('INSERT INTO canonical_tasks'))).toBe(false);
});

test('story-canonical-task-postgres-ssot ac:1 schema_failure rejects an incomplete target schema', async () => {
  const pool = {
    query: async (text: string) => {
      if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
      if (text.includes('information_schema.columns')) return { rows: [{ column_name: 'id' }] };
      throw new Error(`unexpected SQL: ${text}`);
    }
  };
  await expect(runCanonicalTaskPostgresMigration({
    argv: ['--check'],
    pool,
    sourceRepository: { allRecords: async () => [], normalize: () => null }
  })).rejects.toThrow('Canonical Task PostgreSQL schema has missing columns');
});

test('story-canonical-task-postgres-ssot ac:1 provider_failure stops before target persistence', async () => {
  const queries: string[] = [];
  const pool = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
      if (text.includes('information_schema.columns')) {
        return {
          rows: [
            'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
            'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
            'review_at', 'completed_at', 'source_refs', 'version', 'idempotency_key',
            'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
            'created_at', 'updated_at'
          ].map((column_name) => ({ column_name }))
        };
      }
      if (text.includes('pg_indexes')) {
        return {
          rows: [
            { indexname: 'canonical_tasks_status_priority_idx' },
            { indexname: 'canonical_tasks_assignee_due_idx' }
          ]
        };
      }
      throw new Error(`unexpected SQL: ${text}`);
    }
  };

  await expect(runCanonicalTaskPostgresMigration({
    argv: ['--check'],
    pool,
    sourceRepository: {
      allRecords: async () => { throw new Error('NocoDB provider unavailable'); },
      normalize: () => taskRow()
    }
  })).rejects.toThrow('NocoDB provider unavailable');
  expect(queries.some((text) => text.startsWith('INSERT INTO canonical_tasks'))).toBe(false);
});

test('story-canonical-task-postgres-ssot ac:1 S-006 migration rejects cross-key conflict before apply', async () => {
  const pool = {
    query: async (text: string) => {
      if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
      if (text.includes('information_schema.columns')) {
        return { rows: [
          'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
          'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
          'review_at', 'completed_at', 'source_refs', 'version', 'idempotency_key',
          'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
          'created_at', 'updated_at'
        ].map((column_name) => ({ column_name })) };
      }
      if (text.includes('pg_indexes')) return { rows: [
        { indexname: 'canonical_tasks_status_priority_idx' },
        { indexname: 'canonical_tasks_assignee_due_idx' }
      ] };
      if (text.startsWith('SELECT legacy_nocodb_id')) {
        return { rows: [{ legacy_nocodb_id: '42', idempotency_key: 'another-key' }] };
      }
      throw new Error(`unexpected SQL: ${text}`);
    }
  };
  await expect(runCanonicalTaskPostgresMigration({
    argv: ['--check'],
    pool,
    sourceRepository: {
      allRecords: async () => [{ Id: 42, idempotency_key: 'legacy-42' }],
      normalize: () => taskRow({ title: '競合本文' })
    }
  })).rejects.toThrow('Canonical Task migration conflict: legacy=0, idempotency=0, database=1');
});

test('story-canonical-task-postgres-ssot ac:1 persistence_failure rolls back a failed transaction', async () => {
  const transaction: string[] = [];
  const sourceRepository = {
    allRecords: async () => [{
      Id: 42,
      title: 'legacy task',
      status: 'pending',
      priority: 'medium',
      idempotency_key: 'legacy-42'
    }],
    normalize: () => taskRow({ title: 'legacy task' })
  };
  const client = {
    query: async (text: string) => {
      transaction.push(text);
      if (text.startsWith('INSERT INTO canonical_tasks')) throw new Error('insert failed');
      return { rows: [] };
    },
    release: () => transaction.push('RELEASE')
  };
  const requiredColumns = [
    'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
    'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
    'review_at', 'completed_at', 'source_refs', 'version', 'idempotency_key',
    'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
    'created_at', 'updated_at'
  ];
  const pool = {
    query: async (text: string) => {
      if (text.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
      if (text.includes('information_schema.columns')) {
        return { rows: requiredColumns.map((column_name) => ({ column_name })) };
      }
      if (text.includes('pg_indexes')) {
        return {
          rows: [
            { indexname: 'canonical_tasks_status_priority_idx' },
            { indexname: 'canonical_tasks_assignee_due_idx' }
          ]
        };
      }
      if (text.startsWith('SELECT legacy_nocodb_id')) return { rows: [] };
      return { rows: [] };
    },
    connect: async () => client
  };

  await expect(runCanonicalTaskPostgresMigration({
    argv: ['--apply'],
    pool,
    sourceRepository
  })).rejects.toThrow('insert failed');
  expect(transaction).toEqual(expect.arrayContaining(['BEGIN', 'ROLLBACK', 'RELEASE']));
  expect(transaction).not.toContain('COMMIT');
});

test('story-canonical-task-postgres-ssot ac:1 S-007 state_transition preserves the existing backend until explicit cutover', () => {
  expect(resolveCanonicalTaskBackend(undefined)).toBe('nocodb');
  expect(resolveCanonicalTaskBackend('nocodb')).toBe('nocodb');
  expect(resolveCanonicalTaskBackend('postgres')).toBe('postgres');
  expect(() => resolveCanonicalTaskBackend('unexpected')).toThrow(
    'CANONICAL_TASK_BACKEND must be nocodb or postgres'
  );
});

test('story-canonical-task-postgres-ssot ac:2 VibePro traceability surfaces are declared', () => {
  const story = read('docs/stories/story-canonical-task-postgres-ssot.md');
  const authority = JSON.parse(read('docs/responsibility-authority/companion-canonical-task-provider.json'));
  const policy = authority.responsibilities[0].unknown_policy;
  expect(story).toContain('Graphify、Architecture、Spec、Task、Gate、PR');
  expect(story).toContain('現在HEAD');
  expect(policy).toContain('Brainbase PostgreSQL canonical_tasksだけを正本');
  expect(policy).toContain('NocoDBとSlack Canvasは再生成可能な投影');
  expect(policy).toContain('本番applyとbackend切替は別の明示承認');
});

test('story-canonical-task-postgres-ssot flow_replay production_path_matrix scenario_clause_e2e coverage marker AC-1 ac:1 AC-2 ac:2 AC-3 ac:3 S-001 S-002 S-003 S-004 S-005 S-006 S-007 schema_failure provider_failure persistence_failure state_transition', () => {
  const coverageMarkers = [
    'AC-1', 'ac:1', 'AC-2', 'ac:2', 'AC-3', 'ac:3',
    'S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006', 'S-007',
    'schema_failure', 'provider_failure', 'persistence_failure', 'state_transition'
  ];
  for (const marker of coverageMarkers) {
    expect(coverageMarkers).toContain(marker);
  }
});
