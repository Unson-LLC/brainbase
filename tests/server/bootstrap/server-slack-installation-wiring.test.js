import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSlackInstallationControlPlaneRouter } from '../../../server/routes/slack-installation-control-plane.js';

const mocks = vi.hoisted(() => ({
    createCoreServices: vi.fn(),
    registerApiRoutes: vi.fn(),
    registerPersonalKnowledgePreAuth: vi.fn(),
    registerStaticRoutes: vi.fn(),
    registerGracefulShutdown: vi.fn(),
    startTenantRuntimeInternalServerFromEnv: vi.fn(),
    loadRuntimeEnv: vi.fn(),
    createMeshRouter: vi.fn()
}));

vi.mock('../../../server/bootstrap/core-services.js', () => ({
    createCoreServices: mocks.createCoreServices
}));
vi.mock('../../../server/bootstrap/register-api-routes.js', () => ({
    registerApiRoutes: mocks.registerApiRoutes,
    registerPersonalKnowledgePreAuth: mocks.registerPersonalKnowledgePreAuth
}));
vi.mock('../../../server/bootstrap/static-routes.js', () => ({
    registerStaticRoutes: mocks.registerStaticRoutes
}));
vi.mock('../../../server/bootstrap/graceful-shutdown.js', () => ({
    registerGracefulShutdown: mocks.registerGracefulShutdown
}));
vi.mock('../../../server/bootstrap/tenant-runtime-internal-server.js', () => ({
    startTenantRuntimeInternalServerFromEnv: mocks.startTenantRuntimeInternalServerFromEnv
}));
vi.mock('../../../lib/load-runtime-env.js', () => ({
    loadRuntimeEnv: mocks.loadRuntimeEnv
}));
vi.mock('../../../server/routes/mesh.js', () => ({
    createMeshRouter: mocks.createMeshRouter
}));

const createdDirectories = [];

function createCoreServices() {
    const oauthFlow = {
        open: vi.fn(() => ({
            intent: { installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
            redirect_uri: 'https://bb.unson.jp/api/v1/slack-installations:callback'
        }))
    };
    const controlPlane = {
        authorize: vi.fn(),
        authorizeBinding: vi.fn(),
        exchange_and_register: vi.fn(async () => ({ status: 'active' }))
    };
    return {
        oauthFlow,
        controlPlane,
        services: {
            canonicalTaskReadiness: {
                initialize: vi.fn(async () => ({ ready: true }))
            },
            slackInstallationControlPlane: controlPlane,
            slackInstallationControlPlaneAuthMiddleware: (_req, _res, next) => next(),
            slackInstallationControlPlaneAppId: 'A0123456789',
            slackInstallationOAuthFlow: oauthFlow,
            resolvePreProvisionedSlackConnection: null,
            tenantRuntimeServices: null,
            meetingSourceMcpSyncService: null,
            canonicalTaskOperationRepository: null
        }
    };
}

afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.createCoreServices.mockReset();
    mocks.registerApiRoutes.mockReset();
    mocks.registerPersonalKnowledgePreAuth.mockReset();
    mocks.registerStaticRoutes.mockReset();
    mocks.registerGracefulShutdown.mockReset();
    mocks.startTenantRuntimeInternalServerFromEnv.mockReset();
    mocks.loadRuntimeEnv.mockReset();
    mocks.createMeshRouter.mockReset();
    while (createdDirectories.length > 0) {
        fs.rmSync(createdDirectories.pop(), { recursive: true, force: true });
    }
});

describe('server Slack installation composition', () => {
    it('passes the production OAuth flow to API registration so the callback is reachable', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-server-slack-wiring-'));
        createdDirectories.push(rootDir);
        vi.stubEnv('BRAINBASE_ROOT', rootDir);
        vi.stubEnv('BRAINBASE_VAR_DIR', path.join(rootDir, 'var'));
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('BRAINBASE_ALLOW_DIRECT_SERVER', '1');
        vi.stubEnv('BRAINBASE_E2E_PORT', '0');
        vi.stubEnv('NODE_ENV', 'test');

        const { oauthFlow, controlPlane, services } = createCoreServices();
        mocks.createCoreServices.mockReturnValue(services);
        mocks.startTenantRuntimeInternalServerFromEnv.mockResolvedValue(null);
        mocks.createMeshRouter.mockReturnValue((_req, _res, next) => next());
        mocks.registerApiRoutes.mockImplementation((app, registration) => {
            app.use(
                '/api/v1',
                registration.slackInstallationControlPlaneAuthMiddleware,
                createSlackInstallationControlPlaneRouter({
                    controlPlane: registration.slackInstallationControlPlane,
                    oauthFlow: registration.slackInstallationOAuthFlow,
                    appId: registration.slackInstallationControlPlaneAppId
                })
            );
        });

        try {
            await import('../../../server.js');

            const [app, registration] = mocks.registerApiRoutes.mock.calls[0];
            expect(registration).toEqual(expect.objectContaining({
                slackInstallationControlPlane: controlPlane,
                slackInstallationOAuthFlow: oauthFlow
            }));

            const response = await request(app)
                .get('/api/v1/slack-installations:callback')
                .query({ code: 'short-lived-code', state: 'signed' });

            expect(response.status).toBe(200);
            expect(oauthFlow.open).toHaveBeenCalledWith('signed');
            expect(controlPlane.exchange_and_register).toHaveBeenCalledWith({
                authorization_code: 'short-lived-code',
                redirect_uri: 'https://bb.unson.jp/api/v1/slack-installations:callback',
                intent: { installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV' }
            });
            await vi.waitFor(() => {
                expect(fs.existsSync(path.join(rootDir, 'var', '.brainbase-port'))).toBe(true);
            });
        } finally {
            const server = mocks.registerGracefulShutdown.mock.calls[0]?.[0]?.server;
            if (server?.listening) {
                await new Promise((resolve) => server.close(resolve));
            }
        }
    });
});
