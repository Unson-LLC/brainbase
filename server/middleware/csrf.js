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
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            return next();
        }

        const token = req.headers['x-csrf-token'];
        const sessionId = req.headers['x-session-id'] || 'default';

        // In development, log warning but allow request
        if (process.env.NODE_ENV !== 'production') {
            if (!token) {
                console.warn(`[CSRF] Missing token for ${req.method} ${req.path}`);
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

        if (!validateCsrfToken(sessionId, token)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Invalid CSRF token'
            });
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
    const sessionId = req.headers['x-session-id'] || 'default';
    const token = generateCsrfToken(sessionId);
    res.json({ token });
}
