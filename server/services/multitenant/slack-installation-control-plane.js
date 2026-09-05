import { createHash, randomBytes } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId, isCanonicalId } from './ids.js';
import { normalizeSlackInstallationFailureCode } from './slack-installation-diagnostics.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CODE = /^[^\u0000-\u001f\u007f]{1,4096}$/u;
function safeFailureCode(error, stage) {
    return normalizeSlackInstallationFailureCode(
        error instanceof ContractError ? error.code : null,
        stage
    );
}

function invalid(code, status = 400) {
    throw new ContractError(code, { status, fault_domain: 'brainbase_cloud' });
}

function timestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) invalid('INSTALLATION_STATE_INVALID');
    return date.toISOString();
}

function normalizeRevision(value) {
    if (value === undefined || value === null) return undefined;
    if (!/^(0|[1-9][0-9]*)$/u.test(String(value)) || Number(value) < 1) {
        invalid('INSTALLATION_BINDING_MISMATCH');
    }
    return String(value);
}

export function validateSlackInstallationBinding(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || !isCanonicalId(input.installation_intent_id, 'insi')
        || !isCanonicalId(input.tenant_id, 'ten')
        || !isCanonicalId(input.initiated_by_person_id, 'per')
        || !IDENTIFIER.test(String(input.app_id))) {
        invalid('INSTALLATION_BINDING_MISMATCH');
    }
    for (const field of ['expected_workspace_id', 'expected_enterprise_id']) {
        if (input[field] !== undefined && input[field] !== null && !IDENTIFIER.test(String(input[field]))) {
            invalid('INSTALLATION_BINDING_MISMATCH');
        }
    }
    const expectedConnectionRevision = normalizeRevision(input.expected_connection_revision);
    return {
        installation_intent_id: input.installation_intent_id,
        tenant_id: input.tenant_id,
        app_id: String(input.app_id),
        ...(input.expected_workspace_id ? { expected_workspace_id: String(input.expected_workspace_id) } : {}),
        ...(input.expected_enterprise_id ? { expected_enterprise_id: String(input.expected_enterprise_id) } : {}),
        initiated_by_person_id: input.initiated_by_person_id,
        ...(expectedConnectionRevision ? { expected_connection_revision: expectedConnectionRevision } : {})
    };
}

function validateRedirectUri(value) {
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid('INSTALLATION_STATE_INVALID');
    } catch {
        invalid('INSTALLATION_STATE_INVALID');
    }
    return String(value);
}

function scopes(value) {
    const values = Array.isArray(value) ? value : String(value ?? '').split(',');
    const normalized = [...new Set(values.map((scope) => String(scope).trim()).filter(Boolean))].sort();
    if (normalized.length === 0 || normalized.some((scope) => !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(scope))) {
        invalid('WORKSPACE_CONNECTION_INVALID');
    }
    return normalized;
}

function exchangedInstallation(response, intent) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) invalid('UPSTREAM_UNAVAILABLE', 503);
    const appId = response.app_id ?? response.api_app_id;
    const workspaceId = response.workspace_id ?? response.team_id ?? response.team?.id;
    const enterpriseId = response.enterprise_id ?? response.enterprise?.id ?? null;
    const installerId = response.installer_id ?? response.authed_user_id ?? response.authed_user?.id;
    if (!IDENTIFIER.test(String(appId)) || appId !== intent.app_id
        || !IDENTIFIER.test(String(workspaceId)) || !IDENTIFIER.test(String(installerId))
        || (intent.expected_workspace_id && intent.expected_workspace_id !== workspaceId)
        || (intent.expected_enterprise_id && intent.expected_enterprise_id !== enterpriseId)
        || typeof response.credential_material !== 'string'
        || response.credential_material.length === 0) {
        invalid('WORKSPACE_CONNECTION_CONFLICT', 409);
    }
    return {
        app_id: appId,
        workspace_id: workspaceId,
        ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
        installer_id: installerId,
        installation_id: response.installation_id ?? `slack:${appId}:${workspaceId}:${installerId}`,
        granted_scopes: scopes(response.granted_scopes ?? response.scope),
        credential_material: response.credential_material,
        credential_refresh_material: response.credential_refresh_material ?? null
    };
}

