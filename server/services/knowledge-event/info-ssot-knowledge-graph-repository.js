import { randomUUID } from 'node:crypto';

import { assertCatalogProjectSubjectMutation } from '../project-graph-identity-lock.js';

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
            const result = await this.infoSSOTService.commitOntologyGraph(access, {
                projectCode,
                entity: { id, type: 'decision', payload },
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
                `SELECT from_version, to_snapshot FROM knowledge_revision_history
                 WHERE organization_id=$1 AND project_code=$2 AND knowledge_id=$3 AND idempotency_key=$4`,
                [access.organizationId || access.tenantId, input.project_code, input.id, input.idempotency_key]
            );
            if (priorReceipt.rows[0]) {
                const prior = priorReceipt.rows[0];
                const sameRequest = prior.from_version === input.expected_version
                    && prior.to_snapshot?.statement === input.content
                    && (input.title === undefined || prior.to_snapshot?.title === input.title);
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
            await assertCatalogProjectSubjectMutation(contextClient, { id: input.id, entityType: 'decision', allowCompatible: false });
            const nextVersion = `rev_${randomUUID()}`;
            const nextPayload = {
                ...authority.rows[0].payload,
                statement: input.content,
                ...(input.title === undefined ? {} : { title: input.title }),
                version: nextVersion,
                content_hash: input.content_hash,
                semantic_state: 'active', status: 'active', searchable: true
            };
            const { rows } = await contextClient.query(
                `UPDATE graph_entities entity SET payload=$4::jsonb, lifecycle_status='active',
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
