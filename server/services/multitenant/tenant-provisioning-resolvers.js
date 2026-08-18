import { TenantProvisioningError } from './tenant-provisioner.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 60_000;

function timeoutMs(value) {
    const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
        throw new TenantProvisioningError('RESOLVER_CONFIG_REQUIRED', 'Resolver timeout must be between 1 and 60000 milliseconds');
    }
    return parsed;
}

function requirePool(pool) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TenantProvisioningError('RESOLVER_CONFIG_REQUIRED', 'A PostgreSQL pool is required for production resolvers');
    }
    return pool;
}

async function withBoundedClient(pool, timeout, operation) {
    const client = await requirePool(pool).connect();
    let timeoutConfigured = false;
    try {
        // The resolver client is deliberately separate from the provisioner's
        // transaction and advisory lock.  A statement timeout makes an
        // unavailable canonical source fail closed without holding either.
        await client.query(`SET statement_timeout = '${timeout}ms'`);
        timeoutConfigured = true;
        return await operation(client);
    } catch (error) {
        if (error instanceof TenantProvisioningError) throw error;
        throw new TenantProvisioningError('RESOLVER_UNAVAILABLE', 'A canonical resolver did not respond within its bounded read window');
    } finally {
        if (timeoutConfigured) {
            try { await client.query('RESET statement_timeout'); } catch { /* the client is released below */ }
        }
        client.release?.();
    }
}

/**
 * Resolve a project code from the canonical Info SSOT project table.
 *
 * This is read-only and intentionally does not create a Graph entity or
 * person.  A separate pool client keeps the lookup outside provisioning's
 * transaction/advisory lock.
 */
export function createPostgresGraphProjectResolver({ pool, timeoutMs: configuredTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const timeout = timeoutMs(configuredTimeoutMs);
    const configuredPool = requirePool(pool);
    return {
        async resolveCanonicalProject({ project_code: projectCode } = {}) {
            if (typeof projectCode !== 'string' || !/^\S{1,128}$/u.test(projectCode)) {
                throw new TenantProvisioningError('PROJECT_UNAVAILABLE', 'A canonical project code is required');
            }
            return withBoundedClient(configuredPool, timeout, async (client) => {
                const result = await client.query(
                    `SELECT id
                       FROM projects
                      WHERE code = $1
                      ORDER BY id
                      LIMIT 2`,
                    [projectCode]
                );
                const rows = result.rows ?? [];
                return {
                    project_id: rows.length === 1 ? rows[0].id : null,
                    matches: rows.length
                };
            });
        }
    };
}

/**
 * Verify only the opaque credential reference and its exact connection
 * boundary.  Secret material is owned by the credential broker and is never
 * selected, returned, logged, or placed in a provisioning receipt.
 */
export function createPostgresCredentialResolver({ pool, timeoutMs: configuredTimeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const timeout = timeoutMs(configuredTimeoutMs);
    const configuredPool = requirePool(pool);
    return {
        async verifyOpaqueReference({
            tenant_key: tenantKey,
            credential_ref: credentialRef,
            provider,
            workspace_id: workspaceId,
            app_id: appId,
            allow_unregistered: allowUnregistered = false
        } = {}) {
            if (![tenantKey, credentialRef, provider, workspaceId, appId].every((value) => typeof value === 'string' && /^\S+$/u.test(value))) {
                throw new TenantProvisioningError('CREDENTIAL_TENANT_MISMATCH', 'A complete credential boundary is required');
            }
            return withBoundedClient(configuredPool, timeout, async (client) => {
                const result = await client.query(
                    `SELECT t.tenant_key, cbr.credential_ref, cbr.connection_id,
                            cbr.connection_revision
                       FROM credential_broker_refs cbr
                       JOIN brainbase_tenants t ON t.tenant_id = cbr.tenant_id
                       JOIN workspace_connections wc
                         ON wc.tenant_id = cbr.tenant_id
                        AND wc.connection_id = cbr.connection_id
                        AND wc.connection_revision = cbr.connection_revision
                      WHERE t.tenant_key = $1
                        AND cbr.credential_ref = $2
                        AND wc.provider = $3
                        AND wc.workspace_id = $4
                        AND wc.app_id = $5
                        AND wc.status IN ('pending', 'active')
                      LIMIT 2`,
                    [tenantKey, credentialRef, provider, workspaceId, appId]
                );
                const rows = result.rows ?? [];
                if (rows.length === 1 && rows[0].tenant_key === tenantKey) {
                    return {
                        valid: true,
                        tenant_key: tenantKey,
                        connection_id: rows[0].connection_id,
                        connection_revision: Number(rows[0].connection_revision)
                    };
                }
                if (!allowUnregistered) {
                    return { valid: false, tenant_key: tenantKey };
                }

                // A first install is allowed to declare an opaque reference
                // that this transaction will create later.  It is not an
                // unconditional bypass: an existing reference, including one
                // owned by another tenant or bound to different connection
                // metadata, remains a hard mismatch.
                const ownership = await client.query(
                    `SELECT tenant_id, credential_ref
                       FROM credential_broker_refs
                      WHERE credential_ref = $1
                      LIMIT 2`,
                    [credentialRef]
                );
                if ((ownership.rows ?? []).length > 0) {
                    return { valid: false, tenant_key: tenantKey };
                }
                return {
                    valid: true,
                    tenant_key: tenantKey,
                    first_install: true
                };
            });
        }
    };
}
