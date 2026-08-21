import { describe, expect, it, vi } from 'vitest';
import { csrfMiddleware } from '../../../server/middleware/csrf.js';

function invoke(path, headers = {}) {
    const next = vi.fn();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    csrfMiddleware()({ method: 'POST', path, originalUrl: path, headers }, { status }, next);
    return { next, status, json };
}

describe('Ontology publication CSRF boundary', () => {
    it('署名付き公開承認のBearer machine requestだけをCSRFから免除する', () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const bearer = invoke('/api/info/ontology/publications/authorize', {
                authorization: 'Bearer signed-token'
            });
            expect(bearer.next).toHaveBeenCalledOnce();

            const cookieOnly = invoke('/api/info/ontology/publications/authorize');
            expect(cookieOnly.next).not.toHaveBeenCalled();
            expect(cookieOnly.status).toHaveBeenCalledWith(403);

            const siblingEndpoint = invoke('/api/info/ontology/validate', {
                authorization: 'Bearer signed-token'
            });
            expect(siblingEndpoint.next).not.toHaveBeenCalled();
            expect(siblingEndpoint.status).toHaveBeenCalledWith(403);
        } finally {
            process.env.NODE_ENV = previous;
        }
    });
});
