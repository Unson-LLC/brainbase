// @ts-check
/**
 * Provider Registry + OAuth state signing (SPEC-settings-plugin-contract-v2)
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const REQUIRED_PROVIDER_FIELDS = ['service', 'authMethods', 'capabilities', 'publicMetadataSchema', 'credentialKeySpec'];

export class ProviderValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProviderValidationError';
    }
}

export class ProviderRegistry {
    constructor({ logger = console } = {}) {
        /** @type {Map<string, any>} */
        this.providers = new Map();
        this.logger = logger;
    }

    register(provider) {
        for (const f of REQUIRED_PROVIDER_FIELDS) {
            if (!provider[f]) throw new ProviderValidationError(`provider field missing: ${f}`);
        }
        if (!Array.isArray(provider.authMethods) || provider.authMethods.length === 0) {
            throw new ProviderValidationError('authMethods must be non-empty array');
        }
        if (!Array.isArray(provider.capabilities)) {
            throw new ProviderValidationError('capabilities must be array');
        }
        if (!Array.isArray(provider.credentialKeySpec) || provider.credentialKeySpec.length === 0) {
            throw new ProviderValidationError('credentialKeySpec must be non-empty array');
        }
        if (this.providers.has(provider.service)) {
            this.logger.warn(`[ProviderRegistry] overwriting provider for service=${provider.service}`);
        }
        this.providers.set(provider.service, provider);
    }

    get(service) {
        return this.providers.get(service) || null;
    }

    list() {
        return Array.from(this.providers.values());
    }
}

/**
 * OAuth state signing (Codex 警告 #4: actor / scope / org / project / return URL / nonce 署名 + one-time)
 */

const usedNonces = new Set();

export function signOAuthState(payload, secret) {
    if (!payload || !payload.actor_person_id) {
        throw new ProviderValidationError('actor_person_id required');
    }
    if (!payload.nonce) {
        throw new ProviderValidationError('nonce required');
    }
    if (!payload.return_url) {
        throw new ProviderValidationError('return_url required');
    }
    if (!secret) throw new ProviderValidationError('secret required');

    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyOAuthState(token, secret) {
    if (typeof token !== 'string' || !token.includes('.')) {
        return { valid: false, reason: 'malformed' };
    }
    const [body, sig] = token.split('.');
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    if (sig.length !== expected.length) {
        return { valid: false, reason: 'signature-mismatch' };
    }
    try {
        if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            return { valid: false, reason: 'signature-mismatch' };
        }
    } catch {
        return { valid: false, reason: 'signature-mismatch' };
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return { valid: false, reason: 'malformed-body' };
    }
    if (usedNonces.has(payload.nonce)) {
        return { valid: false, reason: 'nonce-replayed' };
    }
    usedNonces.add(payload.nonce);
    return { valid: true, payload };
}

export function generateNonce() {
    return randomBytes(16).toString('hex');
}

export function _resetNoncesForTest() {
    usedNonces.clear();
}

/**
 * credential ref helper: enforces credentialKeySpec
 */
export function buildCredentialRef(provider, providerSpecificMetadata) {
    if (!provider || !Array.isArray(provider.credentialKeySpec)) {
        throw new ProviderValidationError('provider with credentialKeySpec required');
    }
    const allowed = new Set(['provider', 'path', 'version', 'env', 'project', ...provider.credentialKeySpec]);
    // INV-3: credentialKeySpec 外のキーは含めない、provider/path/version は infra-meta
    const ref = {
        provider: providerSpecificMetadata.provider || 'infisical',
        path: providerSpecificMetadata.path,
        version: providerSpecificMetadata.version || 'v1'
    };
    if (!ref.path) throw new ProviderValidationError('path required in credential metadata');
    return ref;
}
