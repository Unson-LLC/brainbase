-- Personal KG promotion consent, organization review, and Graph publication are
-- separate decisions. Personal text is never copied into the organization Graph.

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
  ADD COLUMN IF NOT EXISTS normalization_contract_version TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS normalized_payload JSONB;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS normalized_payload_hash TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS normalized_by_person_id TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS normalized_at TIMESTAMPTZ;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS owner_consent_receipt_id TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS organization_review_receipt_id TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS graph_entity_id TEXT;
ALTER TABLE knowledge_promotion_requests
  ADD COLUMN IF NOT EXISTS legacy_without_normalized_evidence BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS knowledge_promotion_authority_uses (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL REFERENCES knowledge_promotion_requests(request_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('request', 'owner_consent', 'organization_review')),
  actor_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_code TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_promotion_authority_request
  ON knowledge_promotion_authority_uses(request_id, action);

ALTER TABLE knowledge_promotion_requests
  DROP CONSTRAINT IF EXISTS knowledge_promotion_requests_status_check;
ALTER TABLE knowledge_promotion_requests
  DROP CONSTRAINT IF EXISTS knowledge_promotion_normalized_payload_check;
ALTER TABLE knowledge_promotion_requests
  DROP CONSTRAINT IF EXISTS knowledge_promotion_org_acceptance_evidence_check;
ALTER TABLE knowledge_promotion_requests
  DROP CONSTRAINT IF EXISTS knowledge_promotion_owner_consent_evidence_check;

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

-- Preview-only approvals cannot be carried into the exact-payload contract.
-- Fail closed and require the owner to review the normalized payload again.
UPDATE knowledge_promotion_requests
SET status = 'pending_owner_approval',
    owner_decided_by = NULL,
    owner_decided_at = NULL,
    owner_consent_receipt_id = NULL,
    decided_at = NULL
WHERE status = 'pending_org_review'
  AND (normalized_payload IS NULL OR normalized_payload_hash IS NULL);

-- Only rows that already existed before M1-C may lack the new evidence contract.
-- The trigger below prevents any new row or later update from opting into this flag.
UPDATE knowledge_promotion_requests
SET legacy_without_normalized_evidence = TRUE
WHERE status = 'org_accepted'
  AND normalization_contract_version IS NULL
  AND normalized_payload IS NULL
  AND normalized_payload_hash IS NULL
  AND owner_consent_receipt_id IS NULL
  AND organization_review_receipt_id IS NULL
  AND graph_entity_id IS NULL;

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

ALTER TABLE knowledge_promotion_requests
  ADD CONSTRAINT knowledge_promotion_normalized_payload_check CHECK (
    normalized_payload IS NULL
    OR (
      normalization_contract_version = 'personal_knowledge_normalized.v1'
      AND jsonb_typeof(normalized_payload) = 'object'
      AND normalized_payload->>'schema_version' = 'personal_knowledge_normalized.v1'
      AND normalized_payload_hash ~ '^sha256:[a-f0-9]{64}$'
      AND normalized_by_person_id IS NOT NULL
      AND normalized_at IS NOT NULL
      AND legacy_without_normalized_evidence = FALSE
    )
  );

ALTER TABLE knowledge_promotion_requests
  ADD CONSTRAINT knowledge_promotion_owner_consent_evidence_check CHECK (
    status NOT IN ('pending_org_review', 'org_accepted', 'org_rejected')
    OR legacy_without_normalized_evidence = TRUE
    OR (
      normalized_payload IS NOT NULL
      AND normalized_payload_hash ~ '^sha256:[a-f0-9]{64}$'
      AND owner_consent_receipt_id ~ '^pkoc_[a-f0-9]{24}$'
    )
  );

ALTER TABLE knowledge_promotion_requests
  ADD CONSTRAINT knowledge_promotion_org_acceptance_evidence_check CHECK (
    status <> 'org_accepted'
    OR (
      legacy_without_normalized_evidence = TRUE
      AND normalization_contract_version IS NULL
      AND normalized_payload IS NULL
      AND normalized_payload_hash IS NULL
      AND owner_consent_receipt_id IS NULL
      AND organization_review_receipt_id IS NULL
      AND graph_entity_id IS NULL
    )
    OR (
      legacy_without_normalized_evidence = FALSE
      AND normalization_contract_version = 'personal_knowledge_normalized.v1'
      AND normalized_payload IS NOT NULL
      AND normalized_payload_hash ~ '^sha256:[a-f0-9]{64}$'
      AND owner_consent_receipt_id ~ '^pkoc_[a-f0-9]{24}$'
      AND organization_review_receipt_id ~ '^pkor_[a-f0-9]{24}$'
      AND organization_reviewed_by IS NOT NULL
      AND organization_reviewed_at IS NOT NULL
      AND organization_event_id IS NOT NULL
      AND graph_entity_id IS NOT NULL
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

CREATE OR REPLACE FUNCTION enforce_knowledge_promotion_evidence_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.legacy_without_normalized_evidence = TRUE THEN
    RAISE EXCEPTION 'New promotion rows cannot opt into legacy evidence bypass';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.legacy_without_normalized_evidence = FALSE
     AND NEW.legacy_without_normalized_evidence = TRUE THEN
    RAISE EXCEPTION 'Promotion rows cannot opt into legacy evidence bypass';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.normalized_payload_hash IS NOT NULL
     AND (
       NEW.normalized_payload IS DISTINCT FROM OLD.normalized_payload
       OR NEW.normalized_payload_hash IS DISTINCT FROM OLD.normalized_payload_hash
       OR NEW.normalized_by_person_id IS DISTINCT FROM OLD.normalized_by_person_id
       OR NEW.normalized_at IS DISTINCT FROM OLD.normalized_at
       OR NEW.normalization_contract_version IS DISTINCT FROM OLD.normalization_contract_version
     ) THEN
    RAISE EXCEPTION 'Normalized promotion evidence is immutable; create a new promotion request';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.owner_consent_receipt_id IS NOT NULL
     AND NEW.owner_consent_receipt_id IS DISTINCT FROM OLD.owner_consent_receipt_id THEN
    RAISE EXCEPTION 'Owner consent receipt is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS knowledge_promotion_status_guard ON knowledge_promotion_requests;
CREATE TRIGGER knowledge_promotion_status_guard
  BEFORE UPDATE OF status ON knowledge_promotion_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_promotion_status_transition();

DROP TRIGGER IF EXISTS knowledge_promotion_evidence_guard ON knowledge_promotion_requests;
CREATE TRIGGER knowledge_promotion_evidence_guard
  BEFORE INSERT OR UPDATE ON knowledge_promotion_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_promotion_evidence_immutability();

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

ALTER TABLE knowledge_promotion_authority_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotion_authority_uses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_promotion_authority_scope ON knowledge_promotion_authority_uses;
CREATE POLICY personal_promotion_authority_scope ON knowledge_promotion_authority_uses
  USING (
    organization_id = app_organization_id_required()
    AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
  )
  WITH CHECK (
    organization_id = app_organization_id_required()
    AND project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
    AND actor_person_id = app_person_id_required()
  );

-- The private Personal event foreign key remains owner-visible. A distinct GM/CEO
-- may insert the audit link only when every value matches the accepted request.
ALTER TABLE knowledge_promotion_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotion_lineage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_lineage_owner_scope ON knowledge_promotion_lineage;
DROP POLICY IF EXISTS personal_lineage_two_stage_scope ON knowledge_promotion_lineage;
DROP POLICY IF EXISTS personal_lineage_owner_read ON knowledge_promotion_lineage;
DROP POLICY IF EXISTS personal_lineage_owner_insert ON knowledge_promotion_lineage;
DROP POLICY IF EXISTS personal_lineage_reviewer_insert ON knowledge_promotion_lineage;
CREATE POLICY personal_lineage_owner_read ON knowledge_promotion_lineage
  FOR SELECT
  USING (
    organization_id = app_organization_id_required()
    AND owner_person_id = app_person_id_required()
  );
CREATE POLICY personal_lineage_reviewer_insert ON knowledge_promotion_lineage
  FOR INSERT
  WITH CHECK (
    organization_id = app_organization_id_required()
    AND owner_person_id <> app_person_id_required()
    AND EXISTS (
      SELECT 1
      FROM knowledge_promotion_requests request
      WHERE request.request_id = knowledge_promotion_lineage.promotion_request_id
        AND request.organization_id = knowledge_promotion_lineage.organization_id
        AND request.owner_person_id = knowledge_promotion_lineage.owner_person_id
        AND request.personal_event_id = knowledge_promotion_lineage.personal_event_id
        AND request.organization_event_id = knowledge_promotion_lineage.organization_event_id
        AND request.project_code = ANY(string_to_array(current_setting('app.project_codes', true), ','))
        AND app_role_rank(current_setting('app.role', true)) >= app_role_rank('gm')
        AND request.status = 'org_accepted'
        AND request.normalized_payload_hash = knowledge_promotion_lineage.sanitization->>'normalized_payload_hash'
        AND request.owner_consent_receipt_id = knowledge_promotion_lineage.sanitization->>'owner_consent_receipt_id'
        AND request.organization_review_receipt_id = knowledge_promotion_lineage.sanitization->>'organization_review_receipt_id'
    )
  );

CREATE INDEX IF NOT EXISTS knowledge_promotion_requests_org_review_idx
  ON knowledge_promotion_requests (organization_id, project_code, status, created_at DESC)
  WHERE status = 'pending_org_review';
CREATE INDEX IF NOT EXISTS knowledge_promotion_requests_normalized_hash_idx
  ON knowledge_promotion_requests (organization_id, project_code, normalized_payload_hash)
  WHERE normalized_payload_hash IS NOT NULL;
