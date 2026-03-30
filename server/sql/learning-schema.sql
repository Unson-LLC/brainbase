CREATE TABLE IF NOT EXISTS learning_episodes (
    id text PRIMARY KEY,
    source_type text NOT NULL,
    project_id text,
    session_id text,
    task_id text,
    skill_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    wiki_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'partial')),
    summary text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    promotion_hint text NOT NULL DEFAULT 'auto',
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE learning_episodes
    DROP CONSTRAINT IF EXISTS learning_episodes_source_type_check;

ALTER TABLE learning_episodes
    ADD CONSTRAINT learning_episodes_source_type_check
    CHECK (source_type IN ('review', 'explicit_learn', 'session_log', 'codex_session_log'));

ALTER TABLE learning_episodes
    ADD COLUMN IF NOT EXISTS promotion_hint text NOT NULL DEFAULT 'auto';

ALTER TABLE learning_episodes
    DROP CONSTRAINT IF EXISTS learning_episodes_promotion_hint_check;

ALTER TABLE learning_episodes
    ADD CONSTRAINT learning_episodes_promotion_hint_check
    CHECK (promotion_hint IN ('auto', 'wiki', 'skill', 'both'));

CREATE INDEX IF NOT EXISTS idx_learning_episodes_processed_at
    ON learning_episodes (processed_at);
CREATE INDEX IF NOT EXISTS idx_learning_episodes_project_id
    ON learning_episodes (project_id);

CREATE TABLE IF NOT EXISTS learning_artifact_ingestions (
    id text PRIMARY KEY,
    adapter_name text NOT NULL,
    source_path text NOT NULL,
    fingerprint text NOT NULL,
    episode_id text NOT NULL REFERENCES learning_episodes(id) ON DELETE CASCADE,
    ingested_at timestamptz NOT NULL DEFAULT NOW(),
    last_seen_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_artifact_ingestions_unique
    ON learning_artifact_ingestions (adapter_name, source_path, fingerprint);
CREATE INDEX IF NOT EXISTS idx_learning_artifact_ingestions_episode
    ON learning_artifact_ingestions (episode_id);

CREATE TABLE IF NOT EXISTS promotion_candidates (
    id text PRIMARY KEY,
    pillar text NOT NULL,
    target_ref text NOT NULL,
    status text NOT NULL,
    canonical_summary text,
    semantic_scope text,
    merged_episode_count integer NOT NULL DEFAULT 1,
    source_episode_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    linked_wiki_candidate_id text,
    linked_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    proposed_content text NOT NULL,
    evaluation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    risk_level text NOT NULL DEFAULT 'medium',
    doc_type text,
    target_project_id text,
    apply_mode text NOT NULL DEFAULT 'manual',
    apply_error text,
    materialized_ref text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE promotion_candidates
    DROP CONSTRAINT IF EXISTS promotion_candidates_pillar_check;

ALTER TABLE promotion_candidates
    ADD CONSTRAINT promotion_candidates_pillar_check
    CHECK (pillar IN ('wiki', 'skill'));

ALTER TABLE promotion_candidates
    DROP CONSTRAINT IF EXISTS promotion_candidates_status_check;

ALTER TABLE promotion_candidates
    ADD CONSTRAINT promotion_candidates_status_check
    CHECK (status IN ('draft', 'evaluated', 'materialized', 'applied', 'rejected', 'merged'));

ALTER TABLE promotion_candidates
    DROP CONSTRAINT IF EXISTS promotion_candidates_risk_level_check;

ALTER TABLE promotion_candidates
    ADD CONSTRAINT promotion_candidates_risk_level_check
    CHECK (risk_level IN ('low', 'medium', 'high'));

ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS canonical_summary text;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS semantic_scope text;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS merged_episode_count integer NOT NULL DEFAULT 1;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS linked_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS doc_type text;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS target_project_id text;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS apply_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS apply_error text;
ALTER TABLE promotion_candidates
    ADD COLUMN IF NOT EXISTS materialized_ref text;

ALTER TABLE promotion_candidates
    DROP CONSTRAINT IF EXISTS promotion_candidates_apply_mode_check;

ALTER TABLE promotion_candidates
    ADD CONSTRAINT promotion_candidates_apply_mode_check
    CHECK (apply_mode IN ('auto', 'manual'));

CREATE INDEX IF NOT EXISTS idx_promotion_candidates_status
    ON promotion_candidates (status);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_target_ref
    ON promotion_candidates (pillar, target_ref);
CREATE INDEX IF NOT EXISTS idx_promotion_candidates_semantic_scope
    ON promotion_candidates (pillar, semantic_scope, status);
