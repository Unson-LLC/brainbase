import { describe, expect, it, vi } from 'vitest';

import { CanonicalDocumentWriterError } from '../../server/services/canonical-document-writer-adapter.js';
import { KnowledgeAuthoringService } from '../../server/services/knowledge-authoring-service.js';
import { KnowledgeDocumentGraphPointerResolver } from '../../server/services/knowledge-document-graph-pointer-resolver.js';

const access = {
    projectCodes: ['alpha'],
    personId: 'per_1',
    organizationId: 'org_1'
};

function graphPointer(overrides = {}) {
    return {
        status: 'resolved',
        source_class: 'owning_repo',
        content_type: 'team_document',
        project_code: 'alpha',
        canonical_location: {
            repository: 'project:alpha',
            owner: 'unson',
            repo: 'alpha-docs',
            tenant_id: 'org_1',
            branch: 'main',
            path: 'docs/'
        },
        ...overrides
    };
}

function harness({ writer, resolver, graphRepository: graphRepositoryOverride } = {}) {
    const drafts = new Map();
    const receipts = new Map();
    const repository = {
        createDraft: vi.fn(async (draft) => {
            const row = {
                ...draft,
                created_at: '2026-09-17T00:00:00.000Z',
                updated_at: '2026-09-17T00:00:00.000Z'
            };
            drafts.set(row.draft_id, row);
            return row;
        }),
        getDraft: vi.fn(async (draftId) => drafts.get(draftId) || null),
        claimSave: vi.fn(async (draftId, claim) => {
            const row = drafts.get(draftId);
            if (!row || row.revision !== claim.expected_revision
                || !['draft', 'saving'].includes(row.status)
                || (row.status === 'saving' && row.save_idempotency_key !== claim.idempotency_key)) return null;
            const claimed = {
                ...row,
                status: 'saving',
                save_idempotency_key: claim.idempotency_key,
                save_decision_domain: claim.decision_domain
            };
            drafts.set(draftId, claimed);
            return claimed;
        })
    };
    const documentReceiptRepository = {
        findAuthoringSave: vi.fn(async ({ idempotencyKey }) => receipts.get(idempotencyKey) || null),
        completeAuthoringSave: vi.fn(async (save) => {
            const row = drafts.get(save.draft_id);
            drafts.set(save.draft_id, { ...row, status: 'saved' });
            receipts.set(save.idempotency_key, {
                draft_id: save.draft_id,
                draft_revision: save.draft_revision,
                result: save.result
            });
            return drafts.get(save.draft_id);
        })
    };
    const graphRepository = graphRepositoryOverride || {
        validateAuthoringContext: vi.fn(async (input) => ({
            owner_person_id: input.owner_person_id,
            relations: input.relations || [],
            authority_verified: true
        }))
    };
    const service = new KnowledgeAuthoringService({
        repository,
        graphRepository,
        knowledgeEventService: null,
        catalogService: null,
        documentWriter: writer,
        documentReceiptRepository,
        documentGraphPointerResolver: resolver,
        id: () => 'doc'
    });
    return { service, repository, documentReceiptRepository, graphRepository, drafts, receipts };
}

function graphRegistration(overrides = {}) {
    return {
        organization_id: 'org_1',
        tenant_id: 'org_1',
        project_code: 'alpha',
        source_class: 'owning_repo',
        content_type: 'team_document',
        repository_owner: 'unson',
        repository_name: 'alpha-docs',
        branch: 'main',
        path_scope: 'docs',
        graph_project_id: 'graph-project-1',
        graph_entity_id: 'graph-project-subject-1',
        graph_entity_type: 'project',
        graph_entity_lifecycle_status: 'active',
        registration_status: 'active',
        registry_repository: { mode: 'link_existing', owner: 'unson', repo: 'alpha-docs' },
        ...overrides
    };
}

function saveInput(draftId, overrides = {}) {
    return {
        project_code: 'alpha',
        draft_id: draftId,
        revision: 1,
        idempotency_key: 'doc-save-1',
        decision_domain: 'engineering',
        intent: 'save reviewed guide',
        audience: 'team',
        content_type: 'team_document',
        path: 'docs/guide.md',
        base_revision: 'commit-v1',
        ...overrides
    };
}

function writerResult(overrides = {}) {
    return {
        path: 'docs/guide.md',
        canonical_url: 'https://github.example/unson/alpha-docs/blob/commit-v2/docs/guide.md',
        revision: 'commit-v2',
        content_hash: 'sha256:document',
        ...overrides
    };
}

async function createDocument(service) {
    return service.createDraft(access, {
        project_code: 'alpha',
        kind: 'document',
        title: 'Guide',
        content: '# Guide\n'
    });
}

