import { randomUUID } from 'node:crypto';

import { canonicalProvisioningFingerprint, normalizeProvisioningManifest } from './provisioning-manifest.js';

const TERMINAL_STATUSES = new Set(['applied', 'failed', 'conflict']);

export class TenantProvisioningError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'TenantProvisioningError';
        this.code = code;
        this.details = details;
    }
}

function operationId() {
    return `op_${randomUUID().replaceAll('-', '')}`;
}

function assertActor(actorId) {
    if (typeof actorId !== 'string' || !/^[^\s]{3,255}$/u.test(actorId)) {
        throw new TenantProvisioningError('ACTOR_REQUIRED', 'A provisioning actor is required');
    }
}

function safeString(value) {
    return value == null ? null : String(value);
}

function normalizeProjectResult(result) {
    if (!result || Number(result.matches ?? 1) !== 1 || !result.project_id) {
        const code = result && Number(result.matches) > 1 ? 'PROJECT_AMBIGUOUS' : 'PROJECT_UNAVAILABLE';
        throw new TenantProvisioningError(code, code === 'PROJECT_AMBIGUOUS'
            ? 'Canonical project resolution returned multiple candidates'
            : 'Canonical project resolution did not return one project');
    }
    return { project_id: safeString(result.project_id) };
}

function assertCredentialResult(result, tenantKey) {
    if (!result || result.valid !== true || result.tenant_key !== tenantKey) {
        throw new TenantProvisioningError('CREDENTIAL_TENANT_MISMATCH', 'Credential reference is not owned by the requested tenant');
    }
}

function redactedReceipt(receipt) {
    return {
        operation_id: receipt.operation_id,
        tenant_key: receipt.tenant_key,
        tenant_id: receipt.tenant_id,
        tenant_revision: receipt.tenant_revision,
        project_id: receipt.project_id,
        connection_id: receipt.connection_id,
        connection_revision: receipt.connection_revision,
        actor_id: receipt.actor_id,
        capabilities: receipt.capabilities,
        desired_state_sha256: receipt.desired_state_sha256,
        outcome: receipt.outcome,
        failure_code: receipt.failure_code,
        readback: receipt.readback
    };
}

async function recordFailedOperation(client, {
    operationId: operationIdValue,
    tenantKey,
    idempotencyKey,
    desiredStateSha256,
    actorId,
    error,
    now
}) {
    if (!operationIdValue || !tenantKey || !idempotencyKey || !desiredStateSha256) return;
    const failureReceipt = redactedReceipt({
        operation_id: operationIdValue,
        tenant_key: tenantKey,
        tenant_id: null,
        tenant_revision: null,
        project_id: null,
        connection_id: null,
        connection_revision: null,
        actor_id: actorId,
        capabilities: [],
        desired_state_sha256: desiredStateSha256,
        outcome: 'failed',
        failure_code: error?.code ?? 'PROVISIONING_FAILED',
        readback: {}
    });
    let failureTransactionStarted = false;
    try {
        await client.query('BEGIN');
        failureTransactionStarted = true;
        await client.query(
            `INSERT INTO tenant_provisioning_operations (
                operation_id, tenant_key, idempotency_key, desired_state_sha256,
                status, actor_principal_id, receipt_payload, created_at, updated_at, completed_at
             ) VALUES ($1, $2, $3, $4, 'failed', $5, $6::jsonb, $7, $7, $7)
             ON CONFLICT (tenant_key, idempotency_key) DO NOTHING`,
            [operationIdValue, tenantKey, idempotencyKey, desiredStateSha256, actorId, JSON.stringify(failureReceipt), now]
        );
        await client.query('COMMIT');
        failureTransactionStarted = false;
    } catch {
        if (failureTransactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve the original provisioning error */ }
        }
    }
}

