import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const sql = readFileSync(
  fileURLToPath(new URL('../contracts/canonical-task/store-schema.sql', import.meta.url)),
  'utf8',
);

function values(group: string | undefined): string[] {
  return group ? [...group.matchAll(/'([^']+)'/g)].map((entry) => entry[1]) : [];
}

describe('canonical_tasks claim columns', () => {
  it('adds claimed_by, claimed_until and status_detail as nullable columns', () => {
    const columns: Array<[string, string]> = [
      ['claimed_by', 'TEXT'],
      ['claimed_until', 'TIMESTAMPTZ'],
      ['status_detail', 'TEXT'],
    ];
    for (const [name, type] of columns) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${name} ${type}\\s*;`));
    }
  });

  it('keeps the five stored statuses and limits status_detail to started, waiting_for_review and blocked', () => {
    const status = sql.match(
      /ADD CONSTRAINT canonical_tasks_status_check[\s\S]*?CHECK \(status IN \(([^)]*)\)\)/,
    );
    expect(values(status?.[1])).toEqual([
      'pending',
      'in_progress',
      'waiting',
      'completed',
      'cancelled',
    ]);

    const statusDetail = sql.match(
      /ADD CONSTRAINT canonical_tasks_status_detail_check[\s\S]*?CHECK \(\s*status_detail IS NULL\s*OR status_detail IN \(([^)]*)\)\s*\)/,
    );
    expect(values(statusDetail?.[1])).toEqual(['started', 'waiting_for_review', 'blocked']);
  });

  it('claimed_by and claimed_until are set together', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT canonical_tasks_claim_pair_check[\s\S]*?CHECK \(\(claimed_by IS NULL\) = \(claimed_until IS NULL\)\)/,
    );
  });

  it('adds no GRANT', () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  const url = process.env.CANONICAL_TASK_TEST_DATABASE_URL;
  it.skipIf(!url)('applies twice on PostgreSQL and enforces the checks', async () => {
    const client = new pg.Client({ connectionString: url });
    const schemaName = `claim_cols_${Date.now()}`;
    try {
      await client.connect();
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET search_path TO ${schemaName}`);

      await client.query(sql);
      await client.query(sql);

      await client.query(
        `INSERT INTO canonical_tasks (id, title, status, priority, idempotency_key)
         VALUES (gen_random_uuid(), 't', 'pending', 'low', 'k1')`,
      );

      await client.query(
        "UPDATE canonical_tasks SET status_detail = 'started' WHERE idempotency_key = 'k1'",
      );

      let detailCode: string | undefined;
      try {
        await client.query(
          "UPDATE canonical_tasks SET status_detail = 'done' WHERE idempotency_key = 'k1'",
        );
      } catch (error) {
        detailCode = (error as { code?: string }).code;
      }
      expect(detailCode).toBe('23514');

      let pairCode: string | undefined;
      try {
        await client.query(
          "UPDATE canonical_tasks SET claimed_by = 'agent_x', claimed_until = NULL WHERE idempotency_key = 'k1'",
        );
      } catch (error) {
        pairCode = (error as { code?: string }).code;
      }
      expect(pairCode).toBe('23514');

      await client.query(
        "UPDATE canonical_tasks SET claimed_by = 'agent_x', claimed_until = now() + interval '30 minutes' WHERE idempotency_key = 'k1'",
      );
    } finally {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } finally {
        await client.end();
      }
    }
  });
});
