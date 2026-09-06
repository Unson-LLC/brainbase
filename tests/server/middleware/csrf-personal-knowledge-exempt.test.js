// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function runMiddleware({ method = 'POST', path, authorization, cookie } = {}) {
    let nextCalled = false;
    let statusCode = null;
    const response = {
        status(code) {
            statusCode = code;
            return { json() {} };
        }
    };
    const headers = {};
    if (authorization !== undefined) headers.authorization = authorization;
    if (cookie !== undefined) headers.cookie = cookie;

    csrfMiddleware()({ method, path, headers }, response, () => {
        nextCalled = true;
    });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware personal knowledge client exemptions', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = previousNodeEnv;
    });

    it.each([
        '/api/personal-knowledge/search',
        '/api/personal-knowledge/events'
    ])('allows the exact Bearer-authenticated POST %s', (path) => {
        expect(runMiddleware({
            path,
            authorization: 'Bearer bb_personal_knowledge_client'
        })).toEqual({ nextCalled: true, statusCode: null });
    });

    it.each([
        ['no authorization header', undefined, undefined],
        ['cookie-only authentication', undefined, 'session=browser-session'],
        ['empty authorization header', '', undefined],
        ['Bearer without a token', 'Bearer', undefined],
        ['Bearer with whitespace only', 'Bearer   ', undefined],
        ['malformed Bearer value', 'Bearer token with spaces', undefined],
        ['non-Bearer authorization', 'Basic credentials', undefined]
    ])('keeps %s protected by CSRF', (_label, authorization, cookie) => {
        expect(runMiddleware({
            path: '/api/personal-knowledge/search',
            authorization,
            cookie
        })).toEqual({ nextCalled: false, statusCode: 403 });
    });

    it.each([
        ['PUT', '/api/personal-knowledge/search'],
        ['PATCH', '/api/personal-knowledge/search'],
        ['DELETE', '/api/personal-knowledge/search'],
        ['POST', '/api/personal-knowledge/search/near-match'],
        ['POST', '/api/personal-knowledge/event'],
        ['POST', '/api/personal-knowledge/events/near-match'],
        ['POST', '/api/personal-knowledge/search/']
    ])('keeps neighboring request %s %s protected by CSRF', (method, path) => {
        expect(runMiddleware({
            method,
            path,
            authorization: 'Bearer bb_personal_knowledge_client'
        })).toEqual({ nextCalled: false, statusCode: 403 });
    });
});
