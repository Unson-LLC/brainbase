import { afterEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../server/middleware/csrf.js';

function invoke({ method, path, authorization }) {
    const req = { method, path, headers: authorization ? { authorization } : {} };
    let nextCalled = false;
    let response = null;
    const res = {
        status(status) {
            return { json(body) { response = { status, body }; } };
        },
        json(body) { response = { status: 200, body }; }
    };
    csrfMiddleware()(req, res, () => { nextCalled = true; });
    return { nextCalled, response };
}

describe('knowledge retrieve CSRF exemption', () => {
    const original = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = original; });

    it('exact Bearer POSTだけを通しpreviewや近接pathは保護する', () => {
        process.env.NODE_ENV = 'production';
        expect(invoke({ method: 'POST', path: '/api/knowledge/retrieve', authorization: 'Bearer token' }).nextCalled).toBe(true);
        expect(invoke({ method: 'POST', path: '/api/knowledge/retrieve-principal', authorization: 'Bearer token' }).nextCalled).toBe(true);
        expect(invoke({ method: 'POST', path: '/api/knowledge/preview', authorization: 'Bearer token' }).response?.status).toBe(403);
        expect(invoke({ method: 'POST', path: '/api/knowledge/retrieve/other', authorization: 'Bearer token' }).response?.status).toBe(403);
        expect(invoke({ method: 'POST', path: '/api/knowledge/retrieve-principal/other', authorization: 'Bearer token' }).response?.status).toBe(403);
        expect(invoke({ method: 'POST', path: '/api/knowledge/retrieve' }).response?.status).toBe(403);
    });
});
