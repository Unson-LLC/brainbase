import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runTenantProvisioningMigration } from '../../../../scripts/migrate-tenant-production-provisioning.js';
import { csrfMiddleware } from '../../../../server/middleware/csrf.js';
import { registerSlackInstallationControlPlaneApiRoute } from '../../../../server/bootstrap/register-api-routes.js';
import { createSlackInstallationControlPlaneFromEnv } from '../../../../server/bootstrap/slack-installation-control-plane.js';
import { SlackInstallationControlPlane } from '../../../../server/services/multitenant/slack-installation-control-plane.js';
import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';
import { ContractError } from '../../../../server/services/multitenant/errors.js';
import { SLACK_INSTALLATION_SERVICE_CAPABILITY } from '../../../../server/services/multitenant/slack-installation-auth.js';

const { Pool } = pg;

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantKey = 'unson-business';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const intentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const concurrentIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FB3';
const reinstallIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FB4';
const failedIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FB6';
const failedCredentialStoreIntentId = 'insi_01ARZ3NDEKTSV4RRFFQ69G5FB7';
const contractId = 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FB1';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FB2';
const appId = 'A0123456789';
const workspaceId = 'T0123456789';
const enterpriseId = 'E0123456789';
const installerId = 'U0123456789';
const reinstallAppId = 'A9876543210';
const reinstallWorkspaceId = 'T9876543210';
const reinstallEnterpriseId = 'E9876543210';
const reinstallInstallerId = 'U9876543210';
const composedAppId = 'A1111111111';
const composedWorkspaceId = 'T1111111111';
const composedEnterpriseId = 'E1111111111';
const composedInstallerId = 'U1111111111';
const now = new Date('2026-08-19T00:00:00.000Z');

