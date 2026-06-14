import { describe, expect, it } from 'vitest';

import { AdminVisualizationService } from '../../../server/services/admin-visualization-service.js';

const access = { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'sato' };

const infoSSOTService = {
    async listGraphEntities(_access, { entityType }) {
        return [
            { id: 'project_brainbase', entity_type: 'project', project_code: 'brainbase', payload: { name: 'Brainbase' }, sensitivity: 'internal', role_min: 'member', updated_at: '2026-06-02T00:00:00.000Z' },
            { id: 'decision_admin', entity_type: 'decision', project_code: 'brainbase', payload: { title: '管理画面read-only' }, sensitivity: 'internal', role_min: 'gm', updated_at: '2026-06-03T00:00:00.000Z' }
        ].filter((record) => !entityType || record.entity_type === entityType);
    },
    async getContext(_access, options = {}) {
        return {
            entities: { project: [{ id: 'project_brainbase', entity_type: 'project', payload: { name: 'Brainbase' } }] },
            edges: options.includeEdges ? [{ id: 'edge_1' }] : [],
            report: 'Brainbase context preview',
            meta: { entity_count: { project: 1 }, scoped_memory_count: options.includeMemory ? 1 : 0, scoped_memory_denied_count: options.includeMemory ? 1 : 0 },
            scoped_memory: options.includeMemory ? { records: [], denied: [{ id: 'mem_1', reason: 'private_scope_denied' }] } : null,
            philosophy_context: options.includePhilosophy ? { scope: options.scope || 'graph', applied_ids: ['core'] } : null
        };
    }
};

const candidateRepository = {
    async list(filter = {}) {
        return [
            { id: 'cand_1', cognitive_type: 'preference', owner_person_id: 'sato', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: '候補本文 postgres://user:password@example.com/db xoxb-123456789012-abcdefghijkl ghp_abcdefghijklmnopqrstuvwxyz123456 {"access_token":"oauth-secret","client_secret":"client-secret","hmac_secret":"hmac-secret"}', created_at: '2026-06-04T00:00:00.000Z' },
            { id: 'cand_2', cognitive_type: 'observation', owner_person_id: 'umeda', source_system: 'slack', project_code: 'brainbase', visibility: 'team', sensitivity: 'restricted', role_min: 'gm', promotion_status: 'approved', redaction_status: 'redacted', body: '承認済み候補', created_at: '2026-06-05T00:00:00.000Z' }
        ].filter((record) => {
            if (filter.owner_person_id && record.owner_person_id !== filter.owner_person_id) return false;
            if (filter.promotion_status && record.promotion_status !== filter.promotion_status) return false;
            if (filter.cognitive_type && record.cognitive_type !== filter.cognitive_type) return false;
            return true;
        });
    }
};

