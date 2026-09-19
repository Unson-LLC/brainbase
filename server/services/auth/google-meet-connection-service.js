// @ts-check
import crypto from 'crypto';
import { GOOGLE_MEET_READ_SCOPES } from './providers/google-workspace-auth-provider.js';

function required(value, name) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}
function opaqueCredential(result) {
    const credentialRef = String(result?.credential_ref || '').trim();
    if (!credentialRef) throw new Error('Google Meet credential store did not return a credential_ref');
    return credentialRef;
}

export class GoogleMeetConnectionService {
    constructor({ provider, credentialStore, accountRepository, idFactory = () => crypto.randomUUID() }) {
        if (!provider || !credentialStore || !accountRepository) {
            throw new Error('Google Meet connection dependencies are required');
        }
        this.provider = provider;
        this.credentialStore = credentialStore;
        this.accountRepository = accountRepository;
        this.idFactory = idFactory;
    }

    buildAuthorizationUrl({ state, req }) {
        return this.provider.buildMeetAuthorizationUrl(required(state, 'state'), req);
    }

    async connect({ code, req, personId, organizationId, idempotencyKey }) {
        const actor = required(personId, 'personId');
        const tenantId = required(organizationId, 'organizationId');
        const operationKey = required(idempotencyKey, 'idempotencyKey');
        const token = await this.provider.exchangeMeetCode(required(code, 'code'), req);
        const profile = await this.provider.fetchUserInfo(token.access_token);
        const identity = this.provider.resolveIdentity(profile);
        const suffix = this.idFactory();
        const connectionId = `google-meet-${suffix}`;
        const connectionRevision = '1';
        let credentialRef = null;

        try {
            credentialRef = opaqueCredential(await this.credentialStore.store({
                tenant_id: tenantId,
                connection_id: connectionId,
                connection_revision: connectionRevision,
                provider: 'google-meet',
                idempotency_key: operationKey,
                credential_material: token.access_token,
                credential_refresh_material: token.refresh_token
            }));
            const account = await this.accountRepository.create({
                id: `acc_google_meet_${suffix}`,
                service: 'google-meet',
                scope_type: 'personal',
                owner_person_id: actor,
                org_id: tenantId,
                display_name: `${identity.email} Google Meet`,
                external_account_id: identity.subject,
                external_handle: identity.email,
                credential_ref: {
                    provider: 'brainbase-credential-store',
                    path: credentialRef
                },
                oauth_client_ref: { provider: 'google-workspace', mode: 'shared-client' },
                capabilities: [...GOOGLE_MEET_READ_SCOPES],
                metadata: { connection_id: connectionId, connection_revision: connectionRevision },
                created_by_person_id: actor
            });
            return {
                account_id: account.id,
                service: account.service,
                status: account.status,
                external_handle: account.external_handle,
                capabilities: [...account.capabilities]
            };
        } catch (error) {
            if (credentialRef && typeof this.credentialStore.revoke === 'function') {
                try {
                    await this.credentialStore.revoke({
                        tenant_id: tenantId,
                        connection_id: connectionId,
                        connection_revision: connectionRevision,
                        provider: 'google-meet',
                        credential_ref: credentialRef,
                        reason: 'account_registration_failed'
                    });
                } catch { /* preserve the original registration failure */ }
            }
            throw error;
        }
    }
}
