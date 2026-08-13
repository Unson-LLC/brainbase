-- candidate-store schema (SPEC-candidate-store-mvp)
-- Memory Candidate Store + Promotion Audit Events
-- INV-1: Graph SSOT retrieval から見えない（独立 RLS）

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  cognitive_type TEXT NOT NULL CHECK (cognitive_type IN
    ('observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result')),

  owner_person_id TEXT NOT NULL,
  organization_id TEXT,
  actor_person_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_ids JSONB NOT NULL,

  workspace TEXT,
  channel_id TEXT,
  thread_ts TEXT,
  project_code TEXT,
  org_ids TEXT[] NOT NULL DEFAULT '{}',
  project_ids TEXT[] NOT NULL DEFAULT '{}',
  team_id TEXT,

  visibility TEXT NOT NULL CHECK (visibility IN ('owner', 'team', 'org', 'public')),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('internal', 'restricted', 'confidential', 'top-secret')),
  role_min TEXT NOT NULL DEFAULT 'member' CHECK (role_min IN ('member', 'gm', 'ceo')),
  agency_level TEXT NOT NULL DEFAULT 'synthesize' CHECK (agency_level IN ('none', 'read-only', 'synthesize', 'write-back')),

  recommended_subject_type TEXT,
  recommended_subject_id TEXT,
  recommended_owner_person_id TEXT,

  processing_stage TEXT NOT NULL DEFAULT 'received' CHECK (processing_stage IN
    ('received', 'queued', 'extracted', 'resolved', 'indexed', 'retrievable')),
  semantic_state TEXT NOT NULL DEFAULT 'active' CHECK (semantic_state IN
    ('active', 'superseded', 'contradicted', 'quarantined', 'retracted', 'expired')),
  target_tier TEXT NOT NULL DEFAULT 'ledger' CHECK (target_tier IN
    ('ledger', 'episode', 'personal_kg', 'graph', 'skill_candidate')),

  promotion_status TEXT NOT NULL DEFAULT 'candidate' CHECK (promotion_status IN
    ('candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved', 'rejected', 'expired', 'promoted_to_graph')),
  promoted_graph_entity_id TEXT,

  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  permission_snapshot JSONB,
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  body TEXT NOT NULL,
  redaction_status TEXT NOT NULL DEFAULT 'none' CHECK (redaction_status IN ('none', 'redacted', 'needs_redaction')),
  confidence NUMERIC,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS organization_id TEXT;

CREATE OR REPLACE FUNCTION app_person_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.person_id', true);
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN RAISE EXCEPTION 'person context required' USING ERRCODE = '42501'; END IF;
  RETURN value;
END $$;
CREATE OR REPLACE FUNCTION app_organization_id_required()
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE value TEXT := current_setting('app.organization_id', true);
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN RAISE EXCEPTION 'organization context required' USING ERRCODE = '42501'; END IF;
  RETURN value;
END $$;

-- 2026-05 compatibility upgrade:
-- Early production deployments used subject_type/subject_id/memory columns.
-- Keep those columns if present, but add the candidate-store-mvp contract columns
-- required by PgCandidateRepository without rewriting existing records.
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS cognitive_type TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS org_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS project_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS team_id TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS agency_level TEXT NOT NULL DEFAULT 'synthesize';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS recommended_subject_type TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS recommended_subject_id TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS processing_stage TEXT NOT NULL DEFAULT 'received';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS semantic_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS target_tier TEXT NOT NULL DEFAULT 'ledger';
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS promoted_graph_entity_id TEXT;
ALTER TABLE memory_candidates ADD COLUMN IF NOT EXISTS body TEXT;

