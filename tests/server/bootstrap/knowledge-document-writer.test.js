import { describe, expect, it, vi } from 'vitest';

import { createConfiguredKnowledgeDocumentWriter } from '../../../server/bootstrap/knowledge-document-writer.js';

function resolution() {
    return {
        status: 'resolved',
        project_code: 'alpha',
        source_class: 'owning_repo',
        content_type: 'team_document',
        canonical_location: {
            repository: 'project:alpha',
            owner: 'Acme',
            repo: 'alpha-docs',
            branch: 'main',
            path: 'docs/'
        }
    };
}

function fakeFetch() {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'GET' && url.includes('/contents/docs/guide.md')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: 'file',
                    path: 'docs/guide.md',
                    sha: calls.some(({ options: callOptions }) => callOptions.method === 'PUT') ? 'blob-v2' : 'blob-v1',
                    content: Buffer.from('# Guide\n', 'utf8').toString('base64'),
                    html_url: 'https://github.com/Acme/alpha-docs/blob/main/docs/guide.md'
                })
            };
        }
        if (options.method === 'GET' && url.includes('/git/ref/heads/main')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ object: { sha: calls.some(({ options: callOptions }) => callOptions.method === 'PUT') ? 'commit-v2' : 'commit-v1' } })
            };
        }
        if (options.method === 'PUT') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    content: { path: 'docs/guide.md', sha: 'blob-v2', html_url: 'https://github.com/Acme/alpha-docs/blob/main/docs/guide.md' },
                    commit: { sha: 'commit-v2', html_url: 'https://github.com/Acme/alpha-docs/commit/commit-v2' }
                })
            };
        }
        throw new Error(`unexpected request ${url}`);
    });
    return { fetchImpl, calls };
}

describe('configured knowledge document writer', () => {
    it('stays disabled unless explicitly enabled', () => {
        const writer = createConfiguredKnowledgeDocumentWriter({
            env: { GITHUB_TOKEN: 'github-secret' },
            configParser: { getGitHubMappings: vi.fn() }
        });

        expect(writer).toBeNull();
    });

    it('stays disabled when the existing GitHub credential is missing', () => {
        const writer = createConfiguredKnowledgeDocumentWriter({
            env: { BRAINBASE_KNOWLEDGE_DOCUMENT_WRITER_ENABLED: '1' },
            configParser: { getGitHubMappings: vi.fn() }
        });

        expect(writer).toBeNull();
    });

    it('connects the explicit opt-in writer to the injected HTTP double', async () => {
        const fake = fakeFetch();
        const writer = createConfiguredKnowledgeDocumentWriter({
            env: {
                BRAINBASE_KNOWLEDGE_DOCUMENT_WRITER_ENABLED: '1',
                GITHUB_TOKEN: 'github-secret',
                GITHUB_API_BASE_URL: 'https://api.github.test'
            },
            configParser: {
                getGitHubMappings: vi.fn(async () => [{
                    project_id: 'alpha',
                    owner: 'Acme',
                    repo: 'alpha-docs',
                    branch: 'config-default-ignored'
                }])
            },
            fetchImpl: fake.fetchImpl
        });

        const result = await writer.save({
            project_code: 'alpha',
            path: 'docs/guide.md',
            content: '# Guide\n',
            base_hash: 'blob-v1',
            base_revision: 'commit-v1',
            idempotency_key: 'factory-save-1',
            resolution: resolution(),
            access: { projectCodes: ['alpha'] }
        });

        expect(result).toMatchObject({ status: 'saved', revision: 'commit-v2' });
        expect(fake.calls).toHaveLength(5);
        expect(fake.calls[0].options.headers.Authorization).toBe('Bearer github-secret');
    });
});
