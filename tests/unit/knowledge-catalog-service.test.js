import { describe, expect, it, vi } from 'vitest';

import {
    KnowledgeCatalogError,
    KnowledgeCatalogService
} from '../../server/services/knowledge-catalog-service.js';

function entity(overrides = {}) {
    return {
        id: 'dec_1',
        entity_type: 'decision',
        project_code: 'alpha',
        updated_at: '2026-09-17T00:00:00.000Z',
        payload: {
            title: 'Canonical decision',
            status: 'active',
            owner_id: 'per_owner',
            repository_path: 'docs/decision.md',
            version: '3'
        },
        ...overrides
    };
}

function createService(rows = []) {
    const infoSSOTService = {
        listGraphEntities: vi.fn(async (_access, input) => rows.filter((row) => (
            (!input.entityType || row.entity_type === input.entityType)
            && (!input.projectCode || row.project_code === input.projectCode)
            && (!input.id || row.id === input.id)
            && (!input.ids || input.ids.includes(row.id))
        ))),
        listGraphEdges: vi.fn(async () => [])
    };
    return { service: new KnowledgeCatalogService({ infoSSOTService }), infoSSOTService };
}

describe('KnowledgeCatalogService', () => {
    it('project knowledgeとprojectへ適用される組織knowledgeをcanonical idで重複排除する', async () => {
        const duplicate = entity();
        const { service } = createService([
            duplicate,
            { ...duplicate },
            entity({ id: 'doc_org', entity_type: 'document', payload: {
                title: 'Org document', status: 'active', version: '1', applicability_scope: { scope: 'organization' }
            } }),
            entity({ id: 'dec_hidden', project_code: 'secret' })
        ]);

        const result = await service.list({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', status: 'all'
        });

        expect(result.state).toBe('results');
        expect(result.records.map((row) => row.id)).toEqual(['dec_1', 'doc_org']);
        expect(result.records[0]).toMatchObject({
            scope: 'project',
            source: { pointer: 'docs/decision.md', content_state: 'pointer_only' },
            applicability: { state: 'applicable' }
        });
        expect(result.absence_confirmed).toBe(false);
    });

    it('通常検索はinactiveとunknownを含めず、空結果を失敗と区別する', async () => {
        const { service } = createService([
            entity({ id: 'retired', payload: { status: 'retired', title: 'old' } }),
            entity({ id: 'unknown', payload: { title: 'unknown' } })
        ]);

        const result = await service.list({ projectCodes: ['alpha'] }, { project_code: 'alpha' });

        expect(result).toMatchObject({ state: 'empty', records: [], absence_confirmed: false });
    });

    it('scope外projectはGraph query前に拒否する', async () => {
        const { service, infoSSOTService } = createService();

        await expect(service.list({ projectCodes: ['alpha'] }, { project_code: 'secret' }))
            .rejects.toMatchObject({ code: 'knowledge_project_not_accessible', status: 403 });
        expect(infoSSOTService.listGraphEntities).not.toHaveBeenCalled();
    });

    it('Graph取得失敗を空結果へ変換しない', async () => {
        const failure = new Error('database unavailable');
        const service = new KnowledgeCatalogService({
            infoSSOTService: {
                listGraphEntities: vi.fn(async () => { throw failure; }),
                listGraphEdges: vi.fn()
            }
        });

        await expect(service.list({ projectCodes: ['alpha'] }, { project_code: 'alpha' }))
            .rejects.toBe(failure);
    });

    it('detailはrelationを返し、見えないentityは存在を漏らさず404にする', async () => {
        const visible = entity();
        const previous = entity({ id: 'dec_0' });
        const hidden = entity({ id: 'hidden', project_code: 'secret' });
        const { service, infoSSOTService } = createService([visible, previous, hidden]);
        infoSSOTService.listGraphEdges.mockResolvedValue([{
            rel_type: 'supersedes', from_id: 'dec_1', to_id: 'dec_0', payload: { provenance: 'manual' }
        }]);

        await expect(service.get({ projectCodes: ['alpha'] }, { project_code: 'alpha', id: 'dec_1' }))
            .resolves.toMatchObject({ relations: [{ relation: 'supersedes', to_id: 'dec_0' }] });
        await expect(service.get({ projectCodes: ['alpha'] }, { project_code: 'alpha', id: 'hidden' }))
            .rejects.toEqual(expect.objectContaining({
                code: 'knowledge_not_found', status: 404
            }));
        expect(KnowledgeCatalogError).toBeDefined();
    });

    it('query時に対象projectを絞り、別projectを検索しない', async () => {
        const { service, infoSSOTService } = createService([
            entity(),
            entity({ id: 'other', project_code: 'other' })
        ]);
        const access = { projectCodes: ['alpha', 'other'] };

        const result = await service.list(access, { project_code: 'alpha', status: 'all' });

        expect(result.records.map((row) => row.id)).toEqual(['dec_1']);
        expect(infoSSOTService.listGraphEntities.mock.calls.map(([, input]) => input.projectCode))
            .toEqual(['alpha', 'alpha']);
    });

    it('今回本文を取得していないcatalogでは過去flagがあってもpointer_onlyを返す', async () => {
        const { service } = createService([entity({ payload: {
            title: 'flagged', status: 'active', version: 4, repository_path: 'docs/x.md', content_fetched: true
        } })]);
        const result = await service.list({ projectCodes: ['alpha'] }, { project_code: 'alpha' });
        expect(result.records[0]).toMatchObject({ version: '4', source: { content_state: 'pointer_only' } });
    });

    it('relation endpointが可視entityとしてreadbackできない場合はIDを返さない', async () => {
        const { service, infoSSOTService } = createService([entity()]);
        infoSSOTService.listGraphEdges.mockResolvedValue([{
            rel_type: 'evidenced_by', from_id: 'dec_1', to_id: 'hidden_doc', payload: {}
        }]);
        const result = await service.get({ projectCodes: ['alpha'] }, { project_code: 'alpha', id: 'dec_1' });
        expect(result.relations).toEqual([]);
    });

    it('version固定の実本文取得だけをresolvedにし、版不一致を採用しない', async () => {
        const { service: base, infoSSOTService } = createService([entity()]);
        const contentRetriever = {
            authorize: vi.fn(async () => true),
            retrieve: vi.fn(async () => ({ content: '# body', receipt_id: 'receipt_1' }))
        };
        const service = new KnowledgeCatalogService({ infoSSOTService, contentRetriever });

        const result = await service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            refs: [{ id: 'dec_1', version: '3' }, { id: 'dec_1', version: '2' }]
        });

        expect(result.results).toEqual([
            expect.objectContaining({ id: 'dec_1', status: 'resolved', content: '# body', retrieval_receipt_id: 'receipt_1' }),
            expect.objectContaining({ id: 'dec_1', status: 'version_conflict', resolved_version: '3' })
        ]);
        expect(contentRetriever.authorize).toHaveBeenCalledOnce();
        expect(contentRetriever.retrieve).toHaveBeenCalledOnce();
        expect(base).toBeDefined();
    });

    it('source adapterが主体とpointerを明示承認しない限り外部本文を取得しない', async () => {
        const { infoSSOTService } = createService([entity()]);
        const contentRetriever = { authorize: vi.fn(async () => false), retrieve: vi.fn() };
        const service = new KnowledgeCatalogService({ infoSSOTService, contentRetriever });
        const result = await service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '3' }]
        });
        expect(result.results[0].status).toBe('source_unavailable');
        expect(contentRetriever.authorize).toHaveBeenCalledOnce();
        expect(contentRetriever.retrieve).not.toHaveBeenCalled();
    });

    it('Graph正本のdecision statementは外部source adapterなしで実本文として取得する', async () => {
        const { service } = createService([entity({ payload: {
            title: 'Graph decision', statement: 'Use the canonical Graph.', status: 'active', version: 7
        } })]);

        const result = await service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '7' }]
        });

        expect(result.results[0]).toMatchObject({
            status: 'resolved',
            content: 'Use the canonical Graph.',
            source: { kind: 'graph_entity', content_state: 'fetched' },
            retrieval_receipt_id: 'graph:dec_1:7'
        });
    });

    it('previewは下書きを保存せず隔離し、固定例と実行結果を分ける', async () => {
        const { infoSSOTService } = createService([entity()]);
        const previewAnswerer = vi.fn(async () => ({ answer: 'draft-aware answer', selected_ids: ['draft_1'] }));
        const service = new KnowledgeCatalogService({ infoSSOTService, previewAnswerer });

        const result = await service.preview({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            question: 'what applies?',
            draft_version: 'draft-v2',
            draft: { id: 'draft_1', title: 'Draft', summary: 'not published' },
            sample_answer: 'fixed example'
        });

        expect(result).toMatchObject({
            isolation: 'draft_only',
            draft_version: 'draft-v2',
            sample_answer: 'fixed example',
            executed_result: { state: 'completed', answer: 'draft-aware answer' },
            applicability_guaranteed: false
        });
        expect(infoSSOTService.listGraphEntities).toHaveBeenCalledTimes(2);
    });
});
