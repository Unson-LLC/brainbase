CREATE TABLE IF NOT EXISTS canonical_task_writer (
    singleton_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_id),
    writer_token TEXT NOT NULL,
    process_identity JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_head TEXT,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_task_readiness (
    singleton_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_id),
    ready BOOLEAN NOT NULL DEFAULT FALSE,
    writer_token TEXT,
    manifest_hash TEXT,
    schema_version TEXT,
    source_head TEXT,
    evidence_hash TEXT,
    evidence_path TEXT,
    reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_task_operations (
    id BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'completed', 'failed')),
    writer_token TEXT NOT NULL,
    result_json JSONB,
    error_json JSONB,
    authorization_snapshot JSONB,
    recovery_checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scope, operation_key)
);

CREATE INDEX IF NOT EXISTS canonical_task_operations_state_idx
    ON canonical_task_operations (state, updated_at);
