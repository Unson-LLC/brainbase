import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerSlackInstallationControlPlaneApiRoute } from '../../../../server/bootstrap/register-api-routes.js';
import {
    createSlackInstallationControlPlaneAuthMiddleware,
    SLACK_INSTALLATION_SERVICE_CAPABILITY
} from '../../../../server/services/multitenant/slack-installation-auth.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const appId = 'A0123456789';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69FAZ';
const secret = 'service-token-signing-secret-for-tests';
const serviceToken = `bbsvc_${jwt.sign({
    typ: 'service',
    issuer: 'brainbase',
    subject: 'svc_mana_slack_installation',
    audience: 'mana-runtime',
    deployment_id: deploymentId,
    expires_at: '2030-01-01T00:00:00.000Z',
    capabilities: [SLACK_INSTALLATION_SERVICE_CAPABILITY]
}, secret)}`;

const env = {
    BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: serviceToken,
    BRAINBASE_SERVICE_TOKEN_SECRET: secret,
    BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID: deploymentId
};

const binding = {
    installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant_id: tenantId,
    app_id: appId,
    expected_workspace_id: 'T0123456789',
    initiated_by_person_id: personId
};

function createApp({ envOverrides = {}, accessTokenResult } = {}) {
    const app = express();
    app.use(express.json());
    const controlPlane = {
        authorize: vi.fn(),
        authorizeBinding: vi.fn(async () => binding),
        exchange_and_register: vi.fn(async () => ({
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '1',
            tenant_id: tenantId,
            workspace_id: binding.expected_workspace_id,
            app_id: appId,
            status: 'active'
        }))
    };
    const authService = {
        verifyToken: vi.fn(() => accessTokenResult ?? {
            sub: personId,
            role: 'ceo',
            organizationId: tenantId
        })
    };
    registerSlackInstallationControlPlaneApiRoute(app, {
        controlPlane,
        authService,
        appId,
        authEnv: { ...env, ...envOverrides }
    });
    return { app, controlPlane, authService };
}

