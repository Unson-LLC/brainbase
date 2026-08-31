// @ts-check

/**
 * Authentication provider registry.
 *
 * Authentication providers are deliberately kept behind this small contract.
 * The rest of the authentication service can therefore depend on a canonical
 * external identity rather than on Slack, Google, or any other provider's
 * claim names. Provider implementations may expose additional flow methods
 * (for example `exchangeCode` or `verifyAssertion`) as appropriate for their
 * `authMethods`.
 */

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const REQUIRED_PROVIDER_FIELDS = [
    'id',
    'displayName',
    'authMethods',
    'capabilities',
    'resolveIdentity'
];

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value) {
    const normalized = normalizeString(value);
    return normalized || null;
}

function validateStringList(value, field, { required = true } = {}) {
    if (!Array.isArray(value) || (required && value.length === 0)) {
        throw new AuthProviderValidationError(`${field} must be a non-empty array`);
    }
    const normalized = value.map((item) => normalizeString(item));
    if (normalized.some((item) => !item)) {
        throw new AuthProviderValidationError(`${field} must contain non-empty strings`);
    }
    if (new Set(normalized).size !== normalized.length) {
        throw new AuthProviderValidationError(`${field} must not contain duplicates`);
    }
    return normalized;
}

export class AuthProviderValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthProviderValidationError';
        this.code = 'auth_provider_invalid';
    }
}

export class AuthProviderNotFoundError extends Error {
    constructor(providerId) {
        super(`Authentication provider is not registered: ${providerId}`);
        this.name = 'AuthProviderNotFoundError';
        this.code = 'auth_provider_not_found';
        this.providerId = providerId;
    }
}

/**
 * Validate an authentication provider definition without requiring one
 * particular protocol. This is what lets a future passkey or SAML provider
 * coexist with today's OAuth/OIDC adapter.
 *
 * @param {Record<string, unknown>} provider
 * @returns {Record<string, unknown>}
 */
export function validateAuthProviderDefinition(provider) {
    if (!isRecord(provider)) {
        throw new AuthProviderValidationError('provider definition must be an object');
    }

    for (const field of REQUIRED_PROVIDER_FIELDS) {
        if (!(field in provider) || provider[field] === null || provider[field] === undefined) {
            throw new AuthProviderValidationError(`provider field missing: ${field}`);
        }
    }

    const id = normalizeString(provider.id);
    if (!PROVIDER_ID_PATTERN.test(id)) {
        throw new AuthProviderValidationError(
            'provider id must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, or underscores'
        );
    }
    if (normalizeString(provider.displayName).length === 0) {
        throw new AuthProviderValidationError('provider displayName must be a non-empty string');
    }

    validateStringList(provider.authMethods, 'authMethods');
    validateStringList(provider.capabilities, 'capabilities');
    if (typeof provider.resolveIdentity !== 'function') {
        throw new AuthProviderValidationError('provider resolveIdentity must be a function');
    }

    // Optional flow methods are validated when present, but are not required
    // globally: assertion-based providers do not need an OAuth code exchange.
    for (const method of ['buildAuthorizationUrl', 'exchangeCode', 'fetchUserInfo', 'verifyAssertion']) {
        if (method in provider && provider[method] !== undefined && typeof provider[method] !== 'function') {
            throw new AuthProviderValidationError(`provider ${method} must be a function when provided`);
        }
    }

    return provider;
}

export class AuthProviderRegistry {
    /**
     * @param {{ logger?: { warn?: (...args: unknown[]) => void } }} [options]
     */
    constructor({ logger = console } = {}) {
        /** @type {Map<string, Record<string, unknown>>} */
        this.providers = new Map();
        this.logger = logger;
    }

    /**
     * @param {Record<string, unknown>} provider
     * @returns {Record<string, unknown>}
     */
    register(provider) {
        validateAuthProviderDefinition(provider);
        const providerId = normalizeString(provider.id);
        if (this.providers.has(providerId)) {
            this.logger?.warn?.(`[AuthProviderRegistry] overwriting provider for id=${providerId}`);
        }
        this.providers.set(providerId, provider);
        return provider;
    }

    /**
     * @param {string} providerId
     * @returns {Record<string, unknown>|null}
     */
    get(providerId) {
        const normalizedId = normalizeString(providerId);
        return this.providers.get(normalizedId) || null;
    }

    /**
     * @param {string} providerId
     * @returns {boolean}
     */
    has(providerId) {
        return this.get(providerId) !== null;
    }

    /**
     * @param {string} providerId
     * @returns {Record<string, unknown>}
     */
    require(providerId) {
        const provider = this.get(providerId);
        if (!provider) {
            throw new AuthProviderNotFoundError(normalizeString(providerId) || providerId);
        }
        return provider;
    }

    /**
     * @returns {Array<Record<string, unknown>>}
     */
    list() {
        return Array.from(this.providers.values());
    }
}

/**
 * Convert provider-specific claims into the identity shared by all auth
 * providers. Only the fields in this contract are copied; raw claims and
 * credentials must not be carried into the common identity object.
 *
 * @param {{ provider?: string, subject?: string, externalSubjectId?: string, providerSubject?: string, tenantId?: string|null, externalTenantId?: string|null, email?: string|null, name?: string|null }} input
 * @param {string} [providerOverride]
 */
export function normalizeExternalIdentity(input, providerOverride) {
    if (!isRecord(input)) {
        throw new AuthProviderValidationError('external identity must be an object');
    }

    const provider = normalizeString(providerOverride || input.provider);
    if (!PROVIDER_ID_PATTERN.test(provider)) {
        throw new AuthProviderValidationError('external identity provider is invalid');
    }

    const subject = normalizeString(input.subject || input.externalSubjectId || input.providerSubject);
    if (!subject) {
        throw new AuthProviderValidationError('external identity subject is required');
    }

    const tenantId = normalizeOptionalString(input.tenantId || input.externalTenantId);
    return {
        provider,
        subject,
        tenantId,
        externalSubjectId: subject,
        externalTenantId: tenantId,
        email: normalizeOptionalString(input.email),
        name: normalizeOptionalString(input.name)
    };
}
