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

    it('canonical ownerを優先し、禁止状態とsearchable=falseをactiveより優先する', async () => {
        const { service } = createService([
            entity({ id: 'retracted', payload: {
                title: 'Retracted', status: 'active', semantic_state: 'retracted', searchable: true,
                owner_person_id: 'per_new', owner_id: 'per_old', version: '4'
            } }),
            entity({ id: 'quarantined', payload: {
                title: 'Quarantined', status: 'active', semantic_state: 'quarantined', version: '2'
            } }),
            entity({ id: 'hidden', payload: {
                title: 'Hidden', status: 'active', searchable: false, version: '1'
            } })
        ]);

        const result = await service.list({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', status: 'all'
        });

        expect(result.records.find((row) => row.id === 'retracted')).toMatchObject({
            owner: 'per_new', lifecycle: { status: 'retracted', applicable: false },
            applicability: { state: 'not_applicable' }
        });
        expect(result.records.find((row) => row.id === 'quarantined')).toMatchObject({
            lifecycle: { status: 'quarantined', applicable: false }
        });
        expect(result.records.find((row) => row.id === 'hidden')).toMatchObject({
            lifecycle: { status: 'inactive', applicable: false }
        });
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

    it('アクセス可能な別projectからorganization scopeだけを継承する', async () => {
        const { service, infoSSOTService } = createService([
            entity(),
            entity({ id: 'other', project_code: 'other' }),
            entity({ id: 'org_shared', project_code: 'other', payload: {
                title: 'Shared rule', status: 'active', version: '1', applicability_scope: { scope: 'organization' }
            } })
        ]);
        const access = { projectCodes: ['alpha', 'other'] };

        const result = await service.list(access, { project_code: 'alpha', status: 'all' });

        expect(result.records.map((row) => row.id)).toEqual(['dec_1', 'org_shared']);
        expect(result.records.find((row) => row.id === 'org_shared')).toMatchObject({ scope: 'organization' });
        expect(infoSSOTService.listGraphEntities.mock.calls.map(([, input]) => input.projectCode))
            .toEqual(['alpha', 'alpha', 'other', 'other']);
        expect(result.searched_scope).toEqual(['alpha', 'other']);
    });

    it('organization scopeの継承detailを取得し、別project固有項目は404にする', async () => {
        const { service } = createService([
            entity({ id: 'org_shared', project_code: 'other', payload: {
                title: 'Shared rule', status: 'active', version: '1', applicability_scope: { scope: 'organization' }
            } }),
            entity({ id: 'other_private', project_code: 'other' })
        ]);
        const access = { projectCodes: ['alpha', 'other'] };

        await expect(service.get(access, { project_code: 'alpha', id: 'org_shared' }))
            .resolves.toMatchObject({ id: 'org_shared', scope: 'organization' });
        await expect(service.get(access, { project_code: 'alpha', id: 'other_private' }))
            .rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
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
            retrieve: vi.fn(async () => ({ content: '# body', version: '3', receipt_id: 'receipt_1' }))
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

    it('外部正本の版不明・版不一致・hash不一致をresolvedにしない', async () => {
        const row = entity({ payload: {
            title: 'External', status: 'active', version: '3', repository_path: 'docs/x.md', content_hash: 'sha256:expected'
        } });
        const { infoSSOTService } = createService([row]);
        const retriever = { authorize: vi.fn(async () => true), retrieve: vi.fn() };
        const service = new KnowledgeCatalogService({ infoSSOTService, contentRetriever: retriever });

        retriever.retrieve.mockResolvedValueOnce({ content: 'body', receipt_id: 'r1' });
        await expect(service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '3' }]
        })).resolves.toMatchObject({ results: [{ status: 'source_version_unknown' }] });

        retriever.retrieve.mockResolvedValueOnce({ content: 'body', version: '4', receipt_id: 'r2' });
        await expect(service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '3' }]
        })).resolves.toMatchObject({ results: [{ status: 'source_version_conflict', resolved_version: '4' }] });

        retriever.retrieve.mockResolvedValueOnce({ content: 'body', version: '3', content_hash: 'sha256:other', receipt_id: 'r3' });
        await expect(service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '3' }]
        })).resolves.toMatchObject({ results: [{ status: 'source_hash_conflict' }] });
    });

    it('providerが正本hashを申告しても本文の実hashが異なれば拒否する', async () => {
        const canonicalHash = 'sha256:6b91f31f284917eb2324c10fb19e8a9d540d5c63c5575a5fc2756f02ef97257b';
        const row = entity({ payload: {
            title: 'External', status: 'active', version: '3', repository_path: 'docs/x.md', content_hash: canonicalHash
        } });
        const { infoSSOTService } = createService([row]);
        const retriever = {
            authorize: vi.fn(async () => true),
            retrieve: vi.fn(async () => ({
                content: 'tampered body', version: '3', content_hash: canonicalHash, receipt_id: 'r4'
            }))
        };
        const service = new KnowledgeCatalogService({ infoSSOTService, contentRetriever: retriever });

        const result = await service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: [{ id: 'dec_1', version: '3' }]
        });

        expect(result.results[0]).toMatchObject({
            status: 'source_hash_conflict',
            expected_content_hash: canonicalHash,
            declared_content_hash: canonicalHash,
            observed_content_hash: expect.stringMatching(/^sha256:/)
        });
        expect(result.results[0].observed_content_hash).not.toBe(canonicalHash);
    });

    it('51件以上のrefsを黙って切り捨てず拒否する', async () => {
        const { service } = createService([entity()]);
        await expect(service.retrieve({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', refs: Array.from({ length: 51 }, (_, index) => ({ id: `x${index}`, version: '1' }))
        })).rejects.toMatchObject({ code: 'knowledge_refs_limit_exceeded', status: 400 });
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
            canonical_content_hash: expect.stringMatching(/^sha256:/),
            source: { kind: 'graph_entity', content_state: 'fetched' },
            retrieval_receipt_id: 'graph:dec_1:7'
        });
    });

    it('previewは下書きを保存せず隔離し、固定例と実行結果を分ける', async () => {
        const { infoSSOTService } = createService([entity()]);
        const previewAnswerer = vi.fn(async ({ candidates }) => {
            expect(candidates).toHaveLength(1);
            return {
                answer: 'draft-aware answer',
                citations: [{ id: 'draft_1', version: 'draft-v2' }],
                evidence: [{ id: 'draft_1', version: 'draft-v2', source_ref: 'draft:draft_1' }],
                unknown: [],
                version: 'adapter-v1',
                readback: { state: 'isolated_draft', verified: false }
            };
        });
        const service = new KnowledgeCatalogService({ infoSSOTService, previewAnswerer });

        const result = await service.preview({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            question: 'what applies?',
            draft_version: 'draft-v2',
            draft: { id: 'draft_1', title: 'Draft', summary: 'not published', content: 'draft body' },
            sample_answer: 'fixed example'
        });

        expect(result).toMatchObject({
            isolation: 'draft_only',
            draft_version: 'draft-v2',
            sample_answer: 'fixed example',
            executed_result: { state: 'completed', answer: 'draft-aware answer' },
            applicability_guaranteed: false
        });
        expect(result.readback).toMatchObject({ state: 'isolated_draft', verified: false });
        expect(infoSSOTService.listGraphEntities).toHaveBeenCalledTimes(3);
    });

    it('未設定preview adapterは本文や空結果へ縮退せず503にする', async () => {
        const { service } = createService([entity()]);

        await expect(service.preview({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            question: 'what applies?',
            draft: { id: 'draft_1', version: 'draft-v2', content: 'draft body' }
        })).rejects.toMatchObject({
            code: 'knowledge_preview_answerer_unavailable',
            status: 503
        });
    });

    it('previewはexact-version retrieveの成功本文だけをadapterへ渡し、候補外引用を拒否する', async () => {
        const row = entity({ payload: {
            title: 'Graph decision', statement: 'Use the canonical Graph.', status: 'active', version: '3'
        } });
        const { infoSSOTService } = createService([row]);
        const previewAnswerer = vi.fn(async ({ candidates }) => {
            expect(candidates.map((candidate) => candidate.id)).toEqual(['draft_1', 'dec_1']);
            expect(candidates[1]).toMatchObject({ id: 'dec_1', version: '3', content: 'Use the canonical Graph.' });
            return {
                answer: 'canonical answer',
                citations: [
                    { id: 'draft_1', version: 'draft-v2' },
                    { id: 'dec_1', version: '3' }
                ],
                evidence: [
                    { id: 'draft_1', version: 'draft-v2', source_ref: 'draft:draft_1' },
                    { id: 'dec_1', version: '3', source_ref: 'graph:dec_1:3' }
                ],
                unknown: [],
                version: 'adapter-v1',
                readback: { state: 'provider_verified', verified: true }
            };
        });
        const service = new KnowledgeCatalogService({ infoSSOTService, previewAnswerer });

        const result = await service.preview({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            question: 'what applies?',
            draft_version: 'draft-v2',
            draft: { id: 'draft_1', content: 'draft body' }
        });

        expect(result).toMatchObject({
            answer: 'canonical answer',
            readback: { state: 'verified', verified: true },
            executed_result: { citations: [{ id: 'draft_1' }, { id: 'dec_1' }] }
        });
        expect(result.readback.refs).toEqual([
            expect.objectContaining({ id: 'dec_1', version: '3', status: 'resolved', retrieval_receipt_id: 'graph:dec_1:3' })
        ]);

        const invalidAnswerer = vi.fn(async () => ({
            answer: 'invalid',
            citations: [{ id: 'outside', version: '1' }],
            evidence: [{ id: 'outside', version: '1', source_ref: 'outside:1' }],
            unknown: [],
            version: 'adapter-v1',
            readback: { state: 'provider_verified', verified: true }
        }));
        const invalidService = new KnowledgeCatalogService({ infoSSOTService, previewAnswerer: invalidAnswerer });
        await expect(invalidService.preview({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            question: 'what applies?',
            draft_version: 'draft-v2',
            draft: { id: 'draft_1', content: 'draft body' }
        })).rejects.toMatchObject({ code: 'knowledge_preview_adapter_invalid', status: 502 });
    });

    it('capture proposalはauthorized catalog本文を材料に未保存proposalを返す', async () => {
        const row = entity({ payload: {
            title: 'Graph decision', statement: 'Use the canonical Graph.', status: 'active', version: '3'
        } });
        const { infoSSOTService } = createService([row]);
        const captureProposalAdapter = vi.fn(async ({ materials }) => {
            expect(materials).toEqual([
                expect.objectContaining({ id: 'dec_1', version: '3', content: 'Use the canonical Graph.' })
            ]);
            return {
                proposal: {
                    kind: 'decision',
                    summary: 'A proposed decision',
                    scope: 'project',
                    owner_candidate: 'per_owner',
                    relations: [{ relation: 'supports', target_id: 'dec_1', target_version: '3' }]
                },
                evidence: [{ id: 'dec_1', version: '3', source_ref: 'graph:dec_1:3' }],
                unknown: [],
                version: 'adapter-v1',
                readback: { state: 'provider_verified', verified: true }
            };
        });
        const service = new KnowledgeCatalogService({ infoSSOTService, captureProposalAdapter });

        const result = await service.captureProposal({ projectCodes: ['alpha'] }, {
            project_code: 'alpha',
            content: 'new source note',
            source_refs: [{ id: 'dec_1', version: '3' }]
        });

        expect(result).toMatchObject({
            state: 'proposed',
            canonical: false,
            persisted: false,
            proposal: { kind: 'decision', summary: 'A proposed decision' },
            readback: { state: 'proposal_only', verified: false },
            version: { adapter: 'adapter-v1' }
        });
        expect(result.unknown).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'canonical_persistence', state: 'unknown' })
        ]));
    });

    it('未設定capture adapterは503にし、proposalを推測生成しない', async () => {
        const { service } = createService([entity()]);
        await expect(service.captureProposal({ projectCodes: ['alpha'] }, {
            project_code: 'alpha', content: 'new source note'
        })).rejects.toMatchObject({
            code: 'knowledge_capture_proposal_unavailable',
            status: 503
        });
    });
});
