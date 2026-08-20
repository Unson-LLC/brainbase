import { describe, expect, it, vi } from 'vitest';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function invoke(headers = {}) {
    const next = vi.fn();
    const status = vi.fn(() => ({ json: vi.fn() }));
    csrfMiddleware()({ method: 'POST', path: '/api/info/graph/maintenance/plans', headers }, { status }, next);
    return { next, status };
}

describe('Graph maintenance CSRF boundary', () => {
    it('Bearer machine requestだけをCSRFから免除する', () => {
        const bearer = invoke({ authorization: 'Bearer signed-token' });
        expect(bearer.next).toHaveBeenCalledOnce();

        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const cookieOnly = invoke({});
            expect(cookieOnly.next).not.toHaveBeenCalled();
            expect(cookieOnly.status).toHaveBeenCalledWith(403);
        } finally {
            process.env.NODE_ENV = previous;
        }
    });
});
