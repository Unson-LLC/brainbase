-- Tenant production provisioning control-plane schema.
-- This migration is additive but intentionally stops before changing existing rows
-- when tenant_key backfill evidence is missing.

ALTER TABLE brainbase_tenants
    ADD COLUMN IF NOT EXISTS tenant_key TEXT;

DO $brainbase_tenant_key_backfill$
BEGIN
    IF EXISTS (SELECT 1 FROM brainbase_tenants WHERE tenant_key IS NULL) THEN
        RAISE EXCEPTION 'tenant_key backfill is required before provisioning schema activation';
    END IF;
END
$brainbase_tenant_key_backfill$;

ALTER TABLE brainbase_tenants
    ALTER COLUMN tenant_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS brainbase_tenants_tenant_key_uq
    ON brainbase_tenants (tenant_key);

CREATE TABLE IF NOT EXISTS brainbase_tenant_revisions (
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision BIGINT NOT NULL CHECK (tenant_revision > 0),
    tenant_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'deletion_pending', 'deleted')),
    display_name TEXT NOT NULL,
    suspension_reason_code TEXT,
    deletion_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, tenant_revision),
    UNIQUE (tenant_key, tenant_revision)
);

INSERT INTO brainbase_tenant_revisions (
    tenant_id, tenant_revision, tenant_key, status, display_name,
    suspension_reason_code, deletion_after, created_at, updated_at, recorded_at
)
SELECT tenant_id, tenant_revision, tenant_key, status, display_name,
       suspension_reason_code, deletion_after, created_at, updated_at, now()
  FROM brainbase_tenants
ON CONFLICT (tenant_id, tenant_revision) DO NOTHING;

-- Existing composite revision references are moved to the append-only history
-- table. Single-column tenant ownership FKs remain on brainbase_tenants.
DO $brainbase_revision_fk_migration$
DECLARE
    fk RECORD;
    child_table TEXT;
BEGIN
    FOR fk IN
        SELECT conrelid::regclass AS child_table, conname
          FROM pg_constraint
         WHERE contype = 'f'
           AND confrelid = 'brainbase_tenants'::regclass
           AND array_length(conkey, 1) = 2
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.child_table, fk.conname);
    END LOOP;

    FOREACH child_table IN ARRAY ARRAY[
        'tenant_organizations', 'tenant_memberships', 'tenant_projects',
        'tenant_graph_entities', 'tenant_graph_relations', 'workspace_connections',
        'tenant_contract_revisions', 'tenant_usage_events', 'tenant_operation_receipts',
        'tenant_business_effect_claims', 'tenant_migration_source_rows'
    ] LOOP
        IF EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = child_table
               AND column_name = 'tenant_revision_at_write'
        ) THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', child_table, child_table || '_tenant_revision_history_fk');
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision)',
                child_table, child_table || '_tenant_revision_history_fk'
            );
        END IF;
    END LOOP;
END
$brainbase_revision_fk_migration$;

-- A connection row is the mutable current pointer.  Revision rows are the
-- immutable history and all revision-bearing consumers point at that history.
-- Backfill the current snapshot before moving legacy child FKs so a 1 -> 2
-- pointer update cannot be blocked by a child row that references revision 1.
INSERT INTO workspace_connection_revisions (
    tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
)
SELECT tenant_id, connection_id, connection_revision,
       jsonb_build_object(
           'provider', provider,
           'installation_id', installation_id,
           'workspace_id', workspace_id,
           'app_id', app_id,
           'granted_scopes', granted_scopes,
           'status', status,
           'credential_ref', credential_ref
       ),
       installed_at
  FROM workspace_connections
ON CONFLICT (tenant_id, connection_id, connection_revision) DO NOTHING;

