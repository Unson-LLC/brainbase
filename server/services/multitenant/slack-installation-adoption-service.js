import { ContractError } from './errors.js';

const FIXED_REQUIRED_SCOPES = Object.freeze([
    'app_mentions:read', 'assistant:write', 'canvases:read', 'canvases:write',
    'channels:history', 'channels:read', 'chat:write', 'chat:write.customize',
    'commands', 'files:read', 'files:write', 'groups:history', 'groups:read',
    'im:history', 'im:read', 'im:write', 'mpim:history', 'mpim:read', 'mpim:write',
    'reactions:read', 'reactions:write', 'users:read', 'users:read.email'
]);

export const FIXED_MANA_SLACK_CONNECTION = Object.freeze({
    tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    tenant_key: 'unson-business',
    connection_id: 'wsc_01M0HRK94FG2Y8DMBFYJHYT14K',
    connection_revision: '1',
    provider: 'slack',
    workspace_id: 'T0882T8N9UH',
    team_name: '雲孫 事業運営',
    app_id: 'A0BPM2J33SN',
    bot_id: 'B0BP5T7M5AT',
    bot_user_id: 'U0BPM8B1JTU',
    installation_id: 'slack_T0882T8N9UH_A0BPM2J33SN',
    credential_mode: 'customer_oauth',
    required_scopes: FIXED_REQUIRED_SCOPES
});

const PUBLIC_FIELDS = Object.freeze([
    'tenant_id', 'connection_id', 'connection_revision', 'provider', 'workspace_id',
    'app_id', 'installation_id', 'status', 'credential_mode', 'contract_revision'
]);

function failure(code, { status = 503, retryable = false } = {}) {
    return new ContractError(code, { status, retryable, fault_domain: 'brainbase_cloud' });
}

function normalizedScopes(value) {
    const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
    const scopes = raw.map((scope) => String(scope).trim()).filter(Boolean);
    if (new Set(scopes).size !== scopes.length) return null;
    return scopes.sort();
}

function sameArray(left, right) {
    return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length && left.every((value, index) => value === right[index]);
}

function publicTarget() {
    return Object.fromEntries(PUBLIC_FIELDS
        .filter((field) => field in FIXED_MANA_SLACK_CONNECTION)
        .map((field) => [field, FIXED_MANA_SLACK_CONNECTION[field]]));
}

function safeResult(value, state) {
    const result = { state, target: publicTarget() };
    for (const field of PUBLIC_FIELDS) {
        if (value && value[field] !== undefined) result[field] = value[field];
    }
    return result;
}

function matchesFixedSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const required = [
        'tenant_id', 'connection_id', 'connection_revision', 'provider', 'workspace_id',
        'app_id', 'installation_id', 'credential_mode'
    ];
    return required.every((field) => String(snapshot[field] ?? '') === String(FIXED_MANA_SLACK_CONNECTION[field]))
        && snapshot.status === 'active'
        && sameArray(normalizedScopes(snapshot.granted_scopes), [...FIXED_REQUIRED_SCOPES]);
}

function opaqueCredential(value) {
    if (!value || typeof value !== 'object'
        || typeof value.credential_ref !== 'string' || value.credential_ref.length === 0
        || value.credential_ref.length > 512
        || value.credential_mode !== FIXED_MANA_SLACK_CONNECTION.credential_mode) {
        throw failure('FIXED_MANA_SLACK_CREDENTIAL_STORE_INVALID');
    }
    const refreshRevision = String(value.refresh_revision ?? '1');
    if (!/^[1-9][0-9]*$/u.test(refreshRevision)) {
        throw failure('FIXED_MANA_SLACK_CREDENTIAL_STORE_INVALID');
    }
    return {
        credential_ref: value.credential_ref,
        credential_mode: value.credential_mode,
        refresh_revision: refreshRevision
    };
}

function safeOperationalError(error, fallbackCode) {
    if (error instanceof ContractError) return error;
    return failure(fallbackCode);
}

