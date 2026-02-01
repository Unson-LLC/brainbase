import { Pool } from 'pg';
import { ulid } from 'ulid';
import { logger } from '../utils/logger.js';

const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

const ROLE_VALUES = Object.keys(ROLE_RANK);
const SENSITIVITY_VALUES = ['internal', 'restricted', 'finance', 'hr', 'contract'];
const HIGH_SENSITIVITY_VALUES = ['finance', 'hr', 'contract'];

export class InfoSSOTService {
    constructor() {
        this.databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
        this.pool = this.databaseUrl ? new Pool({ connectionString: this.databaseUrl }) : null;
        if (!this.pool) {
            logger.warn('InfoSSOTService disabled: INFO_SSOT_DATABASE_URL is not set');
        }
    }

    assertReady() {
        if (!this.pool) {
            throw new Error('Info SSOT database is not configured');
        }
    }

    generateId(prefix) {
        return `${prefix}_${ulid()}`;
    }

    async upsertGraphEntity(client, { id, entityType, projectId, payload, roleMin, sensitivity }) {
        await client.query(
            `INSERT INTO graph_entities (
                id,
                entity_type,
                project_id,
                payload,
                role_min,
                sensitivity,
                created_at,
                updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
            ON CONFLICT (id)
            DO UPDATE SET
                entity_type = EXCLUDED.entity_type,
                project_id = EXCLUDED.project_id,
                payload = EXCLUDED.payload,
                role_min = EXCLUDED.role_min,
                sensitivity = EXCLUDED.sensitivity,
                updated_at = NOW()`,
            [
                id,
                entityType,
                projectId,
                JSON.stringify(payload || {}),
                roleMin,
                sensitivity
            ]
        );
    }

    async upsertGraphEdge(client, { fromId, toId, relType, projectId, payload, roleMin, sensitivity }) {
        const edgeId = this.generateId('edg');
        await client.query(
            `INSERT INTO graph_edges (
                id,
                from_id,
                to_id,
                rel_type,
                project_id,
                payload,
                role_min,
                sensitivity,
                created_at,
                updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
            ON CONFLICT (from_id, to_id, rel_type)
            DO UPDATE SET
                payload = EXCLUDED.payload,
                role_min = EXCLUDED.role_min,
                sensitivity = EXCLUDED.sensitivity,
                updated_at = NOW()`,
            [
                edgeId,
                fromId,
                toId,
                relType,
                projectId,
                JSON.stringify(payload || {}),
                roleMin,
                sensitivity
            ]
        );
    }

    normalizeRole(role) {
        return typeof role === 'string' ? role.toLowerCase() : '';
    }

    normalizeSensitivity(value) {
        return typeof value === 'string' ? value.toLowerCase() : '';
    }

    getRoleRank(role) {
        return ROLE_RANK[this.normalizeRole(role)] || 0;
    }

    assertValidRole(role) {
        if (!ROLE_VALUES.includes(this.normalizeRole(role))) {
            throw new Error(`Invalid role: ${role}`);
        }
    }

    assertValidSensitivity(value) {
        if (!SENSITIVITY_VALUES.includes(this.normalizeSensitivity(value))) {
            throw new Error(`Invalid sensitivity: ${value}`);
        }
    }

    normalizeDecisionDomain(value) {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim();
        if (!trimmed) return '';
        return trimmed.startsWith('decision:') ? trimmed.slice('decision:'.length) : trimmed;
    }

    resolveDecisionDomain(input) {
        return this.normalizeDecisionDomain(
            input.decisionDomain ||
            input.decisionType ||
            input.context?.decision_domain ||
            input.context?.decision_type ||
            ''
        );
    }

    formatEntityLabel(record) {
        const payload = record?.payload || {};
        switch (record?.entity_type) {
            case 'person':
                return payload.name || record.id;
            case 'project':
                return payload.name || payload.code || record.id;
            case 'decision':
                return payload.title || record.id;
            case 'raci_assignment':
                return payload.role_code || record.id;
            case 'ai_query':
                return payload.intent || payload.query_type || record.id;
            case 'ai_decision':
                return payload.summary || record.id;
            default:
                return payload.title || payload.name || record.id;
        }
    }