UPDATE memory_candidates
SET organization_id = COALESCE(organization_id, NULLIF(org_ids[1], ''), '__quarantine__')
WHERE organization_id IS NULL;
ALTER TABLE memory_candidates ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'subject_type'
  ) THEN
    UPDATE memory_candidates
    SET cognitive_type = CASE
      WHEN subject_type IN ('observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result') THEN subject_type
      ELSE 'observation'
    END
    WHERE cognitive_type IS NULL;
  ELSE
    UPDATE memory_candidates
    SET cognitive_type = 'observation'
    WHERE cognitive_type IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'memory'
  ) THEN
    UPDATE memory_candidates
    SET body = COALESCE(
      body,
      memory->>'body',
      memory->>'text',
      memory::text
    )
    WHERE body IS NULL;
  ELSE
    UPDATE memory_candidates
    SET body = COALESCE(body, '[legacy candidate body missing]')
    WHERE body IS NULL;
  END IF;
END $$;

ALTER TABLE memory_candidates ALTER COLUMN cognitive_type SET NOT NULL;
ALTER TABLE memory_candidates ALTER COLUMN body SET NOT NULL;

ALTER TABLE memory_candidates DROP CONSTRAINT IF EXISTS memory_candidates_processing_stage_check;
ALTER TABLE memory_candidates ADD CONSTRAINT memory_candidates_processing_stage_check CHECK (processing_stage IN
  ('received', 'queued', 'extracted', 'resolved', 'indexed', 'retrievable'));

ALTER TABLE memory_candidates DROP CONSTRAINT IF EXISTS memory_candidates_semantic_state_check;
ALTER TABLE memory_candidates ADD CONSTRAINT memory_candidates_semantic_state_check CHECK (semantic_state IN
  ('active', 'superseded', 'contradicted', 'quarantined', 'retracted', 'expired'));

ALTER TABLE memory_candidates DROP CONSTRAINT IF EXISTS memory_candidates_target_tier_check;
ALTER TABLE memory_candidates ADD CONSTRAINT memory_candidates_target_tier_check CHECK (target_tier IN
  ('ledger', 'episode', 'personal_kg', 'graph', 'skill_candidate'));

ALTER TABLE memory_candidates DROP CONSTRAINT IF EXISTS memory_candidates_graph_subject_check;
ALTER TABLE memory_candidates ADD CONSTRAINT memory_candidates_graph_subject_check CHECK (
  target_tier <> 'graph'
  OR (recommended_subject_id IS NOT NULL AND btrim(recommended_subject_id) <> '')
);

UPDATE memory_candidates
SET promotion_status = 'candidate'
WHERE promotion_status IN ('raw', 'draft') OR promotion_status IS NULL;

