import { deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';

const FORBIDDEN_FIELD = /(?:^|_)(?:token|secret|credential_body|private_key|authorization)(?:$|_)/i;

function assertNoSecretArtifact(input) {
    const forbidden = Object.keys(input).find((field) => field !== 'credential_ref' && FORBIDDEN_FIELD.test(field));
    if (forbidden) {
        throw new ContractError('SECRET_ARTIFACT_FORBIDDEN', { status: 400, details: { field: forbidden } });
    }
}

function snapshot(value) {
    return deepFreeze(structuredClone(value));
}

export class WorkspaceConnectionRegistry {
    #current = new Map();
    #history = new Map();

    constructor({ now = () => new Date() } = {}) {
        this.now = now;
    }

    #save(connection) {
        const immutableSnapshot = snapshot(connection);
        const revisions = this.#history.get(connection.connection_id) ?? [];
        revisions.push(immutableSnapshot);
        this.#history.set(connection.connection_id, revisions);
        this.#current.set(connection.connection_id, immutableSnapshot);
        return snapshot(immutableSnapshot);
    }

    register(input) {
        assertNoSecretArtifact(input);
        const required = ['tenant_id', 'provider', 'installation_id', 'workspace_id', 'app_id', 'credential_ref'];
        if (required.some((field) => !input[field]) || !Array.isArray(input.granted_scopes)) {
            throw new ContractError('WORKSPACE_CONNECTION_INVALID', { status: 400 });
        }
        const installedAt = this.now().toISOString();
        return this.#save({
            connection_id: generateCanonicalId('wsc'),
            connection_revision: '1',
            tenant_id: input.tenant_id,
            provider: input.provider,
            installation_id: input.installation_id,
            workspace_id: input.workspace_id,
            app_id: input.app_id,
            granted_scopes: [...new Set(input.granted_scopes)].sort(),
            status: 'active',
            credential_ref: input.credential_ref,
            credential_mode: input.credential_mode ?? 'cloud_standard',
            installed_at: installedAt,
            revoked_at: null,
            supersedes_connection_revision: null
        });
    }

    reinstall(input) {
        assertNoSecretArtifact(input);
        const current = this.#current.get(input.connection_id);
        if (!current) throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });
        if (current.tenant_id !== input.tenant_id) throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
        if (current.connection_revision !== input.expected_connection_revision) {
            throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
        }
        if (current.status === 'revoked') throw new ContractError('WORKSPACE_CONNECTION_REVOKED', { status: 403 });
        return this.#save({
            ...current,
            connection_revision: String(Number(current.connection_revision) + 1),
            installation_id: input.installation_id,
            granted_scopes: [...new Set(input.granted_scopes)].sort(),
            credential_ref: input.credential_ref,
            installed_at: this.now().toISOString(),
            supersedes_connection_revision: current.connection_revision
        });
    }

    revoke({ tenant_id, connection_id, expected_connection_revision, reason }) {
        const current = this.#current.get(connection_id);
        if (!current) throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', { status: 503 });
        if (current.tenant_id !== tenant_id) throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
        if (current.connection_revision !== expected_connection_revision) {
            throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
        }
        return this.#save({
            ...current,
            connection_revision: String(Number(current.connection_revision) + 1),
            status: 'revoked',
            revoked_at: this.now().toISOString(),
            revocation_reason: reason ?? 'unspecified',
            supersedes_connection_revision: current.connection_revision
        });
    }

    validateRevision({ tenant_id, connection_id, expected_connection_revision, workspace_id, app_id, required_scopes = [] }) {
        const current = this.#current.get(connection_id);
        if (!current) throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });
        if (current.tenant_id !== tenant_id) throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
        if (current.connection_revision !== expected_connection_revision) {
            throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
        }
        const immutableSnapshot = (this.#history.get(connection_id) ?? [])
            .find((revision) => revision.connection_revision === expected_connection_revision);
        if (!immutableSnapshot) {
            throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', {
                status: 503,
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
        if (JSON.stringify(immutableSnapshot) !== JSON.stringify(current)) {
            throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
        }
        if (current.status !== 'active') throw new ContractError('WORKSPACE_CONNECTION_REVOKED', { status: 403 });
        if ((workspace_id && current.workspace_id !== workspace_id) || (app_id && current.app_id !== app_id)) {
            throw new ContractError('WORKSPACE_OR_APP_MISMATCH', { status: 403 });
        }
        if (required_scopes.some((scope) => !current.granted_scopes.includes(scope))) {
            throw new ContractError('CAPABILITY_SCOPE_MISMATCH', { status: 403 });
        }
        return snapshot({
            valid: true,
            authoritative: true,
            tenant_id: current.tenant_id,
            connection_id: current.connection_id,
            connection_revision: current.connection_revision,
            status: current.status,
            provider: current.provider,
            installation_id: current.installation_id,
            workspace_id: current.workspace_id,
            app_id: current.app_id,
            granted_scopes: current.granted_scopes,
            credential_ref: current.credential_ref,
            credential_mode: current.credential_mode
        });
    }

    history(connectionId) {
        return (this.#history.get(connectionId) ?? []).map((connection) => snapshot(connection));
    }
}
