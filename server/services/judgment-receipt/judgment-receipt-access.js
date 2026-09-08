import { requireCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

function denied() {
    const error = new Error('The authenticated actor cannot access this judgment receipt');
    error.code = 'judgment_receipt_access_denied';
    error.status = 403;
    return error;
}

/** Select an existing grant for this receipt only; never change the session actor. */
export function createJudgmentReceiptAccessResolver({ authService }) {
    return async ({ access, projectCode, authSource }) => {
        const currentOrganization = requireCanonicalTenantIdentity(access);
        if (!access.personId || !access.projectCodes?.includes(projectCode)) throw denied();
        const { rows: projects } = await authService.pool.query(
            'SELECT organization_id FROM projects WHERE code = $1', [projectCode]
        );
        if (projects.length !== 1 || !projects[0].organization_id) throw denied();
        const organizationId = projects[0].organization_id;
        if (organizationId === currentOrganization) return access;
        if (authSource !== 'bearer' || !access.slackUserId || !access.slackWorkspaceId) throw denied();

        const { rows: grants } = await authService.pool.query(`
            SELECT * FROM auth_grants
            WHERE organization_id = $1 AND slack_user_id = $2
              AND slack_workspace_id = $3 AND person_id = $4
              AND active = true AND $5 = ANY(project_codes)
        `, [organizationId, access.slackUserId, access.slackWorkspaceId, access.personId, projectCode]);
        if (grants.length !== 1) throw denied();
        const granted = authService.buildAccessFromGrant(grants[0]);
        const role = authService.getRoleRank(access.role) <= authService.getRoleRank(granted.role)
            ? authService.normalizeRole(access.role) : granted.role;
        const clearance = (access.clearance || []).filter(value => granted.clearance.includes(value));
        return {
            personId: access.personId, role, projectCodes: [projectCode], clearance,
            organizationId, tenantId: organizationId,
            slackUserId: access.slackUserId, slackWorkspaceId: access.slackWorkspaceId
        };
    };
}
