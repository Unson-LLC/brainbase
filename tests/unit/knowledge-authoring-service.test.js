import { describe, expect, it, vi } from 'vitest';

import { KnowledgeAuthoringService } from '../../server/services/knowledge-authoring-service.js';

function harness() {
    const drafts = new Map();
    const saves = new Map();
    const reuses = new Map();
    const repository = {
        createDraft: vi.fn(async (draft) => {
            const row = { ...draft, created_at: '2026-09-17T00:00:00.000Z', updated_at: '2026-09-17T00:00:00.000Z' };
            drafts.set(row.draft_id, row);
            return row;
        }),
        getDraft: vi.fn(async (id) => drafts.get(id) || null),
        updateDraft: vi.fn(async (id, patch) => {
            const row = drafts.get(id);
            if (!row || row.revision !== patch.expected_revision || row.status !== 'draft') return null;
            const updated = { ...row, ...patch, revision: row.revision + 1 };
            drafts.set(id, updated);
            return updated;
        }),
        transitionDraft: vi.fn(async (id, transition) => {
            const row = drafts.get(id);
            if (!row || row.revision !== transition.expected_revision || row.status !== 'draft') return null;
            const updated = { ...row, status: transition.status, revision: row.revision + 1 };
            drafts.set(id, updated);
            return updated;
        }),
        findSave: vi.fn(async (key) => saves.get(key) || null),
        findReuse: vi.fn(async (key) => reuses.get(key) || null),
        claimSave: vi.fn(async (id, claim) => {
            const row = drafts.get(id);
            if (!row || row.revision !== claim.expected_revision
                || !['draft', 'saving'].includes(row.status)
                || (row.status === 'saving' && row.save_idempotency_key !== claim.idempotency_key)) return null;
            const claimed = { ...row, status: 'saving', save_idempotency_key: claim.idempotency_key,
                save_decision_domain: claim.decision_domain };
            drafts.set(id, claimed);
            return claimed;
        }),
        completeSave: vi.fn(async (save) => {
            const row = drafts.get(save.draft_id);
            drafts.set(save.draft_id, { ...row, status: 'saved', canonical_id: save.canonical_id, saved_event_id: save.event_id });
            saves.set(save.idempotency_key, { ...save });
        }),
        completeReuse: vi.fn(async (reuse) => {
            reuses.set(reuse.idempotency_key, { result: reuse.result });
            return reuse;
        })
    };
    const knowledgeEventService = { ingest: vi.fn(async (event) => ({
        event_id: event.event_id, graph_entity_id: event.subject.id, semantic_state: 'active', processing_stage: 'retrievable'
    })) };
    const catalogService = { get: vi.fn(async (_access, input) => ({
        id: input.id,
        type: 'decision',
        version: input.id === 'decision_existing' ? '7' : '1',
        canonical_content: input.id === 'decision_existing' ? 'Existing truth.' : 'Use canonical truth.',
        source: { kind: 'graph', id: input.id },
        lifecycle: { status: 'active', applicable: true }
    })) };
    const graphRepository = {
        validateAuthoringContext: vi.fn(async (input) => ({
            owner_person_id: input.owner_person_id,
            relations: input.relations || [],
            authority_verified: Boolean(input.decision_domain)
        })),
        persistAuthoringRelations: vi.fn(async (input) => ({
            graph_saved: true,
            readback_verified: true,
            relation_count: 2 + (input.relations || []).length,
            relations: [
                { from_id: input.entity_id, to_id: input.owner_person_id, relation: 'owned_by', payload: {} },
                { from_id: input.entity_id, to_id: input.project_code, relation: 'belongs_to', payload: {} },
                ...(input.relations || []).map((relation) => ({
                    from_id: input.entity_id,
                    to_id: relation.to_id,
                    relation: relation.relation,
                    payload: relation.payload || {}
                }))
            ]
        })),
        reuseCanonical: vi.fn(async (input) => ({
            canonical: {
                id: input.entity_id,
                type: input.entity_type,
                version: input.expected_version,
                canonical_content: 'Existing truth.'
            },
            relation_count: 2 + (input.relations || []).length,
            relations: [
                { from_id: input.entity_id, to_id: input.owner_person_id, relation: 'owned_by', payload: {} },
                { from_id: input.entity_id, to_id: input.project_code, relation: 'belongs_to', payload: {} },
                ...(input.relations || []).map((relation) => ({
                    from_id: input.entity_id,
                    to_id: relation.to_id,
                    relation: relation.relation,
                    payload: relation.payload || {}
                }))
            ],
            graph_saved: true,
            readback_verified: true
        })),
        changeLifecycle: vi.fn(async () => ({ id: 'decision_123' })),
        reviseDecision: vi.fn(async (input) => ({ id: input.id, payload: { version: 'rev_2' } })),
        establishSupersession: vi.fn(async () => ({
            replacement: { payload: { version: 'rev_new' } },
            superseded: { payload: { version: 'rev_old' } }
        })),
        listLifecycleHistory: vi.fn(async () => [{ from_version: '1', to_version: '2', state: 'retired' }]),
        listRevisionHistory: vi.fn(async () => []),
        listSupersessionHistory: vi.fn(async () => []),
        listDecisionAuthorityDomains: vi.fn(async () => ['engineering'])
    };
    const service = new KnowledgeAuthoringService({
        repository, knowledgeEventService, catalogService, graphRepository,
        now: () => '2026-09-17T00:00:00.000Z', id: () => 'draft'
    });
    return { service, repository, knowledgeEventService, catalogService, graphRepository, drafts, saves };
}

