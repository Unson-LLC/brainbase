import { computeBusinessIdempotencyKey } from './contract-usage-ledger.js';
import { ContractError } from './errors.js';
import { createSignedTenantContext } from './tenant-context.js';

const MAX_TTL_SECONDS = 300;

function wireTimestamp(value) {
    return value.toISOString().replace('.000Z', 'Z');
}

function assertContextInput(input) {
    const objects = ['actor', 'authorization', 'slack'];
    if (!input?.tenant_id || !input.connection_id || !input.operation_id || !input.correlation_id
        || objects.some((field) => !input[field] || typeof input[field] !== 'object')) {
        throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
}

export class TenantContextProducer {
    constructor({
        tenantAuthority,
        connectionRegistry,
        resolveContractRevision,
        resolveCanonicalContext,
        signingKey,
        audience,
        deploymentId,
        deploymentProfile,
        now = () => new Date()
    }) {
        this.tenantAuthority = tenantAuthority;
        this.connectionRegistry = connectionRegistry;
        this.resolveContractRevision = resolveContractRevision;
        this.resolveCanonicalContext = resolveCanonicalContext;
        this.signingKey = signingKey;
        this.audience = audience;
        this.deploymentId = deploymentId;
        this.deploymentProfile = deploymentProfile;
        this.now = now;
    }

    async #loadCanonicalContext(input) {
        if (this.resolveCanonicalContext) return this.resolveCanonicalContext(input);
        const tenant = this.tenantAuthority.resolveTenant({ tenant_id: input.tenant_id });
        if (input.expected_tenant_revision !== undefined
            && input.expected_tenant_revision !== tenant.tenant_revision) {
            throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
        }
        const workspace_connection = await this.connectionRegistry.validateRevision({
            tenant_id: input.tenant_id,
            connection_id: input.connection_id,
            expected_connection_revision: input.expected_connection_revision,
            workspace_id: input.workspace_id,
            app_id: input.app_id,
            required_scopes: input.authorization.capability_ids
        });
        const contract_revision = await this.resolveContractRevision({
            tenant_id: input.tenant_id,
            tenant_revision: tenant.tenant_revision
        });
        return { tenant, workspace_connection, contract_revision };
    }

    async resolveContext(input) {
        assertContextInput(input);
        const canonical = await this.#loadCanonicalContext(input);
        const issuedAt = this.now();
        const expiresAt = new Date(issuedAt.getTime() + MAX_TTL_SECONDS * 1000);
        const tenant = canonical.tenant;
        const connection = canonical.workspace_connection;
        const idempotencyKey = computeBusinessIdempotencyKey({
            protocol_id: 'mana-brainbase-tenant-context',
            protocol_major: '1',
            tenant_id: tenant.tenant_id,
            connection_id: connection.connection_id,
            slack_event_id: input.slack.event_id,
            operation_id: input.operation_id
        });
        return createSignedTenantContext({
            schema_version: '1.0',
            protocol_id: 'mana-brainbase-tenant-context',
            protocol_version: '1.0',
            issuer: 'brainbase',
            audience: [this.audience],
            tenant: {
                tenant_id: tenant.tenant_id,
                tenant_revision: tenant.tenant_revision
            },
            workspace_connection: {
                connection_id: connection.connection_id,
                connection_revision: connection.connection_revision,
                status: connection.status,
                provider: connection.provider,
                installation_id: connection.installation_id,
                workspace_id: connection.workspace_id,
                app_id: connection.app_id
            },
            actor: structuredClone(input.actor),
            authorization: structuredClone(input.authorization),
            placement: {
                deployment_id: this.deploymentId,
                profile: this.deploymentProfile
            },
            slack: structuredClone(input.slack),
            correlation_id: input.correlation_id,
            operation_id: input.operation_id,
            idempotency_key: idempotencyKey,
            contract_revision: canonical.contract_revision,
            credential: {
                mode: connection.credential_mode,
                credential_ref: connection.credential_ref,
                billing_principal_id: input.billing_principal_id ?? input.actor.principal_id
            },
            issued_at: wireTimestamp(issuedAt),
            expires_at: wireTimestamp(expiresAt)
        }, {
            key_id: this.signingKey.key_id,
            private_key: this.signingKey.private_key
        });
    }
}
