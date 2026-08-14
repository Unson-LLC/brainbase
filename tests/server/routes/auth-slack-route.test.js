import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createAuthRouter } from '../../../server/routes/auth.js';

function createApp(authService) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService));
    return app;
}

describe('Slack auth routes', () => {
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
            .set('Accept', 'text/html')
            .expect(200);

        expect(res.text).toContain('const redirectTo = "https://bb.unson.jp/admin.html";');
        expect(res.text).toContain('href="https://bb.unson.jp/admin.html"');
        expect(res.text).not.toContain('const redirectTo = "/";');
    });

    it('GET /api/auth/slack/callback rejects untrusted absolute redirects', async () => {
        const authService = {
            slackMode: 'oauth',
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
            assertReady: vi.fn(),
            consumeState: vi.fn(() => ({
                ok: true,
                origin: 'https://bb.unson.jp',
                redirect: 'https://evil.example/admin.html'
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
            .set('Accept', 'text/html')
            .expect(200);

        expect(res.text).toContain('const redirectTo = "/";');
        expect(res.text).not.toContain('https://evil.example/admin.html');
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
            .set('Accept', 'text/html')
            .expect(400);

        expect(res.body).toEqual({ error: 'Invalid state' });
        expect(res.text).not.toContain('window.location.replace');
        expect(res.text).not.toContain('href="/"');
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
            .expect(401);

        expect(res.body).toEqual({ error: 'Slack identity could not be resolved' });
        expect(authService.resolveSlackIdentity).toHaveBeenCalled();
    });
});
