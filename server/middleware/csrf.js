// @ts-check
/**
 * CSRF Protection Middleware
 *
 * シンプルなCSRF対策実装。
 * - トークン生成・検証
 * - 開発環境では警告のみ（既存動作を壊さない）
 * - 本番環境では厳格に検証
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { isDedicatedSlackInstallationExchangeRequest } from '../services/multitenant/slack-installation-auth.js';

/** @typedef {{ token: string, createdAt: number }} StoredToken */
/** @typedef {{ method?: string, path?: string, headers?: Record<string, string | string[] | undefined> }} RequestLike */
/** @typedef {{ json: (body: unknown) => unknown, status: (code: number) => { json: (body: unknown) => unknown } }} ResponseLike */
/** @typedef {(error?: unknown) => unknown} NextLike */

// Session-based token store (In production, use Redis or session store)
/** @type {Map<string, StoredToken>} */
const tokens = new Map();

// Token expiration time (1 hour)
const TOKEN_EXPIRY = 60 * 60 * 1000;
const DEV_WARNING_INTERVAL = 60 * 1000;
/** @type {Map<string, number>} */
const devWarningLastLoggedAt = new Map();

/**
 * Generate a new CSRF token
 * @param {string} sessionId - Session identifier
 * @returns {string} CSRF token
 */
export function generateCsrfToken(sessionId) {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(sessionId, {
        token,
        createdAt: Date.now()
    });
    return token;
}

/**
 * Validate a CSRF token
 * @param {string} sessionId - Session identifier
 * @param {string} token - Token to validate
 * @returns {boolean} True if valid
 */
export function validateCsrfToken(sessionId, token) {
    const stored = tokens.get(sessionId);
    if (!stored) return false;

    // Check expiration
    if (Date.now() - stored.createdAt > TOKEN_EXPIRY) {
        tokens.delete(sessionId);
        return false;
    }

    return stored.token === token;
}

/**
 * Clean up expired tokens
 */
export function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [sessionId, data] of tokens.entries()) {
        if (now - data.createdAt > TOKEN_EXPIRY) {
            tokens.delete(sessionId);
        }
    }

    for (const [key, lastLoggedAt] of devWarningLastLoggedAt.entries()) {
        if (now - lastLoggedAt > DEV_WARNING_INTERVAL * 2) {
            devWarningLastLoggedAt.delete(key);
        }
    }
}

function warnOncePerInterval(message, key) {
    const now = Date.now();
    const lastLoggedAt = devWarningLastLoggedAt.get(key) || 0;
    if (now - lastLoggedAt < DEV_WARNING_INTERVAL) {
        return;
    }
    devWarningLastLoggedAt.set(key, now);
    logger.warn(message);
}

function hasValidInternalApiKey(req) {
    const configuredKey = process.env.INTERNAL_API_SECRET;
    const headerValue = req.headers?.['x-internal-api-key'];
    if (!configuredKey || typeof headerValue !== 'string') return false;

    const configuredBuffer = Buffer.from(configuredKey);
    const requestBuffer = Buffer.from(headerValue);
    return configuredBuffer.length === requestBuffer.length
        && crypto.timingSafeEqual(configuredBuffer, requestBuffer);
}

// Run cleanup every 15 minutes
setInterval(cleanupExpiredTokens, 15 * 60 * 1000);

/**
 * CSRF Protection Middleware
 *
 * POST/PUT/DELETE リクエストに対してCSRFトークンを検証。
 * 開発環境では警告のみ、本番環境では403エラーを返す。
 *
 * @returns {Function} Express middleware
 */