DO $workspace_connection_revision_fk$
DECLARE
    fk RECORD;
    child_table TEXT;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM workspace_connection_revisions revision
          LEFT JOIN workspace_connections connection_row
            ON connection_row.tenant_id = revision.tenant_id
           AND connection_row.connection_id = revision.connection_id
         WHERE connection_row.connection_id IS NULL
    ) THEN
        RAISE EXCEPTION 'workspace connection revision contains an orphan row';
    END IF;

    FOR fk IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'workspace_connection_revisions'::regclass
           AND contype = 'f'
           AND confrelid = 'workspace_connections'::regclass
    LOOP
        EXECUTE format('ALTER TABLE workspace_connection_revisions DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    ALTER TABLE workspace_connection_revisions
        ADD CONSTRAINT workspace_connection_revisions_current_identity_fk
        FOREIGN KEY (tenant_id, connection_id)
        REFERENCES workspace_connections(tenant_id, connection_id);

    FOREACH child_table IN ARRAY ARRAY[
        'credential_broker_refs', 'tenant_credential_leases',
        'tenant_usage_events', 'tenant_operation_receipts',
        'tenant_business_effect_claims'
    ] LOOP
        FOR fk IN
            SELECT conname
              FROM pg_constraint
             WHERE conrelid = child_table::regclass
               AND contype = 'f'
               AND confrelid = 'workspace_connections'::regclass
               AND array_length(conkey, 1) = 3
        LOOP
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', child_table, fk.conname);
        END LOOP;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'credential_broker_refs'::regclass
           AND conname = 'credential_broker_refs_connection_revision_fk'
    ) THEN
        ALTER TABLE credential_broker_refs
            ADD CONSTRAINT credential_broker_refs_connection_revision_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_credential_leases'::regclass
           AND conname = 'tenant_credential_leases_connection_revision_fk'
    ) THEN
        ALTER TABLE tenant_credential_leases
            ADD CONSTRAINT tenant_credential_leases_connection_revision_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_usage_events'::regclass
           AND conname = 'tenant_usage_events_connection_revision_fk'
    ) THEN
        ALTER TABLE tenant_usage_events
            ADD CONSTRAINT tenant_usage_events_connection_revision_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_operation_receipts'::regclass
           AND conname = 'tenant_operation_receipts_connection_revision_fk'
    ) THEN
        ALTER TABLE tenant_operation_receipts
            ADD CONSTRAINT tenant_operation_receipts_connection_revision_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_business_effect_claims'::regclass
           AND conname = 'tenant_business_effect_claims_connection_revision_fk'
    ) THEN
        ALTER TABLE tenant_business_effect_claims
            ADD CONSTRAINT tenant_business_effect_claims_connection_revision_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision);
    END IF;
END
$workspace_connection_revision_fk$;

CREATE OR REPLACE FUNCTION prevent_workspace_connection_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $workspace_connection_revision_immutable$
BEGIN
    RAISE EXCEPTION 'workspace_connection_revisions is append-only';
END
$workspace_connection_revision_immutable$;

DROP TRIGGER IF EXISTS workspace_connection_revisions_immutable ON workspace_connection_revisions;
CREATE TRIGGER workspace_connection_revisions_immutable
    BEFORE UPDATE OR DELETE ON workspace_connection_revisions
    FOR EACH ROW EXECUTE FUNCTION prevent_workspace_connection_revision_mutation();

-- Contract: all connection-revision consumers reference the immutable
-- workspace_connection_revisions history, never the mutable current pointer.
-- The existing credential_ref remains an opaque reference to the secret boundary.

-- Runtime binding is kept separate from the canonical commercial contract row.
-- This preserves the existing tenant_contract_revisions payload while making
-- deployment and protocol capabilities explicit at provisioning time.
CREATE TABLE IF NOT EXISTS tenant_contract_revision_runtime_bindings (
    tenant_id TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    contract_revision BIGINT NOT NULL CHECK (contract_revision > 0),
    capabilities TEXT[] NOT NULL CHECK (cardinality(capabilities) > 0),
    audience TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
    deployment_id TEXT NOT NULL CHECK (deployment_id ~ '^dep_[0-9A-HJKMNP-TV-Z]{26}$'),
    profile TEXT NOT NULL CHECK (profile IN ('shared_cloud', 'dedicated_cloud', 'customer_managed_oss')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, contract_id, contract_revision),
    CONSTRAINT tenant_contract_revision_runtime_bindings_contract_fk
        FOREIGN KEY (tenant_id, contract_id, contract_revision)
        REFERENCES tenant_contract_revisions(tenant_id, contract_id, contract_revision)
);

