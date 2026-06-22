import { test, expect } from '@playwright/test';
import { csrfMiddleware } from '../../server/middleware/csrf.js';

// In-process e2e of the real csrfMiddleware (no browser): drive it with mock req/res/next in
// production mode and assert the report_activity exemption + that CSRF is still enforced elsewhere.

function runMiddleware(req: any) {
    const mw = csrfMiddleware();
    let nextCalled = false;
    let statusCode: number | null = null;
    const res: any = { status: (code: number) => { statusCode = code; return { json: () => {} }; } };
    mw(req, res, () => { nextCalled = true; });
    return { nextCalled, statusCode };
}

test.describe('story-csrf-exempt-report-activity', () => {
    test('AC: production POST report_activity without a token is allowed through', () => {
        // story-csrf-exempt-report-activity ac:1
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const { nextCalled, statusCode } = runMiddleware({ method: 'POST', path: '/api/sessions/report_activity', headers: {} });
            // In production a POST to the session activity report endpoint without a CSRF token is allowed through so trusted local hook activity telemetry is not dropped with a 403.
            expect(nextCalled, 'In production a POST to the session activity report endpoint without a CSRF token is allowed through so trusted local hook activity telemetry is not dropped with a 403.').toBe(true);
            expect(statusCode).not.toBe(403);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    test('AC: production other mutating endpoint without a token is still 403', () => {
        // story-csrf-exempt-report-activity ac:2
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const { nextCalled, statusCode } = runMiddleware({ method: 'POST', path: '/api/sessions/abc/input', headers: {} });
            // In production any other mutating endpoint without a CSRF token is still rejected with 403 so the exemption is scoped only to the activity telemetry endpoint.
            expect(statusCode, 'In production any other mutating endpoint without a CSRF token is still rejected with 403 so the exemption is scoped only to the activity telemetry endpoint.').toBe(403);
            expect(nextCalled).toBe(false);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    test('AC: production companion native handoff without a CSRF token is allowed through', () => {
        // story-companion-reply-draft-api ac:csrf-native-client
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const { nextCalled, statusCode } = runMiddleware({ method: 'POST', path: '/api/companion/reply-draft', headers: {} });
            expect(nextCalled, 'Native companion handoff uses bearer/service auth and is not a browser form POST, so CSRF middleware must not block the route before auth.').toBe(true);
            expect(statusCode).not.toBe(403);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});
