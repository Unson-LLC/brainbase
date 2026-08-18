// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerApiRoutes } from '../../../server/bootstrap/register-api-routes.js';
import {
    postReviewPackToLedger,
    reviewPackToLedgerPayload
} from '../../../scripts/import-sns-review-pack-to-ledger.js';

// VibePro traceability: story-brainbase-multitenant-platform:AC-005.

const createdVarDirs = [];

function encodedHeader(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function bootstrapApp() {
    const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-sns-boundary-'));
    createdVarDirs.push(varDir);
    const postExecutor = vi.fn(async () => ({
        success: true,
        url: 'https://x.com/i/web/status/2055000000000000001'
    }));
    const authorize = vi.fn(async () => ({ authorized: true }));
    const authService = {
        verifyServiceToken: vi.fn(() => ({
            sub: 'svc_sns_review_pack_importer',
            role: 'member',
            tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        })),
        verifyToken: vi.fn(() => ({
            sub: 'person_admin',
            role: 'ceo',
            tenantId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        }))
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
    return { app, authorize, postExecutor, varDir };
}

function tenantHeaders(req) {
    return req
        .set('Authorization', 'Bearer admin-token')
        .set('Brainbase-Tenant-Context', encodedHeader({
            tenant: {
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenant_revision: '7'
            }
        }))
        .set('Brainbase-Resource-Ref', encodedHeader({
            object_type: 'project',
            resource_id: 'project_sns'
        }));
}

afterEach(() => {
    vi.unstubAllEnvs();
    while (createdVarDirs.length > 0) {
        fs.rmSync(createdVarDirs.pop(), { recursive: true, force: true });
    }
});

describe('AC-005 SNS production bootstrap boundary', () => {
    it('rejects unauthenticated access before tenant, Ledger, or provider work', async () => {
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DB_URL', '');
        vi.stubEnv('DATABASE_URL', '');
        const { app, authorize, postExecutor } = bootstrapApp();

        await request(app)
            .post('/api/sns-growth/posts/sns_boundary_probe/publish')
            .send({ confirm_public_post: true })
            .expect(401);

        expect(authorize).not.toHaveBeenCalled();
        expect(postExecutor).not.toHaveBeenCalled();
    });

    it('rejects an authenticated request without tenant headers before Ledger or provider work', async () => {
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DB_URL', '');
        vi.stubEnv('DATABASE_URL', '');
        const { app, authorize, postExecutor } = bootstrapApp();

        const response = await request(app)
            .post('/api/sns-growth/posts/sns_boundary_probe/publish')
            .send({ confirm_public_post: true })
            .set('Authorization', 'Bearer admin-token')
            .expect(400);

        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
        expect(authorize).not.toHaveBeenCalled();
        expect(postExecutor).not.toHaveBeenCalled();
    });

    it('returns 503 without a production DB and creates neither a JSON Ledger nor provider side effects', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', '');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', '');
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DB_URL', '');
        vi.stubEnv('DATABASE_URL', '');
        const { app, authorize, postExecutor, varDir } = bootstrapApp();

        const response = await tenantHeaders(request(app)
            .post('/api/sns-growth/review-pack')
            .send({
                account_id: 'acc_x_sato',
                account_handle: '@AIBizNavigator',
                drafts: []
            }))
            .expect(503);

        expect(response.body).toMatchObject({ code: 'sns_posting_ledger_database_required' });
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(postExecutor).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(varDir, 'sns-posting-ledger.json'))).toBe(false);
    });

    it('accepts the production review-pack client only through service auth and canonical tenant headers', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', 'json_test');
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DB_URL', '');
        vi.stubEnv('DATABASE_URL', '');
        const { app, authorize, postExecutor } = bootstrapApp();
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('test server did not expose a TCP address');
        }
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                    tenant_revision: '7'
                }
            },
            resource_ref: {
                object_type: 'project',
                resource_id: 'project_sns'
            }
        };
        const payload = reviewPackToLedgerPayload({
            reviewPack: {
                date: '2026-08-18',
                posts: [{ slot: 'baseline_1', body: 'service auth経路の確認' }]
            }
        }, { tenantBoundary, requireTenantBoundary: true });

        try {
            const result = await postReviewPackToLedger({
                baseUrl: `http://127.0.0.1:${address.port}`,
                payload,
                tenantBoundary,
                serviceToken: 'bbsvc_test_review_pack_importer'
            });

            expect(result.created).toHaveLength(1);
            expect(authorize).toHaveBeenCalledTimes(1);
            expect(authorize.mock.calls[0][0]).toMatchObject({
                entry_point: 'admin_api',
                tenant_context: tenantBoundary.tenant_context,
                resource_ref: tenantBoundary.resource_ref
            });
            expect(postExecutor).not.toHaveBeenCalled();
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
    });
});
