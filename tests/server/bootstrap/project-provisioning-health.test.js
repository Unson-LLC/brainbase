// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';

const createdVarDirs = [];

function bootstrapApp(runtimeCatalog, authService = null) {
    const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-project-provisioning-health-'));
    createdVarDirs.push(varDir);
    const legacyParser = {
        checkIntegrity: vi.fn(async () => ({
            applicability: 'applicable',
            source: { status: 'legacy' },
            summary: { errors: 0 }
        }))
    };
    const resolvedAuthService = authService || {
        verifyServiceToken: vi.fn(),
        verifyToken: vi.fn()
    };
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        configParser: legacyParser,
        configService: {},
        runtimePaths: { varDir },
        scheduleParser: {},
        googleCalendarService: {},
        projectsRoot: varDir,
        authService: resolvedAuthService,
        infoSSOTService: {},
        projectProvisioningService: { runtimeCatalog },
        canonicalTaskStoreConfig: { ownerPersonId: 'person_admin', ownerAliasIds: [] },
        canonicalTaskService: {},
        learningService: {},
        learningHealthService: {},
        candidateRepository: null,
        wikiService: {},
        tokenUsageService: {},
        uploadMiddleware: (_req, _res, next) => next(),
        appVersion: 'test',
        workspaceRoot: varDir,
        uploadsDir: path.join(varDir, 'uploads'),
        runtimeInfo: {},
        brainbaseRoot: varDir,
        tenantRuntimeServices: null,
        snsPostExecutor: vi.fn()
    });
    return { app, legacyParser, authService: resolvedAuthService };
}

afterEach(() => {
    vi.unstubAllEnvs();
    while (createdVarDirs.length > 0) {
        fs.rmSync(createdVarDirs.pop(), { recursive: true, force: true });
    }
});

describe('Project Provisioning health bootstrap', () => {
    it('registerApiRoutesはRegistry-aware runtime catalogを/api/healthへ配線する', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', 'json_test');
        const runtimeCatalog = {
            checkIntegrity: vi.fn(async () => ({
                applicability: 'applicable',
                source: { status: 'loaded', scope: 'schema' },
                summary: { errors: 0 }
            }))
        };
        const { app, legacyParser } = bootstrapApp(runtimeCatalog);

        const response = await request(app).get('/api/health');

        expect(response.status).toBe(200);
        expect(response.body.checks.config).toMatchObject({
            status: 'healthy',
            source: { status: 'loaded', scope: 'schema' }
        });
        expect(runtimeCatalog.checkIntegrity).toHaveBeenCalledOnce();
        expect(legacyParser.checkIntegrity).not.toHaveBeenCalled();
    });

    it('registerApiRoutesは/api/brainbase rootへCatalog認証を配線しorganization contextを渡す', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', 'json_test');
        vi.stubEnv('GITHUB_TOKEN', '');

        let organizationId = null;
        const runtimeCatalog = {
            runForOrganization: vi.fn(async (nextOrganizationId, callback) => {
                const previous = organizationId;
                organizationId = nextOrganizationId;
                try {
                    return await callback();
                } finally {
                    organizationId = previous;
                }
            }),
            getProjects: vi.fn(async () => ({
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: organizationId === 'org-growin'
                    ? [{ id: 'growin-project', name: 'Growin' }]
                    : [{ id: 'other-project', name: 'Other' }]
            }))
        };
        const authService = {
            verifyServiceToken: vi.fn(),
            verifyToken: vi.fn((token) => {
                if (token !== 'growin-token') throw new Error('invalid token');
                return {
                    sub: 'person-1',
                    role: 'member',
                    organizationId: 'org-growin',
                    projectCodes: ['growin-project']
                };
            })
        };
        const { app } = bootstrapApp(runtimeCatalog, authService);

        const unauthenticated = await request(app).get('/api/brainbase');
        expect(unauthenticated.status).toBe(401);

        const rootResponse = await request(app)
            .get('/api/brainbase')
            .set('Authorization', 'Bearer growin-token');
        expect(rootResponse.status).toBe(200);
        expect(rootResponse.body.source).toEqual({
            status: 'loaded',
            mode: 'registry_scoped'
        });
        expect(runtimeCatalog.runForOrganization).toHaveBeenCalledWith(
            'org-growin',
            expect.any(Function)
        );

        authService.verifyToken.mockClear();
        const projectsResponse = await request(app)
            .get('/api/brainbase/projects')
            .set('Authorization', 'Bearer growin-token');
        expect(projectsResponse.status).toBe(200);
        expect(authService.verifyToken).toHaveBeenCalledOnce();

        authService.verifyToken.mockClear();
        const alertsResponse = await request(app)
            .get('/api/brainbase/critical-alerts?test=true');
        expect(alertsResponse.status).toBe(200);
        expect(authService.verifyToken).not.toHaveBeenCalled();
    });
});
