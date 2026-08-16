import { ContractError } from './errors.js';

function unavailable(error) {
    if (error instanceof ContractError) return error;
    return new ContractError('UPSTREAM_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud',
        message: 'Multitenant PostgreSQL repository is unavailable'
    });
}

export class MultitenantPostgresRepository {
    constructor({ pool, now = () => new Date() } = {}) {
        if (!pool) throw new Error('Multitenant PostgreSQL pool is required');
        this.pool = pool;
        this.now = now;
    }

    async withTenant(tenantId, operation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the first failure. The connection is released below.
            }
            throw unavailable(error);
        } finally {
            client.release();
        }
    }

    async validateConnectionRevision({
        tenant_id, connection_id, expected_connection_revision, workspace_id, app_id, required_scopes = []
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `SELECT tenant_id, connection_id, connection_revision, status, workspace_id, app_id, granted_scopes
                 FROM workspace_connections
                 WHERE tenant_id = $1 AND connection_id = $2
                 FOR SHARE`,
                [tenant_id, connection_id]
            );
            const connection = result.rows[0];
            if (!connection) {
                throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });
            }
            if (Number(connection.connection_revision) !== Number(expected_connection_revision)) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }
            if (connection.status !== 'active') throw new ContractError('WORKSPACE_CONNECTION_REVOKED', { status: 403 });
            if ((workspace_id && connection.workspace_id !== workspace_id) || (app_id && connection.app_id !== app_id)) {
                throw new ContractError('WORKSPACE_OR_APP_MISMATCH', { status: 403 });
            }
            if (required_scopes.some((scope) => !connection.granted_scopes.includes(scope))) {
                throw new ContractError('CAPABILITY_SCOPE_MISMATCH', { status: 403 });
            }
            return {
                authoritative: true,
                valid: true,
                tenant_id: connection.tenant_id,
                connection_id: connection.connection_id,
                connection_revision: Number(connection.connection_revision),
                status: connection.status
            };
        });
    }

    async compareAndSwapRefresh({ tenant_id, credential_ref, expected_refresh_revision, new_credential_ref }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `UPDATE credential_broker_refs
                 SET credential_ref = $4,
                     refresh_revision = refresh_revision + 1,
                     updated_at = $5
                 WHERE tenant_id = $1
                   AND credential_ref = $2
                   AND refresh_revision = $3
                 RETURNING credential_ref, refresh_revision`,
                [tenant_id, credential_ref, expected_refresh_revision, new_credential_ref, this.now().toISOString()]
            );
            if (!result.rows[0]) throw new ContractError('OAUTH_REFRESH_CONFLICT', { status: 409 });
            return {
                credential_ref: result.rows[0].credential_ref,
                refresh_revision: Number(result.rows[0].refresh_revision)
            };
        });
    }

    async claimBusinessEffect({
        tenant_id, connection_id, operation_id, idempotency_key, payload_hash, context_hash
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const claimedAt = this.now();
            const retainUntil = new Date(claimedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
            const inserted = await client.query(
                `INSERT INTO tenant_business_effect_claims (
                    idempotency_key, tenant_id, connection_id, operation_id,
                    payload_hash, context_hash, claim_state, claimed_at, retain_until
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'claimed', $7, $8)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING idempotency_key, payload_hash, context_hash, claim_state`,
                [idempotency_key, tenant_id, connection_id, operation_id, payload_hash, context_hash, claimedAt.toISOString(), retainUntil.toISOString()]
            );
            if (inserted.rows[0]) return { ...inserted.rows[0], replayed: false };
            const existingResult = await client.query(
                `SELECT idempotency_key, payload_hash, context_hash, claim_state
                 FROM tenant_business_effect_claims
                 WHERE tenant_id = $1 AND idempotency_key = $2
                 FOR UPDATE`,
                [tenant_id, idempotency_key]
            );
            const existing = existingResult.rows[0];
            if (!existing || existing.payload_hash !== payload_hash || existing.context_hash !== context_hash) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return { ...existing, replayed: true };
        });
    }

    async recordUsage(event) {
        return this.withTenant(event.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO tenant_usage_events (
                    usage_event_id, protocol_version, tenant_id, tenant_revision_at_write,
                    connection_id, connection_revision, contract_revision, deployment_id,
                    correlation_id, operation_id, idempotency_key, kind, quantity, unit,
                    outcome, collection_state, failure_code, observed_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                 ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                 RETURNING *`,
                [
                    event.usage_event_id, event.protocol_version, event.tenant_id, event.tenant_revision_at_write,
                    event.connection_id, event.connection_revision, event.contract_revision, event.deployment_id,
                    event.correlation_id, event.operation_id, event.idempotency_key, event.kind, event.quantity,
                    event.unit, event.outcome, event.collection_state, event.failure_code, event.observed_at
                ]
            );
            if (!result.rows[0]) throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            return result.rows[0];
        });
    }

    async finalizeReceipt(receipt) {
        return this.withTenant(receipt.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO tenant_operation_receipts (
                    receipt_id, protocol_version, tenant_id, tenant_revision_at_write,
                    connection_id, connection_revision, contract_revision, deployment_id,
                    correlation_id, operation_ids, idempotency_keys, actor_principal_id,
                    project_id, capability_id, quota_decision, credential_mode, outcome,
                    collection_state, observed_units, unknown_fields, failure_code,
                    pricing_snapshot, finalized_at, corrects_receipt_id
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
                 RETURNING *`,
                [
                    receipt.receipt_id, receipt.protocol_version, receipt.tenant_id, receipt.tenant_revision_at_write,
                    receipt.connection_id, receipt.connection_revision, receipt.contract_revision, receipt.deployment_id,
                    receipt.correlation_id, receipt.operation_ids, receipt.idempotency_keys, receipt.actor_principal_id,
                    receipt.project_id, receipt.capability_id, receipt.quota_decision, receipt.credential_mode,
                    receipt.outcome, receipt.usage.collection_state, receipt.usage.observed_units,
                    receipt.usage.unknown_fields, receipt.failure_code, receipt.pricing_snapshot,
                    receipt.finalized_at, receipt.corrects_receipt_id ?? null
                ]
            );
            return result.rows[0];
        });
    }
}
