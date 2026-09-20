import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerOrganizationConnectionsApiRoute } from '../../../server/bootstrap/register-api-routes.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const appId = 'A0123456789';

function app({
    authService = {
        verifyToken: () => ({
            sub: personId,
            personId,
            tenantId,
            organizationId: tenantId,
            role: 'tenant_admin'
        })
    },
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
    githubStateSecret = 'x'.repeat(32),
    githubAppVerifier,
    githubCredentialStore,
    githubAuthorizationLedger,
    githubCallbackReturnUrl,
    now
} = {}) {
    const server = express();
    server.use(express.json());
    registerOrganizationConnectionsApiRoute(server, {
        authService,
        controlPlane,
        appId,
        oauthFlow,
        connectionRepository,
        githubAppSlug,
        githubStateSecret,
        githubAppVerifier,
        githubCredentialStore,
        githubAuthorizationLedger,
        githubCallbackReturnUrl,
        now
    });
    return server;
}

function githubPorts({ ledgerOverrides = {}, repositoryOverrides = {}, readbackInstallation } = {}) {
    const installation = {
        installation_id: '123', app_id: '456', app_slug: 'brainbase-test-app',
        account: { id: '789', login: 'unson', type: 'Organization' },
        permissions: { metadata: 'read' }, suspended_at: null
    };
    const credentialMaterial = { installation_token: 'provider-secret' };
    const authorizationLedger = {
        records: new Map(),
        issue: vi.fn(async (record) => {
            authorizationLedger.records.set(record.state_digest, record);
            return true;
        }),
        consume: vi.fn(async ({ state_digest: digest }) => {
            const exists = authorizationLedger.records.has(digest);
            authorizationLedger.records.delete(digest);
            return exists;
        }),
        ...ledgerOverrides
    };
    const credentialStore = {
        store: vi.fn(async () => ({
            credential_ref: 'opaque://github/connection', credential_mode: 'cloud_standard', refresh_revision: 0
        })),
        verify: vi.fn(async () => ({ valid: true })),
        materialize: vi.fn(async () => ({ credential_material: credentialMaterial })),
        revoke: vi.fn(async () => undefined)
    };
    const verifier = {
        verifyInstallation: vi.fn(async () => ({ installation, credential_material: credentialMaterial })),
        readInstallation: vi.fn(async () => ({ installation: readbackInstallation ?? installation }))
    };
    const connectionRepository = {
        listOrganizationConnections: vi.fn(async () => []),
        reserveGitHubInstallation: vi.fn(async () => ({
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1'
        })),
        saveGitHubInstallation: vi.fn(async () => undefined),
        cancelGitHubInstallationReservation: vi.fn(async () => undefined),
        ...repositoryOverrides
    };
    return { authorizationLedger, credentialStore, verifier, connectionRepository, installation, credentialMaterial };
}

const auth = (call) => call.set('Authorization', 'Bearer test-token');

