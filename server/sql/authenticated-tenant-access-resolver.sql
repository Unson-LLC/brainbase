CREATE OR REPLACE FUNCTION public.resolve_active_tenant_for_authenticated_access(
    requested_organization_id TEXT,
    requested_person_id TEXT,
    requested_slack_user_id TEXT,
    requested_slack_workspace_id TEXT
)
RETURNS TABLE (tenant_id TEXT, organization_id TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $$
    WITH candidates AS (
        SELECT DISTINCT organization.tenant_id
          FROM public.tenant_organizations AS organization
          JOIN public.brainbase_tenants AS tenant
            ON tenant.tenant_id = organization.tenant_id
          JOIN public.tenant_memberships AS membership
            ON membership.tenant_id = organization.tenant_id
           AND membership.principal_id = requested_person_id
          JOIN public.workspace_connections AS connection
            ON connection.tenant_id = organization.tenant_id
           AND connection.provider = 'slack'
           AND connection.workspace_id = requested_slack_workspace_id
           AND connection.status = 'active'
         WHERE tenant.status = 'active'
           AND membership.membership_payload ->> 'status' = 'active'
           AND membership.membership_payload ->> 'slack_user_id' = requested_slack_user_id
           AND membership.membership_payload ->> 'slack_workspace_id' = requested_slack_workspace_id
           AND (
               organization.organization_id = requested_organization_id
               OR organization.organization_payload ->> 'graph_organization_id' = requested_organization_id
           )
    )
    SELECT candidate.tenant_id, requested_organization_id AS organization_id
      FROM candidates AS candidate
     WHERE (SELECT count(*) FROM candidates) = 1
$$;

DO $brainbase_authenticated_tenant_resolver_role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_authenticated_tenant_resolver') THEN
        CREATE ROLE brainbase_authenticated_tenant_resolver NOLOGIN NOSUPERUSER BYPASSRLS;
    END IF;
END
$brainbase_authenticated_tenant_resolver_role$;

ALTER ROLE brainbase_authenticated_tenant_resolver NOLOGIN NOSUPERUSER BYPASSRLS;
GRANT USAGE ON SCHEMA public TO brainbase_authenticated_tenant_resolver;
GRANT SELECT ON TABLE
    public.brainbase_tenants,
    public.tenant_organizations,
    public.tenant_memberships,
    public.workspace_connections
TO brainbase_authenticated_tenant_resolver;

ALTER FUNCTION public.resolve_active_tenant_for_authenticated_access(TEXT, TEXT, TEXT, TEXT)
    OWNER TO brainbase_authenticated_tenant_resolver;

REVOKE ALL ON FUNCTION public.resolve_active_tenant_for_authenticated_access(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
DO $brainbase_authenticated_tenant_resolver_grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brainbase_app') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_active_tenant_for_authenticated_access(TEXT, TEXT, TEXT, TEXT) TO brainbase_app';
    END IF;
END
$brainbase_authenticated_tenant_resolver_grant$;
