// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../server/middleware/csrf.js';

function runMiddleware({ method, path }) {
    const middleware = csrfMiddleware();
    let nextCalled = false;
    let statusCode = null;
    const response = {
        status(code) {
            statusCode = code;
            return { json() {} };
        }
    };
    middleware({ method, path, headers: {} }, response, () => { nextCalled = true; });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware Candidate Store raw-ledger exemption', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = previousNodeEnv; });

    it('allows only POST /api/candidate-store/raw-ledger without a CSRF token', () => {
        expect(runMiddleware({
            method: 'POST',
            path: '/api/candidate-store/raw-ledger'
        })).toEqual({
            nextCalled: true,
            statusCode: null
        });
    });

    it.each([
        ['PUT', '/api/candidate-store/raw-ledger'],
        ['PATCH', '/api/candidate-store/raw-ledger'],
        ['DELETE', '/api/candidate-store/raw-ledger'],
        ['POST', '/api/candidate-store/raw-ledger/near-match'],
        ['POST', '/api/candidate-store/other']
    ])('keeps %s %s protected by CSRF', (method, path) => {
        expect(runMiddleware({ method, path })).toEqual({
            nextCalled: false,
            statusCode: 403
        });
    });
});
