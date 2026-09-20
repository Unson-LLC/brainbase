import { describe, expect, it } from 'vitest';

import {
    getJwtExpiryMs,
    isAuthActive,
    resolveTokenExpiry,
    resolveTokenExpiryMs
} from '../../cli/token-expiry.js';

function unsignedJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.unsigned`;
}

describe('CLI token expiry bounds', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z');

    it('uses JWT exp as an upper bound without treating it as signature verification', () => {
        const token = unsignedJwt({ exp: now / 1000 + 3600 });

        expect(getJwtExpiryMs(token)).toBe(now + 3600 * 1000);
        expect(resolveTokenExpiry({
            token,
            expires_at: '2030-01-02T00:00:00.000Z',
            expires_in: 7200,
            now
        })).toBe('2030-01-01T01:00:00.000Z');
    });

    it('uses a positive expires_in when the response has no JWT exp or absolute expiry', () => {
        expect(resolveTokenExpiryMs({ expires_in: 3600, now })).toBe(now + 3600 * 1000);
    });

    it('returns no bound when token metadata is unusable', () => {
        expect(resolveTokenExpiry({ token: 'opaque-token' })).toBeNull();
    });

    it('rejects a legacy future fallback when the JWT has already expired', () => {
        const token = unsignedJwt({ exp: now / 1000 - 1 });

        expect(isAuthActive({
            token,
            expires_at: '2030-01-31T00:00:00.000Z'
        }, now)).toBe(false);
    });

    it('keeps opaque records without expiry metadata compatible', () => {
        expect(isAuthActive({ token: 'opaque-token' }, now)).toBe(true);
    });
});
