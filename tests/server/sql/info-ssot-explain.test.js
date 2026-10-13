import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const rls = readFileSync(resolve(import.meta.dirname, '../../../server/sql/info-ssot-rls.sql'), 'utf8');
const ROW_COUNT = 6702;

let db;

afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function explainList() {
  await db.exec(`
    SELECT set_config('app.role', 'member', true);
    SELECT set_config('app.project_codes', 'atlas', true);
    SELECT set_config('app.clearance', 'internal', true);
  `);
  const result = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON)
    SELECT id FROM public.graph_entities
    ORDER BY updated_at DESC, id DESC
    LIMIT 50`);
  return result.rows[0]['QUERY PLAN'][0];
}

describe('graph entity visibility plan', () => {
  it('measures the non-inlined function against the schema-qualified replacement', async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE public.projects (
        id text PRIMARY KEY,
        code text NOT NULL UNIQUE
      );
      CREATE TABLE public.graph_entities (
        id text PRIMARY KEY,
        entity_type text NOT NULL,
        project_id text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        role_min text,
        sensitivity text,
        lifecycle_status text NOT NULL DEFAULT 'active',
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE public.graph_edges (
        id text PRIMARY KEY,
        from_id text NOT NULL,
        project_id text NOT NULL,
        rel_type text NOT NULL,
        role_min text,
        sensitivity text,
        lifecycle_status text NOT NULL
      );
      INSERT INTO public.projects (id, code) VALUES ('project-atlas', 'atlas');
      INSERT INTO public.graph_entities (id, entity_type, project_id, role_min, sensitivity, updated_at)
      SELECT 'e' || gs::text, 'objective', 'project-atlas', 'member', 'internal',
             timestamptz '2026-10-13' - (gs || ' seconds')::interval
      FROM generate_series(1, ${ROW_COUNT}) AS gs;
      CREATE INDEX graph_entities_updated_at_desc_idx ON public.graph_entities (updated_at DESC);
      CREATE ROLE app_runtime NOLOGIN;
      GRANT SELECT ON public.projects TO app_runtime;
      GRANT SELECT ON public.graph_entities TO app_runtime;
      GRANT SELECT ON public.graph_edges TO app_runtime;
      CREATE OR REPLACE FUNCTION public.app_foundation_row_visible(
        entity_id text, entity_type text, project_id text, role_min text, sensitivity text
      ) RETURNS boolean
      LANGUAGE sql STABLE
      SET search_path = pg_catalog, public
      AS $body$ SELECT TRUE $body$;
      ALTER TABLE public.graph_entities ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.graph_entities FORCE ROW LEVEL SECURITY;
      CREATE POLICY info_graph_entities_select ON public.graph_entities
        FOR SELECT USING (public.app_foundation_row_visible(id, entity_type, project_id, role_min, sensitivity));
    `);

    await db.exec('BEGIN');
    await db.exec('SET ROLE app_runtime');
    const before = await explainList();
    await db.exec('ROLLBACK');

    await db.exec(rls);
    const config = await db.query(`
      SELECT proconfig, proleakproof
      FROM pg_proc
      JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
      WHERE nspname = 'public' AND proname = 'app_foundation_row_visible'
    `);
    expect(config.rows[0].proconfig).toBeNull();
    expect(config.rows[0].proleakproof).toBe(false);

    await db.exec('BEGIN');
    await db.exec("SELECT set_config('jit', 'off', true)");
    await db.exec('SET ROLE app_runtime');
    const after = await explainList();
    await db.exec('ROLLBACK');

    const beforeText = JSON.stringify(before);
    const afterText = JSON.stringify(after);
    const scanOf = (plan) => {
      if (!plan) return null;
      if (plan['Node Type'] === 'Index Scan' || plan['Node Type'] === 'Seq Scan') return plan;
      return (plan.Plans ?? []).map(scanOf).find(Boolean) ?? null;
    };
    const beforeScan = scanOf(before.Plan);
    const afterScan = scanOf(after.Plan);
    console.info(JSON.stringify({
      rows: ROW_COUNT,
      engine: 'pglite',
      before_ms: before['Execution Time'],
      after_ms: after['Execution Time'],
      before_limit_plan_rows: before.Plan['Plan Rows'],
      after_limit_plan_rows: after.Plan['Plan Rows'],
      before_scan_plan_rows: beforeScan?.['Plan Rows'] ?? null,
      after_scan_plan_rows: afterScan?.['Plan Rows'] ?? null,
      before_scan_actual_rows: beforeScan?.['Actual Rows'] ?? null,
      after_scan_actual_rows: afterScan?.['Actual Rows'] ?? null,
      before_actual_rows: before.Plan['Actual Rows'],
      after_actual_rows: after.Plan['Actual Rows'],
      before_names_function: beforeText.includes('app_foundation_row_visible'),
      after_names_function: afterText.includes('app_foundation_row_visible')
    }));

    expect(beforeText).toContain('app_foundation_row_visible');
    expect(afterText).not.toContain('app_foundation_row_visible');
    expect(after.Plan['Actual Rows']).toBe(50);
  }, 120000);
});