DO $tenant_contract_revision_runtime_binding_fk$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'tenant_contract_revision_runtime_bindings'::regclass
           AND contype = 'f'
           AND confrelid = 'tenant_contract_revisions'::regclass
           AND array_length(conkey, 1) = 3
    LOOP
        IF fk.conname <> 'tenant_contract_revision_runtime_bindings_contract_fk' THEN
            EXECUTE format('ALTER TABLE tenant_contract_revision_runtime_bindings DROP CONSTRAINT %I', fk.conname);
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'tenant_contract_revision_runtime_bindings'::regclass
           AND conname = 'tenant_contract_revision_runtime_bindings_contract_fk'
    ) THEN
        ALTER TABLE tenant_contract_revision_runtime_bindings
            ADD CONSTRAINT tenant_contract_revision_runtime_bindings_contract_fk
            FOREIGN KEY (tenant_id, contract_id, contract_revision)
            REFERENCES tenant_contract_revisions(tenant_id, contract_id, contract_revision);
    END IF;
END
$tenant_contract_revision_runtime_binding_fk$;

CREATE INDEX IF NOT EXISTS tenant_contract_revision_runtime_bindings_deployment_idx
    ON tenant_contract_revision_runtime_bindings (tenant_id, deployment_id, profile);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_tenant_provider_workspace_app_uq
    ON workspace_connections (tenant_id, provider, workspace_id, app_id)
    WHERE status IN ('pending', 'active');

-- Slack OAuth registration is a control-plane operation.  Only hashes of the
-- state/nonce digests and opaque credential references are stored here; OAuth
-- bearer material never crosses this schema boundary.
ALTER TABLE workspace_connections
    ADD COLUMN IF NOT EXISTS enterprise_id TEXT,
    ADD COLUMN IF NOT EXISTS installer_id TEXT,
    ADD COLUMN IF NOT EXISTS deployment_id TEXT,
    ADD COLUMN IF NOT EXISTS profile TEXT,
    ADD COLUMN IF NOT EXISTS contract_revision TEXT;

DO $workspace_connection_status_migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'workspace_connections'::regclass
           AND conname = 'workspace_connections_status_check'
    ) THEN
        ALTER TABLE workspace_connections DROP CONSTRAINT workspace_connections_status_check;
    END IF;
    ALTER TABLE workspace_connections
        ADD CONSTRAINT workspace_connections_status_check
        CHECK (status IN ('pending', 'active', 'revoked', 'reauth_required', 'uninstalled', 'expired'));
END
$workspace_connection_status_migration$;

DO $workspace_connection_profile_migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'workspace_connections'::regclass
           AND conname = 'workspace_connections_profile_check'
    ) THEN
        ALTER TABLE workspace_connections
            ADD CONSTRAINT workspace_connections_profile_check
            CHECK (profile IS NULL OR profile IN ('shared_cloud', 'dedicated_cloud', 'customer_managed_oss'));
    END IF;
END
$workspace_connection_profile_migration$;

CREATE TABLE IF NOT EXISTS slack_installation_intents (
    installation_intent_id TEXT PRIMARY KEY CHECK (installation_intent_id ~ '^insi_[0-9A-HJKMNP-TV-Z]{26}$'),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    app_id TEXT NOT NULL CHECK (app_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    expected_workspace_id TEXT,
    expected_enterprise_id TEXT,
    initiated_by_principal_id TEXT NOT NULL CHECK (initiated_by_principal_id ~ '^per_[0-9A-HJKMNP-TV-Z]{26}$'),
    expected_connection_revision BIGINT,
    state_hash TEXT CHECK (state_hash IS NULL OR state_hash ~ '^sha256:[a-f0-9]{64}$'),
    nonce_hash TEXT CHECK (nonce_hash IS NULL OR nonce_hash ~ '^sha256:[a-f0-9]{64}$'),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT slack_installation_intents_tenant_revision_history_fk
        FOREIGN KEY (tenant_id, tenant_revision_at_write)
        REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision),
    UNIQUE (state_hash),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + INTERVAL '10 minutes'),
    CHECK (expected_connection_revision IS NULL OR expected_connection_revision > 0),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

