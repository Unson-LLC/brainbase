-- Raw judgment receipts can contain personal judgment. They are immutable and
-- visible only to their author; adoption creates a separate snapshot with its
-- own author-limited access policy.
CREATE TABLE IF NOT EXISTS judgment_receipts (
    organization_id TEXT NOT NULL CHECK (btrim(organization_id) <> ''),
    project_code TEXT NOT NULL CHECK (btrim(project_code) <> ''),
    owner_person_id TEXT NOT NULL CHECK (btrim(owner_person_id) <> ''),
    resolution_id TEXT NOT NULL CHECK (btrim(resolution_id) <> ''),
    turn_id TEXT NOT NULL CHECK (btrim(turn_id) <> ''),
    receipt JSONB NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_code, owner_person_id, resolution_id),
    CHECK ((jsonb_typeof(receipt -> 'resolution_id') = 'string' AND receipt ->> 'resolution_id' = resolution_id) IS TRUE),
    CHECK ((jsonb_typeof(receipt -> 'turn_id') = 'string' AND receipt ->> 'turn_id' = turn_id) IS TRUE),
    CHECK ((jsonb_typeof(receipt -> 'project_code') = 'string' AND receipt ->> 'project_code' = project_code) IS TRUE)
);

CREATE OR REPLACE FUNCTION judgment_receipts_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'JUDGMENT_RECEIPTS_IMMUTABLE';
END;
$function$;

DROP TRIGGER IF EXISTS judgment_receipts_immutable ON judgment_receipts;
CREATE TRIGGER judgment_receipts_immutable
    BEFORE UPDATE OR DELETE ON judgment_receipts
    FOR EACH ROW
    EXECUTE FUNCTION judgment_receipts_immutable();

ALTER TABLE judgment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE judgment_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS judgment_receipts_author_scope ON judgment_receipts;
CREATE POLICY judgment_receipts_author_scope ON judgment_receipts
    FOR ALL
    USING (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND project_code = ANY(app_project_codes())
        AND owner_person_id = NULLIF(current_setting('app.judgment_receipt_owner_id', true), '')
        AND EXISTS (
            SELECT 1 FROM projects project
             WHERE project.code = judgment_receipts.project_code
               AND project.organization_id = judgment_receipts.organization_id
        )
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND project_code = ANY(app_project_codes())
        AND owner_person_id = NULLIF(current_setting('app.judgment_receipt_owner_id', true), '')
        AND EXISTS (
            SELECT 1 FROM projects project
             WHERE project.code = judgment_receipts.project_code
               AND project.organization_id = judgment_receipts.organization_id
        )
    );

-- This table deliberately has no application write policy. It is seeded by an
-- out-of-band database administrator process; ordinary RACI assignment is not
-- an adoption authority because members can otherwise self-assign that table.
CREATE TABLE IF NOT EXISTS vibepro_handoff_adoption_grants (
    organization_id TEXT NOT NULL CHECK (btrim(organization_id) <> ''),
    project_code TEXT NOT NULL CHECK (btrim(project_code) <> ''),
    person_id TEXT NOT NULL CHECK (btrim(person_id) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, project_code, person_id)
);

ALTER TABLE vibepro_handoff_adoption_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE vibepro_handoff_adoption_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vibepro_handoff_adoption_grants_author_read ON vibepro_handoff_adoption_grants;
CREATE POLICY vibepro_handoff_adoption_grants_author_read ON vibepro_handoff_adoption_grants
    FOR SELECT
    USING (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND project_code = ANY(app_project_codes())
        AND person_id = NULLIF(current_setting('app.vibepro_handoff_adoption_owner_id', true), '')
        AND EXISTS (
            SELECT 1 FROM projects project
             WHERE project.code = vibepro_handoff_adoption_grants.project_code
               AND project.organization_id = vibepro_handoff_adoption_grants.organization_id
        )
    );

