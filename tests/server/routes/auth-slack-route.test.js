import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

import { createAuthRouter } from '../../../server/routes/auth.js';

function createApp(authService) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService));
    return app;
}

function oauthStateCookie(state = 'state-123') {
    const digest = crypto.createHash('sha256').update(state, 'utf8').digest('base64url');
    return `brainbase_oauth_state=${digest}`;
}

describe('Slack auth routes', () => {
    it('GET /api/auth/organizations returns only organizations granted to the authenticated person', async () => {
        const authService = {
            verifyToken: vi.fn(() => ({
                sub: 'per_sato',
                slackUserId: 'U_SATO',
                slackWorkspaceId: 'T_UNSON',
                organizationId: 'unson'
            })),
            listOrganizationAccess: vi.fn(async () => [
                { organizationId: 'unson', name: 'UNSON', role: 'ceo', projectCodes: ['brainbase'] },
                { organizationId: 'sato-personal', name: '佐藤個人', role: 'ceo', projectCodes: ['fx', 'keiba'] }
            ])
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/organizations')
            .set('Authorization', 'Bearer access-token')
            .expect(200);

        expect(authService.listOrganizationAccess).toHaveBeenCalledWith({
            personId: 'per_sato'
        });
        expect(res.body.currentOrganizationId).toBe('unson');
        expect(res.body.organizations).toHaveLength(2);
    });

    it('POST /api/auth/organizations/switch issues an organization-scoped session', async () => {
        const authService = {
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 7200,
            verifyToken: vi.fn(() => ({
                sub: 'per_sato',
                slackUserId: 'U_SATO',
                slackWorkspaceId: 'T_UNSON',
                organizationId: 'unson'
            })),
            switchOrganization: vi.fn(async () => ({
                token: 'personal-access-token',
                refresh_token: 'personal-refresh-token',
                access: { personId: 'per_sato', organizationId: 'sato-personal', projectCodes: ['fx', 'keiba'] }
            }))
        };
        const app = createApp(authService);

        const res = await request(app)
            .post('/api/auth/organizations/switch')
            .set('Authorization', 'Bearer access-token')
            .send({ organizationId: 'sato-personal' })
            .expect(200);

        expect(authService.switchOrganization).toHaveBeenCalledWith({
            personId: 'per_sato',
            organizationId: 'sato-personal'
        });
        expect(res.body.access.organizationId).toBe('sato-personal');
    });

    it('organization routes require a signed person identity', async () => {
        const authService = {
            verifyToken: vi.fn(() => ({
                slackUserId: 'U_SATO',
                slackWorkspaceId: 'T_UNSON',
                organizationId: 'unson'
            })),
            listOrganizationAccess: vi.fn()
        };
        const app = createApp(authService);

        await request(app)
            .get('/api/auth/organizations')
            .set('Authorization', 'Bearer access-token')
            .expect(403, { error: 'Authenticated person is required' });
        expect(authService.listOrganizationAccess).not.toHaveBeenCalled();
    });

    it('GET /api/auth/organizations denies ambiguous active grants', async () => {
        const authService = {
            verifyToken: vi.fn(() => ({
                personId: 'per_sato',
                organizationId: 'unson'
            })),
            listOrganizationAccess: vi.fn().mockRejectedValue(new Error('Organization access is ambiguous'))
        };
        const app = createApp(authService);

        await request(app)
            .get('/api/auth/organizations')
            .set('Authorization', 'Bearer access-token')
            .expect(409, { error: 'Organization access is ambiguous' });
    });

    it('organization routes reject insecure header authentication', async () => {
        const previous = process.env.ALLOW_INSECURE_AUTH_HEADERS;
        process.env.ALLOW_INSECURE_AUTH_HEADERS = 'true';
        try {
            const authService = { verifyToken: vi.fn() };
            const app = createApp(authService);
            await request(app)
                .get('/api/auth/organizations')
                .set('x-brainbase-role', 'ceo')
                .set('x-brainbase-projects', 'fx,keiba')
                .expect(401);
        } finally {
            if (previous === undefined) delete process.env.ALLOW_INSECURE_AUTH_HEADERS;
            else process.env.ALLOW_INSECURE_AUTH_HEADERS = previous;
        }
    });

    it('POST /api/auth/refresh ignores organizationId in the request body', async () => {
        const authService = {
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 7200,
            assertReady: vi.fn(),
            refreshSession: vi.fn(async () => ({
                token: 'unson-access-token',
                refresh_token: 'unson-refresh-token',
                access: { organizationId: 'unson' }
            }))
        };
        const app = createApp(authService);
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refresh_token: 'bound-refresh-token', organizationId: 'sato-personal' })
            .expect(200);

        expect(authService.refreshSession).toHaveBeenCalledWith('bound-refresh-token');
        expect(res.body.access.organizationId).toBe('unson');
    });

    it('GET /api/auth/slack/start stores admin redirect in OAuth state', async () => {
        const authService = {
            assertReady: vi.fn(),
            createState: vi.fn(() => 'state-123'),
            buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/start')
            .query({
                origin: 'http://127.0.0.1:31030',
                redirect: '/admin.html',
                json: 'true'
            })
            .expect(200);

        expect(res.body.url).toBe('https://slack.example/start?state=state-123');
        expect(authService.createState).toHaveBeenCalledWith({
            origin: 'http://127.0.0.1:31030',
            codeChallenge: '',
            redirect: '/admin.html'
        });
    });

    it('GET /api/auth/slack/start rejects an unlisted origin before creating OAuth state', async () => {
        const authService = {
            assertReady: vi.fn(),
            createState: vi.fn(() => 'state-123'),
            buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/start')
            .query({
                origin: 'https://evil.example',
                redirect: 'https://evil.example/admin.html',
                json: 'true'
            })
            .expect(400);

        expect(res.body).toEqual({ error: 'origin is not allowed' });
        expect(authService.createState).not.toHaveBeenCalled();
        expect(authService.buildAuthorizeUrl).not.toHaveBeenCalled();
    });

    it('GET /api/auth/slack/start rejects an unlisted absolute redirect before creating OAuth state', async () => {
        const authService = {
            assertReady: vi.fn(),
            createState: vi.fn(() => 'state-123'),
            buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/start')
            .query({
                origin: 'https://bb.unson.jp',
                redirect: 'https://evil.example/admin.html',
                json: 'true'
            })
            .expect(400);

        expect(res.body).toEqual({ error: 'redirect is not allowed' });
        expect(authService.createState).not.toHaveBeenCalled();
        expect(authService.buildAuthorizeUrl).not.toHaveBeenCalled();
    });

    it('GET /api/auth/slack/start accepts an origin configured for a customer UI', async () => {
        const previous = process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS;
        process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS = 'https://bb-app.unson.jp';
        try {
            const authService = {
                assertReady: vi.fn(),
                createState: vi.fn(() => 'state-123'),
                buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
            };
            const app = createApp(authService);

            await request(app)
                .get('/api/auth/slack/start')
                .query({
                    origin: 'https://bb-app.unson.jp',
                    redirect: 'https://bb-app.unson.jp/',
                    json: 'true'
                })
                .expect(200);

            expect(authService.createState).toHaveBeenCalledWith({
                origin: 'https://bb-app.unson.jp',
                codeChallenge: '',
                redirect: 'https://bb-app.unson.jp/'
            });
        } finally {
            if (previous === undefined) delete process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS;
            else process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS = previous;
        }
    });

    it('GET /api/auth/slack/start rejects an absolute redirect to a different allowed origin', async () => {
        const previous = process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS;
        process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS = 'https://one.example,https://two.example';
        try {
            const authService = {
                assertReady: vi.fn(),
                createState: vi.fn(() => 'state-123'),
                buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
            };
            const app = createApp(authService);

            const res = await request(app)
                .get('/api/auth/slack/start')
                .query({
                    origin: 'https://one.example',
                    redirect: 'https://two.example/',
                    json: 'true'
                })
                .expect(400);

            expect(res.body).toEqual({ error: 'redirect is not allowed' });
            expect(authService.createState).not.toHaveBeenCalled();
        } finally {
            if (previous === undefined) delete process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS;
            else process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS = previous;
        }
    });

    it('GET /api/auth/login/start preserves the existing same-origin Device OAuth return path', async () => {
        const authService = {
            assertReady: vi.fn(),
            createState: vi.fn(() => 'state-123'),
            buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
        };
        const app = createApp(authService);

        await request(app)
            .get('/api/auth/login/start')
            .query({
                origin: '/device?auth_callback=true',
                redirect: '/device?auth_callback=true',
                json: 'true'
            })
            .expect(200);

        expect(authService.createState).toHaveBeenCalledWith({
            origin: '/device?auth_callback=true',
            codeChallenge: '',
            redirect: '/device?auth_callback=true'
        });
    });

    it('GET /api/auth/slack/start rejects a path that browsers resolve to an external origin', async () => {
        const authService = {
            assertReady: vi.fn(),
            createState: vi.fn(() => 'state-123'),
            buildAuthorizeUrl: vi.fn(() => 'https://slack.example/start?state=state-123')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/start')
            .query({
                origin: 'https://bb.unson.jp',
                redirect: '/\\evil.example/admin.html',
                json: 'true'
            })
            .expect(400);

        expect(res.body).toEqual({ error: 'redirect is not allowed' });
        expect(authService.createState).not.toHaveBeenCalled();
    });

    it('GET /api/auth/slack/callback exposes the verified Slack workspace, not a legacy workspace slug', async () => {
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({ ok: true, origin: 'https://bb.unson.jp' })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: { id: 'U123' }, team: { id: 'T123' } })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: 'U123', slackWorkspaceId: 'T123' })),
            findUserBySlackId: vi.fn(async () => ({
                person_id: 'per_001',
                slack_user_id: 'U123',
                access_level: 'admin',
                employment_type: 'internal',
                role: 'gm',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                workspace_id: 'unson',
                name: 'Admin User'
            })),
            issueToken: vi.fn(() => 'jwt-token'),
            issueRefreshToken: vi.fn(() => 'refresh-token'),
            createAuditLog: vi.fn(async () => {}),
            resolveRedirectUri: vi.fn(() => 'https://bb.unson.jp/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .set('Accept', 'application/json')
            .expect(200);

        expect(authService.findUserBySlackId).toHaveBeenCalledWith('U123', 'T123');
        expect(authService.issueToken).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'unson'
        }));
        expect(res.body.access.workspaceId).toBe('T123');
        expect(res.body.access.organizationId).toBe('unson');
    });

    it('GET /api/auth/slack/callback uses state redirect for same-window admin login fallback', async () => {
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({
                ok: true,
                origin: 'http://127.0.0.1:31030',
                redirect: '/admin.html'
            })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: { id: 'U123' }, team: { id: 'T123' } })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: 'U123', slackWorkspaceId: 'T123' })),
            findUserBySlackId: vi.fn(async () => ({
                person_id: 'per_001',
                slack_user_id: 'U123',
                access_level: 'admin',
                employment_type: 'internal',
                role: 'gm',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                workspace_id: 'T123',
                name: 'Admin User'
            })),
            issueToken: vi.fn(() => 'jwt-token'),
            issueRefreshToken: vi.fn(() => 'refresh-token'),
            createAuditLog: vi.fn(async () => {}),
            resolveRedirectUri: vi.fn(() => 'http://127.0.0.1:31030/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123', redirect: '/' })
            .set('Cookie', oauthStateCookie())
            .set('Accept', 'text/html')
            .expect(200);

        expect(res.text).toContain('const redirectTo = "/admin.html";');
        expect(res.text).toContain('window.location.replace(fallbackRedirectTo)');
        expect(res.text).toContain('brainbase_auth=');
        expect(res.text).not.toContain('const redirectTo = "/";');
    });

    it('GET /api/auth/slack/callback preserves allowed production admin redirects', async () => {
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({
                ok: true,
                origin: 'https://bb.unson.jp',
                redirect: 'https://bb.unson.jp/admin.html'
            })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: { id: 'U123' }, team: { id: 'T123' } })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: 'U123', slackWorkspaceId: 'T123' })),
            findUserBySlackId: vi.fn(async () => ({
                person_id: 'per_001',
                slack_user_id: 'U123',
                access_level: 'admin',
                employment_type: 'internal',
                role: 'gm',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                workspace_id: 'T123',
                name: 'Admin User'
            })),
            issueToken: vi.fn(() => 'jwt-token'),
            issueRefreshToken: vi.fn(() => 'refresh-token'),
            createAuditLog: vi.fn(async () => {}),
            resolveRedirectUri: vi.fn(() => 'https://bb.unson.jp/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .set('Accept', 'text/html')
            .expect(200);

        expect(res.text).toContain('const redirectTo = "https://bb.unson.jp/admin.html";');
        expect(res.text).toContain('href="https://bb.unson.jp/admin.html"');
        expect(res.text).not.toContain('const redirectTo = "/";');
    });

    it.each([
        ['an untrusted absolute redirect', 'https://evil.example/admin.html'],
        ['a browser path-confusion redirect', '/\\evil.example/admin.html']
    ])('GET /api/auth/slack/callback fails before token exchange for %s', async (_label, redirect) => {
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({
                ok: true,
                origin: 'https://bb.unson.jp',
                redirect
            })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: { id: 'U123' }, team: { id: 'T123' } })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: 'U123', slackWorkspaceId: 'T123' })),
            findUserBySlackId: vi.fn(async () => ({
                person_id: 'per_001',
                slack_user_id: 'U123',
                access_level: 'admin',
                employment_type: 'internal',
                role: 'gm',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                workspace_id: 'T123',
                name: 'Admin User'
            })),
            issueToken: vi.fn(() => 'jwt-token'),
            issueRefreshToken: vi.fn(() => 'refresh-token'),
            createAuditLog: vi.fn(async () => {}),
            resolveRedirectUri: vi.fn(() => 'https://bb.unson.jp/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .set('Accept', 'text/html')
            .expect(400);

        expect(res.body).toEqual({ error: 'Invalid OAuth return target' });
        expect(authService.exchangeCode).not.toHaveBeenCalled();
        expect(authService.issueToken).not.toHaveBeenCalled();
    });

    it('GET /api/auth/slack/callback escapes hostile redirect values in callback HTML attributes', async () => {
        const hostileRedirect = '/admin.html" autofocus onfocus="alert(1)';
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({
                ok: true,
                origin: 'http://127.0.0.1:31030',
                redirect: hostileRedirect
            })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: { id: 'U123' }, team: { id: 'T123' } })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: 'U123', slackWorkspaceId: 'T123' })),
            findUserBySlackId: vi.fn(async () => ({
                person_id: 'per_001',
                slack_user_id: 'U123',
                access_level: 'admin',
                employment_type: 'internal',
                role: 'gm',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                workspace_id: 'T123',
                name: 'Admin User'
            })),
            issueToken: vi.fn(() => 'jwt-token'),
            issueRefreshToken: vi.fn(() => 'refresh-token'),
            createAuditLog: vi.fn(async () => {}),
            resolveRedirectUri: vi.fn(() => 'http://127.0.0.1:31030/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .set('Accept', 'text/html')
            .expect(200);

        expect(res.text).toContain('href="/admin.html&quot; autofocus onfocus=&quot;alert(1)"');
        expect(res.text).not.toContain('href="/admin.html" autofocus onfocus="alert(1)"');
    });

    it('GET /api/auth/slack/callback fails closed for invalid state without rendering a normal-screen redirect', async () => {
        const authService = {
            slackMode: 'oauth',
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({ ok: false, origin: null, redirect: null }))
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'bad-state' })
            .set('Cookie', oauthStateCookie('bad-state'))
            .set('Accept', 'text/html')
            .expect(400);

        expect(res.body).toEqual({ error: 'Invalid state' });
        expect(res.text).not.toContain('window.location.replace');
        expect(res.text).not.toContain('href="/"');
    });

    it('GET /api/auth/slack/callback rejects a valid signed state that was started in another browser', async () => {
        const authService = {
            slackMode: 'oauth',
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({ ok: true, origin: 'https://bb.unson.jp' })),
            exchangeCode: vi.fn()
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Accept', 'text/html')
            .expect(400);

        expect(res.body).toEqual({ error: 'Invalid state' });
        expect(authService.consumeState).not.toHaveBeenCalled();
        expect(authService.exchangeCode).not.toHaveBeenCalled();
    });

    it('GET /api/auth/slack/callback fails closed when non-oauth mode has no Slack access token', async () => {
        const authService = {
            slackMode: 'oidc',
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({ ok: true, origin: 'http://127.0.0.1:31030' })),
            exchangeCode: vi.fn(async () => ({ ok: true })),
            resolveRedirectUri: vi.fn(() => 'http://127.0.0.1:31030/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .expect(401);

        expect(res.body).toEqual({ error: 'Slack access token missing' });
        expect(authService.exchangeCode).toHaveBeenCalledWith('code-123', expect.anything());
    });

    it('GET /api/auth/slack/callback fails closed when Slack identity cannot be resolved', async () => {
        const authService = {
            slackMode: 'oauth',
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({ ok: true, origin: 'http://127.0.0.1:31030' })),
            exchangeCode: vi.fn(async () => ({ ok: true, authed_user: {}, team: {} })),
            resolveSlackIdentity: vi.fn(() => ({ slackUserId: null, slackWorkspaceId: null })),
            resolveRedirectUri: vi.fn(() => 'http://127.0.0.1:31030/api/auth/slack/callback')
        };
        const app = createApp(authService);

        const res = await request(app)
            .get('/api/auth/slack/callback')
            .query({ code: 'code-123', state: 'state-123' })
            .set('Cookie', oauthStateCookie())
            .expect(401);

        expect(res.body).toEqual({ error: 'Slack identity could not be resolved' });
        expect(authService.resolveSlackIdentity).toHaveBeenCalled();
    });
});
