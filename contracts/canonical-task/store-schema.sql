CREATE TABLE IF NOT EXISTS canonical_tasks (
    id UUID PRIMARY KEY,
    legacy_nocodb_id TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'waiting', 'completed', 'cancelled')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_person_id TEXT,
    assignee_display_name TEXT,
    due_at TIMESTAMPTZ,
    waiting_on TEXT,
    review_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    source_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
    project_codes TEXT[] NOT NULL DEFAULT '{}'::text[],
    purpose_label TEXT,
    completion_contract JSONB,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_fingerprint TEXT,
    last_operation_key TEXT,
    last_operation_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE canonical_tasks
    ADD COLUMN IF NOT EXISTS project_codes TEXT[] NOT NULL DEFAULT '{}'::text[];

-- 何のための仕事か（例: 口コミ）。1 Taskに1つ、未分類はNULL。
ALTER TABLE canonical_tasks
    ADD COLUMN IF NOT EXISTS purpose_label TEXT;

-- 確認待ちのTaskが待っている相手のGraph person ID。条件や特定の人でない待ちはNULL。
-- 待っている相手・条件の自由記述（waiting_on）とは別に持つ。
ALTER TABLE canonical_tasks
    ADD COLUMN IF NOT EXISTS waiting_on_person_id TEXT;

-- Structured Task goal and completion criteria. Validation of the contract's
-- exact fields belongs to the public Task API; storage only requires an object.
ALTER TABLE canonical_tasks
    ADD COLUMN IF NOT EXISTS completion_contract JSONB;

ALTER TABLE canonical_tasks
    DROP CONSTRAINT IF EXISTS canonical_tasks_completion_contract_shape_check;
ALTER TABLE canonical_tasks
    ADD CONSTRAINT canonical_tasks_completion_contract_shape_check
    CHECK (
        completion_contract IS NULL
        OR jsonb_typeof(completion_contract) = 'object'
    );

ALTER TABLE canonical_tasks
    DROP CONSTRAINT IF EXISTS canonical_tasks_purpose_label_check;
ALTER TABLE canonical_tasks
    ADD CONSTRAINT canonical_tasks_purpose_label_check
    CHECK (
        purpose_label IS NULL
        OR (
            char_length(purpose_label) BETWEEN 1 AND 30
            AND purpose_label = btrim(purpose_label)
            AND purpose_label !~ '[[:cntrl:]]'
        )
    );

ALTER TABLE canonical_tasks
    DROP CONSTRAINT IF EXISTS canonical_tasks_status_check;
ALTER TABLE canonical_tasks
    ADD CONSTRAINT canonical_tasks_status_check
    CHECK (status IN ('pending', 'in_progress', 'waiting', 'completed', 'cancelled'));

CREATE INDEX IF NOT EXISTS canonical_tasks_status_priority_idx
    ON canonical_tasks (status, priority);
CREATE INDEX IF NOT EXISTS canonical_tasks_assignee_due_idx
    ON canonical_tasks (assignee_person_id, due_at);
CREATE INDEX IF NOT EXISTS canonical_tasks_project_codes_idx
    ON canonical_tasks USING GIN (project_codes);
