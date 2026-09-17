import { describe, expect, it, vi } from 'vitest';

import { CanonicalDocumentWriterAdapter } from '../../server/services/canonical-document-writer-adapter.js';
import { KnowledgeCatalogService } from '../../server/services/knowledge-catalog-service.js';

function request(overrides = {}) {
    return {
        project_code: 'alpha',
        intent: 'save reviewed guide',
        audience: 'team',
        content_type: 'team_document',
        path: 'docs/guide.md',
        content: '# Guide\n',
        base_hash: 'hash-v1',
        base_revision: '1',
        idempotency_key: 'save-1',
        ...overrides
    };
}

function infoSSOTService() {
    return {
        listGraphEntities: vi.fn(async () => []),
        listGraphEdges: vi.fn(async () => [])
    };
}

function provider() {
    return {
        write: vi.fn(async ({ path }) => ({ path, revision: '2' })),
        read: vi.fn(async ({ path }) => ({ path, content: '# Guide\n', revision: '2' }))
    };
}

describe('KnowledgeCatalogService canonical document save', () => {
    it('resolves team_document to owning_repo before invoking the explicitly injected writer', async () => {
        const providerInstance = provider();
        const writer = new CanonicalDocumentWriterAdapter({ provider: providerInstance });
        const service = new KnowledgeCatalogService({ infoSSOTService: infoSSOTService(), documentWriter: writer });

        const result = await service.save({ projectCodes: ['alpha'] }, request());

        expect(result).toMatchObject({
            status: 'saved',
            source_class: 'owning_repo',
            content_type: 'team_document',
            path: 'docs/guide.md'
        });
        expect(providerInstance.write).toHaveBeenCalledWith(expect.objectContaining({
            resolution: expect.objectContaining({ source_class: 'owning_repo', content_type: 'team_document' })
        }));
    });

    it('keeps save unavailable at 503 when no writer is injected', async () => {
        const service = new KnowledgeCatalogService({ infoSSOTService: infoSSOTService() });

        await expect(service.save({ projectCodes: ['alpha'] }, request())).rejects.toMatchObject({
            code: 'knowledge_document_writer_not_configured',
            status: 503
        });
    });

    it('does not invoke a writer for a non-team-document route', async () => {
        const providerInstance = provider();
        const writer = new CanonicalDocumentWriterAdapter({ provider: providerInstance });
        const service = new KnowledgeCatalogService({ infoSSOTService: infoSSOTService(), documentWriter: writer });

        await expect(service.save({ projectCodes: ['alpha'] }, request({
            content_type: 'source_document',
            audience: 'team'
        }))).rejects.toMatchObject({
            code: 'knowledge_document_route_invalid',
            status: 422
        });
        expect(providerInstance.write).not.toHaveBeenCalled();
    });

    it('rejects project scope before resolver or writer invocation', async () => {
        const providerInstance = provider();
        const service = new KnowledgeCatalogService({
            infoSSOTService: infoSSOTService(),
            documentWriter: new CanonicalDocumentWriterAdapter({ provider: providerInstance })
        });

        await expect(service.save({ projectCodes: ['other'] }, request())).rejects.toMatchObject({
            code: 'knowledge_project_not_accessible',
            status: 403
        });
        expect(providerInstance.write).not.toHaveBeenCalled();
    });
});
