import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function run({ path = '/api/auth/organizations/switch', authorization } = {}) {
    const headers = authorization === undefined ? {} : { authorization };
    let reached = false;
    let response = null;
    const res = {
        status(status) {
            return { json(payload) { response = { status, payload }; } };
        }
    };

    csrfMiddleware()({ method: 'POST', path, headers }, res, () => { reached = true; });
    return { reached, response };
}

describe('organization switch CSRF contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it('allows the exact same-origin proxy endpoint with a non-empty Bearer credential', () => {
        expect(run({ authorization: 'Bearer signed-user-token' })).toEqual({ reached: true, response: null });
    });

    it.each([
        ['cookie-only requests', undefined],
        ['an empty Bearer credential', 'Bearer '],
        ['another authentication scheme', 'Basic signed-user-token']
    ])('keeps %s behind CSRF', (_label, authorization) => {
        expect(run({ authorization })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'CSRF token required' } }
        });
    });

    it('does not exempt neighbouring authentication writes', () => {
        expect(run({ path: '/api/auth/logout', authorization: 'Bearer signed-user-token' })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'CSRF token required' } }
        });
    });
});
