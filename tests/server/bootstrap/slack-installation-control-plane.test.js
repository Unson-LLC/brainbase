import { describe, expect, it, vi } from 'vitest';

import {
    createCredentialStore,
    createSlackInstallationControlPlaneFromEnv,
    createSlackOAuthClient
} from '../../../server/bootstrap/slack-installation-control-plane.js';

const appId = 'A0123456789';
const serviceToken = 'bbsvc_dedicated-service-token';

function authService() {
    return {
        slackClientId: appId,
        slackClientSecret: 'oauth-client-secret-not-a-production-value',
        tokenUrl: 'https://slack.example.test/api/oauth.v2.access',
        slackMode: 'oauth'
    };
}

describe('Slack installation control-plane production adapters', () => {
    it.each([
        ['network failure', async () => { throw new Error('secret network detail'); }, 'OAUTH_EXCHANGE_UNAVAILABLE'],
        ['invalid JSON', async () => new Response('not-json', { status: 200 }), 'OAUTH_EXCHANGE_INVALID'],
        ['provider rejection', async () => Response.json({ ok: false, error: 'invalid_code' }, { status: 400 }), 'OAUTH_EXCHANGE_REJECTED'],
        ['missing credential', async () => Response.json({ ok: true, api_app_id: appId }), 'OAUTH_CREDENTIAL_MISSING']
    ])('classifies %s with a stable non-secret OAuth code', async (_name, fetchImpl, code) => {
        const client = createSlackOAuthClient({ authService: authService(), fetchImpl });
        const exchange = () => client.exchangeCode({
            authorization_code: 'one-time-code',
            redirect_uri: 'https://mana.example.test/callback'
        });
        await expect(exchange()).rejects.toMatchObject({ code });
        await expect(exchange()).rejects.not.toThrow(/one-time-code|invalid_code|secret network detail/u);
    });

    it('normalizes Slack OAuth response without exposing token material in errors', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            const body = new URLSearchParams(init.body);
            expect(body.get('client_id')).toBe(appId);
            expect(body.get('client_secret')).toBe('oauth-client-secret-not-a-production-value');
            expect(body.get('code')).toBe('one-time-code');
            return new Response(JSON.stringify({
                ok: true,
                api_app_id: appId,
                team: { id: 'T0123456789' },
                enterprise: { id: 'E0123456789' },
                authed_user: { id: 'U0123456789' },
                scope: 'chat:write,commands',
                access_token: 'xoxb-secret-token',
                refresh_token: 'xoxe-refresh-secret'
            }), { status: 200 });
        });
        const client = createSlackOAuthClient({ authService: authService(), fetchImpl });
        const result = await client.exchangeCode({
            authorization_code: 'one-time-code',
            redirect_uri: 'https://mana.example.test/callback'
        });

        expect(result).toMatchObject({
            app_id: appId,
            workspace_id: 'T0123456789',
            enterprise_id: 'E0123456789',
            installer_id: 'U0123456789',
            credential_material: 'xoxb-secret-token',
            credential_refresh_material: 'xoxe-refresh-secret'
        });
        expect(result.granted_scopes).toBe('chat:write,commands');
    });

    it('uses the dedicated secret-boundary HTTP port and keeps credential operations opaque', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.headers.authorization).toBe('Bearer credential-store-token');
            const body = JSON.parse(init.body);
            expect(body.operation).toBe('store');
            expect(body.credential_material).toBe('raw-token-only-inside-port');
            return Response.json({ result: {
                credential_ref: 'credref://slack/opaque-1',
                credential_mode: 'customer_oauth',
                refresh_revision: 1
            } });
        });
        const store = createCredentialStore({
            env: {
                BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://secrets.example.test/v1/credentials',
                BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'credential-store-token'
            },
            fetchImpl
        });
        await expect(store.store({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
            credential_material: 'raw-token-only-inside-port'
        })).resolves.toMatchObject({ credential_ref: 'credref://slack/opaque-1' });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('exposes only opaque canonical credential verification through the secret boundary', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.headers.authorization).toBe('Bearer credential-store-token');
            const body = JSON.parse(init.body);
            expect(body).toEqual({
                operation: 'verify',
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenant_key: 'unson-business',
                credential_ref: 'credref://unson-business/slack/primary',
                provider: 'slack',
                workspace_id: 'T0123456789',
                app_id: appId
            });
            return Response.json({ result: {
                valid: true,
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenant_key: 'unson-business',
                credential_ref: 'credref://unson-business/slack/primary',
                provider: 'slack',
                workspace_id: 'T0123456789',
                app_id: appId
            } });
        });
        const store = createCredentialStore({
            env: {
                BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://secrets.example.test/v1/credentials',
                BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'credential-store-token'
            },
            fetchImpl
        });

        await expect(store.verify({
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            tenant_key: 'unson-business',
            credential_ref: 'credref://unson-business/slack/primary',
            provider: 'slack',
            workspace_id: 'T0123456789',
            app_id: appId
        })).resolves.toMatchObject({ valid: true });
    });

    it('registers a fail-closed control-plane route when production ports are missing', async () => {
        const runtime = createSlackInstallationControlPlaneFromEnv({
            pool: null,
            authService: authService(),
            env: {}
        });
        expect(runtime.ready).toBe(false);
        await expect(runtime.controlPlane.exchange_and_register({})).rejects.toMatchObject({
            code: 'UPSTREAM_UNAVAILABLE',
            status: 503,
            retryable: true
        });
    });

    it('constructs the real control-plane ports only with database, OAuth and credential-store configuration', () => {
        const runtime = createSlackInstallationControlPlaneFromEnv({
            pool: { connect: vi.fn() },
            authService: authService(),
            env: {
                BRAINBASE_SLACK_INSTALLATION_APP_ID: appId,
                BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: serviceToken,
                BRAINBASE_SERVICE_TOKEN_SECRET: 'service-signing-secret',
                BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID: 'dep_01ARZ3NDEKTSV4RRFFQ69FAZ',
                BRAINBASE_SLACK_CREDENTIAL_STORE_URL: 'https://secrets.example.test/v1/credentials',
                BRAINBASE_SLACK_CREDENTIAL_STORE_TOKEN: 'credential-store-token'
            },
            fetchImpl: vi.fn()
        });
        expect(runtime.ready).toBe(true);
        expect(runtime.reason).toBeNull();
        expect(runtime.controlPlane).toHaveProperty('exchange_and_register');
    });
});
