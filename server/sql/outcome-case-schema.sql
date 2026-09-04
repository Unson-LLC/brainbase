CREATE TABLE IF NOT EXISTS outcome_cases (
    case_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
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
    ADD COLUMN IF NOT EXISTS organization_id TEXT,
    ADD COLUMN IF NOT EXISTS reference_resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS evaluation_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- OutcomeCase rows are tenant-owned.  For an existing v1 installation the
-- owning tenant is only accepted when it is provable from its project; an
-- orphaned row makes provisioning fail closed instead of silently becoming a
-- cross-organization record.
UPDATE outcome_cases outcome_case
   SET organization_id = project.organization_id
  FROM projects project
 WHERE outcome_case.organization_id IS NULL
   AND outcome_case.project_code = project.code
   AND project.organization_id IS NOT NULL;

DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM outcome_cases WHERE organization_id IS NULL OR btrim(organization_id) = '') THEN
        RAISE EXCEPTION 'OUTCOME_CASE_ORGANIZATION_ID_REQUIRED';
    END IF;
END;
$do$;

ALTER TABLE outcome_cases
    ALTER COLUMN organization_id SET NOT NULL;

-- An evaluation is an audit event. Existing events must never be edited or
-- removed, and each persisted evaluation must add exactly one new event.
CREATE OR REPLACE FUNCTION outcome_case_evaluation_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    old_length INTEGER;
    new_length INTEGER;
BEGIN
    old_length := jsonb_array_length(OLD.evaluation_history);
    new_length := jsonb_array_length(NEW.evaluation_history);
    IF new_length <> old_length + 1
       OR (NEW.evaluation_history - (new_length - 1)) IS DISTINCT FROM OLD.evaluation_history THEN
        RAISE EXCEPTION 'OUTCOME_CASE_EVALUATION_HISTORY_APPEND_ONLY';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS outcome_case_evaluation_history_append_only ON outcome_cases;
CREATE TRIGGER outcome_case_evaluation_history_append_only
    BEFORE UPDATE OF evaluation_history ON outcome_cases
    FOR EACH ROW
    EXECUTE FUNCTION outcome_case_evaluation_history_append_only();

CREATE INDEX IF NOT EXISTS outcome_cases_organization_project_idx ON outcome_cases (organization_id, project_code, updated_at DESC);
