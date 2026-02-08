-- Info SSOT RLS policies (Postgres)
-- Requires app.role, app.project_codes, app.clearance via set_config

CREATE OR REPLACE FUNCTION app_role_rank(role text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE lower(coalesce(role, ''))
    WHEN 'member' THEN 1
    WHEN 'gm' THEN 2
    WHEN 'ceo' THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION app_setting_array(setting text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting(setting, true) IS NULL OR current_setting(setting, true) = '' THEN ARRAY[]::text[]
    ELSE string_to_array(current_setting(setting, true), ',')
  END;
$$;

CREATE OR REPLACE FUNCTION app_current_role_rank()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT app_role_rank(current_setting('app.role', true));
$$;

CREATE OR REPLACE FUNCTION app_project_codes()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT app_setting_array('app.project_codes');
$$;

CREATE OR REPLACE FUNCTION app_clearance()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT app_setting_array('app.clearance');
$$;

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE raci_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE raci_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS info_decisions_select ON decisions;
CREATE POLICY info_decisions_select ON decisions
  FOR SELECT
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = decisions.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_decisions_insert ON decisions;
CREATE POLICY info_decisions_insert ON decisions
  FOR INSERT
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = decisions.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_events_select ON events;
CREATE POLICY info_events_select ON events
  FOR SELECT
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = events.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_events_insert ON events;
CREATE POLICY info_events_insert ON events
  FOR INSERT
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = events.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_raci_select ON raci_assignments;
CREATE POLICY info_raci_select ON raci_assignments
  FOR SELECT
  USING (
    app_current_role_rank() >= app_role_rank(sensitivity_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = raci_assignments.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_raci_insert ON raci_assignments;
CREATE POLICY info_raci_insert ON raci_assignments
  FOR INSERT
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(sensitivity_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = raci_assignments.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_raci_update ON raci_assignments;
CREATE POLICY info_raci_update ON raci_assignments
  FOR UPDATE
  USING (
    app_current_role_rank() >= app_role_rank(sensitivity_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = raci_assignments.project_id
        AND p.code = ANY(app_project_codes())
    )
  )
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(sensitivity_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = raci_assignments.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_graph_entities_select ON graph_entities;
CREATE POLICY info_graph_entities_select ON graph_entities
  FOR SELECT
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND (
      (graph_entities.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      ))
      OR (
        graph_entities.entity_type = 'person' AND EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND p.code = ANY(app_project_codes())
        )
      )
    )
  );

DROP POLICY IF EXISTS info_graph_entities_insert ON graph_entities;
CREATE POLICY info_graph_entities_insert ON graph_entities
  FOR INSERT
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND (
      (graph_entities.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      ))
      OR (
        graph_entities.entity_type = 'person' AND graph_entities.project_id IS NULL
      )
    )
  );

DROP POLICY IF EXISTS info_graph_entities_delete ON graph_entities;
CREATE POLICY info_graph_entities_delete ON graph_entities
  FOR DELETE
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND (
      (graph_entities.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      ))
      OR (
        graph_entities.entity_type = 'person' AND graph_entities.project_id IS NULL
      )
    )
  );

DROP POLICY IF EXISTS info_graph_entities_update ON graph_entities;
CREATE POLICY info_graph_entities_update ON graph_entities
  FOR UPDATE
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND (
      (graph_entities.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      ))
      OR (
        graph_entities.entity_type = 'person' AND EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND p.code = ANY(app_project_codes())
        )
      )
    )
  )
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND (
      (graph_entities.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      ))
      OR (
        graph_entities.entity_type = 'person' AND EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND p.code = ANY(app_project_codes())
        )
      )
    )
  );

DROP POLICY IF EXISTS info_graph_edges_select ON graph_edges;
CREATE POLICY info_graph_edges_select ON graph_edges
  FOR SELECT
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_graph_edges_insert ON graph_edges;
CREATE POLICY info_graph_edges_insert ON graph_edges
  FOR INSERT
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
  );

DROP POLICY IF EXISTS info_graph_edges_update ON graph_edges;
CREATE POLICY info_graph_edges_update ON graph_edges
  FOR UPDATE
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
  )
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
  );
