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

CREATE TABLE IF NOT EXISTS knowledge_authoring_drafts (
    draft_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    owner_person_id TEXT NOT NULL,
    project_code TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('decision', 'document')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    applicability JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_pointer JSONB,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saving', 'saved', 'discarded')),
    save_idempotency_key TEXT,
    canonical_id TEXT,
    saved_event_id TEXT REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_authoring_saves (
    idempotency_key TEXT NOT NULL,
    draft_id TEXT NOT NULL REFERENCES knowledge_authoring_drafts(draft_id) ON DELETE RESTRICT,
    draft_revision INTEGER NOT NULL,
    organization_id TEXT NOT NULL,
    owner_person_id TEXT NOT NULL,
    project_code TEXT NOT NULL,
    canonical_id TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES knowledge_events(event_id) ON DELETE RESTRICT,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, owner_person_id, project_code, idempotency_key),
    UNIQUE (draft_id, draft_revision)
);

CREATE TABLE IF NOT EXISTS knowledge_lifecycle_history (
    id BIGSERIAL PRIMARY KEY,
    knowledge_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    project_code TEXT NOT NULL,
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'retired', 'unlinked')),
    reason TEXT NOT NULL,
    actor_person_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE knowledge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_events FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_event_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_event_stage_history FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_authoring_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_authoring_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_authoring_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_authoring_saves FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_lifecycle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_lifecycle_history FORCE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS knowledge_authoring_drafts_access ON knowledge_authoring_drafts;
CREATE POLICY knowledge_authoring_drafts_access ON knowledge_authoring_drafts
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()))
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()));

DROP POLICY IF EXISTS knowledge_authoring_saves_access ON knowledge_authoring_saves;
CREATE POLICY knowledge_authoring_saves_access ON knowledge_authoring_saves
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()))
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()));

DROP POLICY IF EXISTS knowledge_lifecycle_history_access ON knowledge_lifecycle_history;
CREATE POLICY knowledge_lifecycle_history_access ON knowledge_lifecycle_history
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '') AND project_code = ANY(app_project_codes()))
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND actor_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()));