/**
 * This is intentionally not a generic Slack installer.  Its immutable tuple
 * is the approved Mana production connection, so no caller can substitute a
 * tenant, workspace, app, installation, or credential mode.
 */
export class FixedManaSlackConnectionAdoptionService {
    constructor({ repository, slack, credentialStore, botToken, readback } = {}) {
        if (!repository || typeof repository.inspectFixedManaSlackConnection !== 'function'
            || typeof repository.adoptFixedManaSlackConnection !== 'function'
            || typeof repository.recordFixedManaSlackConnectionAdoptionOrphan !== 'function') {
            throw new Error('Fixed Mana Slack adoption repository is required');
        }
        if (!slack || typeof slack.authTest !== 'function' || typeof slack.listScopes !== 'function') {
            throw new Error('Fixed Mana Slack verifier is required');
        }
        if (!credentialStore || typeof credentialStore.store !== 'function'
            || typeof credentialStore.verify !== 'function' || typeof credentialStore.revoke !== 'function') {
            throw new Error('Fixed Mana Slack credential store is required');
        }
        if (typeof botToken !== 'string' || botToken.length === 0) {
            throw new Error('Fixed Mana Slack bot token must be injected at runtime');
        }
        if (typeof readback !== 'function') throw new Error('Fixed Mana Slack readback client is required');
        this.repository = repository;
        this.slack = slack;
        this.credentialStore = credentialStore;
        this.botToken = botToken;
        this.readback = readback;
    }

    async execute({ mode, approved = false } = {}) {
        if (!['dry-run', 'check', 'apply'].includes(mode)) {
            throw failure('FIXED_MANA_SLACK_ADOPTION_MODE_INVALID', { status: 400 });
        }
        if (mode === 'apply' && approved !== true) {
            throw failure('ADOPTION_APPROVAL_REQUIRED', { status: 403 });
        }
        if (mode === 'dry-run') {
            return { state: 'dry_run', target: publicTarget(), secret_key: 'SLACK_BOT_TOKEN_UNSON' };
        }

        await this.verifySlackBinding();
        let inspection;
        try {
            inspection = await this.repository.inspectFixedManaSlackConnection({
                definition: FIXED_MANA_SLACK_CONNECTION
            });
        } catch (error) {
            throw safeOperationalError(error, 'FIXED_MANA_SLACK_INSPECTION_FAILED');
        }
        if (inspection?.state === 'orphaned') {
            throw failure('FIXED_MANA_SLACK_CREDENTIAL_ORPHANED', { status: 503 });
        }
        if (inspection?.state === 'existing' && !matchesFixedSnapshot(inspection.snapshot)) {
            throw failure('FIXED_MANA_SLACK_CONNECTION_CONFLICT', { status: 409 });
        }
        if (mode === 'check') return safeResult(inspection?.snapshot, 'checked');
        if (inspection?.state === 'existing') {
            await this.verifyCredential(opaqueCredential(inspection.credential));
            return safeResult(inspection.snapshot, 'already_adopted');
        }
        if (inspection?.state !== 'absent') throw failure('FIXED_MANA_SLACK_CONNECTION_CONFLICT', { status: 409 });

        let credential;
        try {
            credential = opaqueCredential(await this.credentialStore.store({
                tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
                connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
                connection_revision: FIXED_MANA_SLACK_CONNECTION.connection_revision,
                provider: FIXED_MANA_SLACK_CONNECTION.provider,
                idempotency_key: 'fixed-mana-slack-adoption-rev1',
                credential_material: this.botToken
            }));
            await this.verifyCredential(credential);
        } catch (error) {
            throw safeOperationalError(error, 'FIXED_MANA_SLACK_CREDENTIAL_STORE_FAILED');
        }

        let result;
        try {
            result = await this.repository.adoptFixedManaSlackConnection({
                definition: FIXED_MANA_SLACK_CONNECTION,
                credential
            });
        } catch (error) {
            await this.compensateCredential(credential);
            throw safeOperationalError(error, 'FIXED_MANA_SLACK_DB_REGISTRATION_FAILED');
        }
        await this.verifyReadback();
        return safeResult(result, 'adopted');
    }

