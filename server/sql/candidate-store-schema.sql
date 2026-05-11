-- candidate-store schema (SPEC-candidate-store-mvp)
-- Memory Candidate Store + Promotion Audit Events
-- INV-1: Graph SSOT retrieval から見えない（独立 RLS）

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  cognitive_type TEXT NOT NULL CHECK (cognitive_type IN
    ('observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result')),

  owner_person_id TEXT NOT NULL,
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
  recommended_owner_person_id TEXT,

  promotion_status TEXT NOT NULL DEFAULT 'candidate' CHECK (promotion_status IN
    ('candidate', 'pending_approval', 'approved', 'rejected', 'expired', 'promoted_to_graph')),
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

-- PII / secret scan ブロック記録（INV-4）
CREATE TABLE IF NOT EXISTS candidate_scan_blocks (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  actor_person_id TEXT NOT NULL,
  findings JSONB NOT NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INV-7: 状態遷移の単調性を trigger で強制
CREATE OR REPLACE FUNCTION enforce_candidate_status_transitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.promotion_status = OLD.promotion_status THEN
    RETURN NEW;
  END IF;
  IF OLD.promotion_status = 'candidate' AND NEW.promotion_status IN ('pending_approval', 'rejected', 'expired') THEN
    RETURN NEW;
  ELSIF OLD.promotion_status = 'pending_approval' AND NEW.promotion_status IN ('approved', 'rejected', 'expired') THEN
    RETURN NEW;
  ELSIF OLD.promotion_status = 'approved' AND NEW.promotion_status = 'promoted_to_graph' THEN
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
