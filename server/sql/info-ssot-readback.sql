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
  required_function text;
  required_functions text[] := ARRAY[
    'app_role_rank(text)',
    'app_setting_array(text)',
    'app_current_role_rank()',
    'app_project_codes()',
    'app_clearance()',
    'app_graph_entity_organization_id(text)',
    'app_graph_edge_scope_visible(text,text,text,jsonb,text,text)',
    'app_graph_edge_source_project_matches(text,text,text,jsonb)',
    'prevent_events_mutation()',
    'prevent_graph_maintenance_human_gate_receipt_mutation()',
    'prevent_graph_maintenance_receipt_mutation()'
  ];
  relation_oid oid;
  function_oid oid;
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

  FOREACH required_function IN ARRAY required_functions LOOP
    function_oid := to_regprocedure(
      format('%I.%s', current_schema(), required_function)
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing function %', required_function;
    END IF;
  END LOOP;

  FOREACH required_function IN ARRAY ARRAY[
    'app_graph_entity_organization_id(text)',
    'app_graph_edge_scope_visible(text,text,text,jsonb,text,text)',
    'app_graph_edge_source_project_matches(text,text,text,jsonb)'
  ] LOOP
    function_oid := to_regprocedure(
      format('%I.%s', current_schema(), required_function)
    );
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = function_oid
        AND prosecdef
        AND provolatile = 's'
        AND EXISTS (
          SELECT 1
          FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS setting
          WHERE setting LIKE 'search_path=%'
        )
    ) THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: security contract mismatch for %', required_function;
    END IF;
  END LOOP;
END
$info_ssot_readback$;

SELECT 'INFO_SSOT_READBACK_OK' AS marker;
