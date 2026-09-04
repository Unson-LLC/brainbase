CREATE TABLE IF NOT EXISTS company_external_identities (
    identity_id TEXT PRIMARY KEY,
    identity_revision BIGINT NOT NULL CHECK (identity_revision > 0),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('slack', 'codex', 'claude_code', 'service')),
    authenticated_subject_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    membership_id TEXT NOT NULL REFERENCES tenant_memberships(membership_id),
    project_id TEXT NOT NULL REFERENCES tenant_projects(project_id),
    placement_id TEXT NOT NULL,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('person', 'service')),
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write)
        REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    UNIQUE (
        tenant_id, provider, workspace_id, app_id,
        authenticated_subject_id, project_id, identity_revision
    )
);

CREATE INDEX IF NOT EXISTS company_external_identities_lookup_idx
    ON company_external_identities (
        tenant_id, provider, workspace_id, app_id,
        authenticated_subject_id, status, project_id
    );

CREATE TABLE IF NOT EXISTS company_authority_bindings (
    binding_id TEXT PRIMARY KEY,
    binding_revision BIGINT NOT NULL CHECK (binding_revision > 0),
    tenant_id TEXT NOT NULL REFERENCES brainbase_tenants(tenant_id),
    tenant_revision_at_write BIGINT NOT NULL,
    membership_id TEXT NOT NULL REFERENCES tenant_memberships(membership_id),
    organization_id TEXT NOT NULL REFERENCES tenant_organizations(organization_id),
    project_id TEXT NOT NULL REFERENCES tenant_projects(project_id),
    resource_ref TEXT NOT NULL,
    resource_revision TEXT NOT NULL CHECK (resource_revision ~ '^(0|[1-9][0-9]*)$'),
    capability_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('auto', 'approval', 'human_action', 'deny')),
    allowed_effects TEXT[] NOT NULL CHECK (cardinality(allowed_effects) > 0),
    responsible_person_id TEXT,
    accountable_person_id TEXT,
    approver_person_id TEXT,
    delegated_by_person_id TEXT,
    policy_revision TEXT NOT NULL CHECK (policy_revision ~ '^(0|[1-9][0-9]*)$'),
    raci_revision TEXT NOT NULL CHECK (raci_revision ~ '^(0|[1-9][0-9]*)$'),
    stop_conditions TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'revoked')),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (tenant_id, tenant_revision_at_write)
        REFERENCES brainbase_tenants(tenant_id, tenant_revision),
    CHECK (allowed_effects <@ ARRAY['read', 'write', 'external_side_effect']::TEXT[]),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (decision <> 'approval' OR approver_person_id IS NOT NULL),
    CHECK (decision <> 'human_action' OR responsible_person_id IS NOT NULL),
    UNIQUE (
        tenant_id, membership_id, organization_id, project_id,
        resource_ref, capability_id, binding_revision
    )
);

CREATE INDEX IF NOT EXISTS company_authority_bindings_lookup_idx
    ON company_authority_bindings (
        tenant_id, membership_id, organization_id, project_id,
        resource_ref, capability_id, status
    );

ALTER TABLE company_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_authority_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_external_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE company_authority_bindings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_external_identities_tenant_policy
    ON company_external_identities;
CREATE POLICY company_external_identities_tenant_policy
    ON company_external_identities
    USING (tenant_id = current_setting('brainbase.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('brainbase.tenant_id', true));

DROP POLICY IF EXISTS company_authority_bindings_tenant_policy
    ON company_authority_bindings;
CREATE POLICY company_authority_bindings_tenant_policy
    ON company_authority_bindings
    USING (tenant_id = current_setting('brainbase.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('brainbase.tenant_id', true));

CREATE OR REPLACE FUNCTION public.resolve_company_authority_route(
    requested_provider TEXT,
    requested_subject_id TEXT,
    requested_workspace_id TEXT,
    requested_app_id TEXT,
    requested_enterprise_id TEXT,
    requested_project_hint TEXT
) RETURNS TABLE (
    tenant_id TEXT,
    tenant_revision BIGINT,
    connection_id TEXT,
    connection_revision BIGINT,
    workspace_id TEXT,
    app_id TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $$
    SELECT identity.tenant_id,
           tenant.tenant_revision,
           connection.connection_id,
           connection.connection_revision,
           connection.workspace_id,
           connection.app_id
      FROM public.company_external_identities AS identity
      JOIN public.brainbase_tenants AS tenant
        ON tenant.tenant_id = identity.tenant_id
      JOIN public.workspace_connections AS connection
        ON connection.tenant_id = identity.tenant_id
       AND connection.provider = identity.provider
       AND connection.workspace_id = identity.workspace_id
       AND connection.app_id = identity.app_id
      JOIN public.tenant_memberships AS membership
        ON membership.tenant_id = identity.tenant_id
       AND membership.membership_id = identity.membership_id
      JOIN public.tenant_projects AS project
        ON project.tenant_id = identity.tenant_id
       AND project.project_id = identity.project_id
     WHERE identity.provider = requested_provider
       AND identity.authenticated_subject_id = requested_subject_id
       AND identity.status = 'active'
       AND tenant.status = 'active'
       AND connection.status = 'active'
       AND membership.membership_payload->>'status' = 'active'
       AND (requested_workspace_id IS NULL OR identity.workspace_id = requested_workspace_id)
       AND (requested_app_id IS NULL OR identity.app_id = requested_app_id)
       AND (requested_enterprise_id IS NULL OR connection.enterprise_id = requested_enterprise_id)
       AND (requested_project_hint IS NULL
            OR project.project_id = requested_project_hint
            OR project.project_code = requested_project_hint)
     ORDER BY identity.identity_revision DESC
     LIMIT 2
$$;

REVOKE ALL ON FUNCTION public.resolve_company_authority_route(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC;

DO $company_authority_runtime_grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_app') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_company_authority_route(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO brainbase_app';
    END IF;
END
$company_authority_runtime_grant$;