function opaqueCredential(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.credential_ref !== 'string' || result.credential_ref.length === 0
        || result.credential_ref.length > 512) {
        invalid('CREDENTIAL_REF_INVALID', 503);
    }
    return {
        credential_ref: result.credential_ref,
        credential_mode: result.credential_mode ?? 'customer_oauth',
        refresh_revision: result.refresh_revision ?? 1
    };
}

function credentialDigest(value) {
    return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

/**
 * Brainbase control-plane implementation for Mana's Slack installation port.
 * The OAuth client and credential store are explicit ports: tokens are only
 * handed to the configured secret boundary and never included in DB payloads,
 * receipts or errors.
 */
export class SlackInstallationControlPlane {
    constructor({
        repository,
        oauthClient,
        credentialStore,
        authorizeInstallation,
        now = () => new Date(),
        ttlSeconds = 600
    } = {}) {
        if (!repository || typeof repository.createSlackInstallationIntent !== 'function'
            || typeof repository.claimSlackInstallationExchange !== 'function'
            || typeof repository.reserveSlackInstallationConnection !== 'function'
            || typeof repository.registerSlackInstallation !== 'function'
            || typeof repository.failSlackInstallationExchange !== 'function') {
            throw new Error('Slack installation control-plane repository is required');
        }
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) {
            throw new Error('Slack installation intent TTL must be between 1 and 600 seconds');
        }
        this.repository = repository;
        this.oauthClient = oauthClient;
        this.credentialStore = credentialStore;
        this.authorizeInstallation = authorizeInstallation;
        this.now = now;
        this.ttlSeconds = ttlSeconds;
    }

    async authorize(request) {
        if (typeof this.authorizeInstallation !== 'function') {
            invalid('INSTALLATION_AUTHORIZATION_REQUIRED', 403);
        }
        return this.authorizeBinding(await this.authorizeInstallation(request));
    }

    async authorizeBinding(input, { client = null } = {}) {
        const binding = validateSlackInstallationBinding(input);
        const issuedAt = this.now();
        const issued = timestamp(issuedAt);
        const expires = new Date(issuedAt.getTime() + this.ttlSeconds * 1000).toISOString();
        const intent = {
            ...binding,
            issued_at: issued,
            expires_at: expires
        };
        if (client) await this.repository.createSlackInstallationIntent(intent, { client });
        else await this.repository.createSlackInstallationIntent(intent);
        return binding;
    }

    async exchange_and_register({ authorization_code, redirect_uri, intent } = {}) {
        if (!CODE.test(String(authorization_code ?? ''))) invalid('INSTALLATION_STATE_INVALID');
        const normalizedIntent = validateSlackInstallationBinding(intent);
        const redirect = validateRedirectUri(redirect_uri);
        // Claim the intent before crossing either external boundary. The
        // claim token fences stale callbacks after a retry takes ownership.
        const claimToken = randomBytes(32).toString('base64url');
        const requestDigest = credentialDigest(canonicalJson({
            intent: normalizedIntent,
            authorization_code,
            redirect_uri: redirect
        }));
        const claim = await this.repository.claimSlackInstallationExchange({
            intent: normalizedIntent,
            request_digest: requestDigest,
            claim_token: claimToken,
            now: timestamp(this.now())
        });
        if (claim?.status === 'completed' && claim.response_payload) return claim.response_payload;
        if (claim?.status !== 'claimed') invalid('INSTALLATION_STATE_INVALID');
        if (!this.oauthClient || typeof this.oauthClient.exchangeCode !== 'function'
            || !this.credentialStore || typeof this.credentialStore.store !== 'function') {
            await this.repository.failSlackInstallationExchange({
                intent: normalizedIntent,
                claim_token: claimToken,
                request_digest: requestDigest,
                failure_stage: 'oauth_exchange',
                failure_code: 'UPSTREAM_UNAVAILABLE',
                cleanup_status: 'not_needed',
                now: timestamp(this.now())
            });
            invalid('UPSTREAM_UNAVAILABLE', 503);
        }

        // This is the only call that may receive the short-lived OAuth code.
        // Do not include its result in errors, logs or the persistence payload.
        let exchanged;
        let connectionId;
        let connectionRevision;
        let storedCredential;
        let failureStage = 'oauth_exchange';
        try {
            const upstream = await this.oauthClient.exchangeCode({
                authorization_code,
                redirect_uri: redirect
            });
            failureStage = 'exchange_normalize';
            exchanged = exchangedInstallation(upstream, normalizedIntent);
            failureStage = 'connection_reserve';
            const reservation = await this.repository.reserveSlackInstallationConnection({
                intent: normalizedIntent,
                workspace_id: exchanged.workspace_id,
                app_id: exchanged.app_id,
                proposed_connection_id: generateCanonicalId('wsc'),
                claim_token: claimToken,
                request_digest: requestDigest,
                now: timestamp(this.now())
            });
            if (reservation?.status !== 'reserved'
                || !isCanonicalId(reservation.connection_id, 'wsc')
                || !/^[1-9][0-9]*$/u.test(String(reservation.connection_revision))) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }
            connectionId = reservation.connection_id;
            connectionRevision = String(reservation.connection_revision);
            failureStage = 'credential_store';
            storedCredential = opaqueCredential(await this.credentialStore.store({
                tenant_id: normalizedIntent.tenant_id,
                idempotency_key: normalizedIntent.installation_intent_id,
                connection_id: connectionId,
                connection_revision: connectionRevision,
                provider: 'slack',
                credential_material: exchanged.credential_material,
                credential_refresh_material: exchanged.credential_refresh_material
            }));
            failureStage = 'db_register';
            const result = await this.repository.registerSlackInstallation({
                intent: normalizedIntent,
                exchange: {
                    workspace_id: exchanged.workspace_id,
                    enterprise_id: exchanged.enterprise_id ?? null,
                    installer_id: exchanged.installer_id,
                    installation_id: exchanged.installation_id,
                    granted_scopes: exchanged.granted_scopes
                },
                credential: storedCredential,
                connection_id: connectionId,
                connection_revision: connectionRevision,
                claim_token: claimToken,
                request_digest: requestDigest,
                now: timestamp(this.now())
            });
            return result;
        } catch (error) {
            // Secret stores may support cleanup of an orphaned reference. The
            // cleanup receives only the opaque reference, never raw material.
            let cleanupStatus = storedCredential?.credential_ref ? 'failed' : 'not_needed';
            if (storedCredential?.credential_ref && typeof this.credentialStore.revoke === 'function') {
                try {
                    const cleanup = await this.credentialStore.revoke({
                        tenant_id: normalizedIntent.tenant_id,
                        connection_id: connectionId,
                        connection_revision: connectionRevision,
                        provider: 'slack',
                        credential_ref: storedCredential.credential_ref,
                        reason: 'registration_failed'
                    });
                    if (cleanup?.status === 'revoked') cleanupStatus = 'revoked';
                } catch { /* preserve the registration error and failed cleanup state */ }
            }
            try {
                await this.repository.failSlackInstallationExchange({
                    intent: normalizedIntent,
                    claim_token: claimToken,
                    request_digest: requestDigest,
                    failure_stage: failureStage,
                    failure_code: safeFailureCode(error, failureStage),
                    cleanup_status: cleanupStatus,
                    now: timestamp(this.now())
                });
            } catch { /* preserve the external/registration error */ }
            throw error;
        }
    }

    // Compatibility alias for callers that use the camel-case naming in the
    // deployment requirement. Mana's current TypeScript port calls the snake
    // case method above; both resolve to the same transaction.
    async exchangeAndRegister(input) {
        return this.exchange_and_register(input);
    }
}

export function redactSlackInstallationExchange(input) {
    return {
        installation_intent_id: input?.intent?.installation_intent_id ?? null,
        tenant_id: input?.intent?.tenant_id ?? null,
        request_digest: input?.authorization_code ? credentialDigest(input.authorization_code) : null
    };
}
