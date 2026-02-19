/**
 * CSRF Protection Middleware
 *
 * シンプルなCSRF対策実装。
 * - トークン生成・検証
 * - 開発環境では警告のみ（既存動作を壊さない）
 * - 本番環境では厳格に検証
 */

import crypto from 'crypto';

// Session-based token store (In production, use Redis or session store)
const tokens = new Map();

// Token expiration time (1 hour)
const TOKEN_EXPIRY = 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEVICE_FLOW_PATH_PREFIX = '/api/auth/device/';
const DEFAULT_SESSION_ID = 'default';

function isTokenExpired(createdAt, now = Date.now()) {
    return now - createdAt > TOKEN_EXPIRY;
}

function isSafeMethod(method) {
    return SAFE_METHODS.has(method);
}

function isDeviceCodeFlowPath(pathname) {
    return pathname.startsWith(DEVICE_FLOW_PATH_PREFIX);
}

function getSessionId(headers) {
    return headers['x-session-id'] || DEFAULT_SESSION_ID;
}

function respondForbidden(res, message) {
    return res.status(403).json({
        error: 'Forbidden',
        message
    });
}

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

    if (isTokenExpired(stored.createdAt)) {
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
        if (isTokenExpired(data.createdAt, now)) {
            tokens.delete(sessionId);
        }
    }
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
    return (req, res, next) => {
        // Skip safe methods
        if (isSafeMethod(req.method)) {
            return next();
        }

        // Skip Device Code Flow endpoints (CLI-based, no CSRF token available)
        if (isDeviceCodeFlowPath(req.path)) {
            return next();
        }

        const token = req.headers['x-csrf-token'];
        const sessionId = getSessionId(req.headers);

        // In development, log warning but allow request
        if (process.env.NODE_ENV !== 'production') {
            if (!token) {
                console.warn(`[CSRF] Missing token for ${req.method} ${req.path}`);
            }
            return next();
        }

        // In production, enforce CSRF validation
        if (!token) {
            return respondForbidden(res, 'CSRF token required');
        }

        if (!validateCsrfToken(sessionId, token)) {
            return respondForbidden(res, 'Invalid CSRF token');
        }

        next();
    };
}

/**
 * CSRF Token Endpoint Handler
 * GET /api/csrf-token でトークンを取得
 *
 * @param {Request} req
 * @param {Response} res
 */
export function csrfTokenHandler(req, res) {
    const sessionId = getSessionId(req.headers);
    const token = generateCsrfToken(sessionId);
    res.json({ token });
}
