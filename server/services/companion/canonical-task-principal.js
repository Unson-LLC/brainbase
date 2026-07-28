const ALLOWED_TYPES = new Set(['person', 'service', 'internal']);
const TRUSTED_AUTH_SOURCES = new Set(['bearer', 'service-token', 'internal']);

function normalizePart(value, label) {
    const normalized = String(value || '').normalize('NFC');
    if (!normalized) throw new Error(`Canonical Task principal ${label} is required`);
    if (/\p{Cc}/u.test(normalized)) throw new Error(`Canonical Task principal ${label} contains control characters`);
    return normalized;
}

export function normalizeCanonicalTaskPrincipal(principal) {
    const type = String(principal?.type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) throw new Error('Canonical Task principal type is invalid');
    return Object.freeze({ type, id: normalizePart(principal?.id, 'id') });
}

export function createCanonicalTaskPrincipal({ authSource, personId, serviceId, internalId } = {}) {
    if (personId && ['bearer', 'session'].includes(authSource)) {
        return normalizeCanonicalTaskPrincipal({ type: 'person', id: personId });
    }
    if (!TRUSTED_AUTH_SOURCES.has(authSource)) {
        throw new Error('Canonical Task principal requires trusted authentication');
    }
    if (authSource === 'service-token') {
        return normalizeCanonicalTaskPrincipal({ type: 'service', id: serviceId });
    }
    if (authSource === 'internal') {
        return normalizeCanonicalTaskPrincipal({ type: 'internal', id: internalId });
    }
    return normalizeCanonicalTaskPrincipal({ type: 'person', id: personId });
}

export function principalNamespace(principal) {
    const normalized = normalizeCanonicalTaskPrincipal(principal);
    const payload = JSON.stringify({ type: normalized.type, id: normalized.id });
    return `v1.${Buffer.from(payload, 'utf8').toString('base64url')}`;
}
