-- Transaction-local Info SSOT RLS negative smoke.
-- The caller must execute this file with --single-transaction. The fixture is
-- deleted before commit so a successful run leaves no graph mutation behind.

\set ON_ERROR_STOP on

DO $info_ssot_negative_smoke$
DECLARE
  fixture_project_id text;
  fixture_project_code text;
  fixture_entity_id text := format('info_ssot_negative_smoke_%s', txid_current());
  visible_count integer;
  deleted_count integer;
BEGIN
  SELECT p.id, p.code
    INTO fixture_project_id, fixture_project_code
  FROM projects p
  WHERE p.code ~ '^[^,[:space:]]+$'
  ORDER BY p.code
  LIMIT 1;

  IF fixture_project_id IS NULL THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: no safe project fixture is available';
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

  PERFORM set_config('app.role', 'gm', true);
  PERFORM set_config('app.project_codes', fixture_project_code, true);
  DELETE FROM graph_entities
  WHERE id = fixture_entity_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 1 THEN
    RAISE EXCEPTION 'INFO_SSOT_NEGATIVE_SMOKE_FAILED: fixture cleanup did not remove one row';
  END IF;
END
$info_ssot_negative_smoke$;

SELECT 'INFO_SSOT_NEGATIVE_SMOKE_OK' AS marker;
