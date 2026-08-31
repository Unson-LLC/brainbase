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
  fixture_project_a_id text := format('info_ssot_negative_smoke_project_a_%s', txid_current());
  fixture_project_b_id text := format('info_ssot_negative_smoke_project_b_%s', txid_current());
  fixture_project_a_code text := format('info_ssot_smoke_a_%s', txid_current());
  fixture_project_b_code text := format('info_ssot_smoke_b_%s', txid_current());
  visible_count integer;
  deleted_count integer;
  edge_count integer;
  edge_rejected boolean := false;
BEGIN
  -- A brand-new tenant database has no project rows yet. Keep this smoke test
  -- self-contained by creating two transaction-local fixtures and removing
  -- them before commit.
  INSERT INTO projects (id, code, name)
  VALUES
    (fixture_project_a_id, fixture_project_a_code, 'Info SSOT negative smoke A'),
    (fixture_project_b_id, fixture_project_b_code, 'Info SSOT negative smoke B');

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

  DELETE FROM projects
  WHERE id IN (fixture_project_a_id, fixture_project_b_id);
END
$info_ssot_negative_smoke$;

SELECT 'INFO_SSOT_NEGATIVE_SMOKE_OK' AS marker;
