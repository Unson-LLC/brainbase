import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const buildService = () => {
    process.env.INFO_SSOT_DATABASE_URL = 'postgres://test';
    const service = new InfoSSOTService();
    const client = {
        query: vi.fn(async (text, params = []) => {
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
            if (typeof text === 'string' && text.includes('WHERE id = ANY')) {
                const entityTypeByPrefix = {
                    prj: 'project',
                    per: 'person',
                    dec: 'decision',
                    rac: 'raci_assignment',
                    gls: 'glossary_term',
                    kpi: 'kpi',
                    ini: 'initiative',
                    qry: 'ai_query',
                    aid: 'ai_decision'
                };
                return {
                    rows: (params[0] || []).map((id) => ({
                        id,
                        entity_type: entityTypeByPrefix[String(id).split('_')[0]]
                    }))
                };
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

const expectActiveOntologyGuard = (result) => {
    expect(result).toMatchObject({
        guard_status: 'active_current',
        ontology_version: '1.1.0'
    });
};

describe('InfoSSOTService (Graph SSOT)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['fetchGraphEntities', 'fetchGraphEntitiesByIds'])('%sはactiveかつ閲覧可能なmember_ofだけでprojectless Personを公開する', async (method) => {
        const { service, client } = buildService();
        client.query.mockResolvedValue({ rows: [] });
        if (method === 'fetchGraphEntities') {
            await service[method](client, accessContext, { projectCode: 'brainbase', limit: 10 });
        } else {
            await service[method](client, accessContext, { ids: ['per_1'], projectCode: 'brainbase' });
        }
        const sql = client.query.mock.calls[0][0];
        expect(sql).toContain("gx.lifecycle_status = 'active'");
        expect(sql).toContain('gx.sensitivity = ANY($4)');
        expect(sql).toContain("CASE gx.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END");
        expect(sql).toContain("gy.lifecycle_status = 'active'");
        expect(sql).toContain('gy.sensitivity = ANY($4)');
        expect(sql.match(/px\.code = ANY\(\$3\)/g)).toHaveLength(2);
    });

    it('cross-tenant edge readは両endpointのproject accessをSQLで要求する', async () => {
        const { service, client } = buildService();
        client.query.mockResolvedValue({ rows: [] });
        await service.fetchGraphEdges(client, accessContext, { projectCode: 'brainbase', limit: 10 });
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toContain('endpoint.id=ge.from_id');
        expect(sql).toContain('endpoint.id=ge.to_id');
        expect(sql).toContain('endpoint_project.code=ANY($5)');
        expect(sql).toContain('endpoint.sensitivity=ANY($6)');
        expect(sql).toContain("endpoint.project_id IS NULL AND endpoint.entity_type='person'");
        expect(sql).toContain("membership.rel_type='member_of'");
        expect(sql).toContain('membership_project.code=ANY($5)');
        expect(sql).toContain("CASE endpoint.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END");
        expect(sql).toContain("ge.payload->>'target_project_code'=ANY($5)");
        expect(sql).toContain("ge.rel_type='governs'");
        expect(sql).toContain("ge.payload->>'cross_tenant'='true'");
        expect(sql).toContain("ge.role_min='ceo'");
        expect(sql).toContain("ge.sensitivity='restricted'");
        expect(sql).toContain('app_graph_entity_organization_id(source_entity.id) IS NOT NULL');
        expect(sql).toContain('app_graph_entity_organization_id(target_entity.id) IS NOT NULL');
        expect(sql).toContain('IS NOT DISTINCT FROM app_graph_entity_organization_id(target_entity.id)');
        expect(sql).not.toContain('source_project.code IS DISTINCT FROM target_project.code');
        expect(params[4]).toEqual(['brainbase']);
    });

    it.each([
        [['brainbase'], 0],
        [['aitle'], 0],
        [['brainbase', 'aitle'], 1]
    ])('cross-tenant edgeはscope=%jのとき許可行列どおり%d件返す', async (projectCodes, expectedCount) => {
        const edge = { id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' };
        const client = { query: vi.fn(async (_sql, params) => ({
            rows: params[4].includes('brainbase') && params[4].includes('aitle') ? [edge] : []
        })) };
        const service = new InfoSSOTService({ pool: {} });
        const rows = await service.fetchGraphEdges(client, {
            role: 'ceo', projectCodes, clearance: ['internal', 'restricted']
        }, { projectCode: projectCodes[0], limit: 10 });
        expect(rows).toHaveLength(expectedCount);
        expect(rows).toEqual(expectedCount ? [edge] : []);
        expect(client.query.mock.calls[0][0].match(/AND EXISTS/g)).toHaveLength(5);
    });

    it.each([
        ['gm', 2, 0],
        ['ceo', 3, 1]
    ])('cross-tenant governsはrole=%sのときCEO契約どおり%d件返す', async (role, expectedRank, expectedCount) => {
        const edge = { id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs', role_min: 'ceo' };
        const client = { query: vi.fn(async (_sql, params) => ({ rows: params[6] >= 3 ? [edge] : [] })) };
        const service = new InfoSSOTService({ pool: {} });
        const rows = await service.fetchGraphEdges(client, {
            role, projectCodes: ['brainbase', 'aitle'], clearance: ['internal', 'restricted']
        }, { projectCode: 'brainbase', limit: 10 });
        expect(client.query.mock.calls[0][1][6]).toBe(expectedRank);
        expect(rows).toHaveLength(expectedCount);
    });

    it.each([
        [['decision_1'], []],
        [['product_aitle'], []],
        [['decision_1', 'product_aitle'], ['Aitle公開名 -[governs]-> Aitle']]
    ])('human-readable relationは可視endpoint=%jのときtarget IDを漏らさない', async (visibleIds, expected) => {
        const entities = {
            decision_1: { id: 'decision_1', entity_type: 'decision', payload: { title: 'Aitle公開名' } },
            product_aitle: { id: 'product_aitle', entity_type: 'product', payload: { name: 'Aitle', status: 'active' } }
        };
        const client = { query: vi.fn(async () => ({ rows: visibleIds.map(id => entities[id]) })) };
        const service = new InfoSSOTService({ pool: {} });
        const lines = await service.summarizeEdges(client, {
            role: 'ceo', projectCodes: ['brainbase', 'aitle'], clearance: ['internal', 'restricted']
        }, [{ id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' }]);
        expect(lines).toEqual(expected);
        expect(lines.join('\n')).not.toContain('product_aitle');
    });

    it.each([
        ['ceo', ['brainbase', 'aitle'], 1],
        ['ceo', ['brainbase'], 0],
        ['gm', ['brainbase', 'aitle'], 0]
    ])('getContext公開面はrole=%s scope=%jで越境Edgeを%d件返す', async (role, projectCodes, expectedCount) => {
        const service = new InfoSSOTService({ pool: {} });
        const edge = { id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' };
        service.withAccessContext = async (_access, callback) => callback({ query: vi.fn() });
        vi.spyOn(service, 'fetchGraphEntities').mockResolvedValue([]);
        vi.spyOn(service, 'fetchGraphEdges').mockImplementation(async (_client, access) => (
            access.role === 'ceo' && access.projectCodes.includes('brainbase') && access.projectCodes.includes('aitle') ? [edge] : []
        ));
        vi.spyOn(service, 'summarizeEdges').mockImplementation(async (_client, _access, edges) => (
            edges.length ? ['Decision -[governs]-> Aitle'] : []
        ));
        const result = await service.getContext({ role, projectCodes, clearance: ['internal', 'restricted'] }, {
            projectCode: 'brainbase', entityTypes: 'decision', includeEdges: true, humanReadable: true
        });
        expect(result.edges).toHaveLength(expectedCount);
        expect(JSON.stringify(result.report)).not.toContain('product_aitle');
        expect(result.report.meta.edge_count).toBe(expectedCount);
        expect(result.report.relations).toEqual(expectedCount ? ['Decision -[governs]-> Aitle'] : []);
    });

    it.each([
        ['ceo', ['brainbase', 'aitle'], 1],
        ['ceo', ['brainbase'], 0],
        ['gm', ['brainbase', 'aitle'], 0]
    ])('AI query公開面はrole=%s scope=%jで越境Edgeを%d件返す', async (role, projectCodes, expectedCount) => {
        const service = new InfoSSOTService({ pool: {} });
        const client = { query: vi.fn(async () => ({ rows: [] })) };
        const edge = { id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' };
        service.withAccessContext = async (_access, callback) => callback(client);
        vi.spyOn(service, 'getProjectId').mockResolvedValue('project_brainbase');
        vi.spyOn(service, 'ensurePerson').mockResolvedValue('person_ai');
        vi.spyOn(service, 'upsertGraphEntity').mockResolvedValue(undefined);
        vi.spyOn(service, 'upsertGraphEdge').mockResolvedValue(undefined);
        vi.spyOn(service, 'fetchGraphEdges').mockImplementation(async (_client, access) => (
            access.role === 'ceo' && access.projectCodes.includes('brainbase') && access.projectCodes.includes('aitle') ? [edge] : []
        ));
        vi.spyOn(service, 'summarizeEdges').mockImplementation(async (_client, _access, edges) => (
            edges.length ? ['Decision -[governs]-> Aitle'] : []
        ));
        const result = await service.createAiQuery({ role, projectCodes, clearance: ['internal', 'restricted'] }, {
            projectCode: 'brainbase', actorPersonName: 'AI', queryType: 'edges',
            roleMin: 'member', sensitivity: 'internal', humanReadable: true
        });
        expect(result.records).toHaveLength(expectedCount);
        expect(JSON.stringify(result.summary_lines)).not.toContain('product_aitle');
    });

    it('Graph展開は両endpointが見えるedgeだけを再帰する', async () => {
        const client = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [{ id: 'decision_1' }] })
                .mockResolvedValueOnce({ rows: [{ id: 'decision_1' }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 'decision_1' }] })
        };
        const service = new InfoSSOTService({ pool: {} });
        service.withAccessContext = async (_access, callback) => callback(client);
        await service.expandGraph({
            organizationId: 'org_1', projectCodes: ['brainbase'], clearance: ['internal'], role: 'ceo'
        }, { projectCode: 'brainbase', seedId: 'decision_1' });
        const recursiveSql = client.query.mock.calls[1][0];
        expect(recursiveSql).toContain("ge.payload->>'target_project_code'=ANY($3)");
        expect(recursiveSql).toContain('COUNT(DISTINCT endpoint.id)');
        expect(recursiveSql).toContain('endpoint_project.code=ANY($3)');
        expect(recursiveSql).toContain('endpoint.sensitivity=ANY($4)');
        expect(recursiveSql).toContain("endpoint.project_id IS NULL AND endpoint.entity_type='person'");
        expect(recursiveSql).toContain("membership.rel_type='member_of'");
        expect(service.fetchGraphEntitiesByIds).toBeDefined();
    });

    it('通常Edge APIは別project endpointへの書込みを保守APIへ限定する', async () => {
        const service = new InfoSSOTService({ pool: {} });
        const client = { query: vi.fn(async () => ({ rows: [
            { id: 'decision_1', project_id: 'project_brainbase' },
            { id: 'product_aitle', project_id: 'project_aitle' }
        ] })) };
        service.withAccessContext = async (_access, callback) => callback(client);
        service.ensureProject = vi.fn().mockResolvedValue('project_brainbase');
        vi.spyOn(service, 'validateGraphMutation').mockResolvedValue(undefined);
        await expect(service.createOrUpdateGraphEdge({
            role: 'ceo', projectCodes: ['brainbase', 'aitle'], clearance: ['internal', 'restricted']
        }, {
            fromId: 'decision_1', toId: 'product_aitle', relType: 'governs', projectCode: 'brainbase',
            roleMin: 'ceo', sensitivity: 'restricted'
        })).rejects.toMatchObject({ code: 'GRAPH_CROSS_PROJECT_WRITE_REQUIRES_MAINTENANCE', status: 409 });
        expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_edges'))).toBe(false);
    });

    it('human-readable summaryはprojectless Personをactive member_of経由で解決する', async () => {
        const service = new InfoSSOTService({ pool: {} });
        const client = { query: vi.fn(async () => ({ rows: [
            { id: 'person_1', entity_type: 'person', payload: { name: '佐藤' } },
            { id: 'decision_1', entity_type: 'decision', payload: { title: '判断' } }
        ] })) };
        const lines = await service.summarizeEdges(client, {
            role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal']
        }, [{ from_id: 'person_1', to_id: 'decision_1', rel_type: 'decided' }]);
        expect(lines).toEqual(['佐藤 -[decided]-> 判断']);
        const sql = client.query.mock.calls[0][0];
        expect(sql).toContain('LEFT JOIN projects');
        expect(sql).toContain("ge.project_id IS NULL AND ge.entity_type='person'");
        expect(sql).toContain("membership.rel_type='member_of'");
    });

    it('active ontology permits updating an app whose required owner relation already exists', async () => {
        const { service, client } = buildService();
        client.query.mockImplementation(async (sql) => {
            if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: 'prj_1' }] };
            if (sql.includes('FROM graph_edges')) {
                return { rows: [{ id: 'edge_owner', from_id: 'app_one', to_id: 'org_one', rel_type: 'owned_by' }] };
            }
            if (sql.includes('FROM graph_entities') && sql.includes('id = ANY')) {
                return { rows: [
                    { id: 'app_one', entity_type: 'app', payload: { name: 'Old' } },
                    { id: 'org_one', entity_type: 'org', payload: { name: 'Owner' } }
                ] };
            }
            return { rows: [], rowCount: 1 };
        });

        await expect(service.createOrUpdateGraphEntity(accessContext, {
            id: 'app_one',
            entityType: 'app',
            projectCode: 'brainbase',
            payload: { name: 'Updated' },
            roleMin: 'member',
            sensitivity: 'internal'
        })).resolves.toMatchObject({ entity_id: 'app_one', guard_status: 'active_current' });
    });

    it('active ontology rejects a second owner edge before persistence', async () => {
        const { service, client } = buildService();
        client.query.mockImplementation(async (sql) => {
            if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: 'prj_1' }] };
            if (sql.includes('FROM graph_edges')) {
                return { rows: [{ id: 'edge_owner', from_id: 'app_one', to_id: 'org_one', rel_type: 'owned_by' }] };
            }
            if (sql.includes('FROM graph_entities') && sql.includes('id = ANY')) {
                return { rows: [
                    { id: 'app_one', entity_type: 'app', payload: { name: 'App' } },
                    { id: 'org_one', entity_type: 'org', payload: { name: 'Owner one' } },
                    { id: 'org_two', entity_type: 'org', payload: { name: 'Owner two' } }
                ] };
            }
            return { rows: [], rowCount: 1 };
        });

        await expect(service.createOrUpdateGraphEdge(accessContext, {
            fromId: 'app_one',
            toId: 'org_two',
            relType: 'owned_by',
            projectCode: 'brainbase',
            roleMin: 'member',
            sensitivity: 'internal'
        })).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
        expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_edges'))).toBe(false);
        const statements = client.query.mock.calls.map(([sql]) => String(sql));
        expect(statements.findIndex((sql) => sql.includes('SELECT id') && sql.includes('FOR UPDATE')))
            .toBeLessThan(statements.findIndex((sql) => sql.includes('FROM graph_edges')));
    });

    it('getPersonBySlackIdは有効なgrantを確認しGraph人物へ紐づくusersのperson_idを優先する', async () => {
        const { service, client } = buildService();
        client.query.mockResolvedValueOnce({ rows: [{ id: 'per_1', name: 'Test User' }] });

        const person = await service.getPersonBySlackId('U123', 'T123');

        expect(person).toEqual({ id: 'per_1', name: 'Test User' });
        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM auth_grants'),
            ['U123', 'T123']
        );
        const sql = client.query.mock.calls[0][0];
        expect(sql).toContain('LEFT JOIN users');
        expect(sql).toContain('COALESCE(u.person_id, ag.person_id)');
        expect(sql).toContain('ag.slack_workspace_id = $2');
        expect(sql).toContain('ag.active = true');
        expect(sql).not.toContain('people_slack');
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

    it('旧org IDのtyped getはalias行ではなくcanonical orgへ解決する', async () => {
        const { service } = buildService();
        const byIdsSpy = vi.spyOn(service, 'fetchGraphEntitiesByIds')
            .mockResolvedValueOnce([{ id: 'org_baao', entity_type: 'org_alias' }])
            .mockResolvedValueOnce([{ id: 'baao', entity_type: 'org', payload: { name: 'BAAO' } }]);
        vi.spyOn(service, 'fetchGraphAliasTargetsByIds').mockResolvedValue([
            { alias_id: 'org_baao', canonical_entity_id: 'baao' }
        ]);

        const rows = await service.listGraphEntities(accessContext, {
            id: 'org_baao',
            projectCode: 'brainbase',
            entityType: 'org'
        });

        expect(rows).toEqual([{ id: 'baao', entity_type: 'org', payload: { name: 'BAAO' } }]);
        expect(byIdsSpy).toHaveBeenNthCalledWith(2, expect.anything(), accessContext, {
            ids: ['baao'],
            projectCode: 'brainbase'
        });
    });

    it('旧person IDのtyped getはcanonical personへ解決する', async () => {
        const { service } = buildService();
        vi.spyOn(service, 'fetchGraphEntitiesByIds')
            .mockResolvedValueOnce([{ id: 'per_legacy', entity_type: 'person_alias' }])
            .mockResolvedValueOnce([{ id: 'per_canonical', entity_type: 'person', payload: { name: '佐藤 圭吾' } }]);
        vi.spyOn(service, 'fetchGraphAliasTargetsByIds').mockResolvedValue([
            { alias_id: 'per_legacy', canonical_entity_id: 'per_canonical' }
        ]);

        const rows = await service.listGraphEntities(accessContext, {
            id: 'per_legacy',
            projectCode: 'brainbase',
            entityType: 'person'
        });

        expect(rows.map((row) => row.id)).toEqual(['per_canonical']);
    });

    it('org/personの型付き一覧はalias解決を行わずcanonical型だけを列挙する', async () => {
        const { service } = buildService();
        const listSpy = vi.spyOn(service, 'fetchGraphEntities').mockResolvedValue([
            { id: 'baao', entity_type: 'org' }
        ]);
        const aliasSpy = vi.spyOn(service, 'fetchGraphAliasTargetsByIds');

        const rows = await service.listGraphEntities(accessContext, { entityType: 'org' });

        expect(rows).toEqual([{ id: 'baao', entity_type: 'org' }]);
        expect(listSpy).toHaveBeenCalledOnce();
        expect(aliasSpy).not.toHaveBeenCalled();
    });

    it('listGraphEntities呼び出し時_queryをGraph検索へ渡す', async () => {
        const { service } = buildService();
        const listSpy = vi.spyOn(service, 'fetchGraphEntities').mockResolvedValue([]);

        await service.listGraphEntities(accessContext, {
            projectCode: 'brainbase',
            entityType: 'person',
            query: '矢島様',
            limit: 20
        });

        expect(listSpy).toHaveBeenCalledWith(expect.anything(), accessContext, {
            projectCode: 'brainbase',
            entityType: 'person',
            query: '矢島様',
            limit: 20
        });
    });

    it('finance entityは呼出元のclearanceとroleをDB検索条件で同時に制約する', async () => {
        const { service, client } = buildService();
        const memberAccess = {
            role: 'member',
            projectCodes: ['unson'],
            clearance: ['internal']
        };

        await service.listGraphEntities(memberAccess, {
            projectCode: 'unson',
            entityType: 'finance_account',
            limit: 20
        });

        const graphQuery = client.query.mock.calls.find(([text]) => (
            typeof text === 'string'
            && text.includes('FROM graph_entities ge')
            && text.includes('ge.sensitivity = ANY($4)')
        ));
        expect(graphQuery).toBeDefined();
        expect(graphQuery[0]).toContain("CASE ge.role_min WHEN 'member' THEN 1 WHEN 'gm' THEN 2 WHEN 'ceo' THEN 3 END");
        expect(graphQuery[1]).toEqual([
            'unson',
            'finance_account',
            ['unson'],
            ['internal'],
            1,
            null,
            null,
            20
        ]);
    });

    it('member/internalからfinance entityはID・型の双方で不可視、ceo/financeでは可視になる', async () => {
        const { service, client } = buildService();
        const financeRow = {
            id: 'fin_unson_bank_account',
            entity_type: 'finance_account',
            role_min: 'ceo',
            sensitivity: 'finance'
        };
        client.query.mockImplementation(async (text, params = []) => {
            if (typeof text !== 'string' || !text.includes('FROM graph_entities ge')) return { rows: [] };
            const canReadFinance = params.some((value) => Array.isArray(value) && value.includes('finance'))
                && params.includes(3);
            return { rows: canReadFinance ? [financeRow] : [] };
        });
        const member = { role: 'member', projectCodes: ['unson'], clearance: ['internal'] };
        const ceo = { role: 'ceo', projectCodes: ['unson'], clearance: ['internal', 'finance'] };

        const memberById = await service.listGraphEntities(member, {
            id: financeRow.id,
            projectCode: 'unson'
        });
        const memberByType = await service.listGraphEntities(member, {
            projectCode: 'unson',
            entityType: 'finance_account'
        });
        const ceoById = await service.listGraphEntities(ceo, {
            id: financeRow.id,
            projectCode: 'unson'
        });

        expect(memberById).toEqual([]);
        expect(memberByType).toEqual([]);
        expect(ceoById).toEqual([financeRow]);
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

    it('事業projectのcontextへBrainbase共通思想とproject固有思想を合成する', async () => {
        const { service } = buildService();
        const fetchSpy = vi.spyOn(service, 'fetchGraphEntities').mockImplementation(async (_client, access, { projectCode, entityType }) => {
            if (entityType === 'project' && projectCode === 'baao') {
                return [{
                    id: 'prj_baao',
                    entity_type: 'project',
                    payload: { code: 'baao', name: 'BAAO' }
                }];
            }
            if (entityType !== 'philosophy') return [];
            if (projectCode === 'brainbase') {
                expect(access.projectCodes).toContain('brainbase');
                return [{
                    id: 'phi_graph_ssot_first',
                    entity_type: 'philosophy',
                    payload: {
                        philosophy_id: 'phi_graph_ssot_first',
                        display_name: 'Graph SSOTを一次情報にする',
                        statement: 'Graphを一次情報として扱う。',
                        priority: 'core'
                    }
                }];
            }
            if (projectCode === 'baao') {
                return [{
                    id: 'phi_baao_trusted_ai_adoption',
                    entity_type: 'philosophy',
                    payload: {
                        philosophy_id: 'phi_baao_trusted_ai_adoption',
                        display_name: 'BAAO Trusted AI Adoption',
                        statement: '信頼できるAI活用を普及する。',
                        priority: 'core'
                    }
                }];
            }
            return [];
        });

        const result = await service.getContext({
            role: 'member',
            projectCodes: ['baao'],
            clearance: ['internal']
        }, {
            projectCode: 'baao',
            entityTypes: 'project',
            includePhilosophy: true,
            scope: 'graph'
        });

        expect(result.philosophy_context.project_code).toBe('baao');
        expect(result.philosophy_context.core.map(item => item.philosophy_id)).toEqual(
            expect.arrayContaining(['phi_graph_ssot_first', 'phi_baao_trusted_ai_adoption'])
        );
        expect(fetchSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ projectCodes: ['baao'] }),
            expect.objectContaining({ projectCode: 'baao', entityType: 'philosophy' })
        );
    });

    it('固有思想がない事業projectでもBrainbase共通core思想を返す', async () => {
        const { service, client } = buildService();
        vi.spyOn(service, 'fetchGraphEntities').mockImplementation(async (_client, _access, { projectCode, entityType }) => {
            if (entityType === 'philosophy' && projectCode === 'brainbase') {
                return [{
                    id: 'phi_graph_ssot_first',
                    entity_type: 'philosophy',
                    payload: {
                        philosophy_id: 'phi_graph_ssot_first',
                        display_name: 'Graph SSOTを一次情報にする',
                        statement: 'Graphを一次情報として扱う。',
                        priority: 'core'
                    }
                }];
            }
            return [];
        });

        const result = await service.getContext({
            role: 'member',
            projectCodes: ['zeims'],
            clearance: ['internal']
        }, {
            projectCode: 'zeims',
            entityTypes: 'project',
            includePhilosophy: true,
            scope: 'graph'
        });

        expect(result.philosophy_context).toMatchObject({
            project_code: 'zeims',
            scope: 'graph'
        });
        expect(result.philosophy_context.core.map(item => item.philosophy_id)).toContain('phi_graph_ssot_first');
        expect(client.query).toHaveBeenCalledWith(
            'SELECT set_config($1, $2, true)',
            ['app.project_codes', 'zeims,brainbase']
        );
        expect(client.query).toHaveBeenCalledWith(
            'SELECT set_config($1, $2, true)',
            ['app.project_codes', 'zeims']
        );
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

        const result = await service.createDecision(accessContext, {
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
        expectActiveOntologyGuard(result);

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

        const result = await service.createRaci(accessContext, {
            projectCode: 'brainbase',
            projectName: 'Brainbase',
            personName: 'Bob',
            roleCode: 'gm',
            roleMin: 'gm',
            sensitivity: 'internal',
            authorityScope: 'ops'
        });
        expectActiveOntologyGuard(result);

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
        const allParams = passedParams.flat(2);
        expect(allParams).toContain('佐藤圭吾');
    });

    it('ensurePerson_新規入力のaliasまたはemailが既存personに一致する場合_既存personIDを返す', async () => {
        const { service, client } = buildService();

        client.query.mockImplementation(async (text, params) => {
            const sql = String(text);
            if (sql.includes('FROM graph_entities') && sql.includes("entity_type = 'person'")) {
                expect(params[0]).toContain('矢島様');
                expect(params[1]).toBe('yajima@example.com');
                return { rows: [{ id: 'per_yajima' }] };
            }
            return { rows: [] };
        });

        const id = await service.ensurePerson(client, {
            personName: 'Tsuyoshi Yajima',
            aliases: ['矢島様'],
            email: ' YAJIMA@example.com '
        });

        expect(id).toBe('per_yajima');
        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('pg_advisory_xact_lock'),
            expect.any(Array)
        );
    });

    it('ensurePerson_複数のcanonical personに一致する場合_任意の一人を選ばず失敗する', async () => {
        const { service, client } = buildService();

        client.query.mockImplementation(async (text) => {
            const sql = String(text);
            if (sql.includes('FROM graph_entities') && sql.includes("entity_type = 'person'")) {
                return { rows: [{ id: 'per_a' }, { id: 'per_b' }] };
            }
            return { rows: [] };
        });

        await expect(service.ensurePerson(client, {
            personName: '杉山',
            aliases: ['杉山さん']
        })).rejects.toThrow('Ambiguous person identity: per_a, per_b');
    });

    it('createOrUpdatePerson_email_org_roleを本人照合とpayloadに保存して返す', async () => {
        const { service, client } = buildService();
        vi.spyOn(service, 'ensureProject').mockResolvedValue('prj_universal_arts');
        vi.spyOn(service, 'ensurePerson').mockResolvedValue('per_sugiyama_miki');
        const upsertSpy = vi.spyOn(service, 'upsertGraphEntity').mockResolvedValue();
        vi.spyOn(service, 'upsertGraphEdge').mockResolvedValue();

        client.query.mockImplementation(async (text) => {
            if (String(text).startsWith('SELECT payload FROM graph_entities')) {
                return { rows: [{ payload: { aliases: ['杉山さん'] } }] };
            }
            return { rows: [] };
        });

        const result = await service.createOrUpdatePerson(accessContext, {
            projectCode: 'brainbase',
            name: '杉山 美紀',
            aliases: ['杉山みき'],
            email: ' MIKI@example.com ',
            org: 'ユニバーサルアーツ',
            role: '事務'
        });

        expect(service.ensurePerson).toHaveBeenCalledWith(client, {
            personName: '杉山 美紀',
            aliases: ['杉山みき'],
            email: 'miki@example.com'
        });
        expect(upsertSpy).toHaveBeenCalledWith(client, expect.objectContaining({
            id: 'per_sugiyama_miki',
            payload: expect.objectContaining({
                email: 'miki@example.com',
                org: 'ユニバーサルアーツ',
                role: '事務',
                aliases: ['杉山さん', '杉山みき']
            })
        }));
        expect(result).toMatchObject({
            person_id: 'per_sugiyama_miki',
            email: 'miki@example.com',
            org: 'ユニバーサルアーツ',
            role: '事務',
            guard_status: 'active_current',
            ontology_version: '1.1.0'
        });
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
        expectActiveOntologyGuard(result);

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
        expectActiveOntologyGuard(result);

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
        expectActiveOntologyGuard(result);

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

    it('createAiQuery returns the active ontology guard marker', async () => {
        const { service } = buildService();

        const result = await service.createAiQuery(accessContext, {
            projectCode: 'brainbase',
            actorPersonName: 'AI',
            queryType: 'entities',
            roleMin: 'member',
            sensitivity: 'internal'
        });

        expect(result.query_id).toMatch(/^qry_/);
        expectActiveOntologyGuard(result);
    });

    it('createAiDecisionLog returns the active ontology guard marker', async () => {
        const { service } = buildService();

        const result = await service.createAiDecisionLog(accessContext, {
            projectCode: 'brainbase',
            actorPersonName: 'AI',
            summary: 'Keep the ontology release proposed',
            roleMin: 'member',
            sensitivity: 'internal'
        });

        expect(result.ai_decision_id).toMatch(/^aid_/);
        expectActiveOntologyGuard(result);
    });
});
