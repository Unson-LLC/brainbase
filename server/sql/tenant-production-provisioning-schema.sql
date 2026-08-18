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

DO $workspace_connection_revision_fk$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM workspace_connection_revisions revision
          LEFT JOIN workspace_connections connection_row
            ON connection_row.tenant_id = revision.tenant_id
           AND connection_row.connection_id = revision.connection_id
           AND connection_row.connection_revision = revision.connection_revision
         WHERE connection_row.connection_id IS NULL
    ) THEN
        RAISE EXCEPTION 'workspace connection revision contains an orphan row';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'workspace_connection_revisions'::regclass
           AND contype = 'f'
           AND confrelid = 'workspace_connections'::regclass
    ) THEN
        ALTER TABLE workspace_connection_revisions
            ADD CONSTRAINT workspace_connection_revisions_parent_fk
            FOREIGN KEY (tenant_id, connection_id, connection_revision)
            REFERENCES workspace_connections(tenant_id, connection_id, connection_revision);
    END IF;
END
$workspace_connection_revision_fk$;

-- Contract: FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision).
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
    FOREIGN KEY (tenant_id, contract_id, contract_revision)
        REFERENCES tenant_contract_revisions(tenant_id, contract_id, contract_revision)
);

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
    FOREIGN KEY (tenant_id, tenant_revision_at_write)
        REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision),
    UNIQUE (state_hash),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + INTERVAL '10 minutes'),
    CHECK (expected_connection_revision IS NULL OR expected_connection_revision > 0),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS slack_installation_intents_tenant_idx
    ON slack_installation_intents (tenant_id, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS slack_installation_exchange_ledger (
    installation_intent_id TEXT PRIMARY KEY
        REFERENCES slack_installation_intents(installation_intent_id),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    connection_id TEXT,
    connection_revision BIGINT,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, installation_intent_id),
    CHECK (status <> 'completed' OR (connection_id IS NOT NULL AND connection_revision IS NOT NULL AND response_payload IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS slack_installation_exchange_ledger_tenant_idx
    ON slack_installation_exchange_ledger (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_provisioning_operations (
    operation_id TEXT PRIMARY KEY CHECK (operation_id ~ '^op_[A-Za-z0-9-]{8,128}$'),
    tenant_key TEXT NOT NULL CHECK (tenant_key ~ '^[a-z][a-z0-9-]{1,62}$'),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 3 AND 255),
    desired_state_sha256 TEXT NOT NULL CHECK (desired_state_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('claimed', 'applied', 'failed', 'conflict')),
    actor_principal_id TEXT NOT NULL,
    receipt_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE (tenant_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tenant_provisioning_operations_tenant_status_idx
    ON tenant_provisioning_operations (tenant_key, status, updated_at DESC);

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
    PRIMARY KEY (actor_id, capability_id, tenant_key)
);

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
