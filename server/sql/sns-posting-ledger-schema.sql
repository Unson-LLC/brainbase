CREATE TABLE IF NOT EXISTS sns_posting_ledger_posts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_handle TEXT,
    platform TEXT NOT NULL DEFAULT 'x',
    date DATE NOT NULL,
    slot_index INTEGER NOT NULL CHECK (slot_index > 0),
    time TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'review_needed',
        'approved',
        'scheduled',
        'posted',
        'skipped',
        'learning_ready',
        'deleted'
    )),
    lane TEXT,
    format TEXT,
    body TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    posted_url TEXT,
    deleted_at TIMESTAMPTZ,
    deletion_source TEXT,
    deletion_reason TEXT,
    source JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    memo TEXT NOT NULL DEFAULT '',
    learning_candidate_id TEXT,
    revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    metrics_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, date, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_sns_posting_ledger_posts_date_status
    ON sns_posting_ledger_posts (date, status);

CREATE INDEX IF NOT EXISTS idx_sns_posting_ledger_posts_account_date
    ON sns_posting_ledger_posts (account_id, date);

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS deletion_source TEXT;

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

ALTER TABLE sns_posting_ledger_posts
    DROP CONSTRAINT IF EXISTS sns_posting_ledger_posts_status_check;

ALTER TABLE sns_posting_ledger_posts
    ADD CONSTRAINT sns_posting_ledger_posts_status_check
    CHECK (status IN (
        'review_needed',
        'approved',
        'scheduled',
        'posted',
        'skipped',
        'learning_ready',
        'deleted'
    ));
