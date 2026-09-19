import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerOrganizationConnectionsApiRoute } from '../../../server/bootstrap/register-api-routes.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const appId = 'A0123456789';

function app({
    controlPlane = {
        authorizeBinding: vi.fn(async (value) => value),
        credentialStore: { verify: vi.fn(async () => ({ valid: true })) }
    },
    oauthFlow = { createAuthorization: vi.fn(() => ({
        authorization_url: 'https://slack.com/oauth/v2/authorize?state=signed',
        redirect_uri: 'https://brainbase.test/slack/callback'
    })) },
    connectionRepository = { listOrganizationConnections: vi.fn(async () => []) },
    githubAppSlug,
    githubStateSecret = 'x'.repeat(32)
} = {}) {
    const server = express();
    server.use(express.json());
    registerOrganizationConnectionsApiRoute(server, {
        authService: {
            verifyToken: () => ({
                sub: personId,
                personId,
                tenantId,
                organizationId: tenantId,
                role: 'tenant_admin'
            })
        },
        controlPlane,
        appId,
        oauthFlow,
        connectionRepository,
        githubAppSlug,
        githubStateSecret
    });
    return server;
}

const auth = (call) => call.set('Authorization', 'Bearer test-token');

describe('organization connections API', () => {
    it('returns unknown when no connection is recorded and never exposes credential fields', async () => {
        const connectionRepository = {
            listOrganizationConnections: vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                provider: 'github', status: 'active', installation_id: '123',
                workspace_id: '', granted_scopes: ['metadata:read'], installed_at: null,
                credential_ref: 'secret-credential-ref', access_token: 'secret-token'
            }])
        };
        const response = await auth(request(app({ connectionRepository }))
            .get('/api/organization-connections/github/status'));

        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toMatchObject({
            provider: 'github', status: 'unknown', connected: null,
            account: { provider_status: 'active', external_handle: '123' }
        });
        expect(JSON.stringify(response.body)).not.toContain('secret-');
        expect(response.body).not.toHaveProperty('credential_ref');
    });

    it('keeps an absent connection unknown instead of treating it as verified disconnected', async () => {
        const response = await auth(request(app()).get('/api/organization-connections/slack/status'));
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            provider: 'slack', status: 'unknown', connected: null, account: null
        });
    });

    it('reports Slack connected only after the credential store verifies the opaque reference', async () => {
        const verify = vi.fn(async () => ({ valid: true }));
        const controlPlane = {
            authorizeBinding: vi.fn(async (value) => value), credentialStore: { verify }
        };
        const connectionRepository = { listOrganizationConnections: vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '3',
            provider: 'slack', status: 'active', workspace_id: 'T0123456789',
            granted_scopes: ['chat:write'], credential_ref: 'opaque://slack/ref', installed_at: null
        }]) };
        const response = await auth(request(app({ controlPlane, connectionRepository }))
            .get('/api/organization-connections/slack/status'));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ provider: 'slack', status: 'connected', connected: true });
        expect(verify).toHaveBeenCalledWith({
            tenant_id: tenantId, connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '3', provider: 'slack', credential_ref: 'opaque://slack/ref'
        });
        expect(JSON.stringify(response.body)).not.toContain('opaque://');
    });

    it('reports disconnected only for an explicitly revoked connection', async () => {
        const connectionRepository = {
            listOrganizationConnections: vi.fn(async () => [{
                connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                provider: 'github', status: 'revoked', installation_id: '123',
                workspace_id: '', granted_scopes: [], installed_at: '2026-09-20T00:00:00.000Z'
            }])
        };
        const response = await auth(request(app({ connectionRepository }))
            .get('/api/organization-connections/github/status'));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            provider: 'github', status: 'revoked', connected: false,
            account: { provider_status: 'revoked', external_handle: '123' }
        });
    });

    it('starts Slack authorization through the existing control plane and OAuth flow', async () => {
        const controlPlane = { authorizeBinding: vi.fn(async (value) => ({ ...value, status: 'pending' })) };
        const oauthFlow = { createAuthorization: vi.fn(() => ({
            authorization_url: 'https://slack.com/oauth/v2/authorize?state=opaque',
            oauth_state: 'do-not-return',
            redirect_uri: 'https://brainbase.test/slack/callback'
        })) };
        const response = await auth(request(app({ controlPlane, oauthFlow }))
            .post('/api/organization-connections/slack/start')
            .send({ expected_workspace_id: 'T0123456789' }));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            provider: 'slack', status: 'authorization_required',
            url: 'https://slack.com/oauth/v2/authorize?state=opaque'
        });
        expect(response.body).not.toHaveProperty('oauth_state');
        expect(controlPlane.authorizeBinding).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: tenantId, app_id: appId, initiated_by_person_id: personId,
            expected_workspace_id: 'T0123456789'
        }));
        expect(oauthFlow.createAuthorization).toHaveBeenCalledOnce();
    });

    it('injects the canonical current revision when restarting Slack authorization', async () => {
        const controlPlane = { authorizeBinding: vi.fn(async (value) => value) };
        const connectionRepository = { listOrganizationConnections: vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '7', status: 'active'
        }]) };
        const response = await auth(request(app({ controlPlane, connectionRepository }))
            .post('/api/organization-connections/slack/start').send({}));

        expect(response.status).toBe(200);
        expect(controlPlane.authorizeBinding).toHaveBeenCalledWith(expect.objectContaining({
            expected_connection_revision: '7'
        }));
    });

    it('fails closed when GitHub App settings are missing', async () => {
        const response = await auth(request(app({ githubAppSlug: undefined }))
            .post('/api/organization-connections/github/start').send({}));
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('GITHUB_APP_NOT_CONFIGURED');
        expect(response.body).not.toHaveProperty('status', 'connected');
    });

    it('returns a signed GitHub App install URL without claiming completion', async () => {
        const response = await auth(request(app({ githubAppSlug: 'brainbase-test-app' }))
            .post('/api/organization-connections/github/start').send({}));
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ provider: 'github', status: 'authorization_required' });
        const url = new URL(response.body.url);
        expect(url.origin).toBe('https://github.com');
        expect(url.pathname).toBe('/apps/brainbase-test-app/installations/new');
        expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
        expect(response.body).not.toHaveProperty('connected', true);
    });

    it('rejects non-admins and unknown providers', async () => {
        const nonAdmin = express();
        nonAdmin.use(express.json());
        registerOrganizationConnectionsApiRoute(nonAdmin, {
            authService: { verifyToken: () => ({ sub: personId, tenantId, role: 'member' }) }
        });
        expect((await auth(request(nonAdmin).get('/api/organization-connections/slack/status'))).status).toBe(403);
        expect((await auth(request(app()).get('/api/organization-connections/notion/status'))).status).toBe(404);
    });
});
