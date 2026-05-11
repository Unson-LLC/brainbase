// @ts-check
import { describe, it, expect } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';

describe('x-provider INV-1: credentialKeySpec declares access_token/refresh_token', () => {
    it('INV-1: provider definition has credentialKeySpec', () => {
        const p = buildXProvider({ xClient: new InMemoryXClient() });
        expect(p.credentialKeySpec).toContain('access_token');
        expect(p.credentialKeySpec).toContain('refresh_token');
        expect(p.authMethods).toContain('oauth2_pkce');
    });
});
