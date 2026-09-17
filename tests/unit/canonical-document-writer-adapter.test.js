import { describe, expect, it, vi } from 'vitest';

import {
    CanonicalDocumentWriterAdapter,
    CanonicalDocumentWriterError,
    normalizeRepositoryRelativePath
} from '../../server/services/canonical-document-writer-adapter.js';

function resolution(overrides = {}) {
    return {
        resolution_id: 'kr_doc_1',
        status: 'resolved',
        project_code: 'alpha',
        content_type: 'team_document',
        source_class: 'owning_repo',
        canonical_location: { repository: 'project:alpha', path: 'docs/' },
        ...overrides
    };
}

function input(overrides = {}) {
    return {
        project_code: 'alpha',
        path: 'docs/guide.md',
        content: '# Guide\n',
        base_hash: 'hash-v1',
        base_revision: '1',
        idempotency_key: 'save-1',
        resolution: resolution(),
        access: { projectCodes: ['alpha'] },
        ...overrides
    };
}

function providerFor(content = '# Guide\n') {
    return {
        write: vi.fn(async ({ path }) => ({ path, canonical_url: `https://repo.test/${path}`, revision: '2' })),
        read: vi.fn(async ({ path, canonical_url }) => ({
            path,
            canonical_url,
            content,
            revision: '2'
        }))
    };
}

describe('CanonicalDocumentWriterAdapter', () => {
    it('forwards owning-repo CAS and idempotency fields, then verifies readback', async () => {
        const provider = providerFor();
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        const result = await adapter.save(input());

        expect(result).toMatchObject({
            status: 'saved',
            source_class: 'owning_repo',
            content_type: 'team_document',
            path: 'docs/guide.md',
            revision: '2',
            idempotency_key: 'save-1',
            idempotency_replayed: false
        });
        expect(result.content_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(provider.write).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'alpha',
            path: 'docs/guide.md',
            base_hash: 'hash-v1',
            base_revision: '1',
            idempotency_key: 'save-1',
            request_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
        }));
        expect(provider.read).toHaveBeenCalledWith(expect.objectContaining({
            project_code: 'alpha',
            path: 'docs/guide.md',
            resolution: expect.objectContaining({
                source_class: 'owning_repo',
                content_type: 'team_document'
            })
        }));
    });

    it('does not call provider when resolution is not owning_repo team_document', async () => {
        const provider = providerFor();
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await expect(adapter.save(input({
            resolution: resolution({ source_class: 'team_drive', content_type: 'source_document' })
        }))).rejects.toMatchObject({ code: 'canonical_document_route_invalid', status: 422 });
        expect(provider.write).not.toHaveBeenCalled();
        expect(provider.read).not.toHaveBeenCalled();
    });

    it('fails closed when provider is not explicitly configured', async () => {
        const adapter = new CanonicalDocumentWriterAdapter();

        await expect(adapter.save(input())).rejects.toMatchObject({
            code: 'canonical_document_writer_not_configured',
            status: 503
        });
    });

    it('rejects absolute and parent repository paths', async () => {
        expect(() => normalizeRepositoryRelativePath('/tmp/doc.md')).toThrowError(CanonicalDocumentWriterError);
        expect(() => normalizeRepositoryRelativePath('../doc.md')).toThrowError(CanonicalDocumentWriterError);
        expect(() => normalizeRepositoryRelativePath('docs/../doc.md')).toThrowError(CanonicalDocumentWriterError);
        expect(() => normalizeRepositoryRelativePath('C:/repo/doc.md')).toThrowError(CanonicalDocumentWriterError);
    });

    it('replays an identical idempotency key without writing twice and rejects a changed payload', async () => {
        const provider = providerFor();
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await adapter.save(input());
        const replay = await adapter.save(input());
        expect(replay.idempotency_replayed).toBe(true);
        expect(provider.write).toHaveBeenCalledOnce();
        expect(provider.read).toHaveBeenCalledOnce();

        await expect(adapter.save(input({ content: '# Changed\n' }))).rejects.toMatchObject({
            code: 'canonical_document_idempotency_conflict',
            status: 409
        });
    });

    it('replays a durable receipt after adapter restart without calling the provider', async () => {
        let receipt = null;
        const receiptStore = {
            find: vi.fn(async () => receipt),
            put: vi.fn(async ({ request_fingerprint, result }) => {
                receipt = { request_fingerprint, result };
            })
        };
        const firstProvider = providerFor();
        const first = new CanonicalDocumentWriterAdapter({ provider: firstProvider, receiptStore });
        await first.save(input());

        const restartedProvider = providerFor();
        const restarted = new CanonicalDocumentWriterAdapter({ provider: restartedProvider, receiptStore });
        const replay = await restarted.save(input());

        expect(replay).toMatchObject({ status: 'saved', idempotency_replayed: true, revision: '2' });
        expect(restartedProvider.write).not.toHaveBeenCalled();
        expect(restartedProvider.read).not.toHaveBeenCalled();
        expect(receiptStore.find).toHaveBeenCalledTimes(2);
    });

    it('fails when provider readback differs from the requested body', async () => {
        const provider = providerFor('# Different\n');
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await expect(adapter.save(input())).rejects.toMatchObject({
            code: 'canonical_document_readback_mismatch',
            status: 502
        });
    });

    it('rejects a provider-declared hash that hides different readback content', async () => {
        const provider = providerFor('# Different\n');
        provider.read.mockResolvedValue({
            path: 'docs/guide.md', content: '# Different\n',
            content_hash: 'c479607e244640c366bd6805166276d0c83c442e9ef4eed94005cf5e5eca8c70',
            revision: '2'
        });
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await expect(adapter.save(input())).rejects.toMatchObject({
            code: 'canonical_document_readback_mismatch', status: 502
        });
    });

    it('requires the revision from provider readback instead of trusting only the write response', async () => {
        const provider = providerFor();
        provider.read.mockResolvedValue({ path: 'docs/guide.md', content: '# Guide\n' });
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await expect(adapter.save(input())).rejects.toMatchObject({
            code: 'canonical_document_input_invalid', status: 400,
            details: { field: 'readback.revision' }
        });
    });

    it('preserves provider CAS conflicts as a retryable conflict', async () => {
        const provider = providerFor();
        provider.write.mockRejectedValue(Object.assign(new Error('stale'), {
            code: 'canonical_document_cas_conflict', status: 409
        }));
        const adapter = new CanonicalDocumentWriterAdapter({ provider });

        await expect(adapter.save(input())).rejects.toMatchObject({
            code: 'canonical_document_cas_conflict',
            status: 409
        });
        expect(provider.read).not.toHaveBeenCalled();
    });
});
