import crypto from 'crypto';

function parse(row) {
    return row ? { ...row, plan: row.plan || {}, manifest: row.manifest || {}, steps: row.steps || [] } : null;
}

function organizationIdFrom(actor) {
    const organizationId = String(actor?.organizationId || actor?.tenantId || '').trim();
    if (!organizationId) throw new Error('Project Provisioning run requires organizationId');
    return organizationId;
}

function graphAccessFrom(actor, organizationId) {
    return {
        ...actor,
        role: actor?.role || 'member',
        projectCodes: Array.isArray(actor?.projectCodes) ? actor.projectCodes : [],
        clearance: Array.isArray(actor?.clearance) ? actor.clearance : [],
        organizationId
    };
}

function staleExecutionError(runId) {
    const error = new Error(`Provisioning run execution lease was lost: ${runId}`);
    error.code = 'PROJECT_PROVISIONING_EXECUTION_LEASE_LOST';
    error.statusCode = 409;
    return error;
}

export class PgProjectProvisioningRepository {
    constructor({ pool, infoSSOTService = null }) {
        if (!pool) throw new Error('Project Provisioning requires PostgreSQL');
        this.pool = pool;
        this.infoSSOTService = infoSSOTService;
    }

    async withOrganization(organizationId, handler) {
        if (!String(organizationId || '').trim()) {
            const error = new Error('Project Registry access requires organizationId');
            error.code = 'PROJECT_PROVISIONING_ORGANIZATION_REQUIRED';
            error.statusCode = 409;
            throw error;
        }
        if (!this.infoSSOTService?.withAccessContext) return handler(this.pool);
        return this.infoSSOTService.withAccessContext({
            role: 'ceo', projectCodes: [], clearance: [], organizationId
        }, handler);
    }

