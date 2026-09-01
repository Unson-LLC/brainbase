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
