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

describe('csrfMiddleware routine execution exemption', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = previousNodeEnv; });

    it.each(['ohayo', 'oyasumi', 'retro'])('BearerサービスからPOST /api/routines/%s/executeを通す', (routine) => {
        expect(runMiddleware({
            path: `/api/routines/${routine}/execute`,
            authorization: 'Bearer bbsvc_routine-token'
        })).toEqual({ nextCalled: true, statusCode: null });
    });

    it.each([
        ['POST', '/api/routines/ohayo/execute', null],
        ['PUT', '/api/routines/ohayo/execute', 'Bearer bbsvc_routine-token'],
        ['POST', '/api/routines/unknown/execute', 'Bearer bbsvc_routine-token'],
        ['POST', '/api/routines/ohayo/execute/near-match', 'Bearer bbsvc_routine-token'],
        ['POST', '/api/routines/ohayo', 'Bearer bbsvc_routine-token']
    ])('%s %sはCSRF免除を広げない', (method, path, authorization) => {
        expect(runMiddleware({ method, path, authorization })).toEqual({
            nextCalled: false,
            statusCode: 403
        });
    });
});
