import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const sql = readFileSync(
  fileURLToPath(new URL('../contracts/canonical-task/store-schema.sql', import.meta.url)),
  'utf8',
);

// The same schema as before record_kind existed: drop the statements that add the column and its check.
const sqlBeforeRecordKind = sql
  .split(/;\s*\n/)
  .filter((statement) => !/record_kind/.test(statement.replace(/--[^\n]*/g, '')))
  .join(';\n');

describe('canonical_tasks record_kind', () => {
  it('adds record_kind as NOT NULL with default work', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS record_kind TEXT NOT NULL DEFAULT 'work'\s*;/);
  });

  it('limits record_kind to work, request and requirement', () => {
    const check = sql.match(
      /ADD CONSTRAINT canonical_tasks_record_kind_check[\s\S]*?CHECK \(record_kind IN \(([^)]*)\)\)/,
    );
    const values = check ? [...check[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]) : [];
    expect(values).toEqual(['work', 'request', 'requirement']);
  });

  const url = process.env.CANONICAL_TASK_TEST_DATABASE_URL;
  it('the pre-record_kind schema used by the backfill test has no record_kind', () => {
    expect(sqlBeforeRecordKind.replace(/--[^\n]*/g, '')).not.toMatch(/record_kind/);
    expect(sqlBeforeRecordKind).toMatch(/CREATE TABLE IF NOT EXISTS canonical_tasks/);
  });

  it.skipIf(!url)('backfills rows created before the column with work, applies twice and rejects other values', async () => {
    const client = new pg.Client({ connectionString: url });
    const schemaName = `record_kind_${Date.now()}`;
    try {
      await client.connect();
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET search_path TO ${schemaName}`);

      await client.query(sqlBeforeRecordKind);
      const before = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'canonical_tasks' AND column_name = 'record_kind'",
        [schemaName],
      );
      expect(before.rowCount).toBe(0);
      await client.query(
        `INSERT INTO canonical_tasks (id, title, status, priority, idempotency_key)
         VALUES (gen_random_uuid(), 'existing', 'pending', 'low', 'k1')`,
      );
      await client.query(sql);
      await client.query(sql);

      const existing = await client.query(
        "SELECT record_kind FROM canonical_tasks WHERE idempotency_key = 'k1'",
      );
      expect(existing.rows[0].record_kind).toBe('work');

      await client.query(
        `INSERT INTO canonical_tasks (id, title, status, priority, idempotency_key, record_kind)
         VALUES (gen_random_uuid(), 'req', 'pending', 'low', 'k2', 'requirement')`,
      );

      for (const [key, value] of [['k3', 'bogus'], ['k4', null]] as const) {
        let code: string | undefined;
        try {
          await client.query(
            `INSERT INTO canonical_tasks (id, title, status, priority, idempotency_key, record_kind)
             VALUES (gen_random_uuid(), 'bad', 'pending', 'low', $1, $2)`,
            [key, value],
          );
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe(value === null ? '23502' : '23514');
      }
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => {});
      await client.end().catch(() => {});
    }
  });
});
