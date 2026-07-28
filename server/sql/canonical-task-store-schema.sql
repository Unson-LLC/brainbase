CREATE TABLE IF NOT EXISTS canonical_tasks (
    id UUID PRIMARY KEY,
    legacy_nocodb_id TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'waiting', 'completed')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_person_id TEXT,
    assignee_display_name TEXT,
    due_at TIMESTAMPTZ,
    waiting_on TEXT,
    review_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    source_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_fingerprint TEXT,
    last_operation_key TEXT,
    last_operation_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS canonical_tasks_status_priority_idx
    ON canonical_tasks (status, priority);
CREATE INDEX IF NOT EXISTS canonical_tasks_assignee_due_idx
    ON canonical_tasks (assignee_person_id, due_at);
