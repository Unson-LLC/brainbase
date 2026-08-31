// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    SlackAuthProviderError,
    createSlackAuthProvider
} from '../../server/services/auth/providers/slack-auth-provider.js';

function response(body, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        text: vi.fn(async () => typeof body === 'string' ? body : JSON.stringify(body))
    };
}

describe('createSlackAuthProvider', () => {
    it('builds an OIDC authorization URL without putting the client secret in it', () => {
        const provider = createSlackAuthProvider({
            mode: 'oidc',
            clientId: 'client-123',
            clientSecret: 'secret-must-not-leak',
            redirectUri: 'https://brainbase.example.invalid/api/auth/slack/callback',
            scopes: 'openid profile email'
        });

        const url = new URL(provider.buildAuthorizationUrl('signed-state'));

        expect(url.origin).toBe('https://slack.com');
        expect(url.pathname).toBe('/openid/connect/authorize');
        expect(url.searchParams.get('client_id')).toBe('client-123');
        expect(url.searchParams.get('redirect_uri'))
            .toBe('https://brainbase.example.invalid/api/auth/slack/callback');
        expect(url.searchParams.get('state')).toBe('signed-state');
        expect(url.searchParams.get('scope')).toBe('openid profile email');
        expect(url.searchParams.get('user_scope')).toBeNull();
        expect(url.toString()).not.toContain('secret-must-not-leak');
    });

    it('supports legacy Slack OAuth mode and its user scopes', () => {
        const provider = createSlackAuthProvider({
            mode: 'oauth',
            clientId: 'client-123',
            clientSecret: 'secret',
            redirectUri: 'https://brainbase.example.invalid/callback',
            userScopes: 'identity.basic'
        });

        const url = new URL(provider.buildAuthorizationUrl('state-123'));

        expect(provider.authMethods).toEqual(['oauth2_confidential']);
        expect(url.pathname).toBe('/oauth/v2/authorize');
        expect(url.searchParams.get('user_scope')).toBe('identity.basic');
    });

    it('resolves an OIDC identity into the provider-neutral shape', () => {
        const provider = createSlackAuthProvider({ mode: 'oidc' });

        const identity = provider.resolveIdentity({
            tokenPayload: {},
            userInfo: {
                sub: 'U123',
                team_id: 'T123',
                email: 'sato@example.com',
                name: 'Sato'
            }
        });

        expect(identity).toEqual({
            provider: 'slack',
            subject: 'U123',
            tenantId: 'T123',
            externalSubjectId: 'U123',
            externalTenantId: 'T123',
            email: 'sato@example.com',
            name: 'Sato',
            slackUserId: 'U123',
            slackWorkspaceId: 'T123'
        });
    });

    it('resolves a legacy OAuth identity from authed_user and team claims', () => {
        const provider = createSlackAuthProvider({ mode: 'oauth' });

        const identity = provider.resolveIdentity({
            tokenPayload: {
                authed_user: { id: 'U456' },
                team: { id: 'T456' }
            }
        });

        expect(identity.subject).toBe('U456');
        expect(identity.tenantId).toBe('T456');
    });

    it('keeps the legacy Slack identity method available during migration', () => {
        const provider = createSlackAuthProvider({ mode: 'oauth' });

        expect(provider.resolveSlackIdentity(
            { authed_user: { id: 'U456' }, team: { id: 'T456' } },
            null
        )).toEqual({
            slackUserId: 'U456',
            slackWorkspaceId: 'T456'
        });
    });

    it('derives the callback URI from a forwarded request host when one is supplied', () => {
        const provider = createSlackAuthProvider({
            clientId: 'client-123',
            redirectUri: 'https://configured.example.invalid/callback'
        });

        expect(provider.resolveRedirectUri({
            headers: {
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'tenant.example.invalid'
            }
        })).toBe('https://tenant.example.invalid/api/auth/slack/callback');
    });

    it('fails closed when Slack does not provide both user and workspace identity', () => {
        const provider = createSlackAuthProvider();

        expect(() => provider.resolveIdentity({
            tokenPayload: { sub: 'U123' },
            userInfo: {}
        })).toThrow(SlackAuthProviderError);
    });

    it('exchanges a code with Slack using the configured redirect URI', async () => {
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.method).toBe('POST');
            expect(init.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
            const body = new URLSearchParams(init.body);
            expect(body.get('client_id')).toBe('client-123');
            expect(body.get('client_secret')).toBe('secret');
            expect(body.get('redirect_uri')).toBe('https://brainbase.example.invalid/callback');
            expect(body.get('code')).toBe('code-123');
            return response({ ok: true, access_token: 'xoxb-token' });
        });
        const provider = createSlackAuthProvider({
            mode: 'oidc',
            clientId: 'client-123',
            clientSecret: 'secret',
            redirectUri: 'https://brainbase.example.invalid/callback',
            fetchImpl
        });

        await expect(provider.exchangeCode('code-123')).resolves.toEqual({
            ok: true,
            access_token: 'xoxb-token'
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('turns Slack HTTP and API errors into a provider error without returning credentials', async () => {
        const fetchImpl = vi.fn(async () => response({ ok: false, error: 'invalid_code' }));
        const provider = createSlackAuthProvider({
            clientId: 'client-123',
            clientSecret: 'secret',
            redirectUri: 'https://brainbase.example.invalid/callback',
            fetchImpl
        });

        await expect(provider.exchangeCode('bad-code'))
            .rejects.toMatchObject({
                name: 'SlackAuthProviderError',
                code: 'provider_exchange_failed'
            });
        await expect(provider.exchangeCode('bad-code')).rejects.not.toThrow('secret');
    });

    it('fetches OIDC user info with a bearer access token', async () => {
        const fetchImpl = vi.fn(async (url, init) => {
            expect(url).toBe('https://slack.com/api/openid.connect.userInfo');
            expect(init.headers).toEqual({ Authorization: 'Bearer xoxb-token' });
            return response({ sub: 'U123', team_id: 'T123' });
        });
        const provider = createSlackAuthProvider({ fetchImpl });

        await expect(provider.fetchUserInfo('xoxb-token')).resolves.toEqual({
            sub: 'U123',
            team_id: 'T123'
        });
    });

    it('rejects malformed Slack responses with the operation-specific error code', async () => {
        const fetchImpl = vi.fn(async () => response('not-json'));
        const provider = createSlackAuthProvider({
            clientId: 'client-123',
            clientSecret: 'secret',
            redirectUri: 'https://brainbase.example.invalid/callback',
            fetchImpl
        });

        await expect(provider.exchangeCode('code-123')).rejects.toMatchObject({
            name: 'SlackAuthProviderError',
            code: 'provider_exchange_failed'
        });
    });
});
