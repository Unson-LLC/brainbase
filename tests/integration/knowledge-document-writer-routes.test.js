import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createKnowledgeCatalogRouter } from '../../server/routes/knowledge-resolution.js';
import { CanonicalDocumentWriterAdapter } from '../../server/services/canonical-document-writer-adapter.js';
import { KnowledgeCatalogService } from '../../server/services/knowledge-catalog-service.js';

function infoSSOTService() {
    return {
        listGraphEntities: vi.fn(async () => []),
        listGraphEdges: vi.fn(async () => [])
    };
}

function body(overrides = {}) {
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

function createApp({ documentWriter = null } = {}) {
    const service = new KnowledgeCatalogService({
        infoSSOTService: infoSSOTService(),
        documentWriter
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { projectCodes: ['alpha'] };
        next();
    });
    app.use('/api/knowledge', createKnowledgeCatalogRouter({ service }));
    return app;
}

function adapterProvider() {
    return {
        write: vi.fn(async ({ path }) => ({ path, revision: '2' })),
        read: vi.fn(async ({ path }) => ({ path, content: '# Guide\n', revision: '2' }))
    };
}

describe('knowledge document writer API', () => {
    it('returns 503 when the canonical writer is not explicitly configured', async () => {
        const response = await request(createApp()).post('/api/knowledge/documents').send(body()).expect(503);
        expect(response.body).toEqual({
            error: {
                code: 'knowledge_document_writer_not_configured',
                message: 'canonical document writer is not configured'
            }
        });
    });

    it('writes only after owning_repo resolution and returns readback metadata', async () => {
        const provider = adapterProvider();
        const response = await request(createApp({
            documentWriter: new CanonicalDocumentWriterAdapter({ provider })
        })).post('/api/knowledge/documents').send(body()).expect(200);

        expect(response.body).toMatchObject({
            status: 'saved',
            source_class: 'owning_repo',
            content_type: 'team_document',
            path: 'docs/guide.md',
            revision: '2',
            readback: { path: 'docs/guide.md', revision: '2' }
        });
        expect(provider.write).toHaveBeenCalledOnce();
        expect(provider.read).toHaveBeenCalledOnce();
    });

    it('rejects a non-team-document route before provider write', async () => {
        const provider = adapterProvider();
        const response = await request(createApp({
            documentWriter: new CanonicalDocumentWriterAdapter({ provider })
        })).post('/api/knowledge/documents').send(body({
            content_type: 'source_document'
        })).expect(422);

        expect(response.body.error.code).toBe('knowledge_document_route_invalid');
        expect(provider.write).not.toHaveBeenCalled();
    });

    it('rejects path traversal before provider write', async () => {
        const provider = adapterProvider();
        const response = await request(createApp({
            documentWriter: new CanonicalDocumentWriterAdapter({ provider })
        })).post('/api/knowledge/documents').send(body({ path: '../secret.md' })).expect(400);

        expect(response.body.error.code).toBe('canonical_document_path_invalid');
        expect(provider.write).not.toHaveBeenCalled();
    });
});