    summarizeEntities(records) {
        return records.map(record => {
            const payload = record?.payload || {};
            switch (record?.entity_type) {
                case 'decision':
                    return `Decision: ${payload.title || record.id} (${payload.status || 'decided'})`;
                case 'raci_assignment':
                    return `RACI: ${payload.role_code || record.id} (${payload.authority_scope || ''})`;
                case 'ai_query':
                    return `AI Query: ${payload.intent || payload.query_type || record.id}`;
                case 'ai_decision':
                    return `AI Decision: ${payload.summary || record.id}`;
                case 'person':
                    return `Person: ${payload.name || record.id}`;
                case 'project':
                    return `Project: ${payload.name || payload.code || record.id}`;
                default:
                    return `${record.entity_type || 'entity'}: ${payload.title || payload.name || record.id}`;
            }
        });
    }

    async summarizeEdges(client, records) {
        const idSet = new Set();
        for (const record of records) {
            if (record.from_id) idSet.add(record.from_id);
            if (record.to_id) idSet.add(record.to_id);
        }
        const ids = Array.from(idSet);
        const labelMap = new Map();
        if (ids.length) {
            const { rows } = await client.query(
                'SELECT id, entity_type, payload FROM graph_entities WHERE id = ANY($1)',
                [ids]
            );
            for (const row of rows) {
                labelMap.set(row.id, this.formatEntityLabel(row));
            }
        }
        const labelFor = (id) => labelMap.get(id) || id;
        return records.map(record => {
            const fromLabel = labelFor(record.from_id);
            const toLabel = labelFor(record.to_id);
            return `${fromLabel} -[${record.rel_type}]-> ${toLabel}`;
        });
    }

    buildHumanReport({ seedId, projectCode, nodes, edges, summaryLines }) {
        const byType = nodes.reduce((acc, node) => {
            const type = node.entity_type || 'unknown';
            if (!acc[type]) acc[type] = [];
            acc[type].push(node);
            return acc;
        }, {});
        const seedNode = nodes.find(node => node.id === seedId) || null;
        const labelFor = (node) => (node ? this.formatEntityLabel(node) : seedId);

        const decisionItems = (byType.decision || []).map(node => ({
            id: node.id,
            title: node.payload?.title || null,
            status: node.payload?.status || null,
            decided_at: node.payload?.decided_at || null
        }));
        const raciItems = (byType.raci_assignment || []).map(node => ({
            id: node.id,
            role_code: node.payload?.role_code || null,
            authority_scope: node.payload?.authority_scope || null,
            sensitivity_min: node.payload?.sensitivity_min || null
        }));
        const personItems = (byType.person || []).map(node => ({
            id: node.id,
            name: node.payload?.name || null
        }));
        const aiDecisionItems = (byType.ai_decision || []).map(node => ({
            id: node.id,
            summary: node.payload?.summary || null,
            decision_type: node.payload?.decision_type || null,
            decided_at: node.payload?.decided_at || null,
            confidence: node.payload?.confidence || null
        }));
        const aiQueryItems = (byType.ai_query || []).map(node => ({
            id: node.id,
            intent: node.payload?.intent || null,
            query_type: node.payload?.query_type || null,
            result_count: node.payload?.result_count || null
        }));
        const projectItems = (byType.project || []).map(node => ({
            id: node.id,
            code: node.payload?.code || null,
            name: node.payload?.name || null
        }));

        return {
            header: {
                seed_id: seedId,
                seed_label: labelFor(seedNode),
                seed_type: seedNode?.entity_type || null,
                project_code: projectCode || null
            },
            meta: {
                node_count: nodes.length,
                edge_count: edges.length
            },
            sections: [
                { title: 'Decisions', items: decisionItems },
                { title: 'RACI', items: raciItems },
                { title: 'People', items: personItems },
                { title: 'AI Decisions', items: aiDecisionItems },
                { title: 'AI Queries', items: aiQueryItems },
                { title: 'Projects', items: projectItems }
            ],
            relations: summaryLines || []
        };
    }

