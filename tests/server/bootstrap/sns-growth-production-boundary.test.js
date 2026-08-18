// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    registerApiRoutes,
    registerTenantRuntimeApiRoute
} from '../../../server/bootstrap/register-api-routes.js';
import { TenantAuthority } from '../../../server/services/multitenant/tenant-authority.js';
import { createTenantRuntimeServices } from '../../../server/services/multitenant/tenant-runtime-services.js';
import { WorkspaceConnectionRegistry } from '../../../server/services/multitenant/workspace-connection-registry.js';
import {
    postReviewPackToLedger,
    resolveSignedSnsTenantContext,
    resolveSnsTenantContextRequest,
    reviewPackToLedgerPayload
} from '../../../scripts/import-sns-review-pack-to-ledger.js';

// VibePro traceability: story-brainbase-multitenant-platform:AC-005.

const createdVarDirs = [];

function encodedHeader(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function bootstrapApp({ tenantRuntimeServices = null, authTenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV' } = {}) {
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
            tenantId: authTenantId,
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
        tenantRuntimeServices: tenantRuntimeServices ?? {
            tenantContextVerifier: vi.fn(async (envelope) => envelope),
            tenantBoundaryGateway: { authorize }
        },
        snsPostExecutor: postExecutor
    });
    return { app, authorize, postExecutor, varDir };
}

function createSignedRuntime() {
    const now = new Date('2026-08-18T00:01:00Z');
    const serviceToken = 'bbsvc_test_review_pack_importer';
    const tenantAuthority = new TenantAuthority({ now: () => now });
    const created = tenantAuthority.createTenant({ displayName: 'SNS Tenant' });
    const tenant = tenantAuthority.transitionTenant(created.tenant_id, created.tenant_revision, 'active');
    const connectionRegistry = new WorkspaceConnectionRegistry({ now: () => now });
    const connection = connectionRegistry.register({
        tenant_id: tenant.tenant_id,
        provider: 'slack',
        installation_id: 'installation-sns',
        workspace_id: 'workspace-sns',
        app_id: 'app-sns',
        granted_scopes: ['sns.review_pack.import'],
        credential_ref: 'credential-ref-sns',
        credential_mode: 'customer_oauth'
    });
    const authorize = vi.fn(async () => ({ authorized: true }));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const services = createTenantRuntimeServices({
        serviceToken,
        tenantAuthority,
        connectionRegistry,
        tenantBoundaryGateway: { authorize },
        resolveContractRevision: async () => '11',
        signingKey: {
            key_id: 'brainbase-test-key-1',
            private_key: privateKey,
            public_key: publicKey,
            status: 'current',
            not_before: '2026-08-17T00:00:00Z',
            expires_at: '2027-08-17T00:00:00Z'
        },
        audience: 'mana-runtime',
        deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
        deploymentProfile: 'shared_cloud',
        now: () => now
    });
    return { services, authorize, serviceToken, tenant, connection };
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
        const runtime = createSignedRuntime();
        const { app, postExecutor } = bootstrapApp({
            tenantRuntimeServices: runtime.services,
            authTenantId: runtime.tenant.tenant_id
        });
        registerTenantRuntimeApiRoute(app, runtime.services);
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
                    tenant_id: runtime.tenant.tenant_id,
                    tenant_revision: runtime.tenant.tenant_revision
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
            const env = {
                BRAINBASE_SNS_TENANT_ID: runtime.tenant.tenant_id,
                BRAINBASE_SNS_TENANT_REVISION: runtime.tenant.tenant_revision,
                BRAINBASE_SNS_CONNECTION_ID: runtime.connection.connection_id,
                BRAINBASE_SNS_CONNECTION_REVISION: runtime.connection.connection_revision,
                BRAINBASE_SNS_SERVICE_PRINCIPAL_ID: 'svc_sns_review_pack_importer',
                BRAINBASE_SNS_CHANNEL_ID: 'C0123456789',
                BRAINBASE_SNS_RESOURCE_OBJECT_TYPE: 'project',
                BRAINBASE_SNS_RESOURCE_ID: 'project_sns'
            };
            const contextRequest = resolveSnsTenantContextRequest(env, {
                correlationId: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
                operationId: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ'
            });
            const signedTenantContext = await resolveSignedSnsTenantContext({
                runtimeBaseUrl: `http://127.0.0.1:${address.port}`,
                request: contextRequest,
                serviceToken: runtime.serviceToken
            });
            const result = await postReviewPackToLedger({
                baseUrl: `http://127.0.0.1:${address.port}`,
                payload,
                tenantBoundary,
                signedTenantContext,
                serviceToken: runtime.serviceToken
            });

            expect(result.created).toHaveLength(1);
            expect(runtime.authorize).toHaveBeenCalledTimes(1);
            expect(runtime.authorize.mock.calls[0][0]).toMatchObject({
                entry_point: 'admin_api',
                tenant_context: {
                    integrity: {
                        method: 'jws_detached',
                        algorithm: 'EdDSA',
                        key_id: 'brainbase-test-key-1'
                    },
                    tenant: tenantBoundary.tenant_context.tenant,
                    workspace_connection: {
                        connection_id: runtime.connection.connection_id,
                        connection_revision: runtime.connection.connection_revision
                    }
                },
                resource_ref: tenantBoundary.resource_ref
            });
            expect(postExecutor).not.toHaveBeenCalled();
        } finally {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
    });

    it('rejects a tenant-id-only header with the production signature verifier', async () => {
        vi.stubEnv('BRAINBASE_TEST_MODE', 'true');
        vi.stubEnv('SNS_POSTING_LEDGER_MODE', 'json_test');
        vi.stubEnv('SNS_POSTING_LEDGER_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DATABASE_URL', '');
        vi.stubEnv('INFO_SSOT_DB_URL', '');
        vi.stubEnv('DATABASE_URL', '');
        const runtime = createSignedRuntime();
        const { app, postExecutor } = bootstrapApp({
            tenantRuntimeServices: runtime.services,
            authTenantId: runtime.tenant.tenant_id
        });

        const response = await request(app)
            .post('/api/sns-growth/review-pack')
            .set('Authorization', `Bearer ${runtime.serviceToken}`)
            .set('Brainbase-Tenant-Context', encodedHeader({
                tenant: {
                    tenant_id: runtime.tenant.tenant_id,
                    tenant_revision: runtime.tenant.tenant_revision
                }
            }))
            .set('Brainbase-Resource-Ref', encodedHeader({
                object_type: 'project',
                resource_id: 'project_sns'
            }))
            .send({ account_id: 'acc_x_sato', account_handle: '@AIBizNavigator', drafts: [] })
            .expect(400);

        expect(response.body).toMatchObject({ code: 'SCHEMA_INVALID' });
        expect(runtime.authorize).not.toHaveBeenCalled();
        expect(postExecutor).not.toHaveBeenCalled();
    });
});
