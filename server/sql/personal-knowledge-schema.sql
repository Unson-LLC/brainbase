-- Personal Vault and organization knowledge event ownership.
-- Event envelopes are immutable; processing and semantic changes are appended.

CREATE OR REPLACE FUNCTION app_person_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.person_id', true);
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RAISE EXCEPTION 'personal knowledge person context required' USING ERRCODE = '42501';
  END IF;
  RETURN value;
END $$;

CREATE OR REPLACE FUNCTION app_organization_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.organization_id', true);
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RAISE EXCEPTION 'personal knowledge organization context required' USING ERRCODE = '42501';
  END IF;
  RETURN value;
END $$;

CREATE OR REPLACE FUNCTION app_person_id_optional()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.person_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_role_rank(value TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE value WHEN 'ceo' THEN 30 WHEN 'gm' THEN 20 WHEN 'member' THEN 10 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION app_sensitivity_rank(value TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE value
    WHEN 'top-secret' THEN 40 WHEN 'confidential' THEN 30
    WHEN 'restricted' THEN 20 WHEN 'internal' THEN 10 ELSE 0 END
$$;

CREATE TABLE IF NOT EXISTS personal_knowledge_events (
  event_id TEXT PRIMARY KEY,
  owner_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source JSONB NOT NULL,
  source_pointer JSONB NOT NULL,
  body_hash TEXT NOT NULL,
  body TEXT,
  parent_episode_id TEXT,
  permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  sensitivity TEXT NOT NULL DEFAULT 'personal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_person_id, organization_id, source_pointer, body_hash)
);

CREATE TABLE IF NOT EXISTS personal_knowledge_event_transitions (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES personal_knowledge_events(event_id) ON DELETE RESTRICT,
  owner_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  transition_type TEXT NOT NULL,
  processing_stage TEXT,
  semantic_state TEXT,
  supersedes_event_id TEXT REFERENCES personal_knowledge_events(event_id) ON DELETE RESTRICT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_person_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_event_transitions (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  project_code TEXT NOT NULL,
  transition_type TEXT NOT NULL,
  processing_stage TEXT,
  semantic_state TEXT,
  supersedes_event_id TEXT REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
  reason TEXT,
  result JSONB,
  actor_person_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_promotion_requests (
  request_id TEXT PRIMARY KEY,
  personal_event_id TEXT NOT NULL REFERENCES personal_knowledge_events(event_id) ON DELETE RESTRICT,
  owner_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_owner_approval',
  sanitized_preview TEXT NOT NULL,
  subject JSONB NOT NULL,
  body_hash TEXT NOT NULL,
  organization_event_id TEXT REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  CHECK (status IN ('pending_owner_approval', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS knowledge_promotion_lineage (
  lineage_id TEXT PRIMARY KEY,
  personal_event_id TEXT NOT NULL REFERENCES personal_knowledge_events(event_id) ON DELETE RESTRICT,
  organization_event_id TEXT NOT NULL REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
  promotion_request_id TEXT NOT NULL REFERENCES knowledge_promotion_requests(request_id) ON DELETE RESTRICT,
  owner_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  sanitization JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (personal_event_id, organization_event_id)
);

CREATE TABLE IF NOT EXISTS episode_compaction_artifacts (
  artifact_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'organization')),
  owner_person_id TEXT,
  organization_id TEXT NOT NULL,
  project_code TEXT,
  episode_id TEXT NOT NULL,
  source_event_ids JSONB NOT NULL,
  artifact JSONB NOT NULL,
  artifact_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  role_min TEXT NOT NULL DEFAULT 'member',
  UNIQUE (scope, organization_id, owner_person_id, episode_id, version)
);

ALTER TABLE episode_compaction_artifacts
  ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE episode_compaction_artifacts
  ADD COLUMN IF NOT EXISTS role_min TEXT NOT NULL DEFAULT 'member';

CREATE TABLE IF NOT EXISTS privileged_knowledge_access_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_person_id TEXT NOT NULL,
  proxy_person_id TEXT,
  organization_id TEXT NOT NULL,
  access_kind TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE knowledge_events ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE knowledge_events ADD COLUMN IF NOT EXISTS sensitivity TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE knowledge_events ADD COLUMN IF NOT EXISTS role_min TEXT NOT NULL DEFAULT 'member';
ALTER TABLE knowledge_events ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE knowledge_events ADD COLUMN IF NOT EXISTS permission_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE knowledge_events SET organization_id = COALESCE(organization_id, applicability_scope->>'organization_id', '__quarantine__');
ALTER TABLE knowledge_events ALTER COLUMN organization_id SET NOT NULL;

CREATE OR REPLACE VIEW knowledge_event_current WITH (security_invoker = true) AS
SELECT e.*,
       COALESCE((
         SELECT t.semantic_state FROM knowledge_event_transitions t
         WHERE t.event_id = e.event_id AND t.semantic_state IS NOT NULL
         ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1
       ), e.semantic_state) AS current_semantic_state,
       (
         SELECT t.processing_stage FROM knowledge_event_transitions t
         WHERE t.event_id = e.event_id AND t.processing_stage IS NOT NULL
         ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1
       ) AS current_processing_stage,
       COALESCE((
         SELECT t.result FROM knowledge_event_transitions t
         WHERE t.event_id = e.event_id AND t.result IS NOT NULL
         ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1
       ), e.result) AS current_result,
       latest.occurred_at AS current_transition_at
FROM knowledge_events e
LEFT JOIN LATERAL (
  SELECT t.occurred_at
  FROM knowledge_event_transitions t
  WHERE t.event_id = e.event_id
  ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1
) latest ON TRUE;

CREATE OR REPLACE FUNCTION prevent_knowledge_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS personal_knowledge_events_no_mutation ON personal_knowledge_events;
CREATE TRIGGER personal_knowledge_events_no_mutation BEFORE UPDATE OR DELETE ON personal_knowledge_events
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_event_mutation();
-- Stable audit string: personal_knowledge_events is append-only

DROP TRIGGER IF EXISTS knowledge_events_no_mutation ON knowledge_events;
CREATE TRIGGER knowledge_events_no_mutation BEFORE UPDATE OR DELETE ON knowledge_events
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_event_mutation();

DROP TRIGGER IF EXISTS personal_transitions_no_mutation ON personal_knowledge_event_transitions;
CREATE TRIGGER personal_transitions_no_mutation BEFORE UPDATE OR DELETE ON personal_knowledge_event_transitions
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_event_mutation();
DROP TRIGGER IF EXISTS organization_transitions_no_mutation ON knowledge_event_transitions;
CREATE TRIGGER organization_transitions_no_mutation BEFORE UPDATE OR DELETE ON knowledge_event_transitions
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_event_mutation();

ALTER TABLE personal_knowledge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_knowledge_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_event_owner_scope ON personal_knowledge_events;
CREATE POLICY personal_event_owner_scope ON personal_knowledge_events
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

ALTER TABLE personal_knowledge_event_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_knowledge_event_transitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_transition_owner_scope ON personal_knowledge_event_transitions;
CREATE POLICY personal_transition_owner_scope ON personal_knowledge_event_transitions
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

ALTER TABLE knowledge_promotion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotion_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_promotion_owner_scope ON knowledge_promotion_requests;
CREATE POLICY personal_promotion_owner_scope ON knowledge_promotion_requests
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

ALTER TABLE knowledge_promotion_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotion_lineage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_lineage_owner_scope ON knowledge_promotion_lineage;
CREATE POLICY personal_lineage_owner_scope ON knowledge_promotion_lineage
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

ALTER TABLE episode_compaction_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_compaction_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS episode_compaction_scope ON episode_compaction_artifacts;
CREATE POLICY episode_compaction_scope ON episode_compaction_artifacts
  USING (
    organization_id = app_organization_id_required()
    AND (
      (scope = 'personal' AND owner_person_id = app_person_id_optional())
      OR (
        scope = 'organization'
        AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
        AND app_role_rank(current_setting('app.role', true)) >= app_role_rank(role_min)
        AND COALESCE((
          SELECT MAX(app_sensitivity_rank(value))
          FROM unnest(string_to_array(current_setting('app.clearance', true), ',')) value
        ), 0) >= app_sensitivity_rank(sensitivity)
      )
    )
  ) WITH CHECK (
    organization_id = app_organization_id_required()
    AND (
      (scope = 'personal' AND owner_person_id = app_person_id_optional())
      OR (
        scope = 'organization'
        AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
        AND app_role_rank(current_setting('app.role', true)) >= app_role_rank(role_min)
        AND COALESCE((
          SELECT MAX(app_sensitivity_rank(value))
          FROM unnest(string_to_array(current_setting('app.clearance', true), ',')) value
        ), 0) >= app_sensitivity_rank(sensitivity)
      )
    )
  );

ALTER TABLE knowledge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_events_project_access ON knowledge_events;
DROP POLICY IF EXISTS organization_event_scope ON knowledge_events;
CREATE POLICY organization_event_scope ON knowledge_events
  USING (
    organization_id = app_organization_id_required()
    AND (project_code IS NULL OR project_code = ANY(string_to_array(current_setting('app.project_codes', true), ',')))
    AND app_role_rank(current_setting('app.role', true)) >= app_role_rank(role_min)
    AND COALESCE((
      SELECT MAX(app_sensitivity_rank(value))
      FROM unnest(string_to_array(current_setting('app.clearance', true), ',')) value
    ), 0) >= app_sensitivity_rank(sensitivity)
  ) WITH CHECK (
    organization_id = app_organization_id_required()
    AND (project_code IS NULL OR project_code = ANY(string_to_array(current_setting('app.project_codes', true), ',')))
    AND app_role_rank(current_setting('app.role', true)) >= app_role_rank(role_min)
    AND COALESCE((
      SELECT MAX(app_sensitivity_rank(value))
      FROM unnest(string_to_array(current_setting('app.clearance', true), ',')) value
    ), 0) >= app_sensitivity_rank(sensitivity)
  );

ALTER TABLE knowledge_event_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_event_transitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_transition_scope ON knowledge_event_transitions;
CREATE POLICY organization_transition_scope ON knowledge_event_transitions
  USING (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_event_transitions.event_id
      AND event.organization_id = knowledge_event_transitions.organization_id
      AND event.project_code = knowledge_event_transitions.project_code
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_event_transitions.event_id
      AND event.organization_id = knowledge_event_transitions.organization_id
      AND event.project_code = knowledge_event_transitions.project_code
  ));

DROP POLICY IF EXISTS knowledge_event_stage_project_access ON knowledge_event_stage_history;
CREATE POLICY knowledge_event_stage_project_access ON knowledge_event_stage_history
  USING (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_event_stage_history.event_id
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_event_stage_history.event_id
  ));

DROP POLICY IF EXISTS knowledge_feedback_project_access ON knowledge_feedback;
CREATE POLICY knowledge_feedback_project_access ON knowledge_feedback
  USING (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_feedback.event_id
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM knowledge_events event
    WHERE event.event_id = knowledge_feedback.event_id
  ));

CREATE INDEX IF NOT EXISTS personal_knowledge_events_owner_idx ON personal_knowledge_events(organization_id, owner_person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS personal_knowledge_transitions_event_idx ON personal_knowledge_event_transitions(event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS organization_knowledge_transitions_event_idx ON knowledge_event_transitions(event_id, occurred_at DESC);
