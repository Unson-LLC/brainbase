-- Graph vector search PostgreSQL integration smoke.
--
-- Run this file with psql as the database owner (or another role that can
-- SET ROLE brainbase_app) after graph-vector-search.sql and info-ssot-rls.sql
-- have been applied:
--
--   psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname "$DATABASE_URL" \
--     --file server/sql/graph-vector-search-smoke.sql
--
-- This is deliberately SQL-only and always ROLLBACKs. It creates an isolated
-- schema, copies the live graph RLS policies into that schema, exercises the
-- actual pgvector type/operator, and leaves no fixture or grant behind.

\set ON_ERROR_STOP on

BEGIN;

-- Fail with a useful message before parsing the vector fixture table when the
-- extension was not installed by the database operator.
SET LOCAL search_path TO public, pg_catalog;
DO $graph_vector_extension_check$
DECLARE
  vector_oid oid;
BEGIN
  vector_oid := to_regtype('vector');
  IF vector_oid IS NULL THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: pgvector type vector is unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_operator
    WHERE oprname = '<=>'
      AND oprleft = vector_oid
      AND oprright = vector_oid
  ) THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: pgvector cosine operator <=> is unavailable';
  END IF;
  IF to_regprocedure('vector_dims(vector)') IS NULL THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: pgvector function vector_dims(vector) is unavailable';
  END IF;
  IF to_regprocedure('brainbase_graph_embedding_text(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: embedding text function is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_app') THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: role brainbase_app is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'brainbase_app'
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: brainbase_app must not bypass RLS';
  END IF;
END
$graph_vector_extension_check$;

-- A transaction-local, unique schema keeps the fixture independent from
-- existing Graph rows and makes a failed psql session safe by connection
-- teardown rollback as well.
SELECT format('graph_vector_search_smoke_%s', txid_current()) AS smoke_schema \gset
CREATE SCHEMA :"smoke_schema";
SET LOCAL search_path TO :"smoke_schema", public, pg_catalog;

CREATE TABLE projects (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  organization_id text
);

CREATE TABLE graph_entities (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  project_id text REFERENCES projects(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE graph_edges (
  id text PRIMARY KEY,
  from_id text NOT NULL,
  to_id text NOT NULL,
  rel_type text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, rel_type)
);

-- The production migration is vector(768). Using the real type here catches a
-- missing extension, a dimension drift, and an invalid cast before any search
-- result assertion is considered.
CREATE TABLE graph_entity_embeddings (
  entity_id text NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(768) NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, model_id)
);

-- Copy the current production graph policies rather than maintaining a second
-- hand-written copy in this smoke. Expressions resolve against the isolated
-- tables because the smoke schema is first on search_path.
DO $graph_vector_copy_graph_policies$
DECLARE
  policy_row record;
  roles_sql text;
  statement text;
  qual_sql text;
  with_check_sql text;
  fixture_table text;
BEGIN
  FOR policy_row IN
    SELECT *
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('graph_entities', 'graph_edges')
    ORDER BY tablename, policyname
  LOOP
    IF policy_row.roles IS NULL OR cardinality(policy_row.roles) = 0 THEN
      roles_sql := 'PUBLIC';
    ELSE
      SELECT string_agg(
        CASE WHEN role_name = 'public' THEN 'PUBLIC' ELSE quote_ident(role_name) END,
        ', '
        ORDER BY role_name
      )
      INTO roles_sql
      FROM unnest(policy_row.roles) AS role_names(role_name);
    END IF;

    -- pg_policies.qual is produced by pg_get_expr(). PostgreSQL may qualify
    -- an originally-unqualified relation as public.projects (and likewise
    -- graph_entities/graph_edges). Those three names must point at the
    -- isolated fixture; public helper functions remain public on purpose.
    qual_sql := policy_row.qual;
    with_check_sql := policy_row.with_check;
    FOREACH fixture_table IN ARRAY ARRAY['projects', 'graph_entities', 'graph_edges'] LOOP
      qual_sql := replace(qual_sql, format('public.%s', fixture_table), fixture_table);
      qual_sql := replace(qual_sql, format('"public"."%s"', fixture_table), fixture_table);
      with_check_sql := replace(with_check_sql, format('public.%s', fixture_table), fixture_table);
      with_check_sql := replace(with_check_sql, format('"public"."%s"', fixture_table), fixture_table);
    END LOOP;

    statement := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      policy_row.policyname,
      current_schema(),
      policy_row.tablename,
      policy_row.permissive,
      policy_row.cmd,
      roles_sql
    );
    IF qual_sql IS NOT NULL THEN
      statement := statement || format(' USING (%s)', qual_sql);
    END IF;
    IF with_check_sql IS NOT NULL THEN
      statement := statement || format(' WITH CHECK (%s)', with_check_sql);
    END IF;
    EXECUTE statement;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'graph_entities'
      AND policyname = 'info_graph_entities_select'
  ) THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: production graph entity SELECT policy is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'graph_entities'
      AND policyname = 'info_graph_entities_update'
  ) THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: production graph entity UPDATE policy is missing';
  END IF;
