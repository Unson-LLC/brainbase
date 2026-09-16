import { describe, expect, it, vi } from 'vitest';

import {
    clearOAuthStateCookie,
    setAuthCookies,
    setOAuthStateCookie,
    verifyOAuthStateCookie
} from '../../../server/lib/auth-cookies.js';

function createResponse() {
    return {
        cookie: vi.fn(),
        clearCookie: vi.fn()
    };
}

describe('auth cookies', () => {
    it('does not treat a hostname with a localhost prefix as a local target', () => {
        const res = createResponse();

        setAuthCookies(res, {
            protocol: 'https',
            get: () => undefined
        }, {
            accessTtlSeconds: 3600
        }, {
            accessToken: 'access-token',
            targetOrigin: 'https://localhost.evil.example'
        });

        expect(res.cookie).toHaveBeenCalledWith(
            'brainbase_session',
            'access-token',
            expect.objectContaining({ secure: true })
        );
    });

    it('binds OAuth state to an HttpOnly SameSite cookie and verifies the callback value', () => {
        const res = createResponse();
        const req = {
            protocol: 'https',
            get: (name) => name.toLowerCase() === 'cookie'
                ? 'brainbase_oauth_state=Mn7o6m3u3l4Dx8mVzBBiJQ-7oWJ5kqFg6SgR_zrcyDw'
                : undefined
        };

        setOAuthStateCookie(res, req, 'state-123');

        expect(res.cookie).toHaveBeenCalledWith(
            'brainbase_oauth_state',
            expect.any(String),
            expect.objectContaining({
                httpOnly: true,
                sameSite: 'lax',
                secure: true,
                maxAge: 600000
            })
        );
        const cookieValue = res.cookie.mock.calls[0][1];
        expect(verifyOAuthStateCookie({
            headers: { cookie: `brainbase_oauth_state=${cookieValue}` }
        }, 'state-123')).toBe(true);
        expect(verifyOAuthStateCookie({
            headers: { cookie: `brainbase_oauth_state=${cookieValue}` }
        }, 'different-state')).toBe(false);
    });

    it('clears both Secure variants of the OAuth state cookie', () => {
        const res = createResponse();

        clearOAuthStateCookie(res);

        expect(res.clearCookie).toHaveBeenCalledTimes(2);
        expect(res.clearCookie).toHaveBeenCalledWith(
            'brainbase_oauth_state',
            expect.objectContaining({ secure: true })
        );
        expect(res.clearCookie).toHaveBeenCalledWith(
            'brainbase_oauth_state',
            expect.objectContaining({ secure: false })
        );
    });

    it.each([
        'http://localhost:31013',
        'http://127.0.0.1:31013',
        'http://[::1]:31013'
    ])('allows the Secure flag to be disabled for an exact loopback target: %s', (targetOrigin) => {
        const res = createResponse();

        setAuthCookies(res, {
            protocol: 'https',
            get: () => undefined
        }, {
            accessTtlSeconds: 3600
        }, {
            accessToken: 'access-token',
            targetOrigin
        });

        expect(res.cookie).toHaveBeenCalledWith(
            'brainbase_session',
            'access-token',
            expect.objectContaining({ secure: false })
        );
    });
});
