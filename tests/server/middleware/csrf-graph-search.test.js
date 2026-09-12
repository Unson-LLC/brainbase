import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function runMiddleware({ path, headers = {} }) {
    const req = {
        method: 'POST',
        path,
        headers
    };
    let reached = false;
    let statusCode = null;
    const res = {
        status(code) {
            statusCode = code;
            return { json: () => undefined };
        }
    };

    csrfMiddleware()(req, res, () => {
        reached = true;
    });

    return { reached, statusCode };
}

describe('Graph search CSRF boundary', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('allows the read-only Graph search POST for a bearer-authenticated agent client', () => {
        const result = runMiddleware({
            path: '/api/info/graph/search',
            headers: { authorization: 'Bearer signed-token' }
        });

        expect(result).toEqual({ reached: true, statusCode: null });
    });

    it('keeps browser-like requests without bearer authentication under CSRF validation', () => {
        const result = runMiddleware({
            path: '/api/info/graph/search'
        });

        expect(result).toEqual({ reached: false, statusCode: 403 });
    });

    it('does not broaden the exemption to Graph write POST endpoints', () => {
        const result = runMiddleware({
            path: '/api/info/graph/entities',
            headers: { authorization: 'Bearer signed-token' }
        });

        expect(result).toEqual({ reached: false, statusCode: 403 });
    });
});
