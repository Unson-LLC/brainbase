CREATE TABLE IF NOT EXISTS brainbase_schema_migrations (
    migration_id TEXT PRIMARY KEY,
    schema_sha256 TEXT NOT NULL CHECK (schema_sha256 ~ '^[a-f0-9]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL,
    applied_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brainbase_tenants (
    tenant_id TEXT PRIMARY KEY CHECK (tenant_id ~ '^ten_[0-9A-HJKMNP-TV-Z]{26}$'),
    tenant_revision BIGINT NOT NULL CHECK (tenant_revision > 0),
    status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'deletion_pending', 'deleted')),
    display_name TEXT NOT NULL,
    suspension_reason_code TEXT,
    deletion_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, tenant_revision)
);

CREATE TABLE IF NOT EXISTS tenant_organizations (
    organization_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    organization_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (tenant_id, organization_id)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    membership_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    organization_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    membership_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    FOREIGN KEY (tenant_id, organization_id) REFERENCES tenant_organizations(tenant_id, organization_id)
);

CREATE TABLE IF NOT EXISTS tenant_projects (
    project_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    project_code TEXT NOT NULL,
    project_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (tenant_id, project_code)
);

CREATE TABLE IF NOT EXISTS tenant_graph_entities (
    entity_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    entity_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (tenant_id, entity_id)
);

CREATE TABLE IF NOT EXISTS tenant_graph_relations (
    relation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    relation_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    FOREIGN KEY (tenant_id, source_entity_id) REFERENCES tenant_graph_entities(tenant_id, entity_id),
    FOREIGN KEY (tenant_id, target_entity_id) REFERENCES tenant_graph_entities(tenant_id, entity_id)
);

CREATE TABLE IF NOT EXISTS workspace_connections (
    connection_id TEXT PRIMARY KEY CHECK (connection_id ~ '^wsc_[0-9A-HJKMNP-TV-Z]{26}$'),
    connection_revision BIGINT NOT NULL CHECK (connection_revision > 0),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    provider TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    granted_scopes TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
    credential_ref TEXT NOT NULL,
    installed_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    supersedes_connection_revision BIGINT,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (tenant_id, connection_id),
    UNIQUE (tenant_id, connection_id, connection_revision)
);

CREATE TABLE IF NOT EXISTS workspace_connection_revisions (
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL,
    connection_snapshot JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, connection_id, connection_revision)
);

CREATE TABLE IF NOT EXISTS credential_broker_refs (
    credential_ref TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL,
    credential_mode TEXT NOT NULL CHECK (credential_mode IN ('cloud_standard', 'customer_oauth', 'customer_api')),
    refresh_revision BIGINT NOT NULL CHECK (refresh_revision > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision)
);

CREATE TABLE IF NOT EXISTS tenant_credential_leases (
    lease_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL CHECK (connection_revision > 0),
    credential_ref TEXT NOT NULL REFERENCES credential_broker_refs(credential_ref),
    credential_mode TEXT NOT NULL CHECK (credential_mode IN ('cloud_standard', 'customer_oauth', 'customer_api')),
    contract_revision TEXT NOT NULL CHECK (contract_revision ~ '^(0|[1-9][0-9]*)$'),
    operation_id TEXT NOT NULL,
    audience TEXT NOT NULL,
    provider TEXT NOT NULL,
    lease_token_digest TEXT NOT NULL CHECK (lease_token_digest ~ '^sha256:[a-f0-9]{64}$'),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses SMALLINT NOT NULL CHECK (max_uses = 1),
    consumed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, lease_id),
    FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + INTERVAL '60 seconds'),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE TABLE IF NOT EXISTS tenant_contract_revisions (
    contract_id TEXT NOT NULL CHECK (contract_id ~ '^ctr_[0-9A-HJKMNP-TV-Z]{26}$'),
    contract_revision BIGINT NOT NULL CHECK (contract_revision > 0),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'expired', 'superseded')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    plan_code TEXT NOT NULL,
    allowances JSONB NOT NULL,
    thresholds_basis_points INTEGER[] NOT NULL,
    overage_policy TEXT NOT NULL CHECK (overage_policy IN ('deny', 'allow_and_bill', 'allow_with_approval')),
    hard_stop_basis_points INTEGER NOT NULL,
    rate_card_revision BIGINT NOT NULL,
    fx_table_revision BIGINT NOT NULL,
    sales_price_revision BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, contract_id, contract_revision),
    UNIQUE (tenant_id, contract_revision),
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
);

