import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';
import { registerSlackInstallationControlPlaneApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { SLACK_INSTALLATION_SERVICE_CAPABILITY } from '../../../server/services/multitenant/slack-installation-auth.js';

const secret = 'slack-installation-csrf-order-test-secret';
const userSecret = 'slack-installation-human-user-csrf-test-secret';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69FAZ';
const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
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

const body = {
    authorization_code: 'one-time-code',
    redirect_uri: 'https://mana.example.test/slack/oauth/callback',
    intent: {
        installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        tenant_id: tenantId,
        app_id: 'A0123456789',
        expected_workspace_id: 'T0123456789',
        initiated_by_person_id: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY'
    }
};

const previousNodeEnv = process.env.NODE_ENV;
const previousEnv = new Map([...Object.keys(env), 'BRAINBASE_JWT_SECRET', 'INTERNAL_API_SECRET']
    .map((key) => [key, process.env[key]]));

afterEach(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

function createProductionOrderedApp() {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    const controlPlane = {
        authorize: async () => null,
        authorizeBinding: async () => null,
        exchange_and_register: async () => ({ status: 'active', tenant_id: tenantId })
    };
    registerSlackInstallationControlPlaneApiRoute(app, {
        controlPlane,
        appId: body.intent.app_id,
        authEnv: env
    });
    app.post('/api/v1/other', (_req, res) => res.json({ ok: true }));
    return app;
}

function humanToken(overrides = {}, signOptions = { expiresIn: '10m' }) {
    return jwt.sign({
        sub: personId,
        personId,
        slackUserId: 'U0123456789',
        slackWorkspaceId: 'T0123456789',
        role: 'tenant_admin',
        projectCodes: ['mana'],
        clearance: ['internal'],
        organizationId: tenantId,
        ...overrides
    }, userSecret, signOptions);
}

function createProductionAuthorizeApp() {
    process.env.BRAINBASE_JWT_SECRET = userSecret;
    const app = express();
    app.use(express.json());
    app.use(csrfMiddleware());
    const controlPlane = {
        authorize: async () => null,
        authorizeBinding: async (intent) => ({ status: 'pending', ...intent }),
        exchange_and_register: async () => null
    };
    registerSlackInstallationControlPlaneApiRoute(app, {
        controlPlane,
        appId: body.intent.app_id,
        authService: {
            verifyToken: (token) => jwt.verify(token, userSecret)
        },
        authEnv: env
    });
    app.post('/api/v1/other', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('Slack installation auth and global CSRF production ordering', () => {
    it('allows only an exact Bearer-authenticated human authorize request through global CSRF', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(createProductionAuthorizeApp())
            .post('/api/v1/slack-installations:authorize')
            .set('Authorization', `Bearer ${humanToken()}`)
            .send({ app_id: body.intent.app_id });

        expect(response.status).toBe(200);
        expect(response.body.result).toMatchObject({
            status: 'pending',
            tenant_id: tenantId,
            initiated_by_person_id: personId,
            app_id: body.intent.app_id
        });
    });

    it.each([
        ['cookie', (call, token) => call.set('Cookie', `brainbase_session=${token}`)],
        ['invalid bearer', (call) => call.set('Authorization', 'Bearer invalid.jwt.value')],
        ['expired bearer', (call) => call.set('Authorization', `Bearer ${humanToken({}, { expiresIn: -1 })}`)],
        ['service bearer', (call) => call.set('Authorization', `Bearer ${serviceToken}`)],
        ['internal key', (call) => call.set('x-internal-api-key', 'internal-authorize-test-key')],
        ['insecure headers', (call) => call.set('x-brainbase-role', 'tenant_admin')]
    ])('does not exempt %s authentication on authorize', async (_label, configure) => {
        process.env.NODE_ENV = 'production';
        process.env.INTERNAL_API_SECRET = 'internal-authorize-test-key';
        let call = request(createProductionAuthorizeApp())
            .post('/api/v1/slack-installations:authorize')
            .send({ app_id: body.intent.app_id });
        call = configure(call, humanToken());
        const response = await call;

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'Forbidden', message: 'CSRF token required' });
    });

    it('does not exempt a valid human Bearer token on a neighbouring path', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(createProductionAuthorizeApp())
            .post('/api/v1/other')
            .set('Authorization', `Bearer ${humanToken()}`)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: 'Forbidden', message: 'CSRF token required' });
    });

    it('keeps canonical role authorization after the CSRF exemption', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(createProductionAuthorizeApp())
            .post('/api/v1/slack-installations:authorize')
            .set('Authorization', `Bearer ${humanToken({ role: 'member' })}`)
            .send({ app_id: body.intent.app_id });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatchObject({ code: 'INSTALLATION_AUTHORIZATION_REQUIRED' });
    });

    it('allows only the fully verified dedicated exchange service JWT through global CSRF', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(createProductionOrderedApp())
            .post('/api/v1/slack-installations:exchange-and-register')
            .set('Authorization', `Bearer ${serviceToken}`)
            .send(body);

        expect(response.status).toBe(200);
    });

    it('does not let a browser or user JWT bypass CSRF on exchange', async () => {
        process.env.NODE_ENV = 'production';
        const userToken = jwt.sign({
            sub: 'legacy-user',
            organizationId: 'org-self-asserted'
        }, secret);
        const response = await request(createProductionOrderedApp())
            .post('/api/v1/slack-installations:exchange-and-register')
            .set('Authorization', `Bearer ${userToken}`)
            .send(body);

        expect(response.status).toBe(403);
    });

    it('does not exempt a valid dedicated service JWT on another route', async () => {
        process.env.NODE_ENV = 'production';
        const response = await request(createProductionOrderedApp())
            .post('/api/v1/other')
            .set('Authorization', `Bearer ${serviceToken}`)
            .send({ ok: true });

        expect(response.status).toBe(403);
    });
});
