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


    async supersedeDecision(input, { client, access } = {}) {
        this._requireAccess(access);
        return this.infoSSOTService.withAccessContext(access, async (contextClient) => {
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
}
