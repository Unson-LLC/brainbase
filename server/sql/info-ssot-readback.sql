-- Info SSOT RLS deployment readback (Postgres)
-- This file is intentionally read-only and fails closed when any required
-- table is missing, RLS is disabled, FORCE ROW LEVEL SECURITY is absent, or
-- no policy is present.

\set ON_ERROR_STOP on

DO $info_ssot_readback$
DECLARE
  required_table text;
  required_tables text[] := ARRAY[
    'decisions',
    'events',
    'raci_assignments',
    'graph_entities',
    'graph_edges'
  ];
  relation_oid oid;
BEGIN
  FOREACH required_table IN ARRAY required_tables LOOP
    relation_oid := to_regclass(format('%I.%I', current_schema(), required_table));
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing table %', required_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      WHERE c.oid = relation_oid
        AND c.relrowsecurity
        AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: RLS/force missing for %', required_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = current_schema()
        AND p.tablename = required_table
    ) THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: policy missing for %', required_table;
    END IF;
  END LOOP;
END
$info_ssot_readback$;

SELECT 'INFO_SSOT_READBACK_OK' AS marker;
