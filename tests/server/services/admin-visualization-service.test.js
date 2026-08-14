import { describe, expect, it } from 'vitest';

import { AdminVisualizationService, scrubSecretValue } from '../../../server/services/admin-visualization-service.js';

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
            { id: 'cand_1', cognitive_type: 'preference', owner_person_id: 'sato', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { personal_kg: { memory_layer: 'personal_kg_core' } }, body: '候補本文 postgres://user:password@example.com/db xoxb-123456789012-abcdefghijkl xoxc-123456789012-abcdefghijkl xoxd-123456789012-abcdefghijkl xapp-123456789012-abcdefghijkl ghp_abcdefghijklmnopqrstuvwxyz123456 {"access_token":"oauth-secret","client_secret":"client-secret","hmac_secret":"hmac-secret"}', created_at: '2026-06-04T00:00:00.000Z' },
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
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository });
        const overview = await service.getOverview(access);
        expect(overview.graph.source_class).toBe('graph_ssot');
        expect(overview.candidates.source_class).toBe('candidate_store');
        expect(overview.personal_kg.source_class).toBe('personal_kg');
        expect(overview.sources.map((source) => source.source_class)).toEqual(['graph_ssot', 'candidate_store', 'personal_kg', 'ai_context', 'runtime_config']);
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

    it('INV-7: candidate-store reads are DB-bounded before service ACL filtering', async () => {
        const calls = [];
        const repository = {
            async list(filter) {
                calls.push(filter);
                return [
                    { id: 'new', owner_person_id: 'sato', cognitive_type: 'preference', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'new', created_at: '2026-06-15T00:00:00.000Z' }
                ];
            }
        };

        const result = await new AdminVisualizationService({ candidateRepository: repository }).listCandidates(access, { limit: 1 });

        expect(calls[0]).toMatchObject({ limit: 500, order_by: 'created_at', order_direction: 'desc' });
        expect(result.records.map((record) => record.id)).toEqual(['new']);
    });

    it('INV-7: candidate-store bounded scans surface underfill as a visible warning', async () => {
        const repository = {
            async list() {
                return Array.from({ length: 500 }, (_, index) => ({
                    id: `other_${index}`,
                    owner_person_id: 'other',
                    cognitive_type: 'preference',
                    source_system: 'codex',
                    project_code: 'brainbase',
                    visibility: 'owner',
                    sensitivity: 'internal',
                    role_min: 'member',
                    promotion_status: 'candidate',
                    redaction_status: 'none',
                    body: 'not visible',
                    created_at: '2026-06-15T00:00:00.000Z'
                }));
            }
        };

        const result = await new AdminVisualizationService({ candidateRepository: repository }).listCandidates(access, { limit: 50 });

        expect(result.records).toEqual([]);
        expect(result.scan_limited).toBe(true);
        expect(result.warnings[0]).toContain('最新500件');
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

    it('INV-5 Contract-7: Personal KG summarizes owner-visible memory candidates only', async () => {
        const repository = {
            async list(filter) {
                expect(filter).toMatchObject({ owner_person_id: 'sato', order_by: 'created_at', order_direction: 'desc', limit: 500 });
                return [
                    { id: 'core', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'oyasumi-meeting-personal-kg', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { personal_kg: { memory_layer: 'personal_kg_core' } }, body: '個人KG core', created_at: '2026-06-07T00:00:00.000Z' },
                    { id: 'sns', owner_person_id: 'sato', cognitive_type: 'claim', source_system: 'oyasumi-meeting-personal-kg', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'read-only', permission_snapshot: { oyasumi_meeting_personal_kg: { memory_layer: 'sns_ready', projection_allowed: true } }, body: 'SNS利用可', created_at: '2026-06-08T00:00:00.000Z' },
                    { id: 'other-owner', owner_person_id: 'umeda', cognitive_type: 'insight', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: '見えない' },
                    { id: 'team', owner_person_id: 'sato', cognitive_type: 'insight', visibility: 'team', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'owner-visibleではない' }
                ];
            }
        };
        const result = await new AdminVisualizationService({ candidateRepository: repository }).listPersonalKg(access, {});
        expect(result.source_class).toBe('personal_kg');
        expect(result.owner_person_id).toBe('sato');
        expect(result.records.map((record) => record.id)).toEqual(['sns', 'core']);
        expect(result.summary.total).toBe(2);
        expect(result.summary.returned_count).toBe(2);
        expect(result.summary.truncated).toBe(false);
        expect(result.summary.core_count).toBe(1);
        expect(result.summary.sns_ready_count).toBe(1);
        expect(JSON.stringify(result)).not.toContain('見えない');
        expect(JSON.stringify(result)).not.toContain('owner-visibleではない');
    });

    it('INV-5 Contract-7: fallback Personal KG derives sns_ready from policy, seed, and top-level layers with projection gates', async () => {
        const repository = {
            async list() {
                return [
                    { id: 'policy_ready', owner_person_id: 'sato', cognitive_type: 'claim', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { oyasumi_meeting_personal_kg: { memory_layer: 'sns_ready', projection_allowed: true } }, body: 'policy ready', created_at: '2026-06-09T00:00:00.000Z' },
                    { id: 'seed_ready', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { seed: { memory_layer: 'sns_ready', projection_allowed: true } }, body: 'seed ready', created_at: '2026-06-08T00:00:00.000Z' },
                    { id: 'top_ready', owner_person_id: 'sato', cognitive_type: 'preference', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'read-only', permission_snapshot: { memory_layer: 'sns_ready', projection_allowed: true }, body: 'top ready', created_at: '2026-06-07T00:00:00.000Z' },
                    { id: 'seed_blocked', owner_person_id: 'sato', cognitive_type: 'observation', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { seed: { memory_layer: 'sns_ready', projection_allowed: false } }, body: 'seed blocked', created_at: '2026-06-06T00:00:00.000Z' },
                    { id: 'core', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', agency_level: 'synthesize', permission_snapshot: { personal_kg: { memory_layer: 'personal_kg_core' } }, body: 'core', created_at: '2026-06-05T00:00:00.000Z' }
                ];
            }
        };

        const result = await new AdminVisualizationService({ candidateRepository: repository }).listPersonalKg(access, {});
        const byId = Object.fromEntries(result.records.map((record) => [record.id, record]));

        expect(result.summary.total).toBe(5);
        expect(result.summary.sns_ready_count).toBe(3);
        expect(result.summary.counts_by_memory_layer).toMatchObject({ sns_ready: 4, personal_kg_core: 1 });
        expect(byId.policy_ready).toMatchObject({ memory_layer: 'sns_ready', sns_ready: true });
        expect(byId.seed_ready).toMatchObject({ memory_layer: 'sns_ready', sns_ready: true });
        expect(byId.top_ready).toMatchObject({ memory_layer: 'sns_ready', sns_ready: true });
        expect(byId.seed_blocked).toMatchObject({ memory_layer: 'sns_ready', sns_ready: false });
    });

    it('INV-5 Contract-7: Personal KG uses DB summary/list methods without unbounded body reads', async () => {
        const calls = [];
        const repository = {
            async list(filter) {
                calls.push(['list', filter]);
                throw new Error('generic list should not be called');
            },
            async summarizePersonalKg(filter) {
                calls.push(['summarizePersonalKg', filter]);
                return {
                    total: 3146,
                    active_count: 3144,
                    core_count: 2507,
                    sns_ready_count: 634,
                    review_count: 2959,
                    needs_redaction_count: 990,
                    agency_none_count: 2,
                    latest_seen_at: '2026-06-13T18:03:15.814Z'
                };
            },
            async listPersonalKg(filter) {
                calls.push(['listPersonalKg', filter]);
                return [
                    { id: 'latest', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'synthesize', body: 'bounded row', memory_layer: 'personal_kg_core', created_at: '2026-06-13T18:03:15.814Z' }
                ];
            }
        };

        const result = await new AdminVisualizationService({ candidateRepository: repository }).listPersonalKg(access, { limit: 1, layer: 'personal_kg_core' });

        expect(calls.map(([method]) => method)).toEqual(['summarizePersonalKg', 'listPersonalKg']);
        expect(calls[0][1]).toMatchObject({ owner_person_id: 'sato', limit: 1, memory_layer: 'personal_kg_core', role: 'gm', clearance: ['internal'] });
        expect(result.summary.total).toBe(3146);
        expect(result.summary.returned_count).toBe(1);
        expect(result.summary.limit).toBe(1);
        expect(result.summary.truncated).toBe(true);
        expect(result.records.map((record) => record.id)).toEqual(['latest']);
    });

    it('INV-5 Contract-7: Personal KG resolves configured owner aliases to the legacy sato_keigo memory owner', async () => {
        const calls = [];
        const repository = {
            async list() {
                throw new Error('generic list should not be called');
            },
            async summarizePersonalKg(filter) {
                calls.push(['summarizePersonalKg', filter]);
                return {
                    total: 3146,
                    active_count: 3144,
                    core_count: 2507,
                    sns_ready_count: 634,
                    review_count: 2959,
                    needs_redaction_count: 990,
                    agency_none_count: 2,
                    latest_seen_at: '2026-06-13T18:03:15.814Z'
                };
            },
            async listPersonalKg(filter) {
                calls.push(['listPersonalKg', filter]);
                return [
                    { id: 'legacy-owner-row', owner_person_id: 'sato_keigo', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'confidential', role_min: 'member', promotion_status: 'approved', redaction_status: 'none', agency_level: 'synthesize', body: 'legacy owner memory', memory_layer: 'personal_kg_core', created_at: '2026-06-13T18:03:15.814Z' }
                ];
            }
        };

        const result = await new AdminVisualizationService({
            candidateRepository: repository,
            env: {
                BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
                BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'per_current,per_stale'
            }
        }).listPersonalKg({
            role: 'ceo',
            projectCodes: ['brainbase'],
            clearance: ['internal'],
            personId: 'per_current'
        }, { limit: 5 });

        expect(calls.map(([method]) => method)).toEqual(['summarizePersonalKg', 'listPersonalKg']);
        expect(calls[0][1]).toMatchObject({ owner_person_id: 'sato_keigo', role: 'ceo', clearance: ['internal'], owner_read: true });
        expect(result.owner_person_id).toBe('sato_keigo');
        expect(result.summary.total).toBe(3146);
        expect(result.records.map((record) => record.id)).toEqual(['legacy-owner-row']);
    });

    it('INV-5 Contract-7: Personal KG uses an owner and organization scoped repository transaction', async () => {
        const calls = [];
        const scopedRepository = {
            async summarizePersonalKg(filter) {
                calls.push(['summarizePersonalKg', filter]);
                return { total: 1, active_count: 1, core_count: 1 };
            },
            async listPersonalKg(filter) {
                calls.push(['listPersonalKg', filter]);
                return [{
                    id: 'scoped-row',
                    owner_person_id: 'sato_keigo',
                    cognitive_type: 'insight',
                    visibility: 'owner',
                    sensitivity: 'internal',
                    role_min: 'member',
                    promotion_status: 'approved',
                    redaction_status: 'none',
                    body: 'scoped memory',
                    created_at: '2026-06-13T18:03:15.814Z'
                }];
            }
        };
        const repository = {
            async list() {
                throw new Error('unscoped list must not be called');
            },
            async summarizePersonalKg() {
                throw new Error('unscoped summary must not be called');
            },
            async listPersonalKg() {
                throw new Error('unscoped Personal KG list must not be called');
            },
            async transaction(work, options) {
                calls.push(['transaction', options.access]);
                return work(scopedRepository);
            }
        };

        const result = await new AdminVisualizationService({
            candidateRepository: repository,
            env: {
                BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
                BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'per_current'
            }
        }).listPersonalKg({
            role: 'ceo',
            projectCodes: ['brainbase'],
            clearance: ['internal'],
            personId: 'per_current',
            organizationId: 'unson'
        }, { limit: 1 });

        expect(calls[0]).toEqual(['transaction', expect.objectContaining({
            personId: 'sato_keigo',
            organizationId: 'unson'
        })]);
        expect(calls.map(([method]) => method)).toEqual(['transaction', 'summarizePersonalKg', 'listPersonalKg']);
        expect(result.records.map((record) => record.id)).toEqual(['scoped-row']);
    });

    it('INV-5 Contract-7: Personal KG summary fallback still applies owner visibility and filters', async () => {
        const repository = {
            async summarizePersonalKg() {
                return { total: 4, active_count: 4, review_count: 1 };
            },
            async list() {
                return [
                    { id: 'visible', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', requires_approval: true, body: 'visible', created_at: '2026-06-13T00:00:00.000Z' },
                    { id: 'legacy-private', owner_person_id: 'sato', cognitive_type: 'preference', source_system: 'brainbase', visibility: 'private', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'legacy private', created_at: '2026-06-12T00:00:00.000Z' },
                    { id: 'team-hidden', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'team', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'team hidden', created_at: '2026-06-11T00:00:00.000Z' },
                    { id: 'restricted-hidden', owner_person_id: 'sato', cognitive_type: 'insight', source_system: 'brainbase', visibility: 'owner', sensitivity: 'restricted', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'restricted hidden', created_at: '2026-06-10T00:00:00.000Z' },
                    { id: 'type-hidden', owner_person_id: 'sato', cognitive_type: 'misc', source_system: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'type hidden', created_at: '2026-06-09T00:00:00.000Z' }
                ];
            }
        };

        const result = await new AdminVisualizationService({ candidateRepository: repository }).listPersonalKg(access, { limit: 10 });

        expect(result.records.map((record) => record.id)).toEqual(['visible', 'legacy-private']);
        expect(result.records[0]).toMatchObject({ requires_approval: true });
        expect(JSON.stringify(result)).not.toContain('team hidden');
        expect(JSON.stringify(result)).not.toContain('restricted hidden');
        expect(JSON.stringify(result)).not.toContain('type hidden');
    });

    it('INV-5 Contract-7: overview uses Personal KG summary without fetching record bodies', async () => {
        const repository = {
            async list() {
                return [];
            },
            async summarizePersonalKg(filter) {
                expect(filter).toMatchObject({ owner_person_id: 'sato', limit: 50 });
                return { total: 10, active_count: 9, sns_ready_count: 3, review_count: 2 };
            },
            async listPersonalKg() {
                throw new Error('overview must not fetch Personal KG records');
            }
        };

        const overview = await new AdminVisualizationService({ infoSSOTService, candidateRepository: repository }).getOverview(access);

        expect(overview.personal_kg.total).toBe(10);
        expect(overview.personal_kg.summary.returned_count).toBe(0);
        expect(overview.personal_kg.summary.limit).toBe(0);
    });

    it('INV-7 Contract-7: Personal KG surfaces denied owner filters instead of silently falling back', async () => {
        let listCalled = false;
        const repository = {
            async list() {
                listCalled = true;
                return [
                    { id: 'other-owner', owner_person_id: 'umeda', cognitive_type: 'insight', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: '見えない' }
                ];
            }
        };
        const result = await new AdminVisualizationService({ candidateRepository: repository }).listPersonalKg(access, { owner: 'umeda' });
        expect(listCalled).toBe(false);
        expect(result.status).toBe('available');
        expect(result.owner_person_id).toBeNull();
        expect(result.requested_owner_person_id).toBe('umeda');
        expect(result.records).toEqual([]);
        expect(result.warnings[0]).toContain('現在の権限では表示できません');
        expect(JSON.stringify(result)).not.toContain('見えない');
    });

    it('INV-8 AP-3: health and previews do not expose secret values or connection strings', async () => {
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository, env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db', AUTH_SESSION_SECRET: 'super-secret-value' } });
        const payload = JSON.stringify({ health: await service.getHealth(access), candidates: await service.listCandidates(access, {}) });
        expect(payload).not.toContain('super-secret-value');
        expect(payload).not.toContain('postgres://user:secret@example.com/db');
        expect(payload).not.toContain('postgres://user:password@example.com/db');
        expect(payload).not.toContain('xoxb-123456789012-abcdefghijkl');
        expect(payload).not.toContain('xoxc-123456789012-abcdefghijkl');
        expect(payload).not.toContain('xoxd-123456789012-abcdefghijkl');
        expect(payload).not.toContain('xapp-123456789012-abcdefghijkl');
        expect(payload).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
        expect(payload).not.toContain('oauth-secret');
        expect(payload).not.toContain('client-secret');
        expect(payload).not.toContain('hmac-secret');
        expect(payload).toContain('[masked]');
    });

    it('INV-8 AP-3: scrubSecretValue masks Slack browser and app credentials', () => {
        const payload = scrubSecretValue('xoxc-123456789012-abcdefghijkl xoxd-123456789012-abcdefghijkl xapp-123456789012-abcdefghijkl');
        expect(payload).toBe('[masked] [masked] [masked]');
    });

    it('INV-8 Contract-6: health checks actual DB connectivity while keeping connection strings redacted', async () => {
        const queries = [];
        const service = new AdminVisualizationService({
            candidateRepository: {
                ...candidateRepository,
                pool: {
                    async query(sql) {
                        queries.push(sql);
                        return { rows: [{ ok: 1 }] };
                    }
                }
            },
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        });

        const health = await service.getHealth(access);

        expect(queries).toEqual(['SELECT 1 AS ok']);
        expect(health.runtime_config.database).toMatchObject({ status: 'available', connection_status: 'connected', value: null, value_redacted: true });
        expect(health.runtime_config.checks[0]).toMatchObject({ source_class: 'personal_kg', label: '個人KG read path', status: 'available' });
        expect(JSON.stringify(health)).not.toContain('postgres://user:secret@example.com/db');
    });

    it('INV-8 Contract-6: DB health reports unavailable on connection failure without leaking secrets', async () => {
        const service = new AdminVisualizationService({
            candidateRepository: {
                ...candidateRepository,
                pool: {
                    async query() {
                        throw new Error('password secret failed');
                    }
                }
            },
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        });

        const health = await service.getHealth(access);

        expect(health.runtime_config.database.status).toBe('unavailable');
        expect(health.runtime_config.database.connection_status).toBe('unavailable');
        expect(health.runtime_config.database.reason).toContain('DB接続確認に失敗しました');
        expect(JSON.stringify(health)).not.toContain('postgres://user:secret@example.com/db');
    });

    it('INV-8 Contract-6: configured DB without a pool is partial, not healthy', async () => {
        const health = await new AdminVisualizationService({
            candidateRepository,
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        }).getHealth(access);

        expect(health.runtime_config.database).toMatchObject({ status: 'configured', connection_status: 'not_configured' });
        expect(health.sources.find((source) => source.source_class === 'candidate_store').status).toBe('partial');
        expect(health.sources.find((source) => source.source_class === 'runtime_config').status).toBe('partial');
        expect(JSON.stringify(health)).not.toContain('postgres://user:secret@example.com/db');
    });

    it('INV-8 Contract-6: health marks Personal KG unavailable when the read path fails even if DB connects', async () => {
        const calls = [];
        const service = new AdminVisualizationService({
            candidateRepository: {
                async list() {
                    calls.push('list');
                    return [];
                },
                async summarizePersonalKg() {
                    calls.push('summarizePersonalKg');
                    throw new Error('missing relation memory_candidates postgres://user:secret@example.com/db');
                },
                async listPersonalKg() {
                    calls.push('listPersonalKg');
                    return [];
                },
                pool: {
                    async query() {
                        return { rows: [{ ok: 1 }] };
                    }
                }
            },
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        });

        const health = await service.getHealth(access);

        expect(calls).toEqual(['summarizePersonalKg']);
        expect(health.runtime_config.database.status).toBe('available');
        expect(health.runtime_config.checks[0]).toMatchObject({ source_class: 'personal_kg', status: 'unavailable' });
        expect(health.sources.find((source) => source.source_class === 'personal_kg')).toMatchObject({ status: 'unavailable' });
        expect(health.sources.find((source) => source.source_class === 'runtime_config').status).toBe('unavailable');
        expect(JSON.stringify(health)).not.toContain('missing relation');
        expect(JSON.stringify(health)).not.toContain('postgres://user:secret@example.com/db');
    });

    it('INV-8 Contract-6: health checks Personal KG inside the owner and organization scoped transaction', async () => {
        const calls = [];
        const service = new AdminVisualizationService({
            candidateRepository: {
                async list() {
                    throw new Error('unscoped list must not be called');
                },
                async summarizePersonalKg() {
                    throw new Error('unscoped summary must not be called');
                },
                async listPersonalKg() {
                    throw new Error('unscoped Personal KG list must not be called');
                },
                async transaction(work, options) {
                    calls.push(['transaction', options.access]);
                    return work({
                        async summarizePersonalKg(filter) {
                            calls.push(['summarizePersonalKg', filter]);
                            return { total: 1, active_count: 1 };
                        },
                        async listPersonalKg(filter) {
                            calls.push(['listPersonalKg', filter]);
                            return [];
                        }
                    });
                }
            },
            env: {
                BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
                BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'per_current'
            }
        });

        const readiness = await service.getPersonalKgReadiness({
            role: 'ceo',
            projectCodes: ['brainbase'],
            clearance: ['internal'],
            personId: 'per_current',
            organizationId: 'unson'
        });

        expect(calls[0]).toEqual(['transaction', expect.objectContaining({
            personId: 'sato_keigo',
            organizationId: 'unson'
        })]);
        expect(calls.map(([method]) => method)).toEqual(['transaction', 'summarizePersonalKg', 'listPersonalKg']);
        expect(readiness.status).toBe('available');
    });

    it('INV-8 AP-3: unavailable source reasons do not expose upstream exception text', async () => {
        const upstreamSecret = 'postgres://user:password@example.com/db bbsvc_secret-token xoxb-123456789012-abcdefghijkl';
        const service = new AdminVisualizationService({
            infoSSOTService: {
                async listGraphEntities() {
                    throw new Error(`graph failed with ${upstreamSecret}`);
                },
                async getContext() {
                    throw new Error(`context failed with ${upstreamSecret}`);
                }
            },
            candidateRepository: {
                async list() {
                    throw new Error(`candidate failed with ${upstreamSecret}`);
                },
                async summarizePersonalKg() {
                    throw new Error(`personal kg failed with ${upstreamSecret}`);
                },
                pool: {
                    async query() {
                        throw new Error(`db failed with ${upstreamSecret}`);
                    }
                }
            },
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        });

        const payload = JSON.stringify({
            graph: await service.listGraphEntities(access, {}),
            candidates: await service.listCandidates(access, {}),
            personalKg: await service.listPersonalKg(access, {}),
            context: await service.previewContext(access, {}),
            health: await service.getHealth(access)
        });

        expect(payload).toContain('Graph正本を取得できません');
        expect(payload).toContain('候補ストアを取得できません');
        expect(payload).toContain('個人KGを取得できません');
        expect(payload).toContain('AI文脈プレビューを取得できません');
        expect(payload).toContain('DB接続確認に失敗しました');
        expect(payload).not.toContain('graph failed');
        expect(payload).not.toContain('candidate failed');
        expect(payload).not.toContain('personal kg failed');
        expect(payload).not.toContain('context failed');
        expect(payload).not.toContain('db failed');
        expect(payload).not.toContain('postgres://user:password@example.com/db');
        expect(payload).not.toContain('postgres://user:secret@example.com/db');
        expect(payload).not.toContain('bbsvc_secret-token');
        expect(payload).not.toContain('xoxb-123456789012-abcdefghijkl');
    });

    it('INV-9 Contract-1: overview source cards follow actual list and DB health failures', async () => {
        const failingRepository = {
            pool: {
                async query() {
                    throw new Error('db secret unavailable');
                }
            },
            async list() {
                throw new Error('candidate list failed');
            }
        };
        const overview = await new AdminVisualizationService({
            infoSSOTService,
            candidateRepository: failingRepository,
            env: { INFO_SSOT_DATABASE_URL: 'postgres://user:secret@example.com/db' }
        }).getOverview(access);

        expect(overview.candidates.status).toBe('unavailable');
        expect(overview.personal_kg.status).toBe('unavailable');
        expect(overview.runtime_config.database.status).toBe('unavailable');
        expect(overview.sources.find((source) => source.source_class === 'candidate_store').status).toBe('unavailable');
        expect(overview.sources.find((source) => source.source_class === 'personal_kg').status).toBe('unavailable');
        expect(overview.sources.find((source) => source.source_class === 'runtime_config').status).toBe('unavailable');
        expect(JSON.stringify(overview)).not.toContain('postgres://user:secret@example.com/db');
    });

    it('INV-9 S-2: missing dependencies return partial unavailable health without throwing', async () => {
        const overview = await new AdminVisualizationService().getOverview(access);
        expect(overview.graph.status).toBe('unavailable');
        expect(overview.candidates.status).toBe('unavailable');
        expect(overview.personal_kg.status).toBe('unavailable');
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

    it('Contract-5: data-flow uses direct candidate id lookup before bounded list scans', async () => {
        const calls = [];
        const repository = {
            async findById(id) {
                calls.push(['findById', id]);
                return { id, owner_person_id: 'sato', cognitive_type: 'preference', source_system: 'codex', project_code: 'brainbase', visibility: 'owner', sensitivity: 'internal', role_min: 'member', promotion_status: 'candidate', redaction_status: 'none', body: 'older candidate' };
            },
            async list(filter) {
                calls.push(['list', filter]);
                return [];
            }
        };
        const service = new AdminVisualizationService({ infoSSOTService, candidateRepository: repository });

        const flow = await service.getDataFlow(access, { project: 'brainbase', candidate: 'older_candidate' });

        expect(flow.steps[0]).toMatchObject({ source_class: 'candidate_store', status: 'available' });
        expect(calls[0]).toEqual(['findById', 'older_candidate']);
    });

    it('INV-9 Contract-5: data-flow preserves unavailable source statuses instead of reporting not_found', async () => {
        const service = new AdminVisualizationService({
            infoSSOTService: {
                async listGraphEntities() {
                    throw new Error('graph outage postgres://user:secret@example.com/db');
                }
            },
            candidateRepository: {
                async list() {
                    throw new Error('candidate outage postgres://user:secret@example.com/db');
                }
            }
        });

        const flow = await service.getDataFlow(access, { project: 'brainbase', candidate: 'cand_1', entity: 'project_brainbase' });

        expect(flow.steps[0]).toMatchObject({ source_class: 'candidate_store', status: 'unavailable' });
        expect(flow.steps[1]).toMatchObject({ source_class: 'graph_ssot', status: 'unavailable' });
        expect(flow.steps[3]).toMatchObject({ source_class: 'personal_kg', status: 'unavailable' });
        expect(JSON.stringify(flow)).not.toContain('candidate outage');
        expect(JSON.stringify(flow)).not.toContain('graph outage');
        expect(JSON.stringify(flow)).not.toContain('postgres://user:secret@example.com/db');
    });
});
