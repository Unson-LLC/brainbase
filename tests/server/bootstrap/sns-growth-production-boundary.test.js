// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';

const pgPool = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
    default: { Pool: pgPool },
    Pool: pgPool
}));

const createdVarDirs = [];

function bootstrapApp() {
    const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-retired-sns-'));
    createdVarDirs.push(varDir);
    const postExecutor = vi.fn();
    const authorize = vi.fn();
    const authService = {
        verifyServiceToken: vi.fn(),
        verifyToken: vi.fn()
    };
    const app = express();
    app.use(express.json());
    registerApiRoutes(app, {
        configParser: {},
        configService: {},
        runtimePaths: { varDir },
        scheduleParser: {},
        googleCalendarService: {},
        projectsRoot: varDir,
        authService,
        infoSSOTService: {},
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
        tenantRuntimeServices: {
            tenantContextVerifier: vi.fn(async (envelope) => envelope),
            tenantBoundaryGateway: { authorize }
        },
        snsPostExecutor: postExecutor
    });
    return { app, authService, authorize, postExecutor, varDir };
}

afterEach(() => {
    vi.unstubAllEnvs();
    while (createdVarDirs.length > 0) {
        fs.rmSync(createdVarDirs.pop(), { recursive: true, force: true });
    }
});

describe('retired SNS production bootstrap boundary', () => {
    it('returns 410 for read and write operations without authentication', async () => {
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', 'postgres://retired-sns-must-not-connect');
        pgPool.mockClear();
        const { app, authService, authorize, postExecutor } = bootstrapApp();

        const readResponse = await request(app)
            .get('/api/sns-growth')
            .expect(410);
        const publishResponse = await request(app)
            .post('/api/sns-growth/posts/retired_probe/publish')
            .send({ confirm_public_post: true })
            .expect(410);
        const reviewPackResponse = await request(app)
            .post('/api/sns-growth/review-pack')
            .send({ account_id: 'acc_retired', drafts: [] })
            .expect(410);

        for (const response of [readResponse, publishResponse, reviewPackResponse]) {
            expect(response.body).toMatchObject({
                error: 'capability_retired',
                capability: 'brainbase.sns-growth'
            });
        }
        expect(authService.verifyToken).not.toHaveBeenCalled();
        expect(authService.verifyServiceToken).not.toHaveBeenCalled();
        expect(authorize).not.toHaveBeenCalled();
        expect(postExecutor).not.toHaveBeenCalled();
        expect(pgPool).not.toHaveBeenCalled();
    });

    it('does not create the legacy JSON ledger when the retired route is called', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', 'json_test');
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        const { app, varDir } = bootstrapApp();

        await request(app)
            .post('/api/sns-growth/review-pack')
            .send({ account_id: 'acc_retired', drafts: [] })
            .expect(410);

        expect(fs.existsSync(path.join(varDir, 'sns-posting-ledger.json'))).toBe(false);
    });
});
