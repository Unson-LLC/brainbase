export class AuthGrantService {
    constructor({ pool }) {
        if (!pool) throw new Error('AuthGrantService requires PostgreSQL');
        this.pool = pool;
    }

    async addProjectGrant({ personId, role, projectCode, organizationId }) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `SELECT ag.id, ag.person_id, ag.role, ag.project_codes FROM auth_grants ag
                 WHERE ag.person_id=$1 AND ag.organization_id=$2 AND ag.active=true FOR UPDATE`,
                [personId, organizationId]
            );
            const grant = rows.find((row) => row.role === role);
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

    async readProjectGrant({ personId, role, projectCode, organizationId }) {
        const { rows } = await this.pool.query(
            `SELECT ag.id, ag.person_id, ag.role, ag.project_codes
             FROM auth_grants ag
             WHERE ag.person_id=$1 AND ag.role=$2 AND ag.organization_id=$3 AND ag.active=true`,
            [personId, role, organizationId]
        );
        const grant = rows[0] || null;
        return grant && (grant.project_codes || []).includes(projectCode) ? grant : null;
    }
}
