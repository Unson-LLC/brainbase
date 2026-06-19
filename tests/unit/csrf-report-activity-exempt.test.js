// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { csrfMiddleware } from '../../server/middleware/csrf.js';

// /api/sessions/report_activity is posted by trusted LOCAL hooks/CLI (the activity-bridge hooks,
// scripts/lib/brainbase-common.sh, codex-pty-shim.py, …) via curl/fetch with NO browser CSRF
// token. CSRF protects against cross-site browser forgery, which does not apply to a localhost
// hook -> localhost server telemetry POST. Without an exemption these 403 in production (dropping
// every hook-driven session-activity report -> stale indicators) and spam a warn every interval in
// dev. The endpoint must be CSRF-exempt, while other mutating endpoints stay enforced.

function runMiddleware(req) {
    const mw = csrfMiddleware();
    let nextCalled = false;
    let statusCode = null;
    const res = {
        status: (code) => { statusCode = code; return { json: () => {} }; }
    };
    mw(req, res, () => { nextCalled = true; });
    return { nextCalled, statusCode };
}

describe('csrfMiddleware report_activity exemption', () => {
    const origEnv = process.env.NODE_ENV;
    beforeEach(() => { process.env.NODE_ENV = 'production'; });
    afterEach(() => { process.env.NODE_ENV = origEnv; vi.restoreAllMocks(); });

    it('S-007 本番でも /api/sessions/report_activity はトークン無しで CSRF を通す（ローカルフックのテレメトリ）', () => {
        const { nextCalled, statusCode } = runMiddleware({
            method: 'POST', path: '/api/sessions/report_activity', headers: {}
        });
        expect(nextCalled).toBe(true);
        expect(statusCode).not.toBe(403);
    });

    it('REGRESSION GUARD: 他の変更系エンドポイントは本番でトークン無しなら 403（CSRF 維持）', () => {
        const { nextCalled, statusCode } = runMiddleware({
            method: 'POST', path: '/api/sessions/abc/input', headers: {}
        });
        expect(statusCode).toBe(403);
        expect(nextCalled).toBe(false);
    });
});
