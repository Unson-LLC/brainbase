-- Personal KG promotion consent and organization review are separate decisions.
-- The owner may only consent/reject. A distinct GM/CEO reviewer may accept/reject
-- for the organization after the request reaches pending_org_review.

ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS owner_decided_by TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS owner_decided_at TIMESTAMPTZ;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS organization_reviewed_by TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS organization_reviewed_at TIMESTAMPTZ;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS organization_review_reason TEXT;

ALTER TABLE knowledge_promotion_requests
  DROP CONSTRAINT IF EXISTS knowledge_promotion_requests_status_check;

UPDATE knowledge_promotion_requests
SET status = CASE status
  WHEN 'approved' THEN 'org_accepted'
  WHEN 'rejected' THEN 'owner_rejected'
  ELSE status
END;

UPDATE knowledge_promotion_requests
SET owner_decided_by = COALESCE(owner_decided_by, owner_person_id),
    owner_decided_at = COALESCE(owner_decided_at, decided_at)
WHERE status IN ('pending_org_review', 'org_accepted', 'org_rejected', 'owner_rejected')
  AND owner_decided_at IS NULL;

UPDATE knowledge_promotion_requests
SET organization_reviewed_at = COALESCE(organization_reviewed_at, decided_at)
WHERE status IN ('org_accepted', 'org_rejected')
  AND organization_reviewed_at IS NULL;

ALTER TABLE knowledge_promotion_requests
  ADD CONSTRAINT knowledge_promotion_requests_status_check CHECK (
    status IN (
      'pending_owner_approval',
      'owner_rejected',
      'pending_org_review',
      'org_accepted',
      'org_rejected'
    )
  );

CREATE OR REPLACE FUNCTION enforce_knowledge_promotion_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'pending_owner_approval'
     AND NEW.status IN ('owner_rejected', 'pending_org_review') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending_org_review'
     AND NEW.status IN ('org_accepted', 'org_rejected') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid knowledge promotion status transition: % -> %', OLD.status, NEW.status;
END $$;

DROP TRIGGER IF EXISTS knowledge_promotion_status_guard ON knowledge_promotion_requests;
CREATE TRIGGER knowledge_promotion_status_guard
  BEFORE UPDATE OF status ON knowledge_promotion_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_promotion_status_transition();

ALTER TABLE knowledge_promotion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotion_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_promotion_owner_scope ON knowledge_promotion_requests;
DROP POLICY IF EXISTS personal_promotion_two_stage_scope ON knowledge_promotion_requests;
CREATE POLICY personal_promotion_two_stage_scope ON knowledge_promotion_requests
  USING (
    organization_id = app_organization_id_required()
    AND (
      owner_person_id = app_person_id_required()
      OR (
        owner_person_id <> app_person_id_required()
        AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
        AND app_role_rank(current_setting('app.role', true)) >= app_role_rank('gm')
        AND status IN ('pending_org_review', 'org_accepted', 'org_rejected')
      )
    )
  )
  WITH CHECK (
    organization_id = app_organization_id_required()
    AND (
      owner_person_id = app_person_id_required()
      OR (
        owner_person_id <> app_person_id_required()
        AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
        AND app_role_rank(current_setting('app.role', true)) >= app_role_rank('gm')
        AND status IN ('pending_org_review', 'org_accepted', 'org_rejected')
      )
    )
  );

CREATE INDEX IF NOT EXISTS knowledge_promotion_requests_org_review_idx
  ON knowledge_promotion_requests (organization_id, project_code, status, created_at DESC)
  WHERE status = 'pending_org_review';