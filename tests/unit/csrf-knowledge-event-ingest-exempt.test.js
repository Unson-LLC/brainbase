// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../server/middleware/csrf.js';

function runMiddleware({ method = 'POST', path, authorization }) {
    let nextCalled = false;
    let statusCode = null;
    const response = {
        status(code) {
            statusCode = code;
            return { json() {} };
        }
    };
    const headers = authorization === undefined ? {} : { authorization };

    csrfMiddleware()({ method, path, headers }, response, () => {
        nextCalled = true;
    });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware knowledge event ingest exemption', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = previousNodeEnv;
    });

    it('allows the exact POST with a non-empty Bearer token', () => {
        expect(runMiddleware({
            path: '/api/knowledge/events',
            authorization: 'Bearer bbsvc_knowledge-event-token'
        })).toEqual({ nextCalled: true, statusCode: null });
    });

    it.each([
        ['no authorization header', undefined],
        ['empty authorization header', ''],
        ['Bearer without a token', 'Bearer'],
        ['Bearer with whitespace only', 'Bearer   '],
        ['malformed Bearer value', 'Bearer token with spaces'],
        ['non-Bearer authorization', 'Basic credentials']
    ])('keeps %s protected by CSRF', (_label, authorization) => {
        expect(runMiddleware({
            path: '/api/knowledge/events',
            authorization
        })).toEqual({ nextCalled: false, statusCode: 403 });
    });

    it.each([
        ['PUT', '/api/knowledge/events'],
        ['PATCH', '/api/knowledge/events'],
        ['DELETE', '/api/knowledge/events'],
        ['POST', '/api/knowledge/events/near-match'],
        ['POST', '/api/knowledge/event']
    ])('keeps neighboring request %s %s protected by CSRF', (method, path) => {
        expect(runMiddleware({
            method,
            path,
            authorization: 'Bearer bbsvc_knowledge-event-token'
        })).toEqual({ nextCalled: false, statusCode: 403 });
    });
});
