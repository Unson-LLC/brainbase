-- Project Provisioning v1 execution ledger and canonical project registry.
-- local_path is intentionally absent: it belongs to per-user Workspace Setup.
CREATE TABLE IF NOT EXISTS project_registry (
  project_code text PRIMARY KEY,
  organization_id text NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL,
  catalog_version integer NOT NULL CHECK (catalog_version > 0),
  lifecycle_status text NOT NULL DEFAULT 'active',
  session_select boolean NOT NULL DEFAULT true,
  organization_entity_id text NOT NULL,
  owner_person_id text NOT NULL,
  repository jsonb NOT NULL DEFAULT '{"mode":"none"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Global project-code ownership is kept outside tenant-readable tables. The
-- table itself is not queryable by application roles; callers only receive a
-- collision source through the narrow SECURITY DEFINER function below.
CREATE TABLE IF NOT EXISTS project_code_claims (
  project_code text PRIMARY KEY,
  organization_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO project_code_claims (project_code, organization_id)
SELECT project_code, organization_id FROM project_registry
ON CONFLICT (project_code) DO NOTHING;

INSERT INTO project_code_claims (project_code, organization_id)
SELECT code, COALESCE(organization_id, '__unassigned__') FROM projects
ON CONFLICT (project_code) DO NOTHING;

REVOKE ALL ON TABLE project_code_claims FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_code_collision_sources(p_project_code text, p_organization_id text)
RETURNS TABLE(source text, code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'project_code_claim'::text, claim.project_code
  FROM public.project_code_claims claim
  WHERE claim.project_code = p_project_code
    AND claim.organization_id IS DISTINCT FROM p_organization_id;
$$;

REVOKE ALL ON FUNCTION project_code_collision_sources(text, text) FROM PUBLIC;

-- Probe a globally unique Graph entity id before Project Registry writes. The
-- caller receives the Project subject only inside its own organization. For a
-- cross-organization match, the function exposes only that the id is occupied.
DROP FUNCTION IF EXISTS project_graph_identity_probe(text, text);

CREATE OR REPLACE FUNCTION project_graph_identity_probe(p_entity_id text)
RETURNS TABLE(
  scope_relation text,
  entity_id text,
  entity_type text,
  lifecycle_status text,
  project_code text,
  entity_version integer,
  display_name text,
  catalog_project_id text,
  catalog_version integer,
  source_ref text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organization_id text := nullif(current_setting('app.organization_id', true), '');
BEGIN
  IF scoped_organization_id IS NULL THEN
    RAISE EXCEPTION 'project graph identity probe requires app.organization_id'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN p.organization_id = scoped_organization_id
      THEN 'same_organization'::text ELSE 'other_organization'::text END,
    ge.id,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.entity_type ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.lifecycle_status ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN p.code ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.version ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.payload->>'name' ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.payload->>'catalog_project_id' ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id
      AND ge.payload->>'catalog_version' ~ '^[1-9][0-9]*$'
      THEN (ge.payload->>'catalog_version')::integer ELSE NULL END,
    CASE WHEN p.organization_id = scoped_organization_id THEN ge.payload->>'source_ref' ELSE NULL END
  FROM public.graph_entities ge
  LEFT JOIN public.projects p ON p.id = ge.project_id
  WHERE ge.id = p_entity_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION project_graph_identity_probe(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_project_code(p_project_code text, p_organization_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claimed_organization_id text;
BEGIN
  INSERT INTO public.project_code_claims (project_code, organization_id)
  VALUES (p_project_code, p_organization_id)
  ON CONFLICT (project_code) DO NOTHING;

  SELECT organization_id INTO claimed_organization_id
  FROM public.project_code_claims
  WHERE project_code = p_project_code;

  IF claimed_organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'project code is already claimed'
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_project_code(text, text) FROM PUBLIC;

-- Enforce the Project identity boundary below every application service. This
-- trigger also covers one-off migration and remediation scripts that write
-- graph_entities directly. Service writers still acquire the same lock before
-- read/validate work so they can return the domain-specific retryable 409.
CREATE OR REPLACE FUNCTION guard_project_graph_entity_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  guarded_id text;
  catalog record;
  candidate_id text;
  candidate_entity_type text;
  candidate_lifecycle_status text;
  candidate_project_id text;
  candidate_payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Graph entity id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR guarded_id IN
    SELECT DISTINCT id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.id ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.id ELSE NULL END
    ]) AS ids(id)
    WHERE id IS NOT NULL
    ORDER BY id
  LOOP
    IF NOT pg_try_advisory_xact_lock(
      hashtextextended('brainbase:project-graph-identity:' || guarded_id, 0::bigint)
    ) THEN
      RAISE EXCEPTION 'Project Graph identity is busy: %', guarded_id
        USING ERRCODE = 'lock_not_available',
              DETAIL = json_build_object('entity_id', guarded_id, 'retryable', true)::text;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    candidate_id := OLD.id;
    candidate_entity_type := OLD.entity_type;
    candidate_lifecycle_status := OLD.lifecycle_status;
    candidate_project_id := OLD.project_id;
    candidate_payload := OLD.payload;
  ELSE
    candidate_id := NEW.id;
    candidate_entity_type := NEW.entity_type;
    candidate_lifecycle_status := NEW.lifecycle_status;
    candidate_project_id := NEW.project_id;
    candidate_payload := NEW.payload;
  END IF;

  SELECT pr.project_code, pr.organization_id, pr.display_name, pr.catalog_version
  INTO catalog
  FROM public.project_registry pr
  WHERE pr.project_code = candidate_id;

  IF FOUND THEN
    IF TG_OP = 'DELETE'
       OR candidate_entity_type IS DISTINCT FROM 'project'
       OR candidate_lifecycle_status IS DISTINCT FROM 'active'
       OR candidate_payload->>'catalog_project_id' IS DISTINCT FROM catalog.project_code
       OR candidate_payload->>'catalog_version' IS DISTINCT FROM catalog.catalog_version::text
       OR candidate_payload->>'source_ref' IS DISTINCT FROM
          ('project-catalog:' || catalog.project_code || '@' || catalog.catalog_version::text)
       OR btrim(coalesce(candidate_payload->>'name', '')) IS DISTINCT FROM btrim(catalog.display_name)
       OR NOT EXISTS (
         SELECT 1 FROM public.projects scope
         WHERE scope.id = candidate_project_id
           AND scope.organization_id = catalog.organization_id
       ) THEN
      RAISE EXCEPTION 'Project Catalog subject projection is protected: %', candidate_id
        USING ERRCODE = 'check_violation',
              DETAIL = json_build_object(
                'entity_id', candidate_id,
                'reason', 'catalog_projection_mismatch'
              )::text;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_project_graph_entity_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS project_graph_entity_write_guard ON graph_entities;
CREATE TRIGGER project_graph_entity_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON graph_entities
  FOR EACH ROW EXECUTE FUNCTION guard_project_graph_entity_write();

-- Project provisioning uses these three SECURITY DEFINER functions as one
-- runtime contract. Grant them together when the canonical API role exists.
-- If the role is created after this migration, rerun this schema (or the same
-- three GRANT statements) before starting the service.
DO $project_provisioning_runtime_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION project_code_collision_sources(text, text), project_graph_identity_probe(text), claim_project_code(text, text) TO brainbase_app';
  END IF;
END
$project_provisioning_runtime_grant$;

CREATE TABLE IF NOT EXISTS project_provisioning_runs (
  run_id text PRIMARY KEY,
  organization_id text NOT NULL,
  project_code text NOT NULL,
  idempotency_key text NOT NULL,
  manifest_fingerprint text NOT NULL,
  manifest jsonb NOT NULL,
  plan jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','planned','applying','active','partial_failed','manual_intervention_required')),
  actor jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_gate_receipt jsonb,
  receipt jsonb,
  failure jsonb,
  attempt integer NOT NULL DEFAULT 0,
  execution_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS project_provisioning_steps (
  run_id text NOT NULL REFERENCES project_provisioning_runs(run_id),
  organization_id text NOT NULL,
  step_name text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','applying','completed','failed','manual_intervention_required')),
  attempt integer NOT NULL DEFAULT 0,
  receipt jsonb,
  failure jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_name)
);

ALTER TABLE project_provisioning_runs ADD COLUMN IF NOT EXISTS human_gate_receipt jsonb;
ALTER TABLE project_provisioning_runs ADD COLUMN IF NOT EXISTS execution_token text;
ALTER TABLE project_provisioning_steps ADD COLUMN IF NOT EXISTS organization_id text;
UPDATE project_provisioning_steps s
SET organization_id = r.organization_id
FROM project_provisioning_runs r
WHERE r.run_id = s.run_id AND s.organization_id IS NULL;
ALTER TABLE project_provisioning_steps ALTER COLUMN organization_id SET NOT NULL;

CREATE OR REPLACE FUNCTION prevent_project_provisioning_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
    RAISE EXCEPTION 'project provisioning receipt is immutable';
  END IF;
  IF OLD.human_gate_receipt IS NOT NULL AND NEW.human_gate_receipt IS DISTINCT FROM OLD.human_gate_receipt THEN
    RAISE EXCEPTION 'project provisioning human gate receipt is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_provisioning_receipts_no_mutation ON project_provisioning_runs;
CREATE TRIGGER project_provisioning_receipts_no_mutation
  BEFORE UPDATE ON project_provisioning_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_project_provisioning_receipt_mutation();

CREATE OR REPLACE FUNCTION prevent_project_provisioning_step_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
    RAISE EXCEPTION 'project provisioning step receipt is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_provisioning_step_receipts_no_mutation ON project_provisioning_steps;
CREATE TRIGGER project_provisioning_step_receipts_no_mutation
  BEFORE UPDATE ON project_provisioning_steps
  FOR EACH ROW EXECUTE FUNCTION prevent_project_provisioning_step_receipt_mutation();
