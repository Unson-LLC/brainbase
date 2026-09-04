-- Transaction-local Info SSOT RLS negative smoke.
-- The caller must execute this file with --single-transaction. The fixture is
-- deleted before commit so a successful run leaves no graph mutation behind.

\set ON_ERROR_STOP on

DO $info_ssot_negative_smoke$
DECLARE
  fixture_project_id text;
  fixture_project_code text;
  other_project_id text;
  other_project_code text;
  fixture_entity_id text := format('info_ssot_negative_smoke_%s', txid_current());
  fixture_decision_id text := format('info_ssot_negative_smoke_decision_%s', txid_current());
  fixture_product_id text := format('info_ssot_negative_smoke_product_%s', txid_current());
  fixture_edge_id text := format('info_ssot_negative_smoke_wrong_owner_edge_%s', txid_current());
  fixture_registry_code text := format('info-ssot-rls-%s', txid_current());
  fixture_outcome_case_id text := format('outcome_case_rls_%s', txid_current());
  fixture_organization_id text := format('org_info_ssot_%s', txid_current());
  visible_count integer;
  deleted_count integer;
  edge_count integer;
  edge_rejected boolean := false;
BEGIN
  PERFORM set_config('app.organization_id', fixture_organization_id, true);
  INSERT INTO project_registry (
    project_code, organization_id, display_name, kind, catalog_version,
    organization_entity_id, owner_person_id
  ) VALUES (
    fixture_registry_code, fixture_organization_id, 'Info SSOT RLS fixture',
    'internal', 1, 'org_fixture', 'person_fixture'
  );
  SELECT count(*) INTO visible_count FROM project_registry WHERE project_code = fixture_registry_code;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: authorized project registry fixture was not readable';
  END IF;
  PERFORM set_config('app.organization_id', '__info_ssot_denied_organization__', true);
  SELECT count(*) INTO visible_count FROM project_registry WHERE project_code = fixture_registry_code;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: cross-organization project registry fixture was readable';
  END IF;
  PERFORM set_config('app.organization_id', fixture_organization_id, true);
  DELETE FROM project_registry WHERE project_code = fixture_registry_code;

  SELECT p.id, p.code
    INTO fixture_project_id, fixture_project_code
  FROM projects p
  WHERE p.code ~ '^[^,[:space:]]+$'
  ORDER BY p.code
  LIMIT 1;

  IF fixture_project_id IS NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: no safe project fixture is available';
  END IF;

  SELECT p.id, p.code
    INTO other_project_id, other_project_code
  FROM projects p
  WHERE p.id <> fixture_project_id
    AND p.code ~ '^[^,[:space:]]+$'
  ORDER BY p.code
  LIMIT 1;

  IF other_project_id IS NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: two safe projects are required for wrong-owner edge smoke';
  END IF;

  PERFORM set_config('app.role', 'member', true);
  PERFORM set_config('app.project_codes', fixture_project_code, true);
  PERFORM set_config('app.clearance', 'internal', true);

  INSERT INTO outcome_cases (
    case_id, project_code, capability_id, user_observable_outcome,
    protected_constraints, non_goals, authority, selected_domain_pack,
    reference_resolution, evaluation_history, terminal_evaluation, closure_status,
    current_external_state, technical_story_refs, run_receipt_refs, prior_attempt_refs,
    unresolved_failure_boundary, revision
  ) VALUES (
    fixture_outcome_case_id, fixture_project_code, 'info_ssot_negative_smoke', 'RLS fixture',
    '[]'::jsonb, '[]'::jsonb, '{"state":"unresolved","reason":"fixture"}'::jsonb, 'fixture/v1',
    '{}'::jsonb, '[]'::jsonb, NULL, 'open', 'processing', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    NULL, 1
  );
  SELECT count(*) INTO visible_count FROM outcome_cases WHERE case_id = fixture_outcome_case_id;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: authorized outcome case fixture was not readable';
  END IF;
  PERFORM set_config('app.project_codes', '__info_ssot_denied_scope__', true);
  SELECT count(*) INTO visible_count FROM outcome_cases WHERE case_id = fixture_outcome_case_id;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: cross-project outcome case fixture was readable';
  END IF;
  PERFORM set_config('app.project_codes', fixture_project_code, true);
  DELETE FROM outcome_cases WHERE case_id = fixture_outcome_case_id;

  INSERT INTO graph_entities (
    id,
    entity_type,
    project_id,
    payload,
    role_min,
    sensitivity
  ) VALUES (
    fixture_entity_id,
    'info_ssot_negative_smoke',
    fixture_project_id,
    '{"purpose":"deployment-negative-smoke"}'::jsonb,
    'member',
    'internal'
  );

  SELECT count(*)
    INTO visible_count
  FROM graph_entities
  WHERE id = fixture_entity_id;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: authorized fixture was not readable';
  END IF;

  PERFORM set_config('app.project_codes', '__info_ssot_denied_scope__', true);
  SELECT count(*)
    INTO visible_count
  FROM graph_entities
  WHERE id = fixture_entity_id;
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: denied fixture was readable';
  END IF;

  -- A governs edge must be owned by the Decision's project. Even a CEO with
  -- both scopes must not be able to write a wrong-owner cross-project edge.
  PERFORM set_config('app.role', 'ceo', true);
  PERFORM set_config('app.project_codes', fixture_project_code || ',' || other_project_code, true);
  PERFORM set_config('app.clearance', 'restricted', true);

  INSERT INTO graph_entities (
    id,
    entity_type,
    project_id,
    payload,
    role_min,
    sensitivity
  ) VALUES
    (
      fixture_decision_id,
      'decision',
      fixture_project_id,
      '{"purpose":"wrong-owner-edge-source"}'::jsonb,
      'ceo',
      'restricted'
    ),
    (
      fixture_product_id,
      'product',
      other_project_id,
      '{"purpose":"wrong-owner-edge-target"}'::jsonb,
      'ceo',
      'restricted'
    );

  BEGIN
    INSERT INTO graph_edges (
      id,
      from_id,
      to_id,
      rel_type,
      project_id,
      payload,
      role_min,
      sensitivity
    ) VALUES (
      fixture_edge_id,
      fixture_decision_id,
      fixture_product_id,
      'governs',
      other_project_id,
      jsonb_build_object(
        'cross_tenant', 'true',
        'target_project_code', other_project_code
      ),
      'ceo',
      'restricted'
    );
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: wrong-owner governs edge was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      edge_rejected := true;
  END;

  IF NOT edge_rejected THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: wrong-owner governs edge was not rejected';
  END IF;

  SELECT count(*)
    INTO edge_count
  FROM graph_edges
  WHERE id = fixture_edge_id;
  IF edge_count <> 0 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: wrong-owner edge fixture remained after rejection';
  END IF;

  -- Keep CEO clearance for cleanup because DELETE under FORCE RLS also needs
  -- the row to be visible through the table's SELECT policy.
  PERFORM set_config('app.role', 'ceo', true);
  PERFORM set_config('app.project_codes', fixture_project_code || ',' || other_project_code, true);
  PERFORM set_config('app.clearance', 'internal,restricted', true);
  DELETE FROM graph_entities
  WHERE id IN (fixture_entity_id, fixture_decision_id, fixture_product_id);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 3 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: fixture cleanup did not remove three rows';
  END IF;

  SELECT count(*)
    INTO visible_count
  FROM graph_entities
  WHERE id IN (fixture_entity_id, fixture_decision_id, fixture_product_id);
  SELECT count(*)
    INTO edge_count
  FROM graph_edges
  WHERE id = fixture_edge_id;
  IF visible_count <> 0 OR edge_count <> 0 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: fixture residual remained after cleanup';
  END IF;
END
$info_ssot_negative_smoke$;

SELECT 'INFO_SSOT_NEGATIVE_SMOKE_OK' AS marker;