async function readExistingOperation(client, tenantKey, idempotencyKey) {
    const result = await client.query(
        `SELECT operation_id, desired_state_sha256, status, receipt_payload
           FROM tenant_provisioning_operations
          WHERE tenant_key = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [tenantKey, idempotencyKey]
    );
    return result.rows[0] ?? null;
}

async function claimOperation(client, {
    operationId: id,
    tenantKey,
    idempotencyKey,
    desiredStateSha256,
    actorId,
    now
}) {
    const result = await client.query(
        `INSERT INTO tenant_provisioning_operations (
            operation_id, tenant_key, idempotency_key, desired_state_sha256,
            status, actor_principal_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'claimed', $5, $6, $6)
         ON CONFLICT (tenant_key, idempotency_key) DO NOTHING
         RETURNING operation_id, status`,
        [id, tenantKey, idempotencyKey, desiredStateSha256, actorId, now]
    );
    return result.rows[0] ?? null;
}

async function ensureTenant(client, manifest, now) {
    let result;
    try {
        result = await client.query(
            `INSERT INTO brainbase_tenants (
                tenant_id, tenant_key, tenant_revision, status, display_name,
                created_at, updated_at
             ) VALUES ($1, $2, 1, 'provisioning', $3, $4, $4)
             ON CONFLICT (tenant_id) DO UPDATE SET
                tenant_key = EXCLUDED.tenant_key,
                display_name = EXCLUDED.display_name,
                updated_at = EXCLUDED.updated_at
             WHERE brainbase_tenants.tenant_key = EXCLUDED.tenant_key
             RETURNING tenant_id, tenant_key, tenant_revision`,
            [manifest.tenant_id, manifest.tenant_key, manifest.display_name, now]
        );
    } catch (error) {
        if (error?.code === '23505') throw new TenantProvisioningError('TENANT_KEY_CONFLICT', 'tenant_key is already owned by another tenant');
        throw error;
    }
    const row = result.rows[0];
    if (!row) throw new TenantProvisioningError('TENANT_KEY_CONFLICT', 'tenant_id is already owned by another tenant_key');
    await client.query(
        `INSERT INTO brainbase_tenant_revisions (
            tenant_id, tenant_revision, tenant_key, status, display_name,
            created_at, updated_at, recorded_at
         ) VALUES ($1, $2, $3, 'provisioning', $4, $5, $5, $5)
         ON CONFLICT (tenant_id, tenant_revision) DO NOTHING`,
        [row.tenant_id, row.tenant_revision, manifest.tenant_key, manifest.display_name, now]
    );
    return { tenant_id: row.tenant_id, tenant_key: row.tenant_key, tenant_revision: Number(row.tenant_revision) };
}

async function activateTenant(client, tenant, now) {
    await client.query(
        `UPDATE brainbase_tenants
            SET status = 'active', updated_at = $2
          WHERE tenant_id = $1 AND tenant_key = $3`,
        [tenant.tenant_id, now, tenant.tenant_key]
    );
    await client.query(
        `UPDATE brainbase_tenant_revisions
            SET status = 'active', updated_at = $2
          WHERE tenant_id = $1 AND tenant_revision = $3 AND tenant_key = $4`,
        [tenant.tenant_id, now, tenant.tenant_revision, tenant.tenant_key]
    );
}

async function ensureTenantProject(client, tenant, project, manifest, now) {
    const existingResult = await client.query(
        `SELECT project_id
           FROM tenant_projects
          WHERE tenant_id = $1 AND project_code = $2
          FOR UPDATE`,
        [tenant.tenant_id, manifest.project_code]
    );
    const existing = existingResult.rows[0];
    if (existing && existing.project_id !== project.project_id) {
        throw new TenantProvisioningError('PROJECT_CANONICAL_ID_CONFLICT', 'Project code is already bound to another canonical project');
    }
    const result = await client.query(
        `INSERT INTO tenant_projects (
            project_id, tenant_id, tenant_revision_at_write, project_code, project_payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (project_id) DO UPDATE SET
            tenant_revision_at_write = EXCLUDED.tenant_revision_at_write,
            project_code = EXCLUDED.project_code,
            project_payload = EXCLUDED.project_payload
         WHERE tenant_projects.tenant_id = EXCLUDED.tenant_id
         RETURNING project_id, tenant_id, project_code`,
        [project.project_id, tenant.tenant_id, tenant.tenant_revision, manifest.project_code,
            JSON.stringify({ source: 'canonical_graph_project', project_code: manifest.project_code })]
    );
    if (result.rowCount === 0 || !result.rows[0]) {
        throw new TenantProvisioningError('PROJECT_TENANT_CONFLICT', 'Canonical project is already owned by another tenant');
    }
    return { project_id: result.rows[0].project_id, project_code: result.rows[0].project_code };
}

async function ensureWorkspaceConnection(client, manifest, tenant, now) {
    const input = manifest.workspace_connection;
    const existingResult = await client.query(
        `SELECT connection_id, connection_revision
           FROM workspace_connections
          WHERE tenant_id = $1
            AND provider = $2
            AND workspace_id = $3
            AND app_id = $4
            AND status IN ('pending', 'active')
          FOR UPDATE`,
        [tenant.tenant_id, input.provider, input.workspace_id, input.app_id]
    );
    const existing = existingResult.rows[0];
    const connectionId = existing?.connection_id ?? input.connection_id;
    const connectionRevision = Number(existing?.connection_revision ?? 0) + 1;
    if (existing) {
        await client.query(
            `UPDATE workspace_connections
                SET connection_revision = $2,
                    tenant_revision_at_write = $3,
                    installation_id = $4,
                    granted_scopes = $5,
                    status = 'active',
                    credential_ref = $6,
                    installed_at = $7,
                    revoked_at = NULL,
                    supersedes_connection_revision = $8
              WHERE tenant_id = $1 AND connection_id = $9`,
            [tenant.tenant_id, connectionRevision, tenant.tenant_revision, input.installation_id,
                input.scopes, input.credential_ref, now, connectionRevision - 1, connectionId]
        );
    } else {
        await client.query(
            `INSERT INTO workspace_connections (
                connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                provider, installation_id, workspace_id, app_id, granted_scopes,
                status, credential_ref, installed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11)`,
            [connectionId, connectionRevision, tenant.tenant_id, tenant.tenant_revision,
                input.provider, input.installation_id, input.workspace_id, input.app_id,
                input.scopes, input.credential_ref, now]
        );
    }
    await client.query(
        `INSERT INTO workspace_connection_revisions (
            tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (tenant_id, connection_id, connection_revision) DO NOTHING`,
        [tenant.tenant_id, connectionId, connectionRevision, JSON.stringify({
            provider: input.provider,
            workspace_id: input.workspace_id,
            app_id: input.app_id,
            scopes: input.scopes,
            credential_ref: input.credential_ref,
            status: 'active'
        }), now]
    );
    const credentialResult = await client.query(
        `INSERT INTO credential_broker_refs (
            credential_ref, tenant_id, connection_id, connection_revision,
            credential_mode, refresh_revision, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 1, $6, $6)
         ON CONFLICT (credential_ref) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            connection_id = EXCLUDED.connection_id,
            connection_revision = EXCLUDED.connection_revision,
            credential_mode = EXCLUDED.credential_mode,
            refresh_revision = credential_broker_refs.refresh_revision + 1,
            updated_at = EXCLUDED.updated_at
         WHERE credential_broker_refs.tenant_id = EXCLUDED.tenant_id
         RETURNING credential_ref`,
        [input.credential_ref, tenant.tenant_id, connectionId, connectionRevision,
            input.credential_mode, now]
    );
    if (credentialResult.rowCount === 0) {
        throw new TenantProvisioningError('CREDENTIAL_TENANT_MISMATCH', 'Credential reference is already owned by another tenant');
    }
    return { connection_id: connectionId, connection_revision: connectionRevision };
}

async function ensureServiceRegistry(client, actor, tenantKey, now) {
    const actorResult = await client.query(
        `INSERT INTO brainbase_service_actors (
            actor_id, tenant_key, canonical_project_id, status, created_at, updated_at
         ) VALUES ($1, $2, $3, 'active', $4, $4)
         ON CONFLICT (actor_id) DO UPDATE SET
            tenant_key = EXCLUDED.tenant_key,
            canonical_project_id = EXCLUDED.canonical_project_id,
            status = 'active',
            updated_at = EXCLUDED.updated_at
         WHERE brainbase_service_actors.tenant_key = EXCLUDED.tenant_key
         RETURNING actor_id`,
        [actor.actor_id, tenantKey, actor.canonical_project_id, now]
    );
    if (actorResult.rowCount === 0) {
        throw new TenantProvisioningError('SERVICE_ACTOR_TENANT_CONFLICT', 'Service actor is already owned by another tenant');
    }
    for (const capabilityId of actor.capabilities) {
        await client.query(
            `INSERT INTO brainbase_capabilities (capability_id, status, created_at, updated_at)
             VALUES ($1, 'active', $2, $2)
             ON CONFLICT (capability_id) DO UPDATE SET status = 'active', updated_at = EXCLUDED.updated_at`,
            [capabilityId, now]
        );
        await client.query(
            `INSERT INTO brainbase_service_actor_capabilities (
                actor_id, capability_id, tenant_key, granted_at
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (actor_id, capability_id, tenant_key) DO NOTHING`,
            [actor.actor_id, capabilityId, tenantKey, now]
        );
    }
    for (const publicJwk of actor.public_keys ?? []) {
        await client.query(
            `INSERT INTO brainbase_service_actor_keys (actor_id, kid, public_jwk, status, created_at)
             VALUES ($1, $2, $3::jsonb, 'active', $4)
             ON CONFLICT (actor_id, kid) DO UPDATE SET public_jwk = EXCLUDED.public_jwk, status = 'active'`,
            [actor.actor_id, publicJwk.kid, JSON.stringify(publicJwk), now]
        );
    }
}

async function updateOperation(client, operationIdValue, receipt, now) {
    await client.query(
        `UPDATE tenant_provisioning_operations
            SET status = 'applied', receipt_payload = $2::jsonb, completed_at = $3, updated_at = $3
          WHERE operation_id = $1`,
        [operationIdValue, JSON.stringify(receipt), now]
    );
}

async function readback(client, tenant, project, connection, actor) {
    const result = await client.query(
        `SELECT t.tenant_id, t.tenant_key, t.tenant_revision,
                tp.project_id, tp.project_code,
                wc.connection_id, wc.connection_revision,
                sa.actor_id
           FROM brainbase_tenants t
           JOIN tenant_projects tp ON tp.tenant_id = t.tenant_id AND tp.project_id = $3
           JOIN workspace_connections wc ON wc.tenant_id = t.tenant_id
           JOIN brainbase_service_actors sa ON sa.tenant_key = t.tenant_key
          WHERE t.tenant_id = $1 AND t.tenant_key = $2
            AND wc.connection_id = $4 AND sa.actor_id = $5`,
        [tenant.tenant_id, tenant.tenant_key, project.project_id, connection.connection_id, actor.actor_id]
    );
    const row = result.rows[0];
    if (!row) throw new TenantProvisioningError('READBACK_FAILED', 'Provisioning state was not found during readback');
    if (row.tenant_key !== tenant.tenant_key
        || row.tenant_revision !== tenant.tenant_revision
        || row.project_id !== project.project_id
        || row.project_code !== project.project_code
        || row.connection_id !== connection.connection_id
        || Number(row.connection_revision) !== Number(connection.connection_revision)
        || row.actor_id !== actor.actor_id) {
        throw new TenantProvisioningError('READBACK_BOUNDARY_FAILED', 'Provisioning readback crossed a tenant boundary');
    }
    return {
        tenant: true,
        tenant_project: true,
        workspace_connection: true,
        service_actor: true
    };
}

export async function exportServiceActorJwks({ client, tenantKey, actorId } = {}) {
    if (!client || typeof client.query !== 'function') {
        throw new TenantProvisioningError('DATABASE_REQUIRED', 'A PostgreSQL client is required');
    }
    if (typeof tenantKey !== 'string' || !/^\S{2,63}$/u.test(tenantKey)) {
        throw new TenantProvisioningError('TENANT_REQUIRED', 'A tenant key is required');
    }
    if (typeof actorId !== 'string' || !/^\S{3,128}$/u.test(actorId)) {
        throw new TenantProvisioningError('ACTOR_REQUIRED', 'A service actor is required');
    }
    const result = await client.query(
        `SELECT sa.actor_id, sa.tenant_key, j.jwks
           FROM brainbase_service_actors sa
           JOIN brainbase_service_actor_jwks j ON j.actor_id = sa.actor_id
          WHERE sa.tenant_key = $1 AND sa.actor_id = $2 AND sa.status = 'active'`,
        [tenantKey, actorId]
    );
    const row = result.rows[0];
    if (!row || row.tenant_key !== tenantKey || row.actor_id !== actorId) {
        throw new TenantProvisioningError('JWKS_NOT_FOUND', 'No active public key set exists for this service actor');
    }
    if (!row.jwks || !Array.isArray(row.jwks.keys)) {
        throw new TenantProvisioningError('JWKS_READBACK_FAILED', 'Service actor public key set is invalid');
    }
    return { actor_id: actorId, tenant_key: tenantKey, keys: row.jwks.keys };
}

export async function provisionTenant({
    client,
    manifest,
    idempotencyKey,
    actorId,
    graphResolver,
    credentialResolver,
    fingerprint = null,
    now = new Date().toISOString(),
    operationIdFactory = operationId,
    commit = true
} = {}) {
    if (!client || typeof client.query !== 'function') throw new TenantProvisioningError('DATABASE_REQUIRED', 'A PostgreSQL client is required');
    if (typeof idempotencyKey !== 'string' || !/^\S{3,255}$/u.test(idempotencyKey)) {
        throw new TenantProvisioningError('IDEMPOTENCY_KEY_REQUIRED', 'A provisioning idempotency key is required');
    }
    assertActor(actorId);
    if (!graphResolver || typeof graphResolver.resolveCanonicalProject !== 'function') {
        throw new TenantProvisioningError('GRAPH_RESOLVER_REQUIRED', 'A read-only canonical project resolver is required');
    }
    if (!credentialResolver || typeof credentialResolver.verifyOpaqueReference !== 'function') {
        throw new TenantProvisioningError('CREDENTIAL_RESOLVER_REQUIRED', 'A credential reference resolver is required');
    }
    const normalizedManifest = normalizeProvisioningManifest(manifest);
    const desiredStateSha256 = fingerprint ?? canonicalProvisioningFingerprint(normalizedManifest);
    let transactionStarted = false;
    let claimedOperationId = null;
    try {
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [normalizedManifest.tenant_key]);

        const existing = await readExistingOperation(client, normalizedManifest.tenant_key, idempotencyKey);
        if (existing) {
            if (existing.desired_state_sha256 !== desiredStateSha256) {
                throw new TenantProvisioningError('IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to another desired state');
            }
            if (existing.status === 'applied' && existing.receipt_payload) {
                await client.query('ROLLBACK');
                transactionStarted = false;
                return { replayed: true, receipt: redactedReceipt(existing.receipt_payload) };
            }
            if (TERMINAL_STATUSES.has(existing.status)) {
                throw new TenantProvisioningError(
                    existing.receipt_payload?.failure_code ?? 'PROVISIONING_FAILED',
                    'A previous provisioning attempt failed; use a new idempotency key after remediation'
                );
            }
            throw new TenantProvisioningError('PROVISIONING_IN_PROGRESS', 'A provisioning operation is already in progress');
        }

        claimedOperationId = operationIdFactory();
        const claimed = await claimOperation(client, {
            operationId: claimedOperationId,
            tenantKey: normalizedManifest.tenant_key,
            idempotencyKey,
            desiredStateSha256,
            actorId,
            now
        });
        if (!claimed) throw new TenantProvisioningError('IDEMPOTENCY_CONFLICT', 'Provisioning operation could not claim its idempotency key');
        const project = normalizeProjectResult(await graphResolver.resolveCanonicalProject({
            tenant_key: normalizedManifest.tenant_key,
            project_code: normalizedManifest.project_code
        }));
        if (project.project_id !== normalizedManifest.service_actor.canonical_project_id) {
            throw new TenantProvisioningError('PROJECT_ACTOR_MISMATCH', 'Resolved project does not match the service actor registry');
        }
        assertCredentialResult(await credentialResolver.verifyOpaqueReference({
            tenant_key: normalizedManifest.tenant_key,
            credential_ref: normalizedManifest.workspace_connection.credential_ref,
            provider: normalizedManifest.workspace_connection.provider,
            workspace_id: normalizedManifest.workspace_connection.workspace_id,
            app_id: normalizedManifest.workspace_connection.app_id
        }), normalizedManifest.tenant_key);

        const tenant = await ensureTenant(client, normalizedManifest, now);
        const tenantProject = await ensureTenantProject(client, tenant, project, normalizedManifest, now);
        const connection = await ensureWorkspaceConnection(client, normalizedManifest, tenant, now);
        await ensureServiceRegistry(client, normalizedManifest.service_actor, normalizedManifest.tenant_key, now);
        await activateTenant(client, tenant, now);
        const readbackResult = await readback(client, tenant, tenantProject, connection, normalizedManifest.service_actor);
        const receipt = redactedReceipt({
            operation_id: claimed.operation_id,
            tenant_key: tenant.tenant_key,
            tenant_id: tenant.tenant_id,
            tenant_revision: tenant.tenant_revision,
            project_id: project.project_id,
            connection_id: connection.connection_id,
            connection_revision: connection.connection_revision,
            actor_id: normalizedManifest.service_actor.actor_id,
            capabilities: normalizedManifest.service_actor.capabilities,
            desired_state_sha256: desiredStateSha256,
            outcome: 'succeeded',
            readback: readbackResult
        });
        await updateOperation(client, claimed.operation_id, receipt, now);
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        transactionStarted = false;
        return { replayed: false, persisted: commit, receipt };
    } catch (error) {
        if (transactionStarted) {
            try { await client.query('ROLLBACK'); } catch { /* preserve safe original error */ }
        }
        const safeError = error instanceof TenantProvisioningError
            ? error
            : new TenantProvisioningError('PROVISIONING_FAILED', 'Tenant provisioning failed; inspect the control-plane logs');
        if (commit) {
            await recordFailedOperation(client, {
                operationId: claimedOperationId,
                tenantKey: normalizedManifest.tenant_key,
                idempotencyKey,
                desiredStateSha256,
                actorId,
                error: safeError,
                now
            });
        }
        throw safeError;
    }
}
