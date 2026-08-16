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
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    membership_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    organization_id TEXT NOT NULL REFERENCES tenant_organizations(organization_id),
    principal_id TEXT NOT NULL,
    membership_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
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
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
);

CREATE TABLE IF NOT EXISTS tenant_graph_relations (
    relation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    source_entity_id TEXT NOT NULL REFERENCES tenant_graph_entities(entity_id),
    target_entity_id TEXT NOT NULL REFERENCES tenant_graph_entities(entity_id),
    relation_payload JSONB NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
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
    connection_id TEXT NOT NULL REFERENCES workspace_connections(connection_id),
    connection_revision BIGINT NOT NULL,
    credential_mode TEXT NOT NULL CHECK (credential_mode IN ('cloud_standard', 'customer_oauth', 'customer_api')),
    refresh_revision BIGINT NOT NULL CHECK (refresh_revision > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
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
    PRIMARY KEY (tenant_id, contract_id, contract_revision),
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision)
);

CREATE TABLE IF NOT EXISTS tenant_usage_events (
    usage_event_id TEXT PRIMARY KEY CHECK (usage_event_id ~ '^use_[0-9A-HJKMNP-TV-Z]{26}$'),
    protocol_version TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    connection_id TEXT NOT NULL REFERENCES workspace_connections(connection_id),
    connection_revision BIGINT NOT NULL,
    contract_revision TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ai', 'tool', 'container', 'storage', 'retry', 'external_api')),
    quantity NUMERIC,
    unit TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out')),
    collection_state TEXT NOT NULL CHECK (collection_state IN ('collected', 'partial', 'not_collected')),
    failure_code TEXT,
    observed_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (tenant_id, idempotency_key),
    CHECK ((collection_state = 'not_collected' AND quantity IS NULL) OR collection_state <> 'not_collected')
);

CREATE TABLE IF NOT EXISTS tenant_operation_receipts (
    receipt_id TEXT PRIMARY KEY CHECK (receipt_id ~ '^rcp_[0-9A-HJKMNP-TV-Z]{26}$'),
    protocol_version TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    connection_id TEXT NOT NULL REFERENCES workspace_connections(connection_id),
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
    observed_units NUMERIC,
    unknown_fields TEXT[] NOT NULL DEFAULT '{}',
    failure_code TEXT,
    pricing_snapshot JSONB NOT NULL,
    finalized_at TIMESTAMPTZ NOT NULL,
    corrects_receipt_id TEXT REFERENCES tenant_operation_receipts(receipt_id),
    FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    CHECK ((collection_state = 'not_collected' AND observed_units IS NULL) OR collection_state <> 'not_collected')
);

CREATE TABLE IF NOT EXISTS tenant_business_effect_claims (
    idempotency_key TEXT PRIMARY KEY CHECK (idempotency_key ~ '^ik1_[A-Za-z0-9_-]{43}$'),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    connection_id TEXT NOT NULL REFERENCES workspace_connections(connection_id),
    operation_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    context_hash TEXT NOT NULL,
    claim_state TEXT NOT NULL CHECK (claim_state IN ('pending', 'claimed', 'succeeded', 'failed_terminal')),
    claimed_at TIMESTAMPTZ NOT NULL,
    retain_until TIMESTAMPTZ NOT NULL,
    CHECK (retain_until >= claimed_at + INTERVAL '30 days')
);

CREATE TABLE IF NOT EXISTS tenant_migrations (
    migration_id TEXT PRIMARY KEY CHECK (migration_id ~ '^mig_[0-9A-HJKMNP-TV-Z]{26}$'),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    source_snapshot TEXT NOT NULL,
    mapping_rule_revision BIGINT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'apply', 'rollback')),
    counts JSONB NOT NULL,
    collection_state TEXT NOT NULL CHECK (collection_state IN ('collected', 'partial', 'not_collected')),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_migration_quarantine (
    migration_id TEXT NOT NULL REFERENCES tenant_migrations(migration_id),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('ambiguous', 'unowned', 'failed', 'apply_conflict', 'rollback_conflict')),
    source_snapshot JSONB NOT NULL,
    quarantined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (migration_id, source_id)
);

ALTER TABLE tenant_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_connection_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_broker_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_contract_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_business_effect_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_migration_quarantine ENABLE ROW LEVEL SECURITY;

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
        'workspace_connection_revisions', 'credential_broker_refs', 'tenant_contract_revisions',
        'tenant_usage_events', 'tenant_operation_receipts', 'tenant_business_effect_claims',
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