END
$graph_vector_copy_graph_policies$;

ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_embeddings FORCE ROW LEVEL SECURITY;

-- This must remain equivalent to graph-vector-search.sql. It is intentionally
-- attached after the copied Graph policies so the test covers the new derived
-- table's own ACL boundary as well.
CREATE POLICY graph_embeddings_visible_entity ON graph_entity_embeddings
  USING (EXISTS (SELECT 1 FROM graph_entities g WHERE g.id = entity_id))
  WITH CHECK (EXISTS (SELECT 1 FROM graph_entities g WHERE g.id = entity_id));

GRANT USAGE ON SCHEMA :"smoke_schema" TO brainbase_app;
GRANT SELECT, UPDATE ON projects, graph_entities, graph_edges, graph_entity_embeddings
  TO brainbase_app;

-- Fixture writes happen before SET ROLE and are all inside this transaction.
-- The same project has one ready row and one pending row. The other project
-- and finance row deliberately have vectors too, so a leaked embedding row
-- would be observable under the restricted access context.
INSERT INTO projects (id, code, name, organization_id) VALUES
  ('graph-vector-smoke-project', 'brainbase', 'Graph vector smoke project', 'unson'),
  ('graph-vector-smoke-other-project', 'other-project', 'Graph vector hidden project', 'unson');

INSERT INTO graph_entities (
  id, entity_type, project_id, payload, role_min, sensitivity
) VALUES
  (
    'graph-vector-smoke-visible', 'decision', 'graph-vector-smoke-project',
    '{"title":"visible source v1","metadata":"before"}'::jsonb,
    'member', 'internal'
  ),
  (
    'graph-vector-smoke-pending', 'decision', 'graph-vector-smoke-project',
    '{"title":"pending source","metadata":"before"}'::jsonb,
    'member', 'internal'
  ),
  (
    'graph-vector-smoke-other', 'decision', 'graph-vector-smoke-other-project',
    '{"title":"other project source"}'::jsonb,
    'member', 'internal'
  ),
  (
    'graph-vector-smoke-finance', 'decision', 'graph-vector-smoke-project',
    '{"title":"finance source"}'::jsonb,
    'ceo', 'finance'
  );

INSERT INTO graph_edges (
  id, from_id, to_id, rel_type, project_id, payload, role_min, sensitivity
) VALUES (
  'graph-vector-smoke-edge',
  'graph-vector-smoke-visible',
  'graph-vector-smoke-pending',
  'supports',
  'graph-vector-smoke-project',
  '{}'::jsonb,
  'member',
  'internal'
);

