// @ts-check
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { csrfMiddleware } from '../../server/middleware/csrf.js';

/** @param {Record<string, string | string[]>} [headers] */
function runMiddleware(headers = {}) {
    const middleware = csrfMiddleware();
    let nextCalled = false;
    let statusCode = null;
    const res = {
        status: (code) => {
            statusCode = code;
            return { json: () => {} };
        }
    };
    middleware({ method: 'POST', path: '/api/workflows/control/example', headers }, res, () => {
        nextCalled = true;
    });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware internal API key exemption', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInternalApiSecret = process.env.INTERNAL_API_SECRET;

    beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.INTERNAL_API_SECRET = 'internal-test-secret';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInternalApiSecret === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = originalInternalApiSecret;
    });

    it('allows a non-browser request with the configured internal API key', () => {
        const result = runMiddleware({ 'x-internal-api-key': 'internal-test-secret' });

        expect(result.nextCalled).toBe(true);
        expect(result.statusCode).not.toBe(403);
    });

    it('keeps rejecting a request with an incorrect internal API key', () => {
        const result = runMiddleware({ 'x-internal-api-key': 'incorrect-secret' });

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(403);
    });

    it('keeps rejecting a request without an internal API key', () => {
        const result = runMiddleware();

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(403);
    });

    it('keeps rejecting a multi-value internal API key header', () => {
        const result = runMiddleware({
            'x-internal-api-key': ['internal-test-secret', 'second-value']
        });

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(403);
    });

    it('does not allow an internal API key when the server secret is unset', () => {
        delete process.env.INTERNAL_API_SECRET;

        const result = runMiddleware({ 'x-internal-api-key': 'internal-test-secret' });

        expect(result.nextCalled).toBe(false);
        expect(result.statusCode).toBe(403);
    });
});
