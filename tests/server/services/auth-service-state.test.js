import { describe, expect, it } from 'vitest';

import { AuthService } from '../../../server/services/auth-service.js';

describe('AuthService OAuth state', () => {
    it('stores redirect in in-memory state for popup-blocked admin login fallback', () => {
        const authService = new AuthService();
        authService.stateSecret = '';

        const state = authService.createState({
            origin: 'http://127.0.0.1:31030',
            codeChallenge: 'challenge-123',
            redirect: '/admin.html'
        });

        expect(authService.consumeState(state)).toMatchObject({
            ok: true,
            origin: 'http://127.0.0.1:31030',
            codeChallenge: 'challenge-123',
            redirect: '/admin.html'
        });
    });

    it('binds a service id to OAuth state for incremental Google authorization', () => {
        const authService = new AuthService();
        authService.stateSecret = 'state-secret';

        const state = authService.createState({
            origin: 'http://127.0.0.1:31030',
            redirect: '/settings',
            service: 'gmail'
        });

        expect(authService.peekState(state)).toMatchObject({
            ok: true,
            service: 'gmail',
            redirect: '/settings'
        });
        expect(authService.consumeState(state)).toMatchObject({
            ok: true,
            service: 'gmail',
            redirect: '/settings'
        });
        expect(authService.consumeState(state)).toMatchObject({
            ok: false,
            service: null,
            redirect: null
        });
    });

    it('allows signed state inspection without consuming the one-time callback token', () => {
        const authService = new AuthService();
        authService.stateSecret = 'state-secret';
        const state = authService.createState({ service: 'google-calendar' });

        expect(authService.peekState(state)).toMatchObject({ ok: true, service: 'google-calendar' });
        expect(authService.peekState(state)).toMatchObject({ ok: true, service: 'google-calendar' });
        expect(authService.consumeState(state)).toMatchObject({ ok: true, service: 'google-calendar' });
        expect(authService.peekState(state)).toMatchObject({ ok: false, service: null });
    });

    it('stores redirect in signed state while preserving older state shapes', () => {
        const authService = new AuthService();
        authService.stateSecret = 'state-secret';

        const state = authService.createState({
            origin: 'http://127.0.0.1:31030',
            redirect: '/admin.html'
        });

        expect(authService.consumeState(state)).toMatchObject({
            ok: true,
            origin: 'http://127.0.0.1:31030',
            codeChallenge: null,
            redirect: '/admin.html',
            service: null
        });

        const legacyState = authService.createSignedState({
            origin: 'http://127.0.0.1:31030',
            codeChallenge: 'legacy-challenge'
        });
        expect(authService.consumeState(legacyState)).toMatchObject({
            ok: true,
            origin: 'http://127.0.0.1:31030',
            codeChallenge: 'legacy-challenge',
            redirect: null
        });
    });

    it('fails closed when signed state is missing required timestamp, nonce, or signature parts', () => {
        const authService = new AuthService();
        authService.stateSecret = 'state-secret';

        expect(authService.consumeState('')).toMatchObject({
            ok: false,
            origin: null,
            codeChallenge: null,
            redirect: null
        });
        expect(authService.consumeState('.nonce.signature')).toMatchObject({
            ok: false,
            origin: null,
            codeChallenge: null,
            redirect: null
        });
        expect(authService.consumeState('123..signature')).toMatchObject({
            ok: false,
            origin: null,
            codeChallenge: null,
            redirect: null
        });
        expect(authService.consumeState('123.nonce.')).toMatchObject({
            ok: false,
            origin: null,
            codeChallenge: null,
            redirect: null
        });
    });
});
