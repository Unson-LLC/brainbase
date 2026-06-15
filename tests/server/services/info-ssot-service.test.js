import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const buildService = () => {
    process.env.INFO_SSOT_DATABASE_URL = 'postgres://test';
    const service = new InfoSSOTService();
    const client = {
        query: vi.fn(async (text) => {
            if (typeof text === 'string' && text.startsWith('SELECT id FROM projects')) {
                return { rows: [{ id: 'prj_1' }] };
            }
            if (typeof text === 'string' && text.startsWith('SELECT id FROM people')) {
                return { rows: [{ id: 'per_1' }] };
            }
            if (typeof text === 'string' && text.includes('FROM raci_assignments')) {
                return { rows: [{ ok: 1 }] };
            }
            if (typeof text === 'string' && text.includes('INSERT INTO raci_assignments')) {
                return { rows: [{ id: 'rac_1' }] };
            }
            return { rows: [] };
        }),
        release: vi.fn()
    };
    service.pool = { connect: vi.fn(async () => client) };
    return { service, client };
};

const accessContext = {
    role: 'gm',
    projectCodes: ['brainbase'],
    clearance: ['internal', 'restricted', 'finance', 'hr', 'contract']
};

describe('InfoSSOTService (Graph SSOT)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('getContext呼び出し時_includePhilosophy未指定_既存レスポンスを維持する', async () => {
        const { service } = buildService();
        const fetchSpy = vi.spyOn(service, 'fetchGraphEntities').mockImplementation(async (_client, _access, { entityType }) => {
            if (entityType === 'project') {
                return [{
                    id: 'prj_brainbase',
                    entity_type: 'project',
                    payload: { code: 'brainbase', name: 'Brainbase' }
                }];
            }
            return [];
        });

        const result = await service.getContext(accessContext, {
            projectCode: 'brainbase',
            entityTypes: 'project',
            includePhilosophy: false
        });

        expect(result.philosophy_context).toBeUndefined();
        expect(result.entities.project).toHaveLength(1);
        expect(fetchSpy).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ entityType: 'philosophy' })
        );
    });

    it('listGraphEntities呼び出し時_id指定はlimit付き一覧ではなくID検索を使う', async () => {
        const { service } = buildService();
        const byIdsSpy = vi.spyOn(service, 'fetchGraphEntitiesByIds').mockResolvedValue([{ id: 'project_brainbase', entity_type: 'project' }]);
        const listSpy = vi.spyOn(service, 'fetchGraphEntities');

        const rows = await service.listGraphEntities(accessContext, { id: 'project_brainbase', projectCode: 'brainbase' });

        expect(rows).toEqual([{ id: 'project_brainbase', entity_type: 'project' }]);
        expect(byIdsSpy).toHaveBeenCalledWith(expect.anything(), accessContext, { ids: ['project_brainbase'], projectCode: 'brainbase' });
        expect(listSpy).not.toHaveBeenCalled();
    });

    it('getContext呼び出し時_includePhilosophy有効_scope別思想contextを返す', async () => {
        const { service } = buildService();
        vi.spyOn(service, 'fetchGraphEntities').mockImplementation(async (_client, _access, { entityType }) => {
            if (entityType === 'project') {
                return [{
                    id: 'prj_brainbase',
                    entity_type: 'project',
                    payload: { code: 'brainbase', name: 'Brainbase' }
                }];
            }
            if (entityType === 'philosophy') {
                return [
                    {
                        id: 'phi_graph_ssot_first',
                        entity_type: 'philosophy',
                        payload: {
                            philosophy_id: 'phi_graph_ssot_first',
                            display_name: 'Graph SSOTを一次情報にする',
                            statement: '固有名詞、関係、判断、進行状態はGraphを一次情報として扱う。',
                            priority: 'core',
                            decision_tests: ['Graphを一次情報として確認したか'],
                            anti_patterns: ['議事録だけを正本にする']
                        }
                    },
                    {
                        id: 'phi_push_case_center',
                        entity_type: 'philosophy',
                        payload: {
                            philosophy_id: 'phi_push_case_center',
                            display_name: 'CRMの中心は推進案件',
                            statement: 'CRMは顧客台帳ではなく、価値仮説を前に進める push_case を中心に設計する。',
                            priority: 'core'
                        }
                    },
                    {
                        id: 'phi_ui_is_projection',
                        entity_type: 'philosophy',
                        payload: {
                            philosophy_id: 'phi_ui_is_projection',
                            display_name: 'UIは正本ではなく投影',
                            statement: 'UIは表示・操作の入口であり、正本は用途別のデータ層に置く。',
                            priority: 'core'
                        }
                    },
                    {
                        id: 'phi_data_ownership_by_use',
                        entity_type: 'philosophy',
                        payload: {
                            philosophy_id: 'phi_data_ownership_by_use',
                            display_name: '用途ごとに正本を分ける',
                            statement: '全データを1箇所に集めず、用途別に正本を分ける。',
                            priority: 'recommended',
                            decision_tests: ['正本と投影を分けているか'],
                            anti_patterns: ['NocoDBを顧客正本にする']
                        }
                    }
                ];
            }
            return [];
        });

        const result = await service.getContext(accessContext, {
            projectCode: 'brainbase',
            entityTypes: 'project',
            includePhilosophy: true,
            scope: 'crm',
            maxRecommended: 8
        });

        expect(result.entities.project).toHaveLength(1);
        expect(result.philosophy_context).toMatchObject({
            mode: 'graph_operation_context',
            project_code: 'brainbase',
            scope: 'crm'
        });
        expect(result.philosophy_context.core.map(item => item.philosophy_id)).toEqual(
            expect.arrayContaining(['phi_graph_ssot_first', 'phi_push_case_center', 'phi_ui_is_projection'])
        );
        expect(result.philosophy_context.recommended.map(item => item.philosophy_id)).toContain('phi_data_ownership_by_use');
        expect(result.philosophy_context.applied_ids).toEqual(
            expect.arrayContaining(['phi_push_case_center', 'phi_ui_is_projection', 'phi_data_ownership_by_use'])
        );
        expect(result.philosophy_context.prompt_block).toContain('Brainbase Philosophy Context');
        expect(result.philosophy_context.prompt_block).toContain('CRMの中心は推進案件');
        expect(result.philosophy_context.decision_tests).toContain('正本と投影を分けているか');
        expect(result.philosophy_context.anti_patterns).toContain('NocoDBを顧客正本にする');
    });

    it('getContext呼び出し時_includePhilosophy有効でcore思想がない場合_失敗する', async () => {
        const { service } = buildService();
        vi.spyOn(service, 'fetchGraphEntities').mockImplementation(async (_client, _access, { entityType }) => {
            if (entityType === 'philosophy') {
                return [{
                    id: 'phi_data_ownership_by_use',
                    entity_type: 'philosophy',
                    payload: {
                        philosophy_id: 'phi_data_ownership_by_use',
                        display_name: '用途ごとに正本を分ける',
                        statement: '用途別に正本を分ける。',
                        priority: 'recommended'
                    }
                }];
            }
            return [];
        });

        await expect(service.getContext(accessContext, {
            projectCode: 'brainbase',
            entityTypes: 'project',
            includePhilosophy: true,
            scope: 'crm'
        })).rejects.toThrow('Core philosophy context is not configured');
    });

    it('createDecision writes graph entity and edges', async () => {
        const { service, client } = buildService();

        await service.createDecision(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'gm',
            sensitivity: 'internal',
            title: 'Decide Graph SSOT',
            decisionDomain: 'ops',
            context: { reason: 'AI-first' },
            options: [],
            chosen: { plan: 'graph' }
        });

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('decision');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project', 'owned_by', 'member_of']));
    });

    it('createDecision rejects finance when role_min is member', async () => {
        const { service } = buildService();

        await expect(service.createDecision(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'member',
            sensitivity: 'finance',
            title: 'Finance Only',
            decisionDomain: 'finance'
        })).rejects.toThrow('Sensitive data requires role_min gm or ceo');
    });

    it('createRaci writes member_of edge', async () => {
        const { service, client } = buildService();

        await service.createRaci(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            personName: 'Bob',
            roleCode: 'gm',
            roleMin: 'gm',
            sensitivity: 'internal',
            authorityScope: 'ops'
        });

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toContain('member_of');
    });

    it('ensurePerson_既存personが見つかった場合_payloadを上書きしない', async () => {
        const { service, client } = buildService();

        client.query.mockImplementation(async (text, params) => {
            const sql = String(text);
            if (sql.includes('FROM graph_entities') && sql.includes("entity_type = 'person'")) {
                return { rows: [{ id: 'per_existing' }] };
            }
            return { rows: [] };
        });

        const id = await service.ensurePerson(client, { personName: '佐藤 圭吾' });

        expect(id).toBe('per_existing');

        // 既存 person を見つけたら、graph_entities への INSERT/UPSERT を一切実行しない
        const writeCalls = client.query.mock.calls.filter(([sql]) =>
            String(sql).includes('INSERT INTO graph_entities')
            || String(sql).includes('INSERT INTO people')
        );
        expect(writeCalls).toHaveLength(0);
    });

    it('ensurePerson_aliasにマッチする名前を渡した場合_既存personIDを返す', async () => {
        const { service, client } = buildService();

        // graph_entities の aliases match だけ通す
        const aliasQueries = [];
        client.query.mockImplementation(async (text, params) => {
            const sql = String(text);
            if (sql.includes('FROM graph_entities') && sql.includes("entity_type = 'person'")) {
                aliasQueries.push({ sql, params });
                // 「渡辺」を「渡邊 博昭」のエイリアスとして発見
                return { rows: [{ id: 'per_watanabe_hiroaki' }] };
            }
            return { rows: [] };
        });

        const id = await service.ensurePerson(client, { personName: '渡辺' });

        expect(id).toBe('per_watanabe_hiroaki');
        // alias 検索クエリが少なくとも 1 回発行されている
        expect(aliasQueries.length).toBeGreaterThan(0);
        // クエリには aliases 配列の検索が含まれる
        expect(aliasQueries[0].sql).toMatch(/aliases/);
    });

    it('ensurePerson_空白の有無で別人扱いされない', async () => {
        const { service, client } = buildService();

        const passedParams = [];
        client.query.mockImplementation(async (text, params) => {
            const sql = String(text);
            if (sql.includes('FROM graph_entities') && sql.includes("entity_type = 'person'")) {
                passedParams.push(params);
                return { rows: [{ id: 'per_sato_keigo' }] };
            }
            return { rows: [] };
        });

        const id1 = await service.ensurePerson(client, { personName: '佐藤 圭吾' });
        const id2 = await service.ensurePerson(client, { personName: '佐藤圭吾' });

        expect(id1).toBe('per_sato_keigo');
        expect(id2).toBe('per_sato_keigo');

        // 正規化（空白除去）された値もパラメータに含まれていることを検証
        const allParams = passedParams.flat();
        expect(allParams).toContain('佐藤圭吾');
    });

    it('createGlossaryTerm writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createGlossaryTerm(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            term: 'SSOT',
            reading: 'エスエスオーティー',
            correctForm: 'Single Source of Truth',
            incorrectForms: ['SSOTT', 'S.S.O.T'],
            category: 'architecture',
            description: '唯一の正本',
            roleMin: 'member',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.glossary_term_id).toMatch(/^gls_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('glossary_term');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const glossaryPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.term === 'SSOT';
        });
        expect(glossaryPayload).toBeTruthy();
        const parsed = JSON.parse(glossaryPayload);
        expect(parsed.reading).toBe('エスエスオーティー');
        expect(parsed.correct_form).toBe('Single Source of Truth');
        expect(parsed.incorrect_forms).toEqual(['SSOTT', 'S.S.O.T']);
        expect(parsed.category).toBe('architecture');
        expect(parsed.description).toBe('唯一の正本');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project']));
    });

    it('createGlossaryTerm requires term', async () => {
        const { service } = buildService();

        await expect(service.createGlossaryTerm(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            description: 'missing term field',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('term is required');
    });

    it('createKpi writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createKpi(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            metricName: 'Task Completion Rate',
            targetValue: '80',
            currentValue: '65',
            unit: '%',
            period: 'monthly',
            description: 'タスク完了率',
            roleMin: 'member',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.kpi_id).toMatch(/^kpi_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('kpi');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const kpiPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.metric_name === 'Task Completion Rate';
        });
        expect(kpiPayload).toBeTruthy();
        const parsed = JSON.parse(kpiPayload);
        expect(parsed.target_value).toBe('80');
        expect(parsed.current_value).toBe('65');
        expect(parsed.unit).toBe('%');
        expect(parsed.period).toBe('monthly');
        expect(parsed.description).toBe('タスク完了率');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project']));
    });

    it('createKpi requires metricName', async () => {
        const { service } = buildService();

        await expect(service.createKpi(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            targetValue: '80',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('metricName is required');
    });

    it('createInitiative writes graph entity and edges with full payload', async () => {
        const { service, client } = buildService();

        const result = await service.createInitiative(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            title: 'Graph SSOT Migration',
            description: 'Migrate all entities to graph',
            status: 'in_progress',
            startDate: '2026-02-01',
            roleMin: 'gm',
            sensitivity: 'internal',
            source: 'manual'
        });

        expect(result.initiative_id).toMatch(/^ini_/);
        expect(result.event_id).toMatch(/^evt_/);

        const entityCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_entities'));
        const entityTypes = entityCalls.map(([, params]) => params?.[1]).filter(Boolean);
        expect(entityTypes).toContain('initiative');

        const payloads = entityCalls.map(([, params]) => params?.[3]).filter(Boolean);
        const iniPayload = payloads.find(p => {
            const parsed = JSON.parse(p);
            return parsed.title === 'Graph SSOT Migration';
        });
        expect(iniPayload).toBeTruthy();
        const parsed = JSON.parse(iniPayload);
        expect(parsed.status).toBe('in_progress');
        expect(parsed.start_date).toBe('2026-02-01');
        expect(parsed.description).toBe('Migrate all entities to graph');

        const edgeCalls = client.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO graph_edges'));
        const relTypes = edgeCalls.map(([, params]) => params?.[3]).filter(Boolean);
        expect(relTypes).toEqual(expect.arrayContaining(['belongs_to_project', 'owned_by', 'member_of']));
    });

    it('createInitiative requires title', async () => {
        const { service } = buildService();

        await expect(service.createInitiative(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            ownerPersonName: 'Alice',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toThrow('title is required');
    });
});
