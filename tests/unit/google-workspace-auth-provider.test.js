// @ts-check
import { describe, expect, it, vi } from 'vitest';

import {
    createGoogleWorkspaceAuthProvider,
    GOOGLE_IDENTITY_SCOPES,
    GOOGLE_MEET_READ_SCOPES,
    GOOGLE_SERVICE_IDS,
    GOOGLE_SERVICE_SCOPES
} from '../../server/services/auth/providers/google-workspace-auth-provider.js';

describe('Google Workspace auth provider', () => {
    it('checks Google configuration without requiring Slack credentials', () => {
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client',
            clientSecret: 'google-secret',
            allowedDomains: ['growin.jp']
        });
        expect(() => provider.assertReady()).not.toThrow();
        expect(() => createGoogleWorkspaceAuthProvider({
            clientId: 'google-client',
            clientSecret: '',
            allowedDomains: ['growin.jp']
        }).assertReady()).toThrow(/client secret/i);
    });

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

    it('trims whitespace from OAuth credentials before token exchange', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            access_token: 'access', id_token: 'id-token'
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: ' google-client\n', clientSecret: ' google-secret\n',
            redirectUri: 'https://api.example.test/api/auth/google/callback', fetchImpl
        });

        await provider.exchangeCode('code-1');

        const body = fetchImpl.mock.calls[0][1].body;
        expect(body.get('client_id')).toBe('google-client');
        expect(body.get('client_secret')).toBe('google-secret');
    });

    it('keeps login scopes separate and builds incremental meeting-workflow consent', () => {
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client', clientSecret: 'google-secret',
            redirectUri: 'https://api.example.test/api/auth/google/callback',
            integrationRedirectUri: 'https://api.example.test/api/auth/google/meet/callback',
            allowedDomains: ['growin.jp']
        });

        const login = new URL(provider.buildAuthorizationUrl('login-state'));
        const meet = new URL(provider.buildMeetAuthorizationUrl('meet-state'));
        expect(login.searchParams.get('scope')).toBe('openid profile email');
        expect(meet.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_MEET_READ_SCOPES);
        expect(meet.searchParams.get('access_type')).toBe('offline');
        expect(meet.searchParams.get('include_granted_scopes')).toBe('true');
        expect(meet.searchParams.get('prompt')).toBe('consent');
        expect(meet.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/auth/google/meet/callback');
    });

    it('builds service-specific consent with the fixed allowlist and exact capability scope', () => {
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client', clientSecret: 'google-secret',
            redirectUri: 'https://api.example.test/api/auth/google/callback',
            integrationRedirectUri: 'https://api.example.test/api/auth/google/meet/callback',
            allowedDomains: ['growin.jp']
        });

        expect(GOOGLE_SERVICE_IDS).toEqual(['gmail', 'google-calendar', 'google-drive']);
        for (const service of GOOGLE_SERVICE_IDS) {
            const url = new URL(provider.buildGoogleServiceAuthorizationUrl(service, `${service}-state`));
            expect(url.searchParams.get('scope')?.split(' ')).toEqual([
                ...GOOGLE_IDENTITY_SCOPES,
                ...GOOGLE_SERVICE_SCOPES[service]
            ]);
            expect(url.searchParams.get('state')).toBe(`${service}-state`);
            expect(url.searchParams.get('redirect_uri')).toBe(
                'https://api.example.test/api/auth/google/meet/callback'
            );
        }
        expect(() => provider.buildGoogleServiceAuthorizationUrl('google-workspace', 'state'))
            .toThrow(/not supported/i);
    });

    it('allows incremental service token exchange without a refresh token', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            access_token: 'service-access'
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client', clientSecret: 'google-secret',
            integrationRedirectUri: 'https://api.example.test/api/auth/google/meet/callback',
            fetchImpl
        });

        await expect(provider.exchangeGoogleServiceCode('gmail', 'code-1'))
            .resolves.toEqual({ access_token: 'service-access' });
        expect(fetchImpl.mock.calls[0][1].body.get('redirect_uri')).toBe(
            'https://api.example.test/api/auth/google/meet/callback'
        );
    });

    it('exchanges and refreshes Meet credentials without changing the login flow', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-2', expires_in: 3600 }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({
            clientId: 'google-client', clientSecret: 'google-secret',
            integrationRedirectUri: 'https://api.example.test/api/auth/google/meet/callback', fetchImpl
        });

        await expect(provider.exchangeMeetCode('code-1')).resolves.toMatchObject({ refresh_token: 'refresh' });
        await expect(provider.refreshMeetAccessToken('refresh')).resolves.toMatchObject({ access_token: 'access-2' });
        expect(fetchImpl.mock.calls[0][1].body.get('redirect_uri')).toBe('https://api.example.test/api/auth/google/meet/callback');
        expect(fetchImpl.mock.calls[1][1].body.get('grant_type')).toBe('refresh_token');
    });

    it('lists Meet conference records through the read-only API', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            conferenceRecords: [{ name: 'conferenceRecords/abc' }]
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.listMeetConferenceRecords('access', { pageSize: 25 }))
            .resolves.toMatchObject({ conferenceRecords: [{ name: 'conferenceRecords/abc' }] });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(String(url)).toBe('https://meet.googleapis.com/v2/conferenceRecords?pageSize=25');
        expect(init.headers.Authorization).toBe('Bearer access');
    });

    it('lists Calendar events with attachment metadata through the read-only API', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            items: [{
                id: 'event-1',
                attachments: [{ fileId: 'doc-1', mimeType: 'application/vnd.google-apps.document' }]
            }]
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.listCalendarEvents('access', {
            calendarId: 'primary',
            timeMin: '2026-09-19T00:00:00.000Z',
            timeMax: '2026-09-20T00:00:00.000Z'
        })).resolves.toMatchObject({ items: [{ id: 'event-1' }] });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(String(url)).toContain('https://www.googleapis.com/calendar/v3/calendars/primary/events?');
        expect(String(url)).toContain('timeMin=2026-09-19T00%3A00%3A00.000Z');
        expect(String(url)).toContain('singleEvents=true');
        expect(init.headers.Authorization).toBe('Bearer access');
    });

    it('reads an attached Google Docs meeting note through the read-only API', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            documentId: 'doc-1',
            title: 'Growin meeting minutes',
            body: { content: [] }
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.getGoogleDocument('access', 'doc-1'))
            .resolves.toMatchObject({ documentId: 'doc-1' });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(String(url)).toBe('https://docs.googleapis.com/v1/documents/doc-1');
        expect(init.headers.Authorization).toBe('Bearer access');
    });

    it('lists Meet transcripts and transcript entries through the read-only API', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                transcripts: [{ name: 'conferenceRecords/conf-1/transcripts/transcript-1' }]
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                transcriptEntries: [{ name: 'conferenceRecords/conf-1/transcripts/transcript-1/entries/entry-1' }]
            }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await provider.listMeetTranscripts('access', 'conferenceRecords/conf-1');
        await provider.listMeetTranscriptEntries(
            'access',
            'conferenceRecords/conf-1/transcripts/transcript-1'
        );

        expect(String(fetchImpl.mock.calls[0][0])).toBe(
            'https://meet.googleapis.com/v2/conferenceRecords/conf-1/transcripts?pageSize=100'
        );
        expect(String(fetchImpl.mock.calls[1][0])).toBe(
            'https://meet.googleapis.com/v2/conferenceRecords/conf-1/transcripts/transcript-1/entries?pageSize=100'
        );
    });

    it('creates a Gmail draft without granting or calling Gmail send', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: 'draft-1', message: { id: 'message-1' }
        }), { status: 200 }));
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.createGmailDraft('access', 'base64url-message'))
            .resolves.toMatchObject({ id: 'draft-1' });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(String(url)).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ message: { raw: 'base64url-message' } });
        expect(GOOGLE_MEET_READ_SCOPES).toContain('https://www.googleapis.com/auth/gmail.compose');
        expect(GOOGLE_MEET_READ_SCOPES.some((scope) => scope.includes('gmail.send'))).toBe(false);
    });

    it('fails closed before calling Meet when the access token is missing', async () => {
        const fetchImpl = vi.fn();
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.listMeetConferenceRecords('')).rejects.toMatchObject({ code: 'access_token_missing' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fails closed for invalid Calendar and document identifiers', async () => {
        const fetchImpl = vi.fn();
        const provider = createGoogleWorkspaceAuthProvider({ fetchImpl });

        await expect(provider.listCalendarEvents('', {})).rejects.toMatchObject({ code: 'access_token_missing' });
        await expect(provider.getGoogleDocument('access', '../secret')).rejects.toMatchObject({ code: 'resource_name_invalid' });
        await expect(provider.listMeetTranscripts('access', 'spaces/not-a-record')).rejects.toMatchObject({ code: 'resource_name_invalid' });
        await expect(provider.createGmailDraft('access', '')).rejects.toMatchObject({ code: 'draft_message_missing' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