    async getProject(projectCode, organizationId) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            'SELECT * FROM project_registry WHERE project_code = $1 AND organization_id = $2',
            [projectCode, organizationId]
        ));
        return rows[0] || null;
    }

    async findProjectCodeCollision(projectCode, organizationId) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            'SELECT source, code FROM project_code_collision_sources($1,$2)',
            [projectCode, organizationId]
        ));
        return rows;
    }

    async listProjects(organizationId) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            'SELECT * FROM project_registry WHERE organization_id=$1 ORDER BY project_code',
            [organizationId]
        ));
        return rows;
    }

    async checkAvailability() {
        const { rows } = await this.pool.query("SELECT to_regclass('project_registry') AS table_name");
        return Boolean(rows[0]?.table_name);
    }

    async verifyManifestAuthority(manifest, actor) {
        const organizationId = organizationIdFrom(actor);
        const graphOrganizationQuery = (client) => client.query(
            `SELECT ge.id
               FROM graph_entities ge
               JOIN projects p ON p.id=ge.project_id
               JOIN organizations o ON o.id=p.organization_id
              WHERE ge.id=$1
                AND ge.entity_type='org'
                AND ge.lifecycle_status='active'
                AND p.organization_id=$2
                AND o.id=$2`,
            [manifest.organization_entity_id, organizationId]
        );
        const graphAccess = graphAccessFrom(actor, organizationId);
        const [organization, owner, graphOrganization, grant] = await Promise.all([
            this.withOrganization(organizationId, (client) => client.query('SELECT id FROM organizations WHERE id=$1', [organizationId])),
            this.withOrganization(organizationId, (client) => client.query("SELECT id FROM people WHERE id=$1 AND COALESCE(status,'active')='active'", [manifest.owner_person_id])),
            this.infoSSOTService?.withAccessContext
                ? this.infoSSOTService.withAccessContext(graphAccess, graphOrganizationQuery)
                : this.withOrganization(organizationId, graphOrganizationQuery),
            this.withOrganization(organizationId, (client) => client.query(
                `SELECT ag.id FROM auth_grants ag JOIN organizations o ON o.workspace_id=ag.slack_workspace_id
                 WHERE ag.person_id=$1 AND o.id=$2 AND ag.active=true LIMIT 1`,
                [manifest.owner_person_id, organizationId]
            ))
        ]);
        return {
            organization_exists: Boolean(organization.rows[0]),
            owner_person_exists: Boolean(owner.rows[0]),
            organization_entity_exists: Boolean(graphOrganization.rows[0]),
            owner_has_organization_grant: Boolean(grant.rows[0])
        };
    }

    async findIdentityCollisions(manifest, actor) {
        const execute = (client) => client.query(
            `SELECT id, entity_type FROM graph_entities
             WHERE lifecycle_status='active' AND id<>$1
               AND (lower(payload->>'name')=lower($2)
                 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload->'aliases','[]'::jsonb)) AS aliases(alias)
                            WHERE lower(aliases.alias)=lower($2)))`,
            [manifest.project_code, manifest.display_name]
        );
        const { rows } = this.infoSSOTService?.withAccessContext
            ? await this.infoSSOTService.withAccessContext(
                graphAccessFrom(actor, organizationIdFrom(actor)), execute
            )
            : await execute(this.pool);
        return rows;
    }

    async savePlan({ idempotencyKey, fingerprint, manifest, plan, actor }) {
        const organizationId = organizationIdFrom(actor);
        const existing = await this.getRunByIdempotencyKey(idempotencyKey, organizationId);
        if (existing) {
            if (existing.manifest_fingerprint !== fingerprint) {
                const error = new Error('Idempotency key is already bound to another manifest');
                error.code = 'PROJECT_PROVISIONING_IDEMPOTENCY_CONFLICT';
                error.statusCode = 409;
                throw error;
            }
            return existing;
        }
        const runId = `ppr_${crypto.randomUUID()}`;
        const inserted = await this.withOrganization(organizationId, async (client) => {
            const result = await client.query(
                `INSERT INTO project_provisioning_runs
                 (run_id, organization_id, project_code, idempotency_key, manifest_fingerprint, manifest, plan, state, actor)
                 VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'planned',$8::jsonb)
                 ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING run_id`,
                [runId, organizationId, manifest.project_code, idempotencyKey, fingerprint,
                    JSON.stringify(manifest), JSON.stringify(plan), JSON.stringify(actor || {})]
            );
            if (result.rows[0]) {
                for (const step of plan.steps) {
                    await client.query(
                        `INSERT INTO project_provisioning_steps (run_id, organization_id, step_name, state)
                         VALUES ($1,$2,$3,'pending')`,
                        [runId, organizationId, step.name]
                    );
                }
            }
            return result;
        });
        if (!inserted.rows[0]) {
            const replay = await this.getRunByIdempotencyKey(idempotencyKey, organizationId);
            if (replay?.manifest_fingerprint !== fingerprint) {
                const error = new Error('Idempotency key is already bound to another manifest');
                error.code = 'PROJECT_PROVISIONING_IDEMPOTENCY_CONFLICT';
                error.statusCode = 409;
                throw error;
            }
            return replay;
        }
        return this.getRun(runId, organizationId);
    }

    async getRunByIdempotencyKey(key, organizationId) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            'SELECT run_id FROM project_provisioning_runs WHERE idempotency_key = $1 AND organization_id = $2',
            [key, organizationId]
        ));
        return rows[0] ? this.getRun(rows[0].run_id, organizationId) : null;
    }

    async getRun(runId, organizationId) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            `SELECT r.*, COALESCE(jsonb_agg(s ORDER BY s.step_name) FILTER (WHERE s.step_name IS NOT NULL), '[]'::jsonb) AS steps
             FROM project_provisioning_runs r LEFT JOIN project_provisioning_steps s
               ON s.run_id = r.run_id AND s.organization_id = r.organization_id
             WHERE r.run_id = $1 AND r.organization_id = $2 GROUP BY r.run_id`,
            [runId, organizationId]
        ));
        return parse(rows[0]);
    }

    async setRunState(runId, organizationId, state, { receipt = null, failure = null, executionToken = null } = {}) {
        const { rowCount } = await this.withOrganization(organizationId, (client) => client.query(
            `UPDATE project_provisioning_runs SET state=$3, receipt=COALESCE($4::jsonb,receipt), failure=$5::jsonb,
             updated_at=now() WHERE run_id=$1 AND organization_id=$2
             AND ($6::text IS NULL OR execution_token=$6) RETURNING run_id`,
            [runId, organizationId, state, receipt ? JSON.stringify(receipt) : null,
                failure ? JSON.stringify(failure) : null, executionToken]
        ));
        if (executionToken && rowCount === 0) throw staleExecutionError(runId);
        return this.getRun(runId, organizationId);
    }

    async claimRun(runId, organizationId, { recoverStaleApplying = false } = {}) {
        const { rows } = await this.withOrganization(organizationId, (client) => client.query(
            `UPDATE project_provisioning_runs SET state='applying', attempt=attempt+1, failure=NULL,
             execution_token=gen_random_uuid()::text, updated_at=now()
             WHERE run_id=$1 AND organization_id=$2
               AND (
                 state IN ('planned','partial_failed','manual_intervention_required')
                 OR ($3::boolean = true AND state='applying' AND updated_at < now() - interval '5 minutes')
               )
             RETURNING run_id, execution_token`,
            [runId, organizationId, recoverStaleApplying]
        ));
        if (rows[0]) return this.getRun(runId, organizationId);
        const current = await this.getRun(runId, organizationId);
        if (current?.state === 'active') return current;
        const error = new Error(`Provisioning run cannot be claimed from state: ${current?.state || 'missing'}`);
        error.code = 'PROJECT_PROVISIONING_RUN_BUSY';
        error.statusCode = current ? 409 : 404;
        throw error;
    }

    async heartbeatRun(runId, organizationId, executionToken) {
        const { rowCount } = await this.withOrganization(organizationId, (client) => client.query(
            `UPDATE project_provisioning_runs SET updated_at=now()
             WHERE run_id=$1 AND organization_id=$2 AND state='applying' AND execution_token=$3
             RETURNING run_id`,
            [runId, organizationId, executionToken]
        ));
        if (rowCount === 0) throw staleExecutionError(runId);
    }

    async recordHumanGate(runId, organizationId, receipt) {
        await this.withOrganization(organizationId, (client) => client.query(
            `UPDATE project_provisioning_runs SET human_gate_receipt=$3::jsonb, updated_at=now()
             WHERE run_id=$1 AND organization_id=$2 AND human_gate_receipt IS NULL`,
            [runId, organizationId, JSON.stringify(receipt)]
        ));
        return this.getRun(runId, organizationId);
    }

    async setStep(runId, organizationId, stepName, state, payload = {}) {
        const { rowCount } = await this.withOrganization(organizationId, (client) => client.query(
            `UPDATE project_provisioning_steps SET state=$4, attempt=attempt+1,
             receipt=COALESCE($5::jsonb,receipt), failure=$6::jsonb, updated_at=now()
             WHERE run_id=$1 AND organization_id=$2 AND step_name=$3
               AND EXISTS (SELECT 1 FROM project_provisioning_runs r WHERE r.run_id=$1 AND r.organization_id=$2
                 AND ($7::text IS NULL OR r.execution_token=$7))
             RETURNING run_id`,
            [runId, organizationId, stepName, state, payload.receipt ? JSON.stringify(payload.receipt) : null,
                payload.failure ? JSON.stringify(payload.failure) : null, payload.executionToken || null]
        ));
        if (payload.executionToken && rowCount === 0) throw staleExecutionError(runId);
    }

    async upsertProject(manifest, { organizationId }) {
        return this.withOrganization(organizationId, async (client) => {
            try {
                await client.query('SELECT claim_project_code($1,$2)', [manifest.project_code, organizationId]);
            } catch (cause) {
                if (cause?.code !== '23505') throw cause;
                const error = new Error(`Project code collision: ${manifest.project_code}`);
                error.code = 'PROJECT_PROVISIONING_PROJECT_COLLISION';
                error.statusCode = 409;
                throw error;
            }
            const graphProject = await client.query('SELECT organization_id FROM projects WHERE code=$1 FOR UPDATE', [manifest.project_code]);
            if (graphProject.rows[0] && graphProject.rows[0].organization_id !== organizationId) {
                const error = new Error(`Project code collision: ${manifest.project_code}`);
                error.code = 'PROJECT_PROVISIONING_PROJECT_COLLISION';
                error.statusCode = 409;
                throw error;
            }
            const registry = await client.query('SELECT * FROM project_registry WHERE project_code=$1 FOR UPDATE', [manifest.project_code]);
            const existing = registry.rows[0];
            if (existing && (existing.display_name !== manifest.display_name || existing.catalog_version !== manifest.catalog_version)) {
                const error = new Error(`Project code collision: ${manifest.project_code}`);
                error.code = 'PROJECT_PROVISIONING_PROJECT_COLLISION';
                error.statusCode = 409;
                throw error;
            }
            await client.query(
                `INSERT INTO projects (id,code,name,organization_id) VALUES ($1,$2,$3,$4)
                 ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name`,
                [`project_${manifest.project_code.replaceAll('-', '_')}`, manifest.project_code,
                    manifest.display_name, organizationId]
            );
            const saved = await client.query(
                `INSERT INTO project_registry
                 (project_code,organization_id,display_name,kind,catalog_version,session_select,organization_entity_id,owner_person_id,repository)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
                 ON CONFLICT (project_code) DO UPDATE SET repository=EXCLUDED.repository, updated_at=now()
                 RETURNING *`,
                [manifest.project_code, organizationId, manifest.display_name, manifest.kind, manifest.catalog_version,
                    manifest.session_select, manifest.organization_entity_id, manifest.owner_person_id,
                    JSON.stringify(manifest.repository)]
            );
            return saved.rows[0];
        });
    }
}
