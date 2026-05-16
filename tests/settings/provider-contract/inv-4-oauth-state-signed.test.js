// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import {
    signOAuthState,
    verifyOAuthState,
    generateNonce,
    _resetNoncesForTest
} from '../../../server/services/account/provider-registry.js';

describe('provider INV-4: OAuth state signed and one-time', () => {
    beforeEach(() => _resetNoncesForTest());

    it('INV-4: signed token round-trips', () => {
        const nonce = generateNonce();
        const token = signOAuthState({
            actor_person_id: 'sato', scope: 'personal', return_url: 'https://x', nonce
        }, 'secret');
        const r = verifyOAuthState(token, 'secret');
        expect(r.valid).toBe(true);
        expect(r.payload.actor_person_id).toBe('sato');
    });

    it('INV-4: tampered token rejected', () => {
        const token = signOAuthState({
            actor_person_id: 'sato', return_url: 'https://x', nonce: generateNonce()
        }, 'secret');
        const r = verifyOAuthState(token.replace(/.$/, 'x'), 'secret');
        expect(r.valid).toBe(false);
    });

    it('INV-4: nonce replay rejected', () => {
        const nonce = generateNonce();
        const token = signOAuthState({
            actor_person_id: 'sato', return_url: 'https://x', nonce
        }, 'secret');
        verifyOAuthState(token, 'secret');
        const second = verifyOAuthState(token, 'secret');
        expect(second.valid).toBe(false);
        expect(second.reason).toBe('nonce-replayed');
    });
});
