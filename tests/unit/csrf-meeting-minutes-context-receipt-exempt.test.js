// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../server/middleware/csrf.js';

function runMiddleware({ method = 'POST', path, authorization = null }) {
    let nextCalled = false;
    let statusCode = null;
    const response = {
        status(code) {
            statusCode = code;
            return { json() {} };
        }
    };
    const headers = authorization ? { authorization } : {};

    csrfMiddleware()({ method, path, headers }, response, () => { nextCalled = true; });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware meeting-minutes context receipt exemption', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = previousNodeEnv; });

    it('allows the exact Bearer-authenticated server-to-server POST', () => {
        expect(runMiddleware({
            path: '/api/meeting-minutes/context-receipts',
            authorization: 'Bearer bbsvc_mana-token'
        })).toEqual({ nextCalled: true, statusCode: null });
    });

    it.each([
        ['POST', '/api/meeting-minutes/context-receipts', null],
        ['PUT', '/api/meeting-minutes/context-receipts', 'Bearer bbsvc_mana-token'],
        ['POST', '/api/meeting-minutes/context-receipts/near-match', 'Bearer bbsvc_mana-token'],
        ['POST', '/api/meeting-minutes/context-receipt', 'Bearer bbsvc_mana-token']
    ])('keeps %s %s protected by CSRF', (method, path, authorization) => {
        expect(runMiddleware({ method, path, authorization })).toEqual({
            nextCalled: false,
            statusCode: 403
        });
    });
});