describe.sequential('Slack installation control-plane PostgreSQL integration', () => {
    let container;
    let pool;
    let repository;
    let oauthClient;
    let credentialStore;
    let controlPlane;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        const baseSchema = await readFile(resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql'), 'utf8');
        await pool.query(baseSchema);

        // The production migration refuses to guess tenant keys. Seed the
        // explicit key before applying the additive provisioning migration.
        await pool.query('ALTER TABLE brainbase_tenants ADD COLUMN IF NOT EXISTS tenant_key TEXT');
        await pool.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_revision, tenant_key, status, display_name, created_at, updated_at
             ) VALUES ($1, 1, $2, 'active', 'Unson Business', $3, $3)`,
            [tenantId, tenantKey, now]
        );
        await runTenantProvisioningMigration({
            argv: ['--apply', '--approve-apply'],
            env: { BRAINBASE_MIGRATION_ACTOR: 'integration-test' },
            pool
        });
        await pool.query(
            `INSERT INTO tenant_contract_revisions (
                contract_id, contract_revision, tenant_id, tenant_revision_at_write,
                status, effective_from, effective_until, plan_code, allowances,
                thresholds_basis_points, overage_policy, hard_stop_basis_points,
                rate_card_revision, fx_table_revision, sales_price_revision
             ) VALUES ($1, 1, $2, 1, 'active', $3, NULL, 'mana-cloud', $4::jsonb,
                       ARRAY[8000,10000]::integer[], 'deny', 10000, 1, 1, 1)`,
            [contractId, tenantId, now, JSON.stringify({ monthly_messages: 1000 })]
        );
        await pool.query(
            `INSERT INTO tenant_contract_revision_runtime_bindings (
                tenant_id, contract_id, contract_revision, capabilities, audience,
                deployment_id, profile, created_at, updated_at
             ) VALUES ($1, $2, 1, $3, $4, $5, 'shared_cloud', $6, $6)`,
            [tenantId, contractId, ['send_message', 'create_task'], ['mana-runtime'], deploymentId, now]
        );

        repository = new MultitenantPostgresRepository({ pool, now: () => now });
        oauthClient = {
            exchangeCode: vi.fn(async () => ({
                app_id: appId,
                workspace_id: workspaceId,
                enterprise_id: enterpriseId,
                installer_id: installerId,
                installation_id: `slack:${appId}:${workspaceId}`,
                granted_scopes: ['chat:write', 'commands'],
                credential_material: 'xoxb-integration-secret',
                credential_refresh_material: 'xoxr-integration-secret'
            }))
        };
        credentialStore = {
            store: vi.fn(async () => ({
                credential_ref: 'vault://slack/unson-business/A0123456789/T0123456789',
                credential_mode: 'customer_oauth',
                refresh_revision: 1
            })),
            revoke: vi.fn()
        };
        controlPlane = new SlackInstallationControlPlane({
            repository,
            oauthClient,
            credentialStore,
            now: () => now,
            ttlSeconds: 600
        });
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('reads the active contract revision when the contract and runtime binding share column names', async () => {
        await expect(repository.loadContractRevision({ tenant_id: tenantId, contract_revision: '1' }))
            .resolves.toMatchObject({
                tenant_id: tenantId,
                contract_id: contractId,
                contract_revision: '1',
                runtime_binding: {
                    capabilities: ['send_message', 'create_task'],
                    audience: ['mana-runtime'],
                    deployment_id: deploymentId,
                    profile: 'shared_cloud'
                }
            });
    }, 120_000);

    it('writes and reads back the intent, connection revision, opaque credential and exchange ledger atomically', async () => {
        const intent = {
            installation_intent_id: intentId,
            tenant_id: tenantId,
            app_id: appId,
            expected_workspace_id: workspaceId,
            expected_enterprise_id: enterpriseId,
            initiated_by_person_id: personId
        };
        await controlPlane.authorizeBinding(intent);

        const result = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        expect(result).toMatchObject({
            tenant_id: tenantId,
            connection_revision: '1',
            workspace_id: workspaceId,
            app_id: appId,
            installer_id: installerId,
            deployment_id: deploymentId,
            profile: 'shared_cloud',
            contract_revision: '1',
            status: 'active'
        });
        expect(result).not.toHaveProperty('credential_material');
        expect(result).not.toHaveProperty('credential_ref');

        const dbRows = await pool.query(
            `SELECT wc.tenant_id, wc.connection_revision, wc.credential_ref,
                    wc.deployment_id, wc.profile, wc.contract_revision,
                    cbr.credential_mode, cbr.refresh_revision,
                    revision.connection_snapshot::text AS connection_snapshot,
                    ledger.status, ledger.response_payload::text AS response_payload,
                    intent.consumed_at
               FROM workspace_connections wc
               JOIN credential_broker_refs cbr
                 ON cbr.tenant_id = wc.tenant_id
                AND cbr.connection_id = wc.connection_id
                AND cbr.connection_revision = wc.connection_revision
               JOIN workspace_connection_revisions revision
                 ON revision.tenant_id = wc.tenant_id
                AND revision.connection_id = wc.connection_id
                AND revision.connection_revision = wc.connection_revision
               JOIN slack_installation_exchange_ledger ledger
                 ON ledger.tenant_id = wc.tenant_id
               JOIN slack_installation_intents intent
                 ON intent.tenant_id = wc.tenant_id
                AND intent.installation_intent_id = ledger.installation_intent_id
              WHERE wc.tenant_id = $1
                AND ledger.installation_intent_id = $2`,
            [tenantId, intentId]
        );
        expect(dbRows.rows).toHaveLength(1);
        const stored = dbRows.rows[0];
        expect(stored).toMatchObject({
            tenant_id: tenantId,
            connection_revision: '1',
            credential_ref: 'vault://slack/unson-business/A0123456789/T0123456789',
            deployment_id: deploymentId,
            profile: 'shared_cloud',
            contract_revision: '1',
            credential_mode: 'customer_oauth',
            refresh_revision: '1',
            status: 'completed'
        });
        expect(stored.consumed_at).not.toBeNull();
        expect(stored.connection_snapshot).not.toContain('xoxb-integration-secret');
        expect(stored.connection_snapshot).not.toContain('xoxr-integration-secret');
        expect(stored.response_payload).not.toContain('xoxb-integration-secret');
        expect(stored.response_payload).not.toContain('xoxr-integration-secret');

        // Exchange retries read the completed ledger before calling Slack or
        // the secret store, so one OAuth event has one registration effect.
        const replay = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-code-one',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        expect(replay).toEqual(result);
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
        expect(credentialStore.store).toHaveBeenCalledTimes(1);
        expect(await pool.query(
            'SELECT count(*)::integer AS count FROM slack_installation_exchange_ledger WHERE tenant_id = $1',
            [tenantId]
        )).toMatchObject({ rows: [{ count: 1 }] });
    }, 120_000);

    it('composes local bootstrap -> auth/CSRF -> authorize/exchange -> OAuth/credential adapter -> PostgreSQL failure readback (repository-level operator boundary)', async () => {
        const humanSecret = 'slack-installation-composed-human-secret';
        const serviceSecret = 'slack-installation-composed-service-secret';
        const serviceDeploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FB9';
        const serviceToken = `bbsvc_${jwt.sign({
            typ: 'service',
            issuer: 'brainbase',
            subject: 'svc_mana_slack_installation_composed',
            audience: 'mana-runtime',
            deployment_id: serviceDeploymentId,
            expires_at: '2030-01-01T00:00:00.000Z',
            capabilities: [SLACK_INSTALLATION_SERVICE_CAPABILITY]
        }, serviceSecret)}`;
        const env = {
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: serviceToken,
            BRAINBASE_SERVICE_TOKEN_SECRET: serviceSecret,
            BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID: serviceDeploymentId,
            BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://secrets.example.test/v1/credentials',
            BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'credential-store-token'
        };
        const authService = {
            slackClientId: composedAppId,
            slackClientSecret: 'oauth-client-secret-local-only',
            tokenUrl: 'https://slack.example.test/api/oauth.v2.access',
            slackMode: 'oauth',
            verifyToken: (token) => jwt.verify(token, humanSecret)
        };
        const fetchImpl = vi.fn(async (url, init) => {
            if (url === authService.tokenUrl) {
                const body = new URLSearchParams(init.body);
                expect(body.get('code')).toBe('oauth-composed-code');
                expect(body.get('client_id')).toBe(composedAppId);
                return Response.json({
                    ok: true,
                    api_app_id: composedAppId,
                    team: { id: composedWorkspaceId },
                    enterprise: { id: composedEnterpriseId },
                    authed_user: { id: composedInstallerId },
                    scope: 'chat:write,commands',
                    access_token: 'xoxb-composed-secret',
                    refresh_token: 'xoxr-composed-secret'
                });
            }
            throw new Error('credential-store-network-secret');
        });
        const previousProcessEnv = new Map([
            ...Object.keys(env),
            'BRAINBASE_JWT_SECRET',
            'NODE_ENV'
        ].map((key) => [key, process.env[key]]));

        try {
            process.env.NODE_ENV = 'production';
            process.env.BRAINBASE_JWT_SECRET = humanSecret;
            for (const [key, value] of Object.entries(env)) process.env[key] = value;

            // Build the route from the production bootstrap so this one path
            // exercises the real OAuth and credential-store adapters.
            const runtime = createSlackInstallationControlPlaneFromEnv({
                pool,
                authService,
                env,
                now: () => now,
                fetchImpl
            });
            expect(runtime).toMatchObject({ ready: true, reason: null, appId: composedAppId });

            const app = express();
            app.use(express.json());
            app.use(csrfMiddleware());
            registerSlackInstallationControlPlaneApiRoute(app, {
                controlPlane: runtime.controlPlane,
                authMiddleware: runtime.authMiddleware,
                appId: runtime.appId,
                resolvePreProvisionedConnection: runtime.resolvePreProvisionedConnection,
                authEnv: env,
                authNow: () => now
            });

            const humanToken = jwt.sign({
                typ: 'user',
                sub: personId,
                role: 'tenant_admin',
                organizationId: tenantId,
                projectCodes: ['mana'],
                clearance: ['internal']
            }, humanSecret, { expiresIn: '10m' });
            const authorizeResponse = await request(app)
                .post('/api/v1/slack-installations:authorize')
                .set('Authorization', `Bearer ${humanToken}`)
                .send({
                    app_id: composedAppId,
                    expected_workspace_id: composedWorkspaceId,
                    expected_enterprise_id: composedEnterpriseId
                });
            expect(authorizeResponse.status).toBe(200);
            const intent = authorizeResponse.body.result;
            expect(intent).toMatchObject({
                installation_intent_id: expect.any(String),
                tenant_id: tenantId,
                app_id: composedAppId,
                expected_workspace_id: composedWorkspaceId,
                expected_enterprise_id: composedEnterpriseId,
                initiated_by_person_id: personId
            });

            const exchangeResponse = await request(app)
                .post('/api/v1/slack-installations:exchange-and-register')
                .set('Authorization', `Bearer ${serviceToken}`)
                .send({
                    authorization_code: 'oauth-composed-code',
                    redirect_uri: 'https://mana.example.test/oauth/slack/composed-callback',
                    intent
                });
            expect(exchangeResponse.status).toBe(503);
            expect(exchangeResponse.body).toEqual({
                error: { code: 'UPSTREAM_UNAVAILABLE', retryable: true, fault_domain: 'brainbase_cloud' }
            });
            expect(JSON.stringify(exchangeResponse.body)).not.toContain('xoxb-composed-secret');
            expect(fetchImpl).toHaveBeenCalledTimes(2);
            expect(fetchImpl.mock.calls[1][0]).toContain('/v1/credentials');

            // Repository-level diagnostic readback is the current operator
            // acceptance boundary; no public diagnostic API or UI is added.
            await expect(repository.readSlackInstallationFailureDiagnostic({
                tenant_id: tenantId,
                installation_intent_id: intent.installation_intent_id
            })).resolves.toMatchObject({
                tenant_id: tenantId,
                installation_intent_id: intent.installation_intent_id,
                attempt: 1,
                failure_stage: 'credential_store',
                failure_code: 'CREDENTIAL_STORE_UNAVAILABLE',
                cleanup_status: 'not_needed'
            });
        } finally {
            for (const [key, value] of previousProcessEnv) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    }, 120_000);

    it('composes dedicated bootstrap -> human authorize -> signed HTTPS callback -> OAuth/store -> PostgreSQL readback', async () => {
        const humanSecret = 'slack-installation-success-human-secret';
        const serviceSecret = 'slack-installation-success-service-secret';
        const dedicatedAppId = 'A2222222222';
        const dedicatedWorkspaceId = 'T2222222222';
        const dedicatedInstallerId = 'U2222222222';
        const redirectUri = 'https://bb.unson.jp/api/v1/slack-installations:callback';
        const env = {
            BRAINBASE_SLACK_INSTALLATION_APP_ID: dedicatedAppId,
            BRAINBASE_SLACK_INSTALLATION_CLIENT_ID: 'dedicated-client-id',
            BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET: 'dedicated-client-secret',
            BRAINBASE_SLACK_INSTALLATION_REDIRECT_URI: redirectUri,
            BRAINBASE_SLACK_INSTALLATION_STATE_SECRET: 'dedicated-state-secret-long-enough-for-tests',
            BRAINBASE_SLACK_INSTALLATION_BOT_SCOPES: 'chat:write,commands',
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: 'bbsvc_not-used-by-browser-callback',
            BRAINBASE_SERVICE_TOKEN_SECRET: serviceSecret,
            BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID: 'dep_01ARZ3NDEKTSV4RRFFQ69FB8',
            BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://secrets.example.test/v1/credentials',
            BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'credential-store-token'
        };
        const authService = {
            slackClientId: 'login-client-id-must-not-be-used',
            slackClientSecret: 'login-client-secret-must-not-be-used',
            tokenUrl: 'https://slack.example.test/api/oauth.v2.access',
            slackMode: 'oauth',
            verifyToken: (token) => jwt.verify(token, humanSecret)
        };
        const fetchImpl = vi.fn(async (url, init) => {
            if (url === authService.tokenUrl) {
                const body = new URLSearchParams(init.body);
                expect(body.get('client_id')).toBe('dedicated-client-id');
                expect(body.get('client_secret')).toBe('dedicated-client-secret');
                expect(body.get('redirect_uri')).toBe(redirectUri);
                return Response.json({
                    ok: true,
                    api_app_id: dedicatedAppId,
                    team: { id: dedicatedWorkspaceId },
                    authed_user: { id: dedicatedInstallerId },
                    scope: 'chat:write,commands',
                    access_token: 'xoxb-dedicated-secret'
                });
            }
            if (url === env.BRAINBASE_SLACK_CREDENTIAL_STORE_URL) {
                expect(init.headers.authorization).toBe('Bearer credential-store-token');
                const body = JSON.parse(init.body);
                expect(body.credential_material).toBe('xoxb-dedicated-secret');
                return Response.json({ result: {
                    credential_ref: 'credref://techknight/slack/primary',
                    credential_mode: 'customer_oauth',
                    refresh_revision: 1
                } });
            }
            throw new Error('unexpected URL');
        });
        const previousProcessEnv = new Map([
            ...Object.keys(env),
            'BRAINBASE_JWT_SECRET',
            'NODE_ENV'
        ].map((key) => [key, process.env[key]]));

        try {
            process.env.NODE_ENV = 'production';
            process.env.BRAINBASE_JWT_SECRET = humanSecret;
            for (const [key, value] of Object.entries(env)) process.env[key] = value;
            const runtime = createSlackInstallationControlPlaneFromEnv({
                pool,
                authService,
                env,
                now: () => now,
                fetchImpl
            });
            expect(runtime).toMatchObject({ ready: true, appId: dedicatedAppId });

            const app = express();
            app.use(express.json());
            app.use(csrfMiddleware());
            registerSlackInstallationControlPlaneApiRoute(app, {
                controlPlane: runtime.controlPlane,
                authMiddleware: runtime.authMiddleware,
                appId: runtime.appId,
                oauthFlow: runtime.oauthFlow
            });
            const humanToken = jwt.sign({
                typ: 'user',
                sub: personId,
                role: 'tenant_admin',
                organizationId: tenantId,
                projectCodes: ['mana'],
                clearance: ['internal']
            }, humanSecret, { expiresIn: '10m' });
            const authorizeResponse = await request(app)
                .post('/api/v1/slack-installations:authorize')
                .set('Authorization', `Bearer ${humanToken}`)
                .send({ app_id: dedicatedAppId, expected_workspace_id: dedicatedWorkspaceId });
            expect(authorizeResponse.status).toBe(200);
            const authorizationUrl = new URL(authorizeResponse.body.result.authorization_url);
            const signedState = authorizationUrl.searchParams.get('state');
            const tamperedState = `${signedState.slice(0, -1)}${signedState.endsWith('a') ? 'b' : 'a'}`;

            const tamperedCallbackResponse = await request(app)
                .get('/api/v1/slack-installations:callback')
                .query({ code: 'must-not-be-exchanged', state: tamperedState });
            expect(tamperedCallbackResponse.status).toBe(400);
            expect(tamperedCallbackResponse.body).toEqual({
                error: { code: 'INSTALLATION_STATE_INVALID', retryable: false, fault_domain: 'protocol' }
            });
            expect(fetchImpl).not.toHaveBeenCalled();

            const beforeExchange = await pool.query(
                `SELECT (SELECT count(*)::int FROM workspace_connections
                          WHERE tenant_id = $1 AND workspace_id = $2) AS connection_count,
                        consumed_at
                   FROM slack_installation_intents
                  WHERE tenant_id = $1 AND installation_intent_id = $3`,
                [tenantId, dedicatedWorkspaceId, authorizeResponse.body.result.installation_intent_id]
            );
            expect(beforeExchange.rows).toEqual([{
                connection_count: 0,
                consumed_at: null
            }]);

            const callbackResponse = await request(app)
                .get('/api/v1/slack-installations:callback')
                .query({ code: 'dedicated-one-time-code', state: signedState });
            expect(callbackResponse.status).toBe(200);
            expect(callbackResponse.text).not.toContain('dedicated-one-time-code');
            expect(fetchImpl).toHaveBeenCalledTimes(2);

            const duplicateCallbackResponse = await request(app)
                .get('/api/v1/slack-installations:callback')
                .query({ code: 'dedicated-one-time-code', state: signedState });
            expect(duplicateCallbackResponse.status).toBe(200);
            expect(duplicateCallbackResponse.text).not.toContain('dedicated-one-time-code');
            expect(fetchImpl).toHaveBeenCalledTimes(2);

            const stored = await pool.query(
                `SELECT wc.tenant_id, wc.workspace_id, wc.app_id, wc.credential_ref,
                        ledger.status, intent.consumed_at
                   FROM workspace_connections wc
                   JOIN slack_installation_exchange_ledger ledger
                     ON ledger.tenant_id = wc.tenant_id
                    AND ledger.connection_id = wc.connection_id
                   JOIN slack_installation_intents intent
                     ON intent.tenant_id = ledger.tenant_id
                    AND intent.installation_intent_id = ledger.installation_intent_id
                  WHERE wc.tenant_id = $1 AND wc.workspace_id = $2`,
                [tenantId, dedicatedWorkspaceId]
            );
            expect(stored.rows).toEqual([expect.objectContaining({
                tenant_id: tenantId,
                workspace_id: dedicatedWorkspaceId,
                app_id: dedicatedAppId,
                credential_ref: 'credref://techknight/slack/primary',
                status: 'completed',
                consumed_at: expect.any(Date)
            })]);
        } finally {
            for (const [key, value] of previousProcessEnv) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    }, 120_000);

    it('writes and reads a bounded failed diagnostic without retaining claim or response data', async () => {
        const intent = {
            installation_intent_id: failedIntentId,
            tenant_id: tenantId,
            app_id: appId,
            expected_workspace_id: workspaceId,
            expected_enterprise_id: enterpriseId,
            initiated_by_person_id: personId
        };
        await controlPlane.authorizeBinding(intent);
        oauthClient.exchangeCode.mockRejectedValueOnce(
            new ContractError('CREDENTIAL_STORE_UNAVAILABLE', { status: 503 })
        );

        await expect(controlPlane.exchange_and_register({
            authorization_code: 'oauth-failure-code',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        })).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNAVAILABLE' });

        await expect(repository.readSlackInstallationFailureDiagnostic({
            tenant_id: tenantId,
            installation_intent_id: failedIntentId
        })).resolves.toMatchObject({
            tenant_id: tenantId,
            installation_intent_id: failedIntentId,
            attempt: 1,
            failure_stage: 'oauth_exchange',
            failure_code: 'OAUTH_EXCHANGE_FAILED',
            cleanup_status: 'not_needed'
        });

        const { rows: [ledger] } = await pool.query(
            `SELECT status, failure_stage, failure_code, cleanup_status,
                    claim_token_hash, response_payload, connection_id, connection_revision
               FROM slack_installation_exchange_ledger
              WHERE tenant_id = $1 AND installation_intent_id = $2`,
            [tenantId, failedIntentId]
        );
        expect(ledger).toEqual(expect.objectContaining({
            status: 'failed',
            failure_stage: 'oauth_exchange',
            failure_code: 'OAUTH_EXCHANGE_FAILED',
            cleanup_status: 'not_needed',
            claim_token_hash: null,
            response_payload: null,
            connection_id: null,
            connection_revision: null
        }));
    }, 120_000);

    it('records cleanup as not needed when credential storage fails before returning a reference', async () => {
        const intent = {
            installation_intent_id: failedCredentialStoreIntentId,
            tenant_id: tenantId,
            app_id: appId,
            expected_workspace_id: workspaceId,
            expected_enterprise_id: enterpriseId,
            initiated_by_person_id: personId,
            expected_connection_revision: '1'
        };
        const failingCredentialStore = {
            store: vi.fn(async () => { throw new Error('credential store unavailable'); }),
            revoke: vi.fn()
        };
        const failingControlPlane = new SlackInstallationControlPlane({
            repository,
            oauthClient,
            credentialStore: failingCredentialStore,
            now: () => now,
            ttlSeconds: 600
        });
        await failingControlPlane.authorizeBinding(intent);

        await expect(failingControlPlane.exchange_and_register({
            authorization_code: 'oauth-credential-store-failure-code',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        })).rejects.toThrow('credential store unavailable');
        expect(failingCredentialStore.revoke).not.toHaveBeenCalled();

        await expect(repository.readSlackInstallationFailureDiagnostic({
            tenant_id: tenantId,
            installation_intent_id: failedCredentialStoreIntentId
        })).resolves.toMatchObject({
            failure_stage: 'credential_store',
            failure_code: 'CREDENTIAL_STORE_FAILED',
            cleanup_status: 'not_needed'
        });
    }, 120_000);

    it('claims concurrent callbacks before OAuth so only one external exchange and registration occur', async () => {
        const intent = {
            installation_intent_id: concurrentIntentId,
            tenant_id: tenantId,
            app_id: appId,
            expected_workspace_id: workspaceId,
            expected_enterprise_id: enterpriseId,
            initiated_by_person_id: personId,
            expected_connection_revision: '1'
        };
        await controlPlane.authorizeBinding(intent);

        let resolveOauthStarted;
        let releaseOauth;
        const oauthStarted = new Promise((resolveStarted) => { resolveOauthStarted = resolveStarted; });
        const oauthGate = new Promise((resolveRelease) => { releaseOauth = resolveRelease; });
        oauthClient.exchangeCode.mockImplementationOnce(async () => {
            resolveOauthStarted();
            await oauthGate;
            return {
                app_id: appId,
                workspace_id: workspaceId,
                enterprise_id: enterpriseId,
                installer_id: installerId,
                installation_id: `slack:${appId}:${workspaceId}:concurrent`,
                granted_scopes: ['chat:write', 'commands'],
                credential_material: 'xoxb-concurrent-secret',
                credential_refresh_material: 'xoxr-concurrent-secret'
            };
        });
        credentialStore.store.mockResolvedValue({
            credential_ref: 'vault://slack/unson-business/concurrent',
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        });
        oauthClient.exchangeCode.mockClear();
        credentialStore.store.mockClear();

        const first = controlPlane.exchange_and_register({
            authorization_code: 'oauth-concurrent-one',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        await oauthStarted;
        const second = controlPlane.exchange_and_register({
            authorization_code: 'oauth-concurrent-two',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent
        });
        await expect(second).rejects.toMatchObject({ code: 'INSTALLATION_IN_PROGRESS', retryable: true });
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
        expect(credentialStore.store).not.toHaveBeenCalled();

        releaseOauth();
        await expect(first).resolves.toMatchObject({
            tenant_id: tenantId,
            connection_revision: '2',
            status: 'active'
        });
        expect(oauthClient.exchangeCode).toHaveBeenCalledTimes(1);
        expect(credentialStore.store).toHaveBeenCalledTimes(1);
        const ledger = await pool.query(
            `SELECT status, attempt, connection_revision
               FROM slack_installation_exchange_ledger
              WHERE tenant_id = $1 AND installation_intent_id = $2`,
            [tenantId, concurrentIntentId]
        );
        expect(ledger.rows).toEqual([{ status: 'completed', attempt: '1', connection_revision: '2' }]);
    }, 120_000);

    it('passes the reserved canonical connection identity and next revision to the credential store on reinstall', async () => {
        const initialIntent = {
            installation_intent_id: reinstallIntentId,
            tenant_id: tenantId,
            app_id: reinstallAppId,
            expected_workspace_id: reinstallWorkspaceId,
            expected_enterprise_id: reinstallEnterpriseId,
            initiated_by_person_id: personId
        };
        await controlPlane.authorizeBinding(initialIntent);

        oauthClient.exchangeCode.mockReset();
        oauthClient.exchangeCode.mockResolvedValueOnce({
            app_id: reinstallAppId,
            workspace_id: reinstallWorkspaceId,
            enterprise_id: reinstallEnterpriseId,
            installer_id: reinstallInstallerId,
            installation_id: `slack:${reinstallAppId}:${reinstallWorkspaceId}:initial`,
            granted_scopes: ['chat:write', 'commands'],
            credential_material: 'xoxb-reinstall-initial-secret',
            credential_refresh_material: 'xoxr-reinstall-initial-secret'
        });
        credentialStore.store.mockReset();
        credentialStore.store.mockResolvedValueOnce({
            credential_ref: 'vault://slack/unson-business/reinstall-initial',
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        });

        const initial = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-reinstall-initial',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent: initialIntent
        });
        const initialStoreInput = credentialStore.store.mock.calls[0][0];
        expect(initialStoreInput).toMatchObject({
            connection_id: initial.connection_id,
            connection_revision: '1'
        });

        const reinstallIntent = {
            ...initialIntent,
            installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FB5',
            expected_connection_revision: '1'
        };
        await controlPlane.authorizeBinding(reinstallIntent);
        oauthClient.exchangeCode.mockResolvedValueOnce({
            app_id: reinstallAppId,
            workspace_id: reinstallWorkspaceId,
            enterprise_id: reinstallEnterpriseId,
            installer_id: reinstallInstallerId,
            installation_id: `slack:${reinstallAppId}:${reinstallWorkspaceId}:reinstall`,
            granted_scopes: ['chat:write', 'commands', 'files:read'],
            credential_material: 'xoxb-reinstall-next-secret',
            credential_refresh_material: 'xoxr-reinstall-next-secret'
        });
        credentialStore.store.mockResolvedValueOnce({
            credential_ref: 'vault://slack/unson-business/reinstall-next',
            credential_mode: 'customer_oauth',
            refresh_revision: 2
        });

        const reinstall = await controlPlane.exchange_and_register({
            authorization_code: 'oauth-reinstall-next',
            redirect_uri: 'https://mana.example.test/oauth/slack/callback',
            intent: reinstallIntent
        });
        const reinstallStoreInput = credentialStore.store.mock.calls[1][0];
        expect(reinstall).toMatchObject({
            connection_id: initial.connection_id,
            connection_revision: '2',
            workspace_id: reinstallWorkspaceId,
            app_id: reinstallAppId
        });
        expect(reinstallStoreInput).toMatchObject({
            connection_id: initial.connection_id,
            connection_revision: '2'
        });

        const current = await pool.query(
            `SELECT wc.connection_id, wc.connection_revision, wc.credential_ref,
                    cbr.connection_id AS broker_connection_id,
                    cbr.connection_revision AS broker_connection_revision,
                    revision.connection_snapshot->>'connection_id' AS snapshot_connection_id,
                    revision.connection_snapshot->>'connection_revision' AS snapshot_connection_revision
               FROM workspace_connections wc
               JOIN credential_broker_refs cbr
                 ON cbr.tenant_id = wc.tenant_id
                AND cbr.connection_id = wc.connection_id
                AND cbr.connection_revision = wc.connection_revision
               JOIN workspace_connection_revisions revision
                 ON revision.tenant_id = wc.tenant_id
                AND revision.connection_id = wc.connection_id
                AND revision.connection_revision = wc.connection_revision
              WHERE wc.tenant_id = $1 AND wc.workspace_id = $2 AND wc.app_id = $3`,
            [tenantId, reinstallWorkspaceId, reinstallAppId]
        );
        expect(current.rows).toEqual([{
            connection_id: initial.connection_id,
            connection_revision: '2',
            credential_ref: 'vault://slack/unson-business/reinstall-next',
            broker_connection_id: initial.connection_id,
            broker_connection_revision: '2',
            snapshot_connection_id: initial.connection_id,
            snapshot_connection_revision: '2'
        }]);
    }, 120_000);
});
