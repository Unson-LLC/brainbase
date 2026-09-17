import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerApiRoutes: vi.fn(),
    registerPersonalKnowledgePreAuth: vi.fn(),
    registerStaticRoutes: vi.fn(),
    registerGracefulShutdown: vi.fn(),
    startTenantRuntimeInternalServerFromEnv: vi.fn(),
    loadRuntimeEnv: vi.fn(),
    createMeshRouter: vi.fn()
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

function configureServerEnvironment(rootDir, { enabled }) {
    vi.stubEnv('BRAINBASE_ROOT', rootDir);
    vi.stubEnv('BRAINBASE_VAR_DIR', path.join(rootDir, 'var'));
    vi.stubEnv('PROJECTS_ROOT', path.join(rootDir, 'projects'));
    vi.stubEnv('CODEX_PATH', rootDir);
    vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
    vi.stubEnv('BRAINBASE_ALLOW_DIRECT_SERVER', '1');
    vi.stubEnv('BRAINBASE_E2E_PORT', '0');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CANONICAL_TASK_ID_SECRET', 'fixture-secret');
    vi.stubEnv('BRAINBASE_PROJECT_CATALOG_MODE', 'disabled');
    vi.stubEnv('BRAINBASE_KNOWLEDGE_BEDROCK_ENABLED', enabled ? '1' : '');
    vi.stubEnv('BRAINBASE_KNOWLEDGE_BEDROCK_MODEL_ID', enabled ? 'fixture-model' : '');
}

async function closeStartedServer() {
    const server = mocks.registerGracefulShutdown.mock.calls[0]?.[0]?.server;
    if (server?.listening) {
        await new Promise((resolve) => server.close(resolve));
    }
}

afterEach(async () => {
    await closeStartedServer();
    vi.resetModules();
    vi.unstubAllEnvs();
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

describe('server Knowledge Bedrock composition', () => {
    it('passes the configured concrete adapter from core services into API registration', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-server-bedrock-wiring-'));
        createdDirectories.push(rootDir);
        configureServerEnvironment(rootDir, { enabled: true });
        mocks.startTenantRuntimeInternalServerFromEnv.mockResolvedValue(null);
        mocks.createMeshRouter.mockReturnValue((_req, _res, next) => next());

        await import('../../../server.js?knowledge-bedrock-configured');

        const registration = mocks.registerApiRoutes.mock.calls[0]?.[1];
        expect(registration?.knowledgeBedrockAdapter).toEqual(expect.objectContaining({
            proposeCapture: expect.any(Function),
            preview: expect.any(Function)
        }));
    });

    it('passes no adapter when production Bedrock opt-in and model configuration are absent', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-server-bedrock-wiring-'));
        createdDirectories.push(rootDir);
        configureServerEnvironment(rootDir, { enabled: false });
        mocks.startTenantRuntimeInternalServerFromEnv.mockResolvedValue(null);
        mocks.createMeshRouter.mockReturnValue((_req, _res, next) => next());

        await import('../../../server.js?knowledge-bedrock-unconfigured');

        const registration = mocks.registerApiRoutes.mock.calls[0]?.[1];
        expect(registration?.knowledgeBedrockAdapter).toBeNull();
    });
});
