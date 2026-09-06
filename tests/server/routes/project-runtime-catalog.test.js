import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createConfigRouter } from '../../../server/routes/config.js';
import { createBrainbaseOverviewRouter } from '../../../server/routes/brainbase/overview-routes.js';
import { createBrainbasePortalRouter } from '../../../server/routes/brainbase/portal-routes.js';
import { createBrainbaseTrendsRouter } from '../../../server/routes/brainbase/trends-routes.js';
import { flushCache } from '../../../server/middleware/cache.js';
import { errorHandler } from '../../../server/middleware/error-handler.js';

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
                        github: { owner: 'growin', repo: 'growin-project' }
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
    it('portalはlegacy configだけにあるprojectを返さずGraph catalogの名称を使う', async () => {
        const catalog = runtimeCatalog();
        const legacyParser = {
            getAll: vi.fn(async () => ({
                projects: { projects: [
                    { id: 'legacy-only', name: 'Legacy Only', nocodb: { project_id: 'legacy-base' } },
                    { id: 'registry-only', name: 'Stale Name', nocodb: { project_id: 'registry-base' } }
                ] }
            }))
        };
        const app = express();
        app.use('/api/brainbase', organizationGuard('org-growin', ['registry-only']), createBrainbasePortalRouter({
            configParser: legacyParser,
            projectCatalogParser: catalog,
            projectCatalogAuthGuard: (_req, _res, next) => next(),
            nocodbService: { _fetchRecords: vi.fn(async () => []), getProjectStats: vi.fn(async () => ({})) }
        }));

        const canonical = await request(app).get('/api/brainbase/portal/registry-only');
        const legacyOnly = await request(app).get('/api/brainbase/portal/legacy-only');

        expect(canonical.status).toBe(200);
        expect(canonical.body.project).toEqual({ code: 'registry-only', name: 'Registry Only' });
        expect(legacyOnly.status).toBe(404);
        expect(catalog.runForOrganization).toHaveBeenCalledWith('org-growin', expect.any(Function));
    });

    it('trends heatmapはlegacy configだけのprojectを除外しGraph catalogだけを集計する', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: { status: 'loaded', mode: 'graph_ssot_registry_scoped' },
            projects: [{ id: 'registry-only', name: 'Registry Only', nocodb: { project_id: 'registry-base' } }]
        });
        const legacyParser = {
            getAll: vi.fn(async () => ({
                projects: { projects: [{ id: 'legacy-only', nocodb: { project_id: 'legacy-base' } }] }
            }))
        };
        const nocodbService = {
            getTrends: vi.fn(async () => ({ snapshots: [], trend_analysis: { trend: 'unknown' } }))
        };
        const app = express();
        app.use('/api/brainbase', organizationGuard('org-growin', ['registry-only']), createBrainbaseTrendsRouter({
            configParser: legacyParser,
            projectCatalogParser: catalog,
            projectCatalogAuthGuard: (_req, _res, next) => next(),
            nocodbService
        }));

        const response = await request(app).get('/api/brainbase/trends/heatmap');

        expect(response.status).toBe(200);
        expect(response.body.heatmap.map((project) => project.project_id)).toEqual(['registry-only']);
        expect(nocodbService.getTrends).toHaveBeenCalledWith('registry-base', 56);
        expect(legacyParser.getAll).not.toHaveBeenCalled();
    });

    it('技術設定の補完が取得不能なら空のheatmapを成功扱いしない', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: {
                status: 'loaded',
                mode: 'graph_ssot_registry_scoped',
                enrichment_status: 'unavailable'
            },
            projects: [{ id: 'registry-only', name: 'Registry Only' }]
        });
        const nocodbService = { getTrends: vi.fn() };
        const app = express();
        app.use('/api/brainbase', organizationGuard('org-growin', ['registry-only']), createBrainbaseTrendsRouter({
            projectCatalogParser: catalog,
            projectCatalogAuthGuard: (_req, _res, next) => next(),
            nocodbService
        }));

        const response = await request(app).get('/api/brainbase/trends/heatmap');

        expect(response.status).toBe(503);
        expect(response.body.source.enrichment_status).toBe('unavailable');
        expect(nocodbService.getTrends).not.toHaveBeenCalled();
    });

    it('trends単体取得はGraph catalogにあるNocoDB投影だけを許可する', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: { status: 'loaded', mode: 'graph_ssot_registry_scoped' },
            projects: [{ id: 'registry-only', nocodb: { project_id: 'registry-base' } }]
        });
        const nocodbService = { getTrends: vi.fn(async () => ({ snapshots: [] })) };
        const app = express();
        app.use('/api/brainbase', organizationGuard('org-growin', ['registry-only']), createBrainbaseTrendsRouter({
            configParser: { getAll: vi.fn() }, projectCatalogParser: catalog,
            projectCatalogAuthGuard: (_req, _res, next) => next(), nocodbService
        }));

        const denied = await request(app).get('/api/brainbase/trends?project_id=legacy-base');
        const allowed = await request(app).get('/api/brainbase/trends?project_id=registry-base');

        expect(denied.status).toBe(404);
        expect(allowed.status).toBe(200);
        expect(nocodbService.getTrends).toHaveBeenCalledTimes(1);
    });

    it('portal membersもGraph catalogのproject grantを通す', async () => {
        const catalog = runtimeCatalog();
        const app = express();
        app.use('/api/brainbase', organizationGuard('org-growin', ['registry-only']), createBrainbasePortalRouter({
            configParser: { getAll: vi.fn() }, projectCatalogParser: catalog,
            projectCatalogAuthGuard: (_req, _res, next) => next(),
            nocodbService: {}, infoSSOTService: { pool: null }
        }));

        const denied = await request(app).get('/api/brainbase/portal/legacy-only/members');

        expect(denied.status).toBe(404);
    });

    it('critical alertsはlegacy configではなくGraph catalogのNocoDB投影だけを使う', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: { status: 'loaded', mode: 'graph_ssot_registry_scoped' },
            projects: [{ id: 'registry-only', name: 'Registry Only', nocodb: { project_id: 'registry-base' } }]
        });
        const legacyParser = {
            getAll: vi.fn(async () => ({
                projects: { projects: [{ id: 'legacy-only', nocodb: { project_id: 'legacy-base' } }] }
            }))
        };
        const nocodbService = { getCriticalAlerts: vi.fn(async (projects) => ({ projects })) };
        const app = express();
        app.use('/api/brainbase', createBrainbaseOverviewRouter({
            configParser: legacyParser,
            projectCatalogParser: catalog,
            projectCatalogAuthGuard: organizationGuard('org-growin', ['registry-only']),
            githubService: {}, systemService: {}, storageService: {}, nocodbService
        }));

        const response = await request(app).get('/api/brainbase/critical-alerts');

        expect(response.status).toBe(200);
        expect(nocodbService.getCriticalAlerts).toHaveBeenCalledWith([
            { id: 'registry-only', project_id: 'registry-base' }
        ]);
        expect(legacyParser.getAll).not.toHaveBeenCalled();
    });

    it('同じURLでも別organizationへcritical alertsのcacheを共有しない', async () => {
        flushCache();
        let organizationId = null;
        const catalog = {
            runForOrganization: vi.fn(async (nextOrganizationId, callback) => {
                organizationId = nextOrganizationId;
                return callback();
            }),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'graph_ssot_registry_scoped' },
                projects: [{ id: `project-${organizationId}`, nocodb: { project_id: `base-${organizationId}` } }]
            }))
        };
        const nocodbService = {
            getCriticalAlerts: vi.fn(async (projects) => ({ project_id: projects[0]?.id || null }))
        };
        const app = express();
        app.use('/api/brainbase', createBrainbaseOverviewRouter({
            configParser: { getAll: vi.fn() }, projectCatalogParser: catalog,
            projectCatalogAuthGuard: (req, _res, next) => {
                const org = req.get('x-org');
                req.access = { organizationId: org, projectCodes: [`project-${org}`] };
                next();
            },
            githubService: {}, systemService: {}, storageService: {}, nocodbService
        }));

        const first = await request(app).get('/api/brainbase/critical-alerts').set('x-org', 'one');
        const second = await request(app).get('/api/brainbase/critical-alerts').set('x-org', 'two');

        expect(first.body.project_id).toBe('project-one');
        expect(second.body.project_id).toBe('project-two');
        expect(nocodbService.getCriticalAlerts).toHaveBeenCalledTimes(2);
    });

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

    it('/api/config/projectsの書込はGraph catalogにないconfig-only projectを作らない', async () => {
        const catalog = runtimeCatalog();
        const configService = { upsertProject: vi.fn() };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, configService, null, {
            authGuard: organizationGuard('org-growin', ['registry-only'], 'ceo'),
            writeGuard: (_req, _res, next) => next(),
            projectCatalogParser: catalog
        }));
        app.use(errorHandler);

        const response = await request(app).post('/api/config/projects').send({
            id: 'legacy-only', local_path: '/workspace/legacy-only'
        });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
        expect(configService.upsertProject).not.toHaveBeenCalled();
    });

    it('/api/config/projectsの書込は既存Graph projectの技術設定だけを更新する', async () => {
        const catalog = runtimeCatalog();
        const configService = { upsertProject: vi.fn(async () => ({ id: 'registry-only' })) };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, configService, null, {
            authGuard: organizationGuard('org-growin', ['registry-only'], 'ceo'),
            writeGuard: (_req, _res, next) => next(),
            projectCatalogParser: catalog
        }));

        const response = await request(app).post('/api/config/projects').send({
            id: 'registry-only', local_path: '/workspace/registry-only'
        });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, scope: 'technical_metadata' });
        expect(configService.upsertProject).toHaveBeenCalledWith({
            id: 'registry-only',
            local_path: '/workspace/registry-only',
            glob_include: []
        }, expect.objectContaining({ organizationId: 'org-growin' }));
    });

    it('GitHub補完はGraphのrepositoryを正本にしconfig-only projectを拒否する', async () => {
        const catalog = runtimeCatalog();
        const configService = { upsertGitHubMapping: vi.fn(async (mapping) => mapping) };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, configService, null, {
            authGuard: organizationGuard('org-growin', ['registry-only'], 'ceo'),
            writeGuard: (_req, _res, next) => next(),
            projectCatalogParser: catalog
        }));
        app.use(errorHandler);

        const rejected = await request(app).post('/api/config/github').send({
            project_id: 'legacy-only', owner: 'legacy', repo: 'legacy', branch: 'main'
        });
        const updated = await request(app).post('/api/config/github').send({
            project_id: 'registry-only', owner: 'stale', repo: 'stale', branch: 'develop'
        });

        expect(rejected.status).toBe(404);
        expect(updated.status).toBe(200);
        expect(updated.body.scope).toBe('technical_metadata');
        expect(configService.upsertGitHubMapping).toHaveBeenCalledOnce();
        expect(configService.upsertGitHubMapping).toHaveBeenCalledWith({
            project_id: 'registry-only', owner: 'growin', repo: 'growin-project', branch: 'develop'
        }, expect.objectContaining({ organizationId: 'org-growin' }));
    });

    it('NocoDB補完もGraph catalogにないprojectを拒否する', async () => {
        const catalog = runtimeCatalog();
        const configService = { upsertNocoDBMapping: vi.fn() };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, configService, null, {
            authGuard: organizationGuard('org-growin', ['registry-only'], 'ceo'),
            writeGuard: (_req, _res, next) => next(),
            projectCatalogParser: catalog
        }));
        app.use(errorHandler);

        const response = await request(app).post('/api/config/nocodb').send({
            project_id: 'legacy-only', nocodb_project_id: 'legacy-base'
        });

        expect(response.status).toBe(404);
        expect(configService.upsertNocoDBMapping).not.toHaveBeenCalled();
    });

    it('GraphにrepositoryがないprojectへconfigだけでGitHub repositoryを追加しない', async () => {
        const catalog = runtimeCatalog();
        catalog.getProjects.mockResolvedValue({
            source: { status: 'loaded', mode: 'graph_ssot_registry_scoped' },
            projects: [{ id: 'registry-only', name: 'Registry Only' }]
        });
        const configService = { upsertGitHubMapping: vi.fn() };
        const app = express();
        app.use(express.json());
        app.use('/api/config', createConfigRouter({}, configService, null, {
            authGuard: organizationGuard('org-growin', ['registry-only'], 'ceo'),
            writeGuard: (_req, _res, next) => next(),
            projectCatalogParser: catalog
        }));
        app.use(errorHandler);

        const response = await request(app).post('/api/config/github').send({
            project_id: 'registry-only', owner: 'config-only', repo: 'config-only', branch: 'main'
        });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('CONFLICT');
        expect(configService.upsertGitHubMapping).not.toHaveBeenCalled();
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
