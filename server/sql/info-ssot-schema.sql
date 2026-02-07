-- Info SSOT minimal schema (Postgres)
-- Story: E1-001 / E1-002

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL
);

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
  role text NOT NULL,
  project_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  clearance text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (slack_user_id, slack_workspace_id)
);

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

CREATE OR REPLACE FUNCTION prevent_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'events_no_update_delete') THEN
    CREATE TRIGGER events_no_update_delete
      BEFORE UPDATE OR DELETE ON events
      FOR EACH ROW EXECUTE FUNCTION prevent_events_mutation();
  END IF;
END $$;

-- RLS policies are intentionally omitted here.
-- Apply RLS with app.role/app.project_codes/app.clearance when enabling Policy Gate.