ALTER TABLE memory_candidates DROP CONSTRAINT IF EXISTS memory_candidates_promotion_status_check;
ALTER TABLE memory_candidates ADD CONSTRAINT memory_candidates_promotion_status_check CHECK (promotion_status IN
  ('candidate', 'gate_classified', 'pending_approval', 'auto_promoted', 'approved', 'rejected', 'expired', 'promoted_to_graph'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'subject_type'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE memory_candidates ALTER COLUMN subject_type DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memory_candidates'
      AND column_name = 'memory'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE memory_candidates ALTER COLUMN memory DROP NOT NULL;
  END IF;
END $$;

-- INV-10: 同一 source_event の重複 candidate を防ぐ
CREATE UNIQUE INDEX IF NOT EXISTS memory_candidates_unique_source
  ON memory_candidates (source_system, owner_person_id, (source_event_ids::text));

CREATE INDEX IF NOT EXISTS memory_candidates_owner ON memory_candidates(owner_person_id);
CREATE INDEX IF NOT EXISTS memory_candidates_status ON memory_candidates(promotion_status);
CREATE INDEX IF NOT EXISTS memory_candidates_type ON memory_candidates(cognitive_type);
CREATE INDEX IF NOT EXISTS memory_candidates_expires ON memory_candidates(expires_at)
  WHERE expires_at IS NOT NULL AND promotion_status IN ('candidate', 'pending_approval');

CREATE TABLE IF NOT EXISTS promotion_audit_events (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
  actor_person_id TEXT NOT NULL,
  decision_owner_person_id TEXT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  evidence_ids JSONB
);

CREATE INDEX IF NOT EXISTS promotion_audit_events_candidate ON promotion_audit_events(candidate_id);
CREATE INDEX IF NOT EXISTS promotion_audit_events_actor ON promotion_audit_events(actor_person_id);

ALTER TABLE memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_candidates_owner_scope ON memory_candidates;
CREATE POLICY memory_candidates_owner_scope ON memory_candidates
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

ALTER TABLE promotion_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotion_audit_owner_scope ON promotion_audit_events;
CREATE POLICY promotion_audit_owner_scope ON promotion_audit_events
  USING (EXISTS (
    SELECT 1 FROM memory_candidates candidate
    WHERE candidate.id = candidate_id
      AND candidate.owner_person_id = app_person_id_required()
      AND candidate.organization_id = app_organization_id_required()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM memory_candidates candidate
    WHERE candidate.id = candidate_id
      AND candidate.owner_person_id = app_person_id_required()
      AND candidate.organization_id = app_organization_id_required()
  ));

-- PII / secret scan ブロック記録（INV-4）
CREATE TABLE IF NOT EXISTS candidate_scan_blocks (
  id BIGSERIAL PRIMARY KEY,
  owner_person_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  actor_person_id TEXT NOT NULL,
  findings JSONB NOT NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE candidate_scan_blocks ADD COLUMN IF NOT EXISTS owner_person_id TEXT;
ALTER TABLE candidate_scan_blocks ADD COLUMN IF NOT EXISTS organization_id TEXT;
UPDATE candidate_scan_blocks
SET owner_person_id = COALESCE(owner_person_id, actor_person_id),
    organization_id = COALESCE(organization_id, '__quarantine__')
WHERE owner_person_id IS NULL OR organization_id IS NULL;
ALTER TABLE candidate_scan_blocks ALTER COLUMN owner_person_id SET NOT NULL;
ALTER TABLE candidate_scan_blocks ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE candidate_scan_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_scan_blocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS candidate_scan_blocks_owner_scope ON candidate_scan_blocks;
CREATE POLICY candidate_scan_blocks_owner_scope ON candidate_scan_blocks
  USING (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required())
  WITH CHECK (owner_person_id = app_person_id_required() AND organization_id = app_organization_id_required());

-- INV-7: 状態遷移の単調性を trigger で強制
CREATE OR REPLACE FUNCTION enforce_candidate_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.promotion_status = OLD.promotion_status THEN
    RETURN NEW;
  END IF;
  IF OLD.promotion_status = 'candidate' AND NEW.promotion_status IN ('gate_classified', 'pending_approval', 'auto_promoted', 'rejected', 'expired') THEN
    RETURN NEW;
  ELSIF OLD.promotion_status = 'gate_classified' AND NEW.promotion_status IN ('pending_approval', 'auto_promoted', 'rejected', 'expired') THEN
    RETURN NEW;
  ELSIF OLD.promotion_status = 'pending_approval' AND NEW.promotion_status IN ('approved', 'rejected', 'expired') THEN
    RETURN NEW;
  ELSIF OLD.promotion_status IN ('approved', 'auto_promoted') AND NEW.promotion_status = 'promoted_to_graph' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid candidate promotion_status transition: % -> %', OLD.promotion_status, NEW.promotion_status;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'memory_candidates_status_guard') THEN
    CREATE TRIGGER memory_candidates_status_guard
      BEFORE UPDATE OF promotion_status ON memory_candidates
      FOR EACH ROW EXECUTE FUNCTION enforce_candidate_status_transitions();
  END IF;
END $$;

-- audit-only append: promotion_audit_events は immutable
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'promotion_audit_events is append-only';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'promotion_audit_events_no_mutation') THEN
    CREATE TRIGGER promotion_audit_events_no_mutation
      BEFORE UPDATE OR DELETE ON promotion_audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;
END $$;
