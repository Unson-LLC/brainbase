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
    'graph_edges',
    'project_registry',
    'project_provisioning_runs',
    'project_provisioning_steps'
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

DO $project_provisioning_readback$
DECLARE
  required_table text;
  required_function regprocedure;
BEGIN
  -- Table, FORCE RLS, and policy checks are performed by the shared loop above.
  IF to_regprocedure(format('%I.prevent_project_provisioning_receipt_mutation()', current_schema())) IS NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project provisioning receipt guard';
  END IF;
  IF to_regprocedure(format('%I.prevent_project_provisioning_step_receipt_mutation()', current_schema())) IS NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project provisioning step receipt guard';
  END IF;
  IF to_regprocedure(format('%I.project_code_collision_sources(text,text)', current_schema())) IS NULL
     OR to_regprocedure(format('%I.claim_project_code(text,text)', current_schema())) IS NULL
     OR to_regprocedure(format('%I.project_graph_identity_probe(text)', current_schema())) IS NULL
     OR to_regprocedure(format('%I.guard_project_graph_entity_write()', current_schema())) IS NULL
     OR to_regprocedure(format('%I.project_graph_identity_probe(text,text)', current_schema())) IS NOT NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project code claim functions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure(format('%I.project_graph_identity_probe(text)', current_schema()))
      AND prosecdef
      AND provolatile = 's'
      AND EXISTS (
        SELECT 1 FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS setting
        WHERE setting = 'search_path=pg_catalog, public'
      )
      AND NOT has_function_privilege(
        'public',
        to_regprocedure(format('%I.project_graph_identity_probe(text)', current_schema())),
        'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: project graph identity probe security contract mismatch';
  END IF;
  FOREACH required_function IN ARRAY ARRAY[
    to_regprocedure(format('%I.project_code_collision_sources(text,text)', current_schema())),
    to_regprocedure(format('%I.claim_project_code(text,text)', current_schema()))
  ] LOOP
    IF required_function IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = required_function
        AND prosecdef
        AND EXISTS (
          SELECT 1 FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS setting
          WHERE setting = 'search_path=pg_catalog, public'
        )
        AND NOT has_function_privilege('public', required_function, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: project provisioning function security contract mismatch';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = to_regprocedure(format('%I.guard_project_graph_entity_write()', current_schema()))
      AND prosecdef
      AND EXISTS (
        SELECT 1 FROM unnest(coalesce(proconfig, ARRAY[]::text[])) AS setting
        WHERE setting = 'search_path=pg_catalog, public'
      )
      AND NOT has_function_privilege(
        'public',
        to_regprocedure(format('%I.guard_project_graph_entity_write()', current_schema())),
        'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: project Graph entity guard security contract mismatch';
  END IF;
  -- brainbase_app is the canonical production role, but local/staging
  -- installations may intentionally use another role.  Validate the explicit
  -- grant only when that role exists; PUBLIC remains denied above in all cases.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_app') THEN
    IF NOT has_function_privilege('brainbase_app', to_regprocedure(format('%I.project_code_collision_sources(text,text)', current_schema())), 'EXECUTE')
       OR NOT has_function_privilege('brainbase_app', to_regprocedure(format('%I.project_graph_identity_probe(text)', current_schema())), 'EXECUTE')
       OR NOT has_function_privilege('brainbase_app', to_regprocedure(format('%I.claim_project_code(text,text)', current_schema())), 'EXECUTE') THEN
      RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: brainbase_app cannot execute project provisioning functions';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema=current_schema() AND table_name='project_code_claims' AND grantee='PUBLIC'
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: project code claims table is publicly readable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass(format('%I.graph_entities', current_schema()))
      AND tgname = 'project_graph_entity_write_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project Graph entity guard trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass(format('%I.project_provisioning_runs', current_schema()))
      AND tgname = 'project_provisioning_receipts_no_mutation'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project provisioning receipt trigger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = to_regclass(format('%I.project_provisioning_steps', current_schema()))
      AND tgname = 'project_provisioning_step_receipts_no_mutation'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'INFO_SSOT_READBACK_FAILED: missing project provisioning step receipt trigger';
  END IF;
END
$project_provisioning_readback$;

SELECT 'INFO_SSOT_READBACK_OK' AS marker;
