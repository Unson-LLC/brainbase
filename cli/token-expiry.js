function parseDateMs(value) {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const time = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

/**
 * Read only the JWT payload's exp claim for a local expiry upper bound.
 * This does not verify a signature; the server remains authoritative for auth.
 */
export function getJwtExpiryMs(token) {
    if (typeof token !== 'string') return null;

    const segments = token.split('.');
    if (segments.length !== 3) return null;

    try {
        const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
        const seconds = Number(payload?.exp);
        if (!Number.isFinite(seconds) || seconds <= 0) return null;
        return seconds * 1000;
    } catch {
        return null;
    }
}

/**
 * Return the earliest trustworthy expiry bound available from token metadata.
 * JWT exp is only a local upper bound, never an authentication decision.
 */
export function resolveTokenExpiryMs({ token, expires_at: expiresAt, expires_in: expiresIn, now = Date.now() } = {}) {
    const candidates = [];
    const explicitExpiry = parseDateMs(expiresAt);
    if (explicitExpiry !== null) candidates.push(explicitExpiry);

    const jwtExpiry = getJwtExpiryMs(token);
    if (jwtExpiry !== null) candidates.push(jwtExpiry);

    const durationSeconds = Number(expiresIn);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(now)) {
        candidates.push(now + durationSeconds * 1000);
    }

    return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function resolveTokenExpiry(options = {}) {
    const expiryMs = resolveTokenExpiryMs(options);
    return expiryMs === null ? null : new Date(expiryMs).toISOString();
}

export function isAuthActive(auth, now = Date.now()) {
    if (!auth || typeof auth !== 'object') return false;

    const expiryMs = resolveTokenExpiryMs({
        token: auth.token,
        expires_at: auth.expires_at,
        expires_in: auth.expires_in,
        now
    });
    const hasExpiryMetadata = auth.expires_at !== undefined
        || auth.expires_in !== undefined
        || getJwtExpiryMs(auth.token) !== null;

    // Keep opaque legacy records without any expiry metadata readable. Any
    // record that claims an expiry must have a valid, unexpired bound.
    if (expiryMs === null) return !hasExpiryMetadata;
    return expiryMs >= now;
}
