const ACCESS_COOKIE_NAME = 'brainbase_session';
const REFRESH_COOKIE_NAME = 'brainbase_refresh';

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

function isSecureRequest(req) {
    const proto = getHeader(req, 'x-forwarded-proto') || req?.protocol || '';
    const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || '';
    if (String(proto).toLowerCase() === 'https') return true;
    return Boolean(host) && !isLocalHost(String(host).toLowerCase());
}

export function parseCookieHeader(cookieHeader = '') {
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

export function getAuthTokensFromRequest(req) {
    const cookieHeader = getHeader(req, 'cookie');
    const cookies = req?.cookies || parseCookieHeader(cookieHeader);
    return {
        accessToken: cookies[ACCESS_COOKIE_NAME] || null,
        refreshToken: cookies[REFRESH_COOKIE_NAME] || null
    };
}

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
