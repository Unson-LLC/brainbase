import { describe, expect, it, vi } from 'vitest';

import { KnowledgeAuthoringService } from '../../server/services/knowledge-authoring-service.js';

function harness() {
    const drafts = new Map();
    const saves = new Map();
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
        claimSave: vi.fn(async (id, claim) => {
            const row = drafts.get(id);
            if (!row || row.revision !== claim.expected_revision
                || !['draft', 'saving'].includes(row.status)
                || (row.status === 'saving' && row.save_idempotency_key !== claim.idempotency_key)) return null;
            const claimed = { ...row, status: 'saving', save_idempotency_key: claim.idempotency_key };
            drafts.set(id, claimed);
            return claimed;
        }),
        completeSave: vi.fn(async (save) => {
            const row = drafts.get(save.draft_id);
            drafts.set(save.draft_id, { ...row, status: 'saved', canonical_id: save.canonical_id, saved_event_id: save.event_id });
            saves.set(save.idempotency_key, { ...save });
        })
    };
    const knowledgeEventService = { ingest: vi.fn(async (event) => ({
        event_id: event.event_id, graph_entity_id: event.subject.id, semantic_state: 'active', processing_stage: 'retrievable'
    })) };
    const catalogService = { get: vi.fn(async (_access, input) => ({
        id: input.id, type: 'decision', version: '1', canonical_content: 'Use canonical truth.',
        lifecycle: { status: 'active', applicable: true }
    })) };
    const graphRepository = {
        changeLifecycle: vi.fn(async () => ({ id: 'decision_123' })),
        listLifecycleHistory: vi.fn(async () => [{ from_version: '1', to_version: '2', state: 'retired' }])
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

    it('draftを作成・再開・revision一致で編集し、競合を409にする', async () => {
        const { service } = harness();
        const draft = await service.createDraft(access, {
            project_code: 'alpha', title: 'Decision', content: 'first'
        });
        expect(await service.getDraft(access, { project_code: 'alpha', draft_id: draft.draft_id })).toMatchObject({ revision: 1 });
        await expect(service.updateDraft(access, {
            project_code: 'alpha', draft_id: draft.draft_id, revision: 1, content: 'second'
        })).resolves.toMatchObject({ revision: 2, content: 'second' });
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
