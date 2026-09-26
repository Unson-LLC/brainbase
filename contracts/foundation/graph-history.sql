/*
 * Canonical Graph Foundation history
 *
 * This migration is deliberately limited to public.graph_entities and the
 * history objects created below.  The application role must not receive
 * INSERT/UPDATE/DELETE on graph_foundation_revisions.  The host migration
 * should grant SELECT on that table to the same runtime roles that can read
 * graph_entities; the policy below still requires the current row to be
 * visible through graph_entities RLS.
 *
 * The host applies this file inside its existing single transaction.  Do not
 * add BEGIN/COMMIT here: the host applies schema, RLS, this migration, and
 * its readback checks atomically.
 */

LOCK TABLE public.graph_entities IN SHARE ROW EXCLUSIVE MODE;

DO $graph_history_required_columns$
DECLARE
  missing_columns text[];
BEGIN
  IF to_regclass('public.graph_entities') IS NULL THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_MISSING_GRAPH_ENTITIES'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT array_agg(required_column ORDER BY required_column)
    INTO missing_columns
  FROM (VALUES
    ('id'),
    ('entity_type'),
    ('project_id'),
    ('payload'),
    ('role_min'),
    ('sensitivity'),
    ('lifecycle_status'),
    ('version')
  ) AS required(required_column)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'graph_entities'
      AND c.column_name = required.required_column
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_GRAPH_ENTITIES_COLUMNS_MISSING: %', missing_columns
      USING ERRCODE = 'undefined_column';
  END IF;
END;
$graph_history_required_columns$;

