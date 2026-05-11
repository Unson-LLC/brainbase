// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { buildXProvider } from '../../../server/services/sns/providers/x-provider.js';
import { InMemoryXClient } from '../../../server/services/sns/providers/x-client.js';
import { _resetNoncesForTest } from '../../../server/services/account/provider-registry.js';

describe('x-provider INV-2: OAuth state signed', () => {
    beforeEach(() => _resetNoncesForTest());

    it('INV-2: startOAuth returns signed state, handleCallback verifies', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient(), oauthSecret: 's' });
        const { state } = await p.startOAuth({
            actor_person_id: 'sato',
            scope: 'personal',
            return_url: 'https://brainbase/callback'
        });
        expect(state).toMatch(/\./); // body.sig
        const cb = await p.handleCallback({ state, code: 'abc' });
        expect(cb.statePayload.actor_person_id).toBe('sato');
    });

    it('INV-2: tampered state in callback throws', async () => {
        const p = buildXProvider({ xClient: new InMemoryXClient(), oauthSecret: 's' });
        const { state } = await p.startOAuth({
            actor_person_id: 'sato', return_url: 'https://x'
        });
        await expect(p.handleCallback({ state: state.slice(0, -2) + 'xx', code: 'a' })).rejects.toThrow();
    });
});
