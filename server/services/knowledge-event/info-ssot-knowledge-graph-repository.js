import { randomUUID } from 'node:crypto';

import { assertCatalogProjectSubjectMutation } from '../project-graph-identity-lock.js';

function authoringGraphError(code, message, status = 400, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

function edgeKey(edge) {
    return `${edge.from_id}:${edge.to_id}:${edge.relation || edge.rel_type}`;
}

export class InfoSSOTKnowledgeGraphRepository {
    constructor({ infoSSOTService }) {
        this.infoSSOTService = infoSSOTService;
    }

    _requireAccess(access) {
        if (!access) {
            const error = new Error('knowledge Graph access context is required');
            error.code = 'knowledge_access_required';
            throw error;
        }
    }

    async _resolveProjectId(contextClient, projectCode) {
        const result = await contextClient.query(
            'SELECT id FROM projects WHERE code = $1 LIMIT 1',
            [projectCode]
        );
        // Some legacy adapters did not return the query result. Preserve that
        // compatibility while treating an explicit empty result as missing.
        if (result === undefined) return projectCode;
        return result.rows?.[0]?.id || null;
    }

    async verifyDecisionAuthority({ project_code: projectCode, decider_id: personId, decision_domain: decisionDomain }, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const projectId = await this._resolveProjectId(contextClient, projectCode);
            if (!projectId) return { verified: false, reason: 'decision_authority_unverified' };
            await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                projectId,
                projectCode,
                personId,
                decisionDomain
            });
            return true;
        }, client ? { client } : undefined);
    }

    async _authoringProject(contextClient, projectCode) {
        const result = await contextClient.query(
            `SELECT id, code, organization_id
             FROM projects WHERE code = $1 LIMIT 1`,
            [projectCode]
        );
        const project = result?.rows?.[0];
        if (!project) throw authoringGraphError('knowledge_project_not_found', `knowledge Graph project not found: ${projectCode}`, 404);
        return project;
    }

    async _authoringVisibleEntities(contextClient, { projectId, ids }) {
        const uniqueIds = [...new Set((ids || []).filter(Boolean))];
        if (!uniqueIds.length) return [];
        const result = await contextClient.query(
            `SELECT ge.id, ge.entity_type, ge.project_id, ge.payload,
                    app_graph_entity_organization_id(ge.id) AS organization_id
             FROM graph_entities ge
             WHERE ge.id = ANY($1::text[])
               AND (
                   ge.project_id = $2
                   OR (
                       ge.project_id IS NULL
                       AND ge.entity_type = 'person'
                       AND EXISTS (
                           SELECT 1 FROM graph_edges membership
                           WHERE membership.from_id = ge.id
                             AND membership.rel_type = 'member_of'
                             AND membership.project_id = $2
                       )
                   )
               )`,
            [uniqueIds, projectId]
        );
        return result?.rows || [];
    }

    _validateAuthoringEdge(relation, fromType, toType) {
        let validation;
        try {
            validation = this.infoSSOTService.validateOntology({
                edge: { relation, from_type: fromType, to_type: toType }
            });
        } catch (error) {
            throw authoringGraphError(
                'knowledge_authoring_relation_invalid',
                `relation '${relation}' is not registered for ${fromType} -> ${toType}`,
                422,
                { relation, from_type: fromType, to_type: toType, ontology_error: error.code || error.message }
            );
        }
        if (!validation?.valid) {
            throw authoringGraphError(
                'knowledge_authoring_relation_invalid',
                `relation '${relation}' is not registered for ${fromType} -> ${toType}`,
                422,
                { relation, from_type: fromType, to_type: toType, violations: validation?.violations || [] }
            );
        }
        return validation;
    }

    async _validateAuthoringOnClient(contextClient, input) {
        const project = await this._authoringProject(contextClient, input.project_code);
        const organizationId = input.access.organizationId || input.access.tenantId;
        if (project.organization_id !== organizationId) {
            throw authoringGraphError('knowledge_project_organization_mismatch', 'project belongs to another organization', 403, {
                project_code: input.project_code
            });
        }
        const entityType = input.entity_type || 'decision';
        const ownerId = input.owner_person_id;
        if (!ownerId) throw authoringGraphError('knowledge_owner_required', 'canonical owner is required', 400);
        const sourceId = input.entity_id || null;
        const relationInputs = Array.isArray(input.relations) ? input.relations : [];
        const endpointIds = [ownerId, ...relationInputs.map((entry) => entry.to_id || entry.target_id)];
        const visible = await this._authoringVisibleEntities(contextClient, {
            projectId: project.id,
            ids: endpointIds
        });
        const byId = new Map(visible.map((row) => [row.id, row]));
        const owner = byId.get(ownerId);
        if (!owner || owner.entity_type !== 'person') {
            throw authoringGraphError('knowledge_owner_not_found', 'canonical owner is not a visible person in this project', 404, {
                owner_person_id: ownerId
            });
        }
        if (owner.organization_id && owner.organization_id !== organizationId) {
            throw authoringGraphError('knowledge_owner_organization_mismatch', 'canonical owner belongs to another organization', 403, {
                owner_person_id: ownerId
            });
        }
        let source = null;
        if (sourceId) {
            source = (await this._authoringVisibleEntities(contextClient, { projectId: project.id, ids: [sourceId] }))[0];
            if (!source) throw authoringGraphError('knowledge_canonical_not_found', 'canonical source is not visible in this project', 404, {
                canonical_id: sourceId
            });
            if (source.entity_type !== entityType) {
                throw authoringGraphError('knowledge_canonical_type_mismatch', 'canonical source type does not match the authoring kind', 409, {
                    canonical_id: sourceId, expected_type: entityType, observed_type: source.entity_type
                });
            }
        }
        // Documents do not currently have a canonical save path. Keep their
        // drafts editable while still validating any explicitly requested edge.
        if (entityType !== 'document') this._validateAuthoringEdge('owned_by', entityType, owner.entity_type);
        if (input.decision_domain) {
            const projectId = project.id;
            try {
                await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                    projectId,
                    projectCode: input.project_code,
                    personId: ownerId,
                    decisionDomain: input.decision_domain
                });
            } catch (error) {
                if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) throw error;
                throw authoringGraphError(
                    'knowledge_decision_authority_missing',
                    error?.message || 'decision authority is not verified for the selected owner',
                    403,
                    {
                        project_code: input.project_code,
                        owner_person_id: ownerId,
                        decision_domain: input.decision_domain
                    }
                );
            }
        }
        const relations = [];
        const seen = new Set();
        for (const entry of relationInputs) {
            const relation = entry.relation || entry.rel_type;
            const targetId = entry.to_id || entry.target_id;
            const fromId = entry.from_id || entry.source_id;
            if (!relation || !targetId) throw authoringGraphError('knowledge_relations_invalid', 'relation and target are required', 400);
            if (fromId && (!sourceId || fromId !== sourceId)) {
                throw authoringGraphError('knowledge_relation_source_mismatch', 'relation source must be the canonical being authored', 400, {
                    from_id: fromId, canonical_id: sourceId
                });
            }
            if (relation === 'owned_by' && targetId !== ownerId) {
                throw authoringGraphError('knowledge_owner_relation_mismatch', 'owned_by must point to the selected canonical owner', 409, {
                    owner_person_id: ownerId, target_id: targetId
                });
            }
            const target = byId.get(targetId);
            if (!target) {
                throw authoringGraphError('knowledge_relation_endpoint_not_authorized', 'relation target is not visible in this project', 403, {
                    target_id: targetId, relation
                });
            }
            this._validateAuthoringEdge(relation, entityType, target.entity_type);
            const normalized = {
                ...entry,
                relation,
                from_id: fromId || sourceId || null,
                to_id: targetId,
                to_type: target.entity_type
            };
            if (!normalized.from_id) {
                // A draft has no Graph id yet; persist it after the canonical
                // id is allocated by the event writer.
                delete normalized.from_id;
            }
            const key = edgeKey({ ...normalized, from_id: normalized.from_id || '$new' });
            if (!seen.has(key)) {
                seen.add(key);
                relations.push(normalized);
            }
        }
        return {
            project,
            source,
            owner,
            owner_person_id: ownerId,
            relations,
            authority_verified: Boolean(input.decision_domain)
        };
    }

    async validateAuthoringContext(input, { client, access } = {}) {
        this._requireAccess(access);
        const run = (contextClient) => this._validateAuthoringOnClient(contextClient, { ...input, access });
        return this.infoSSOTService.withAccessContext(access, run, client ? { client } : undefined);
    }

    async validateAuthoring(input, options = {}) {
        return this.validateAuthoringContext(input, options);
    }

    async _persistAuthoringEdgesOnClient(contextClient, input) {
        const validation = await this._validateAuthoringOnClient(contextClient, input);
        const source = validation.source;
        if (!source) throw authoringGraphError('knowledge_canonical_not_found', 'canonical source is not visible in this project', 404);
        if (input.expected_version !== undefined && input.expected_version !== null) {
            const currentVersion = String(source.payload?.version || source.version || '');
            if (currentVersion !== String(input.expected_version)) {
                throw authoringGraphError('knowledge_canonical_version_conflict', 'canonical version changed', 409, {
                    expected_version: String(input.expected_version), current_version: currentVersion
                });
            }
        }
        const projectEntityResult = await contextClient.query(
            `SELECT id, entity_type, project_id, payload
             FROM graph_entities
             WHERE entity_type = 'project' AND project_id = $1
             ORDER BY id LIMIT 1`,
            [validation.project.id]
        );
        const projectEntity = projectEntityResult?.rows?.[0];
        if (!projectEntity) {
            throw authoringGraphError('knowledge_project_graph_endpoint_not_found', 'project Graph endpoint is required for an effective decision', 409, {
                project_code: input.project_code
            });
        }
        const edges = [
            { from_id: source.id, to_id: validation.owner.id, relation: 'owned_by', payload: {} },
            { from_id: source.id, to_id: projectEntity.id, relation: 'belongs_to_project', payload: {} },
            ...validation.relations.map((entry) => ({
                from_id: source.id,
                to_id: entry.to_id,
                relation: entry.relation,
                payload: entry.payload || {}
            }))
        ];
        const uniqueEdges = [...new Map(edges.map((edge) => [edgeKey(edge), edge])).values()];
        if (typeof this.infoSSOTService.assertWriteAccess === 'function') {
            this.infoSSOTService.assertWriteAccess(input.access, {
                projectCode: input.project_code, roleMin: 'member', sensitivity: 'internal'
            });
        }
        await this.infoSSOTService.validateGraphMutation(contextClient, {
            edgeOverrides: uniqueEdges.map((edge) => ({
                from_id: edge.from_id, to_id: edge.to_id, rel_type: edge.relation
            })),
            validationEntityIds: [source.id]
        });
        for (const edge of uniqueEdges) {
            await this.infoSSOTService.upsertGraphEdge(contextClient, {
                fromId: edge.from_id,
                toId: edge.to_id,
                relType: edge.relation,
                projectId: validation.project.id,
                payload: edge.payload,
                roleMin: 'member',
                sensitivity: 'internal',
                aggregatePrevalidated: true
            });
        }
        return {
            id: source.id,
            entity_id: source.id,
            entity_type: source.entity_type,
            canonical: {
                id: source.id,
                type: source.entity_type,
                version: String(source.payload?.version || source.version || ''),
                canonical_content: source.payload?.statement || null
            },
            relation_count: uniqueEdges.length,
            relations: uniqueEdges.map(({ from_id, to_id, relation }) => ({ from_id, to_id, relation })),
            graph_saved: true,
            readback_verified: true
        };
    }

    async persistAuthoringRelations(input, { client, access } = {}) {
        this._requireAccess(access);
        const run = (contextClient) => this._persistAuthoringEdgesOnClient(contextClient, { ...input, access });
        return this.infoSSOTService.withAccessContext(access, run, client ? { client } : undefined);
    }

    async persistAuthoringGraph(input, options = {}) {
        return this.persistAuthoringRelations(input, options);
    }

    async reuseCanonical(input, { client, access } = {}) {
        this._requireAccess(access);
        if (!input.expected_version) throw authoringGraphError('knowledge_canonical_version_required', 'expected_version is required', 400);
        const run = async (contextClient) => this._persistAuthoringEdgesOnClient(contextClient, { ...input, access });
        return this.infoSSOTService.withAccessContext(access, run, client ? { client } : undefined);
    }

    async findDecisionById(id, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const { rows } = await contextClient.query(
                `SELECT id, entity_type, payload
                 FROM graph_entities
                 WHERE id = $1 AND entity_type = 'decision'
                 LIMIT 1`,
                [id]
            );
            const row = rows[0];
            return row ? { ...row, semantic_state: row.payload?.semantic_state || 'active' } : null;
        }, client ? { client } : undefined);
    }

    async upsertDecision({ id, payload }, { client, access } = {}) {
        this._requireAccess(access);
        const projectCode = payload.applicability_scope.project_code;
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const projectId = await this._resolveProjectId(contextClient, projectCode);
            if (!projectId) {
                const error = new Error(`knowledge Graph project not found: ${projectCode}`);
                error.code = 'knowledge_project_not_found';
                throw error;
            }
            await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                projectId,
                projectCode,
                personId: payload.decision_authority.decider_id,
                decisionDomain: payload.decision_authority.domain
            });
            const projectEntityResult = await contextClient.query(
                `SELECT id, entity_type
                 FROM graph_entities
                 WHERE entity_type = 'project' AND project_id = $1
                 ORDER BY id LIMIT 1`,
                [projectId]
            );
            const projectEntity = projectEntityResult?.rows?.[0];
            if (!projectEntity) {
                throw authoringGraphError(
                    'knowledge_project_graph_endpoint_not_found',
                    'project Graph endpoint is required for an effective decision',
                    409,
                    { project_code: projectCode }
                );
            }
            const result = await this.infoSSOTService.commitOntologyGraph(access, {
                projectCode,
                entity: { id, type: 'decision', payload },
                edges: [
                    { from_id: id, to_id: projectEntity.id, relation: 'belongs_to_project', payload: {} },
                    { from_id: id, to_id: payload.decision_authority.decider_id, relation: 'owned_by', payload: {} }
                ],
                contextEntities: [
                    { id: projectEntity.id, type: 'project' },
                    { id: payload.decision_authority.decider_id, type: 'person' }
                ],
                roleMin: 'member',
                sensitivity: 'internal'
            }, { client: contextClient, access_context_applied: true });
            return { id: result.entity_id, entity_type: 'decision', payload };
        }, client ? { client } : undefined);
    }

    async commitNormalizedPromotion(input, { client, access } = {}) {
        this._requireAccess(access);
        const projectCode = input?.project_code;
        const entity = input?.entity;
        if (!projectCode || !entity?.id || !entity?.type || !entity?.payload) {
            const error = new Error('normalized knowledge Graph mutation is incomplete');
            error.code = 'knowledge_normalized_graph_input_invalid';
            throw error;
        }
        const commit = async (contextClient) => {
            if (entity.type === 'decision') {
                const authority = entity.payload.decision_authority;
                const projectId = await this._resolveProjectId(contextClient, projectCode);
                if (!projectId || !authority?.decider_id || !authority?.domain) {
                    const error = new Error('normalized decision authority is incomplete');
                    error.code = 'knowledge_normalized_decision_authority_invalid';
                    throw error;
                }
                await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                    projectId,
                    projectCode,
                    personId: authority.decider_id,
                    decisionDomain: authority.domain
                });
            }
            const result = await this.infoSSOTService.commitOntologyGraph(access, {
                projectCode,
                entity,
                edges: Array.isArray(input.edges) ? input.edges : [],
                contextEntities: Array.isArray(input.context_entities) ? input.context_entities : [],
                roleMin: input.role_min || 'member',
                sensitivity: input.sensitivity || 'internal'
            }, { client: contextClient, access_context_applied: true });
            return {
                id: result.entity_id,
                entity_type: entity.type,
                edge_count: result.edge_count,
                ontology_version: result.ontology_version,
                payload: entity.payload
            };
        };
        if (client) return commit(client);
        return this.infoSSOTService.withAccessContext(access, commit);
    }

    async supersedeDecision(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const authority = await contextClient.query(
                `SELECT project.id AS project_id, entity.payload->'decision_authority'->>'domain' AS decision_domain
                 FROM graph_entities entity JOIN projects project ON project.id=entity.project_id
                 WHERE entity.id=$1 AND entity.entity_type='decision' AND project.code=$2
                 LIMIT 1`,
                [input.id, input.project_code]
            );
            if (!authority.rows[0]) return null;
            await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                projectId: authority.rows[0].project_id,
                projectCode: input.project_code,
                personId: access.personId,
                decisionDomain: authority.rows[0].decision_domain
            });
            await assertCatalogProjectSubjectMutation(contextClient, {
                id: input.id,
                entityType: 'decision',
                allowCompatible: false
            });
            const { rows } = await contextClient.query(
                `UPDATE graph_entities
                 SET payload = payload || jsonb_build_object(
                     'semantic_state', 'active',
                     'searchable', true,
                     'supersedes_event_id', $2::text,
                     'derived_from_event_id', $3::text,
                     'derived_from_candidate_id', $4::text,
                     'source_pointer', $5::jsonb
                 ), updated_at = NOW()
                 WHERE id = $1 AND entity_type = 'decision'
                 RETURNING id, entity_type, payload`,
                [
                    input.id,
                    input.event_id,
                    input.replacement_event_id,
                    input.replacement_candidate_id,
                    JSON.stringify(input.source_pointer || null)
                ]
            );
            return rows[0] || null;
        }, client ? { client } : undefined);
    }

    async retractDecision(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            await assertCatalogProjectSubjectMutation(contextClient, {
                id: input.id,
                entityType: 'decision',
                allowCompatible: false
            });
            const { rows } = await contextClient.query(
                `UPDATE graph_entities
                 SET payload = payload || jsonb_build_object(
                     'semantic_state', 'retracted',
                     'searchable', false,
                     'retracted_event_id', $2::text,
                     'source_pointer', $3::jsonb
                 ), updated_at = NOW()
                 WHERE id = $1 AND entity_type = 'decision'
                 RETURNING id, entity_type, payload`,
                [input.id, input.event_id, JSON.stringify(input.source_pointer || null)]
            );
            return rows[0] || null;
        }, client ? { client } : undefined);
    }

    async changeLifecycle(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const authority = await contextClient.query(
                `SELECT project.id AS project_id, entity.payload->'decision_authority'->>'domain' AS decision_domain
                 FROM graph_entities entity JOIN projects project ON project.id=entity.project_id
                 WHERE entity.id=$1 AND entity.entity_type='decision' AND project.code=$2
                 LIMIT 1`,
                [input.id, input.project_code]
            );
            if (!authority.rows[0]) return null;
            await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                projectId: authority.rows[0].project_id,
                projectCode: input.project_code,
                personId: access.personId,
                decisionDomain: authority.rows[0].decision_domain
            });
            await assertCatalogProjectSubjectMutation(contextClient, {
                id: input.id, entityType: 'decision', allowCompatible: false
            });
            const semanticState = input.state === 'active' ? 'active' : 'retracted';
            const searchable = true;
            const lifecycleStatus = input.state === 'active' ? 'active' : 'inactive';
            const nextVersion = `lc_${randomUUID()}`;
            const { rows } = await contextClient.query(
                `UPDATE graph_entities entity
                 SET payload = entity.payload || jsonb_build_object(
                        'semantic_state', $4::text,
                        'status', $5::text,
                        'searchable', $6::boolean,
                        'version', $7::text
                     ), lifecycle_status=$8::text, version=entity.version+1, updated_at = NOW()
                 FROM projects project
                 WHERE entity.id = $1 AND entity.entity_type = 'decision'
                   AND entity.project_id = project.id AND project.code = $2
                   AND entity.payload->>'version' = $3
                 RETURNING entity.id, entity.entity_type, entity.payload`,
                [input.id, input.project_code, input.expected_version, semanticState, input.state, searchable, nextVersion, lifecycleStatus]
            );
            if (!rows[0]) {
                const current = await contextClient.query(
                    `SELECT entity.payload->>'version' AS version
                     FROM graph_entities entity JOIN projects project ON project.id=entity.project_id
                     WHERE entity.id=$1 AND entity.entity_type='decision' AND project.code=$2`,
                    [input.id, input.project_code]
                );
                if (current.rows[0]) {
                    const error = new Error('knowledge lifecycle version conflict');
                    error.code = 'knowledge_lifecycle_version_conflict';
                    error.status = 409;
                    error.details = { expected_version: input.expected_version, current_version: current.rows[0].version };
                    throw error;
                }
                return null;
            }
            await contextClient.query(
                "SELECT set_config('app.person_id', $1, true)",
                [input.actor_person_id]
            );
            await contextClient.query(
                `INSERT INTO knowledge_lifecycle_history
                 (knowledge_id, organization_id, project_code, from_version, to_version, state, reason, actor_person_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [input.id, access.organizationId || access.tenantId, input.project_code, input.expected_version,
                    rows[0].payload.version, input.state, input.reason, input.actor_person_id]
            );
            return rows[0];
        }, client ? { client } : undefined);
    }

    async listLifecycleHistory(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const { rows } = await contextClient.query(
                `SELECT from_version, to_version, state, reason, actor_person_id, occurred_at
                 FROM knowledge_lifecycle_history
                 WHERE knowledge_id=$1 AND project_code=$2 ORDER BY occurred_at DESC, id DESC`,
                [input.id, input.project_code]
            );
            return rows.map((row) => ({
                ...row,
                occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at
            }));
        }, client ? { client } : undefined);
    }

    async reviseDecision(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const priorReceipt = await contextClient.query(
                `SELECT from_version, reason, to_snapshot FROM knowledge_revision_history
                 WHERE organization_id=$1 AND project_code=$2 AND knowledge_id=$3 AND idempotency_key=$4`,
                [access.organizationId || access.tenantId, input.project_code, input.id, input.idempotency_key]
            );
            if (priorReceipt.rows[0]) {
                const prior = priorReceipt.rows[0];
                const sameRequest = prior.from_version === input.expected_version
                    && prior.reason === input.reason
                    && prior.to_snapshot?.statement === input.content
                    && (input.title === undefined || prior.to_snapshot?.title === input.title)
                    && (input.scope === undefined || prior.to_snapshot?.applicability_scope?.scope === input.scope)
                    && (input.owner_person_id === undefined || prior.to_snapshot?.owner_id === input.owner_person_id)
                    && (input.effective_at === undefined || (prior.to_snapshot?.effective_at ?? null) === input.effective_at)
                    && (input.expires_at === undefined || (prior.to_snapshot?.expires_at ?? null) === input.expires_at);
                if (!sameRequest) {
                    const error = new Error('knowledge revision idempotency conflict');
                    error.code = 'knowledge_revision_idempotency_conflict'; error.status = 409;
                    throw error;
                }
                return { id: input.id, entity_type: 'decision', payload: prior.to_snapshot, idempotent: true };
            }
            const authority = await contextClient.query(
                `SELECT project.id AS project_id, entity.payload, entity.payload->'decision_authority'->>'domain' AS decision_domain
                 FROM graph_entities entity JOIN projects project ON project.id=entity.project_id
                 WHERE entity.id=$1 AND entity.entity_type='decision' AND project.code=$2 LIMIT 1`,
                [input.id, input.project_code]
            );
            if (!authority.rows[0]) return null;
            await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                projectId: authority.rows[0].project_id, projectCode: input.project_code,
                personId: access.personId, decisionDomain: authority.rows[0].decision_domain
            });
            const nextEffectiveAt = input.effective_at === undefined
                ? authority.rows[0].payload.effective_at ?? authority.rows[0].payload.decided_at ?? null : input.effective_at;
            const nextExpiresAt = input.expires_at === undefined
                ? authority.rows[0].payload.expires_at ?? authority.rows[0].payload.valid_until ?? null : input.expires_at;
            if (nextEffectiveAt && nextExpiresAt && Date.parse(nextExpiresAt) <= Date.parse(nextEffectiveAt)) {
                const error = new Error('knowledge revision effective period is invalid');
                error.code = 'knowledge_revision_effective_period_invalid'; error.status = 400;
                throw error;
            }
            if (input.owner_person_id !== undefined) {
                const owner = await contextClient.query(
                    "SELECT id FROM people WHERE id=$1 AND status='active' LIMIT 1",
                    [input.owner_person_id]
                );
                if (!owner.rows[0]) {
                    const error = new Error('knowledge revision owner was not found');
                    error.code = 'knowledge_revision_owner_not_found'; error.status = 400;
                    throw error;
                }
            }
            await assertCatalogProjectSubjectMutation(contextClient, { id: input.id, entityType: 'decision', allowCompatible: false });
            const nextVersion = `rev_${randomUUID()}`;
            const nextPayload = {
                ...authority.rows[0].payload,
                statement: input.content,
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.scope === undefined ? {} : {
                    applicability_scope: {
                        ...(authority.rows[0].payload.applicability_scope || {}),
                        scope: input.scope,
                        project_code: input.project_code,
                        organization_id: input.organization_id
                    }
                }),
                ...(input.owner_person_id === undefined ? {} : { owner_id: input.owner_person_id }),
                ...(input.effective_at === undefined ? {} : { effective_at: input.effective_at }),
                ...(input.expires_at === undefined ? {} : { expires_at: input.expires_at }),
                version: nextVersion,
                content_hash: input.content_hash
            };
            const { rows } = await contextClient.query(
                `UPDATE graph_entities entity SET payload=$4::jsonb,
                    version=entity.version+1, updated_at=NOW()
                 FROM projects project
                 WHERE entity.id=$1 AND entity.entity_type='decision' AND entity.project_id=project.id
                   AND project.code=$2 AND entity.payload->>'version'=$3
                 RETURNING entity.id, entity.entity_type, entity.payload`,
                [input.id, input.project_code, input.expected_version, JSON.stringify(nextPayload)]
            );
            if (!rows[0]) {
                const error = new Error('knowledge revision version conflict');
                error.code = 'knowledge_revision_version_conflict'; error.status = 409;
                throw error;
            }
            await contextClient.query("SELECT set_config('app.person_id', $1, true)", [input.actor_person_id]);
            await contextClient.query(
                `INSERT INTO knowledge_revision_history
                 (knowledge_id, organization_id, project_code, idempotency_key, from_version, to_version,
                  reason, actor_person_id, from_snapshot, to_snapshot)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
                [input.id, access.organizationId || access.tenantId, input.project_code, input.idempotency_key,
                    input.expected_version, nextVersion, input.reason, input.actor_person_id,
                    JSON.stringify(authority.rows[0].payload), JSON.stringify(nextPayload)]
            );
            return rows[0];
        }, client ? { client } : undefined);
    }

    async establishSupersession(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const priorReceipt = await contextClient.query(
                `SELECT superseded_id, replacement_from_version, superseded_from_version,
                        effective_at, reason, receipt
                 FROM knowledge_supersession_history
                 WHERE organization_id=$1 AND project_code=$2 AND replacement_id=$3 AND idempotency_key=$4`,
                [input.organization_id, input.project_code, input.replacement_id, input.idempotency_key]
            );
            if (priorReceipt.rows[0]) {
                const prior = priorReceipt.rows[0];
                const priorEffectiveAt = prior.effective_at instanceof Date
                    ? prior.effective_at.toISOString() : new Date(prior.effective_at).toISOString();
                const sameRequest = prior.superseded_id === input.superseded_id
                    && prior.replacement_from_version === input.replacement_expected_version
                    && prior.superseded_from_version === input.superseded_expected_version
                    && priorEffectiveAt === input.effective_at && prior.reason === input.reason;
                if (!sameRequest) {
                    const error = new Error('knowledge supersession idempotency conflict');
                    error.code = 'knowledge_supersession_idempotency_conflict'; error.status = 409;
                    throw error;
                }
                return { ...prior.receipt, idempotent: true };
            }
            const { rows } = await contextClient.query(
                `SELECT entity.id, entity.payload, project.id AS project_id,
                        entity.payload->'decision_authority'->>'domain' AS decision_domain
                 FROM graph_entities entity JOIN projects project ON project.id=entity.project_id
                 WHERE entity.id = ANY($1::text[]) AND entity.entity_type='decision' AND project.code=$2`,
                [[input.replacement_id, input.superseded_id], input.project_code]
            );
            if (rows.length !== 2) return null;
            const byId = new Map(rows.map((row) => [row.id, row]));
            const replacement = byId.get(input.replacement_id);
            const superseded = byId.get(input.superseded_id);
            const replacementExpiresAt = replacement.payload.expires_at ?? replacement.payload.valid_until ?? null;
            const supersededEffectiveAt = superseded.payload.effective_at ?? superseded.payload.decided_at ?? null;
            if ((replacementExpiresAt && Date.parse(replacementExpiresAt) <= Date.parse(input.effective_at))
                || (supersededEffectiveAt && Date.parse(input.effective_at) <= Date.parse(supersededEffectiveAt))
                || ((superseded.payload.expires_at ?? superseded.payload.valid_until)
                    && Date.parse(superseded.payload.expires_at ?? superseded.payload.valid_until) < Date.parse(input.effective_at))) {
                const error = new Error('knowledge supersession effective period is invalid');
                error.code = 'knowledge_supersession_effective_period_invalid'; error.status = 400;
                throw error;
            }
            const replacementActive = !['retired', 'unlinked', 'inactive'].includes(replacement.payload.status)
                && !['superseded', 'contradicted', 'quarantined', 'retracted', 'expired'].includes(replacement.payload.semantic_state)
                && replacement.payload.searchable !== false;
            if (!replacementActive) {
                const error = new Error('knowledge supersession replacement is not active');
                error.code = 'knowledge_supersession_replacement_inactive'; error.status = 409;
                throw error;
            }
            const conflictingEdges = await contextClient.query(
                `WITH RECURSIVE superseded_descendants(id) AS (
                    SELECT $2::text
                    UNION
                    SELECT edge.to_id FROM graph_edges edge
                    JOIN superseded_descendants path ON edge.from_id=path.id
                    WHERE edge.rel_type='supersedes'
                      AND COALESCE(to_jsonb(edge)->>'lifecycle_status', 'active')='active'
                 )
                 SELECT 'cycle' AS conflict FROM superseded_descendants WHERE id=$1 AND id<>$2
                 UNION ALL
                 SELECT 'existing' AS conflict FROM graph_edges
                 WHERE rel_type='supersedes' AND COALESCE(to_jsonb(graph_edges)->>'lifecycle_status', 'active')='active'
                   AND ((from_id=$1 AND to_id=$2) OR (to_id=$2 AND from_id<>$1))
                 LIMIT 1`,
                [input.replacement_id, input.superseded_id]
            );
            if (conflictingEdges.rows.length) {
                const error = new Error('knowledge supersession relation conflicts with an existing replacement');
                error.code = 'knowledge_supersession_relation_conflict'; error.status = 409;
                throw error;
            }
            for (const decision of [replacement, superseded]) {
                await this.infoSSOTService.assertDecisionAuthority(contextClient, {
                    projectId: decision.project_id, projectCode: input.project_code,
                    personId: access.personId, decisionDomain: decision.decision_domain
                });
                await assertCatalogProjectSubjectMutation(contextClient, {
                    id: decision.id, entityType: 'decision', allowCompatible: false
                });
            }
            const replacementVersion = `rev_${randomUUID()}`;
            const supersededVersion = `rev_${randomUUID()}`;
            const replacementPayload = { ...replacement.payload, effective_at: input.effective_at, version: replacementVersion };
            const supersededPayload = { ...superseded.payload, expires_at: input.effective_at, version: supersededVersion };
            const update = async (id, expectedVersion, payload) => {
                const result = await contextClient.query(
                    `UPDATE graph_entities entity SET payload=$4::jsonb, version=entity.version+1, updated_at=NOW()
                     FROM projects project
                     WHERE entity.id=$1 AND entity.entity_type='decision' AND entity.project_id=project.id
                       AND project.code=$2 AND entity.payload->>'version'=$3
                     RETURNING entity.id, entity.entity_type, entity.payload`,
                    [id, input.project_code, expectedVersion, JSON.stringify(payload)]
                );
                if (!result.rows[0]) {
                    const error = new Error('knowledge supersession version conflict');
                    error.code = 'knowledge_supersession_version_conflict'; error.status = 409;
                    throw error;
                }
                return result.rows[0];
            };
            const changedReplacement = await update(input.replacement_id, input.replacement_expected_version, replacementPayload);
            const changedSuperseded = await update(input.superseded_id, input.superseded_expected_version, supersededPayload);
            await this.infoSSOTService.upsertGraphEdge(contextClient, {
                fromId: input.replacement_id, toId: input.superseded_id, relType: 'supersedes',
                projectId: replacement.project_id,
                payload: { effective_at: input.effective_at, reason: input.reason, actor_person_id: input.actor_person_id },
                roleMin: 'member', sensitivity: 'internal'
            });
            await contextClient.query("SELECT set_config('app.person_id', $1, true)", [input.actor_person_id]);
            const receipt = { replacement: changedReplacement, superseded: changedSuperseded };
            await contextClient.query(
                `INSERT INTO knowledge_supersession_history
                 (organization_id, project_code, replacement_id, superseded_id, idempotency_key,
                  replacement_from_version, replacement_to_version, superseded_from_version, superseded_to_version,
                  effective_at, reason, actor_person_id, receipt)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
                [input.organization_id, input.project_code, input.replacement_id, input.superseded_id,
                    input.idempotency_key, input.replacement_expected_version, replacementVersion,
                    input.superseded_expected_version, supersededVersion, input.effective_at,
                    input.reason, input.actor_person_id, JSON.stringify(receipt)]
            );
            return receipt;
        }, client ? { client } : undefined);
    }

    async listRevisionHistory(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const { rows } = await contextClient.query(
                `SELECT from_version, to_version, reason, actor_person_id, from_snapshot, to_snapshot, occurred_at
                 FROM knowledge_revision_history WHERE knowledge_id=$1 AND project_code=$2
                 ORDER BY occurred_at DESC, id DESC`, [input.id, input.project_code]
            );
            return rows.map((row) => ({ ...row, kind: 'revision',
                occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at }));
        }, client ? { client } : undefined);
    }

    async listSupersessionHistory(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const { rows } = await contextClient.query(
                `SELECT replacement_id, superseded_id, replacement_from_version, replacement_to_version,
                        superseded_from_version, superseded_to_version, effective_at, reason, actor_person_id, occurred_at
                 FROM knowledge_supersession_history
                 WHERE project_code=$2 AND (replacement_id=$1 OR superseded_id=$1)
                 ORDER BY occurred_at DESC, id DESC`, [input.id, input.project_code]
            );
            return rows.map((row) => ({ ...row, kind: 'supersession',
                effective_at: row.effective_at instanceof Date ? row.effective_at.toISOString() : row.effective_at,
                occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at }));
        }, client ? { client } : undefined);
    }

    async listDecisionAuthorityDomains(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
            const { rows } = await contextClient.query(
                `SELECT DISTINCT substring(raci.role_code FROM 10) AS domain
                 FROM raci_assignments raci
                 JOIN projects project ON project.id=raci.project_id
                 WHERE project.code=$1 AND raci.person_id=$2
                   AND raci.role_code LIKE 'decision:%'
                   AND raci.role_code <> 'decision:最終決裁'
                 ORDER BY domain`,
                [input.project_code, access.personId]
            );
            return rows.map((row) => row.domain).filter(Boolean);
        }, client ? { client } : undefined);
    }
}
