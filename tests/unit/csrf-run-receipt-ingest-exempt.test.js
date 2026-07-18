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

describe('csrfMiddleware run receipt ingest exemption', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = previousNodeEnv; });

    it('POST /api/run-receipts/ingestだけをtoken無しで通す', () => {
        expect(runMiddleware({ method: 'POST', path: '/api/run-receipts/ingest' })).toEqual({
            nextCalled: true,
            statusCode: null
        });
    });

    it.each([
        ['PUT', '/api/run-receipts/ingest'],
        ['PATCH', '/api/run-receipts/ingest'],
        ['DELETE', '/api/run-receipts/ingest'],
        ['POST', '/api/run-receipts/ingest/near-match'],
        ['POST', '/api/run-receipts/other']
    ])('%s %sはexemptせず403を維持する', (method, path) => {
        expect(runMiddleware({ method, path })).toEqual({
            nextCalled: false,
            statusCode: 403
        });
    });
});