    async verifySlackBinding() {
        let auth;
        let scopes;
        try {
            [auth, scopes] = await Promise.all([
                this.slack.authTest({ token: this.botToken }),
                this.slack.listScopes({ token: this.botToken })
            ]);
        } catch {
            throw failure('FIXED_MANA_SLACK_VERIFICATION_UNAVAILABLE', { retryable: true });
        }
        if (!auth?.ok
            || auth.team_id !== FIXED_MANA_SLACK_CONNECTION.workspace_id
            || auth.team !== FIXED_MANA_SLACK_CONNECTION.team_name
            || auth.user_id !== FIXED_MANA_SLACK_CONNECTION.bot_user_id
            || auth.bot_id !== FIXED_MANA_SLACK_CONNECTION.bot_id
            || !sameArray(normalizedScopes(scopes), [...FIXED_REQUIRED_SCOPES])) {
            throw failure('FIXED_MANA_SLACK_BINDING_MISMATCH', { status: 409 });
        }
        // Slack auth.test does not return app_id for this bot-token grant.
        // The fixed bot_id is therefore the Slack-authoritative app identity
        // root; app_id remains an immutable DB tuple, not mutable CLI input.
    }

    async verifyCredential(credential) {
        let verified;
        try {
            verified = await this.credentialStore.verify({
                tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
                connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
                connection_revision: FIXED_MANA_SLACK_CONNECTION.connection_revision,
                provider: FIXED_MANA_SLACK_CONNECTION.provider,
                credential_ref: credential.credential_ref
            });
        } catch (error) {
            throw safeOperationalError(error, 'FIXED_MANA_SLACK_CREDENTIAL_VERIFY_FAILED');
        }
        if (verified?.valid !== true) throw failure('FIXED_MANA_SLACK_CREDENTIAL_VERIFY_FAILED');
    }

    async compensateCredential(credential) {
        try {
            const cleanup = await this.credentialStore.revoke({
                tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
                connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
                connection_revision: FIXED_MANA_SLACK_CONNECTION.connection_revision,
                provider: FIXED_MANA_SLACK_CONNECTION.provider,
                credential_ref: credential.credential_ref,
                reason: 'fixed_mana_adoption_db_failed'
            });
            if (cleanup?.status !== 'revoked') throw failure('FIXED_MANA_SLACK_CREDENTIAL_REVOKE_FAILED');
        } catch {
            try {
                await this.repository.recordFixedManaSlackConnectionAdoptionOrphan({
                    definition: FIXED_MANA_SLACK_CONNECTION,
                    credential,
                    failure_code: 'FIXED_MANA_SLACK_DB_REGISTRATION_FAILED'
                });
            } catch {
                throw failure('FIXED_MANA_SLACK_CREDENTIAL_ORPHAN_UNRECORDED', { status: 503 });
            }
            throw failure('FIXED_MANA_SLACK_CREDENTIAL_ORPHANED', { status: 503 });
        }
    }

    async verifyReadback() {
        let readback;
        try {
            readback = await this.readback({ definition: FIXED_MANA_SLACK_CONNECTION });
        } catch (error) {
            throw safeOperationalError(error, 'FIXED_MANA_SLACK_POST_COMMIT_READBACK_FAILED');
        }
        if (readback?.connection?.status !== 'active'
            || String(readback?.revision?.connection_revision ?? '') !== FIXED_MANA_SLACK_CONNECTION.connection_revision
            || readback?.credential?.credential_mode !== FIXED_MANA_SLACK_CONNECTION.credential_mode) {
            throw failure('FIXED_MANA_SLACK_POST_COMMIT_READBACK_FAILED');
        }
    }
}