WITH fixture_vector AS (
  SELECT format('[%s]', array_to_string(
    ARRAY(
      SELECT CASE WHEN number = 1 THEN '1' ELSE '0' END
      FROM generate_series(1, 768) AS numbers(number)
    ),
    ','
  ))::vector AS embedding
),
source_rows AS (
  SELECT id, md5(brainbase_graph_embedding_text(payload)) AS content_hash
  FROM graph_entities
  WHERE id IN (
    'graph-vector-smoke-visible',
    'graph-vector-smoke-other',
    'graph-vector-smoke-finance'
  )
)
INSERT INTO graph_entity_embeddings (entity_id, model_id, content_hash, embedding)
SELECT source_rows.id, 'graph-vector-smoke-model-v1', source_rows.content_hash, fixture_vector.embedding
FROM source_rows CROSS JOIN fixture_vector;

-- Make the fixture tables owned by the same non-bypass role that the service
-- uses. FORCE ROW LEVEL SECURITY must therefore apply to the table owner too;
-- testing only as a superuser would leave that production boundary untested.
ALTER TABLE projects OWNER TO brainbase_app;
ALTER TABLE graph_entities OWNER TO brainbase_app;
ALTER TABLE graph_edges OWNER TO brainbase_app;
ALTER TABLE graph_entity_embeddings OWNER TO brainbase_app;

-- Every subsequent read is made through the same non-bypass application role
-- and settings used by the service. The role is intentionally set only after
-- fixture creation, so accidental superuser visibility cannot pass the checks.
SET LOCAL ROLE brainbase_app;
SELECT set_config('app.role', 'member', true);
SELECT set_config('app.project_codes', 'brainbase', true);
SELECT set_config('app.clearance', 'internal', true);
SELECT set_config('app.graph_maintenance_mode', 'false', true);

DO $graph_vector_visibility_smoke$
DECLARE
  visible_count integer;
  owner_count integer;
BEGIN
  IF current_user <> 'brainbase_app' THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: SET LOCAL ROLE did not enter brainbase_app';
  END IF;
  SELECT count(*)::integer INTO owner_count
  FROM pg_class c
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE c.relnamespace = current_schema()::regnamespace
    AND c.relname IN ('graph_entities', 'graph_edges', 'graph_entity_embeddings')
    AND r.rolname = 'brainbase_app'
    AND c.relforcerowsecurity;
  IF owner_count <> 3 THEN
    RAISE EXCEPTION
      'GRAPH_VECTOR_SMOKE_FAILED: expected all 3 protected fixture tables to be brainbase_app owners with FORCE RLS, got %',
      owner_count;
  END IF;
  SELECT count(*) INTO visible_count FROM graph_entities;
  IF visible_count <> 2 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: expected 2 visible entities, got %', visible_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM graph_entities
    WHERE id IN ('graph-vector-smoke-other', 'graph-vector-smoke-finance')
  ) THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: cross-project or finance entity leaked through RLS';
  END IF;
END
$graph_vector_visibility_smoke$;

DO $graph_vector_type_smoke$
DECLARE
  dimensions integer;
  distance double precision;
BEGIN
  SELECT vector_dims(embedding), embedding <=> embedding
  INTO dimensions, distance
  FROM graph_entity_embeddings
  WHERE entity_id = 'graph-vector-smoke-visible';
  IF dimensions <> 768 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: expected vector dimension 768, got %', dimensions;
  END IF;
  IF distance IS NULL OR abs(distance) > 0.000001 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: cosine operator self-distance was %', distance;
  END IF;
END
$graph_vector_type_smoke$;

DO $graph_vector_coverage_smoke$
DECLARE
  total_count integer;
  ready_count integer;
  pending_count integer;
BEGIN
  SELECT count(*)::integer, count(v.entity_id)::integer
  INTO total_count, ready_count
  FROM graph_entities g
  LEFT JOIN graph_entity_embeddings v
    ON v.entity_id = g.id
   AND v.model_id = 'graph-vector-smoke-model-v1'
   AND v.content_hash = md5(brainbase_graph_embedding_text(g.payload));
  pending_count := total_count - ready_count;
  IF total_count <> 2 OR ready_count <> 1 OR pending_count <> 1 THEN
    RAISE EXCEPTION
      'GRAPH_VECTOR_SMOKE_FAILED: initial coverage expected total=2 ready=1 pending=1, got total=% ready=% pending=%',
      total_count, ready_count, pending_count;
  END IF;
  PERFORM set_config(
    'graph_vector_smoke.visible_hash',
    (SELECT md5(brainbase_graph_embedding_text(payload))
     FROM graph_entities WHERE id = 'graph-vector-smoke-visible'),
    true
  );