describe('KnowledgeAuthoringService document save', () => {
    it('fails closed before claim/write when an explicit Graph pointer resolver is absent', async () => {
        const writer = { save: vi.fn() };
        const { service, repository } = harness({ writer });
        const draft = await createDocument(service);

        await expect(service.saveDraft(access, saveInput(draft.draft_id)))
            .rejects.toMatchObject({ code: 'knowledge_document_graph_pointer_required', status: 503 });
        expect(repository.claimSave).not.toHaveBeenCalled();
        expect(writer.save).not.toHaveBeenCalled();
    });

    it('passes the resolved Graph pointer to the writer and supports create without base_hash', async () => {
        const writer = { save: vi.fn(async () => writerResult()) };
        const resolver = vi.fn(async () => graphPointer());
        const { service, repository, documentReceiptRepository } = harness({ writer, resolver });
        const draft = await createDocument(service);

        const result = await service.saveDraft(access, saveInput(draft.draft_id));

        expect(result).toMatchObject({
            status: 'saved',
            expected_revision: 'commit-v1',
            document: { revision: 'commit-v2' },
            persistence: { document_saved: true, readback_verified: true }
        });
        expect(writer.save).toHaveBeenCalledWith(expect.objectContaining({
            path: 'docs/guide.md',
            base_hash: null,
            base_revision: 'commit-v1',
            resolution: expect.objectContaining({ source_class: 'owning_repo' })
        }));
        expect(repository.claimSave).toHaveBeenCalledOnce();
        expect(documentReceiptRepository.completeAuthoringSave).toHaveBeenCalledOnce();
    });

    it('uses the persisted Graph registration in the authoring-to-writer flow', async () => {
        const writer = { save: vi.fn(async () => writerResult()) };
        const graphRepository = {
            validateAuthoringContext: vi.fn(async (input) => ({
                owner_person_id: input.owner_person_id,
                relations: input.relations || [],
                authority_verified: true
            })),
            readDocumentSourceRegistration: vi.fn(async () => graphRegistration())
        };
        const resolver = new KnowledgeDocumentGraphPointerResolver({ graphRepository });
        const { service } = harness({ writer, resolver, graphRepository });
        const draft = await createDocument(service);

        await expect(service.saveDraft(access, saveInput(draft.draft_id)))
            .resolves.toMatchObject({ status: 'saved', persistence: { readback_verified: true } });
        expect(writer.save).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({
                canonical_location: expect.objectContaining({
                    owner: 'unson', repo: 'alpha-docs', branch: 'main', path: 'docs/'
                })
            })
        }));
        expect(graphRepository.readDocumentSourceRegistration).toHaveBeenCalledWith(
            { project_code: 'alpha' },
            { access }
        );
    });

    it('keeps the same claim/idempotency key across a writer response-loss retry and replays the durable receipt', async () => {
        const writer = { save: vi.fn()
            .mockRejectedValueOnce(new CanonicalDocumentWriterError('canonical_document_write_unavailable', 'response lost', 503))
            .mockResolvedValue(writerResult({ idempotency_replayed: true })) };
        const resolver = vi.fn(async () => graphPointer());
        const { service, repository, documentReceiptRepository } = harness({ writer, resolver });
        const draft = await createDocument(service);
        const input = saveInput(draft.draft_id);

        await expect(service.saveDraft(access, input))
            .rejects.toMatchObject({ code: 'canonical_document_write_unavailable', status: 503 });
        expect(repository.claimSave).toHaveBeenCalledOnce();
        const retry = await service.saveDraft(access, input);
        expect(retry).toMatchObject({ status: 'saved', document: { revision: 'commit-v2' } });
        expect(writer.save).toHaveBeenCalledTimes(2);
        expect(repository.claimSave).toHaveBeenCalledTimes(2);
        expect(documentReceiptRepository.completeAuthoringSave).toHaveBeenCalledOnce();
        const replay = await service.saveDraft(access, input);
        expect(replay).toMatchObject({ status: 'saved', idempotent: true });
        expect(writer.save).toHaveBeenCalledTimes(2);
    });

    it('does not claim on a Graph pointer registration failure, then retries with the same draft', async () => {
        const writer = { save: vi.fn(async () => writerResult()) };
        const graphFailure = Object.assign(new Error('Graph pointer unavailable'), {
            code: 'knowledge_document_graph_pointer_unavailable',
            status: 503
        });
        const resolver = vi.fn()
            .mockRejectedValueOnce(graphFailure)
            .mockResolvedValue(graphPointer());
        const { service, repository } = harness({ writer, resolver });
        const draft = await createDocument(service);
        const input = saveInput(draft.draft_id, { idempotency_key: 'graph-retry' });

        await expect(service.saveDraft(access, input))
            .rejects.toMatchObject({ code: 'knowledge_document_graph_pointer_unavailable', status: 503 });
        expect(repository.claimSave).not.toHaveBeenCalled();
        await expect(service.saveDraft(access, input)).resolves.toMatchObject({ status: 'saved' });
        expect(repository.claimSave).toHaveBeenCalledOnce();
        expect(writer.save).toHaveBeenCalledOnce();
    });
});
