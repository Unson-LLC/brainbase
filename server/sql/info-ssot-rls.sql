-- Info SSOT RLS policies (Postgres)
-- Requires app.role, app.project_codes, app.clearance via set_config

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_role_rank(text)');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION app_role_rank(role text)
      RETURNS integer
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT CASE lower(coalesce(role, ''))
          WHEN 'member' THEN 1
          WHEN 'gm' THEN 2
          WHEN 'ceo' THEN 3
          ELSE 0
        END;
      $body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_setting_array(text)');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION app_setting_array(setting text)
      RETURNS text[]
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT CASE
          WHEN current_setting(setting, true) IS NULL OR current_setting(setting, true) = '' THEN ARRAY[]::text[]
          ELSE string_to_array(current_setting(setting, true), ',')
        END;
      $body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_current_role_rank()');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION app_current_role_rank()
      RETURNS integer
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT app_role_rank(current_setting('app.role', true));
      $body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_project_codes()');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION app_project_codes()
      RETURNS text[]
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT app_setting_array('app.project_codes');
      $body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_clearance()');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION app_clearance()
      RETURNS text[]
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT app_setting_array('app.clearance');
      $body$
    $function$;
  END IF;
END $do$;

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
    AND CASE
      WHEN graph_entities.project_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      )
      WHEN graph_entities.entity_type = 'person' THEN EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND ge.lifecycle_status = 'active'
            AND app_current_role_rank() >= app_role_rank(ge.role_min)
            AND ge.sensitivity = ANY(app_clearance())
            AND p.code = ANY(app_project_codes())
      )
      ELSE FALSE
    END
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
    app_current_role_rank() >= 2
  );

DROP POLICY IF EXISTS info_graph_entities_update ON graph_entities;
CREATE POLICY info_graph_entities_update ON graph_entities
  FOR UPDATE
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND CASE
      WHEN graph_entities.project_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      )
      WHEN graph_entities.entity_type = 'person' THEN EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND ge.lifecycle_status = 'active'
            AND app_current_role_rank() >= app_role_rank(ge.role_min)
            AND ge.sensitivity = ANY(app_clearance())
            AND p.code = ANY(app_project_codes())
      )
      ELSE FALSE
    END
  )
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND CASE
      WHEN graph_entities.project_id IS NOT NULL THEN EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_entities.project_id
          AND p.code = ANY(app_project_codes())
      )
      WHEN graph_entities.entity_type = 'person' THEN EXISTS (
          SELECT 1
          FROM graph_edges ge
          JOIN projects p ON p.id = ge.project_id
          WHERE ge.from_id = graph_entities.id
            AND ge.rel_type = 'member_of'
            AND ge.lifecycle_status = 'active'
            AND app_current_role_rank() >= app_role_rank(ge.role_min)
            AND ge.sensitivity = ANY(app_clearance())
            AND p.code = ANY(app_project_codes())
      )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS info_graph_edges_select ON graph_edges;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_graph_entity_organization_id(text)');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
