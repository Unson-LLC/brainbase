// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import { verifyOAuthState, _resetNoncesForTest } from '../../../server/services/account/provider-registry.js';

describe('provider AP-2: unsigned/malformed OAuth state rejected', () => {
    beforeEach(() => _resetNoncesForTest());

    it('AP-2: unsigned plaintext rejected as malformed', () => {
        const r = verifyOAuthState('plain-text', 'secret');
        expect(r.valid).toBe(false);
        expect(r.reason).toBe('malformed');
    });

    it('AP-2: fake JSON without HMAC rejected', () => {
        const fake = Buffer.from(JSON.stringify({ actor_person_id: 'attacker', nonce: 'x' }), 'utf8').toString('base64url') + '.deadbeef';
        const r = verifyOAuthState(fake, 'secret');
        expect(r.valid).toBe(false);
    });
});
