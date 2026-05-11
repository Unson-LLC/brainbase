// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';
import { _resetNoncesForTest } from '../../../server/services/account/provider-registry.js';

describe('x-provider AP-2: credential_ref must not embed secrets', () => {
    beforeEach(() => _resetNoncesForTest());

    it('AP-2: handleCallback returns credentialRef without access_token field', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient(), oauthSecret: 's' });
        const { state } = await p.startOAuth({ actor_person_id: 'sato', return_url: 'https://x' });
        const cb = await p.handleCallback({ state, code: 'c' });
        for (const k of ['access_token', 'refresh_token', 'api_key', 'password', 'secret', 'token']) {
            expect(cb.credentialRef[k]).toBeUndefined();
        }
        expect(cb.credentialRef.path).toBeTruthy();
    });
});
