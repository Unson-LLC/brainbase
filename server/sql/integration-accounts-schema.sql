-- integration_accounts schema (SPEC-account-foundation)

CREATE TABLE IF NOT EXISTS integration_accounts (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('personal', 'org', 'project')),
  owner_person_id TEXT,
  org_id TEXT,
  project_id TEXT,
  display_name TEXT NOT NULL,
  external_account_id TEXT,
  external_handle TEXT,
  credential_ref JSONB NOT NULL,
  oauth_client_ref JSONB,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disabled', 'revoked', 'reauth_required')),
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  rate_limit_profile_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by_person_id TEXT NOT NULL,
  updated_by_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  CHECK (
    (scope_type = 'personal' AND owner_person_id IS NOT NULL) OR
    (scope_type = 'org' AND org_id IS NOT NULL) OR
    (scope_type = 'project' AND project_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS integration_accounts_service ON integration_accounts(service);
CREATE INDEX IF NOT EXISTS integration_accounts_owner ON integration_accounts(owner_person_id) WHERE owner_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS integration_accounts_org ON integration_accounts(org_id) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_account_defaults (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  service TEXT NOT NULL,
  purpose TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 100,
  created_by_person_id TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id, service, purpose, account_id)
);

CREATE TABLE IF NOT EXISTS account_audit_events (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT REFERENCES integration_accounts(id) ON DELETE SET NULL,
  actor_person_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CONNECTED', 'REAUTHORIZED', 'REVOKED', 'DEFAULT_CHANGED', 'USED_FOR_POST')),
  context JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_audit_events_account ON account_audit_events(account_id);
CREATE INDEX IF NOT EXISTS account_audit_events_actor ON account_audit_events(actor_person_id);

-- prevent credential_ref からの secret leak: 形式validation trigger（access_token等の禁止キーを拒否）
CREATE OR REPLACE FUNCTION reject_credential_secret_keys()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  forbidden TEXT[] := ARRAY['access_token', 'refresh_token', 'api_key', 'password', 'secret', 'token'];
  k TEXT;
BEGIN
  IF NEW.credential_ref IS NOT NULL THEN
    FOREACH k IN ARRAY forbidden LOOP
      IF NEW.credential_ref ? k THEN
        RAISE EXCEPTION 'credential_ref must not contain secret key: %', k;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'integration_accounts_credential_guard') THEN
    CREATE TRIGGER integration_accounts_credential_guard
      BEFORE INSERT OR UPDATE OF credential_ref ON integration_accounts
      FOR EACH ROW EXECUTE FUNCTION reject_credential_secret_keys();
  END IF;
END $$;

-- audit immutability
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'account_audit_events_no_mutation') THEN
    CREATE TRIGGER account_audit_events_no_mutation
      BEFORE UPDATE OR DELETE ON account_audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;
END $$;
