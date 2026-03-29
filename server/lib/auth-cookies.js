// @ts-check
const ACCESS_COOKIE_NAME = 'brainbase_session';
const REFRESH_COOKIE_NAME = 'brainbase_refresh';

/**
 * @typedef {Object} RequestLike
 * @property {(name: string) => string | undefined} [get]
 * @property {Record<string, string | string[] | undefined>} [headers]
 * @property {Record<string, string>} [cookies]
 * @property {string} [protocol]
 */

/**
 * @typedef {Object} ResponseLike
 * @property {(name: string, value: string, options: Record<string, unknown>) => void} cookie
 * @property {(name: string, options: Record<string, unknown>) => void} clearCookie
 */

/** @typedef {{ accessTtlSeconds?: number, refreshTtlSeconds?: number }} AuthServiceLike */

/**
 * @param {RequestLike | null | undefined} req
 * @param {string} name
 */
export function getHeader(req, name) {
    if (!req) return '';
    if (typeof req.get === 'function') {
        return req.get(name) || '';
    }
    const key = String(name).toLowerCase();
    const headers = req.headers || {};
    const value = headers[key];
    if (Array.isArray(value)) return value[0] || '';
    return value || '';
}

function isLocalHost(host = '') {
    return host.startsWith('localhost')
        || host.startsWith('127.0.0.1')
        || host.startsWith('[::1]');
}

/**
 * @param {RequestLike | null | undefined} req
 * @returns {boolean}
 */
function isSecureRequest(req) {
    const proto = getHeader(req, 'x-forwarded-proto') || req?.protocol || '';
    const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || '';
    if (String(proto).toLowerCase() === 'https') return true;
    return Boolean(host) && !isLocalHost(String(host).toLowerCase());
}

/**
 * @param {string} [cookieHeader]
 * @returns {Record<string, string>}
 */
export function parseCookieHeader(cookieHeader = '') {
    /** @type {Record<string, string>} */
    const parsed = {};
    if (!cookieHeader || typeof cookieHeader !== 'string') {
        return parsed;
    }

    for (const part of cookieHeader.split(';')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex <= 0) continue;
        const key = part.slice(0, separatorIndex).trim();
        const value = part.slice(separatorIndex + 1).trim();
        if (!key) continue;
        try {
            parsed[key] = decodeURIComponent(value);
        } catch {
            parsed[key] = value;
        }
    }

    return parsed;
}

/**
 * @param {RequestLike | null | undefined} req
 * @returns {{ accessToken: string | null, refreshToken: string | null }}
 */
export function getAuthTokensFromRequest(req) {
    const cookieHeader = getHeader(req, 'cookie');
    const cookies = req?.cookies || parseCookieHeader(cookieHeader);
    return {
        accessToken: cookies[ACCESS_COOKIE_NAME] || null,
        refreshToken: cookies[REFRESH_COOKIE_NAME] || null
    };
}

/**
 * @param {RequestLike | null | undefined} req
 * @param {number} maxAgeMs
 * @param {{ targetOrigin?: string }} [options]
 * @returns {Record<string, unknown>}
 */
function buildCookieOptions(req, maxAgeMs, { targetOrigin } = {}) {
    // targetOriginがlocalhostの場合、secure=falseにする
    // (OAuth callbackがhttps経由でもリダイレクト先がhttp://localhostの場合)
    let secure = isSecureRequest(req);
    if (secure && targetOrigin) {
        try {
            const host = new URL(targetOrigin).hostname;
            if (isLocalHost(host)) secure = false;
        } catch { /* ignore */ }
    }
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        ...(Number.isFinite(maxAgeMs) ? { maxAge: maxAgeMs } : {})
    };
}

/**
 * @param {ResponseLike} res
 * @param {RequestLike | null | undefined} req
 * @param {AuthServiceLike | null | undefined} authService
 * @param {{ accessToken?: string | null, refreshToken?: string | null, targetOrigin?: string }} tokens
 */
export function setAuthCookies(res, req, authService, { accessToken, refreshToken, targetOrigin }) {
    const accessMaxAgeMs = Math.max(0, Number(authService?.accessTtlSeconds || 0) * 1000);
    const refreshMaxAgeMs = Math.max(0, Number(authService?.refreshTtlSeconds || 0) * 1000);
    const opts = { targetOrigin };

    if (accessToken) {
        res.cookie(ACCESS_COOKIE_NAME, accessToken, buildCookieOptions(req, accessMaxAgeMs, opts));
    }

    if (refreshToken) {
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, buildCookieOptions(req, refreshMaxAgeMs, opts));
    }
}

/**
 * @param {ResponseLike} res
 * @param {RequestLike & { cookies?: Record<string, string> }} [req]
 */
export function clearAuthCookies(res, req) {
    for (const secure of [true, false]) {
        const options = {
            httpOnly: true,
            sameSite: 'lax',
            secure,
            path: '/'
        };
        res.clearCookie(ACCESS_COOKIE_NAME, options);
        res.clearCookie(REFRESH_COOKIE_NAME, options);
    }
    if (req && !req.cookies) {
        req.cookies = {};
    }
}

export {
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME
};
