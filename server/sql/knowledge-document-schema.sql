-- Canonical document writes are repository content, not knowledge_events.
-- Keep their durable idempotency/recovery receipts separate from the
-- decision-event authoring tables so a document save never invents an event.
CREATE TABLE IF NOT EXISTS knowledge_document_write_receipts (
    organization_id TEXT NOT NULL,
    owner_person_id TEXT NOT NULL,
    project_code TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    base_hash TEXT,
    base_revision TEXT NOT NULL,
    revision TEXT NOT NULL,
    canonical_url TEXT,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, owner_person_id, project_code, idempotency_key)
);

CREATE TABLE IF NOT EXISTS knowledge_document_authoring_saves (
    organization_id TEXT NOT NULL,
    owner_person_id TEXT NOT NULL,
    project_code TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, owner_person_id, project_code, idempotency_key),
    UNIQUE (draft_id, draft_revision)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_write_receipts_path
    ON knowledge_document_write_receipts (organization_id, project_code, path, created_at DESC);

ALTER TABLE knowledge_document_write_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document_write_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document_authoring_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document_authoring_saves FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_document_write_receipts_access ON knowledge_document_write_receipts;
CREATE POLICY knowledge_document_write_receipts_access ON knowledge_document_write_receipts
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()))
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()));

DROP POLICY IF EXISTS knowledge_document_authoring_saves_access ON knowledge_document_authoring_saves;
CREATE POLICY knowledge_document_authoring_saves_access ON knowledge_document_authoring_saves
    USING (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()))
    WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND owner_person_id = NULLIF(current_setting('app.person_id', true), '')
        AND project_code = ANY(app_project_codes()));