CREATE TABLE IF NOT EXISTS vibepro_handoff_adoptions (
    organization_id TEXT NOT NULL CHECK (btrim(organization_id) <> ''),
    project_code TEXT NOT NULL CHECK (btrim(project_code) <> ''),
    owner_person_id TEXT NOT NULL CHECK (btrim(owner_person_id) <> ''),
    case_id TEXT NOT NULL CHECK (btrim(case_id) <> ''),
    resolution_id TEXT NOT NULL CHECK (btrim(resolution_id) <> ''),
    outcome_case_revision INTEGER NOT NULL CHECK (outcome_case_revision > 0),
    decision JSONB NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
    target JSONB NOT NULL CHECK (jsonb_typeof(target) = 'object'),
    technical_acceptance JSONB NOT NULL CHECK (jsonb_typeof(technical_acceptance) = 'array'),
    production_probe JSONB NOT NULL CHECK (jsonb_typeof(production_probe) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_code, owner_person_id, case_id, resolution_id),
    FOREIGN KEY (case_id) REFERENCES outcome_cases (case_id),
    FOREIGN KEY (organization_id, project_code, owner_person_id, resolution_id)
        REFERENCES judgment_receipts (organization_id, project_code, owner_person_id, resolution_id),
    CHECK ((jsonb_typeof(decision -> 'case_id') = 'string' AND decision ->> 'case_id' = case_id) IS TRUE),
    CHECK ((jsonb_typeof(decision -> 'project_code') = 'string' AND decision ->> 'project_code' = project_code) IS TRUE),
    CHECK ((jsonb_typeof(decision -> 'resolution_id') = 'string' AND decision ->> 'resolution_id' = resolution_id) IS TRUE),
    CHECK ((jsonb_typeof(decision -> 'turn_id') = 'string' AND btrim(decision ->> 'turn_id') <> '') IS TRUE),
    CHECK ((jsonb_typeof(decision -> 'judgment_receipt_ref') = 'string'
        AND decision ->> 'judgment_receipt_ref' = 'brainbase://judgment-receipts/' || resolution_id) IS TRUE),
    CHECK ((jsonb_typeof(target -> 'case_id') = 'string' AND target ->> 'case_id' = case_id) IS TRUE),
    CHECK ((jsonb_typeof(target -> 'project_code') = 'string' AND target ->> 'project_code' = project_code) IS TRUE)
);

CREATE OR REPLACE FUNCTION vibepro_handoff_adoptions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'VIBEPRO_HANDOFF_ADOPTIONS_IMMUTABLE';
END;
$function$;

DROP TRIGGER IF EXISTS vibepro_handoff_adoptions_immutable ON vibepro_handoff_adoptions;
CREATE TRIGGER vibepro_handoff_adoptions_immutable
    BEFORE UPDATE OR DELETE ON vibepro_handoff_adoptions
    FOR EACH ROW
    EXECUTE FUNCTION vibepro_handoff_adoptions_immutable();

ALTER TABLE vibepro_handoff_adoptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vibepro_handoff_adoptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vibepro_handoff_adoptions_author_read ON vibepro_handoff_adoptions;
CREATE POLICY vibepro_handoff_adoptions_author_read ON vibepro_handoff_adoptions
    FOR SELECT
    USING (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND project_code = ANY(app_project_codes())
        AND owner_person_id = NULLIF(current_setting('app.vibepro_handoff_adoption_owner_id', true), '')
        AND EXISTS (
            SELECT 1 FROM projects project
             WHERE project.code = vibepro_handoff_adoptions.project_code
               AND project.organization_id = vibepro_handoff_adoptions.organization_id
        )
    );

DROP POLICY IF EXISTS vibepro_handoff_adoptions_author_insert ON vibepro_handoff_adoptions;
CREATE POLICY vibepro_handoff_adoptions_author_insert ON vibepro_handoff_adoptions
    FOR INSERT
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.organization_id', true), '')
        AND project_code = ANY(app_project_codes())
        AND owner_person_id = NULLIF(current_setting('app.vibepro_handoff_adoption_owner_id', true), '')
        AND EXISTS (
            SELECT 1 FROM projects project
             WHERE project.code = vibepro_handoff_adoptions.project_code
               AND project.organization_id = vibepro_handoff_adoptions.organization_id
        )
        AND EXISTS (
            SELECT 1 FROM vibepro_handoff_adoption_grants adoption_grant
             WHERE adoption_grant.organization_id = vibepro_handoff_adoptions.organization_id
               AND adoption_grant.project_code = vibepro_handoff_adoptions.project_code
               AND adoption_grant.person_id = vibepro_handoff_adoptions.owner_person_id
        )
        AND EXISTS (
            SELECT 1 FROM judgment_receipts raw_receipt
             WHERE raw_receipt.organization_id = vibepro_handoff_adoptions.organization_id
               AND raw_receipt.project_code = vibepro_handoff_adoptions.project_code
               AND raw_receipt.owner_person_id = vibepro_handoff_adoptions.owner_person_id
               AND raw_receipt.resolution_id = vibepro_handoff_adoptions.resolution_id
               AND raw_receipt.turn_id = vibepro_handoff_adoptions.decision ->> 'turn_id'
        )
        AND EXISTS (
            SELECT 1 FROM outcome_cases outcome_case
             WHERE outcome_case.case_id = vibepro_handoff_adoptions.case_id
               AND outcome_case.organization_id = vibepro_handoff_adoptions.organization_id
               AND outcome_case.project_code = vibepro_handoff_adoptions.project_code
               AND outcome_case.revision = vibepro_handoff_adoptions.outcome_case_revision
        )
    );
