// @ts-check
import { describe, expect, it, vi } from 'vitest';

import { createGoogleWorkspaceAuthProvider } from '../../server/services/auth/providers/google-workspace-auth-provider.js';

describe('Google Workspace auth provider', () => {
    it('builds an OIDC authorization URL with hosted-domain and PKCE-safe parameters', () => {
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client',
            clientSecret: 'google-secret',
            redirectUri: 'https://api.example.test/api/auth/google/callback',
            allowedDomains: ['growin.jp']
        });

        const url = new URL(provider.buildAuthorizationUrl('state-1'));
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe('google-client');
        expect(url.searchParams.get('scope')).toBe('openid profile email');
        expect(url.searchParams.get('hd')).toBe('growin.jp');
        expect(url.searchParams.get('state')).toBe('state-1');
    });

    it('normalizes a verified member of the configured Workspace domain', () => {
        const provider = createGoogleWorkspaceAuthProvider({ allowedDomains: ['growin.jp'] });
        expect(provider.resolveIdentity({ userInfo: {
            sub: 'google-subject-1',
            email: 'kato@growin.jp',
            email_verified: true,
            hd: 'growin.jp',
            name: '加藤'
        } })).toEqual({
            provider: 'google-workspace',
            subject: 'kato@growin.jp',
            tenantId: 'growin.jp',
            externalSubjectId: 'kato@growin.jp',
            externalTenantId: 'growin.jp',
            email: 'kato@growin.jp',
            name: '加藤'
        });
    });

    it('fails closed for an unverified email or a user outside the Workspace domain', () => {
        const provider = createGoogleWorkspaceAuthProvider({ allowedDomains: ['growin.jp'] });
        expect(() => provider.resolveIdentity({ userInfo: {
            sub: 'subject', email: 'kato@growin.jp', email_verified: false, hd: 'growin.jp'
        } })).toThrow(/verified/i);
        expect(() => provider.resolveIdentity({ userInfo: {
            sub: 'subject', email: 'person@gmail.com', email_verified: true
        } })).toThrow(/domain/i);
    });

    it('exchanges the authorization code at the Google token endpoint', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            access_token: 'access', id_token: 'id-token'
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client', clientSecret: 'google-secret',
            redirectUri: 'https://api.example.test/api/auth/google/callback', fetchImpl
        });
        await expect(provider.exchangeCode('code-1')).resolves.toMatchObject({ access_token: 'access' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
