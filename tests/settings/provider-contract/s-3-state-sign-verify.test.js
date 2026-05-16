// @ts-check
import { describe, it, expect, beforeEach } from 'vitest';
import {
    signOAuthState, verifyOAuthState, generateNonce, _resetNoncesForTest
} from '../../../server/services/account/provider-registry.js';

describe('provider S-3: sign + verify round trip', () => {
    beforeEach(() => _resetNoncesForTest());

    it('S-3: payload survives sign/verify', () => {
        const payload = {
            actor_person_id: 'sato',
            scope: 'org',
            org_id: 'unson',
            return_url: 'https://brainbase/callback',
            nonce: generateNonce()
        };
        const token = signOAuthState(payload, 'secret123');
        const r = verifyOAuthState(token, 'secret123');
        expect(r.valid).toBe(true);
        expect(r.payload).toMatchObject({
            actor_person_id: 'sato', org_id: 'unson'
        });
    });
});
