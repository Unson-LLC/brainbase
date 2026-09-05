-- Info SSOT minimal schema (Postgres)
-- Story: E1-001 / E1-002

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  organization_id text
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id text;

-- Phase 0.2 approved tenant mappings. Keep this list explicit: an unmapped
-- project remains fail-closed instead of inheriting a default tenant.
DO $$
BEGIN
  IF to_regclass('organizations') IS NOT NULL THEN
    UPDATE organizations
    SET projects = CASE
      WHEN id = 'unson' AND NOT ('unson' = ANY(COALESCE(projects, ARRAY[]::text[])))
        THEN array_append(COALESCE(projects, ARRAY[]::text[]), 'unson')
      WHEN id = 'techknight' AND NOT ('aitle' = ANY(COALESCE(projects, ARRAY[]::text[])))
        THEN array_append(COALESCE(projects, ARRAY[]::text[]), 'aitle')
      ELSE projects
    END
    WHERE id IN ('unson', 'techknight');

    UPDATE projects p
    SET organization_id = CASE p.code
      WHEN 'unson' THEN 'unson'
      WHEN 'aitle' THEN 'techknight'
    END
    WHERE p.organization_id IS NULL
      AND p.code IN ('unson', 'aitle')
      AND EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = CASE p.code WHEN 'unson' THEN 'unson' WHEN 'aitle' THEN 'techknight' END
      );
  END IF;
END $$;

-- Backfill only when the permission catalog gives one unambiguous tenant owner.
-- Ambiguous/unmapped projects intentionally stay NULL and maintenance fails closed.
DO $$
BEGIN
  -- Resolve the optional permission catalog through the active search path so
  -- schema-scoped migrations and isolated tenant databases receive the same
  -- unambiguous project-owner backfill as the public deployment.
  IF to_regclass('organizations') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE projects p
      SET organization_id = owners.organization_id
      FROM (
        SELECT project_code, MIN(organization_id) AS organization_id
        FROM (
          SELECT o.id AS organization_id, unnest(o.projects) AS project_code
          FROM organizations o
        ) memberships
        GROUP BY project_code
        HAVING COUNT(DISTINCT organization_id) = 1
      ) owners
      WHERE p.code = owners.project_code AND p.organization_id IS NULL
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS auth_grants (
  id text PRIMARY KEY,
  person_id text REFERENCES people(id),
  person_name text NOT NULL,
  slack_user_id text NOT NULL,
  slack_workspace_id text NOT NULL,
  organization_id text,
  role text NOT NULL,
  project_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  clearance text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_grants ADD COLUMN IF NOT EXISTS organization_id text;

-- Legacy grants inferred their organization from the Slack workspace. Persist
-- that resolved organization before allowing one Slack identity to hold more
-- than one organization-scoped grant.
DO $$
BEGIN
  IF to_regclass('organizations') IS NOT NULL THEN
    UPDATE auth_grants ag
    SET organization_id = matched.organization_id
    FROM (
      SELECT workspace_id, MIN(id) AS organization_id
      FROM organizations
      WHERE workspace_id IS NOT NULL
      GROUP BY workspace_id
      HAVING COUNT(*) = 1
    ) matched
    WHERE ag.organization_id IS NULL
      AND ag.slack_workspace_id = matched.workspace_id;
  END IF;
END $$;

-- Some login identities use a Slack installation that is not the
-- organization's operational workspace. Resolve those legacy grants only
-- when every project code with a catalog owner points to one organization.
DO $$
BEGIN
  IF to_regclass('project_registry') IS NOT NULL THEN
    UPDATE auth_grants ag
    SET organization_id = matched.organization_id
    FROM (
      SELECT ag2.id, MIN(pr.organization_id) AS organization_id
      FROM auth_grants ag2
      JOIN LATERAL unnest(ag2.project_codes) code(project_code) ON true
      JOIN project_registry pr ON pr.project_code = code.project_code
      WHERE ag2.organization_id IS NULL
      GROUP BY ag2.id
      HAVING COUNT(DISTINCT pr.organization_id) = 1
    ) matched
    WHERE ag.id = matched.id;
  END IF;
END $$;

-- A legacy project can predate Project Registry while already carrying an
-- explicit owner in the canonical projects table. Use that owner only when
-- every resolvable project in the grant agrees on one organization.
UPDATE auth_grants ag
SET organization_id = matched.organization_id
FROM (
  SELECT ag2.id, MIN(p.organization_id) AS organization_id
  FROM auth_grants ag2
  JOIN LATERAL unnest(ag2.project_codes) code(project_code) ON true
  JOIN projects p ON p.code = code.project_code AND p.organization_id IS NOT NULL
  WHERE ag2.organization_id IS NULL
  GROUP BY ag2.id
  HAVING COUNT(DISTINCT p.organization_id) = 1
) matched
WHERE ag.id = matched.id;

ALTER TABLE auth_grants
  DROP CONSTRAINT IF EXISTS auth_grants_slack_user_id_slack_workspace_id_key;

DROP INDEX IF EXISTS auth_grants_slack_workspace_organization_unique;
CREATE UNIQUE INDEX IF NOT EXISTS auth_grants_slack_workspace_organization_unique
  ON auth_grants (slack_user_id, slack_workspace_id, organization_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_grants WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'auth_grants organization backfill is incomplete';
  END IF;
END $$;

ALTER TABLE auth_grants ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_grants_organization_id_fkey'
      AND conrelid = 'auth_grants'::regclass
  ) THEN
    ALTER TABLE auth_grants
      ADD CONSTRAINT auth_grants_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id text PRIMARY KEY,
  person_id text REFERENCES people(id),
  slack_user_id text,
  slack_workspace_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  actor_person_id text NOT NULL REFERENCES people(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1,
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decisions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  owner_person_id text NOT NULL REFERENCES people(id),
  title text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  chosen jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL DEFAULT '',
  decided_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'decided',
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  source_event_id text NOT NULL REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS raci_assignments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  person_id text NOT NULL REFERENCES people(id),
  role_code text NOT NULL,
  authority_scope text NOT NULL DEFAULT '',
  sensitivity_min text NOT NULL,
  sensitivity text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, person_id, role_code)
);

