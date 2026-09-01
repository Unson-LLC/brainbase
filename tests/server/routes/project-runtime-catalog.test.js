import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createConfigRouter } from '../../../server/routes/config.js';
import { createBrainbaseOverviewRouter } from '../../../server/routes/brainbase/overview-routes.js';

function runtimeCatalog() {
    let organizationId = null;
    return {
        runForOrganization: vi.fn(async (nextOrganizationId, callback) => {
            const previous = organizationId;
            organizationId = nextOrganizationId;
            try { return await callback(); } finally { organizationId = previous; }
        }),
        getProjects: vi.fn(async () => ({
            source: { status: 'loaded', mode: 'registry_merged' },
            projects: organizationId === 'org-growin'
                ? [
                    {
                        id: 'registry-only',
                        name: 'Registry Only',
                        session_select: true,
                        github: { repo: 'growin-project' }
                    },
                    { id: 'ungranted-project', name: 'Ungranted', session_select: true }
                ]
                : [{ id: 'other-project', name: 'Other Project', session_select: true }]
        })),
        checkIntegrity: vi.fn(async () => ({
            applicability: 'applicable',
            source: { status: 'loaded', scope: 'schema' },
            summary: { errors: 0 }
        }))
    };
}

function organizationGuard(organizationId, projectCodes, role = 'member') {
    return (req, _res, next) => {
        req.access = { organizationId, projectCodes, role, personId: 'person-1' };
        next();
    };
}

function personGrantOnlyGuard(projectCodes) {
    return (req, _res, next) => {
        req.access = { projectCodes, role: 'member', personId: 'person-1' };
        next();
    };
}

