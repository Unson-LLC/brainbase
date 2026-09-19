import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function run({
    path = '/api/organization-connections/slack/start',
    method = 'POST',
    authorization
} = {}) {
    const headers = authorization === undefined ? {} : { authorization };
    let reached = false;
    let response = null;
    const res = {
        status(status) {
            return { json(payload) { response = { status, payload }; } };
        }
    };

    csrfMiddleware()({ method, path, originalUrl: path, headers }, res, () => { reached = true; });
    return { reached, response };
}

describe('organization connection start CSRF contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it.each(['slack', 'github'])('allows the exact %s start route with a Bearer credential', (provider) => {
        expect(run({
            path: `/api/organization-connections/${provider}/start?source=bff`,
            authorization: 'Bearer signed-user-token'
        })).toEqual({ reached: true, response: null });
    });

    it.each([
        ['cookie-only requests', undefined, '/api/organization-connections/slack/start'],
        ['a neighboring organization write', 'Bearer signed-user-token', '/api/organization-connections/slack/status'],
        ['an unsupported provider', 'Bearer signed-user-token', '/api/organization-connections/notion/start'],
        ['a neighboring path', 'Bearer signed-user-token', '/api/organization-connections/github/start/extra'],
        ['a different method', 'Bearer signed-user-token', '/api/organization-connections/github/start', 'PUT']
    ])('keeps %s behind CSRF', (_label, authorization, path, method = 'POST') => {
        expect(run({ authorization, path, method })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'CSRF token required' } }
        });
    });
});
