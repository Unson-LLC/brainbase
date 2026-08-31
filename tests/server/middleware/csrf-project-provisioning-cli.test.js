import { afterEach, describe, expect, it } from 'vitest';
import { csrfMiddleware, generateCsrfToken } from '../../../server/middleware/csrf.js';

describe('Project Provisioning CLI CSRF contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    function execute(headers) {
        let statusCode = null;
        let reached = false;
        csrfMiddleware()({
            method: 'POST', path: '/api/project-provisioning/check', headers
        }, {
            status(code) { statusCode = code; return this; },
            json() { return this; }
        }, () => { reached = true; });
        return { statusCode, reached };
    }

    it('productionでBearerだけのCLI mutationを拒否する', () => {
        process.env.NODE_ENV = 'production';
        expect(execute({ authorization: 'Bearer signed-token' })).toEqual({ statusCode: 403, reached: false });
    });

    it('同じsessionで取得したCSRF token付きCLI mutationを通す', () => {
        process.env.NODE_ENV = 'production';
        const sessionId = 'project-provisioning-cli-test';
        const token = generateCsrfToken(sessionId);
        expect(execute({
            authorization: 'Bearer signed-token',
            'x-session-id': sessionId,
            'x-csrf-token': token
        })).toEqual({ statusCode: null, reached: true });
    });
});