ALTER TABLE raci_assignments
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'internal';

CREATE TABLE IF NOT EXISTS graph_entities (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  project_id text REFERENCES projects(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS graph_entities
  ALTER COLUMN project_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id text PRIMARY KEY,
  from_id text NOT NULL,
  to_id text NOT NULL,
  rel_type text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_min text NOT NULL,
  sensitivity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (from_id, to_id, rel_type)
);

CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_raci_project_id ON raci_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_entities_project_id ON graph_entities(project_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_project_id ON graph_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_auth_grants_person_id ON auth_grants(person_id);
CREATE INDEX IF NOT EXISTS idx_auth_grants_slack ON auth_grants(slack_user_id, slack_workspace_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_person_id ON auth_audit_logs(person_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_from_id ON graph_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_to_id ON graph_edges(to_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_rel_type ON graph_edges(rel_type);

ALTER TABLE graph_entities ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE graph_entities ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_entities_version_positive') THEN
    ALTER TABLE graph_entities ADD CONSTRAINT graph_entities_version_positive CHECK (version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_edges_version_positive') THEN
    ALTER TABLE graph_edges ADD CONSTRAINT graph_edges_version_positive CHECK (version >= 1);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS graph_maintenance_snapshots (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  snapshot_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS graph_maintenance_plans (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  snapshot_id text NOT NULL REFERENCES graph_maintenance_snapshots(id),
  base_snapshot_hash text NOT NULL,
  after_snapshot_hash text NOT NULL,
  idempotency_key text NOT NULL,
  input_fingerprint text NOT NULL,
  reason text NOT NULL,
  operations jsonb NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  applied_at timestamptz,
  rolled_back_at timestamptz,
  UNIQUE (organization_id, project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS graph_maintenance_human_gate_receipts (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  decision_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('approved', 'rejected', 'revoked')),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, project_id, decision_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_maintenance_human_gate_approved_by_nonempty') THEN
    ALTER TABLE graph_maintenance_human_gate_receipts
      ADD CONSTRAINT graph_maintenance_human_gate_approved_by_nonempty CHECK (btrim(approved_by) <> '');
  END IF;
END $$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('prevent_graph_maintenance_human_gate_receipt_mutation()');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION prevent_graph_maintenance_human_gate_receipt_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        RAISE EXCEPTION 'graph maintenance Human Gate receipts are append-only';
      END;
      $body$
    $function$;
  END IF;
END $do$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'graph_maintenance_human_gate_receipts_no_update_delete') THEN
    CREATE TRIGGER graph_maintenance_human_gate_receipts_no_update_delete
      BEFORE UPDATE OR DELETE ON graph_maintenance_human_gate_receipts
      FOR EACH ROW EXECUTE FUNCTION prevent_graph_maintenance_human_gate_receipt_mutation();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS graph_maintenance_receipts (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES graph_maintenance_plans(id),
  organization_id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id),
  receipt_type text NOT NULL CHECK (receipt_type IN ('apply', 'rollback')),
  status text NOT NULL,
  before_hash text NOT NULL,
  after_hash text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, receipt_type)
);

DO $do$
DECLARE
  function_oid oid := to_regprocedure('prevent_graph_maintenance_receipt_mutation()');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION prevent_graph_maintenance_receipt_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN
        RAISE EXCEPTION 'graph maintenance receipts are append-only';
      END;
      $body$
    $function$;
  END IF;
END $do$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'graph_maintenance_receipts_no_update_delete') THEN
    CREATE TRIGGER graph_maintenance_receipts_no_update_delete
      BEFORE UPDATE OR DELETE ON graph_maintenance_receipts
      FOR EACH ROW EXECUTE FUNCTION prevent_graph_maintenance_receipt_mutation();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'decisions_sensitive_role') THEN
    ALTER TABLE decisions
      ADD CONSTRAINT decisions_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND role_min = 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_sensitive_role') THEN
    ALTER TABLE events
      ADD CONSTRAINT events_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND role_min = 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raci_sensitive_role') THEN
    ALTER TABLE raci_assignments
      ADD CONSTRAINT raci_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND sensitivity_min = 'member'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_entities_sensitive_role') THEN
    ALTER TABLE graph_entities
      ADD CONSTRAINT graph_entities_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND role_min = 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_edges_sensitive_role') THEN
    ALTER TABLE graph_edges
      ADD CONSTRAINT graph_edges_sensitive_role
      CHECK (NOT (sensitivity IN ('finance', 'hr', 'contract') AND role_min = 'member'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('prevent_events_mutation()') IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION prevent_events_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        RAISE EXCEPTION 'events is append-only';
      END;
      $body$
    $function$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_no_update_delete') THEN
    CREATE TRIGGER events_no_update_delete
      BEFORE UPDATE OR DELETE ON events
      FOR EACH ROW EXECUTE FUNCTION prevent_events_mutation();
  END IF;
END $$;

-- Project Provisioning v1. Read-only checks never create this schema at request time.
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

ALTER TABLE project_provisioning_steps ADD COLUMN IF NOT EXISTS organization_id text;
UPDATE project_provisioning_steps s
SET organization_id = r.organization_id
FROM project_provisioning_runs r
WHERE r.run_id = s.run_id AND s.organization_id IS NULL;
ALTER TABLE project_provisioning_steps ALTER COLUMN organization_id SET NOT NULL;

CREATE OR REPLACE FUNCTION prevent_project_provisioning_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
    RAISE EXCEPTION 'project provisioning receipt is immutable';
  END IF;
  IF OLD.human_gate_receipt IS NOT NULL AND NEW.human_gate_receipt IS DISTINCT FROM OLD.human_gate_receipt THEN
    RAISE EXCEPTION 'project provisioning human gate receipt is immutable';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS project_provisioning_receipts_no_mutation ON project_provisioning_runs;
CREATE TRIGGER project_provisioning_receipts_no_mutation
  BEFORE UPDATE ON project_provisioning_runs
  FOR EACH ROW EXECUTE FUNCTION prevent_project_provisioning_receipt_mutation();

CREATE OR REPLACE FUNCTION prevent_project_provisioning_step_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF OLD.receipt IS NOT NULL AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
    RAISE EXCEPTION 'project provisioning step receipt is immutable';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS project_provisioning_step_receipts_no_mutation ON project_provisioning_steps;
CREATE TRIGGER project_provisioning_step_receipts_no_mutation
  BEFORE UPDATE ON project_provisioning_steps
  FOR EACH ROW EXECUTE FUNCTION prevent_project_provisioning_step_receipt_mutation();

-- RLS policies are intentionally omitted here.
-- Apply RLS with app.role/app.project_codes/app.clearance when enabling Policy Gate.