    assertWriteAccess(access, { projectCode, roleMin, sensitivity }) {
        this.assertValidRole(access.role);
        this.assertValidRole(roleMin);
        this.assertValidSensitivity(sensitivity);

        if (!access.projectCodes.includes(projectCode)) {
            throw new Error(`Access denied for project: ${projectCode}`);
        }
        if (!access.clearance.includes(sensitivity)) {
            throw new Error(`Access denied for sensitivity: ${sensitivity}`);
        }
        if (HIGH_SENSITIVITY_VALUES.includes(sensitivity) && this.getRoleRank(roleMin) < this.getRoleRank('gm')) {
            throw new Error('Sensitive data requires role_min gm or ceo');
        }
        if (this.getRoleRank(access.role) < this.getRoleRank(roleMin)) {
            throw new Error('Access denied for role');
        }
    }

    async assertDecisionAuthority(client, { projectId, personId, decisionDomain }) {
        const normalizedDomain = this.normalizeDecisionDomain(decisionDomain);
        if (!normalizedDomain) {
            throw new Error('Decision domain is required for RACI guard');
        }
        const roleCodes = [`decision:${normalizedDomain}`, 'decision:最終決裁'];
        const { rows } = await client.query(
            `SELECT 1
             FROM raci_assignments
             WHERE project_id = $1
               AND person_id = $2
               AND role_code = ANY($3)
             LIMIT 1`,
            [projectId, personId, roleCodes]
        );
        if (!rows.length) {
            throw new Error(`Decision authority missing for domain: ${normalizedDomain}`);
        }
    }

