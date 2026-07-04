import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileMeetingSourceMcpOAuthProvider } from '../../server/services/meeting-source/meeting-source-mcp-oauth-provider.js';

describe('meeting source MCP OAuth provider', () => {
    it('persists client information, tokens, and PKCE verifier per provider', () => {
        const dir = mkdtempSync(join(tmpdir(), 'brainbase-mcp-oauth-'));
        const storePath = join(dir, 'oauth.json');
        const provider = new FileMeetingSourceMcpOAuthProvider({
            provider: 'tactiq',
            redirectUrl: 'http://127.0.0.1:31087/oauth/callback',
            storePath
        });

        provider.saveClientInformation({ client_id: 'client-1', client_secret: 'secret-1' });
        provider.saveTokens({ access_token: 'token-1', token_type: 'Bearer' });
        provider.saveCodeVerifier('verifier-1');

        const reloaded = new FileMeetingSourceMcpOAuthProvider({
            provider: 'tactiq',
            redirectUrl: 'http://127.0.0.1:31087/oauth/callback',
            storePath
        });
        expect(reloaded.clientInformation()).toMatchObject({ client_id: 'client-1' });
        expect(reloaded.tokens()).toMatchObject({ access_token: 'token-1' });
        expect(reloaded.codeVerifier()).toBe('verifier-1');

        const fileBody = readFileSync(storePath, 'utf8');
        expect(fileBody).toContain('"tactiq"');
    });

    it('invalidates only the requested credential scope', () => {
        const dir = mkdtempSync(join(tmpdir(), 'brainbase-mcp-oauth-'));
        const storePath = join(dir, 'oauth.json');
        const provider = new FileMeetingSourceMcpOAuthProvider({
            provider: 'tactiq',
            redirectUrl: 'http://127.0.0.1:31087/oauth/callback',
            storePath
        });

        provider.saveClientInformation({ client_id: 'client-1' });
        provider.saveTokens({ access_token: 'token-1', token_type: 'Bearer' });
        provider.saveCodeVerifier('verifier-1');
        provider.invalidateCredentials('tokens');

        expect(provider.clientInformation()).toMatchObject({ client_id: 'client-1' });
        expect(provider.tokens()).toBeUndefined();
        expect(provider.codeVerifier()).toBe('verifier-1');
    });
});
