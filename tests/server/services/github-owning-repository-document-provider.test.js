import { describe, expect, it, vi } from 'vitest';

import { CanonicalDocumentWriterAdapter } from '../../../server/services/canonical-document-writer-adapter.js';
import { GitHubOwningRepositoryDocumentProvider } from '../../../server/services/github-owning-repository-document-provider.js';

const API_BASE_URL = 'https://api.github.test';
const DOCUMENT_URL = `${API_BASE_URL}/repos/Acme/alpha-docs/contents/docs/guide.md`;
const REF_URL = `${API_BASE_URL}/repos/Acme/alpha-docs/git/ref/heads/main`;
const COMMITS_URL = `${API_BASE_URL}/repos/Acme/alpha-docs/commits?path=docs%2Fguide.md&sha=main&per_page=1`;
const COMMIT_V2 = '2222222222222222222222222222222222222222';

function resolution(overrides = {}) {
    return {
        resolution_id: 'kr_doc_1',
        status: 'resolved',
        project_code: 'alpha',
        content_type: 'team_document',
        source_class: 'owning_repo',
        canonical_location: {
            repository: 'project:alpha',
            owner: 'Acme',
            repo: 'alpha-docs',
            tenant_id: 'org_1',
            branch: 'main',
            path: 'docs/'
        },
        ...overrides
    };
}