CREATE OR REPLACE FUNCTION app_graph_entity_organization_id(entity_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $body$
  SELECT COALESCE(
    direct_project.organization_id,
    CASE
      WHEN entity.entity_type = 'person'
        AND COUNT(DISTINCT membership_project.organization_id) = 1
      THEN MIN(membership_project.organization_id)
      ELSE NULL
    END
  )
  FROM graph_entities entity
  LEFT JOIN projects direct_project ON direct_project.id = entity.project_id
  LEFT JOIN graph_edges membership
    ON entity.project_id IS NULL
   AND membership.from_id = entity.id
   AND membership.rel_type = 'member_of'
   AND membership.lifecycle_status = 'active'
  LEFT JOIN projects membership_project ON membership_project.id = membership.project_id
  WHERE entity.id = entity_id
  GROUP BY entity.entity_type, direct_project.organization_id
$body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_graph_edge_scope_visible(text,text,text,jsonb,text,text)');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
CREATE OR REPLACE FUNCTION app_graph_edge_scope_visible(
  edge_from_id TEXT,
  edge_to_id TEXT,
  edge_rel_type TEXT,
  edge_payload JSONB,
  edge_role_min TEXT,
  edge_sensitivity TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Bind the trusted migration-time schema. Production resolves to public;
-- isolated acceptance schemas resolve to their own schema instead of silently
-- querying unrelated public tables.
SET search_path FROM CURRENT
AS $body$
  SELECT COALESCE((
  SELECT CASE
    WHEN app_graph_entity_organization_id(source_entity.id) IS NULL
      OR app_graph_entity_organization_id(target_entity.id) IS NULL
    THEN FALSE
    WHEN app_graph_entity_organization_id(source_entity.id)
      IS DISTINCT FROM app_graph_entity_organization_id(target_entity.id)
    THEN edge_rel_type = 'governs'
      AND edge_payload->>'cross_tenant' = 'true'
      AND edge_payload->>'target_project_code' = target_project.code
      AND edge_role_min = 'ceo'
      AND edge_sensitivity = 'restricted'
      AND source_entity.entity_type = 'decision'
      AND target_entity.entity_type = 'product'
      AND app_current_role_rank() >= app_role_rank('ceo')
      AND source_project.code = ANY(app_project_codes())
      AND target_project.code = ANY(app_project_codes())
    ELSE (
      (
        source_project.code = ANY(app_project_codes())
        OR (
          source_entity.project_id IS NULL
          AND source_entity.entity_type = 'person'
          AND EXISTS (
            SELECT 1
            FROM graph_edges membership
            JOIN projects membership_project ON membership_project.id = membership.project_id
            WHERE membership.from_id = source_entity.id
              AND membership.rel_type = 'member_of'
              AND membership.lifecycle_status = 'active'
              AND app_current_role_rank() >= app_role_rank(membership.role_min)
              AND membership.sensitivity = ANY(app_clearance())
              AND membership_project.code = ANY(app_project_codes())
          )
        )
      )
      AND (
        target_project.code = ANY(app_project_codes())
        OR (
          target_entity.project_id IS NULL
          AND target_entity.entity_type = 'person'
          AND EXISTS (
            SELECT 1
            FROM graph_edges membership
            JOIN projects membership_project ON membership_project.id = membership.project_id
            WHERE membership.from_id = target_entity.id
              AND membership.rel_type = 'member_of'
              AND membership.lifecycle_status = 'active'
              AND app_current_role_rank() >= app_role_rank(membership.role_min)
              AND membership.sensitivity = ANY(app_clearance())
              AND membership_project.code = ANY(app_project_codes())
          )
        )
      )
    )
  END
  FROM graph_entities source_entity
  LEFT JOIN projects source_project ON source_project.id = source_entity.project_id
  JOIN graph_entities target_entity ON target_entity.id = edge_to_id
  LEFT JOIN projects target_project ON target_project.id = target_entity.project_id
  WHERE source_entity.id = edge_from_id
    AND app_current_role_rank() >= app_role_rank(source_entity.role_min)
    AND source_entity.sensitivity = ANY(app_clearance())
    AND app_current_role_rank() >= app_role_rank(target_entity.role_min)
    AND target_entity.sensitivity = ANY(app_clearance())
  ), FALSE)
$body$
    $function$;
  END IF;
END $do$;

DO $do$
DECLARE
  function_oid oid := to_regprocedure('app_graph_edge_source_project_matches(text,text,text,jsonb)');
BEGIN
  IF function_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = function_oid AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) THEN
    EXECUTE $function$
CREATE OR REPLACE FUNCTION app_graph_edge_source_project_matches(
  edge_from_id TEXT,
  edge_rel_type TEXT,
  edge_project_id TEXT,
  edge_payload JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path FROM CURRENT
AS $body$
  SELECT CASE
    WHEN edge_rel_type = 'governs'
      AND EXISTS (
        SELECT 1
        FROM graph_entities source_entity
        WHERE source_entity.id = edge_from_id
          AND source_entity.entity_type = 'decision'
      )
    THEN EXISTS (
      SELECT 1
      FROM graph_entities source_entity
      WHERE source_entity.id = edge_from_id
        AND source_entity.project_id = edge_project_id
    )
    ELSE TRUE
  END
$body$
    $function$;
  END IF;
END $do$;

CREATE POLICY info_graph_edges_select ON graph_edges
  FOR SELECT
  USING (
    (
      (
        current_setting('app.graph_maintenance_mode', true) = 'true'
        AND rel_type = 'member_of'
        AND lifecycle_status = 'active'
      )
      OR (
        app_current_role_rank() >= app_role_rank(role_min)
        AND sensitivity = ANY(app_clearance())
      )
    )
    AND (
      EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = graph_edges.project_id
          AND p.code = ANY(app_project_codes())
      )
      -- Maintenance must see every active membership when proving that a
      -- projectless Person belongs to exactly one organization. Snapshot
      -- queries still select only source-project edges and redact unresolved
      -- endpoints before returning any data.
      OR (
        current_setting('app.graph_maintenance_mode', true) = 'true'
        AND rel_type = 'member_of'
      )
    )
    AND (
      rel_type = 'member_of'
      OR app_graph_edge_scope_visible(from_id, to_id, rel_type, payload, role_min, sensitivity)
      -- Graph maintenance loads source-project rows for forensic validation,
      -- then redacts every unresolved/inaccessible endpoint before returning
      -- the snapshot. Ordinary Graph reads never set this transaction-local
      -- flag and remain subject to endpoint visibility.
      OR current_setting('app.graph_maintenance_mode', true) = 'true'
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
    AND (
      rel_type = 'member_of'
      OR app_graph_edge_scope_visible(from_id, to_id, rel_type, payload, role_min, sensitivity)
    )
    AND app_graph_edge_source_project_matches(from_id, rel_type, project_id, payload)
  );

DROP POLICY IF EXISTS info_graph_edges_update ON graph_edges;
DROP POLICY IF EXISTS info_graph_edges_delete ON graph_edges;
CREATE POLICY info_graph_edges_delete ON graph_edges
  FOR DELETE
  USING (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
    AND (
      rel_type = 'member_of'
      OR app_graph_edge_scope_visible(from_id, to_id, rel_type, payload, role_min, sensitivity)
    )
  );

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
    AND (
      rel_type = 'member_of'
      OR app_graph_edge_scope_visible(from_id, to_id, rel_type, payload, role_min, sensitivity)
      -- Permit maintenance transactions to lock legacy rows for a stable
      -- snapshot. WITH CHECK below still rejects an invalid post-update row.
      OR current_setting('app.graph_maintenance_mode', true) = 'true'
    )
    AND app_graph_edge_source_project_matches(from_id, rel_type, project_id, payload)
  )
  WITH CHECK (
    app_current_role_rank() >= app_role_rank(role_min)
    AND sensitivity = ANY(app_clearance())
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = graph_edges.project_id
        AND p.code = ANY(app_project_codes())
    )
    AND (
      rel_type = 'member_of'
      OR app_graph_edge_scope_visible(from_id, to_id, rel_type, payload, role_min, sensitivity)
    )
    AND app_graph_edge_source_project_matches(from_id, rel_type, project_id, payload)
  );
