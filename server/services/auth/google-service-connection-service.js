// @ts-check
import crypto from 'crypto';
import {
    GOOGLE_MEET_READ_SCOPES,
    getGoogleServiceScopes,
    normalizeGoogleService
} from './providers/google-workspace-auth-provider.js';

const GOOGLE_ACCOUNT_SERVICE = 'google';
// The service catalog is split for the UI/API, but the physical credential
// binding stays on the existing provider used by Google Meet and its adapter.
const GOOGLE_CREDENTIAL_PROVIDER = 'google-meet';
const GOOGLE_OAUTH_CLIENT_PROVIDER = 'google-workspace';
const GOOGLE_MEET_SERVICE = 'google-meet';

function required(value, name) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}

function opaqueCredential(result) {
    const credentialRef = String(result?.credential_ref || '').trim();
    if (!credentialRef) throw new Error('Google service credential store did not return a credential_ref');
    return credentialRef;
}

function asStringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))];
}

function scopesForService(service) {
    if (service === GOOGLE_MEET_SERVICE) return [...GOOGLE_MEET_READ_SCOPES];
    return getGoogleServiceScopes(service);
}

function safeGoogleServices(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
    const services = metadata.google_services;
    if (!services || typeof services !== 'object' || Array.isArray(services)) return {};
    return Object.fromEntries(Object.entries(services).map(([service, entry]) => {
        const value = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
        return [service, {
            scopes: asStringList(value.scopes),
            connected_at: typeof value.connected_at === 'string' ? value.connected_at : null
        }];
    }));
}

function accountSummary(account, requestedService, requiredScopes) {
    const capabilities = asStringList(account?.capabilities);
    const status = account?.status || 'not_connected';
    const meetsScopes = requiredScopes.every((scope) => capabilities.includes(scope));
    const effectiveStatus = !account
        ? 'not_connected'
        : (status !== 'connected' ? status : (meetsScopes ? 'connected' : 'reauth_required'));
    const safeAccount = account ? {
        account_id: account.id,
        status: effectiveStatus,
        external_handle: account.external_handle || null,
        capabilities,
        required_capabilities: [...requiredScopes],
        google_services: safeGoogleServices(account.metadata)
    } : null;
    return {
        service: requestedService,
        connected: effectiveStatus === 'connected',
        status: effectiveStatus,
        account: safeAccount
    };
}

function revisionOf(account) {
    const raw = account?.metadata?.connection_revision;
    const value = Number.parseInt(String(raw || '0'), 10);
    return Number.isSafeInteger(value) && value > 0 ? value + 1 : 1;
}

function identityMatches(account, identity) {
    return Boolean(account && identity && (
        (identity.subject && account.external_account_id === identity.subject)
        || (identity.email && account.external_handle === identity.email)
    ));
}

/**
 * Service-specific Google OAuth over one shared Workspace account.
 *
 * The account row is deliberately `service=google`; the service selected in
 * OAuth state is represented by `metadata.google_services` and the scope URLs
 * in `capabilities`. This keeps a single credential-store binding while still
 * allowing Gmail, Calendar, and Drive to be authorized independently.
 */
export class GoogleServiceConnectionService {
    constructor({ provider, credentialStore, accountRepository, idFactory = () => crypto.randomUUID() }) {
        if (!provider || !credentialStore || !accountRepository) {
            throw new Error('Google service connection dependencies are required');
        }
        this.provider = provider;
        this.credentialStore = credentialStore;
        this.accountRepository = accountRepository;
        this.idFactory = idFactory;
    }

    normalizeService(service) {
        const normalized = normalizeGoogleService(service);
        if (!normalized) throw new Error('unsupported_google_service');
        return normalized;
    }

    buildAuthorizationUrl({ service, state, req }) {
        const normalized = this.normalizeService(service);
        return this.provider.buildGoogleServiceAuthorizationUrl(normalized, required(state, 'state'), req);
    }

    async findAccount({ personId, organizationId, identity }) {
        const accounts = [];
        for (const service of [GOOGLE_ACCOUNT_SERVICE, GOOGLE_MEET_SERVICE]) {
            accounts.push(...await this.accountRepository.list({
                service,
                scope_type: 'personal',
                owner_person_id: personId,
                org_id: organizationId
            }));
        }
        const matches = accounts.filter((account) => identityMatches(account, identity));
        if (matches.length > 1) {
            // A prior Meet-only connection may coexist briefly with a
            // canonical shared Google row during migration. Prefer the
            // canonical row; two canonical rows remain an integrity error.
            const canonical = matches.filter((account) => account.service === GOOGLE_ACCOUNT_SERVICE);
            if (canonical.length === 1) return canonical[0];
            throw new Error('ambiguous_google_account');
        }
        return matches[0] || null;
    }

