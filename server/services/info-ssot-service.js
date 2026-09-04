import { Pool } from 'pg';
import { ulid } from 'ulid';
import { sign } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { buildScopedMemoryResult } from './memory-scope-policy.js';
import { OntologyError } from './ontology-kernel.js';
import { OntologyRegistry } from './ontology-registry.js';
import { canonicalJson, ONTOLOGY_PUBLICATION_RECEIPT_SCHEMA_VERSION } from './ontology-publication.js';
import { assertCatalogProjectSubjectMutation, lockProjectGraphIdentity } from './project-graph-identity-lock.js';
import { requireCanonicalTenantIdentity } from '../lib/canonical-tenant-identity.js';

function isMergedGraphEntity(row) {
    const status = row?.payload?.status;
    return typeof status === 'string' && status.trim().toLowerCase() === 'merged';
}

function getCanonicalEntityId(row) {
    const canonicalEntityId = row?.payload?.canonical_entity_id;
    return typeof canonicalEntityId === 'string' ? canonicalEntityId.trim() : '';
}

function isTrue(value) {
    return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

const ROLE_VALUES = Object.keys(ROLE_RANK);
const SENSITIVITY_VALUES = ['internal', 'restricted', 'finance', 'hr', 'contract'];
const HIGH_SENSITIVITY_VALUES = ['finance', 'hr', 'contract'];
const PHILOSOPHY_GLOBAL_PROJECT_CODE = 'brainbase';
const PHILOSOPHY_SCOPE_IDS = {
    graph: [
        'phi_graph_ssot_first',
        'phi_ssot_or_nonexistent',
        'phi_context_is_asset',
        'phi_machine_readable_ssot'
    ],
    data: [
        'phi_data_ownership_by_use',
        'phi_flow_stack_separation',
        'phi_transcript_is_substrate',
        'phi_conversation_to_actionable_records'
    ],
    crm: [
        'phi_push_case_center',
        'phi_ui_is_projection',
        'phi_data_ownership_by_use',
        'phi_learning_loop'
    ],
    growth: [
        'phi_value_expression_distribution',
        'phi_n1_pain_marketing',
        'phi_assets_not_one_offs',
        'phi_pmf_before_build'
    ],
    automation: [
        'phi_human_decides_ai_runs',
        'phi_self_driving_with_guardrails',
        'phi_deterministic_guards',
        'phi_material_ambiguity_only'
    ],
    development: [
        'phi_story_drives_specs',
        'phi_dag_over_prompt',
        'phi_value_loop_compounds',
        'phi_learning_loop'
    ]
};

export class InfoSSOTService {
    constructor({ ontologyRegistry = null, pool = undefined } = {}) {
        this.databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
        this.pool = pool === undefined ? (this.databaseUrl ? new Pool({ connectionString: this.databaseUrl }) : null) : pool;
        this.ontologyRegistry = ontologyRegistry || new OntologyRegistry();
        if (!this.pool) {
            logger.warn('InfoSSOTService disabled: INFO_SSOT_DATABASE_URL is not set');
        }
    }

    assertReady() {
        if (!this.pool) {
            throw new Error('Info SSOT database is not configured');
        }
    }

    resolveOntology({ version, asOf } = {}) {
        return this.ontologyRegistry.resolve({ version, asOf });
    }

    describeOntology({ version, asOf } = {}) {
        const release = this.resolveOntology({ version, asOf });
        return {
            ...release.kernel.describe(),
            digest: release.digest,
            publication_verification: release.publicationVerification
        };
    }

    describeOntologyType(id, { version, asOf } = {}) {
        const { kernel } = this.resolveOntology({ version, asOf });
        return { id, ontology_version: kernel.version, definition: kernel.getType(id) };
    }

    describeOntologyRelation(id, { version, asOf } = {}) {
        const { kernel } = this.resolveOntology({ version, asOf });
        return { id, ontology_version: kernel.version, definition: kernel.getRelation(id) };
    }

    validateOntology({ version, asOf, snapshot, entity, edge } = {}) {
        const { kernel } = this.resolveOntology({ version, asOf });
        if (snapshot) return kernel.validateSnapshot(snapshot);
        if (entity) return kernel.validateEntity(entity);
        if (edge) return kernel.validateEdge(edge);
        throw new OntologyError('ONTOLOGY_INPUT_REQUIRED', 'snapshot, entity, or edge is required');
    }

    inferOntology({ version, asOf, snapshot } = {}) {
        if (!snapshot) throw new OntologyError('ONTOLOGY_INPUT_REQUIRED', 'snapshot is required');
        return this.resolveOntology({ version, asOf }).kernel.inferDecisions(snapshot);
    }

    impactOntology({ version, asOf, change, snapshot } = {}) {
        if (!change) throw new OntologyError('ONTOLOGY_INPUT_REQUIRED', 'change is required');
        return this.resolveOntology({ version, asOf }).kernel.impact({ change, snapshot });
    }

    interpretOntologyHistory({ version, asOf, snapshot } = {}) {
        if (!snapshot) throw new OntologyError('ONTOLOGY_INPUT_REQUIRED', 'snapshot is required');
        return this.ontologyRegistry.interpretHistory(snapshot, { version, asOf });
    }

    async commitOntologyGraph(access, input = {}, { client: externalClient, access_context_applied: accessContextApplied = false } = {}) {
        const { kernel } = this.ontologyRegistry.resolve();
        const entity = input.entity;
        const edges = Array.isArray(input.edges) ? input.edges : [];
        const contextEntities = Array.isArray(input.contextEntities) ? input.contextEntities : [];
        if (!entity || !input.projectCode) {
            throw new OntologyError('ONTOLOGY_INPUT_REQUIRED', 'entity and projectCode are required');
        }
        const roleMin = this.normalizeRole(input.roleMin);
        const sensitivity = this.normalizeSensitivity(input.sensitivity);
        this.assertWriteAccess(access, { projectCode: input.projectCode, roleMin, sensitivity });

        const commit = async (client) => {
            await lockProjectGraphIdentity(client, entity.id);
            const contextIds = [...new Set(contextEntities
                .map((item) => item?.id)
                .filter((id) => id && id !== entity.id))];
            if (contextIds.length) {
                const contextResult = await client.query(
                    `SELECT id, entity_type, payload
                     FROM graph_entities
                     WHERE id = ANY($1::text[])`,
                    [contextIds]
                );
                const persistedById = new Map(contextResult.rows.map((row) => [row.id, row]));
                const missingEndpointIds = contextIds.filter((id) => !persistedById.has(id));
                if (missingEndpointIds.length) {
                    throw new OntologyError('ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND', 'Graph edge endpoints must exist and be visible', {
                        missing_endpoint_ids: missingEndpointIds
                    });
                }
                const typeMismatches = contextEntities
                    .filter((item) => item?.id && item.id !== entity.id)
                    .filter((item) => {
                        const declaredType = item.type || item.entity_type;
                        return declaredType && declaredType !== persistedById.get(item.id)?.entity_type;
                    })
                    .map((item) => ({
                        id: item.id,
                        declared_type: item.type || item.entity_type,
                        persisted_type: persistedById.get(item.id)?.entity_type
                    }));
                if (typeMismatches.length) {
                    throw new OntologyError('ONTOLOGY_CONTEXT_ENTITY_TYPE_MISMATCH', 'Context entity types must match the canonical Graph', {
                        mismatches: typeMismatches
                    });
                }
            }
            await this.validateGraphMutation(client, {
                entityOverrides: [{
                    id: entity.id,
                    type: entity.type || entity.entity_type,
                    payload: entity.payload || {}
                }],
                edgeOverrides: edges.map((edge) => ({
                    from_id: edge.from_id,
                    to_id: edge.to_id,
                    rel_type: edge.relation || edge.rel_type
                })),
                validationEntityIds: [entity.id]
            });
            const projectId = await this.ensureProject(client, {
                projectCode: input.projectCode,
                projectName: input.projectName
            });
            await this.upsertGraphEntity(client, {
                id: entity.id,
                entityType: entity.type || entity.entity_type,
                projectId,
                payload: entity.payload || {},
                roleMin,
                sensitivity
            });
            for (const edge of edges) {
                await this.upsertGraphEdge(client, {
                    fromId: edge.from_id,
                    toId: edge.to_id,
                    relType: edge.relation || edge.rel_type,
                    projectId,
                    payload: edge.payload || {},
                    roleMin,
                    sensitivity,
                    aggregatePrevalidated: true
                });
            }
            return {
                entity_id: entity.id,
                edge_count: edges.length,
                guard_status: 'active_current',
                ontology_version: kernel.version
            };
        };
        if (externalClient && accessContextApplied) return commit(externalClient);
        if (externalClient) return this.withAccessContext(access, commit, { client: externalClient });
        return this.withAccessContext(access, commit);
    }

    async auditOntology(access, { limit = 500, cursor = null } = {}) {
        const { kernel } = this.ontologyRegistry.resolve();
        const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
        return this.withAccessContext(access, async (client) => {
            const entities = [];
            const edges = [];
            let entityCursor = cursor?.entity_id || null;
            let edgeCursor = cursor?.edge || null;
            let completedCursorCount = 0;
            let failurePosition = null;
            const roleRank = this.getRoleRank(access.role);
            try {
                while (true) {
                    failurePosition = { phase: 'entities', cursor: entityCursor };
                    const result = await client.query(
                        `SELECT ge.id, ge.entity_type AS type, ge.payload
                         FROM graph_entities ge
                         LEFT JOIN projects entity_project ON entity_project.id=ge.project_id
                         WHERE ($1::text IS NULL OR ge.id > $1)
                           AND ge.sensitivity=ANY($3)
                           AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
                           AND (
                             entity_project.code=ANY($5)
                             OR (ge.project_id IS NULL AND ge.entity_type='person' AND EXISTS (
                               SELECT 1 FROM graph_edges membership
                               JOIN projects membership_project ON membership_project.id=membership.project_id
                               WHERE membership.from_id=ge.id AND membership.rel_type='member_of'
                                 AND membership.lifecycle_status='active' AND membership_project.code=ANY($5)
                                 AND membership.sensitivity=ANY($3)
                                 AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
                             ))
                           )
                         ORDER BY ge.id
                         LIMIT $2`,
                        [entityCursor, safeLimit, access.clearance, roleRank, access.projectCodes]
                    );
                    entities.push(...result.rows);
                    completedCursorCount += 1;
                    if (result.rows.length < safeLimit) break;
                    entityCursor = result.rows.at(-1).id;
                }
                while (true) {
                    failurePosition = { phase: 'edges', cursor: edgeCursor };
                    const result = await client.query(
                        `SELECT id, from_id, to_id, rel_type AS relation, payload
                         FROM graph_edges ge
                         WHERE ($1::text IS NULL OR (ge.from_id, ge.to_id, ge.rel_type, ge.id) > ($1::text, $2::text, $3::text, $4::text))
                           AND ge.sensitivity=ANY($5)
                           AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $6
                           AND (NOT (ge.payload ? 'target_project_code') OR ge.payload->>'target_project_code'=ANY($7))
                           AND 2 = (
                             SELECT COUNT(DISTINCT endpoint.id)
                             FROM graph_entities endpoint
                             LEFT JOIN projects endpoint_project ON endpoint_project.id=endpoint.project_id
                             WHERE endpoint.id IN (ge.from_id, ge.to_id)
                               AND endpoint.sensitivity=ANY($5)
                               AND (CASE endpoint.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $6
                               AND (
                                 endpoint_project.code=ANY($7)
                                 OR (endpoint.project_id IS NULL AND endpoint.entity_type='person' AND EXISTS (
                                   SELECT 1 FROM graph_edges membership
                                   JOIN projects membership_project ON membership_project.id=membership.project_id
                                   WHERE membership.from_id=endpoint.id AND membership.rel_type='member_of'
                                     AND membership.lifecycle_status='active' AND membership_project.code=ANY($7)
                                     AND membership.sensitivity=ANY($5)
                                     AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $6
                                 ))
                               )
                           )
                         ORDER BY ge.from_id, ge.to_id, ge.rel_type, ge.id
                         LIMIT $8`,
                        [
                            edgeCursor?.from_id || null,
                            edgeCursor?.to_id || null,
                            edgeCursor?.relation || null,
                            edgeCursor?.id || null,
                            access.clearance,
                            roleRank,
                            access.projectCodes,
                            safeLimit
                        ]
                    );
                    edges.push(...result.rows);
                    completedCursorCount += 1;
                    if (result.rows.length < safeLimit) break;
                    const last = result.rows.at(-1);
                    edgeCursor = { id: last.id, from_id: last.from_id, to_id: last.to_id, relation: last.relation };
                }
                const validation = kernel.validateSnapshot({ entities, edges, complete: true });
                return {
                    ...validation,
                    completeness: {
                        status: 'complete',
                        entity_count: entities.length,
                        edge_count: edges.length,
                        limit: safeLimit,
                        cursor,
                        next_cursor: null,
                        completed_cursor_count: completedCursorCount,
                        failure_position: null,
                        failure: null
                    }
                };
            } catch (error) {
                return {
                    valid: false,
                    verification: 'unverified',
                    ontology_version: kernel.version,
                    violations: [],
                    completeness: {
                        status: 'failed',
                        entity_count: entities.length,
                        edge_count: edges.length,
                        limit: safeLimit,
                        cursor,
                        next_cursor: failurePosition?.phase === 'entities'
                            ? { entity_id: failurePosition.cursor, edge: cursor?.edge || null }
                            : { entity_id: entityCursor, edge: failurePosition?.cursor || null },
                        completed_cursor_count: completedCursorCount,
                        failure_position: failurePosition,
                        failure: error instanceof Error ? error.message : String(error)
                    }
                };
            }
        });
    }

    async authorizeOntologyPublication(access, input = {}) {
        const requiredFields = [
            'release_version',
            'source_commit_sha',
            'release_digest',
            'decision_id',
            'scope_entity_id',
            'impact_scope',
            'proposer_entity_id',
            'decider_entity_id',
            'applier_entity_id'
        ];
        const missing = requiredFields.filter((field) => !input[field]);
        if (missing.length || !/^[a-f0-9]{40}$/.test(input.source_commit_sha || '')) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_INPUT_INVALID', 'Publication authorization input is invalid', {
                http_status: 400,
                missing,
                source_commit_sha_valid: /^[a-f0-9]{40}$/.test(input.source_commit_sha || '')
            });
        }
        if (!access?.personId) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_UNAUTHENTICATED', 'Authenticated principal is not bound to a person', {
                http_status: 401
            });
        }
        if (input.applier_entity_id && access.personId !== input.applier_entity_id) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_FORBIDDEN', 'Requested applier does not match the authenticated actor', {
                http_status: 403
            });
        }
        let release;
        try {
            release = this.ontologyRegistry.resolve({ version: input.release_version });
        } catch (error) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_BINDING_MISMATCH', error.message, { http_status: 409 });
        }
        if (release.digest !== input.release_digest) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_BINDING_MISMATCH', 'Release digest does not match the immutable release', {
                http_status: 409,
                expected: release.digest,
                actual: input.release_digest
            });
        }
        const privateKey = process.env.ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n');
        const keyId = process.env.ONTOLOGY_PUBLICATION_SIGNING_KEY_ID;
        if (!this.pool || !privateKey || !keyId) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_DEPENDENCY_UNAVAILABLE', 'Graph authority or signing key is unavailable', {
                http_status: 503
            });
        }

        return this.withAccessContext(access, async (client) => {
            const decisionResult = await client.query(
                `SELECT payload FROM graph_entities
                 WHERE id = $1 AND entity_type = 'decision'
                 LIMIT 1`,
                [input.decision_id]
            );
            if (!decisionResult.rows.length) {
                throw new OntologyError('ONTOLOGY_PUBLICATION_DECISION_NOT_FOUND', 'Publication Decision was not found', {
                    http_status: 404,
                    decision_id: input.decision_id
                });
            }
            const decision = decisionResult.rows[0].payload || {};
            const bindings = {
                ontology_release_version: input.release_version,
                ontology_release_digest: input.release_digest,
                ontology_source_commit_sha: input.source_commit_sha,
                ontology_proposer_entity_id: input.proposer_entity_id,
                ontology_decider_entity_id: input.decider_entity_id
            };
            const mismatches = Object.entries(bindings).filter(([key, value]) => decision[key] !== value).map(([key]) => key);
            if (canonicalJson(decision.ontology_impact_scope) !== canonicalJson(input.impact_scope)) mismatches.push('ontology_impact_scope');
            if (mismatches.length) {
                throw new OntologyError('ONTOLOGY_PUBLICATION_BINDING_MISMATCH', 'Decision bindings do not match the publication request', {
                    http_status: 409,
                    mismatches
                });
            }
            const scopeEntityId = decision.ontology_scope_entity_id;
            if (!scopeEntityId) {
                throw new OntologyError('ONTOLOGY_PUBLICATION_BINDING_MISMATCH', 'Decision does not bind an ontology scope', {
                    http_status: 409,
                    mismatches: ['ontology_scope_entity_id']
                });
            }
            if (input.scope_entity_id && input.scope_entity_id !== scopeEntityId) {
                throw new OntologyError('ONTOLOGY_PUBLICATION_BINDING_MISMATCH', 'Requested scope does not match the Decision binding', {
                    http_status: 409,
                    mismatches: ['ontology_scope_entity_id']
                });
            }
            const authorityResult = await client.query(
                `WITH required_assignment(lane, person_id, role_code) AS (
                    VALUES ('proposer'::text, $1::text, 'R'::text),
                           ('decider'::text, $2::text, 'A'::text),
                           ('applier'::text, $3::text, 'A'::text)
                 )
                 SELECT 1
                 FROM required_assignment required
                 JOIN graph_entities r ON TRUE
                 JOIN graph_edges assigned ON assigned.from_id = r.id
                    AND assigned.rel_type = 'assigned_to'
                    AND assigned.to_id = required.person_id
                 JOIN graph_edges scoped ON scoped.from_id = r.id
                    AND scoped.rel_type IN ('belongs_to', 'belongs_to_project', 'accountable_for')
                    AND scoped.to_id = $4
                 WHERE r.entity_type IN ('raci', 'raci_assignment')
                   AND COALESCE(r.payload->>'lane', '') = required.lane
                   AND CASE required.role_code
                       WHEN 'R' THEN COALESCE(r.payload->>'role_code', r.payload->>'role') IN ('R', 'responsible', 'Responsible')
                       WHEN 'A' THEN COALESCE(r.payload->>'role_code', r.payload->>'role') IN ('A', 'accountable', 'Accountable')
                   END
                 GROUP BY required.lane, required.person_id, required.role_code
                 HAVING COUNT(*) > 0`,
                [input.proposer_entity_id, input.decider_entity_id, access.personId, scopeEntityId]
            );
            if (authorityResult.rows.length !== 3) {
                throw new OntologyError('ONTOLOGY_PUBLICATION_FORBIDDEN', 'Proposer, decider, and applier RACI authority was not confirmed for the scope', {
                    http_status: 403,
                    scope_entity_id: scopeEntityId
                });
            }
            const payload = {
                schema_version: ONTOLOGY_PUBLICATION_RECEIPT_SCHEMA_VERSION,
                issued_at: new Date().toISOString(),
                actor_entity_id: access.personId,
                applier_entity_id: access.personId,
                proposer_entity_id: input.proposer_entity_id,
                decider_entity_id: input.decider_entity_id,
                impact_scope: input.impact_scope,
                decision_id: input.decision_id,
                release_digest: input.release_digest,
                release_version: input.release_version,
                scope_entity_id: scopeEntityId,
                source_commit_sha: input.source_commit_sha
            };
            return {
                payload,
                signature_algorithm: 'ed25519',
                signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
                key_id: keyId
            };
        });
    }

    getOntologyGuard() {
        if (!this.ontologyRegistry.hasCurrent()) {
            return { guard_status: 'inactive_no_current', ontology_version: null };
        }
        const { kernel } = this.ontologyRegistry.resolve();
        return { guard_status: 'active_current', ontology_version: kernel.version };
    }

    assertOntologyValid(result) {
        if (!result.valid) {
            throw new OntologyError('ONTOLOGY_VALIDATION_FAILED', 'Graph write violates the current ontology', {
                ontology_version: result.ontology_version,
                violations: result.violations
            });
        }
    }

    async validateGraphMutation(client, {
        entityOverrides = [],
        edgeOverride = null,
        edgeOverrides = [],
        validationEntityIds = []
    }) {
        if (!this.ontologyRegistry.hasCurrent()) return;
        const mutationEdges = [
            ...edgeOverrides,
            ...(edgeOverride ? [edgeOverride] : [])
        ];
        const targetIds = Array.from(new Set([
            ...validationEntityIds,
            ...entityOverrides.map((entity) => entity.id),
            ...mutationEdges.flatMap((edge) => [edge.from_id, edge.to_id])
        ].filter(Boolean))).sort();
        // Row locks cannot serialize two transactions that are both creating
        // the same previously absent entity. Lock the logical aggregate keys
        // first so the later transaction re-reads the committed edge set.
        for (const targetId of targetIds) {
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [`ontology-aggregate:${targetId}`]
            );
        }
        // Serialize mutations that share an endpoint before reading its current
        // edges, so concurrent cardinality checks cannot both observe stale data.
        await client.query(
            `SELECT id
             FROM graph_entities
             WHERE id = ANY($1::text[])
             ORDER BY id
             FOR UPDATE`,
            [targetIds]
        );
        const edgeResult = await client.query(
            `SELECT id, from_id, to_id, rel_type
             FROM graph_edges
             WHERE from_id = ANY($1::text[]) OR to_id = ANY($1::text[])`,
            [targetIds]
        );
        const edges = edgeResult.rows.map((edge) => ({ ...edge, relation: edge.rel_type }));
        for (const mutationEdge of mutationEdges) {
            const existingIndex = edges.findIndex((edge) => edge.from_id === mutationEdge.from_id
                && edge.to_id === mutationEdge.to_id
                && edge.rel_type === mutationEdge.rel_type);
            if (existingIndex >= 0) {
                edges[existingIndex] = { ...edges[existingIndex], ...mutationEdge, relation: mutationEdge.rel_type };
            } else {
                edges.push({ ...mutationEdge, relation: mutationEdge.rel_type });
            }
        }
        const entityIds = Array.from(new Set([
            ...targetIds,
            ...edges.flatMap((edge) => [edge.from_id, edge.to_id])
        ]));
        const entityResult = await client.query(
            `SELECT id, entity_type, payload
             FROM graph_entities
             WHERE id = ANY($1::text[])
             ORDER BY id
             FOR UPDATE`,
            [entityIds]
        );
        const entities = new Map(entityResult.rows.map((entity) => [entity.id, {
            id: entity.id,
            type: entity.entity_type,
            payload: entity.payload || {}
        }]));
        for (const entity of entityOverrides) entities.set(entity.id, entity);
        const missingEndpointIds = entityIds.filter((id) => !entities.has(id));
        if (missingEndpointIds.length) {
            throw new OntologyError('ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND', 'Graph edge endpoints must exist and be visible', {
                missing_endpoint_ids: missingEndpointIds
            });
        }
        const { kernel } = this.ontologyRegistry.resolve();
        this.assertOntologyValid(kernel.validateSnapshot({
            entities: Array.from(entities.values()),
            edges,
            validation_entity_ids: validationEntityIds,
            complete: true
        }));
    }

    generateId(prefix) {
        return `${prefix}_${ulid()}`;
    }

    async upsertGraphEntity(client, { id, entityType, projectId, payload, roleMin, sensitivity }) {
        if (this.ontologyRegistry.hasCurrent()) {
            const { kernel } = this.ontologyRegistry.resolve();
            this.assertOntologyValid(kernel.validateEntity(
                { id, type: entityType, payload: payload || {} },
                { deferRequiredRelations: true }
            ));
        }
        await assertCatalogProjectSubjectMutation(client, {
            id,
            entityType,
            projectId,
            payload,
            allowCompatible: false
        });
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
                version = graph_entities.version + 1,
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

    async upsertGraphEdge(client, {
        fromId,
        toId,
        relType,
        projectId,
        payload,
        roleMin,
        sensitivity,
        aggregatePrevalidated = false
    }) {
        if (this.ontologyRegistry.hasCurrent() && !aggregatePrevalidated) {
            await this.validateGraphMutation(client, { edgeOverride: {
                from_id: fromId,
                to_id: toId,
                rel_type: relType
            }, validationEntityIds: [fromId, toId] });
        }
        const endpointProjects = await client.query(
            `SELECT id, project_id FROM graph_entities WHERE id = ANY($1::text[])`,
            [[fromId, toId]]
        );
        if (endpointProjects.rows.length !== new Set([fromId, toId]).size) {
            throw new Error('Graph edge endpoint is missing');
        }
        if (endpointProjects.rows.some((endpoint) => endpoint.project_id && endpoint.project_id !== projectId)) {
            const error = new Error('Cross-project edge writes require Graph Maintenance');
            error.code = 'GRAPH_CROSS_PROJECT_WRITE_REQUIRES_MAINTENANCE';
            error.status = 409;
            throw error;
        }
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
                version = graph_edges.version + 1,
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
            case 'glossary_term':
                return payload.term || record.id;
            case 'kpi':
                return payload.metric_name || record.id;
            case 'initiative':
                return payload.title || record.id;
            case 'speaking':
                return payload.session_title || payload.event || record.id;
            case 'media_appearance':
                return payload.program || payload.medium || record.id;
            case 'role_assignment':
                return `${payload.role || ''}@${payload.org || ''}`.replace(/^@|@$/g, '') || record.id;
            case 'product':
                return payload.name || record.id;
            case 'publication':
                return payload.title || record.id;
            case 'press_mention':
                return `${payload.medium || ''}: ${payload.content || ''}`.replace(/^:\s*|\s*:$/g, '') || record.id;
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
                case 'glossary_term':
                    return `Glossary: ${payload.term || record.id} - ${payload.description || ''}`;
                case 'kpi':
                    return `KPI: ${payload.metric_name || record.id} (target: ${payload.target_value || 'N/A'}, current: ${payload.current_value || 'N/A'})`;
                case 'initiative':
                    return `Initiative: ${payload.title || record.id} (${payload.status || 'planned'})`;
                case 'speaking':
                    return `Speaking: ${payload.date || ''} ${payload.event || ''} - 「${payload.session_title || ''}」`;
                case 'media_appearance':
                    return `Media: ${payload.medium || ''} / ${payload.program || ''}`;
                case 'role_assignment':
                    return `Role: ${payload.role || ''}@${payload.org || ''} (${payload.period || ''})`;
                case 'product':
                    return `Product: ${payload.name || ''} [${payload.status || ''}]`;
                case 'publication':
                    return `Publication: 『${payload.title || ''}』 ${(payload.authors || []).join('/')}`;
                case 'press_mention':
                    return `Press: ${payload.date || ''} ${payload.medium || ''} - ${payload.content || ''}`;
                default:
                    return `${record.entity_type || 'entity'}: ${payload.title || payload.name || record.id}`;
            }
        });
    }

    async summarizeEdges(client, access, records) {
        const idSet = new Set();
        for (const record of records) {
            if (record.from_id) idSet.add(record.from_id);
            if (record.to_id) idSet.add(record.to_id);
        }
        const ids = Array.from(idSet);
        const labelMap = new Map();
        if (ids.length) {
            const roleRank = this.getRoleRank(access.role);
            const { rows } = await client.query(
                `SELECT ge.id, ge.entity_type, ge.payload
                 FROM graph_entities ge LEFT JOIN projects p ON p.id=ge.project_id
                 WHERE ge.id=ANY($1) AND (
                   p.code=ANY($2)
                   OR (ge.project_id IS NULL AND ge.entity_type='person' AND EXISTS (
                     SELECT 1 FROM graph_edges membership
                     JOIN projects membership_project ON membership_project.id=membership.project_id
                     WHERE membership.from_id=ge.id AND membership.rel_type='member_of'
                       AND membership.lifecycle_status='active' AND membership_project.code=ANY($2)
                       AND membership.sensitivity=ANY($3)
                       AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
                   ))
                 )
                   AND ge.sensitivity=ANY($3)
                   AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4`,
                [ids, access.projectCodes, access.clearance, roleRank]
            );
            for (const row of rows) {
                labelMap.set(row.id, this.formatEntityLabel(row));
            }
        }
        return records.filter(record => (
            labelMap.has(record.from_id) && labelMap.has(record.to_id)
        )).map(record => {
            const fromLabel = labelMap.get(record.from_id);
            const toLabel = labelMap.get(record.to_id);
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
        const glossaryItems = (byType.glossary_term || []).map(node => ({
            id: node.id,
            term: node.payload?.term || null,
            reading: node.payload?.reading || null,
            correct_form: node.payload?.correct_form || null,
            incorrect_forms: node.payload?.incorrect_forms || null,
            category: node.payload?.category || null,
            description: node.payload?.description || null
        }));
        const kpiItems = (byType.kpi || []).map(node => ({
            id: node.id,
            metric_name: node.payload?.metric_name || null,
            target_value: node.payload?.target_value || null,
            current_value: node.payload?.current_value || null,
            unit: node.payload?.unit || null,
            period: node.payload?.period || null
        }));
        const initiativeItems = (byType.initiative || []).map(node => ({
            id: node.id,
            title: node.payload?.title || null,
            status: node.payload?.status || null,
            start_date: node.payload?.start_date || null,
            end_date: node.payload?.end_date || null
        }));
        const speakingItems = (byType.speaking || []).map(node => ({
            id: node.id,
            date: node.payload?.date || null,
            event: node.payload?.event || null,
            session_title: node.payload?.session_title || null,
            venue: node.payload?.venue || null,
            attendance: node.payload?.attendance || null,
            slides_url: node.payload?.slides_url || null
        }));
        const mediaItems = (byType.media_appearance || []).map(node => ({
            id: node.id,
            date: node.payload?.date || null,
            medium: node.payload?.medium || null,
            program: node.payload?.program || null,
            format: node.payload?.format || null,
            url: node.payload?.url || null
        }));
        const roleAssignmentItems = (byType.role_assignment || []).map(node => ({
            id: node.id,
            org: node.payload?.org || null,
            role: node.payload?.role || null,
            period: node.payload?.period || null,
            start_date: node.payload?.start_date || null
        }));
        const productItems = (byType.product || []).map(node => ({
            id: node.id,
            name: node.payload?.name || null,
            status: node.payload?.status || null,
            role: node.payload?.role || null,
            url: node.payload?.url || null,
            summary: node.payload?.summary || null
        }));
        const publicationItems = (byType.publication || []).map(node => ({
            id: node.id,
            title: node.payload?.title || null,
            authors: node.payload?.authors || null,
            format: node.payload?.format || null,
            achievement: node.payload?.achievement || null,
            url: node.payload?.url || null
        }));
        const pressItems = (byType.press_mention || []).map(node => ({
            id: node.id,
            date: node.payload?.date || null,
            medium: node.payload?.medium || null,
            section: node.payload?.section || null,
            content: node.payload?.content || null
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
                { title: 'Projects', items: projectItems },
                { title: 'Glossary', items: glossaryItems },
                { title: 'KPIs', items: kpiItems },
                { title: 'Initiatives', items: initiativeItems },
                { title: 'Speaking', items: speakingItems },
                { title: 'Media', items: mediaItems },
                { title: 'Role Assignments', items: roleAssignmentItems },
                { title: 'Products', items: productItems },
                { title: 'Publications', items: publicationItems },
                { title: 'Press', items: pressItems }
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

    async withAccessContext(access, handler, { client: externalClient, requireCanonicalTenant = false } = {}) {
        this.assertReady();
        // Info SSOT predates organization-scoped RLS. Keep its established
        // generic context contract intact; callers that own a tenant boundary
        // must opt in explicitly instead of silently changing every consumer.
        const organizationId = requireCanonicalTenant
            ? requireCanonicalTenantIdentity(access)
            : (access.organizationId || access.tenantId || '');
        const client = externalClient || await this.pool.connect();
        const ownsTransaction = !externalClient;
        try {
            if (ownsTransaction) await client.query('BEGIN');
            await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role]);
            await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', access.projectCodes.join(',')]);
            await client.query('SELECT set_config($1, $2, true)', ['app.clearance', access.clearance.join(',')]);
            await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
            await client.query('SELECT set_config($1, $2, true)', ['app.graph_maintenance_mode', access.graphMaintenanceMode === true ? 'true' : 'false']);
            const result = await handler(client);
            if (ownsTransaction) await client.query('COMMIT');
            return result;
        } catch (error) {
            if (ownsTransaction) await client.query('ROLLBACK');
            throw error;
        } finally {
            if (ownsTransaction) client.release();
        }
    }

    async fetchGraphEntities(client, access, { projectCode, entityType, query, limit, includeMerged } = {}) {
        const roleRank = this.getRoleRank(access.role);
        const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
        const trimmedQuery = typeof query === 'string' ? query.trim() : '';
        const compactQuery = trimmedQuery.replace(/\s+/g, '');
        const includeMergedEntities = isTrue(includeMerged);
        const { rows } = await client.query(
            `SELECT ge.*,
                    p.code AS project_code,
                    ARRAY(
                      SELECT DISTINCT px.code
                      FROM graph_edges gx
                      JOIN projects px ON px.id = gx.project_id
                      WHERE gx.from_id = ge.id
                        AND gx.rel_type = 'member_of'
                        AND gx.lifecycle_status = 'active'
                        AND px.code = ANY($3)
                        AND gx.sensitivity = ANY($4)
                        AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                      ORDER BY px.code
                    ) AS member_of_project_codes,
                    ARRAY(
                      SELECT DISTINCT gx.project_id::text
                      FROM graph_edges gx
                      JOIN projects px ON px.id = gx.project_id
                      WHERE gx.from_id = ge.id
                        AND gx.rel_type = 'member_of'
                        AND gx.lifecycle_status = 'active'
                        AND px.code = ANY($3)
                        AND gx.sensitivity = ANY($4)
                        AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                      ORDER BY gx.project_id::text
                    ) AS member_of_project_ids
             FROM graph_entities ge
             LEFT JOIN projects p ON p.id = ge.project_id
             WHERE COALESCE(ge.payload->>'searchable', 'true') <> 'false'
               AND ($8::boolean = true OR LOWER(COALESCE(ge.payload->>'status', '')) <> 'merged')
               AND (
               $1::text IS NULL
               OR p.code = $1
               OR (
                 ge.entity_type = 'person' AND EXISTS (
                   SELECT 1
                   FROM graph_edges gx
                   JOIN projects px ON px.id = gx.project_id
                     WHERE gx.from_id = ge.id
                       AND gx.rel_type = 'member_of'
                       AND gx.lifecycle_status = 'active'
                       AND gx.sensitivity = ANY($4)
                       AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
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
                       AND gy.lifecycle_status = 'active'
                       AND gy.sensitivity = ANY($4)
                       AND (CASE gy.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                       AND py.code = ANY($3)
                   )
                 )
               )
               AND ge.sensitivity = ANY($4)
               AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
               AND (
                 $6::text IS NULL
                 OR ge.payload::text ILIKE '%' || $6 || '%'
                 OR REPLACE(COALESCE(ge.payload->>'name', ''), ' ', '') ILIKE '%' || $7 || '%'
                 OR EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements_text(COALESCE(ge.payload->'aliases', '[]'::jsonb)) alias
                   WHERE alias ILIKE '%' || $6 || '%'
                      OR REPLACE(alias, ' ', '') ILIKE '%' || $7 || '%'
                 )
               )
             ORDER BY ge.updated_at DESC
             LIMIT $9`,
            [
                projectCode || null,
                entityType || null,
                access.projectCodes,
                access.clearance,
                roleRank,
                trimmedQuery || null,
                compactQuery || null,
                includeMergedEntities,
                safeLimit
            ]
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
               AND (
                 NOT (ge.payload ? 'target_project_code')
                 OR ge.payload->>'target_project_code'=ANY($5)
               )
               AND EXISTS (
                   SELECT 1 FROM graph_entities source_entity
                   LEFT JOIN projects source_project ON source_project.id=source_entity.project_id
                   JOIN graph_entities target_entity ON target_entity.id=ge.to_id
                   LEFT JOIN projects target_project ON target_project.id=target_entity.project_id
                   WHERE source_entity.id=ge.from_id
                     AND app_graph_entity_organization_id(source_entity.id) IS NOT NULL
                     AND app_graph_entity_organization_id(target_entity.id) IS NOT NULL
                     AND (
                       app_graph_entity_organization_id(source_entity.id)
                         IS NOT DISTINCT FROM app_graph_entity_organization_id(target_entity.id)
                       OR (
                         ge.rel_type='governs'
                         AND ge.payload->>'cross_tenant'='true'
                         AND ge.role_min='ceo'
                         AND ge.sensitivity='restricted'
                         AND ge.payload->>'target_project_code'=target_project.code
                       )
                     )
                   )
               AND EXISTS (
                 SELECT 1
                 FROM graph_entities endpoint
                 LEFT JOIN projects endpoint_project ON endpoint_project.id=endpoint.project_id
                 WHERE endpoint.id=ge.from_id
                   AND endpoint.sensitivity=ANY($6)
                   AND (CASE endpoint.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $7
                   AND (
                     endpoint_project.code=ANY($5)
                     OR (endpoint.project_id IS NULL AND endpoint.entity_type='person' AND EXISTS (
                       SELECT 1 FROM graph_edges membership
                       JOIN projects membership_project ON membership_project.id=membership.project_id
                       WHERE membership.from_id=endpoint.id AND membership.rel_type='member_of'
                         AND membership.lifecycle_status='active' AND membership_project.code=ANY($5)
                         AND membership.sensitivity=ANY($6)
                         AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $7
                     ))
                   )
               )
               AND EXISTS (
                 SELECT 1
                 FROM graph_entities endpoint
                 LEFT JOIN projects endpoint_project ON endpoint_project.id=endpoint.project_id
                 WHERE endpoint.id=ge.to_id
                   AND endpoint.sensitivity=ANY($6)
                   AND (CASE endpoint.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $7
                   AND (
                     endpoint_project.code=ANY($5)
                     OR (endpoint.project_id IS NULL AND endpoint.entity_type='person' AND EXISTS (
                       SELECT 1 FROM graph_edges membership
                       JOIN projects membership_project ON membership_project.id=membership.project_id
                       WHERE membership.from_id=endpoint.id AND membership.rel_type='member_of'
                         AND membership.lifecycle_status='active' AND membership_project.code=ANY($5)
                         AND membership.sensitivity=ANY($6)
                         AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $7
                     ))
                   )
               )
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
            `SELECT ge.*,
                    p.code AS project_code,
                    ARRAY(
                      SELECT DISTINCT px.code
                      FROM graph_edges gx
                      JOIN projects px ON px.id = gx.project_id
                      WHERE gx.from_id = ge.id
                        AND gx.rel_type = 'member_of'
                        AND gx.lifecycle_status = 'active'
                        AND px.code = ANY($3)
                        AND gx.sensitivity = ANY($4)
                        AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                      ORDER BY px.code
                    ) AS member_of_project_codes,
                    ARRAY(
                      SELECT DISTINCT gx.project_id::text
                      FROM graph_edges gx
                      JOIN projects px ON px.id = gx.project_id
                      WHERE gx.from_id = ge.id
                        AND gx.rel_type = 'member_of'
                        AND gx.lifecycle_status = 'active'
                        AND px.code = ANY($3)
                        AND gx.sensitivity = ANY($4)
                        AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                      ORDER BY gx.project_id::text
                    ) AS member_of_project_ids
             FROM graph_entities ge
             LEFT JOIN projects p ON p.id = ge.project_id
             WHERE ge.id = ANY($1)
               AND COALESCE(ge.payload->>'searchable', 'true') <> 'false'
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
                       AND gx.lifecycle_status = 'active'
                       AND gx.sensitivity = ANY($4)
                       AND (CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
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
                       AND gy.lifecycle_status = 'active'
                       AND gy.sensitivity = ANY($4)
                       AND (CASE gy.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
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

    async fetchGraphAliasTargetsByIds(client, access, { ids, entityType }) {
        const roleRank = this.getRoleRank(access.role);
        if (!ids?.length || !['org', 'person'].includes(entityType)) return [];
        const { rows } = await client.query(
            `SELECT ge.id AS alias_id,
                    ge.payload->>'canonical_entity_id' AS canonical_entity_id
             FROM graph_entities ge
             WHERE ge.id = ANY($1)
               AND ge.entity_type = $2
               AND ge.sensitivity = ANY($3)
               AND (CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $4
               AND NULLIF(ge.payload->>'canonical_entity_id', '') IS NOT NULL
             ORDER BY ge.updated_at DESC`,
            [ids, `${entityType}_alias`, access.clearance, roleRank]
        );
        return rows;
    }

    async ensureProject(client, { projectCode, projectName }) {
        const { rows } = await client.query(
            `SELECT id FROM projects
             WHERE code = $1
               AND (organization_id IS NULL OR organization_id = NULLIF(current_setting('app.organization_id', true), ''))
             LIMIT 1`,
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
        await lockProjectGraphIdentity(client, id);
        await client.query(
            `INSERT INTO projects (id, code, name, organization_id)
             VALUES ($1, $2, $3, NULLIF(current_setting('app.organization_id', true), ''))`,
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

    async ensurePerson(client, { personId, personName, aliases = [], email = '' }) {
        if (personId) {
            return personId;
        }
        if (!personName || typeof personName !== 'string') {
            throw new Error('personId or personName is required');
        }

        const trimmed = personName.trim();
        const identityNames = Array.from(new Set(
            [trimmed, ...(Array.isArray(aliases) ? aliases : [])]
                .map((value) => String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase())
                .filter(Boolean)
        )).sort();
        const normalizedEmail = String(email || '').trim().toLocaleLowerCase();
        const identityKeys = [
            ...identityNames.map((value) => `name:${value}`),
            ...(normalizedEmail ? [`email:${normalizedEmail}`] : [])
        ].sort();

        for (const identityKey of identityKeys) {
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
                [`person:${identityKey}`]
            );
        }

        const { rows: aliased } = await client.query(
            `SELECT id FROM graph_entities
             WHERE entity_type = 'person'
             AND (
                 LOWER(REGEXP_REPLACE(COALESCE(payload->>'name', ''), '\\s+', '', 'g')) = ANY($1)
                 OR EXISTS (
                     SELECT 1 FROM jsonb_array_elements_text(COALESCE(payload->'aliases', '[]'::jsonb)) a
                     WHERE LOWER(REGEXP_REPLACE(a, '\\s+', '', 'g')) = ANY($1)
                 )
                 OR ($2 <> '' AND LOWER(BTRIM(COALESCE(payload->>'email', ''))) = $2)
             )
             ORDER BY id`,
            [identityNames, normalizedEmail]
        );
        if (aliased.length > 1) {
            throw new Error(`Ambiguous person identity: ${aliased.map((row) => row.id).join(', ')}`);
        }
        if (aliased.length === 1) {
            return aliased[0].id;
        }

        const { rows: legacy } = await client.query(
            "SELECT id FROM people WHERE LOWER(REGEXP_REPLACE(name, '\\s+', '', 'g')) = ANY($1) ORDER BY id",
            [identityNames]
        );
        if (legacy.length > 1) {
            throw new Error(`Ambiguous legacy person identity: ${legacy.map((row) => row.id).join(', ')}`);
        }
        if (legacy.length === 1) {
            const id = legacy[0].id;
            await this.upsertGraphEntity(client, {
                id,
                entityType: 'person',
                projectId: null,
                payload: { name: trimmed },
                roleMin: 'member',
                sensitivity: 'internal'
            });
            return id;
        }

        const id = this.generateId('per');
        await client.query(
            'INSERT INTO people (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
            [id, trimmed]
        );
        await this.upsertGraphEntity(client, {
            id,
            entityType: 'person',
            projectId: null,
            payload: { name: trimmed },
            roleMin: 'member',
            sensitivity: 'internal'
        });
        return id;
    }

    async createOrUpdatePerson(access, input = {}) {
        const name = String(input.name || input.displayName || input.display_name || '').trim();
        if (!name) {
            throw new Error('name is required');
        }

        const projectCode = String(input.projectCode || input.project_code || access.projectCodes?.[0] || 'brainbase').trim();
        const projectName = String(input.projectName || input.project_name || projectCode).trim();
        const roleMin = this.normalizeRole(input.roleMin || input.role_min || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        const aliases = Array.isArray(input.aliases)
            ? input.aliases.map((alias) => String(alias || '').trim()).filter(Boolean)
            : [];
        const email = String(input.email || '').trim().toLocaleLowerCase();
        const org = String(input.org || input.organization || '').trim();
        const role = String(input.role || '').trim();
        this.assertWriteAccess(access, { projectCode, roleMin, sensitivity });
        const guard = this.getOntologyGuard();

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, { projectCode, projectName });
            const personId = await this.ensurePerson(client, { personName: name, aliases, email });

            const { rows } = await client.query(
                'SELECT payload FROM graph_entities WHERE id = $1 AND entity_type = $2 LIMIT 1',
                [personId, 'person']
            );
            const currentPayload = rows[0]?.payload && typeof rows[0].payload === 'object' ? rows[0].payload : {};
            const mergedAliases = Array.from(new Set([
                ...(Array.isArray(currentPayload.aliases) ? currentPayload.aliases : []),
                ...aliases
            ].map((alias) => String(alias || '').trim()).filter(Boolean)));
            const payload = {
                ...currentPayload,
                name,
                display_name: name,
                aliases: mergedAliases,
                email: email || currentPayload.email || '',
                org: org || currentPayload.org || '',
                role: role || currentPayload.role || '',
                status: String(input.status || currentPayload.status || 'active').trim()
            };

            await this.upsertGraphEntity(client, {
                id: personId,
                entityType: 'person',
                projectId: null,
                payload,
                roleMin,
                sensitivity
            });
            await client.query(
                'INSERT INTO people (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
                [personId, name]
            );
            await this.upsertGraphEdge(client, {
                fromId: personId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: { source: 'companion_people_registration' },
                roleMin,
                sensitivity
            });

            return {
                entity_id: personId,
                person_id: personId,
                name,
                display_name: name,
                aliases: mergedAliases,
                email: payload.email,
                org: payload.org,
                role: payload.role,
                status: payload.status,
                source: 'graph_ssot',
                ...guard
            };
        });
    }

    async createOrUpdateGraphEntity(access, input) {
        const { id, entityType, projectCode, projectName, payload } = input;
        const roleMin = this.normalizeRole(input.roleMin);
        const sensitivity = this.normalizeSensitivity(input.sensitivity);

        if (!id || typeof id !== 'string') {
            throw new Error('id is required');
        }
        if (!entityType || typeof entityType !== 'string') {
            throw new Error('entityType is required');
        }
        if (!projectCode || typeof projectCode !== 'string') {
            throw new Error('projectCode is required');
        }

        this.assertWriteAccess(access, { projectCode, roleMin, sensitivity });

        const guard = this.getOntologyGuard();
        if (guard.guard_status === 'active_current') {
            const { kernel } = this.ontologyRegistry.resolve();
            this.assertOntologyValid(kernel.validateEntity(
                { id, type: entityType, payload: payload || {} },
                { deferRequiredRelations: true }
            ));
        }

        return this.withAccessContext(access, async (client) => {
            await lockProjectGraphIdentity(client, id);
            const projectId = await this.ensureProject(client, { projectCode, projectName });
            await this.validateGraphMutation(client, {
                entityOverrides: [{ id, type: entityType, payload: payload || {} }],
                validationEntityIds: [id]
            });
            await this.upsertGraphEntity(client, {
                id,
                entityType,
                projectId,
                payload,
                roleMin,
                sensitivity
            });
            return { entity_id: id, ...guard };
        });
    }

    async createOrUpdateGraphEdge(access, input) {
        const { fromId, toId, relType, projectCode, projectName, payload } = input;
        const roleMin = this.normalizeRole(input.roleMin);
        const sensitivity = this.normalizeSensitivity(input.sensitivity);

        if (!fromId || typeof fromId !== 'string') {
            throw new Error('fromId is required');
        }
        if (!toId || typeof toId !== 'string') {
            throw new Error('toId is required');
        }
        if (!relType || typeof relType !== 'string') {
            throw new Error('relType is required');
        }
        if (!projectCode || typeof projectCode !== 'string') {
            throw new Error('projectCode is required');
        }

        this.assertWriteAccess(access, { projectCode, roleMin, sensitivity });

        const guard = this.getOntologyGuard();
        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, { projectCode, projectName });
            await this.upsertGraphEdge(client, {
                fromId,
                toId,
                relType,
                projectId,
                payload,
                roleMin,
                sensitivity
            });
            return { from_id: fromId, to_id: toId, rel_type: relType, ...guard };
        });
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
        const guard = this.getOntologyGuard();

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
            const decidedAt = input.decidedAt || new Date().toISOString();
            const status = input.status || 'decided';
            const decisionPayload = {
                title: input.title,
                decision_domain: this.resolveDecisionDomain(input) || null,
                decided_at: decidedAt,
                status
            };

            if (guard.guard_status === 'active_current') {
                const { kernel } = this.ontologyRegistry.resolve();
                this.assertOntologyValid(kernel.validateSnapshot({
                    entities: [
                        { id: decisionId, type: 'decision', payload: decisionPayload },
                        { id: projectId, type: 'project', payload: {} },
                        { id: ownerPersonId, type: 'person', payload: {} }
                    ],
                    edges: [
                        { from_id: decisionId, to_id: projectId, relation: 'belongs_to_project' },
                        { from_id: decisionId, to_id: ownerPersonId, relation: 'owned_by' },
                        { from_id: ownerPersonId, to_id: projectId, relation: 'member_of' }
                    ],
                    complete: true
                }));
            }

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
                    decidedAt,
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
                    decidedAt,
                    status,
                    roleMin,
                    sensitivity,
                    eventId
                ]
            );

            await this.upsertGraphEntity(client, {
                id: decisionId,
                entityType: 'decision',
                projectId,
                payload: decisionPayload,
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
                sensitivity,
                aggregatePrevalidated: true
            });

            await this.upsertGraphEdge(client, {
                fromId: decisionId,
                toId: ownerPersonId,
                relType: 'owned_by',
                projectId,
                payload: {},
                roleMin,
                sensitivity,
                aggregatePrevalidated: true
            });

            await this.upsertGraphEdge(client, {
                fromId: ownerPersonId,
                toId: projectId,
                relType: 'member_of',
                projectId,
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal',
                aggregatePrevalidated: true
            });

            return { decision_id: decisionId, event_id: eventId, ...guard };
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
        const guard = this.getOntologyGuard();

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
            return { raci_id: raciId, event_id: eventId, ...guard };
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

    async listGraphEntities(access, {
        id,
        ids,
        projectCode,
        entityType,
        query,
        limit,
        includeMerged
    } = {}) {
        this.assertReady();
        const includeMergedEntities = isTrue(includeMerged);
        return this.withAccessContext(access, async (client) => {
            const entityIds = [
                ...(id ? [id] : []),
                ...(Array.isArray(ids) ? ids : [])
            ].filter(Boolean);
            if (entityIds.length) {
                const rows = await this.fetchGraphEntitiesByIds(client, access, { ids: entityIds, projectCode });
                if (!entityType) {
                    return includeMergedEntities ? rows : rows.filter((row) => !isMergedGraphEntity(row));
                }
                const canonicalRows = rows
                    .filter((row) => row.entity_type === entityType)
                    .filter((row) => includeMergedEntities || !isMergedGraphEntity(row));
                if (!['org', 'person'].includes(entityType)) return canonicalRows;
                const aliases = await this.fetchGraphAliasTargetsByIds(client, access, { ids: entityIds, entityType });
                const mergedPersonCanonicalIds = entityType === 'person'
                    ? rows
                        .filter((row) => row.entity_type === 'person' && isMergedGraphEntity(row))
                        .map(getCanonicalEntityId)
                        .filter(Boolean)
                    : [];
                const canonicalIds = [...new Set([
                    ...aliases.map((row) => row.canonical_entity_id).filter(Boolean),
                    ...mergedPersonCanonicalIds
                ])];
                const resolvedRows = canonicalIds.length
                    ? await this.fetchGraphEntitiesByIds(client, access, { ids: canonicalIds, projectCode })
                    : [];
                const mergedPersonIdsWithCanonical = new Set(
                    entityType === 'person'
                        ? rows
                            .filter((row) => row.entity_type === 'person' && isMergedGraphEntity(row) && getCanonicalEntityId(row))
                            .map((row) => row.id)
                        : []
                );
                return [...new Map(
                    [
                        ...canonicalRows.filter((row) => !mergedPersonIdsWithCanonical.has(row.id)),
                        ...resolvedRows
                            .filter((row) => row.entity_type === entityType)
                            .filter((row) => !isMergedGraphEntity(row))
                    ]
                        .map((row) => [row.id, row])
                ).values()];
            }
            const graphOptions = { projectCode, entityType, query, limit };
            if (includeMergedEntities) graphOptions.includeMerged = true;
            return this.fetchGraphEntities(client, access, graphOptions);
        });
    }

    async listGraphEdges(access, { projectCode, relType, fromId, toId }) {
        this.assertReady();
        return this.withAccessContext(access, async (client) => {
            return this.fetchGraphEdges(client, access, { projectCode, relType, fromId, toId });
        });
    }

    async getContext(access, {
        projectCode,
        entityTypes,
        limit,
        humanReadable,
        includeEdges,
        includePhilosophy,
        scope,
        objectType,
        operation,
        maxRecommended,
        includeMemory,
        memoryAccessContext
    }) {
        this.assertReady();
        if (!projectCode) {
            throw new Error('projectCode is required');
        }

        const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
        const types = this._parseEntityTypes(entityTypes);

        return this.withAccessContext(access, async (client) => {
            // 1. 全entityを並列取得
            const entityPromises = types.map(type =>
                this.fetchGraphEntities(client, access, {
                    projectCode,
                    entityType: type,
                    limit: safeLimit
                })
            );
            const entityArrays = await Promise.all(entityPromises);

            // 2. entityを種別ごとに整理
            const entities = this._groupEntitiesByType(entityArrays);

            // 3. エッジ取得（オプション）
            let edges = [];
            if (includeEdges) {
                edges = await this.fetchGraphEdges(client, access, {
                    projectCode,
                    limit: safeLimit
                });
            }

            // 4. LLM向け整形（オプション）
            let report = null;
            if (humanReadable) {
                const allNodes = Object.values(entities).flat();
                const summaryLines = includeEdges
                    ? await this.summarizeEdges(client, access, edges)
                    : [];
                report = this.buildHumanReport({
                    seedId: null,
                    projectCode,
                    nodes: allNodes,
                    edges,
                    summaryLines
                });
            }

            // 5. メタ情報
            const meta = {
                project_code: projectCode,
                timestamp: new Date().toISOString(),
                entity_count: this._countEntities(entities)
            };

            const result = { entities, edges, report, meta };
            if (includeMemory) {
                const graphRecords = await this.fetchGraphEntities(client, access, {
                    projectCode,
                    entityType: null,
                    limit: safeLimit
                });
                const memoryRecords = graphRecords.filter(record => {
                    let payload = record?.payload || {};
                    if (typeof payload === 'string') {
                        try {
                            payload = JSON.parse(payload);
                        } catch {
                            payload = {};
                        }
                    }
                    return Boolean(payload.memory_candidate_id || payload.candidate_id);
                });
                result.scoped_memory = buildScopedMemoryResult(memoryRecords, memoryAccessContext || {});
                result.meta.scoped_memory_count = result.scoped_memory.records.length;
                result.meta.scoped_memory_denied_count = result.scoped_memory.denied.length;
            }
            if (includePhilosophy) {
                result.philosophy_context = await this.resolvePhilosophyContext(client, access, {
                    projectCode,
                    scope,
                    objectType,
                    operation,
                    maxRecommended
                });
            }

            return result;
        });
    }

    async resolvePhilosophyContext(client, access, { projectCode, scope, objectType, operation, maxRecommended }) {
        const requestedScope = this._normalizePhilosophyScope(scope);
        const safeMaxRecommended = Math.min(Math.max(Number(maxRecommended) || 8, 0), 20);
        const globalRecords = await this.fetchGlobalPhilosophyEntities(client, access);
        const projectRecords = projectCode === PHILOSOPHY_GLOBAL_PROJECT_CODE
            ? []
            : await this.fetchGraphEntities(client, access, {
                projectCode,
                entityType: 'philosophy',
                limit: 500
            });
        const records = [...globalRecords, ...projectRecords];
        const philosophies = records.map(record => this._normalizePhilosophyRecord(record));
        const core = philosophies.filter(item => item.priority === 'core');
        if (!core.length) {
            throw new Error('Core philosophy context is not configured');
        }

        const scopeIds = PHILOSOPHY_SCOPE_IDS[requestedScope] || PHILOSOPHY_SCOPE_IDS.graph;
        const recommended = philosophies
            .filter(item => item.priority !== 'core' && scopeIds.includes(item.philosophy_id))
            .slice(0, safeMaxRecommended);
        const selected = this._dedupePhilosophies([
            ...core,
            ...philosophies.filter(item => scopeIds.includes(item.philosophy_id)),
            ...recommended
        ]);

        return {
            mode: 'graph_operation_context',
            project_code: projectCode,
            scope: requestedScope,
            object_type: objectType || null,
            operation: operation || null,
            core,
            recommended,
            applied_ids: selected.map(item => item.philosophy_id),
            prompt_block: this._buildPhilosophyPromptBlock({ scope: requestedScope, philosophies: selected }),
            decision_tests: this._uniqueFlatMap(selected, 'decision_tests'),
            anti_patterns: this._uniqueFlatMap(selected, 'anti_patterns')
        };
    }

    async fetchGlobalPhilosophyEntities(client, access) {
        const originalProjectCodes = Array.isArray(access.projectCodes) ? access.projectCodes : [];
        const globalAccess = {
            ...access,
            projectCodes: Array.from(new Set([
                ...originalProjectCodes,
                PHILOSOPHY_GLOBAL_PROJECT_CODE
            ]))
        };
        await client.query(
            'SELECT set_config($1, $2, true)',
            ['app.project_codes', globalAccess.projectCodes.join(',')]
        );
        try {
            return await this.fetchGraphEntities(client, globalAccess, {
                projectCode: PHILOSOPHY_GLOBAL_PROJECT_CODE,
                entityType: 'philosophy',
                limit: 500
            });
        } finally {
            await client.query(
                'SELECT set_config($1, $2, true)',
                ['app.project_codes', originalProjectCodes.join(',')]
            );
        }
    }

    _normalizePhilosophyScope(scope) {
        const normalized = typeof scope === 'string' && scope.trim() ? scope.trim().toLowerCase() : 'graph';
        return PHILOSOPHY_SCOPE_IDS[normalized] ? normalized : 'graph';
    }

    _normalizePhilosophyRecord(record) {
        const payload = typeof record?.payload === 'string'
            ? JSON.parse(record.payload)
            : (record?.payload || {});
        const philosophyId = payload.philosophy_id || record?.id;
        return {
            id: record?.id || philosophyId,
            philosophy_id: philosophyId,
            title: payload.title || null,
            display_name: payload.display_name || payload.title || philosophyId,
            statement: payload.statement || '',
            why: payload.why || null,
            scope: Array.isArray(payload.scope) ? payload.scope : [],
            status: payload.status || 'active',
            priority: payload.priority || 'recommended',
            decision_tests: Array.isArray(payload.decision_tests) ? payload.decision_tests : [],
            anti_patterns: Array.isArray(payload.anti_patterns) ? payload.anti_patterns : [],
            source_refs: Array.isArray(payload.source_refs) ? payload.source_refs : []
        };
    }

    _dedupePhilosophies(items) {
        const seen = new Set();
        return items.filter(item => {
            if (!item?.philosophy_id || seen.has(item.philosophy_id)) return false;
            seen.add(item.philosophy_id);
            return true;
        });
    }

    _uniqueFlatMap(items, key) {
        return Array.from(new Set(items.flatMap(item => Array.isArray(item[key]) ? item[key] : [])));
    }

    _buildPhilosophyPromptBlock({ scope, philosophies }) {
        const lines = [
            'Brainbase Philosophy Context',
            `Scope: ${scope}`,
            '',
            'You must follow these operating philosophies before reading or writing Graph:'
        ];
        for (const item of philosophies) {
            lines.push(`- ${item.display_name}: ${item.statement}`);
        }
        const decisionTests = this._uniqueFlatMap(philosophies, 'decision_tests');
        if (decisionTests.length) {
            lines.push('', 'Decision tests:');
            for (const test of decisionTests) {
                lines.push(`- ${test}`);
            }
        }
        return lines.join('\n');
    }

    _parseEntityTypes(entityTypes) {
        if (!entityTypes || entityTypes === 'all') {
            return ['project', 'person', 'org', 'decision', 'raci_assignment',
                    'glossary_term', 'kpi', 'initiative'];
        }
        return entityTypes.split(',').map(t => t.trim()).filter(Boolean);
    }

    _groupEntitiesByType(entityArrays) {
        const grouped = {};
        for (const arr of entityArrays) {
            for (const entity of arr) {
                const type = entity.entity_type || 'unknown';
                if (!grouped[type]) grouped[type] = [];
                grouped[type].push(entity);
            }
        }
        return grouped;
    }

    _countEntities(entities) {
        const counts = {};
        for (const [type, arr] of Object.entries(entities)) {
            counts[type] = arr.length;
        }
        return counts;
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
                      AND (
                        NOT (ge.payload ? 'target_project_code')
                        OR ge.payload->>'target_project_code'=ANY($3)
                      )
                      AND 2 = (
                        SELECT COUNT(DISTINCT endpoint.id)
                        FROM graph_entities endpoint
                        LEFT JOIN projects endpoint_project ON endpoint_project.id=endpoint.project_id
                        WHERE endpoint.id IN (ge.from_id, ge.to_id)
                          AND endpoint.sensitivity=ANY($4)
                          AND (CASE endpoint.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                          AND (
                            endpoint_project.code=ANY($3)
                            OR (endpoint.project_id IS NULL AND endpoint.entity_type='person' AND EXISTS (
                              SELECT 1 FROM graph_edges membership
                              JOIN projects membership_project ON membership_project.id=membership.project_id
                              WHERE membership.from_id=endpoint.id AND membership.rel_type='member_of'
                                AND membership.lifecycle_status='active' AND membership_project.code=ANY($3)
                                AND membership.sensitivity=ANY($4)
                                AND (CASE membership.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END) <= $5
                            ))
                          )
                      )
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
                projectCode: null
            });

            let summaryLines = null;
            let report = null;
            if (humanReadable) {
                summaryLines = await this.summarizeEdges(client, access, filteredEdges);
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

    async createGlossaryTerm(access, input) {
        if (!input.term) {
            throw new Error('term is required');
        }
        const roleMin = this.normalizeRole(input.roleMin || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });
        const guard = this.getOntologyGuard();

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const glossaryTermId = this.generateId('gls');
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
                    null,
                    'GLOSSARY_TERM_CREATED',
                    JSON.stringify({
                        term: input.term,
                        reading: input.reading || null,
                        correct_form: input.correctForm || null,
                        incorrect_forms: input.incorrectForms || [],
                        category: input.category || null,
                        description: input.description || ''
                    }),
                    input.occurredAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await this.upsertGraphEntity(client, {
                id: glossaryTermId,
                entityType: 'glossary_term',
                projectId,
                payload: {
                    term: input.term,
                    reading: input.reading || null,
                    correct_form: input.correctForm || null,
                    incorrect_forms: input.incorrectForms || [],
                    category: input.category || null,
                    description: input.description || ''
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: glossaryTermId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            return { glossary_term_id: glossaryTermId, event_id: eventId, ...guard };
        });
    }

    async createKpi(access, input) {
        if (!input.metricName) {
            throw new Error('metricName is required');
        }
        const roleMin = this.normalizeRole(input.roleMin || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });
        const guard = this.getOntologyGuard();

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const kpiId = this.generateId('kpi');
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
                    null,
                    'KPI_CREATED',
                    JSON.stringify({
                        metric_name: input.metricName,
                        current_value: input.currentValue || null,
                        target_value: input.targetValue || null,
                        unit: input.unit || null,
                        period: input.period || null,
                        description: input.description || ''
                    }),
                    input.occurredAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await this.upsertGraphEntity(client, {
                id: kpiId,
                entityType: 'kpi',
                projectId,
                payload: {
                    metric_name: input.metricName,
                    current_value: input.currentValue || null,
                    target_value: input.targetValue || null,
                    unit: input.unit || null,
                    period: input.period || null,
                    description: input.description || ''
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: kpiId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            return { kpi_id: kpiId, event_id: eventId, ...guard };
        });
    }

    async createInitiative(access, input) {
        if (!input.title) {
            throw new Error('title is required');
        }
        const roleMin = this.normalizeRole(input.roleMin || 'member');
        const sensitivity = this.normalizeSensitivity(input.sensitivity || 'internal');
        this.assertWriteAccess(access, {
            projectCode: input.projectCode,
            roleMin,
            sensitivity
        });
        const guard = this.getOntologyGuard();

        return this.withAccessContext(access, async (client) => {
            const projectId = await this.ensureProject(client, input);
            const ownerPersonId = await this.ensurePerson(client, {
                personId: input.ownerPersonId,
                personName: input.ownerPersonName
            });
            const initiativeId = this.generateId('ini');
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
                    ownerPersonId,
                    'INITIATIVE_CREATED',
                    JSON.stringify({
                        title: input.title,
                        description: input.description || '',
                        status: input.status || 'planned',
                        start_date: input.startDate || null,
                        end_date: input.endDate || null
                    }),
                    input.occurredAt || new Date().toISOString(),
                    input.source || 'manual',
                    input.confidence ?? 1,
                    roleMin,
                    sensitivity
                ]
            );

            await this.upsertGraphEntity(client, {
                id: initiativeId,
                entityType: 'initiative',
                projectId,
                payload: {
                    title: input.title,
                    description: input.description || '',
                    status: input.status || 'planned',
                    start_date: input.startDate || null,
                    end_date: input.endDate || null
                },
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: initiativeId,
                toId: projectId,
                relType: 'belongs_to_project',
                projectId,
                payload: {},
                roleMin,
                sensitivity
            });

            await this.upsertGraphEdge(client, {
                fromId: initiativeId,
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

            return { initiative_id: initiativeId, event_id: eventId, ...guard };
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
        const guard = this.getOntologyGuard();

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
                    : await this.summarizeEdges(client, access, records);
            }

            return {
                query_id: queryId,
                event_id: eventId,
                result_count: records.length,
                records,
                summary_lines: summaryLines,
                ...guard
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
        const guard = this.getOntologyGuard();

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

            return { ai_decision_id: aiDecisionId, event_id: eventId, ...guard };
        });
    }

    /**
     * Slack IDから人物情報を取得
     */
    async getPersonBySlackId(slackUserId, workspaceId) {
        this.assertReady();
        const client = await this.pool.connect();
        try {
            const sql = `
                SELECT p.*
                FROM auth_grants ag
                LEFT JOIN users u
                  ON u.slack_user_id = ag.slack_user_id
                 AND u.status = 'active'
                JOIN people p ON p.id = COALESCE(u.person_id, ag.person_id)
                WHERE ag.slack_user_id = $1
                  AND ag.slack_workspace_id = $2
                  AND ag.active = true
                ORDER BY ag.updated_at DESC
                LIMIT 1
            `;
            const result = await client.query(sql, [slackUserId, workspaceId]);
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    }

    /**
     * 人物IDからプロジェクト割り当てを取得
     */
    async getProjectAssignments(personId) {
        this.assertReady();
        const client = await this.pool.connect();
        try {
            const sql = `
                SELECT DISTINCT project_id, role_code, authority_scope
                FROM raci_assignments
                WHERE person_id = $1
                ORDER BY project_id
            `;
            const result = await client.query(sql, [personId]);
            return result.rows;
        } finally {
            client.release();
        }
    }
}