DO $slack_installation_intents_revision_fk$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'slack_installation_intents'::regclass
           AND contype = 'f'
           AND confrelid = 'brainbase_tenant_revisions'::regclass
           AND array_length(conkey, 1) = 2
    LOOP
        IF fk.conname <> 'slack_installation_intents_tenant_revision_history_fk' THEN
            EXECUTE format('ALTER TABLE slack_installation_intents DROP CONSTRAINT %I', fk.conname);
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'slack_installation_intents'::regclass
           AND conname = 'slack_installation_intents_tenant_revision_history_fk'
    ) THEN
        ALTER TABLE slack_installation_intents
            ADD CONSTRAINT slack_installation_intents_tenant_revision_history_fk
            FOREIGN KEY (tenant_id, tenant_revision_at_write)
            REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision);
    END IF;
END
$slack_installation_intents_revision_fk$;

CREATE INDEX IF NOT EXISTS slack_installation_intents_tenant_idx
    ON slack_installation_intents (tenant_id, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS slack_installation_exchange_ledger (
    installation_intent_id TEXT PRIMARY KEY
        REFERENCES slack_installation_intents(installation_intent_id),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    connection_id TEXT,
    connection_revision BIGINT,
    response_payload JSONB,
    claim_token_hash TEXT CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^sha256:[a-f0-9]{64}$'),
    claimed_at TIMESTAMPTZ,
    attempt BIGINT NOT NULL DEFAULT 1 CHECK (attempt > 0),
    failure_code TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, installation_intent_id),
    CHECK (status <> 'completed' OR (connection_id IS NOT NULL AND connection_revision IS NOT NULL AND response_payload IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS slack_installation_exchange_ledger_tenant_idx
    ON slack_installation_exchange_ledger (tenant_id, created_at DESC);

-- Existing installations may already have the pre-claim two-state ledger.
-- Expand it in place; claim tokens remain hashes and are cleared at completion
-- or failure, so no OAuth code or bearer secret is retained by this table.
ALTER TABLE slack_installation_exchange_ledger
    ADD COLUMN IF NOT EXISTS claim_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempt BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS failure_code TEXT;

DO $slack_installation_exchange_status_migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'slack_installation_exchange_ledger'::regclass
           AND conname = 'slack_installation_exchange_ledger_status_check'
    ) THEN
        ALTER TABLE slack_installation_exchange_ledger
            DROP CONSTRAINT slack_installation_exchange_ledger_status_check;
    END IF;
    ALTER TABLE slack_installation_exchange_ledger
        ADD CONSTRAINT slack_installation_exchange_ledger_status_check
        CHECK (status IN ('processing', 'completed', 'failed'));
END
$slack_installation_exchange_status_migration$;

CREATE INDEX IF NOT EXISTS slack_installation_exchange_ledger_claim_idx
    ON slack_installation_exchange_ledger (tenant_id, status, claimed_at);

CREATE TABLE IF NOT EXISTS tenant_provisioning_operations (
    operation_id TEXT PRIMARY KEY CHECK (operation_id ~ '^op_[A-Za-z0-9-]{8,128}$'),
    tenant_key TEXT NOT NULL CHECK (tenant_key ~ '^[a-z][a-z0-9-]{1,62}$'),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 3 AND 255),
    desired_state_sha256 TEXT NOT NULL CHECK (desired_state_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('claimed', 'applied', 'failed', 'conflict')),
    actor_principal_id TEXT NOT NULL,
    claim_token_hash TEXT CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^sha256:[a-f0-9]{64}$'),
    claimed_at TIMESTAMPTZ,
    attempt BIGINT NOT NULL DEFAULT 1 CHECK (attempt > 0),
    failure_code TEXT,
    receipt_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (tenant_key, idempotency_key)
);

ALTER TABLE tenant_provisioning_operations
    ADD COLUMN IF NOT EXISTS claim_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attempt BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS failure_code TEXT;

DO $tenant_provisioning_operation_checks$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_provisioning_operations'::regclass
           AND conname = 'tenant_provisioning_operations_claim_token_hash_check'
    ) THEN
        ALTER TABLE tenant_provisioning_operations
            ADD CONSTRAINT tenant_provisioning_operations_claim_token_hash_check
            CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^sha256:[a-f0-9]{64}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'tenant_provisioning_operations'::regclass
           AND conname = 'tenant_provisioning_operations_attempt_check'
    ) THEN
        ALTER TABLE tenant_provisioning_operations
            ADD CONSTRAINT tenant_provisioning_operations_attempt_check
            CHECK (attempt > 0);
    END IF;
