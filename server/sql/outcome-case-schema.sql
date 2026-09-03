CREATE TABLE IF NOT EXISTS outcome_cases (
    case_id TEXT PRIMARY KEY,
    project_code TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    user_observable_outcome TEXT NOT NULL,
    protected_constraints JSONB NOT NULL CHECK (jsonb_typeof(protected_constraints) = 'array'),
    non_goals JSONB NOT NULL CHECK (jsonb_typeof(non_goals) = 'array'),
    authority JSONB NOT NULL CHECK (jsonb_typeof(authority) = 'object'),
    selected_domain_pack TEXT NOT NULL,
    reference_resolution JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reference_resolution) = 'object'),
    evaluation_history JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evaluation_history) = 'array'),
    terminal_evaluation JSONB,
    closure_status TEXT NOT NULL CHECK (closure_status IN ('open', 'incomplete', 'waiting_human', 'closed')),
    current_external_state TEXT NOT NULL CHECK (current_external_state IN ('unknown', 'accepted', 'processing', 'delivered', 'verified-complete', 'failed')),
    technical_story_refs JSONB NOT NULL CHECK (jsonb_typeof(technical_story_refs) = 'array'),
    run_receipt_refs JSONB NOT NULL CHECK (jsonb_typeof(run_receipt_refs) = 'array'),
    prior_attempt_refs JSONB NOT NULL CHECK (jsonb_typeof(prior_attempt_refs) = 'array'),
    unresolved_failure_boundary TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing v1 installations may have been provisioned before reference and history
-- fields were introduced. These additions are intentionally idempotent.
ALTER TABLE outcome_cases
    ADD COLUMN IF NOT EXISTS reference_resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS evaluation_history JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS outcome_cases_project_code_idx ON outcome_cases (project_code, updated_at DESC);