export function csrfMiddleware() {
    /** @type {(req: RequestLike, res: ResponseLike, next: NextLike) => unknown} */
    return (req, res, next) => {
        // Skip safe methods
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) {
            return next();
        }

        // This exact machine-to-machine OAuth exchange is authenticated by a
        // dedicated, fully verified service JWT. The route guard repeats the
        // same verification after this global middleware. No user/browser JWT,
        // generic service token, or neighbouring route is exempted.
        if (isDedicatedSlackInstallationExchangeRequest(req)) {
            return next();
        }

        // Internal service requests are authenticated by the same secret checked by
        // requireAuth. They are not browser-originated and cannot obtain a CSRF token.
        if (hasValidInternalApiKey(req)) {
            return next();
        }

        // Skip Device Code Flow endpoints (CLI-based, no CSRF token available)
        if (req.path?.startsWith('/api/auth/device/')) {
            return next();
        }

        // External runner ingest is a server-to-server API guarded by workflow auth
        // (bearer/service/internal key). It cannot rely on browser session CSRF tokens.
        if (req.path?.startsWith('/api/external-runner/')) {
            return next();
        }

        // Run receipt ingest is the sole server-to-server endpoint in this route
        // family. The route itself rejects cookie/session-only authentication.
        if (req.method === 'POST' && req.path === '/api/run-receipts/ingest') {
            return next();
        }

        // Candidate Store raw-ledger ingest is a machine-to-machine endpoint.
        // The mounted route authenticates the exact raw request body with its
        // source-specific HMAC, so a browser CSRF token is neither available nor
        // part of this endpoint's trust boundary. Keep the exemption exact so
        // other Candidate Store mutations remain protected by default.
        if (req.method === 'POST' && req.path === '/api/candidate-store/raw-ledger') {
            return next();
        }

        // Brainbase Mac Companion is a native/server client API guarded by bearer,
        // service-token, or internal header auth. It cannot rely on browser CSRF tokens.
        if (req.path?.startsWith('/api/companion/')) {
            return next();
        }

        // Judgment resolution is called by managed agent hosts with a Bearer
        // service token plus a request-bound HMAC. Browser cookie fallback must
        // remain behind CSRF, while the exact machine endpoint can proceed to
        // requireAuth and host-binding verification.
        if (
            req.method === 'POST'
            && req.path === '/api/judgment/resolve'
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Knowledge resolution is a read-only routing request from the MCP host.
        // The exact machine endpoint proceeds to strict Bearer authentication and
        // project-scope authorization; browser cookie fallback remains behind CSRF.
        if (
            req.method === 'POST'
            && req.path === '/api/knowledge/resolve'
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Meeting-minutes context receipts are created by the mana runtime over
        // Bearer-authenticated server-to-server HTTP. Keep this exemption exact;
        // the mounted route still requires a service/internal identity and checks
        // project access before creating a receipt.
        if (
            req.method === 'POST'
            && req.path === '/api/meeting-minutes/context-receipts'
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Routine execution is invoked by the repository-managed runner over
        // Bearer-authenticated server-to-server HTTP. Keep the exemption exact;
        // the mounted route still enforces authentication, brainbase project
        // scope, and the personal proxy identity before executing a routine.
        if (
            req.method === 'POST'
            && /^\/api\/routines\/(?:ohayo|oyasumi|retro)\/execute$/.test(req.path || '')
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Admin context preview is read-only but uses POST for its structured query.
        // Agent/native clients authenticate with a bearer token and do not have a
        // browser CSRF session. Authentication and project scope are still enforced
        // by the route's requireAuth middleware and AdminVisualizationService.
        if (
            req.method === 'POST'
            && req.path === '/api/admin/context-preview'
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Onboarding MCP calls are non-cookie service requests. The mounted route still
        // verifies the bearer token and project scope with requireAuth; this exemption
        // only avoids requiring a browser CSRF session that the MCP client cannot hold.
        if (
            req.path?.startsWith('/api/onboarding/')
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Graph maintenance is a machine-only API. The controller rejects cookie
        // auth and requires a signed tenant identity plus project authorization.
        const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
        if (
            requestPath.startsWith('/api/info/graph/maintenance/')
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        // Ontology publication authorization is called by the non-cookie release
        // publisher. The exact route still verifies the bearer principal, Graph
        // Decision/RACI bindings, and the signing authority before issuing a receipt.
        if (
            requestPath === '/api/info/ontology/publications/authorize'
            && typeof req.headers?.authorization === 'string'
            && req.headers.authorization.startsWith('Bearer ')
        ) {
            return next();
        }

        const tokenHeader = req.headers?.['x-csrf-token'];
        const sessionHeader = req.headers?.['x-session-id'];
        const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
        const sessionId = Array.isArray(sessionHeader) ? (sessionHeader[0] || 'default') : (sessionHeader || 'default');

        // In development, log warning but allow request
        if (process.env.NODE_ENV !== 'production') {
            if (!token) {
                warnOncePerInterval(
                    `[CSRF] Missing token for ${req.method} ${req.path}`,
                    `${req.method || 'UNKNOWN'}:${req.path || 'unknown'}`
                );
            }
            return next();
        }

        // In production, enforce CSRF validation
        if (!token) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'CSRF token required'
            });
        }

        if (!token || !validateCsrfToken(sessionId, token)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Invalid CSRF token'
            });
        }

        return next();
    };
}

/**
 * CSRF Token Endpoint Handler
 * GET /api/csrf-token でトークンを取得
 *
 * @param {RequestLike} req
 * @param {ResponseLike} res
 */
export function csrfTokenHandler(req, res) {
    const sessionHeader = req.headers?.['x-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? (sessionHeader[0] || 'default') : (sessionHeader || 'default');
    const token = generateCsrfToken(sessionId);
    res.json({ token });
}