END
$tenant_provisioning_operation_checks$;

CREATE INDEX IF NOT EXISTS tenant_provisioning_operations_tenant_status_idx
    ON tenant_provisioning_operations (tenant_key, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS tenant_provisioning_operations_claim_idx
    ON tenant_provisioning_operations (tenant_key, idempotency_key, status, claimed_at);

CREATE TABLE IF NOT EXISTS brainbase_service_actors (
    actor_id TEXT PRIMARY KEY CHECK (actor_id ~ '^[a-z][a-z0-9_-]{2,127}$'),
    tenant_key TEXT NOT NULL CHECK (tenant_key ~ '^[a-z][a-z0-9-]{1,62}$'),
    canonical_project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS brainbase_service_actors_tenant_idx
    ON brainbase_service_actors (tenant_key, canonical_project_id);

CREATE TABLE IF NOT EXISTS brainbase_capabilities (
    capability_id TEXT PRIMARY KEY CHECK (capability_id ~ '^[a-z][a-z0-9_:-]{1,63}$'),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS brainbase_service_actor_capabilities (
    actor_id TEXT NOT NULL REFERENCES brainbase_service_actors(actor_id),
    capability_id TEXT NOT NULL REFERENCES brainbase_capabilities(capability_id),
    tenant_key TEXT NOT NULL CHECK (tenant_key ~ '^[a-z][a-z0-9-]{1,62}$'),
    granted_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (actor_id, capability_id, tenant_key)
);

ALTER TABLE brainbase_service_actor_capabilities
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $brainbase_service_actor_capability_checks$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'brainbase_service_actor_capabilities'::regclass
           AND conname = 'brainbase_service_actor_capabilities_status_check'
    ) THEN
        ALTER TABLE brainbase_service_actor_capabilities
            ADD CONSTRAINT brainbase_service_actor_capabilities_status_check
            CHECK (status IN ('active', 'revoked'));
    END IF;
END
$brainbase_service_actor_capability_checks$;

CREATE INDEX IF NOT EXISTS brainbase_service_actor_capabilities_tenant_idx
    ON brainbase_service_actor_capabilities (tenant_key, actor_id);

-- Only public verification material belongs in the control plane. Private key
-- material stays in the configured secret boundary and is never provisioned here.
CREATE TABLE IF NOT EXISTS brainbase_service_actor_keys (
    actor_id TEXT NOT NULL REFERENCES brainbase_service_actors(actor_id),
    kid TEXT NOT NULL,
    public_jwk JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (actor_id, kid),
    CHECK (public_jwk ? 'kty'),
    CHECK (public_jwk ? 'kid')
);

CREATE OR REPLACE VIEW brainbase_service_actor_jwks AS
SELECT actor_id,
       jsonb_build_object(
           'keys', jsonb_agg(public_jwk ORDER BY kid)
       ) AS jwks
  FROM brainbase_service_actor_keys
 WHERE status = 'active'
 GROUP BY actor_id;
