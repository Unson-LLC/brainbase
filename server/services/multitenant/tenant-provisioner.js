import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import { canonicalProvisioningFingerprint, normalizeProvisioningManifest } from './provisioning-manifest.js';

const TERMINAL_STATUSES = new Set(['applied', 'conflict']);
const CLAIM_STALE_MS = 120_000;

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

function claimToken() {
    return randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
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
        contract_revision: receipt.contract_revision,
        desired_state_sha256: receipt.desired_state_sha256,
        outcome: receipt.outcome,
        failure_code: receipt.failure_code,
        readback: receipt.readback
    };
}

function timestampForComparison(value) {
    if (value instanceof Date) return value.toISOString().replace('.000Z', 'Z');
    return value == null ? null : String(value);
}

function contractCore(contract) {
    return {
        contract_id: contract.contract_id,
        revision: String(contract.revision),
        status: contract.status,
        effective_from: timestampForComparison(contract.effective_from),
        effective_until: timestampForComparison(contract.effective_until),
        plan_code: contract.plan_code,
        allowances: contract.allowances,
        thresholds_basis_points: contract.thresholds_basis_points.map(Number),
        overage_policy: contract.overage_policy,
        hard_stop_basis_points: Number(contract.hard_stop_basis_points),
        rate_card_revision: Number(contract.rate_card_revision),
        fx_table_revision: Number(contract.fx_table_revision),
        sales_price_revision: Number(contract.sales_price_revision)
    };
}

function runtimeBinding(contract) {
    return {
        capabilities: [...contract.capabilities],
        audience: [...contract.audience],
        deployment_id: contract.deployment_id,
        profile: contract.profile
    };
}

function contractReceipt(contract) {
    return {
        ...contractCore(contract),
        ...runtimeBinding(contract)
    };
}

function assertContractEffective(contract, now) {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)
        || Date.parse(contract.effective_from) > nowMs
        || (contract.effective_until !== null && Date.parse(contract.effective_until) <= nowMs)) {
        throw new TenantProvisioningError('CONTRACT_NOT_EFFECTIVE', 'Contract revision is not effective at provisioning time');
    }
}

function contractRowsEqual(existing, contract) {
    return canonicalJson(contractCore(existing)) === canonicalJson(contractCore(contract));
}

function bindingRowsEqual(existing, contract) {
    return canonicalJson({
        capabilities: [...(existing.capabilities ?? [])].sort(),
        audience: [...(existing.audience ?? [])].sort(),
        deployment_id: existing.deployment_id,
        profile: existing.profile
    }) === canonicalJson(runtimeBinding(contract));
}

