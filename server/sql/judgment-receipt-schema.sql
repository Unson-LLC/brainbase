-- Raw judgment receipts can contain personal judgment. They are immutable and
-- visible only to their author; adoption creates a separate, shareable snapshot.
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