    async connect({ service, code, req, personId, organizationId, idempotencyKey }) {
        const normalized = this.normalizeService(service);
        const actor = required(personId, 'personId');
        const tenantId = required(organizationId, 'organizationId');
        const operationKey = required(idempotencyKey, 'idempotencyKey');
        const token = await this.provider.exchangeGoogleServiceCode(normalized, required(code, 'code'), req);
        const profile = await this.provider.fetchUserInfo(token.access_token);
        const identity = this.provider.resolveIdentity(profile);
        const existing = await this.findAccount({ personId: actor, organizationId: tenantId, identity });
        const suffix = existing?.id || this.idFactory();
        const connectionId = existing?.metadata?.connection_id || `google-${suffix}`;
        const existingCredentialRef = typeof existing?.credential_ref?.path === 'string'
            ? existing.credential_ref.path
            : null;
        const refreshToken = typeof token.refresh_token === 'string' && token.refresh_token.length > 0
            ? token.refresh_token
            : null;
        // Google omits refresh_token on incremental consent. The remote store
        // has no update operation, so retain the existing opaque binding and
        // revision when no new refresh material is available.
        const preserveCredential = Boolean(existingCredentialRef && !refreshToken);
        const connectionRevision = String(preserveCredential
            ? (existing?.metadata?.connection_revision || '1')
            : (existing ? revisionOf(existing) : 1));
        const now = new Date().toISOString();
        const priorServices = safeGoogleServices(existing?.metadata);
        const googleServices = {
            ...priorServices,
            [normalized]: {
                scopes: [...getGoogleServiceScopes(normalized)],
                connected_at: now
            }
        };
        const capabilities = [...new Set([
            ...asStringList(existing?.capabilities),
            ...getGoogleServiceScopes(normalized)
        ])];

        // The credential store treats the absent refresh field as "preserve the
        // current refresh material". Never send null here: Google omits a
        // refresh_token during incremental authorization and null would clear
        // the existing long-lived token.
        const credentialInput = {
            tenant_id: tenantId,
            connection_id: connectionId,
            connection_revision: connectionRevision,
            provider: GOOGLE_CREDENTIAL_PROVIDER,
            idempotency_key: operationKey,
            credential_material: token.access_token
        };
        if (refreshToken) {
            credentialInput.credential_refresh_material = refreshToken;
        }

        let credentialRef = existingCredentialRef;
        let storedCredential = false;
        try {
            if (!preserveCredential) {
                credentialRef = opaqueCredential(await this.credentialStore.store(credentialInput));
                storedCredential = true;
            }
            const input = {
                id: existing?.id || `acc_google_${suffix}`,
                service: GOOGLE_ACCOUNT_SERVICE,
                scope_type: 'personal',
                owner_person_id: actor,
                org_id: tenantId,
                display_name: `${identity.email} Google`,
                external_account_id: identity.subject,
                external_handle: identity.email,
                credential_ref: {
                    provider: 'brainbase-credential-store',
                    path: credentialRef
                },
                oauth_client_ref: { provider: GOOGLE_OAUTH_CLIENT_PROVIDER, mode: 'shared-client' },
                status: 'connected',
                capabilities,
                metadata: { connection_id: connectionId, connection_revision: connectionRevision, google_services: googleServices },
                ...(existing ? { updated_by_person_id: actor } : { created_by_person_id: actor })
            };
            const account = existing
                ? await this.accountRepository.update(existing.id, input)
                : await this.accountRepository.create(input);
            return {
                account_id: account.id,
                service: normalized,
                status: account.status,
                external_handle: account.external_handle,
                capabilities: [...account.capabilities],
                google_services: safeGoogleServices(account.metadata)
            };
        } catch (error) {
            // An update can fail after store() for an existing account. Revoke
            // only the newly materialized revision; the previous account row is
            // left untouched so its credential remains usable.
            if (storedCredential && credentialRef && typeof this.credentialStore.revoke === 'function') {
                try {
                    await this.credentialStore.revoke({
                        tenant_id: tenantId,
                        connection_id: connectionId,
                        connection_revision: connectionRevision,
                        provider: GOOGLE_CREDENTIAL_PROVIDER,
                        credential_ref: credentialRef,
                        reason: 'account_registration_failed'
                    });
                } catch { /* preserve the original registration failure */ }
            }
            throw error;
        }
    }

    async status({ service = GOOGLE_MEET_SERVICE, personId, organizationId }) {
        const normalized = service === GOOGLE_MEET_SERVICE ? GOOGLE_MEET_SERVICE : this.normalizeService(service);
        const actor = required(personId, 'personId');
        const tenantId = required(organizationId, 'organizationId');
        const requiredScopes = scopesForService(normalized);
        const services = normalized === GOOGLE_MEET_SERVICE
            ? [GOOGLE_ACCOUNT_SERVICE, GOOGLE_MEET_SERVICE]
            : [GOOGLE_ACCOUNT_SERVICE];
        const accounts = [];
        for (const accountService of services) {
            const rows = await this.accountRepository.list({
                service: accountService,
                scope_type: 'personal',
                owner_person_id: actor,
                org_id: tenantId
            });
            accounts.push(...rows);
        }
        const account = accounts.find((candidate) => {
            const capabilities = asStringList(candidate.capabilities);
            return requiredScopes.every((scope) => capabilities.includes(scope));
        }) || accounts[0] || null;
        return accountSummary(account, normalized, requiredScopes);
    }
}

export {
    GOOGLE_ACCOUNT_SERVICE,
    GOOGLE_CREDENTIAL_PROVIDER,
    GOOGLE_MEET_SERVICE
};
