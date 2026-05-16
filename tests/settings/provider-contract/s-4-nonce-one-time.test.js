// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import {
    signOAuthState, verifyOAuthState, generateNonce, _resetNoncesForTest
} from '../../../server/services/account/provider-registry.js';

describe('provider S-4: nonce is one-time', () => {
    beforeEach(() => _resetNoncesForTest());

    it('S-4: second verify with same nonce rejected', () => {
        const nonce = generateNonce();
        const token = signOAuthState({
            actor_person_id: 'sato', return_url: 'https://x', nonce
        }, 'secret');
        const a = verifyOAuthState(token, 'secret');
        const b = verifyOAuthState(token, 'secret');
        expect(a.valid).toBe(true);
        expect(b.valid).toBe(false);
        expect(b.reason).toBe('nonce-replayed');
    });
});
