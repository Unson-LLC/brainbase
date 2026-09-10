-- Immutable OSS snapshots, private to a signed owner within a tenant and project.
CREATE TABLE IF NOT EXISTS portable_graph_snapshots (
    organization_id text NOT NULL,
    project_code text NOT NULL REFERENCES projects(code),
    owner_person_id text NOT NULL,
    graph_id text NOT NULL,
    bundle jsonb NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
    digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_code, owner_person_id, graph_id)
);
ALTER TABLE portable_graph_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE portable_graph_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portable_graph_owner ON portable_graph_snapshots;
DROP POLICY IF EXISTS portable_graph_read ON portable_graph_snapshots;
DROP POLICY IF EXISTS portable_graph_insert ON portable_graph_snapshots;
CREATE POLICY portable_graph_read ON portable_graph_snapshots FOR SELECT USING (

    organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND owner_person_id = NULLIF(current_setting('app.portable_graph_owner', true), '')
    AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
    AND EXISTS (SELECT 1 FROM projects p WHERE p.code = project_code AND p.organization_id = portable_graph_snapshots.organization_id)
);
CREATE POLICY portable_graph_insert ON portable_graph_snapshots FOR INSERT WITH CHECK (

    organization_id = NULLIF(current_setting('app.organization_id', true), '')
    AND owner_person_id = NULLIF(current_setting('app.portable_graph_owner', true), '')
    AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
    AND EXISTS (SELECT 1 FROM projects p WHERE p.code = project_code AND p.organization_id = portable_graph_snapshots.organization_id)
);
