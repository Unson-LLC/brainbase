CREATE TABLE IF NOT EXISTS knowledge_events (
    event_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL CHECK (schema_version = 'knowledge_event.v1'),
    occurred_at TIMESTAMPTZ NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    source JSONB NOT NULL,
    subject JSONB NOT NULL,
    decision_authority JSONB NOT NULL,
    applicability_scope JSONB NOT NULL,
    project_code TEXT NOT NULL,
    permission_snapshot JSONB NOT NULL,
    source_pointer JSONB NOT NULL,
    body_hash TEXT NOT NULL,
    parent_episode_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    semantic_state TEXT NOT NULL DEFAULT 'active'
        CHECK (semantic_state IN ('active', 'superseded', 'contradicted', 'quarantined', 'retracted', 'expired')),
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_event_stage_history (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
    stage TEXT NOT NULL
        CHECK (stage IN ('received', 'queued', 'extracted', 'resolved', 'indexed', 'retrievable')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_feedback (
    id BIGSERIAL PRIMARY KEY,
    feedback_id TEXT NOT NULL UNIQUE,
    event_id TEXT NOT NULL REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('adopt', 'correct', 'reject', 'not_useful')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_events_project_semantic_time
    ON knowledge_events (project_code, semantic_state, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_events_event_project
    ON knowledge_events (event_id, project_code);
CREATE INDEX IF NOT EXISTS idx_knowledge_events_project_semantic
    ON knowledge_events (project_code, semantic_state);
CREATE INDEX IF NOT EXISTS idx_knowledge_events_project_captured
    ON knowledge_events (project_code, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_event_stage_event_time
    ON knowledge_event_stage_history (event_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_event_time
    ON knowledge_feedback (event_id, created_at);

ALTER TABLE knowledge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_events FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_event_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_event_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_events_project_access ON knowledge_events;
CREATE POLICY knowledge_events_project_access ON knowledge_events
    USING (project_code = ANY(app_project_codes()))
    WITH CHECK (project_code = ANY(app_project_codes()));

DROP POLICY IF EXISTS knowledge_event_stage_project_access ON knowledge_event_stage_history;
CREATE POLICY knowledge_event_stage_project_access ON knowledge_event_stage_history
    USING (EXISTS (
        SELECT 1 FROM knowledge_events event
        WHERE event.event_id = knowledge_event_stage_history.event_id
          AND event.project_code = ANY(app_project_codes())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM knowledge_events event
        WHERE event.event_id = knowledge_event_stage_history.event_id
          AND event.project_code = ANY(app_project_codes())
    ));

DROP POLICY IF EXISTS knowledge_feedback_project_access ON knowledge_feedback;
CREATE POLICY knowledge_feedback_project_access ON knowledge_feedback
    USING (EXISTS (
        SELECT 1 FROM knowledge_events event
        WHERE event.event_id = knowledge_feedback.event_id
          AND event.project_code = ANY(app_project_codes())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM knowledge_events event
        WHERE event.event_id = knowledge_feedback.event_id
          AND event.project_code = ANY(app_project_codes())
    ));
