import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createConfiguredKnowledgeDocumentContentRetriever } from '../../server/bootstrap/knowledge-document-writer.js';
import { registerKnowledgeCatalogApiRoute } from '../../server/bootstrap/register-api-routes.js';
import { KnowledgeDocumentGraphPointerResolver } from '../../server/services/knowledge-document-graph-pointer-resolver.js';

function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const COMMIT_V2 = '2222222222222222222222222222222222222222';
const COMMIT_V3 = '3333333333333333333333333333333333333333';

function createFixture({ documentVersion = COMMIT_V2 } = {}) {
    const content = '# Canonical guide\n';
    const registration = {
        project_code: 'alpha', organization_id: 'org_1', tenant_id: 'org_1',
        source_class: 'owning_repo', content_type: 'team_document',
        repository_owner: 'Acme', repository_name: 'alpha-docs', branch: 'main', path_scope: 'docs',
        graph_project_id: 'project_alpha', graph_entity_id: 'project_alpha', graph_entity_type: 'project',
        graph_entity_lifecycle_status: 'active', registration_status: 'active',
        registry_repository: { owner: 'Acme', repo: 'alpha-docs' }
    };
    const graphPointerResolver = new KnowledgeDocumentGraphPointerResolver({
        graphRepository: { readDocumentSourceRegistration: vi.fn(async () => registration) }
    });
    let branchRevision = COMMIT_V2;
    const fetchImpl = vi.fn(async (url) => {
        if (url === `https://api.github.test/repos/Acme/alpha-docs/contents/docs/guide.md?ref=${COMMIT_V2}`) {
            branchRevision = COMMIT_V3;
            return {
                ok: true, status: 200, json: async () => ({
                    type: 'file', path: 'docs/guide.md', sha: 'blob-v2',
                    content: Buffer.from(content).toString('base64'),
                    html_url: `https://github.com/Acme/alpha-docs/blob/${COMMIT_V2}/docs/guide.md`
                })
            };
        }
        if (url.includes('/git/ref/heads/main')) {
            return { ok: true, status: 200, json: async () => ({ object: { sha: branchRevision } }) };
        }
        throw new Error(`unexpected request ${url}`);
    });
    const contentRetriever = createConfiguredKnowledgeDocumentContentRetriever({
        env: {
            BRAINBASE_KNOWLEDGE_DOCUMENT_RETRIEVER_ENABLED: '1',
            GITHUB_TOKEN: 'github-secret',
            GITHUB_API_BASE_URL: 'https://api.github.test'
        },
        configParser: {
            getGitHubMappings: vi.fn(async () => [{ project_id: 'alpha', owner: 'Acme', repo: 'alpha-docs' }])
        },
        graphPointerResolver,
        fetchImpl
    });
    const document = {
        id: 'document_alpha_guide', entity_type: 'document', project_code: 'alpha',
        payload: {
            title: 'Canonical guide', status: 'active', version: documentVersion,
            repository_path: 'docs/guide.md', content_hash: sha256(content)
        },
        updated_at: '2026-09-18T00:00:00.000Z'
    };
    const infoSSOTService = {
        listGraphEntities: vi.fn(async (_access, options = {}) => options.id === document.id ? [document] : []),
        listGraphEdges: vi.fn(async () => [])
    };
    const authService = {
        verifyToken: vi.fn((token) => ({
            sub: 'per_1', organizationId: token === 'wrong-tenant' ? 'org_2' : 'org_1',
            projectCodes: ['alpha'], role: 'member'
        }))
    };
    const app = express();
    app.use(express.json());
    registerKnowledgeCatalogApiRoute(app, { authService, infoSSOTService, contentRetriever });
    return { app, content, document, fetchImpl };
}

describe('GitHub canonical document retrieval production registration', () => {
    it('production serverがcore serviceのretrieverをknowledge routeへ渡す', () => {
        const serverSource = readFileSync(`${process.cwd()}/server.js`, 'utf8');
        const coreDestructure = serverSource.match(/const \{([\s\S]*?)\} = createCoreServices/u)?.[1] || '';
        const routeRegistration = serverSource.match(/registerApiRoutes\(app, \{([\s\S]*?)\n\}\);/u)?.[1] || '';

        expect(coreDestructure).toContain('contentRetriever');
        expect(routeRegistration).toContain('contentRetriever');
    });

    it('通常route/bootstrapからGraph登録済み文書の固定版本文を取得する', async () => {
        const fixture = createFixture();
        const response = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set('authorization', 'Bearer valid')
            .send({ project_code: 'alpha', refs: [{ id: fixture.document.id, version: COMMIT_V2 }] })
            .expect(200);

        expect(response.body.results[0]).toMatchObject({
            id: fixture.document.id,
            status: 'resolved',
            resolved_version: COMMIT_V2,
            content: fixture.content,
            content_hash: sha256(fixture.content),
            retrieval_receipt_id: expect.stringMatching(/^github:/)
        });
        expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
        expect(fixture.fetchImpl).toHaveBeenCalledWith(
            `https://api.github.test/repos/Acme/alpha-docs/contents/docs/guide.md?ref=${COMMIT_V2}`,
            expect.any(Object)
        );
    });

    it('Graph pointerのtenantと認証主体が不一致ならGitHub本文を返さない', async () => {
        const fixture = createFixture();
        const response = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set('authorization', 'Bearer wrong-tenant')
            .send({ project_code: 'alpha', refs: [{ id: fixture.document.id, version: COMMIT_V2 }] })
            .expect(403);

        expect(response.body.error.code).toBe('knowledge_document_tenant_mismatch');
        expect(fixture.fetchImpl).not.toHaveBeenCalled();
    });

    it('取得中にbranchが進んでも指定commitの本文と版を関連付ける', async () => {
        const fixture = createFixture();
        const response = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set('authorization', 'Bearer valid')
            .send({ project_code: 'alpha', refs: [{ id: fixture.document.id, version: COMMIT_V2 }] })
            .expect(200);

        expect(response.body.results[0]).toMatchObject({
            status: 'resolved',
            requested_version: COMMIT_V2,
            resolved_version: COMMIT_V2,
            content: fixture.content
        });
        expect(fixture.fetchImpl.mock.calls.some(([url]) => url.includes('/git/ref/heads/main'))).toBe(false);
    });

    it('固定版がGit commit SHAでない場合はproviderを呼ばず拒否する', async () => {
        const fixture = createFixture({ documentVersion: 'main' });
        const response = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set('authorization', 'Bearer valid')
            .send({ project_code: 'alpha', refs: [{ id: fixture.document.id, version: 'main' }] })
            .expect(422);

        expect(response.body.error.code).toBe('knowledge_document_version_invalid');
        expect(fixture.fetchImpl).not.toHaveBeenCalled();
    });
});
