import { describe, expect, it, vi } from 'vitest';

// The service owns the database scope and request shape. Keep the paid provider
// out of these tests so scope and partial coverage assertions stay deterministic.
vi.mock('../../../server/services/graph-embedding-provider.js', () => ({
    createGraphEmbeddingProvider: vi.fn(),
}));

import { GraphVectorSearchService } from '../../../server/services/graph-vector-search-service.js';

const access = {
    role: 'member',
    projectCodes: ['brainbase'],
    clearance: ['internal'],
    organizationId: 'org_unson',
};

function vector(seed = 1) {
    return Array.from({ length: 768 }, (_value, index) => seed + (index % 3));
}

function scopedService({ queryResults = [], provider } = {}) {
    const client = { query: vi.fn() };
    for (const result of queryResults) client.query.mockResolvedValueOnce(result);
    const info = {
        withAccessContext: vi.fn(async (_access, handler) => handler(client)),
    };
    return {
        client,
        info,
        service: new GraphVectorSearchService(info, {
            provider: provider || {
                modelId: 'gemini-embedding-001:768:v2',
                embed: vi.fn(async () => [vector()]),
            },
        }),
    };
}

describe('GraphVectorSearchService', () => {
    it('embeds only the query and ranks rows from the ACL-scoped index', async () => {
        const provider = {
            modelId: 'gemini-embedding-001:768:v2',
            embed: vi.fn(async (texts, kind) => {
                expect(texts).toEqual(['意図を成果につなげる原則']);
                expect(kind).toBe('query');
                return [vector()];
            }),
        };
        const { service, client, info } = scopedService({
            provider,
            queryResults: [
                {},
                { rows: [{ total: 2, ready: 2, truncated: 0 }] },
                { rows: [{ id: 'decision_visible', entity_type: 'decision', score: 0.91, embedding_text: 'private derived text' }] },
            ],
        });

        const result = await service.search(access, {
            query: '意図を成果につなげる原則',
            project: 'brainbase',
            types: ['decision'],
            top_k: 3,
        });

        expect(provider.embed).toHaveBeenCalledTimes(1);
        expect(result.coverage).toBe('complete');
        expect(result.records).toEqual([{ id: 'decision_visible', entity_type: 'decision', score: 0.91 }]);
        expect(result.records[0]).not.toHaveProperty('embedding_text');
        expect(info.withAccessContext).toHaveBeenCalledWith(access, expect.any(Function));
        const ranking = client.query.mock.calls[2];
        expect(ranking[0]).toContain('JOIN graph_entity_embeddings');
        expect(ranking[0]).toContain('content_hash = md5(g.embedding_text)');
        expect(ranking[0]).toContain('ORDER BY v.embedding <=> $6::vector');
        expect(ranking[1]).toEqual([
            ['decision'],
            'brainbase',
            null,
            ['retired', 'merged', 'inactive', 'superseded'],
            provider.modelId,
            JSON.stringify(vector()),
            3,
        ]);
        expect(client.query.mock.calls[0][0]).toContain('statement_timeout');
    });

    it('rejects a project outside the actor scope before calling the paid API', async () => {
        const provider = {
            modelId: 'gemini-embedding-001:768:v2',
            embed: vi.fn(),
        };
        const { service, info } = scopedService({ provider });

        await expect(service.search(access, { query: 'secret', project: 'other' }))
            .rejects.toMatchObject({ code: 'graph_search_project_denied', status: 403 });

        expect(provider.embed).not.toHaveBeenCalled();
        expect(info.withAccessContext).not.toHaveBeenCalled();
    });

    it('reports pending and truncated coverage instead of claiming complete recall', async () => {
        const { service } = scopedService({
            queryResults: [
                {},
                { rows: [{ total: 5, ready: 2, truncated: 1 }] },
                { rows: [{ id: 'ready', score: 0.8 }] },
            ],
        });

        await expect(service.search(access, { query: 'partial', types: ['decision'] }))
            .resolves.toMatchObject({
                coverage: 'partial',
                partial_reasons: ['embedding_index_pending', 'embedding_text_truncated'],
                index: { ready: 2, pending: 3 },
            });
    });

    it('surfaces provider absence without falling back to a full Graph/API scan', async () => {
        const provider = {
            modelId: 'gemini-embedding-001:768:v2',
            embed: vi.fn(async () => {
                throw Object.assign(new Error('embedding provider unavailable'), {
                    code: 'embedding_provider_api_key_missing',
                    status: 503,
                });
            }),
        };
        const { service, info, client } = scopedService({ provider });

        await expect(service.search(access, { query: 'no api key' }))
            .rejects.toMatchObject({ code: 'embedding_provider_api_key_missing', status: 503 });

        expect(info.withAccessContext).not.toHaveBeenCalled();
        expect(client.query).not.toHaveBeenCalled();
    });

    it('publishes no vector when source text changes during passage generation', async () => {
        const provider = {
            modelId: 'gemini-embedding-001:768:v2',
            embed: vi.fn(async (texts, kind) => {
                expect(texts).toEqual(['source text']);
                expect(kind).toBe('passage');
                return [vector()];
            }),
        };
        const { service, client, info } = scopedService({
            provider,
            queryResults: [
                { rows: [{ id: 'entity_1', embedding_text: 'source text', content_hash: 'hash_before' }] },
                { rowCount: 0, rows: [] },
            ],
        });

        await expect(service.indexBatch(access, { types: ['decision'], limit: 1 }))
            .resolves.toMatchObject({ selected: 1, indexed: 0, changed_during_generation: 1 });

        expect(info.withAccessContext).toHaveBeenCalledTimes(2);
        expect(provider.embed).toHaveBeenCalledWith(['source text'], 'passage');
        const write = client.query.mock.calls[1];
        expect(write[0]).toContain('md5(embedding_text) = $7');
        expect(write[0]).toContain('ON CONFLICT(entity_id, model_id) DO UPDATE');
        expect(write[1][4]).toBe('entity_1');
        expect(write[1][6]).toBe('hash_before');
    });

    it('does not retry with a broad lookup when the scoped index query fails', async () => {
        const provider = {
            modelId: 'gemini-embedding-001:768:v2',
            embed: vi.fn(async () => [vector()]),
        };
        const { service, client, info } = scopedService({ provider });
        client.query.mockReset();
        client.query
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(Object.assign(new Error('statement timeout'), { code: '57014' }));

        await expect(service.search(access, { query: 'timeout' }))
            .rejects.toMatchObject({ code: '57014' });

        expect(info.withAccessContext).toHaveBeenCalledTimes(1);
        expect(client.query).toHaveBeenCalledTimes(2);
        expect(provider.embed).toHaveBeenCalledTimes(1);
    });
});