END
$graph_vector_coverage_smoke$;

-- Metadata is outside brainbase_graph_embedding_text and must not force an
-- unnecessary paid re-embedding.
DO $graph_vector_metadata_smoke$
DECLARE
  changed_count integer;
  current_hash text;
BEGIN
  UPDATE graph_entities
  SET payload = payload || '{"metadata":"after"}'::jsonb,
      updated_at = now()
  WHERE id = 'graph-vector-smoke-visible';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: metadata-only fixture update was not visible to brainbase_app';
  END IF;
  SELECT md5(brainbase_graph_embedding_text(payload))
  INTO current_hash
  FROM graph_entities
  WHERE id = 'graph-vector-smoke-visible';
  IF current_hash IS DISTINCT FROM current_setting('graph_vector_smoke.visible_hash') THEN
    RAISE EXCEPTION
      'GRAPH_VECTOR_SMOKE_FAILED: metadata-only update changed embedding hash from % to %',
      current_setting('graph_vector_smoke.visible_hash'), current_hash;
  END IF;
END
$graph_vector_metadata_smoke$;

-- A source field included in the embedding text invalidates the old vector.
-- The vector row stays present for audit/reindex, but the service join must
-- exclude it because its content_hash no longer matches.
DO $graph_vector_source_hash_smoke$
DECLARE
  changed_count integer;
  matching_vectors integer;
  total_count integer;
  ready_count integer;
BEGIN
  UPDATE graph_entities
  SET payload = payload || '{"title":"visible source v2"}'::jsonb,
      updated_at = now()
  WHERE id = 'graph-vector-smoke-visible';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: source hash fixture update was not visible to brainbase_app';
  END IF;

  SELECT count(*)::integer INTO matching_vectors
  FROM graph_entities g
  JOIN graph_entity_embeddings v
    ON v.entity_id = g.id
   AND v.model_id = 'graph-vector-smoke-model-v1'
   AND v.content_hash = md5(brainbase_graph_embedding_text(g.payload))
  WHERE g.id = 'graph-vector-smoke-visible';
  IF matching_vectors <> 0 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: changed source still matched the old vector';
  END IF;

  SELECT count(*)::integer, count(v.entity_id)::integer
  INTO total_count, ready_count
  FROM graph_entities g
  LEFT JOIN graph_entity_embeddings v
    ON v.entity_id = g.id
   AND v.model_id = 'graph-vector-smoke-model-v1'
   AND v.content_hash = md5(brainbase_graph_embedding_text(g.payload));
  IF total_count <> 2 OR ready_count <> 0 THEN
    RAISE EXCEPTION
      'GRAPH_VECTOR_SMOKE_FAILED: changed source expected total=2 ready=0 pending=2, got total=% ready=%',
      total_count, ready_count;
  END IF;
END
$graph_vector_source_hash_smoke$;

-- The source table remains authoritative. Deleting a source entity must remove
-- its derived vector through the production ON DELETE CASCADE contract.
RESET ROLE;
DELETE FROM graph_entities WHERE id = 'graph-vector-smoke-visible';
DO $graph_vector_cascade_smoke$
DECLARE
  remaining_vectors integer;
BEGIN
  SELECT count(*)::integer INTO remaining_vectors
  FROM graph_entity_embeddings
  WHERE entity_id = 'graph-vector-smoke-visible';
  IF remaining_vectors <> 0 THEN
    RAISE EXCEPTION 'GRAPH_VECTOR_SMOKE_FAILED: source delete left % derived vectors', remaining_vectors;
  END IF;
END
$graph_vector_cascade_smoke$;

-- This result is emitted only after every assertion succeeded. The preceding
-- transaction is intentionally rolled back so the isolated schema and grants
-- cannot survive the smoke.
ROLLBACK;
SELECT 'graph_vector_search_smoke_ok' AS status;