const access = { projectCodes: ['alpha'], personId: 'per_1', organizationId: 'org_1' };

describe('KnowledgeAuthoringService', () => {
    it('不完全な入力をdraftとして保存し、未知kindは黙ってdecisionにしない', async () => {
        const { service } = harness();
        await expect(service.createDraft(access, { project_code: 'alpha', title: 'title only' }))
            .resolves.toMatchObject({ title: 'title only', content: '', status: 'draft' });
        await expect(service.createDraft(access, { project_code: 'alpha', kind: 'memo' }))
            .rejects.toMatchObject({ code: 'knowledge_draft_kind_unsupported', status: 400 });
    });

    it('責任者と関係をdraftへ保持し、候補責任者とcanonical再利用を別フローへ分離する', async () => {
        const { service, repository, graphRepository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'body', owner_person_id: 'per_2',
            relations: [{ relation: 'references', to_id: 'decision_old' }]
        });
        expect(draft).toMatchObject({
            owner_person_id: 'per_2',
            relations: [{ relation: 'references', to_id: 'decision_old' }]
        });
        expect(repository.createDraft).toHaveBeenCalledWith(expect.objectContaining({
            canonical_owner_person_id: 'per_2',
            relations: [{ relation: 'references', to_id: 'decision_old' }]
        }), { access });
        expect(graphRepository.validateAuthoringContext).toHaveBeenCalledWith(expect.objectContaining({
            owner_person_id: 'per_2', relations: [{ relation: 'references', to_id: 'decision_old' }]
        }), { access });

        await expect(service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'body', owner_candidate: 'per_2'
        })).rejects.toMatchObject({ code: 'knowledge_owner_confirmation_required', status: 400 });
        await expect(service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'body', canonical_id: 'decision_existing'
        })).rejects.toMatchObject({ code: 'knowledge_canonical_reuse_explicit_required', status: 400 });
        expect(repository.createDraft).toHaveBeenCalledOnce();

        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-existing', decision_domain: 'engineering', reuse_canonical_id: 'decision_existing'
        })).rejects.toMatchObject({ code: 'knowledge_canonical_reuse_explicit_required', status: 400 });
    });

    it('draftを作成・再開・revision一致で編集し、競合を409にする', async () => {
        const { service } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', summary: 'Short summary', content: 'first'
        });
        expect(await service.getDraft(access, { project_code: 'alpha', draft_id: draft.draft_id })).toMatchObject({
            revision: 1, summary: 'Short summary'
        });
        await expect(service.updateDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, summary: 'Updated summary', content: 'second'
        })).resolves.toMatchObject({ revision: 2, summary: 'Updated summary', content: 'second' });
        await expect(service.updateDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, content: 'stale'
        })).rejects.toMatchObject({ code: 'knowledge_draft_revision_conflict', status: 409 });
    });

    it('canonical saveは本文・版readback一致とretrievable indexを成功条件にする', async () => {
        const { service, knowledgeEventService, repository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        const result = await service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering'
        });
        expect(result).toMatchObject({
            status: 'saved', expected_version: '1',
            persistence: { event_saved: true, graph_saved: true, readback_verified: true, index_state: 'retrievable' }
        });
        expect(result.canonical_content_hash).toMatch(/^sha256:/);
        expect(knowledgeEventService.ingest).toHaveBeenCalledOnce();
        expect(repository.claimSave).toHaveBeenCalledOnce();
        expect(repository.completeSave).toHaveBeenCalledOnce();
    });

    it('canonical saveは選択した責任者をauthorityへ渡し、Graphへ実関係を保存する', async () => {
        const { service, knowledgeEventService, graphRepository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.', owner_person_id: 'per_2',
            relations: [{ relation: 'references', to_id: 'decision_old' }]
        });
        const result = await service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-owner-relations', decision_domain: 'engineering'
        });

        expect(result.persistence.relations).toEqual([
            expect.objectContaining({ relation: 'owned_by', to_id: 'per_2' }),
            expect.objectContaining({ relation: 'belongs_to', to_id: 'alpha' }),
            expect.objectContaining({ relation: 'references', to_id: 'decision_old' })
        ]);
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-owner-relations', decision_domain: 'engineering'
        })).resolves.toEqual(result);
        expect(graphRepository.persistAuthoringRelations).toHaveBeenCalledOnce();

        expect(knowledgeEventService.ingest).toHaveBeenCalledWith(expect.objectContaining({
            decision_authority: expect.objectContaining({ decider_id: 'per_2' })
        }), { access });
        expect(graphRepository.persistAuthoringRelations).toHaveBeenCalledWith(expect.objectContaining({
            owner_person_id: 'per_2',
            relations: [{ relation: 'references', to_id: 'decision_old' }],
            expected_version: '1'
        }), { access });
    });

    it('canonical reuseは既存IDとexpected_versionを要求し、新規ingestを呼ばない', async () => {
        const { service, knowledgeEventService, graphRepository, repository, catalogService } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Reuse', content: 'Draft context'
        });
        await expect(service.reuseCanonical(access, {
            project_code: 'alpha', draft_id: draft.draft_id, decision_domain: 'engineering',
            canonical_id: 'decision_existing'
        })).rejects.toMatchObject({ code: 'knowledge_authoring_input_invalid', status: 400 });

        const result = await service.reuseCanonical(access, {
            project_code: 'alpha', draft_id: draft.draft_id, decision_domain: 'engineering',
            canonical_id: 'decision_existing', expected_version: '7'
        });
        expect(result).toMatchObject({
            status: 'reused', canonical: { id: 'decision_existing', version: '7' },
            canonical_content_hash: expect.stringMatching(/^sha256:/),
            persistence: {
                graph_saved: true,
                relations_saved: true,
                relations: [
                    { relation: 'owned_by', to_id: 'per_1' },
                    { relation: 'belongs_to', to_id: 'alpha' }
                ]
            }
        });
        expect(result.canonical.canonical_content_hash).toBe(result.canonical_content_hash);
        expect(result.canonical.source).toEqual({ kind: 'graph', id: 'decision_existing' });
        expect(catalogService.get).toHaveBeenCalledWith(access, {
            project_code: 'alpha', id: 'decision_existing'
        });
        await expect(service.reuseCanonical(access, {
            project_code: 'alpha', draft_id: draft.draft_id, decision_domain: 'engineering',
            canonical_id: 'decision_existing', expected_version: '7'
        })).resolves.toEqual(result);
        expect(knowledgeEventService.ingest).not.toHaveBeenCalled();
        expect(graphRepository.reuseCanonical).toHaveBeenCalledWith(expect.objectContaining({
            entity_id: 'decision_existing', expected_version: '7'
        }), { access });
        expect(repository.completeReuse).toHaveBeenCalledOnce();
        expect(graphRepository.reuseCanonical).toHaveBeenCalledOnce();
    });

    it('canonical reuseはCatalog本文hash不一致を成功にしない', async () => {
        const { service, catalogService, repository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Reuse', content: 'Draft context'
        });
        catalogService.get.mockResolvedValue({
            id: 'decision_existing', type: 'decision', version: '7',
            canonical_content: 'Existing truth.', canonical_content_hash: 'sha256:wrong'
        });

        await expect(service.reuseCanonical(access, {
            project_code: 'alpha', draft_id: draft.draft_id, decision_domain: 'engineering',
            canonical_id: 'decision_existing', expected_version: '7'
        })).rejects.toMatchObject({ code: 'knowledge_reuse_readback_mismatch', status: 409 });
        expect(repository.completeReuse).not.toHaveBeenCalled();
    });

    it('save claim後は編集を排他し、同じkeyの失敗再試行だけを許す', async () => {
        const { service, drafts, knowledgeEventService } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        knowledgeEventService.ingest.mockRejectedValueOnce(new Error('temporary'));
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering'
        })).rejects.toThrow('temporary');
        expect(drafts.get(draft.draft_id)).toMatchObject({ status: 'saving', save_idempotency_key: 'save-1' });
        await expect(service.updateDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, content: 'racing edit'
        })).rejects.toMatchObject({ code: 'knowledge_draft_not_editable', status: 409 });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-2', decision_domain: 'engineering'
        })).rejects.toMatchObject({ code: 'knowledge_save_in_progress', status: 409 });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering'
        })).resolves.toMatchObject({ status: 'saved' });
    });

    it('decision domain未指定はclaim前に拒否し、draftを編集可能なまま残す', async () => {
        const { service, repository, drafts } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, idempotency_key: 'save-1'
        })).rejects.toMatchObject({ code: 'knowledge_authoring_input_invalid', status: 400 });
        expect(repository.claimSave).not.toHaveBeenCalled();
        expect(drafts.get(draft.draft_id)).toMatchObject({ status: 'draft' });
        await expect(service.updateDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, content: 'still editable'
        })).resolves.toMatchObject({ content: 'still editable' });
    });

    it('失敗再試行でdecision domainを変更できない', async () => {
        const { service, knowledgeEventService } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        knowledgeEventService.ingest.mockRejectedValueOnce(new Error('temporary'));
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering'
        })).rejects.toThrow('temporary');
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'finance'
        })).rejects.toMatchObject({ code: 'knowledge_save_idempotency_conflict', status: 409 });
    });

    it('IDだけ合うreadbackを成功にしない', async () => {
        const { service, catalogService, repository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        catalogService.get.mockResolvedValue({ id: 'decision_123', version: '2', canonical_content: 'different' });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering'
        })).rejects.toMatchObject({ code: 'knowledge_save_readback_mismatch', status: 409 });
        expect(repository.completeSave).not.toHaveBeenCalled();
    });

    it('lifecycleはexpected versionと理由をGraphへ渡し履歴を返す', async () => {
        const { service, graphRepository } = harness();
        await service.changeLifecycle(access, {
            project_code: 'alpha', id: 'decision_123', expected_version: '1', state: 'retired', reason: 'obsolete'
        });
        expect(graphRepository.changeLifecycle).toHaveBeenCalledWith(expect.objectContaining({
            expected_version: '1', state: 'retired', reason: 'obsolete', actor_person_id: 'per_1'
        }), { access });
        await expect(service.history(access, { project_code: 'alpha', id: 'decision_123' }))
            .resolves.toMatchObject({ entries: [{ state: 'retired' }] });
    });

    it('本文改訂はexpected version・冪等key・理由を要求し、厳密readbackする', async () => {
        const { service, graphRepository, catalogService } = harness();
        catalogService.get.mockResolvedValue({
            id: 'decision_123', version: 'rev_2', canonical_content: 'Revised truth.',
            canonical_content_hash: 'sha256:977c856d0632366e5169fbafacd25de4060155e2ff267928002c09243e74b29b'
        });
        const result = await service.revise(access, {
            project_code: 'alpha', id: 'decision_123', expected_version: '1',
            idempotency_key: 'rev-key-1', reason: 'clarify', content: 'Revised truth.'
        });
        expect(result).toMatchObject({ status: 'revised', record: { version: 'rev_2' } });
        expect(graphRepository.reviseDecision).toHaveBeenCalledWith(expect.objectContaining({
            expected_version: '1', idempotency_key: 'rev-key-1', reason: 'clarify'
        }), { access });
    });

    it('本文と同じ改訂で範囲・責任者・有効期間を渡し、全項目をreadbackする', async () => {
        const { service, graphRepository, catalogService } = harness();
        catalogService.get.mockResolvedValue({
            id: 'decision_123', version: 'rev_2', canonical_content: 'Revised truth.',
            canonical_content_hash: 'sha256:977c856d0632366e5169fbafacd25de4060155e2ff267928002c09243e74b29b',
            scope: 'organization', owner: 'per_2',
            lifecycle: {
                status: 'active', applicable: true,
                effective_at: '2026-10-01T00:00:00.000Z', expires_at: '2027-10-01T00:00:00.000Z'
            }
        });
        await service.revise(access, {
            project_code: 'alpha', id: 'decision_123', expected_version: '1',
            idempotency_key: 'rev-key-2', reason: 'widen scope', content: 'Revised truth.',
            scope: 'organization', owner_person_id: 'per_2',
            effective_at: '2026-10-01T09:00:00+09:00', expires_at: '2027-10-01T09:00:00+09:00'
        });
        expect(graphRepository.reviseDecision).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'organization', owner_person_id: 'per_2', organization_id: 'org_1',
            effective_at: '2026-10-01T00:00:00.000Z', expires_at: '2027-10-01T00:00:00.000Z'
        }), { access });
    });

    it('改訂の不正scopeと逆転した有効期間を拒否する', async () => {
        const { service, graphRepository } = harness();
        const base = {
            project_code: 'alpha', id: 'decision_123', expected_version: '1',
            idempotency_key: 'rev-key-invalid', reason: 'invalid metadata', content: 'Revised truth.'
        };
        await expect(service.revise(access, { ...base, scope: 'personal' }))
            .rejects.toMatchObject({ code: 'knowledge_revision_scope_invalid', status: 400 });
        await expect(service.revise(access, {
            ...base, effective_at: '2027-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z'
        })).rejects.toMatchObject({ code: 'knowledge_revision_effective_period_invalid', status: 400 });
        expect(graphRepository.reviseDecision).not.toHaveBeenCalled();
    });

    it('正式な置換は両判断の版と発効日時を固定し、関係と失効をreadbackする', async () => {
        const { service, graphRepository, catalogService } = harness();
        catalogService.get.mockImplementation(async (_access, input) => input.id === 'decision_new' ? {
            id: 'decision_new', version: 'rev_new', lifecycle: { effective_at: '2026-10-01T00:00:00.000Z' },
            relations: [{ relation: 'supersedes', from_id: 'decision_new', to_id: 'decision_old',
                effective_at: '2026-10-01T00:00:00.000Z' }]
        } : {
            id: 'decision_old', version: 'rev_old', lifecycle: { expires_at: '2026-10-01T00:00:00.000Z' }, relations: []
        });
        await expect(service.supersede(access, {
            project_code: 'alpha', id: 'decision_new', superseded_id: 'decision_old',
            replacement_expected_version: 'v2', superseded_expected_version: 'v4',
            effective_at: '2026-10-01T09:00:00+09:00', reason: 'new policy', idempotency_key: 'sup-1'
        })).resolves.toMatchObject({ status: 'superseded', replacement: { version: 'rev_new' } });
        expect(graphRepository.establishSupersession).toHaveBeenCalledWith(expect.objectContaining({
            replacement_id: 'decision_new', superseded_id: 'decision_old',
            replacement_expected_version: 'v2', superseded_expected_version: 'v4',
            effective_at: '2026-10-01T00:00:00.000Z'
        }), { access });
    });

    it('自己置換と発効日時なしはGraph更新前に拒否する', async () => {
        const { service, graphRepository } = harness();
        const base = { project_code: 'alpha', id: 'decision_1', superseded_id: 'decision_1',
            replacement_expected_version: 'v1', superseded_expected_version: 'v1',
            reason: 'invalid', idempotency_key: 'sup-invalid' };
        await expect(service.supersede(access, { ...base, effective_at: '2026-10-01T00:00:00Z' }))
            .rejects.toMatchObject({ code: 'knowledge_supersession_self_reference', status: 400 });
        await expect(service.supersede(access, { ...base, superseded_id: 'decision_2' }))
            .rejects.toMatchObject({ code: 'knowledge_supersession_effective_at_required', status: 400 });
        expect(graphRepository.establishSupersession).not.toHaveBeenCalled();
    });

    it('判断domainはGraph RACIから列挙し、scopeから推測しない', async () => {
        const { service, graphRepository } = harness();
        await expect(service.authorityDomains(access, { project_code: 'alpha' }))
            .resolves.toEqual({ project_code: 'alpha', domains: ['engineering'] });
        expect(graphRepository.listDecisionAuthorityDomains).toHaveBeenCalledWith(
            { project_code: 'alpha' }, { access }
        );
    });

    it('client指定canonical IDを拒否し、authority未検証時はsave receiptを確定しない', async () => {
        const { service, knowledgeEventService, repository } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'Use canonical truth.'
        });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-1', decision_domain: 'engineering', canonical_id: 'existing'
        })).rejects.toMatchObject({ code: 'knowledge_canonical_id_not_accepted', status: 400 });
        knowledgeEventService.ingest.mockResolvedValue({
            semantic_state: 'quarantined', processing_stage: 'resolved', quarantine_reason: 'decision_authority_unverified'
        });
        await expect(service.saveDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1,
            idempotency_key: 'save-2', decision_domain: 'engineering'
        })).rejects.toMatchObject({ code: 'knowledge_save_not_retrievable', status: 409 });
        expect(repository.completeSave).not.toHaveBeenCalled();
    });
});
