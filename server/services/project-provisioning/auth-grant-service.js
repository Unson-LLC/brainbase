export class AuthGrantService {
    constructor({ pool }) {
        if (!pool) throw new Error('AuthGrantService requires PostgreSQL');
        this.pool = pool;
    }

    async addProjectGrant({
        personId, role, projectCode, organizationId, slackUserId = null, slackWorkspaceId = null
    }) {
        if (Boolean(slackUserId) !== Boolean(slackWorkspaceId)) {
            const error = new Error('Slack user and workspace must be provided together');
            error.code = 'PROJECT_PROVISIONING_SLACK_IDENTITY_INCOMPLETE';
            error.statusCode = 400;
            throw error;
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const exactSlackIdentity = slackUserId && slackWorkspaceId;
            const { rows } = await client.query(
                `SELECT ag.id, ag.person_id, ag.role, ag.project_codes FROM auth_grants ag
                 WHERE ag.person_id=$1 AND ag.organization_id=$2
                   ${exactSlackIdentity ? 'AND ag.slack_user_id=$3 AND ag.slack_workspace_id=$4' : ''}
                   AND ag.active=true FOR UPDATE`,
                exactSlackIdentity
                    ? [personId, organizationId, slackUserId, slackWorkspaceId]
                    : [personId, organizationId]
            );
            const matching = rows.filter((row) => row.role === role);
            if (matching.length > 1) {
                const error = new Error(`Multiple active ${role} auth grants exist for ${personId}`);
                error.code = 'PROJECT_PROVISIONING_AUTH_GRANT_AMBIGUOUS';
                error.statusCode = 409;
                throw error;
            }
            const grant = matching[0];
            if (!grant) {
                const error = new Error(`Active ${role} auth grant is missing for ${personId}`);
                error.code = 'PROJECT_PROVISIONING_AUTH_GRANT_MISSING';
                error.statusCode = 409;
                throw error;
            }
            const projectCodes = [...new Set([...(grant.project_codes || []), projectCode])].sort();
            const updated = await client.query(
                `UPDATE auth_grants SET project_codes=$2, updated_at=now() WHERE id=$1
                 RETURNING id, person_id, role, project_codes`, [grant.id, projectCodes]
            );
            await client.query('COMMIT');
            return { ...updated.rows[0], jwt_refresh_required: true, selector_project_code: projectCode };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async readProjectGrant({
        personId, role, projectCode, organizationId, slackUserId = null, slackWorkspaceId = null
    }) {
        if (Boolean(slackUserId) !== Boolean(slackWorkspaceId)) return null;
        const exactSlackIdentity = slackUserId && slackWorkspaceId;
        const { rows } = await this.pool.query(
            `SELECT ag.id, ag.person_id, ag.role, ag.project_codes
             FROM auth_grants ag
             WHERE ag.person_id=$1 AND ag.role=$2 AND ag.organization_id=$3
               ${exactSlackIdentity ? 'AND ag.slack_user_id=$4 AND ag.slack_workspace_id=$5' : ''}
               AND ag.active=true`,
            exactSlackIdentity
                ? [personId, role, organizationId, slackUserId, slackWorkspaceId]
                : [personId, role, organizationId]
        );
        const grant = rows.length === 1 ? rows[0] : null;
        return grant && (grant.project_codes || []).includes(projectCode) ? grant : null;
    }
}
