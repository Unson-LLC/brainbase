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

async function withBoundedExternal(timeout, operation) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new TenantProvisioningError(
                    'CREDENTIAL_BOUNDARY_UNAVAILABLE',
                    'The canonical credential boundary did not respond within its bounded read window'
                )), timeout);
            })
        ]);
    } catch (error) {
        if (error instanceof TenantProvisioningError) throw error;
        throw new TenantProvisioningError(
            'CREDENTIAL_BOUNDARY_UNAVAILABLE',
            'The canonical credential boundary could not verify the opaque reference'
        );
    } finally {
        if (timer) clearTimeout(timer);
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
export function createPostgresCredentialResolver({
    pool,
    credentialBoundary = null,
    timeoutMs: configuredTimeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    const timeout = timeoutMs(configuredTimeoutMs);
    const configuredPool = requirePool(pool);
    const verifyBoundary = credentialBoundary?.verifyOpaqueReference
        ?? credentialBoundary?.verify
        ?? null;
    return {
        async verifyOpaqueReference({
            tenant_id: tenantId,
            tenant_key: tenantKey,
            credential_ref: credentialRef,
            provider,
            workspace_id: workspaceId,
            app_id: appId,
            connection_id: connectionId,
            connection_revision: connectionRevision,
            allow_unregistered: allowUnregistered = false
        } = {}) {
            if (![tenantId, tenantKey, credentialRef, provider, workspaceId, appId].every((value) => typeof value === 'string' && /^\S+$/u.test(value))) {
                throw new TenantProvisioningError('CREDENTIAL_TENANT_MISMATCH', 'A complete credential boundary is required');
            }
            const hasConnectionBinding = connectionId !== undefined || connectionRevision !== undefined;
            if (hasConnectionBinding
                && (typeof connectionId !== 'string' || !/^\S+$/u.test(connectionId)
                    || !((typeof connectionRevision === 'string' && /^[1-9][0-9]*$/u.test(connectionRevision))
                        || (Number.isSafeInteger(connectionRevision) && connectionRevision > 0)))) {
                throw new TenantProvisioningError('CREDENTIAL_BINDING_INVALID', 'A complete connection binding is required');
            }
            const normalizedConnectionRevision = hasConnectionBinding ? String(connectionRevision) : null;
            const databaseResult = await withBoundedClient(configuredPool, timeout, async (client) => {
                const result = await client.query(
                    `SELECT t.tenant_id, t.tenant_key, cbr.credential_ref, cbr.connection_id,
                            cbr.connection_revision
                       FROM credential_broker_refs cbr
                       JOIN brainbase_tenants t ON t.tenant_id = cbr.tenant_id
                       JOIN workspace_connections wc
                         ON wc.tenant_id = cbr.tenant_id
                        AND wc.connection_id = cbr.connection_id
                        AND wc.connection_revision = cbr.connection_revision
                      WHERE t.tenant_key = $1
                        AND t.tenant_id = $6
                        AND cbr.credential_ref = $2
                        AND wc.provider = $3
                        AND wc.workspace_id = $4
                        AND wc.app_id = $5
                        AND wc.status IN ('pending', 'active')
                      LIMIT 2`,
                    [tenantKey, credentialRef, provider, workspaceId, appId, tenantId]
                );
                const rows = result.rows ?? [];
                if (rows.length === 1 && rows[0].tenant_id === tenantId && rows[0].tenant_key === tenantKey) {
                    return {
                        kind: 'existing',
                        result: {
                            valid: true,
                            tenant_key: tenantKey,
                            connection_id: rows[0].connection_id,
                            connection_revision: Number(rows[0].connection_revision)
                        }
                    };
                }
                if (!allowUnregistered) {
                    return { kind: 'invalid' };
                }

                // A missing PostgreSQL row is not evidence that the opaque
                // reference exists.  The canonical credential store must
                // prove that the reference is already registered and bound
                // to this tenant before the provisioning transaction creates
                // its broker row.
                const ownership = await client.query(
                    `SELECT tenant_id, credential_ref
                       FROM credential_broker_refs
                      WHERE credential_ref = $1
                      LIMIT 2`,
                    [credentialRef]
                );
                if ((ownership.rows ?? []).length > 0) {
                    return { kind: 'invalid' };
                }
                return { kind: 'first_install' };
            });

            if (databaseResult.kind === 'existing') return databaseResult.result;
            if (databaseResult.kind !== 'first_install') {
                return { valid: false, tenant_key: tenantKey };
            }
            if (typeof verifyBoundary !== 'function') {
                throw new TenantProvisioningError(
                    'CREDENTIAL_BOUNDARY_REQUIRED',
                    'A canonical credential boundary is required for first-install verification'
                );
            }

            let boundaryResult;
            try {
                const boundaryInput = {
                    tenant_id: tenantId,
                    tenant_key: tenantKey,
                    credential_ref: credentialRef,
                    provider,
                    workspace_id: workspaceId,
                    app_id: appId
                };
                if (hasConnectionBinding) {
                    boundaryInput.connection_id = connectionId;
                    boundaryInput.connection_revision = normalizedConnectionRevision;
                }
                boundaryResult = await withBoundedExternal(timeout, () => verifyBoundary(boundaryInput));
            } catch (error) {
                if (error instanceof TenantProvisioningError) throw error;
                throw new TenantProvisioningError(
                    'CREDENTIAL_BOUNDARY_UNAVAILABLE',
                    'The canonical credential boundary could not verify the opaque reference'
                );
            }

            if (!boundaryResult || typeof boundaryResult !== 'object' || Array.isArray(boundaryResult)) {
                throw new TenantProvisioningError(
                    'CREDENTIAL_BOUNDARY_INVALID',
                    'The canonical credential boundary returned an invalid verification result'
                );
            }
            if (boundaryResult.valid !== true) {
                return { valid: false, tenant_key: tenantKey };
            }
            const bindingMatches = [
                ['tenant_id', tenantId],
                ['credential_ref', credentialRef],
                ['provider', provider],
                ...(hasConnectionBinding
                    ? [
                        ['connection_id', connectionId],
                        ['connection_revision', normalizedConnectionRevision]
                    ]
                    : [
                        ['tenant_key', tenantKey],
                        ['workspace_id', workspaceId],
                        ['app_id', appId]
                    ])
            ].every(([field, expected]) => field === 'connection_revision'
                ? String(boundaryResult[field]) === expected
                : boundaryResult[field] === expected);
            const optionalContextMatches = ['tenant_key', 'workspace_id', 'app_id']
                .every((field) => boundaryResult[field] === undefined || boundaryResult[field] === {
                    tenant_key: tenantKey,
                    workspace_id: workspaceId,
                    app_id: appId
                }[field]);
            if (!bindingMatches || !optionalContextMatches) {
                return { valid: false, tenant_key: tenantKey };
            }
            return {
                valid: true,
                tenant_key: tenantKey,
                first_install: true,
                ...(hasConnectionBinding ? {
                    connection_id: connectionId,
                    connection_revision: Number(normalizedConnectionRevision)
                } : {})
            };
        }
    };
}