CREATE TABLE IF NOT EXISTS tenant_quota_decisions (
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    contract_revision TEXT NOT NULL,
    quota_revision TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^ik1_[A-Za-z0-9_-]{43}$'),
    metric TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'warning', 'hard_stopped', 'approval_required', 'unavailable')),
    limit_value NUMERIC,
    used_value NUMERIC,
    remaining_value NUMERIC,
    unit TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    window_ends_at TIMESTAMPTZ NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL,
    failure_code TEXT,
    decision_payload JSONB NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key),
    CHECK (window_ends_at > window_started_at),
    CHECK ((decision = 'unavailable' AND limit_value IS NULL AND used_value IS NULL AND remaining_value IS NULL)
        OR (decision <> 'unavailable' AND limit_value >= 0 AND used_value >= 0 AND remaining_value >= 0))
);

CREATE TABLE IF NOT EXISTS tenant_usage_events (
    usage_event_id TEXT PRIMARY KEY CHECK (usage_event_id ~ '^usage_[0-9A-HJKMNP-TV-Z]{26}$'),
    protocol_version TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL,
    contract_revision TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    quantity NUMERIC,
    unit TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out')),
    collection_state TEXT NOT NULL CHECK (collection_state IN ('collected', 'partial', 'not_collected')),
    failure_code TEXT,
    unknown_fields TEXT[] NOT NULL DEFAULT '{}',
    observed_at TIMESTAMPTZ NOT NULL,
    event_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision),
    CHECK ((collection_state = 'not_collected' AND quantity IS NULL) OR collection_state <> 'not_collected')
);

CREATE INDEX IF NOT EXISTS tenant_usage_events_business_effect_idx
    ON tenant_usage_events (tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS tenant_operation_receipts (
    receipt_id TEXT PRIMARY KEY CHECK (receipt_id ~ '^receipt_[0-9A-HJKMNP-TV-Z]{26}$'),
    protocol_version TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL,
    contract_revision TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    operation_ids TEXT[] NOT NULL,
    idempotency_keys TEXT[] NOT NULL,
    actor_principal_id TEXT NOT NULL,
    project_id TEXT,
    capability_id TEXT NOT NULL,
    quota_decision TEXT NOT NULL CHECK (quota_decision IN ('allowed', 'warning', 'hard_stopped', 'approval_required', 'unavailable')),
    credential_mode TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out')),
    collection_state TEXT NOT NULL CHECK (collection_state IN ('collected', 'partial', 'not_collected')),
    failure_code TEXT,
    usage_event_ids TEXT[] NOT NULL DEFAULT '{}',
    reply JSONB NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    receipt_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision),
    UNIQUE (tenant_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS tenant_receipt_pricing_snapshots (
    receipt_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    rate_card_revision TEXT NOT NULL CHECK (rate_card_revision ~ '^(0|[1-9][0-9]*)$'),
    fx_table_revision TEXT NOT NULL CHECK (fx_table_revision ~ '^(0|[1-9][0-9]*)$'),
    sales_price_revision TEXT NOT NULL CHECK (sales_price_revision ~ '^(0|[1-9][0-9]*)$'),
    purchase_currency TEXT NOT NULL CHECK (purchase_currency ~ '^[A-Z]{3}$'),
    purchase_minor_units BIGINT CHECK (purchase_minor_units >= 0),
    billing_currency TEXT NOT NULL CHECK (billing_currency ~ '^[A-Z]{3}$'),
    billing_minor_units BIGINT CHECK (billing_minor_units >= 0),
    fx_rate_decimal NUMERIC NOT NULL CHECK (fx_rate_decimal > 0),
    effective_at TIMESTAMPTZ NOT NULL,
    pricing_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, receipt_id) REFERENCES tenant_operation_receipts(tenant_id, receipt_id),
    UNIQUE (tenant_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS tenant_business_effect_claims (
    idempotency_key TEXT PRIMARY KEY CHECK (idempotency_key ~ '^ik1_[A-Za-z0-9_-]{43}$'),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    connection_id TEXT NOT NULL,
    connection_revision BIGINT NOT NULL,
    operation_id TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type = 'idempotency_claim'),
    owner TEXT NOT NULL CHECK (owner IN ('brainbase', 'mana_runtime')),
    scope TEXT NOT NULL CHECK (scope IN ('credential_lease', 'quota_decision', 'business_effect', 'usage_receipt', 'queue_execution', 'slack_delivery')),
    slack_event_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    context_hash TEXT NOT NULL,
    claim_state TEXT NOT NULL CHECK (claim_state IN ('pending', 'claimed', 'succeeded', 'failed_terminal')),
    claimed_at TIMESTAMPTZ NOT NULL,
    retain_until TIMESTAMPTZ NOT NULL,
    claim_payload JSONB NOT NULL,
    CHECK (retain_until >= claimed_at + INTERVAL '30 days'),
    FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connections(tenant_id, connection_id, connection_revision)
);

CREATE TABLE IF NOT EXISTS tenant_migrations (
    migration_id TEXT PRIMARY KEY CHECK (migration_id ~ '^mig_[0-9A-HJKMNP-TV-Z]{26}$'),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    source_snapshot TEXT NOT NULL,
    mapping_rule_revision BIGINT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply', 'rollback')),
    counts JSONB NOT NULL,
    collection_state TEXT NOT NULL CHECK (collection_state IN ('collected', 'partial', 'not_collected')),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, migration_id)
);

CREATE TABLE IF NOT EXISTS tenant_migration_quarantine (
    migration_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('ambiguous', 'unowned', 'failed', 'apply_conflict', 'rollback_conflict')),
    source_snapshot JSONB NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (migration_id, source_id),
    FOREIGN KEY (tenant_id, migration_id) REFERENCES tenant_migrations(tenant_id, migration_id)
);

