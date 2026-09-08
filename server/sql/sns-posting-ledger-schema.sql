CREATE OR REPLACE FUNCTION app_person_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.person_id', true);
BEGIN
    IF value IS NULL OR btrim(value) = '' THEN
        RAISE EXCEPTION 'SNS person context required' USING ERRCODE = '42501';
    END IF;
    RETURN value;
END $$;

CREATE OR REPLACE FUNCTION app_organization_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.organization_id', true);
BEGIN
    IF value IS NULL OR btrim(value) = '' THEN
        RAISE EXCEPTION 'SNS organization context required' USING ERRCODE = '42501';
    END IF;
    RETURN value;
END $$;

CREATE TABLE IF NOT EXISTS sns_posting_ledger_posts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_handle TEXT,
    owner_person_id TEXT,
    actor_person_id TEXT,
    organization_id TEXT,
    platform TEXT NOT NULL DEFAULT 'x',
    date DATE NOT NULL,
    slot_index INTEGER NOT NULL CHECK (slot_index > 0),
    time TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'review_needed',
        'approved',
        'scheduled',
        'publishing',
        'posted',
        'publish_failed',
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sns_posting_ledger_posts_date_status
    ON sns_posting_ledger_posts (date, status);

CREATE INDEX IF NOT EXISTS idx_sns_posting_ledger_posts_account_date
    ON sns_posting_ledger_posts (account_id, date);

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS owner_person_id TEXT;

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS actor_person_id TEXT;

ALTER TABLE sns_posting_ledger_posts
    ADD COLUMN IF NOT EXISTS organization_id TEXT;

ALTER TABLE sns_posting_ledger_posts
    DROP CONSTRAINT IF EXISTS sns_posting_ledger_posts_account_id_date_slot_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sns_posting_ledger_posts_authority_slot
    ON sns_posting_ledger_posts (
        COALESCE(organization_id, '__legacy__'),
        COALESCE(owner_person_id, '__legacy__'),
        account_id,
        date,
        slot_index
    );

CREATE INDEX IF NOT EXISTS idx_sns_posting_ledger_posts_authority_date
    ON sns_posting_ledger_posts (organization_id, owner_person_id, date, status);

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
        'publishing',
        'posted',
        'publish_failed',
        'skipped',
        'learning_ready',
        'deleted'
    ));

ALTER TABLE sns_posting_ledger_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sns_posting_ledger_posts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sns_posting_ledger_authority_scope ON sns_posting_ledger_posts;
CREATE POLICY sns_posting_ledger_authority_scope ON sns_posting_ledger_posts
    USING (
        owner_person_id = app_person_id_required()
        AND organization_id = app_organization_id_required()
    )
    WITH CHECK (
        owner_person_id = app_person_id_required()
        AND organization_id = app_organization_id_required()
    );