function request(overrides = {}) {
    return {
        project_code: 'alpha',
        path: 'docs/guide.md',
        content: '# Guide\n',
        base_hash: 'blob-v1',
        base_revision: 'commit-v1',
        idempotency_key: 'save-1',
        resolution: resolution(),
        access: { projectCodes: ['alpha'], organizationId: 'org_1' },
        ...overrides
    };
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

function fakeGitHubFetch({
    currentHash = 'blob-v1',
    currentRevision = 'commit-v1',
    currentContent = '# Guide\n',
    readbackContent = null,
    responseLossAfterWrite = false
} = {}) {
    const state = {
        currentHash,
        currentRevision,
        currentContent,
        readbackContent,
        responseLossAfterWrite,
        writes: 0,
        lastMessage: ''
    };
    const calls = [];
    const fetchImpl = vi.fn(async (url, options = {}) => {
        calls.push({ url, options });
        if (options.method === 'GET' && url === `${DOCUMENT_URL}?ref=main`) {
            if (state.currentHash === null && state.writes === 0) return response(404, { message: 'Not Found' });
            const content = state.writes > 0 && state.readbackContent !== null
                ? state.readbackContent
                : state.currentContent;
            return response(200, {
                type: 'file',
                path: 'docs/guide.md',
                sha: state.writes > 0 ? 'blob-v2' : state.currentHash,
                content: Buffer.from(content, 'utf8').toString('base64'),
                html_url: 'https://github.com/Acme/alpha-docs/blob/main/docs/guide.md'
            });
        }
        if (options.method === 'GET' && url === REF_URL) {
            return response(200, {
                object: { sha: state.writes > 0 ? 'commit-v2' : state.currentRevision }
            });
        }
        if (options.method === 'GET' && url === COMMITS_URL) {
            return response(200, [{
                sha: state.writes > 0 ? 'commit-v2' : 'commit-other',
                commit: { message: state.writes > 0 ? state.lastMessage : 'unrelated commit' }
            }]);
        }
        if (options.method === 'PUT' && url === DOCUMENT_URL) {
            const body = JSON.parse(options.body);
            expect(body).toMatchObject({
                branch: 'main'
            });
            expect(body.message).toContain(`${state.currentHash === null ? 'knowledge: create' : 'knowledge: update'} docs/guide.md`);
            expect(body.message).toContain('Brainbase-Document-Request:');
            if (state.currentHash === null) expect(body).not.toHaveProperty('sha');
            else expect(body.sha).toBe('blob-v1');
            state.writes += 1;
            state.currentContent = Buffer.from(body.content, 'base64').toString('utf8');
            state.currentHash = 'blob-v2';
            state.currentRevision = 'commit-v2';
            state.lastMessage = body.message;
            if (state.responseLossAfterWrite) throw new Error('response lost after GitHub accepted the write');
            return response(200, {
                content: {
                    path: 'docs/guide.md',
                    sha: 'blob-v2',
                    html_url: 'https://github.com/Acme/alpha-docs/blob/main/docs/guide.md'
                },
                commit: {
                    sha: 'commit-v2',
                    html_url: 'https://github.com/Acme/alpha-docs/commit/commit-v2'
                }
            });
        }
        throw new Error(`unexpected GitHub request: ${options.method} ${url}`);
    });
    return { fetchImpl, calls, state };
}

function createProvider(fetchImpl, mapping = {}) {
    return new GitHubOwningRepositoryDocumentProvider({
        configParser: {
            getGitHubMappings: vi.fn(async () => [{
                project_id: 'alpha',
                owner: 'Acme',
                repo: 'alpha-docs',
                branch: 'config-default-ignored',
                ...mapping
            }])
        },
        token: 'github-secret',
        fetchImpl,
        apiBaseUrl: API_BASE_URL
    });
}

describe('GitHubOwningRepositoryDocumentProvider', () => {
    it('reads a canonical document at the requested immutable commit without reading branch HEAD', async () => {
        const content = '# Fixed guide\n';
        const fetchImpl = vi.fn(async (url) => {
            expect(url).toBe(`${DOCUMENT_URL}?ref=${COMMIT_V2}`);
            return response(200, {
                type: 'file',
                path: 'docs/guide.md',
                sha: 'blob-v2',
                content: Buffer.from(content, 'utf8').toString('base64')
            });
        });

        const result = await createProvider(fetchImpl).readVersion(request({ version: COMMIT_V2 }));

        expect(result).toMatchObject({
            path: 'docs/guide.md',
            content,
            revision: COMMIT_V2,
            canonical_url: `https://github.com/Acme/alpha-docs/blob/${COMMIT_V2}/docs/guide.md`
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([undefined, '', 'main', 'commit-v2'])('rejects missing or mutable version %s before HTTP', async (version) => {
        const fake = fakeGitHubFetch();
        const provider = createProvider(fake.fetchImpl);

        await expect(provider.readVersion(request({ version }))).rejects.toMatchObject({
            code: version ? 'canonical_document_version_invalid' : 'canonical_document_input_invalid',
            status: version ? 422 : 400
        });
        expect(fake.fetchImpl).not.toHaveBeenCalled();
    });

    it('uses the resolved owning_repo branch and path scope for CAS write and readback', async () => {
        const fake = fakeGitHubFetch();
        const writer = new CanonicalDocumentWriterAdapter({
            provider: createProvider(fake.fetchImpl)
        });

        const result = await writer.save(request());

        expect(result).toMatchObject({
            status: 'saved',
            path: 'docs/guide.md',
            revision: 'commit-v2',
            idempotency_replayed: false,
            readback: {
                path: 'docs/guide.md',
                revision: 'commit-v2'
            }
        });
        expect(fake.state.writes).toBe(1);
        expect(fake.calls).toHaveLength(5);
        expect(fake.calls.every(({ options }) => options.headers.Authorization === 'Bearer github-secret')).toBe(true);
        expect(fake.calls.at(2).options.body).not.toContain('github-secret');
        expect(fake.calls.at(2).options.body).toContain('"sha":"blob-v1"');
        expect(fake.calls.at(2).options.body).toContain('"branch":"main"');
    });

    it('creates a new canonical file when base_hash is absent and the source is missing', async () => {
        const fake = fakeGitHubFetch({ currentHash: null });
        const writer = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        const result = await writer.save(request({ base_hash: null }));

        expect(result).toMatchObject({ revision: 'commit-v2', readback: { revision: 'commit-v2' } });
        expect(fake.state.writes).toBe(1);
        expect(JSON.parse(fake.calls.find(({ options }) => options.method === 'PUT').options.body)).not.toHaveProperty('sha');
    });

    it('replays an identical idempotency key without another HTTP write', async () => {
        const fake = fakeGitHubFetch();
        const writer = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        await writer.save(request());
        const replay = await writer.save(request());

        expect(replay.idempotency_replayed).toBe(true);
        expect(fake.state.writes).toBe(1);
        expect(fake.fetchImpl).toHaveBeenCalledTimes(5);
    });

    it('recovers a successful write after response loss across a provider restart', async () => {
        const fake = fakeGitHubFetch({ responseLossAfterWrite: true });
        const first = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        await expect(first.save(request())).rejects.toMatchObject({
            code: 'canonical_document_writer_unavailable',
            status: 503
        });

        const restarted = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });
        const recovered = await restarted.save(request());

        expect(recovered).toMatchObject({
            idempotency_replayed: true,
            revision: 'commit-v2',
            readback: { revision: 'commit-v2' }
        });
        expect(fake.state.writes).toBe(1);
        expect(fake.fetchImpl.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(1);
    });

    it('fails closed on a stale file CAS hash before issuing a PUT', async () => {
        const fake = fakeGitHubFetch({ currentHash: 'blob-other' });
        const writer = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        await expect(writer.save(request())).rejects.toMatchObject({
            code: 'canonical_document_cas_conflict',
            status: 409
        });
        expect(fake.state.writes).toBe(0);
        expect(fake.fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('fails closed on a stale repository revision before issuing a PUT', async () => {
        const fake = fakeGitHubFetch({ currentRevision: 'commit-other' });
        const writer = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        await expect(writer.save(request())).rejects.toMatchObject({
            code: 'canonical_document_cas_conflict',
            status: 409
        });
        expect(fake.state.writes).toBe(0);
        expect(fake.fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('rejects a readback body mismatch after the remote write', async () => {
        const fake = fakeGitHubFetch({ readbackContent: '# Different\n' });
        const writer = new CanonicalDocumentWriterAdapter({ provider: createProvider(fake.fetchImpl) });

        await expect(writer.save(request())).rejects.toMatchObject({
            code: 'canonical_document_readback_mismatch',
            status: 502
        });
        expect(fake.state.writes).toBe(1);
        expect(fake.fetchImpl).toHaveBeenCalledTimes(5);
    });

    it('does not trust ConfigParser branch and rejects a missing pointer branch', async () => {
        const fake = fakeGitHubFetch();
        const provider = createProvider(fake.fetchImpl);
        const missingBranch = resolution({
            canonical_location: {
                repository: 'project:alpha',
                owner: 'Acme',
                repo: 'alpha-docs',
                tenant_id: 'org_1',
                path: 'docs/'
            }
        });

        await expect(provider.write(request({ resolution: missingBranch }))).rejects.toMatchObject({
            code: 'canonical_document_graph_pointer_required',
            status: 503
        });
        expect(fake.fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects configured repository and pointer mismatches before HTTP', async () => {
        const fake = fakeGitHubFetch();
        const provider = createProvider(fake.fetchImpl, { repo: 'other-docs' });

        await expect(provider.write(request())).rejects.toMatchObject({
            code: 'canonical_document_pointer_mismatch',
            status: 422
        });
        expect(fake.fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects paths outside the resolved repository scope', async () => {
        const fake = fakeGitHubFetch();
        const provider = createProvider(fake.fetchImpl);

        await expect(provider.write(request({ path: 'private/guide.md' }))).rejects.toMatchObject({
            code: 'canonical_document_path_outside_pointer',
            status: 422
        });
        expect(fake.fetchImpl).not.toHaveBeenCalled();
    });
});