    async withAccessContext(access, handler) {
        this.assertReady();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role]);
            await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', access.projectCodes.join(',')]);
            await client.query('SELECT set_config($1, $2, true)', ['app.clearance', access.clearance.join(',')]);
            const result = await handler(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async fetchGraphEntities(client, access, { projectCode, entityType, limit }) {
        const roleRank = this.getRoleRank(access.role);
        const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
        const { rows } = await client.query(
            `SELECT ge.*, p.code AS project_code
             FROM graph_entities ge
             LEFT JOIN projects p ON p.id = ge.project_id
             WHERE (
               $1::text IS NULL
               OR p.code = $1
               OR (
                 ge.entity_type = 'person' AND EXISTS (
                   SELECT 1
                   FROM graph_edges gx
                   JOIN projects px ON px.id = gx.project_id
                   WHERE gx.from_id = ge.id
                     AND gx.rel_type = 'member_of'
                     AND px.code = $1
                 )
               )
             )
               AND ($2::text IS NULL OR ge.entity_type = $2)
               AND (
                 (ge.project_id IS NOT NULL AND p.code = ANY($3))
                 OR (
                   ge.entity_type = 'person' AND EXISTS (
                     SELECT 1
                     FROM graph_edges gy
                     JOIN projects py ON py.id = gy.project_id
                     WHERE gy.from_id = ge.id
                       AND gy.rel_type = 'member_of'
                       AND py.code = ANY($3)
                   )
                 )
               )
               AND ge.sensitivity = ANY($4)
               AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
             ORDER BY ge.updated_at DESC
             LIMIT $6`,
            [projectCode || null, entityType || null, access.projectCodes, access.clearance, roleRank, safeLimit]
        );
        return rows;
    }

    async fetchGraphEdges(client, access, { projectCode, relType, fromId, toId, limit }) {
        const roleRank = this.getRoleRank(access.role);
        const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
        const { rows } = await client.query(
            `SELECT ge.*, p.code AS project_code
             FROM graph_edges ge
             JOIN projects p ON p.id = ge.project_id
             WHERE ($1::text IS NULL OR p.code = $1)
               AND ($2::text IS NULL OR ge.rel_type = $2)
               AND ($3::text IS NULL OR ge.from_id = $3)
               AND ($4::text IS NULL OR ge.to_id = $4)
               AND p.code = ANY($5)
               AND ge.sensitivity = ANY($6)
               AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $7
             ORDER BY ge.updated_at DESC
             LIMIT $8`,
            [projectCode || null, relType || null, fromId || null, toId || null, access.projectCodes, access.clearance, roleRank, safeLimit]
        );
        return rows;
    }

    async fetchGraphEntitiesByIds(client, access, { ids, projectCode }) {
        const roleRank = this.getRoleRank(access.role);
        if (!ids?.length) return [];
        const { rows } = await client.query(
            `SELECT ge.*, p.code AS project_code
             FROM graph_entities ge
             LEFT JOIN projects p ON p.id = ge.project_id
             WHERE ge.id = ANY($1)
               AND (
                 $2::text IS NULL
                 OR p.code = $2
                 OR (
                   ge.entity_type = 'person' AND EXISTS (
                     SELECT 1
                     FROM graph_edges gx
                     JOIN projects px ON px.id = gx.project_id
                     WHERE gx.from_id = ge.id
                       AND gx.rel_type = 'member_of'
                       AND px.code = $2
                   )
                 )
               )
               AND (
                 (ge.project_id IS NOT NULL AND p.code = ANY($3))
                 OR (
                   ge.entity_type = 'person' AND EXISTS (
                     SELECT 1
                     FROM graph_edges gy
                     JOIN projects py ON py.id = gy.project_id
                     WHERE gy.from_id = ge.id
                       AND gy.rel_type = 'member_of'
                       AND py.code = ANY($3)
                   )
                 )
               )
               AND ge.sensitivity = ANY($4)
               AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
             ORDER BY ge.updated_at DESC`,
            [ids, projectCode || null, access.projectCodes, access.clearance, roleRank]
        );
        return rows;
    }

    async ensureProject(client, { projectCode, projectName }) {
        const { rows } = await client.query(
            'SELECT id FROM projects WHERE code = $1 LIMIT 1',
            [projectCode]
        );
        if (rows.length > 0) {
            const projectId = rows[0].id;
            await this.upsertGraphEntity(client, {
                id: projectId,
                entityType: 'project',
                projectId,
                payload: { code: projectCode, name: projectName || '' },
                roleMin: 'member',
                sensitivity: 'internal'
            });
            return projectId;
        }
        if (!projectName) {
            throw new Error(`Unknown project: ${projectCode}`);
        }
        const id = this.generateId('prj');
        await client.query(
            'INSERT INTO projects (id, code, name) VALUES ($1, $2, $3)',
            [id, projectCode, projectName]
        );
        await this.upsertGraphEntity(client, {
            id,
            entityType: 'project',
            projectId: id,
            payload: { code: projectCode, name: projectName },
            roleMin: 'member',
            sensitivity: 'internal'
        });
        return id;
    }

    async getProjectId(client, projectCode) {
        const { rows } = await client.query(
            'SELECT id FROM projects WHERE code = $1 LIMIT 1',
            [projectCode]
        );
        if (!rows.length) {
            throw new Error(`Unknown project: ${projectCode}`);
        }
        return rows[0].id;
    }

    async ensurePerson(client, { personId, personName }) {
        if (personId) {
            return personId;
        }
        if (!personName) {
            throw new Error('personId or personName is required');
        }
        const { rows } = await client.query(
            'SELECT id FROM people WHERE name = $1 LIMIT 1',
            [personName]
        );
        if (rows.length > 0) {
            const id = rows[0].id;
            await this.upsertGraphEntity(client, {
                id,
                entityType: 'person',
                projectId: null,
                payload: { name: personName },
                roleMin: 'member',
                sensitivity: 'internal'
            });
            return id;
        }
        const id = this.generateId('per');
        await client.query(
            'INSERT INTO people (id, name, status) VALUES ($1, $2, $3)',
            [id, personName, 'active']
        );
        await this.upsertGraphEntity(client, {
            id,
            entityType: 'person',
            projectId: null,
            payload: { name: personName },
            roleMin: 'member',
            sensitivity: 'internal'
        });
        return id;
    }

    async createEvent(access, input) {
        const roleMin = this.normalizeRole(input.roleMin);
        const sensitivity = this.normalizeSensitivity(input.sensitivity);
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const actorPersonId = await this.ensurePerson(client, {
                personId: input.actorPersonId,
                personName: input.actorPersonName
            });
            const eventId = this.generateId('evt');

            await client.query(
                `INSERT INTO events (
                    id,
                    project_id,
                    actor_person_id,
                    event_type,
                    payload,
                    occurred_at,
                    source,
                    confidence,
                    role_min,
                    sensitivity,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                [
                    eventId,
                    projectId,
                    actorPersonId,
                    input.eventType,
                    JSON.stringify(input.payload || {}),
                    input.occurredAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            return { event_id: eventId };
        });
    }

    async createDecision(access, input) {
        const roleMin = this.normalizeRole(input.roleMin);
        const sensitivity = this.normalizeSensitivity(input.sensitivity);
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const ownerPersonId = await this.ensurePerson(client, {
                personId: input.ownerPersonId,
                personName: input.ownerPersonName
            });
            if (input.enforceRaci !== false) {
                const decisionDomain = this.resolveDecisionDomain(input);
                await this.assertDecisionAuthority(client, {
                    projectId,
                    personId: ownerPersonId,
                    decisionDomain
                });
            }

            const eventId = this.generateId('evt');
            const decisionId = this.generateId('dec');

            await client.query(
                `INSERT INTO events (
                    id,
                    project_id,
                    actor_person_id,
                    event_type,
                    payload,
                    occurred_at,
                    source,
                    confidence,
                    role_min,
                    sensitivity,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                [
                    eventId,
                    projectId,
                    ownerPersonId,
                    'DECISION_CREATED',
                    JSON.stringify({
                        title: input.title,
                        decision_domain: this.resolveDecisionDomain(input) || null,
                        context: input.context || {},
                        options: input.options || [],
                        chosen: input.chosen || {},
                        reason: input.reason || ''
                    }),
                    input.decidedAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await client.query(
                `INSERT INTO decisions (
                    id,
                    project_id,
                    owner_person_id,
                    title,
                    context,
                    options,
                    chosen,
                    reason,
                    decided_at,
                    status,
                    role_min,
                    sensitivity,
                    source_event_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [
                    decisionId,
                    projectId,
                    ownerPersonId,
                    input.title,
                    JSON.stringify(input.context || {}),
                    JSON.stringify(input.options || []),
                    JSON.stringify(input.chosen || {}),
                    input.reason || '',
                    input.decidedAt || new Date().toISOString(),
                    input.status || 'decided',
                    roleMin,
                    sensitivity,
                    eventId
                ]
            );

            await this.upsertGraphEntity(client, {
                id: decisionId,
                entityType: 'decision',
                projectId,
                payload: {
                    title: input.title,
                    decision_domain: this.resolveDecisionDomain(input) || null,
                    decided_at: input.decidedAt || new Date().toISOString(),
                    status: input.status || 'decided'
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: decisionId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: decisionId,
                toId: ownerPersonId,
                relType: 'owned_by',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: ownerPersonId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal'
            });

            return { decision_id: decisionId, event_id: eventId };
        });
    }

    async createRaci(access, input) {
        const roleMin = this.normalizeRole(input.roleMin || input.sensitivityMin || input.roleCode);
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const personId = await this.ensurePerson(client, {
                personId: input.personId,
                personName: input.personName
            });

            const eventId = this.generateId('evt');
            const desiredRaciId = this.generateId('rac');

            await client.query(
                `INSERT INTO events (
                    id,
                    project_id,
                    actor_person_id,
                    event_type,
                    payload,
                    occurred_at,
                    source,
                    confidence,
                    role_min,
                    sensitivity,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                [
                    eventId,
                    projectId,
                    personId,
                    'RACI_ASSIGNED',
                    JSON.stringify({
                        role_code: input.roleCode,
                        authority_scope: input.authorityScope || '',
                        sensitivity_min: roleMin
                    }),
                    input.occurredAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            const { rows } = await client.query(
                `INSERT INTO raci_assignments (
                    id,
                    project_id,
                    person_id,
                    role_code,
                    authority_scope,
                    sensitivity_min,
                    sensitivity,
                    created_at,
                    updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
                ON CONFLICT (project_id, person_id, role_code)
                DO UPDATE SET
                    authority_scope = EXCLUDED.authority_scope,
                    sensitivity_min = EXCLUDED.sensitivity_min,
                    sensitivity = EXCLUDED.sensitivity,
                    updated_at = NOW()
                RETURNING id`,
                [
                    desiredRaciId,
                    projectId,
                    personId,
                    input.roleCode,
                    input.authorityScope || '',
                    roleMin,
                    sensitivity
                ]
            );
            const raciId = rows?.[0]?.id || desiredRaciId;

            await this.upsertGraphEntity(client, {
                id: raciId,
                entityType: 'raci_assignment',
                projectId,
                payload: {
                    role_code: input.roleCode,
                    authority_scope: input.authorityScope || '',
                    sensitivity_min: roleMin
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: raciId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: raciId,
                toId: personId,
                relType: 'assigned_to',
                projectId,
                payload: { role_code: input.roleCode },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: personId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: { role_code: input.roleCode },
                roleMin: 'member',
                sensitivity: 'internal'
            });
            return { raci_id: raciId, event_id: eventId };
        });
    }

    async listDecisions(access, { projectCode, since }) {
        this.assertReady();
        const roleRank = this.getRoleRank(access.role);
        return this.withAccessContext(access, async (client) => {
            const { rows } = await client.query(
                `SELECT d.*, p.code AS project_code
                 FROM decisions d
                 JOIN projects p ON p.id = d.project_id
                 WHERE ($1::text IS NULL OR p.code = $1)
                   AND p.code = ANY($2)
                   AND d.sensitivity = ANY($3)
                   AND (CASE d.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
                   AND ($5::timestamptz IS NULL OR d.decided_at >= $5)
                 ORDER BY d.decided_at DESC
                 LIMIT 500`,
                [projectCode || null, access.projectCodes, access.clearance, roleRank, since || null]
            );
            return rows;
        });
    }

    async listRaci(access, { projectCode }) {
        this.assertReady();
        const roleRank = this.getRoleRank(access.role);
        return this.withAccessContext(access, async (client) => {
            const { rows } = await client.query(
                `SELECT r.*, p.code AS project_code
                 FROM raci_assignments r
                 JOIN projects p ON p.id = r.project_id
                 WHERE ($1::text IS NULL OR p.code = $1)
                   AND p.code = ANY($2)
                   AND r.sensitivity = ANY($3)
                   AND (CASE r.sensitivity_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
                 ORDER BY r.updated_at DESC
                 LIMIT 500`,
                [projectCode || null, access.projectCodes, access.clearance, roleRank]
            );
            return rows;
        });
    }

    async listEvents(access, { projectCode, eventType }) {
        this.assertReady();
        const roleRank = this.getRoleRank(access.role);
        return this.withAccessContext(access, async (client) => {
            const { rows } = await client.query(
                `SELECT e.*, p.code AS project_code
                 FROM events e
                 JOIN projects p ON p.id = e.project_id
                 WHERE ($1::text IS NULL OR p.code = $1)
                   AND ($2::text IS NULL OR e.event_type = $2)
                   AND p.code = ANY($3)
                   AND e.sensitivity = ANY($4)
                   AND (CASE e.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                 ORDER BY e.occurred_at DESC
                 LIMIT 500`,
                [projectCode || null, eventType || null, access.projectCodes, access.clearance, roleRank]
            );
            return rows;
        });
    }

    async listGraphEntities(access, { projectCode, entityType }) {
        this.assertReady();
        return this.withAccessContext(access, async (client) => {
            return this.fetchGraphEntities(client, access, { projectCode, entityType });
        });
    }

    async listGraphEdges(access, { projectCode, relType, fromId, toId }) {
        this.assertReady();
        return this.withAccessContext(access, async (client) => {
            return this.fetchGraphEdges(client, access, { projectCode, relType, fromId, toId });
        });
    }

    async expandGraph(access, { projectCode, seedId, depth, limit, humanReadable }) {
        this.assertReady();
        if (!projectCode) {
            throw new Error('projectCode is required');
        }
        if (!seedId) {
            throw new Error('seed is required');
        }
        const safeDepth = Math.min(Math.max(Number(depth) || 1, 1), 3);
        const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

        return this.withAccessContext(access, async (client) => {
            const seedEntities = await this.fetchGraphEntitiesByIds(client, access, {
                ids: [seedId],
                projectCode
            });
            if (!seedEntities.length) {
                throw new Error('Seed is not accessible');
            }

            const roleRank = this.getRoleRank(access.role);
            const nodeRows = await client.query(
                `WITH RECURSIVE node_walk(id, depth) AS (
                    SELECT $2::text AS id, 0 AS depth
                    UNION
                    SELECT CASE
                        WHEN ge.from_id = node_walk.id THEN ge.to_id
                        ELSE ge.from_id
                    END AS id,
                    node_walk.depth + 1
                    FROM node_walk
                    JOIN graph_edges ge ON (ge.from_id = node_walk.id OR ge.to_id = node_walk.id)
                    JOIN projects p ON p.id = ge.project_id
                    WHERE p.code = $1
                      AND node_walk.depth < $6
                      AND p.code = ANY($3)
                      AND ge.sensitivity = ANY($4)
                      AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                )
                SELECT DISTINCT id FROM node_walk
                LIMIT $7`,
                [projectCode, seedId, access.projectCodes, access.clearance, roleRank, safeDepth, safeLimit]
            );

            const nodeIds = nodeRows.rows.map(row => row.id);
            const edges = await this.fetchGraphEdges(client, access, {
                projectCode,
                fromId: null,
                toId: null,
                relType: null,
                limit: safeLimit
            });
            const filteredEdges = edges.filter(edge => nodeIds.includes(edge.from_id) || nodeIds.includes(edge.to_id));
            const nodes = await this.fetchGraphEntitiesByIds(client, access, {
                ids: nodeIds,
                projectCode
            });

            let summaryLines = null;
            let report = null;
            if (humanReadable) {
                summaryLines = await this.summarizeEdges(client, filteredEdges);
                report = this.buildHumanReport({
                    seedId,
                    projectCode,
                    nodes,
                    edges: filteredEdges,
                    summaryLines
                });
            }

            return {
                nodes,
                edges: filteredEdges,
                summary_lines: summaryLines,
                report
            };
        });
    }

    async createAiQuery(access, input) {
        const roleMin = this.normalizeRole(input.roleMin || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });

        const queryType = input.queryType;
        if (!['entities', 'edges'].includes(queryType)) {
            throw new Error('Invalid queryType: use entities or edges');
        }
        if (!input.projectCode) {
            throw new Error('projectCode is required');
        }

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.getProjectId(client, input.projectCode);
            const actorPersonId = await this.ensurePerson(client, {
                personId: input.actorPersonId,
                personName: input.actorPersonName || 'AI'
            });

            const records = queryType === 'entities'
                ? await this.fetchGraphEntities(client, access, {
                    projectCode: input.projectCode,
                    entityType: input.entityType || null,
                    limit: input.limit
                })
                : await this.fetchGraphEdges(client, access, {
                    projectCode: input.projectCode,
                    relType: input.relType || null,
                    fromId: input.fromId || null,
                    toId: input.toId || null,
                    limit: input.limit
                });

            const queryId = this.generateId('qry');
            const eventId = this.generateId('evt');
            const occurredAt = input.occurredAt || new Date().toISOString();

            const payload = {
                query_type: queryType,
                project_code: input.projectCode,
                entity_type: input.entityType || null,
                rel_type: input.relType || null,
                from_id: input.fromId || null,
                to_id: input.toId || null,
                limit: input.limit || null,
                intent: input.intent || null,
                result_count: records.length
            };

            await client.query(
                `INSERT INTO events (
                    id,
                    project_id,
                    actor_person_id,
                    event_type,
                    payload,
                    occurred_at,
                    source,
                    confidence,
                    role_min,
                    sensitivity,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                [
                    eventId,
                    projectId,
                    actorPersonId,
                    'AI_QUERY',
                    JSON.stringify(payload),
                    occurredAt,
                    input.source || 'ai',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await this.upsertGraphEntity(client, {
                id: queryId,
                entityType: 'ai_query',
                projectId,
                payload: {
                    ...payload,
                    occurred_at: occurredAt
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: queryId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: queryId,
                toId: actorPersonId,
                relType: 'requested_by',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: actorPersonId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal'
            });

            let summaryLines = null;
            if (input.humanReadable) {
                summaryLines = queryType === 'entities'
                    ? this.summarizeEntities(records)
                    : await this.summarizeEdges(client, records);
            }

            return {
                query_id: queryId,
                event_id: eventId,
                result_count: records.length,
                records,
                summary_lines: summaryLines
            };
        });
    }

    async createAiDecisionLog(access, input) {
        const roleMin = this.normalizeRole(input.roleMin || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });

        if (!input.projectCode) {
            throw new Error('projectCode is required');
        }
        if (!input.summary) {
            throw new Error('summary is required');
        }

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.getProjectId(client, input.projectCode);
            const actorPersonId = await this.ensurePerson(client, {
                personId: input.actorPersonId,
                personName: input.actorPersonName || 'AI'
            });

            const aiDecisionId = this.generateId('aid');
            const eventId = this.generateId('evt');
            const decidedAt = input.decidedAt || new Date().toISOString();

            const payload = {
                summary: input.summary,
                decision_type: input.decisionType || null,
                rationale: input.rationale || null,
                confidence: input.confidence ?? 1,
                related_decision_id: input.relatedDecisionId || null,
                related_entity_id: input.relatedEntityId || null,
                references: input.references || null
            };

            await client.query(
                `INSERT INTO events (
                    id,
                    project_id,
                    actor_person_id,
                    event_type,
                    payload,
                    occurred_at,
                    source,
                    confidence,
                    role_min,
                    sensitivity,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
                [
                    eventId,
                    projectId,
                    actorPersonId,
                    'AI_DECISION',
                    JSON.stringify(payload),
                    decidedAt,
                    input.source || 'ai',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await this.upsertGraphEntity(client, {
                id: aiDecisionId,
                entityType: 'ai_decision',
                projectId,
                payload: {
                    summary: input.summary,
                    decision_type: input.decisionType || null,
                    decided_at: decidedAt,
                    confidence: input.confidence ?? 1
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: aiDecisionId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: aiDecisionId,
                toId: actorPersonId,
                relType: 'made_by',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            if (input.relatedDecisionId || input.relatedEntityId) {
                await this.upsertGraphEdge(client, {
                    fromId: aiDecisionId,
                    toId: input.relatedDecisionId || input.relatedEntityId,
                    relType: 'references',
                    projectId,
                    payload: {},
                    roleMin,
                    sensitivity
                });
            }

            await this.upsertGraphEdge(client, {
                fromId: actorPersonId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal'
            });

            return { ai_decision_id: aiDecisionId, event_id: eventId };
        });
    }
}