describe('runtime project catalog routes', () => {
    it('/api/brainbaseは認証済みreq.accessのorganizationでcatalogを読みsourceを保持する', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/brainbase', (req, _res, next) => {
            req.access = {
                organizationId: 'org-growin',
                projectCodes: ['growin-project'],
                role: 'member',
                personId: 'person-1'
            };
            next();
        }, createBrainbaseOverviewRouter({
            projectCatalogParser: catalog,
            configParser: { getAll: vi.fn(async () => ({ projects: { projects: [] } })) },
            projectCatalogAuthGuard: (_req, _res, next) => next(),
            githubService: {
                getSelfHostedRunners: vi.fn(async () => []),
                getWorkflowRuns: vi.fn(async () => [])
            },
            systemService: { getSystemStatus: vi.fn(async () => ({ status: 'ok' })) },
            storageService: {},
            nocodbService: { getProjectStats: vi.fn() }
        }));

        const response = await request(app).get('/api/brainbase');

        expect(response.status).toBe(200);
        expect(response.body.projects.map((project) => project.id)).toEqual(['registry-only']);
        expect(response.body.source).toEqual({ status: 'loaded', mode: 'registry_merged' });
        expect(catalog.runForOrganization).toHaveBeenCalledWith('org-growin', expect.any(Function));
    });

    it('/api/config/projectsは認証organizationのRegistry-only projectを返す', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/config', createConfigRouter({}, {}, null, {
            authGuard: organizationGuard('org-growin', ['registry-only']),
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects.map((project) => project.id)).toEqual(['registry-only']);
        expect(response.body.source).toEqual({ status: 'loaded', mode: 'registry_merged' });
        expect(catalog.runForOrganization).toHaveBeenCalledWith('org-growin', expect.any(Function));
    });

    it('/api/config/integrityはlegacy parserではなくRegistry-aware catalogを確認する', async () => {
        const catalog = runtimeCatalog();
        const legacyParser = { checkIntegrity: vi.fn() };
        const app = express();
        app.use('/api/config', createConfigRouter(legacyParser, {}, null, {
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/integrity');

        expect(response.status).toBe(200);
        expect(response.body.source).toEqual({ status: 'loaded', scope: 'schema' });
        expect(catalog.checkIntegrity).toHaveBeenCalledOnce();
        expect(legacyParser.checkIntegrity).not.toHaveBeenCalled();
    });

    it('GitHubリポジトリ名のgrantでも同じプロジェクトだけを返す', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/config', createConfigRouter({}, {}, null, {
            authGuard: organizationGuard('org-growin', ['growin-project']),
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects.map((project) => project.id)).toEqual(['registry-only']);
    });

    it('personとGrantがあってもorganization contextなしではlegacy projectを返さない', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/config', createConfigRouter({}, {}, null, {
            authGuard: personGrantOnlyGuard(['other-project']),
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([]);
        expect(response.body.source).toEqual({
            status: 'organization_context_required',
            mode: 'registry_scope_required'
        });
        expect(catalog.getProjects).not.toHaveBeenCalled();
    });

    it('短いproject grantをprefixが一致する別projectへ拡張しない', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: { status: 'loaded', mode: 'registry_merged' },
            projects: [{ id: 'growin-payroll' }]
        });
        const app = express();
        app.use('/api/config', createConfigRouter({}, {}, null, {
            authGuard: organizationGuard('org-growin', ['growin']),
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([]);
    });

    it('Registry取得不能を成功した空一覧へ丸めずsourceに残す', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: {
                status: 'unavailable',
                mode: 'legacy_fallback',
                code: 'project_registry_migration_unavailable'
            },
            projects: [{ id: 'registry-only', name: 'Legacy Project' }]
        });
        const app = express();
        app.use('/api/config', createConfigRouter({}, {}, null, {
            authGuard: organizationGuard('org-growin', ['registry-only']),
            projectCatalogParser: catalog
        }));

        const response = await request(app).get('/api/config/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([]);
        expect(response.body.source).toEqual({
            status: 'unavailable',
            mode: 'legacy_fallback',
            code: 'project_registry_migration_unavailable'
        });
    });

    it('/api/brainbase/projectsはRegistry-only projectを所有organizationだけに返す', async () => {
        const catalog = runtimeCatalog();
        const createApp = (organizationId, projectCodes) => {
            const app = express();
            app.use('/api/brainbase', createBrainbaseOverviewRouter({
                projectCatalogParser: catalog,
                configParser: { getAll: vi.fn(async () => ({ projects: { projects: [] } })) },
                projectCatalogAuthGuard: organizationGuard(organizationId, projectCodes),
                githubService: {}, systemService: {}, storageService: {},
                nocodbService: { getProjectStats: vi.fn() }
            }));
            return app;
        };

        const ownerResponse = await request(createApp('org-growin', ['growin-project']))
            .get('/api/brainbase/projects');
        const otherResponse = await request(createApp('org-other', ['registry-only']))
            .get('/api/brainbase/projects');

        expect(ownerResponse.status).toBe(200);
        expect(ownerResponse.body.projects.map((project) => project.id)).toEqual(['registry-only']);
        expect(ownerResponse.body.source).toEqual({ status: 'loaded', mode: 'registry_merged' });
        expect(otherResponse.status).toBe(200);
        expect(otherResponse.body.projects).toEqual([]);
        expect(otherResponse.body.source).toEqual({ status: 'loaded', mode: 'registry_merged' });
    });

    it('/api/config/projectsと/api/brainbase/projectsはroleに関係なく同じproject grantだけを返す', async () => {
        for (const role of ['member', 'admin', 'ceo']) {
            const catalog = runtimeCatalog();
            const configApp = express();
            configApp.use('/api/config', createConfigRouter({}, {}, null, {
                authGuard: organizationGuard('org-growin', ['growin-project'], role),
                projectCatalogParser: catalog
            }));
            const overviewApp = express();
            overviewApp.use('/api/brainbase', createBrainbaseOverviewRouter({
                projectCatalogParser: catalog,
                configParser: { getAll: vi.fn(async () => ({ projects: { projects: [] } })) },
                projectCatalogAuthGuard: organizationGuard('org-growin', ['growin-project'], role),
                githubService: {}, systemService: {}, storageService: {},
                nocodbService: { getProjectStats: vi.fn() }
            }));

            const configResponse = await request(configApp).get('/api/config/projects');
            const overviewResponse = await request(overviewApp).get('/api/brainbase/projects');

            expect(configResponse.status).toBe(200);
            expect(configResponse.body.projects.map((project) => project.id)).toEqual(['registry-only']);
            expect(overviewResponse.status).toBe(200);
            expect(overviewResponse.body.projects.map((project) => project.id)).toEqual(['registry-only']);
        }
    });

    it('/api/brainbase/projectsはHTTP 200でもRegistry source.status=unavailableを保持する', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: {
                status: 'unavailable',
                mode: 'legacy_fallback',
                code: 'project_registry_migration_unavailable'
            },
            projects: [{ id: 'registry-only', name: 'Legacy Project' }]
        });
        const app = express();
        app.use('/api/brainbase', createBrainbaseOverviewRouter({
            projectCatalogParser: catalog,
            configParser: { getAll: vi.fn(async () => ({ projects: { projects: [] } })) },
            projectCatalogAuthGuard: organizationGuard('org-growin', ['registry-only']),
            githubService: {}, systemService: {}, storageService: {},
            nocodbService: { getProjectStats: vi.fn() }
        }));

        const response = await request(app).get('/api/brainbase/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([]);
        expect(response.body.source).toEqual({
            status: 'unavailable',
            mode: 'legacy_fallback',
            code: 'project_registry_migration_unavailable'
        });
    });

    it('/api/brainbase/projectsはpersonとGrantだけではlegacy projectを返さない', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/brainbase', createBrainbaseOverviewRouter({
            projectCatalogParser: catalog,
            configParser: { getAll: vi.fn(async () => ({ projects: { projects: [] } })) },
            projectCatalogAuthGuard: personGrantOnlyGuard(['other-project']),
            githubService: {}, systemService: {}, storageService: {},
            nocodbService: { getProjectStats: vi.fn() }
        }));

        const response = await request(app).get('/api/brainbase/projects');

        expect(response.status).toBe(200);
        expect(response.body.projects).toEqual([]);
        expect(response.body.source).toEqual({
            status: 'organization_context_required',
            mode: 'registry_scope_required'
        });
        expect(catalog.getProjects).not.toHaveBeenCalled();
    });
});
