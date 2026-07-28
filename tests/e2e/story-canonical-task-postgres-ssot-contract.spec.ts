import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CanonicalTaskPostgresRepository } from '../../server/services/companion/canonical-task-postgres-repository.js';
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

test('story-canonical-task-postgres-ssot ac:1 ac:2 ac:3 S-001 S-002 S-003 S-004 S-005 S-006 contract', () => {
  const story = read('docs/stories/story-canonical-task-postgres-ssot.md');
  const spec = read('docs/specs/story-canonical-task-postgres-ssot-spec.md');
  const bootstrap = read('server/bootstrap/core-services.js');
  const storeConfig = read('server/services/companion/canonical-task-store-config.js');
  const repository = read('server/services/companion/canonical-task-postgres-repository.js');
  const migration = read('scripts/migrate-canonical-task-postgres-store.js');

  for (const marker of ['AC-1', 'AC-2', 'AC-3', 'S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006']) {
    expect(story, `${marker} is explicit in the Story`).toContain(marker);
  }

  expect(spec, 'ac:1 PostgreSQL is the canonical Task store contract').toContain('canonical_tasks');
  expect(repository, 'ac:1 repository implements the canonical persistence boundary').toContain('CanonicalTaskPostgresRepository');
  expect(bootstrap + storeConfig, 'S-001 S-002 backend selection is explicit').toContain('CANONICAL_TASK_BACKEND');
  expect(migration, 'S-003 migration exposes dry-run').toContain("'dry-run'");
  expect(migration, 'S-004 migration applies transactionally').toContain('BEGIN');
  expect(migration, 'S-005 conflicts stop apply').toContain('conflict');
  expect(repository, 'S-006 selected store failures are not silently converted to empty success').not.toContain('catch(() => [])');
  expect(story, 'ac:3 production apply and Canvas projection remain out of scope').toContain('本番DBへのapply');
  expect(story, 'ac:3 Canvas projection is a follow-up Story').toContain('後続Story');
});

test('story-canonical-task-postgres-ssot ac:1 repository executes SQL and exposes store failure', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const repository = new CanonicalTaskPostgresRepository({
    storeConfig,
    idSecret: 'e2e-secret',
    pool: {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.startsWith('INSERT INTO canonical_tasks')) return { rows: [taskRow()] };
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
  await expect(repository.list()).rejects.toMatchObject({
    code: 'task_store_unavailable',
    status: 503
  });
});

test('story-canonical-task-postgres-ssot ac:1 migration rolls back a failed transaction', async () => {
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