/* PostgreSQL 18/PGlite exposes sha256(bytea) in the core catalog. */
CREATE OR REPLACE FUNCTION public.graph_foundation_storage_digest(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $graph_foundation_storage_digest$
  SELECT 'sha256:' || encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
$graph_foundation_storage_digest$;

CREATE TABLE IF NOT EXISTS public.graph_foundation_revisions (
  entity_id text NOT NULL,
  entity_type text NOT NULL
    CONSTRAINT graph_foundation_revisions_entity_type_check
    CHECK (entity_type IN ('objective', 'variable', 'model', 'constraint', 'philosophy')),
  revision text NOT NULL
    CONSTRAINT graph_foundation_revisions_revision_check
    CHECK (revision ~ '^[1-9][0-9]*$'),
  payload jsonb NOT NULL,
  project_id text,
  role_min text,
  sensitivity text,
  lifecycle_status text,
  storage_digest text NOT NULL
    CONSTRAINT graph_foundation_revisions_storage_digest_format_check
    CHECK (storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT graph_foundation_revisions_storage_digest_check
    CHECK (storage_digest = public.graph_foundation_storage_digest(payload)),
  CONSTRAINT graph_foundation_revisions_pkey
    PRIMARY KEY (entity_id, entity_type, revision)
);

/* Make a pre-existing table from an interrupted/older attempt converge. */
DO $graph_history_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.graph_foundation_revisions'::regclass
      AND conname = 'graph_foundation_revisions_entity_type_check'
  ) THEN
    ALTER TABLE public.graph_foundation_revisions
      ADD CONSTRAINT graph_foundation_revisions_entity_type_check
      CHECK (entity_type IN ('objective', 'variable', 'model', 'constraint', 'philosophy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.graph_foundation_revisions'::regclass
      AND conname = 'graph_foundation_revisions_revision_check'
  ) THEN
    ALTER TABLE public.graph_foundation_revisions
      ADD CONSTRAINT graph_foundation_revisions_revision_check
      CHECK (revision ~ '^[1-9][0-9]*$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.graph_foundation_revisions'::regclass
      AND conname = 'graph_foundation_revisions_storage_digest_format_check'
  ) THEN
    ALTER TABLE public.graph_foundation_revisions
      ADD CONSTRAINT graph_foundation_revisions_storage_digest_format_check
      CHECK (storage_digest ~ '^sha256:[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.graph_foundation_revisions'::regclass
      AND conname = 'graph_foundation_revisions_storage_digest_check'
  ) THEN
    ALTER TABLE public.graph_foundation_revisions
      ADD CONSTRAINT graph_foundation_revisions_storage_digest_check
      CHECK (storage_digest = public.graph_foundation_storage_digest(payload));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.graph_foundation_revisions'::regclass
      AND conname = 'graph_foundation_revisions_pkey'
  ) THEN
    ALTER TABLE public.graph_foundation_revisions
      ADD CONSTRAINT graph_foundation_revisions_pkey
      PRIMARY KEY (entity_id, entity_type, revision);
  END IF;
END;
$graph_history_constraints$;

/*
 * This private table supplies a per-trigger nonce.  A caller cannot make a
 * direct history INSERT look like the SECURITY DEFINER append helper merely
 * by setting a custom GUC: the nonce must have been created by that helper in
 * the same transaction and backend.
 */
CREATE TABLE IF NOT EXISTS public.graph_foundation_capture_nonces (
  nonce text PRIMARY KEY,
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE public.graph_foundation_capture_nonces FROM PUBLIC;
REVOKE ALL ON TABLE public.graph_foundation_revisions FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assert_graph_foundation_payload(
  p_entity_id text,
  p_entity_type text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $assert_graph_foundation_payload$
DECLARE
  foundation jsonb;
  required_key text;
  required_keys text[];
BEGIN
  IF p_entity_type NOT IN ('objective', 'variable', 'model', 'constraint') THEN
    IF p_entity_type = 'philosophy' AND jsonb_typeof(p_payload) = 'object' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_INVALID_ENTITY_TYPE: %', p_entity_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_PAYLOAD_MUST_BE_OBJECT: %', p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  foundation := p_payload -> 'foundation';
  IF foundation IS NULL OR jsonb_typeof(foundation) <> 'object' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_DEFINITION_REQUIRED: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF foundation ->> 'id' IS DISTINCT FROM p_entity_id THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_ID_MISMATCH: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF foundation ->> 'type' IS DISTINCT FROM p_entity_type THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_TYPE_MISMATCH: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF foundation ->> 'revision' IS NULL
     OR foundation ->> 'revision' !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_REVISION_INVALID: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  required_keys := ARRAY[
    'id', 'type', 'revision', 'meaning', 'adoptionState', 'authorizedUses',
    'acl', 'storage', 'provenance', 'scope'
  ];
  FOREACH required_key IN ARRAY required_keys LOOP
    IF NOT (foundation ? required_key)
       OR jsonb_typeof(foundation -> required_key) = 'null' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_FIELD_REQUIRED: %/% %',
        p_entity_type, p_entity_id, required_key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF jsonb_typeof(foundation -> 'meaning') <> 'string'
     OR jsonb_typeof(foundation -> 'adoptionState') <> 'string'
     OR jsonb_typeof(foundation -> 'authorizedUses') <> 'array'
     OR jsonb_typeof(foundation -> 'provenance') <> 'array'
     OR jsonb_typeof(foundation -> 'acl') <> 'object'
     OR jsonb_typeof(foundation -> 'scope') <> 'object' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_BASE_INVALID: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (foundation -> 'acl' ? 'ownerId')
     OR NOT (foundation -> 'acl' ? 'visibility')
     OR NOT (foundation -> 'acl' ? 'readerIds')
     OR NOT (foundation -> 'acl' ? 'writerIds')
     OR jsonb_typeof(foundation -> 'acl' -> 'ownerId') <> 'string'
     OR jsonb_typeof(foundation -> 'acl' -> 'visibility') <> 'string'
     OR jsonb_typeof(foundation -> 'acl' -> 'readerIds') <> 'array'
     OR jsonb_typeof(foundation -> 'acl' -> 'writerIds') <> 'array' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_ACL_INVALID: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (foundation -> 'scope' ? 'subjectIds')
     OR NOT (foundation -> 'scope' ? 'validFrom')
     OR jsonb_typeof(foundation -> 'scope' -> 'subjectIds') <> 'array'
     OR jsonb_typeof(foundation -> 'scope' -> 'validFrom') <> 'string'
     OR ((foundation -> 'scope') ? 'validUntil'
         AND jsonb_typeof(foundation -> 'scope' -> 'validUntil') <> 'string') THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_SCOPE_INVALID: %/%', p_entity_type, p_entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_entity_type = 'objective' THEN
    IF NOT (foundation ? 'beneficiaryIds')
       OR NOT (foundation ? 'desiredState')
       OR NOT (foundation ? 'criteria')
       OR NOT (foundation ? 'evaluationPeriod')
       OR jsonb_typeof(foundation -> 'beneficiaryIds') <> 'array'
       OR jsonb_typeof(foundation -> 'desiredState') <> 'string'
       OR jsonb_typeof(foundation -> 'criteria') <> 'array'
       OR jsonb_typeof(foundation -> 'evaluationPeriod') <> 'object' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_OBJECTIVE_FIELDS_INVALID: %/%', p_entity_type, p_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_entity_type = 'variable' THEN
    IF NOT (foundation ? 'subject')
       OR NOT (foundation ? 'valueKind')
       OR NOT (foundation ? 'aggregation')
       OR NOT (foundation ? 'granularity')
       OR NOT (foundation ? 'measurementMethod')
       OR jsonb_typeof(foundation -> 'subject') <> 'string'
       OR jsonb_typeof(foundation -> 'valueKind') <> 'string'
       OR jsonb_typeof(foundation -> 'aggregation') <> 'string'
       OR jsonb_typeof(foundation -> 'granularity') <> 'string'
       OR jsonb_typeof(foundation -> 'measurementMethod') <> 'string' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_VARIABLE_FIELDS_INVALID: %/%', p_entity_type, p_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_entity_type = 'model' THEN
    IF NOT (foundation ? 'epistemicState')
       OR NOT (foundation ? 'inputVariableRefs')
       OR NOT (foundation ? 'outputVariableRefs')
       OR NOT (foundation ? 'applicability')
       OR NOT (foundation ? 'relationship')
       OR NOT (foundation ? 'uncertainty')
       OR NOT (foundation ? 'validationState')
       OR jsonb_typeof(foundation -> 'epistemicState') <> 'string'
       OR jsonb_typeof(foundation -> 'inputVariableRefs') <> 'array'
       OR jsonb_typeof(foundation -> 'outputVariableRefs') <> 'array'
       OR jsonb_typeof(foundation -> 'applicability') <> 'object'
       OR jsonb_typeof(foundation -> 'relationship') <> 'string'
       OR jsonb_typeof(foundation -> 'uncertainty') <> 'string'
       OR jsonb_typeof(foundation -> 'validationState') <> 'string' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_MODEL_FIELDS_INVALID: %/%', p_entity_type, p_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_entity_type = 'constraint' THEN
    IF NOT (foundation ? 'condition')
       OR NOT (foundation ? 'appliesTo')
       OR NOT (foundation ? 'exceptions')
       OR NOT (foundation ? 'adoptionBasis')
       OR jsonb_typeof(foundation -> 'condition') <> 'string'
       OR jsonb_typeof(foundation -> 'appliesTo') <> 'array'
       OR jsonb_typeof(foundation -> 'exceptions') <> 'array'
       OR jsonb_typeof(foundation -> 'adoptionBasis') <> 'array' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_CONSTRAINT_FIELDS_INVALID: %/%', p_entity_type, p_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$assert_graph_foundation_payload$;

CREATE OR REPLACE FUNCTION public.guard_graph_foundation_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $guard_graph_foundation_revision_mutation$
DECLARE
  nonce_value text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_APPEND_ONLY: % is forbidden', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  nonce_value := current_setting('graph.foundation_capture_nonce', true);
  IF nonce_value IS NULL OR nonce_value = ''
     OR NOT EXISTS (
       SELECT 1
       FROM public.graph_foundation_capture_nonces AS nonce
       WHERE nonce.nonce = nonce_value
         AND nonce.transaction_id = txid_current()
         AND nonce.backend_pid = pg_backend_pid()
     ) THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_DIRECT_INSERT_FORBIDDEN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$guard_graph_foundation_revision_mutation$;

CREATE OR REPLACE FUNCTION public.append_graph_foundation_revision(
  p_entity_id text,
  p_entity_type text,
  p_revision text,
  p_payload jsonb,
  p_project_id text,
  p_role_min text,
  p_sensitivity text,
  p_lifecycle_status text,
  p_allow_migration_initial boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $append_graph_foundation_revision$
DECLARE
  nonce_value text;
  previous_revision numeric;
  expected_revision numeric;
  saved_digest text;
BEGIN
  IF p_entity_type NOT IN ('objective', 'variable', 'model', 'constraint', 'philosophy') THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_INVALID_ENTITY_TYPE: %', p_entity_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_entity_type = 'philosophy' THEN
    PERFORM public.assert_graph_foundation_payload(p_entity_id, p_entity_type, p_payload);
  ELSE
    PERFORM public.assert_graph_foundation_payload(p_entity_id, p_entity_type, p_payload);
    IF p_revision IS NULL OR p_revision !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_FOUNDATION_REVISION_INVALID: %/%', p_entity_type, p_entity_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  saved_digest := public.graph_foundation_storage_digest(p_payload);

  SELECT max(history.revision::numeric)
    INTO previous_revision
  FROM public.graph_foundation_revisions AS history
  WHERE history.entity_id = p_entity_id
    AND history.entity_type = p_entity_type;

  IF p_entity_type = 'philosophy' THEN
    expected_revision := coalesce(previous_revision, 0) + 1;
    p_revision := expected_revision::text;
  ELSE
    expected_revision := coalesce(previous_revision, 0) + 1;
    IF previous_revision IS NULL AND p_allow_migration_initial THEN
      expected_revision := p_revision::numeric;
    ELSIF p_revision::numeric <> expected_revision THEN
      RAISE EXCEPTION
        'GRAPH_FOUNDATION_HISTORY_REVISION_SEQUENCE: %/% expected %, got %',
        p_entity_type, p_entity_id, expected_revision::text, p_revision
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  nonce_value := md5(
    clock_timestamp()::text || ':' || txid_current()::text || ':' ||
    pg_backend_pid()::text || ':' || random()::text
  );
  INSERT INTO public.graph_foundation_capture_nonces (nonce, transaction_id, backend_pid)
  VALUES (nonce_value, txid_current(), pg_backend_pid());
  PERFORM set_config('graph.foundation_capture_nonce', nonce_value, true);

  BEGIN
    INSERT INTO public.graph_foundation_revisions (
      entity_id,
      entity_type,
      revision,
      payload,
      project_id,
      role_min,
      sensitivity,
      lifecycle_status,
      storage_digest
    ) VALUES (
      p_entity_id,
      p_entity_type,
      p_revision,
      p_payload,
      p_project_id,
      p_role_min,
      p_sensitivity,
      p_lifecycle_status,
      saved_digest
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('graph.foundation_capture_nonce', '', true);
    DELETE FROM public.graph_foundation_capture_nonces WHERE nonce = nonce_value;
    RAISE;
  END;

  PERFORM set_config('graph.foundation_capture_nonce', '', true);
  DELETE FROM public.graph_foundation_capture_nonces WHERE nonce = nonce_value;
END;
$append_graph_foundation_revision$;

REVOKE ALL ON FUNCTION public.append_graph_foundation_revision(
  text, text, text, jsonb, text, text, text, text, boolean
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.capture_graph_foundation_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $capture_graph_foundation_revision$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'graph_entities'
     OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'GRAPH_FOUNDATION_HISTORY_TRIGGER_ONLY'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.entity_type IN ('objective', 'variable', 'model', 'constraint', 'philosophy')
     AND (
       TG_OP = 'INSERT'
       OR OLD.id IS DISTINCT FROM NEW.id
       OR OLD.entity_type IS DISTINCT FROM NEW.entity_type
       OR OLD.payload IS DISTINCT FROM NEW.payload
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.role_min IS DISTINCT FROM NEW.role_min
       OR OLD.sensitivity IS DISTINCT FROM NEW.sensitivity
       OR OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
     ) THEN
    IF NEW.entity_type = 'philosophy' THEN
      PERFORM public.append_graph_foundation_revision(
        NEW.id, NEW.entity_type, NULL, NEW.payload, NEW.project_id,
        NEW.role_min, NEW.sensitivity, NEW.lifecycle_status, false
      );
    ELSE
      PERFORM public.append_graph_foundation_revision(
        NEW.id, NEW.entity_type, NEW.payload -> 'foundation' ->> 'revision', NEW.payload,
        NEW.project_id, NEW.role_min, NEW.sensitivity, NEW.lifecycle_status, false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$capture_graph_foundation_revision$;

/*
 * The SECURITY DEFINER append helper must see every prior revision while it
 * calculates max+1, including rows whose current Graph entity is inactive or
 * deleted.  Normalize this before the migration backfill below.
 */
ALTER TABLE public.graph_foundation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graph_foundation_revisions NO FORCE ROW LEVEL SECURITY;

/* Recreate both guards so a partially applied prior migration cannot leave a gap. */
DROP TRIGGER IF EXISTS graph_foundation_revisions_guard
  ON public.graph_foundation_revisions;
DROP TRIGGER IF EXISTS graph_foundation_revisions_truncate_guard
  ON public.graph_foundation_revisions;
CREATE TRIGGER graph_foundation_revisions_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.graph_foundation_revisions
FOR EACH ROW EXECUTE FUNCTION public.guard_graph_foundation_revision_mutation();
CREATE TRIGGER graph_foundation_revisions_truncate_guard
BEFORE TRUNCATE ON public.graph_foundation_revisions
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_graph_foundation_revision_mutation();

/* Existing graph rows are captured once.  No pre-migration history is inferred. */
SELECT public.append_graph_foundation_revision(
  graph.id,
  graph.entity_type,
  CASE WHEN graph.entity_type = 'philosophy'
    THEN NULL
    ELSE graph.payload -> 'foundation' ->> 'revision'
  END,
  graph.payload,
  graph.project_id,
  graph.role_min,
  graph.sensitivity,
  graph.lifecycle_status,
  true
)
FROM public.graph_entities AS graph
WHERE graph.entity_type IN ('objective', 'variable', 'model', 'constraint', 'philosophy')
  AND NOT EXISTS (
    SELECT 1
    FROM public.graph_foundation_revisions AS history
    WHERE history.entity_id = graph.id
      AND history.entity_type = graph.entity_type
      AND history.payload IS NOT DISTINCT FROM graph.payload
      AND history.project_id IS NOT DISTINCT FROM graph.project_id
      AND history.role_min IS NOT DISTINCT FROM graph.role_min
      AND history.sensitivity IS NOT DISTINCT FROM graph.sensitivity
      AND history.lifecycle_status IS NOT DISTINCT FROM graph.lifecycle_status
      AND history.storage_digest = public.graph_foundation_storage_digest(graph.payload)
  );

DROP TRIGGER IF EXISTS graph_entities_foundation_history_capture
  ON public.graph_entities;
CREATE TRIGGER graph_entities_foundation_history_capture
AFTER INSERT OR UPDATE ON public.graph_entities
FOR EACH ROW EXECUTE FUNCTION public.capture_graph_foundation_revision();

DROP POLICY IF EXISTS graph_foundation_revisions_current_graph_read
  ON public.graph_foundation_revisions;
CREATE POLICY graph_foundation_revisions_current_graph_read
ON public.graph_foundation_revisions
FOR SELECT
USING (
  storage_digest = public.graph_foundation_storage_digest(payload)
  AND EXISTS (
    SELECT 1
    FROM public.graph_entities AS current_graph
    WHERE current_graph.id = graph_foundation_revisions.entity_id
      AND current_graph.entity_type = graph_foundation_revisions.entity_type
      AND current_graph.lifecycle_status = 'active'
  )
);

/*
 * brainbase_app is the canonical host runtime role.  Keep this conditional so
 * local/OSS installs that use another role do not fail during migration; those
 * deployments must grant SELECT explicitly alongside their graph_entities
 * reader grant.  This is intentionally SELECT-only: capture runs through the
 * SECURITY DEFINER trigger and runtime roles never receive history writes.
 */
DO $graph_history_runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'brainbase_app') THEN
    REVOKE ALL ON TABLE public.graph_foundation_revisions FROM brainbase_app;
    GRANT SELECT ON TABLE public.graph_foundation_revisions TO brainbase_app;
    REVOKE ALL ON FUNCTION public.append_graph_foundation_revision(
      text, text, text, jsonb, text, text, text, text, boolean
    ) FROM brainbase_app;
  END IF;
END;
$graph_history_runtime_grant$;

/*
 * Stable host readback bindings:
 *   graph_entities_foundation_history_capture (AFTER INSERT OR UPDATE)
 *   graph_foundation_revisions_guard (BEFORE INSERT OR UPDATE OR DELETE)
 *   graph_foundation_revisions_truncate_guard (BEFORE TRUNCATE)
 *   graph_foundation_storage_digest(jsonb)
 */