CREATE TABLE IF NOT EXISTS tenant_migration_source_rows (
    source_id TEXT PRIMARY KEY,
    source_revision BIGINT NOT NULL CHECK (source_revision > 0),
    tenant_id TEXT,
    tenant_revision_at_write BIGINT,
    source_payload JSONB NOT NULL,
    applied_migration_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((tenant_id IS NULL AND tenant_revision_at_write IS NULL AND applied_migration_id IS NULL)
        OR (tenant_id IS NOT NULL AND tenant_revision_at_write IS NOT NULL AND applied_migration_id IS NOT NULL)),
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    FOREIGN KEY (tenant_id, applied_migration_id) REFERENCES tenant_migrations(tenant_id, migration_id)
);

ALTER TABLE tenant_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_connection_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_broker_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_credential_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contract_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_receipt_pricing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_business_effect_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migration_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migration_source_rows ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenant_organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_connection_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE credential_broker_refs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_credential_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_contract_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_operation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_receipt_pricing_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_business_effect_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_migrations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_migration_quarantine FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_migration_source_rows FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION brainbase_current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$ SELECT current_setting('brainbase.tenant_id', true) $$;

DO $brainbase_multitenant_rls$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'tenant_organizations', 'tenant_memberships', 'tenant_projects',
        'tenant_graph_entities', 'tenant_graph_relations', 'workspace_connections',
        'workspace_connection_revisions', 'credential_broker_refs', 'tenant_credential_leases',
        'tenant_contract_revisions', 'tenant_quota_decisions',
        'tenant_usage_events', 'tenant_operation_receipts', 'tenant_receipt_pricing_snapshots', 'tenant_business_effect_claims',
        'tenant_migrations', 'tenant_migration_quarantine'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''brainbase.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''brainbase.tenant_id'', true))',
            table_name
        );
    END LOOP;
END
$brainbase_multitenant_rls$;

DROP POLICY IF EXISTS tenant_migration_source_isolation ON tenant_migration_source_rows;
CREATE POLICY tenant_migration_source_isolation ON tenant_migration_source_rows
    USING (
        tenant_id = current_setting('brainbase.tenant_id', true)
        OR (current_setting('brainbase.migration_mode', true) = 'on' AND tenant_id IS NULL)
    )
    WITH CHECK (
        tenant_id = current_setting('brainbase.tenant_id', true)
        OR (current_setting('brainbase.migration_mode', true) = 'on' AND tenant_id IS NULL)
    );
