import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { csrfMiddleware, csrfTokenHandler } from '../../../server/middleware/csrf.js';

function runGraphWrite(headers = {}) {
    const req = { method: 'POST', path: '/api/info/graph/entities', headers };
    let reached = false;
    let response = null;
    const res = {
        status(status) {
            return { json(payload) { response = { status, payload }; } };
        }
    };
    csrfMiddleware()(req, res, () => { reached = true; });
    return { reached, response };
}

function issueToken(sessionId) {
    let payload = null;
    csrfTokenHandler({ headers: { 'x-session-id': sessionId } }, { json(value) { payload = value; } });
    return payload.token;
}

describe('Graph write CSRF contract', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it('rejects a Bearer-authenticated Graph write without CSRF headers', () => {
        expect(runGraphWrite({ authorization: 'Bearer signed-token' })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'CSRF token required' } }
        });
    });

    it('allows the write only when the issued token uses the same session', () => {
        const sessionId = 'graph-write-contract-session';
        const token = issueToken(sessionId);
        expect(runGraphWrite({
            authorization: 'Bearer signed-token', 'x-session-id': sessionId, 'x-csrf-token': token
        })).toEqual({ reached: true, response: null });
        expect(runGraphWrite({
            authorization: 'Bearer signed-token', 'x-session-id': 'different-session', 'x-csrf-token': token
        })).toEqual({
            reached: false,
            response: { status: 403, payload: { error: 'Forbidden', message: 'Invalid CSRF token' } }
        });
    });
});
