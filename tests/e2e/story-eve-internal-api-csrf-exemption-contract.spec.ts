import { expect, test } from '@playwright/test';
import { requireAuth } from '../../server/middleware/auth.js';
import { csrfMiddleware } from '../../server/middleware/csrf.js';

function runProductionChain(headers: Record<string, string> = {}) {
    const req: any = {
        method: 'POST',
        path: '/api/workflows/control/loop-intents/exact-run/eve-session',
        headers
    };
    let statusCode: number | null = null;
    let routeReached = false;
    const res: any = {
        status: (code: number) => {
            statusCode = code;
            return { json: () => undefined };
        }
    };
    const authService = {
        verifyToken: () => {
            throw new Error('Bearer verification must not be used for internal API key auth');
        }
    };

    csrfMiddleware()(req, res, () => {
        requireAuth(authService)(req, res, () => {
            routeReached = true;
        });
    });

    return { req, routeReached, statusCode };
}

test.describe('story-eve-internal-api-csrf-exemption', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInternalApiSecret = process.env.INTERNAL_API_SECRET;

    test.beforeEach(() => {
        process.env.NODE_ENV = 'production';
        process.env.INTERNAL_API_SECRET = 'e2e-internal-secret';
    });

    test.afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInternalApiSecret === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = originalInternalApiSecret;
    });

    test('AC-001 ac:1 exact internal key passes CSRF and authenticates as internal service', () => {
        const result = runProductionChain({ 'x-internal-api-key': 'e2e-internal-secret' });

        expect(result.statusCode).toBeNull();
        expect(result.routeReached).toBe(true);
        expect(result.req.authSource).toBe('internal');
        expect(result.req.access?.employmentType).toBe('internal_service');
    });

    test('AC-002 ac:2 wrong key fails closed before route authority', () => {
        const result = runProductionChain({ 'x-internal-api-key': 'wrong-secret' });

        expect(result.statusCode).toBe(403);
        expect(result.routeReached).toBe(false);
        expect(result.req.authSource).toBeUndefined();
    });

    test('AC-003 ac:3 browser request without internal key remains under CSRF validation', () => {
        const result = runProductionChain();

        expect(result.statusCode).toBe(403);
        expect(result.routeReached).toBe(false);
        expect(result.req.authSource).toBeUndefined();
    });

    test('AC-004 ac:4 exact-run workflow POST reaches its route through the production middleware order', () => {
        const result = runProductionChain({ 'x-internal-api-key': 'e2e-internal-secret' });

        expect(result.req.path).toBe('/api/workflows/control/loop-intents/exact-run/eve-session');
        expect(result.statusCode).toBeNull();
        expect(result.routeReached).toBe(true);
    });
});