describe('organization connections API', () => {
    it('uses the tenant resolved by requireAuth without requiring a second Slack identity lookup', async () => {
        const resolveTenantForOrganization = vi.fn(async (organizationId) => ({
            organization_id: organizationId,
            tenant_id: tenantId
        }));
        const resolveCanonicalSlackInstallationAccess = vi.fn(async () => null);
        const connectionRepository = { listOrganizationConnections: vi.fn(async () => []) };
        const response = await auth(request(app({
            authService: {
                pool: {},
                verifyToken: () => ({
                    sub: personId,
                    personId,
                    organizationId: 'unson',
                    role: 'ceo',
                    slackUserId: 'U0123456789',
                    slackWorkspaceId: 'T0123456789'
                }),
                resolveTenantForOrganization,
                resolveCanonicalSlackInstallationAccess
            },
            connectionRepository
        })).get('/api/organization-connections/slack/status'));

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            provider: 'slack', status: 'unknown', connected: null, account: null
        });
        expect(resolveTenantForOrganization).toHaveBeenCalledWith('unson');
        expect(resolveCanonicalSlackInstallationAccess).not.toHaveBeenCalled();
        expect(connectionRepository.listOrganizationConnections).toHaveBeenCalledWith({
            tenant_id: tenantId,
            provider: 'slack'
        });
    });

    it('fails closed when canonical tenant and organization claims disagree', async () => {
        const connectionRepository = { listOrganizationConnections: vi.fn(async () => []) };
        const response = await auth(request(app({
            authService: {
                verifyToken: () => ({
                    sub: personId,
                    personId,
                    tenantId,
                    organizationId: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                    role: 'tenant_admin'
                })
            },
            connectionRepository
        })).get('/api/organization-connections/slack/status'));

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ORGANIZATION_ADMIN_REQUIRED');
        expect(connectionRepository.listOrganizationConnections).not.toHaveBeenCalled();
    });

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
        const ports = githubPorts();
        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        }))
            .post('/api/organization-connections/github/start').send({}));
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ provider: 'github', status: 'authorization_required' });
        const url = new URL(response.body.url);
        expect(url.origin).toBe('https://github.com');
        expect(url.pathname).toBe('/apps/brainbase-test-app/installations/new');
        expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
        expect(response.body).not.toHaveProperty('connected', true);
        expect(ports.authorizationLedger.issue).toHaveBeenCalledOnce();
        expect(ports.authorizationLedger.issue.mock.calls[0][0]).toMatchObject({
            provider: 'github', tenant_id: tenantId, person_id: personId,
            jti: expect.any(String), state_digest: expect.any(String)
        });
        expect(ports.authorizationLedger.issue.mock.calls[0][0]).not.toHaveProperty('signed_state');
    });

    it('reuses a verified existing GitHub installation instead of opening GitHub settings', async () => {
        const ports = githubPorts();
        ports.connectionRepository.listOrganizationConnections = vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1',
            provider: 'github', status: 'active', installation_id: '123',
            app_id: '456', account_id: '789', account_login: 'unson',
            credential_ref: 'opaque://github/connection'
        }]);

        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        })).post('/api/organization-connections/github/start').send({}));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            provider: 'github', status: 'connected', connected: true,
            account: { installation_id: '123', login: 'unson' }
        });
        expect(response.body).not.toHaveProperty('url');
        expect(ports.credentialStore.verify).toHaveBeenCalledOnce();
        expect(ports.verifier.readInstallation).toHaveBeenCalledOnce();
        expect(ports.authorizationLedger.issue).not.toHaveBeenCalled();
    });

    it('reuses a verified existing installation without new-install callback ports', async () => {
        const ports = githubPorts();
        ports.connectionRepository.listOrganizationConnections = vi.fn(async ({ tenant_id, provider }) => {
            expect(tenant_id).toBe(tenantId);
            expect(provider).toBe('github');
            return [{
                connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1',
                provider: 'github', status: 'active', installation_id: '123',
                app_id: '456', account_id: '789', credential_ref: 'opaque://github/connection'
            }];
        });
        delete ports.connectionRepository.reserveGitHubInstallation;
        delete ports.credentialStore.store;

        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            connectionRepository: ports.connectionRepository
        })).post('/api/organization-connections/github/start').send({}));

        expect(response.status).toBe(200);
        expect(response.body.account).toEqual({ installation_id: '123', login: 'unson' });
    });

    it('does not claim an existing GitHub connection when its credential cannot be verified', async () => {
        const ports = githubPorts();
        ports.credentialStore.verify.mockResolvedValue({ valid: false });
        ports.connectionRepository.listOrganizationConnections = vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1',
            provider: 'github', status: 'active', installation_id: '123',
            credential_ref: 'opaque://github/connection'
        }]);

        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        })).post('/api/organization-connections/github/start').send({}));

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('authorization_required');
        expect(response.body).not.toHaveProperty('connected', true);
        expect(ports.verifier.readInstallation).not.toHaveBeenCalled();
    });

    it('does not reuse an existing GitHub connection when provider readback identifies another installation', async () => {
        const ports = githubPorts({ readbackInstallation: {
            installation_id: '999', app_id: '456', app_slug: 'brainbase-test-app',
            account: { id: '789', login: 'unson', type: 'Organization' },
            permissions: { metadata: 'read' }, suspended_at: null
        } });
        ports.connectionRepository.listOrganizationConnections = vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1',
            provider: 'github', status: 'active', installation_id: '123',
            credential_ref: 'opaque://github/connection'
        }]);

        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        })).post('/api/organization-connections/github/start').send({}));

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('authorization_required');
        expect(response.body).not.toHaveProperty('connected', true);
        expect(ports.verifier.readInstallation).toHaveBeenCalledOnce();
    });

    it('fails closed when callback ports are not configured', async () => {
        const response = await auth(request(app({ githubAppSlug: 'brainbase-test-app' }))
            .post('/api/organization-connections/github/start').send({}));
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('GITHUB_APP_CONNECTION_UNAVAILABLE');
        expect(response.body).not.toHaveProperty('url');
    });

    it('saves a GitHub installation only after state consumption, opaque credential storage, and provider readback', async () => {
        const ports = githubPorts();
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        const state = new URL(started.body.url).searchParams.get('state');
        const callback = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123', state
        });

        expect(started.status).toBe(200);
        expect(callback.status).toBe(200);
        expect(callback.headers['cache-control']).toBe('no-store');
        expect(callback.headers['referrer-policy']).toBe('no-referrer');
        expect(callback.body).toMatchObject({
            provider: 'github', status: 'connected', connected: true,
            account: { installation_id: '123', login: 'unson' }
        });
        expect(JSON.stringify(callback.body)).not.toContain('provider-secret');
        expect(JSON.stringify(callback.body)).not.toContain('opaque://');
        expect(ports.authorizationLedger.consume).toHaveBeenCalledOnce();
        expect(ports.verifier.verifyInstallation).toHaveBeenCalledWith({
            installation_id: '123', expected_app_slug: 'brainbase-test-app'
        });
        expect(ports.credentialStore.store).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: tenantId,
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '1', provider: 'github',
            credential_material: ports.credentialMaterial
        }));
        expect(ports.verifier.readInstallation).toHaveBeenCalledOnce();
        expect(ports.authorizationLedger.consume.mock.invocationCallOrder[0])
            .toBeLessThan(ports.verifier.verifyInstallation.mock.invocationCallOrder[0]);
        expect(ports.credentialStore.store.mock.invocationCallOrder[0])
            .toBeLessThan(ports.verifier.readInstallation.mock.invocationCallOrder[0]);
        expect(ports.verifier.readInstallation.mock.invocationCallOrder[0])
            .toBeLessThan(ports.connectionRepository.saveGitHubInstallation.mock.invocationCallOrder[0]);
        expect(ports.connectionRepository.saveGitHubInstallation).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: tenantId,
            initiated_by_person_id: personId,
            installation: ports.installation,
            credential: expect.objectContaining({ credential_ref: 'opaque://github/connection' })
        }));
    });

    it('rejects a tampered or replayed GitHub state before verification or persistence', async () => {
        const ports = githubPorts();
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        const state = new URL(started.body.url).searchParams.get('state');
        const tampered = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123', state: `${state}x`
        });
        expect(tampered.status).toBe(400);
        expect(ports.authorizationLedger.consume).not.toHaveBeenCalled();

        const first = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123', state
        });
        const replay = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123', state
        });
        expect(first.status).toBe(200);
        expect(replay.status).toBe(409);
        expect(ports.verifier.verifyInstallation).toHaveBeenCalledOnce();
        expect(ports.connectionRepository.saveGitHubInstallation).toHaveBeenCalledOnce();
    });

    it('does not save the installation when provider readback identifies a different organization', async () => {
        const ports = githubPorts({ readbackInstallation: {
            ...{
                installation_id: '123', app_id: '456', app_slug: 'brainbase-test-app',
                account: { id: '999', login: 'someone-else', type: 'Organization' }, suspended_at: null
            }
        } });
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        const callback = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123',
            state: new URL(started.body.url).searchParams.get('state')
        });

        expect(callback.status).toBe(502);
        expect(callback.body.code).toBe('GITHUB_INSTALLATION_READBACK_MISMATCH');
        expect(ports.connectionRepository.saveGitHubInstallation).not.toHaveBeenCalled();
        expect(ports.credentialStore.revoke).toHaveBeenCalledOnce();
        expect(ports.connectionRepository.cancelGitHubInstallationReservation).toHaveBeenCalledOnce();
    });

    it('revokes a stored credential when the credential store returns invalid metadata', async () => {
        const ports = githubPorts();
        ports.credentialStore.store.mockResolvedValue({
            credential_ref: 'opaque://github/connection', credential_mode: 'unknown', refresh_revision: 0
        });
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        const callback = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123',
            state: new URL(started.body.url).searchParams.get('state')
        });

        expect(callback.status).toBe(502);
        expect(callback.body.code).toBe('GITHUB_CREDENTIAL_STORE_INVALID');
        expect(ports.credentialStore.revoke).toHaveBeenCalledWith(expect.objectContaining({
            credential_ref: 'opaque://github/connection',
            reason: 'github_installation_registration_failed'
        }));
        expect(ports.connectionRepository.saveGitHubInstallation).not.toHaveBeenCalled();
        expect(ports.connectionRepository.cancelGitHubInstallationReservation).toHaveBeenCalledOnce();
    });

    it('reports a GitHub connection connected only after credential verification and provider readback', async () => {
        const ports = githubPorts();
        const credential = 'opaque://github/connection';
        ports.connectionRepository.listOrganizationConnections = vi.fn(async () => [{
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ', connection_revision: '1',
            provider: 'github', status: 'active', installation_id: '123',
            app_id: '456', account_id: '789', account_login: 'unson', credential_ref: credential
        }]);
        const response = await auth(request(app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository
        })).get('/api/organization-connections/github/status'));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ provider: 'github', status: 'connected', connected: true });
        expect(ports.credentialStore.verify).toHaveBeenCalledWith({
            tenant_id: tenantId, connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '1', provider: 'github', credential_ref: credential
        });
        expect(ports.verifier.readInstallation).toHaveBeenCalledOnce();
        expect(JSON.stringify(response.body)).not.toContain(credential);
    });

    it('redirects only to the configured fixed HTTPS callback URL', async () => {
        const ports = githubPorts();
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository,
            githubCallbackReturnUrl: 'https://bb-app.unson.jp/?github=connected'
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        const response = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123',
            state: new URL(started.body.url).searchParams.get('state')
        });
        expect(response.status).toBe(303);
        expect(response.headers.location).toBe('https://bb-app.unson.jp/?github=connected');
    });

    it.each([
        'http://bb-app.unson.jp/?github=connected',
        'https://user:password@bb-app.unson.jp/?github=connected',
        'https://bb-app.unson.jp/?github=connected#fragment',
        '/settings/integrations'
    ])('rejects unsafe fixed callback URL %s before consuming state', async (githubCallbackReturnUrl) => {
        const ports = githubPorts();
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository,
            githubCallbackReturnUrl
        });
        const response = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123', state: 'invalid'
        });
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('GITHUB_APP_CONNECTION_UNAVAILABLE');
        expect(ports.authorizationLedger.consume).not.toHaveBeenCalled();
    });

    it('rejects expired GitHub state without consuming it or checking the installation', async () => {
        const ports = githubPorts();
        let time = new Date('2026-09-20T00:00:00.000Z');
        const server = app({
            githubAppSlug: 'brainbase-test-app',
            githubAppVerifier: ports.verifier,
            githubCredentialStore: ports.credentialStore,
            githubAuthorizationLedger: ports.authorizationLedger,
            connectionRepository: ports.connectionRepository,
            now: () => time
        });
        const started = await auth(request(server)
            .post('/api/organization-connections/github/start').send({}));
        time = new Date(time.getTime() + 11 * 60 * 1000);
        const callback = await request(server).get('/api/organization-connections/github/callback').query({
            setup_action: 'install', installation_id: '123',
            state: new URL(started.body.url).searchParams.get('state')
        });
        expect(callback.status).toBe(400);
        expect(callback.body.code).toBe('GITHUB_INSTALLATION_STATE_INVALID');
        expect(ports.authorizationLedger.consume).not.toHaveBeenCalled();
        expect(ports.verifier.verifyInstallation).not.toHaveBeenCalled();
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
