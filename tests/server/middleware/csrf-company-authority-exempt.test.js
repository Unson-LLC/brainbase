import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function run({ method = 'POST', path = '/api/v1/runtime/company-authority:resolve', headers = {} } = {}) {
    let reached = false;
    let response = null;
    const res = {
        status(status) {
            return { json(payload) { response = { status, payload }; } };
        }
    };
    csrfMiddleware()({ method, path, headers }, res, () => { reached = true; });
    return { reached, response };
}

describe('Company Authority CSRF contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it('allows the exact private runtime route with a Bearer service credential', () => {
        expect(run({ headers: { authorization: 'Bearer service-token' } })).toEqual({
            reached: true,
            response: null
        });
    });

    it.each([
        [{}, '/api/v1/runtime/company-authority:resolve', 'POST'],
        [{ authorization: 'Bearer service-token' }, '/api/v1/runtime/company-authority:resolve/other', 'POST'],
        [{ authorization: 'Bearer service-token' }, '/api/v1/runtime/company-authority:resolve', 'PUT']
    ])('does not broaden the exemption', (headers, path, method) => {
        expect(run({ headers, path, method })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'CSRF token required' } }
        });
    });
});