async function ensureContractRevision(client, tenant, contract, now) {
    assertContractEffective(contract, now);
    const revision = Number(contract.revision);
    const existingResult = await client.query(
        `SELECT tenant_id, contract_id, contract_revision, tenant_revision_at_write,
                status, effective_from, effective_until, plan_code, allowances,
                thresholds_basis_points, overage_policy, hard_stop_basis_points,
                rate_card_revision, fx_table_revision, sales_price_revision
           FROM tenant_contract_revisions
          WHERE tenant_id = $1 AND contract_revision = $2
          FOR UPDATE`,
        [tenant.tenant_id, revision]
    );
    const existing = existingResult.rows[0] ?? null;
    if (existing && existing.contract_id !== contract.contract_id) {
        throw new TenantProvisioningError('CONTRACT_REVISION_CONFLICT', 'Contract revision is already owned by another contract');
    }
    if (existing && !contractRowsEqual(existing, contract)) {
        throw new TenantProvisioningError('CONTRACT_REVISION_CONFLICT', 'Canonical contract revision payload differs from the manifest');
    }
    if (!existing) {
        try {
            await client.query(
                `INSERT INTO tenant_contract_revisions (
                    contract_id, contract_revision, tenant_id, tenant_revision_at_write,
                    status, effective_from, effective_until, plan_code, allowances,
                    thresholds_basis_points, overage_policy, hard_stop_basis_points,
                    rate_card_revision, fx_table_revision, sales_price_revision
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)`,
                [contract.contract_id, revision, tenant.tenant_id, tenant.tenant_revision,
                    contract.status, contract.effective_from, contract.effective_until,
                    contract.plan_code, JSON.stringify(contract.allowances), contract.thresholds_basis_points,
                    contract.overage_policy, contract.hard_stop_basis_points, contract.rate_card_revision,
                    contract.fx_table_revision, contract.sales_price_revision]
            );
        } catch (error) {
            if (error?.code === '23505') {
                throw new TenantProvisioningError('CONTRACT_REVISION_CONFLICT', 'Contract revision is already owned by another payload');
            }
            throw error;
        }
    }

    const bindingResult = await client.query(
        `SELECT capabilities, audience, deployment_id, profile
           FROM tenant_contract_revision_runtime_bindings
          WHERE tenant_id = $1 AND contract_id = $2 AND contract_revision = $3
          FOR UPDATE`,
        [tenant.tenant_id, contract.contract_id, revision]
    );
    const binding = bindingResult.rows[0] ?? null;
    if (binding && !bindingRowsEqual(binding, contract)) {
        throw new TenantProvisioningError('CONTRACT_REVISION_CONFLICT', 'Runtime contract binding differs from the manifest');
    }
    if (!binding) {
        await client.query(
            `INSERT INTO tenant_contract_revision_runtime_bindings (
                tenant_id, contract_id, contract_revision, capabilities, audience,
                deployment_id, profile, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [tenant.tenant_id, contract.contract_id, revision, contract.capabilities, contract.audience,
                contract.deployment_id, contract.profile, now]
        );
    }
    return contractReceipt(contract);
}

async function markFailedOperation(client, {
    operationId: operationIdValue,
    tenantKey,
    idempotencyKey,
    desiredStateSha256,
    actorId,
    claimTokenHash,
    error,
    now
}) {
    if (!operationIdValue || !tenantKey || !idempotencyKey || !desiredStateSha256 || !claimTokenHash) return;
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
            `UPDATE tenant_provisioning_operations
                SET status = 'failed', failure_code = $3,
                    receipt_payload = $4::jsonb, claim_token_hash = NULL,
                    claimed_at = NULL, completed_at = $5, updated_at = $5
              WHERE operation_id = $1 AND tenant_key = $2
                AND status = 'claimed' AND claim_token_hash = $6`,
            [operationIdValue, tenantKey, error?.code ?? 'PROVISIONING_FAILED',
                JSON.stringify(failureReceipt), now, claimTokenHash]
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
        `SELECT operation_id, desired_state_sha256, status, receipt_payload,
                claim_token_hash, claimed_at, attempt, failure_code
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
    now,
    staleBefore,
    claimTokenHash,
    existing
}) {
    const result = existing
        ? await client.query(
            `UPDATE tenant_provisioning_operations
                SET status = 'claimed', claim_token_hash = $2, claimed_at = $3,
                    attempt = attempt + 1, failure_code = NULL,
                    receipt_payload = NULL, completed_at = NULL, updated_at = $3
              WHERE operation_id = $1
                AND (status = 'failed'
                  OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at < $4))
              RETURNING operation_id, status, claim_token_hash, attempt`,
            [existing.operation_id, claimTokenHash, now, staleBefore]
        )
        : await client.query(
            `INSERT INTO tenant_provisioning_operations (
                operation_id, tenant_key, idempotency_key, desired_state_sha256,
                status, actor_principal_id, claim_token_hash, claimed_at, attempt,
                created_at, updated_at
             ) VALUES ($1, $2, $3, $4, 'claimed', $5, $6, $7, 1, $7, $7)
             ON CONFLICT (tenant_key, idempotency_key) DO NOTHING
             RETURNING operation_id, status, claim_token_hash, attempt`,
            [id, tenantKey, idempotencyKey, desiredStateSha256, actorId, claimTokenHash, now]
        );
    return result.rows[0] ?? null;
}

async function assertClaimedOperation(client, operationIdValue, claimTokenHash) {
    const result = await client.query(
        `SELECT operation_id, status, claim_token_hash
           FROM tenant_provisioning_operations
          WHERE operation_id = $1 AND status = 'claimed'
            AND claim_token_hash = $2
          FOR UPDATE`,
        [operationIdValue, claimTokenHash]
    );
    if (!result.rows[0]) {
        throw new TenantProvisioningError('PROVISIONING_CLAIM_STALE', 'Provisioning claim is no longer active; retry safely');
    }
}

async function assertSchemaLedger(client, schemaSha256) {
    if (typeof schemaSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(schemaSha256)) {
        throw new TenantProvisioningError('SCHEMA_VERSION_REQUIRED', 'Provisioning requires an explicit migration schema hash');
    }
    const result = await client.query(
        `SELECT schema_sha256
           FROM brainbase_schema_migrations
          WHERE migration_id = $1`,
        ['tenant-production-provisioning.v1']
    );
    if (result.rows[0]?.schema_sha256 !== schemaSha256) {
        throw new TenantProvisioningError('SCHEMA_VERSION_MISMATCH', 'Provisioning schema ledger does not match repository schema hash');
    }
}

async function ensureTenant(client, manifest, now) {
    const existingResult = await client.query(
        `SELECT tenant_id, tenant_key, tenant_revision, status, display_name,
                suspension_reason_code, deletion_after, created_at, updated_at
           FROM brainbase_tenants
          WHERE tenant_id = $1
          FOR UPDATE`,
        [manifest.tenant_id]
    );
    const existing = existingResult.rows[0] ?? null;
    if (!existing) {
        let result;
        try {
            result = await client.query(
                `INSERT INTO brainbase_tenants (
                    tenant_id, tenant_key, tenant_revision, status, display_name,
                    created_at, updated_at
                 ) VALUES ($1, $2, 1, 'provisioning', $3, $4, $4)
                 RETURNING tenant_id, tenant_key, tenant_revision, status, display_name`,
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
             ) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
             ON CONFLICT (tenant_id, tenant_revision) DO NOTHING`,
            [row.tenant_id, row.tenant_revision, row.tenant_key, row.status, row.display_name, now]
        );
        return { tenant_id: row.tenant_id, tenant_key: row.tenant_key, tenant_revision: Number(row.tenant_revision), status: row.status };
    }
    if (existing.tenant_key !== manifest.tenant_key) {
        throw new TenantProvisioningError('TENANT_KEY_CONFLICT', 'tenant_id is already owned by another tenant_key');
    }
    if (['suspended', 'deletion_pending', 'deleted'].includes(existing.status)) {
        throw new TenantProvisioningError('TENANT_STATUS_CONFLICT', `Tenant status ${existing.status} cannot be activated by provisioning`);
    }
    let revision = Number(existing.tenant_revision);
    let displayName = existing.display_name;
    if (existing.display_name !== manifest.display_name) {
        revision += 1;
        displayName = manifest.display_name;
        await client.query(
            `UPDATE brainbase_tenants
                SET tenant_revision = $2, display_name = $3, updated_at = $4
              WHERE tenant_id = $1 AND tenant_revision = $5
                AND status IN ('provisioning', 'active')`,
            [existing.tenant_id, revision, displayName, now, existing.tenant_revision]
        );
    }
    await client.query(
        `INSERT INTO brainbase_tenant_revisions (
            tenant_id, tenant_revision, tenant_key, status, display_name,
            created_at, updated_at, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
         ON CONFLICT (tenant_id, tenant_revision) DO NOTHING`,
        [existing.tenant_id, revision, existing.tenant_key, existing.status, displayName, now]
    );
    return { tenant_id: existing.tenant_id, tenant_key: existing.tenant_key, tenant_revision: revision, status: existing.status };
}

async function activateTenant(client, tenant, now) {
    const result = await client.query(
        `UPDATE brainbase_tenants
            SET status = 'active', updated_at = $2
          WHERE tenant_id = $1 AND tenant_key = $3 AND status = 'provisioning'
          RETURNING tenant_id, status`,
        [tenant.tenant_id, now, tenant.tenant_key]
    );
    if (result.rowCount === 0) {
        const current = await client.query(
            `SELECT status FROM brainbase_tenants WHERE tenant_id = $1 AND tenant_key = $2 FOR SHARE`,
            [tenant.tenant_id, tenant.tenant_key]
        );
        const status = current.rows[0]?.status;
        if (status !== 'active') {
            throw new TenantProvisioningError('TENANT_STATUS_CONFLICT', `Tenant status ${status ?? 'unknown'} cannot be activated`);
        }
        return;
    }
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
    if (!existing) {
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
    }
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
    const capabilities = [...new Set(actor.capabilities)].sort();
    for (const capabilityId of capabilities) {
        await client.query(
            `INSERT INTO brainbase_capabilities (capability_id, status, created_at, updated_at)
             VALUES ($1, 'active', $2, $2)
             ON CONFLICT (capability_id) DO UPDATE SET status = 'active', updated_at = EXCLUDED.updated_at`,
            [capabilityId, now]
        );
        await client.query(
            `INSERT INTO brainbase_service_actor_capabilities (
                actor_id, capability_id, tenant_key, granted_at, status, revoked_at
             ) VALUES ($1, $2, $3, $4, 'active', NULL)
             ON CONFLICT (actor_id, capability_id, tenant_key) DO UPDATE
                SET granted_at = EXCLUDED.granted_at, status = 'active', revoked_at = NULL`,
            [actor.actor_id, capabilityId, tenantKey, now]
        );
    }
    await client.query(
        `UPDATE brainbase_service_actor_capabilities
            SET status = 'revoked', revoked_at = $3
          WHERE actor_id = $1 AND tenant_key = $2
            AND NOT (capability_id = ANY($4::text[]))
            AND status <> 'revoked'`,
        [actor.actor_id, tenantKey, now, capabilities]
    );
    const publicKeys = [...(actor.public_keys ?? [])].sort((left, right) => left.kid.localeCompare(right.kid));
    for (const publicJwk of publicKeys) {
        await client.query(
            `INSERT INTO brainbase_service_actor_keys (actor_id, kid, public_jwk, status, created_at)
             VALUES ($1, $2, $3::jsonb, 'active', $4)
             ON CONFLICT (actor_id, kid) DO UPDATE
                SET public_jwk = EXCLUDED.public_jwk, status = 'active', revoked_at = NULL`,
            [actor.actor_id, publicJwk.kid, JSON.stringify(publicJwk), now]
        );
    }
    await client.query(
        `UPDATE brainbase_service_actor_keys
            SET status = 'revoked', revoked_at = $2
          WHERE actor_id = $1
            AND NOT (kid = ANY($3::text[]))
            AND status <> 'revoked'`,
        [actor.actor_id, now, publicKeys.map(({ kid }) => kid)]
    );
    const grantedResult = await client.query(
        `SELECT capability_id
           FROM brainbase_service_actor_capabilities
          WHERE actor_id = $1 AND tenant_key = $2 AND status = 'active'
          ORDER BY capability_id`,
        [actor.actor_id, tenantKey]
    );
    const keyResult = await client.query(
        `SELECT kid, public_jwk
           FROM brainbase_service_actor_keys
          WHERE actor_id = $1 AND status = 'active'
          ORDER BY kid`,
        [actor.actor_id]
    );
    const readbackCapabilities = grantedResult.rows.map(({ capability_id: capabilityId }) => capabilityId).sort();
    const readbackKeys = keyResult.rows.map(({ kid, public_jwk: publicJwk }) => ({ kid, public_jwk: publicJwk }));
    const readbackPublicKeys = readbackKeys.map(({ public_jwk: publicJwk }) => publicJwk);
    if (canonicalJson(readbackCapabilities) !== canonicalJson(capabilities)
        || canonicalJson(readbackPublicKeys) !== canonicalJson(publicKeys)) {
        throw new TenantProvisioningError('SERVICE_REGISTRY_READBACK_FAILED', 'Service actor capabilities or keys differ from the manifest');
    }
    return { capabilities: readbackCapabilities, public_keys: readbackKeys };
}

async function updateOperation(client, operationIdValue, claimTokenHash, receipt, now) {
    const result = await client.query(
        `UPDATE tenant_provisioning_operations
            SET status = 'applied', receipt_payload = $3::jsonb,
                completed_at = $4, updated_at = $4,
                claim_token_hash = NULL, claimed_at = NULL, failure_code = NULL
          WHERE operation_id = $1 AND status = 'claimed' AND claim_token_hash = $2`,
        [operationIdValue, claimTokenHash, JSON.stringify(receipt), now]
    );
    if (result.rowCount !== 1) {
        throw new TenantProvisioningError('PROVISIONING_CLAIM_STALE', 'Provisioning claim is no longer active; retry safely');
    }
}

async function readback(client, tenant, project, connection, actor, contract, registry) {
    const result = await client.query(
        `SELECT t.tenant_id, t.tenant_key, t.tenant_revision,
                tp.project_id, tp.project_code,
                wc.connection_id, wc.connection_revision,
                sa.actor_id,
                cr.contract_id, cr.contract_revision,
                cr.status AS contract_status,
                cr.effective_from, cr.effective_until, cr.plan_code, cr.allowances,
                cr.thresholds_basis_points, cr.overage_policy, cr.hard_stop_basis_points,
                cr.rate_card_revision, cr.fx_table_revision, cr.sales_price_revision,
                rb.capabilities AS runtime_capabilities,
                rb.audience AS runtime_audience,
                rb.deployment_id AS runtime_deployment_id,
                rb.profile AS runtime_profile
           FROM brainbase_tenants t
           JOIN tenant_projects tp ON tp.tenant_id = t.tenant_id AND tp.project_id = $3
           JOIN workspace_connections wc ON wc.tenant_id = t.tenant_id
           JOIN brainbase_service_actors sa ON sa.tenant_key = t.tenant_key
           JOIN tenant_contract_revisions cr
             ON cr.tenant_id = t.tenant_id
            AND cr.contract_id = $6
            AND cr.contract_revision = $7
           JOIN tenant_contract_revision_runtime_bindings rb
             ON rb.tenant_id = cr.tenant_id
            AND rb.contract_id = cr.contract_id
            AND rb.contract_revision = cr.contract_revision
          WHERE t.tenant_id = $1 AND t.tenant_key = $2
            AND wc.connection_id = $4 AND sa.actor_id = $5`,
        [tenant.tenant_id, tenant.tenant_key, project.project_id, connection.connection_id, actor.actor_id,
            contract.contract_id, Number(contract.revision)]
    );
    const row = result.rows[0];
    if (!row) throw new TenantProvisioningError('READBACK_FAILED', 'Provisioning state was not found during readback');
    if (row.tenant_key !== tenant.tenant_key
        || row.tenant_revision !== tenant.tenant_revision
        || row.project_id !== project.project_id
        || row.project_code !== project.project_code
        || row.connection_id !== connection.connection_id
        || Number(row.connection_revision) !== Number(connection.connection_revision)
        || row.actor_id !== actor.actor_id
        || row.contract_id !== contract.contract_id
        || Number(row.contract_revision) !== Number(contract.revision)
        || row.runtime_deployment_id !== contract.deployment_id
        || row.runtime_profile !== contract.profile) {
        throw new TenantProvisioningError('READBACK_BOUNDARY_FAILED', 'Provisioning readback crossed a tenant boundary');
    }
    const readbackContract = {
        contract_id: row.contract_id,
        revision: String(row.contract_revision),
        status: row.contract_status,
        effective_from: timestampForComparison(row.effective_from),
        effective_until: timestampForComparison(row.effective_until),
        plan_code: row.plan_code,
        allowances: row.allowances,
        thresholds_basis_points: (row.thresholds_basis_points ?? []).map(Number),
        overage_policy: row.overage_policy,
        hard_stop_basis_points: Number(row.hard_stop_basis_points),
        rate_card_revision: Number(row.rate_card_revision),
        fx_table_revision: Number(row.fx_table_revision),
        sales_price_revision: Number(row.sales_price_revision),
        capabilities: [...(row.runtime_capabilities ?? [])],
        audience: [...(row.runtime_audience ?? [])],
        deployment_id: row.runtime_deployment_id,
        profile: row.runtime_profile
    };
    if (canonicalJson(contractReceipt(readbackContract)) !== canonicalJson(contractReceipt(contract))) {
        throw new TenantProvisioningError('READBACK_BOUNDARY_FAILED', 'Contract revision readback did not match the manifest');
    }
    if (!registry || canonicalJson([...registry.capabilities].sort()) !== canonicalJson([...actor.capabilities].sort())) {
        throw new TenantProvisioningError('SERVICE_REGISTRY_READBACK_FAILED', 'Service actor capability readback did not match the manifest');
    }
    return {
        tenant: true,
        tenant_project: true,
        workspace_connection: true,
        service_actor: true,
        service_actor_capabilities: registry.capabilities,
        service_actor_public_keys: registry.public_keys.map(({ kid }) => kid),
        contract_revision: contractReceipt(readbackContract)
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
    commit = true,
    schemaSha256 = null
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
    let claimed = null;
    let claimTokenHash = null;
    let claimPersisted = false;
    try {
        // The migration ledger is the write gate.  A caller may not apply or
        // simulate a provisioning manifest against an unknown schema version.
        await assertSchemaLedger(client, schemaSha256);
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
                throw new TenantProvisioningError('PROVISIONING_TERMINAL', 'A terminal provisioning operation cannot be changed');
            }
            if (existing.status === 'claimed') {
                const claimedAt = Date.parse(existing.claimed_at ?? '');
                if (!Number.isFinite(claimedAt) || Date.parse(now) - claimedAt < CLAIM_STALE_MS) {
                    throw new TenantProvisioningError('PROVISIONING_IN_PROGRESS', 'A provisioning operation is already in progress');
                }
            }
        }

        const rawClaimToken = claimToken();
        claimTokenHash = sha256(rawClaimToken);
        const staleBefore = new Date(Date.parse(now) - CLAIM_STALE_MS).toISOString();
        claimed = await claimOperation(client, {
            operationId: operationIdFactory(),
            tenantKey: normalizedManifest.tenant_key,
            idempotencyKey,
            desiredStateSha256,
            actorId,
            now,
            staleBefore,
            claimTokenHash,
            existing
        });
        if (!claimed) throw new TenantProvisioningError('IDEMPOTENCY_CONFLICT', 'Provisioning operation could not claim its idempotency key');
        if (commit) {
            await client.query('COMMIT');
            transactionStarted = false;
            claimPersisted = true;
        } else {
            await client.query('ROLLBACK');
            transactionStarted = false;
        }

        // Canonical Graph and credential systems are external boundaries. They
        // are resolved only after the short claim transaction releases its
        // advisory lock, and both adapters are responsible for bounded timeouts.
        const project = normalizeProjectResult(await graphResolver.resolveCanonicalProject({
            tenant_key: normalizedManifest.tenant_key,
            project_code: normalizedManifest.project_code
        }));
        if (project.project_id !== normalizedManifest.service_actor.canonical_project_id) {
            throw new TenantProvisioningError('PROJECT_ACTOR_MISMATCH', 'Resolved project does not match the service actor registry');
        }
        // The production credential resolver reads committed broker rows, but
        // a first installation creates that row later in this transaction.
        // Allow an explicitly planned opaque reference only when no current
        // connection exists for this tenant/provider/workspace/app.  Existing
        // connections (including reinstalls) must pass exact canonical
        // credential metadata verification in the resolver.
        const existingConnection = await client.query(
            `SELECT connection_id, connection_revision
               FROM workspace_connections
              WHERE tenant_id = $1
                AND provider = $2
                AND workspace_id = $3
                AND app_id = $4
                AND status IN ('pending', 'active', 'reauth_required')
              LIMIT 2`,
            [normalizedManifest.tenant_id, normalizedManifest.workspace_connection.provider,
                normalizedManifest.workspace_connection.workspace_id, normalizedManifest.workspace_connection.app_id]
        );
        assertCredentialResult(await credentialResolver.verifyOpaqueReference({
            tenant_id: normalizedManifest.tenant_id,
            tenant_key: normalizedManifest.tenant_key,
            credential_ref: normalizedManifest.workspace_connection.credential_ref,
            provider: normalizedManifest.workspace_connection.provider,
            workspace_id: normalizedManifest.workspace_connection.workspace_id,
            app_id: normalizedManifest.workspace_connection.app_id,
            allow_unregistered: (existingConnection.rows ?? []).length === 0
        }), normalizedManifest.tenant_key);

        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [normalizedManifest.tenant_key]);
        if (commit) await assertClaimedOperation(client, claimed.operation_id, claimTokenHash);
        const tenant = await ensureTenant(client, normalizedManifest, now);
        const contract = await ensureContractRevision(client, tenant, normalizedManifest.contract_revision, now);
        const tenantProject = await ensureTenantProject(client, tenant, project, normalizedManifest, now);
        const connection = await ensureWorkspaceConnection(client, normalizedManifest, tenant, now);
        const registry = await ensureServiceRegistry(client, normalizedManifest.service_actor, normalizedManifest.tenant_key, now);
        await activateTenant(client, tenant, now);
        const readbackResult = await readback(
            client, tenant, tenantProject, connection, normalizedManifest.service_actor,
            normalizedManifest.contract_revision, registry
        );
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
            contract_revision: contract,
            desired_state_sha256: desiredStateSha256,
            outcome: 'succeeded',
            readback: readbackResult
        });
        if (commit) await updateOperation(client, claimed.operation_id, claimTokenHash, receipt, now);
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
        if (commit && claimPersisted && claimed) {
            await markFailedOperation(client, {
                operationId: claimed.operation_id,
                tenantKey: normalizedManifest.tenant_key,
                idempotencyKey,
                desiredStateSha256,
                actorId,
                claimTokenHash,
                error: safeError,
                now
            });
        }
        throw safeError;
    }
}
