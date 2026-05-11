// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';
import { _resetNoncesForTest } from '../../../server/services/account/provider-registry.js';

describe('x-provider S-2: callback exchange', () => {
    beforeEach(() => _resetNoncesForTest());

    it('S-2: handleCallback returns credentialRef + external account info', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient(), oauthSecret: 'secret' });
        const { state } = await p.startOAuth({ actor_person_id: 'sato', return_url: 'https://x' });
        const cb = await p.handleCallback({ state, code: 'authcode123' });
        expect(cb.credentialRef.path).toMatch(/^\/integrations\/x\//);
        expect(cb.externalAccountId).toBe('x-user-authcode123');
        expect(cb.credentialRef.access_token).toBeUndefined();
    });
});