describe('Slack installation route-specific authentication', () => {
    it('accepts a tenant-admin user bearer for authorize and propagates canonical access', async () => {
        const { app, controlPlane, authService } = createApp();
        const response = await request(app)
            .post('/api/v1/slack-installations:authorize')
            .set('Authorization', 'Bearer user-admin-token')
            .send({ expected_workspace_id: binding.expected_workspace_id });

        expect(response.status).toBe(200);
        expect(authService.verifyToken).toHaveBeenCalledWith('user-admin-token');
        expect(controlPlane.authorizeBinding).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: tenantId,
            initiated_by_person_id: personId
        }));
    });

    it('accepts only the dedicated service JWT for exchange-and-register', async () => {
        const { app, controlPlane } = createApp();
        const response = await request(app)
            .post('/api/v1/slack-installations:exchange-and-register')
            .set('Authorization', `Bearer ${serviceToken}`)
            .send({ authorization_code: 'short-lived-code', redirect_uri: 'https://mana.example.test/callback', intent: binding });

        expect(response.status).toBe(200);
        expect(controlPlane.exchange_and_register).toHaveBeenCalledOnce();
        expect(JSON.stringify(response.body)).not.toContain('short-lived-code');
    });

    it('lets only the exact GET callback reach signed-state verification without bearer auth', async () => {
        const middleware = createSlackInstallationControlPlaneAuthMiddleware({
            authService: { verifyToken: vi.fn() },
            env
        });
        const req = {
            method: 'GET',
            path: '/slack-installations:callback',
            originalUrl: '/api/v1/slack-installations:callback?code=one-time&state=signed'
        };
        const response = {
            statusCode: null,
            status(code) { this.statusCode = code; return this; },
            type() { return this; },
            json() { return this; }
        };
        const next = vi.fn();

        await middleware(req, response, next);
        expect(next).toHaveBeenCalledOnce();
        expect(response.statusCode).toBeNull();
    });

    it('rejects a general/member service token on exchange before business logic', async () => {
        const { app, controlPlane } = createApp();
        const memberToken = `bbsvc_${jwt.sign({
            typ: 'service',
            issuer: 'brainbase',
            subject: 'svc_member',
            audience: 'mana-runtime',
            deployment_id: deploymentId,
            expires_at: '2030-01-01T00:00:00.000Z',
            capabilities: ['tenant_context:resolve']
        }, secret)}`;
        const response = await request(app)
            .post('/api/v1/slack-installations:exchange-and-register')
            .set('Authorization', `Bearer ${memberToken}`)
            .send({ authorization_code: 'short-lived-code', redirect_uri: 'https://mana.example.test/callback', intent: binding });

        expect(response.status).toBe(401);
        expect(controlPlane.exchange_and_register).not.toHaveBeenCalled();
    });

    it('does not allow the service JWT to impersonate a user on authorize', async () => {
        const { app, controlPlane } = createApp();
        const response = await request(app)
            .post('/api/v1/slack-installations:authorize')
            .set('Authorization', `Bearer ${serviceToken}`)
            .send({ expected_workspace_id: binding.expected_workspace_id });

        expect(response.status).toBe(401);
        expect(controlPlane.authorizeBinding).not.toHaveBeenCalled();
    });

    it('fails exchange closed when dedicated service authentication is not configured', async () => {
        const { app, controlPlane } = createApp({ envOverrides: {
            BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN: undefined,
            BRAINBASE_SLACK_INSTALLATION_SERVICE_TOKEN: undefined
        } });
        const response = await request(app)
            .post('/api/v1/slack-installations:exchange-and-register')
            .set('Authorization', 'Bearer caller-token')
            .send({ authorization_code: 'short-lived-code', redirect_uri: 'https://mana.example.test/callback', intent: binding });

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ code: 'SERVICE_AUTH_CONFIGURATION_REQUIRED', retryable: true });
        expect(controlPlane.exchange_and_register).not.toHaveBeenCalled();
    });

    it('dispatches based on the mounted route path instead of sharing a generic requireAuth guard', async () => {
        const middleware = createSlackInstallationControlPlaneAuthMiddleware({
            authService: { verifyToken: () => ({ sub: personId, role: 'ceo', organizationId: tenantId }) },
            env
        });
        const req = {
            path: '/not-a-slack-installation-route',
            originalUrl: '/api/v1/not-a-slack-installation-route',
            get: () => undefined
        };
        const response = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            type() { return this; },
            json(body) { this.body = body; return this; }
        };
        const next = vi.fn();
        await middleware(req, response, next);

        expect(response.statusCode).toBe(404);
        expect(next).not.toHaveBeenCalled();
    });

    it('resolves legacy user JWT identity through the canonical mapping resolver', async () => {
        const resolveCanonicalAccess = vi.fn(async ({ slackUserId, slackWorkspaceId }) => ({
            tenantId,
            personId,
            role: 'ceo',
            slackUserId,
            slackWorkspaceId
        }));
        const middleware = createSlackInstallationControlPlaneAuthMiddleware({
            authService: {
                verifyToken: () => ({
                    sub: 'legacy-subject',
                    organizationId: 'org-self-asserted',
                    slackUserId: 'U0123456789',
                    slackWorkspaceId: 'T0123456789'
                })
            },
            resolveCanonicalAccess,
            env
        });
        const req = {
            method: 'POST',
            path: '/slack-installations:authorize',
            headers: { authorization: 'Bearer legacy-user-token' },
            get(name) { return this.headers[name.toLowerCase()]; }
        };
        const response = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            type() { return this; },
            json(body) { this.body = body; return this; }
        };
        const next = vi.fn();

        await middleware(req, response, next);

        expect(resolveCanonicalAccess).toHaveBeenCalledWith(expect.objectContaining({
            slack_user_id: 'U0123456789',
            slack_workspace_id: 'T0123456789'
        }));
        expect(req.access).toMatchObject({ tenantId, personId, role: 'ceo' });
        expect(req.access.organizationId).not.toBe('org-self-asserted');
        expect(next).toHaveBeenCalledOnce();
    });

    it('fails closed when legacy user identity has no canonical mapping', async () => {
        const middleware = createSlackInstallationControlPlaneAuthMiddleware({
            authService: {
                verifyToken: () => ({
                    sub: 'legacy-subject',
                    organizationId: 'org-self-asserted',
                    slackUserId: 'U0123456789',
                    slackWorkspaceId: 'T0123456789'
                })
            },
            resolveCanonicalAccess: vi.fn(async () => null),
            env
        });
        const req = {
            method: 'POST',
            path: '/slack-installations:authorize',
            headers: { authorization: 'Bearer legacy-user-token' },
            get(name) { return this.headers[name.toLowerCase()]; }
        };
        const response = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            type() { return this; },
            json(body) { this.body = body; return this; }
        };
        const next = vi.fn();

        await middleware(req, response, next);

        expect(response.statusCode).toBe(403);
        expect(response.body).toMatchObject({ code: 'INSTALLATION_AUTHORIZATION_REQUIRED' });
        expect(next).not.toHaveBeenCalled();
    });
});