describe('AdminVisualizationService', () => {
    it('INV-1 Contract-1: overview keeps source_class on source summaries and aggregate sections', async () => {
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository, env: { LIGHTRAG_URL: 'https://lightrag.example.test' } });
        const overview = await service.getOverview(access);
        expect(overview.graph.source_class).toBe('graph_ssot');
        expect(overview.candidates.source_class).toBe('candidate_store');
        expect(overview.sources.map((source) => source.source_class)).toEqual(['graph_ssot', 'candidate_store', 'ai_context', 'derived_index', 'runtime_config']);
    });

    it('INV-2 Contract-2 Contract-3: Graph SSOT and candidate-store records stay in separate collections', async () => {
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository });
        const graph = await service.listGraphEntities(access, {});
        const candidates = await service.listCandidates(access, {});
        expect(graph.records.every((record) => record.source_class === 'graph_ssot')).toBe(true);
        expect(graph.records.some((record) => record.id === 'cand_1')).toBe(false);
        expect(candidates.records.every((record) => record.source_class === 'candidate_store')).toBe(true);
        expect(candidates.records.some((record) => record.id === 'project_brainbase')).toBe(false);
    });

    it('INV-7 AP-2: candidate-store list applies ACL before previewing body text', async () => {
        const calls = [];
        const repository = {
            async list(filter) {
                calls.push(filter);
                return [
                    { id: 'own', owner_person_id: 'sato', cognitive_type: 'preference', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'visible' },
                    { id: 'other', owner_person_id: 'umeda', cognitive_type: 'preference', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'secret' }
                ].filter((row) => {
                    if (filter.promotion_status && row.promotion_status !== filter.promotion_status) return false;
                    if (filter.cognitive_type && row.cognitive_type !== filter.cognitive_type) return false;
                    return true;
                });
            }
        };
        const result = await new AdminVisualizationService({ candidateRepository: repository }).listCandidates(access, {});
        expect(calls[0]).not.toHaveProperty('owner_person_id');
        expect(result.records.map((record) => record.id)).toEqual(['own']);
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('INV-7: candidate-store ACL supports owner, recommended owner, team, org, project, and public paths', async () => {
        const repository = {
            async list() {
                return [
                    { id: 'own', owner_person_id: 'sato', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'own' },
                    { id: 'recommended', owner_person_id: 'other', recommended_owner_person_id: 'sato', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'recommended' },
                    { id: 'team', owner_person_id: 'other', visibility: 'team', team_id: 'growth', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'team' },
                    { id: 'org', owner_person_id: 'other', visibility: 'org', org_ids: ['unson'], sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'org' },
                    { id: 'project', owner_person_id: 'other', visibility: 'project', project_code: 'brainbase', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'project' },
                    { id: 'public', owner_person_id: 'other', visibility: 'public', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'public' },
                    { id: 'private-other', owner_person_id: 'other', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'private-secret' }
                ];
            }
        };
        const result = await new AdminVisualizationService({ candidateRepository: repository }).listCandidates({
            ...access,
            teamIds: ['growth'],
            orgIds: ['unson']
        }, {});
        expect(result.records.map((record) => record.id)).toEqual(['own', 'recommended', 'team', 'org', 'project', 'public']);
        expect(JSON.stringify(result)).not.toContain('private-secret');
    });

    it('INV-7: candidate-store returns no records when req.access has no personId', async () => {
        const result = await new AdminVisualizationService({ candidateRepository }).listCandidates({ role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'] }, {});
        expect(result.records).toEqual([]);
        expect(result.warnings[0]).toContain('personId');
    });

    it('INV-8 AP-3: health and previews do not expose secret values or connection strings', async () => {
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository, env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db', AUTH_SESSION_SECRET: 'super-secret-value' } });
        const payload = JSON.stringify({ health: await service.getHealth(access), candidates: await service.listCandidates(access, {}) });
        expect(payload).not.toContain('super-secret-value');
        expect(payload).not.toContain('postgres://user:secret@example.com/db');
        expect(payload).not.toContain('postgres://user:password@example.com/db');
        expect(payload).not.toContain('xoxb-123456789012-abcdefghijkl');
        expect(payload).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
        expect(payload).not.toContain('oauth-secret');
        expect(payload).not.toContain('client-secret');
        expect(payload).not.toContain('hmac-secret');
        expect(payload).toContain('[masked]');
    });

    it('INV-9 S-2: missing dependencies return partial unavailable health without throwing', async () => {
        const overview = await new AdminVisualizationService().getOverview(access);
        expect(overview.graph.status).toBe('unavailable');
        expect(overview.candidates.status).toBe('unavailable');
    });

    it('INV-4 Contract-4 S-4: context preview returns ai_context with included groups and warnings', async () => {
        const preview = await new AdminVisualizationService({ infoSSOTService, candidateRepository }).previewContext(access, { project: 'brainbase', entityTypes: 'project', includeMemory: true, scope: 'graph', operation: 'read' });
        expect(preview.source_class).toBe('ai_context');
        expect(preview.status).toBe('available');
        expect(preview.preview.included[0]).toMatchObject({ source_class: 'ai_context', type: 'project', count: 1 });
        expect(preview.preview.entity_count).toBe(1);
        expect(preview.preview.philosophy_context.displayed).toBe(false);
        expect(preview.preview.philosophy_context.included_in_agent_context).toBe(true);
        expect(preview.preview.memory.denied_count).toBe(1);
        expect(preview.warnings[0]).toContain('memory');
    });

    it('INV-4 Contract-4: missing Graph philosophy context is a warning, not an unavailable preview', async () => {
        const calls = [];
        const service = new AdminVisualizationService({
            candidateRepository,
            infoSSOTService: {
                async getContext(_access, options = {}) {
                    calls.push(options);
                    if (options.includePhilosophy) throw new Error('Core philosophy context is not configured');
                    return {
                        entities: { project: [{ id: 'project_brainbase' }] },
                        edges: options.includeEdges ? [{ id: 'edge_1' }] : [],
                        report: 'Brainbase context without philosophy',
                        meta: { entity_count: { project: 1 } },
                        scoped_memory: null
                    };
                }
            }
        });
        const preview = await service.previewContext(access, { project: 'brainbase', includePhilosophy: true });
        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ includePhilosophy: false });
        expect(preview.status).toBe('available');
        expect(preview.preview.philosophy_context.included_in_agent_context).toBe(false);
        expect(preview.preview.options).toMatchObject({ include_philosophy: true, effective_include_philosophy: false });
        expect(preview.warnings[0]).toContain('Graph哲学文脈');
    });

    it('Contract-5: data-flow verifies candidate and graph objects instead of marking IDs healthy by shape', async () => {
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository });
        const found = await service.getDataFlow(access, { project: 'brainbase', candidate: 'cand_1', entity: 'project_brainbase' });
        expect(found.steps[0]).toMatchObject({ source_class: 'candidate_store', status: 'available' });
        expect(found.steps[1]).toMatchObject({ source_class: 'graph_ssot', status: 'available' });

        const missing = await service.getDataFlow(access, { project: 'brainbase', candidate: 'other-owner', entity: 'missing_entity' });
        expect(missing.steps[0]).toMatchObject({ source_class: 'candidate_store', status: 'not_found' });
        expect(missing.steps[1]).toMatchObject({ source_class: 'graph_ssot', status: 'not_found' });
    });
});
