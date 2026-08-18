import { ContractError } from './errors.js';
import { canonicalJson } from './canonical-json.js';

const OWNED_RESOURCE_TABLES = Object.freeze({
    tenant: { table: 'brainbase_tenants', id: 'tenant_id', revision: 'tenant_revision' },
    organization: { table: 'tenant_organizations', id: 'organization_id' },
    membership: { table: 'tenant_memberships', id: 'membership_id' },
    project: { table: 'tenant_projects', id: 'project_id' },
    graph_entity: { table: 'tenant_graph_entities', id: 'entity_id' },
    graph_relation: { table: 'tenant_graph_relations', id: 'relation_id' },
    workspace_connection: { table: 'workspace_connections', id: 'connection_id' },
    contract: { table: 'tenant_contract_revisions', id: 'contract_id' },
    usage_event: { table: 'tenant_usage_events', id: 'usage_event_id' },
    operation_receipt: { table: 'tenant_operation_receipts', id: 'receipt_id' }
});

function unavailable(error) {
    if (error instanceof ContractError) return error;
    return new ContractError('UPSTREAM_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud',
        message: 'Multitenant PostgreSQL repository is unavailable'
    });
}

async function readConnectionRevision(client, {
    tenant_id, connection_id, expected_connection_revision, workspace_id, app_id, required_scopes = []
}) {
    const result = await client.query(
        `SELECT wc.tenant_id, wc.connection_id, wc.connection_revision, wc.status,
                wc.provider, wc.installation_id, wc.workspace_id, wc.app_id,
                wc.granted_scopes, cbr.credential_ref AS credential_ref,
                cbr.credential_mode, cbr.refresh_revision
         FROM workspace_connections wc
         JOIN credential_broker_refs cbr
           ON cbr.tenant_id = wc.tenant_id
          AND cbr.connection_id = wc.connection_id
          AND cbr.connection_revision = wc.connection_revision
         WHERE wc.tenant_id = $1 AND wc.connection_id = $2
         FOR SHARE OF wc, cbr`,
        [tenant_id, connection_id]
    );
    const connection = result.rows[0];
    if (!connection) {
        throw new ContractError('WORKSPACE_CONNECTION_UNAVAILABLE', {
            status: 503,
            retryable: true,
            fault_domain: 'brainbase_cloud'
        });
    }
    if (String(connection.connection_revision) !== expected_connection_revision) {
        throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
    }
    if (connection.status !== 'active') throw new ContractError('WORKSPACE_CONNECTION_REVOKED', { status: 403 });
    if ((workspace_id && connection.workspace_id !== workspace_id) || (app_id && connection.app_id !== app_id)) {
        throw new ContractError('WORKSPACE_OR_APP_MISMATCH', { status: 403 });
    }
    if (required_scopes.some((scope) => !(connection.granted_scopes ?? []).includes(scope))) {
        throw new ContractError('CAPABILITY_SCOPE_MISMATCH', { status: 403 });
    }
    return {
        authoritative: true,
        valid: true,
        tenant_id: connection.tenant_id,
        connection_id: connection.connection_id,
        connection_revision: String(connection.connection_revision),
        status: connection.status,
        provider: connection.provider,
        installation_id: connection.installation_id,
        workspace_id: connection.workspace_id,
        app_id: connection.app_id,
        granted_scopes: connection.granted_scopes,
        credential_ref: connection.credential_ref,
        credential_mode: connection.credential_mode,
        refresh_revision: connection.refresh_revision == null ? undefined : String(connection.refresh_revision)
    };
}

async function insertReceipt(client, receipt) {
    const result = await client.query(
        `INSERT INTO tenant_operation_receipts (
            receipt_id, protocol_version, tenant_id, tenant_revision_at_write,
            connection_id, connection_revision, contract_revision, deployment_id,
            correlation_id, operation_ids, idempotency_keys, actor_principal_id,
            project_id, capability_id, quota_decision, credential_mode, outcome,
            collection_state, failure_code, usage_event_ids, reply, completed_at,
            receipt_payload
         ) SELECT $1,$2,$3,t.tenant_revision,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb
           FROM brainbase_tenants t
          WHERE t.tenant_id = $3
         ON CONFLICT (receipt_id) DO UPDATE
         SET receipt_payload = tenant_operation_receipts.receipt_payload
         RETURNING receipt_payload`,
        [
            receipt.receipt_id, receipt.protocol_version, receipt.tenant_id, receipt.connection_id,
            receipt.connection_revision, receipt.contract_revision, receipt.deployment_id,
            receipt.correlation_id, receipt.operation_ids, receipt.idempotency_keys,
            receipt.actor_principal_id, receipt.project_id, receipt.capability_id,
            receipt.quota_decision, receipt.credential_mode, receipt.outcome,
            receipt.collection_state, receipt.failure_code, receipt.usage_event_ids,
            canonicalJson(receipt.reply), receipt.completed_at, canonicalJson(receipt)
        ]
    );
    const stored = result.rows[0]?.receipt_payload;
    if (!stored || canonicalJson(stored) !== canonicalJson(receipt)) {
        throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
    }
    return stored;
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
        return this.withTenant(tenant_id, (client) => readConnectionRevision(client, {
            tenant_id,
            connection_id,
            expected_connection_revision,
            workspace_id,
            app_id,
            required_scopes
        }));
    }

    async resolveOwnedResource({ tenant_id: tenantId, object_type: objectType, resource_id: resourceId }) {
        const descriptor = OWNED_RESOURCE_TABLES[objectType];
        if (!descriptor || typeof resourceId !== 'string' || resourceId.length === 0) {
            throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
        }
        return this.withTenant(tenantId, async (client) => {
            const revisionColumn = descriptor.revision ?? 'tenant_revision_at_write';
            const result = await client.query(
                `SELECT tenant_id, ${revisionColumn} AS tenant_revision_at_write
                 FROM ${descriptor.table}
                 WHERE tenant_id = $1 AND ${descriptor.id} = $2
                 ORDER BY ${revisionColumn} DESC
                 LIMIT 1
                 FOR SHARE`,
                [tenantId, resourceId]
            );
            const row = result.rows[0];
            return row ? {
                object_type: objectType,
                resource_id: resourceId,
                tenant_id: row.tenant_id,
                tenant_revision_at_write: String(row.tenant_revision_at_write)
            } : null;
        });
    }

    async resolveRuntimeContext({
        tenant_id, expected_tenant_revision, connection_id, expected_connection_revision,
        workspace_id, app_id, authorization = {}
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const workspaceConnection = await readConnectionRevision(client, {
                tenant_id,
                connection_id,
                expected_connection_revision,
                workspace_id,
                app_id,
                required_scopes: authorization.capability_ids ?? []
            });
            const tenantResult = await client.query(
                `SELECT tenant_id, tenant_revision, status
                 FROM brainbase_tenants
                 WHERE tenant_id = $1 AND status = 'active'
                 FOR SHARE`,
                [tenant_id]
            );
            const tenant = tenantResult.rows[0];
            if (!tenant) throw new ContractError('TENANT_UNKNOWN', { status: 403 });
            if (String(tenant.tenant_revision) !== expected_tenant_revision) {
                throw new ContractError('TENANT_REVISION_MISMATCH', { status: 409 });
            }
            const contractResult = await client.query(
                `SELECT contract_revision
                 FROM tenant_contract_revisions
                 WHERE tenant_id = $1 AND status = 'active'
                   AND effective_from <= $2
                   AND (effective_until IS NULL OR effective_until > $2)
                 ORDER BY contract_revision DESC
                 LIMIT 1
                 FOR SHARE`,
                [tenant_id, this.now().toISOString()]
            );
            if (!contractResult.rows[0]) {
                throw new ContractError('UPSTREAM_UNAVAILABLE', {
                    status: 503,
                    retryable: true,
                    fault_domain: 'brainbase_cloud'
                });
            }
            return {
                tenant: {
                    tenant_id: tenant.tenant_id,
                    tenant_revision: String(tenant.tenant_revision),
                    status: tenant.status
                },
                workspace_connection: workspaceConnection,
                contract_revision: String(contractResult.rows[0].contract_revision)
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
                refresh_revision: String(result.rows[0].refresh_revision)
            };
        });
    }

    async issueCredentialLease(lease) {
        return this.withTenant(lease.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO tenant_credential_leases (
                    lease_id, tenant_id, connection_id, connection_revision,
                    credential_ref, credential_mode, contract_revision, operation_id,
                    audience, provider, lease_token_digest, issued_at, expires_at,
                    max_uses
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 RETURNING lease_id, tenant_id, connection_id, connection_revision,
                           credential_ref, credential_mode, contract_revision, operation_id,
                           audience, provider, issued_at, expires_at, max_uses`,
                [
                    lease.lease_id, lease.tenant_id, lease.connection_id,
                    lease.connection_revision, lease.credential_ref, lease.credential_mode,
                    lease.contract_revision, lease.operation_id, lease.audience, lease.provider,
                    lease.lease_token_digest, lease.issued_at, lease.expires_at, lease.max_uses
                ]
            );
            if (!result.rows[0]) {
                throw new ContractError('CREDENTIAL_LEASE_INVALID', { status: 400 });
            }
            return { ...result.rows[0], connection_revision: String(result.rows[0].connection_revision) };
        });
    }

    async consumeCredentialLease(input) {
        return this.withTenant(input.tenant_id, async (client) => {
            const result = await client.query(
                `SELECT lease.lease_id, lease.tenant_id, lease.connection_id,
                        lease.connection_revision, lease.credential_ref,
                        lease.credential_mode, lease.contract_revision,
                        lease.operation_id, lease.audience, lease.provider,
                        lease.lease_token_digest, lease.issued_at, lease.expires_at,
                        lease.max_uses, lease.consumed_at,
                        connection.connection_revision AS current_connection_revision,
                        connection.status AS current_connection_status,
                        connection.provider AS current_provider,
                        credential.credential_ref AS current_credential_ref,
                        credential.credential_mode AS current_credential_mode
                   FROM tenant_credential_leases AS lease
                   JOIN workspace_connections AS connection
                     ON connection.tenant_id = lease.tenant_id
                    AND connection.connection_id = lease.connection_id
                   JOIN credential_broker_refs AS credential
                     ON credential.tenant_id = connection.tenant_id
                    AND credential.connection_id = connection.connection_id
                    AND credential.connection_revision = connection.connection_revision
                  WHERE lease.tenant_id = $1 AND lease.lease_id = $2
                  FOR UPDATE OF lease`,
                [input.tenant_id, input.lease_id]
            );
            const lease = result.rows[0];
            if (!lease || lease.lease_token_digest !== input.lease_token_digest) {
                throw new ContractError('CREDENTIAL_LEASE_UNKNOWN', { status: 403 });
            }
            if (lease.consumed_at) {
                throw new ContractError('CREDENTIAL_LEASE_ALREADY_USED', { status: 409 });
            }
            const consumedAt = new Date(input.consumed_at);
            if (!Number.isFinite(consumedAt.getTime()) || consumedAt >= new Date(lease.expires_at)) {
                throw new ContractError('CREDENTIAL_LEASE_EXPIRED', { status: 409 });
            }
            const expected = [
                'tenant_id', 'connection_id', 'credential_ref', 'credential_mode',
                'contract_revision', 'operation_id', 'audience'
            ];
            if (Number(lease.max_uses) !== 1
                || expected.some((field) => String(lease[field]) !== String(input[field]))
                || String(lease.connection_revision) !== String(input.connection_revision)) {
                throw new ContractError('CREDENTIAL_LEASE_SCOPE_MISMATCH', { status: 403 });
            }
            if (lease.current_connection_status !== undefined
                && (lease.current_connection_status !== 'active'
                    || String(lease.current_connection_revision) !== String(lease.connection_revision)
                    || lease.current_provider !== lease.provider
                    || lease.current_credential_ref !== lease.credential_ref
                    || lease.current_credential_mode !== lease.credential_mode)) {
                throw new ContractError('CREDENTIAL_BINDING_STALE', { status: 409 });
            }
            const consumed = await client.query(
                `UPDATE tenant_credential_leases
                    SET consumed_at = $3
                  WHERE tenant_id = $1 AND lease_id = $2 AND consumed_at IS NULL
                  RETURNING lease_id`,
                [input.tenant_id, input.lease_id, input.consumed_at]
            );
            if (!consumed.rows[0]) {
                throw new ContractError('CREDENTIAL_LEASE_ALREADY_USED', { status: 409 });
            }
            return {
                lease_id: lease.lease_id,
                tenant_id: lease.tenant_id,
                connection_id: lease.connection_id,
                connection_revision: String(lease.connection_revision),
                credential_ref: lease.credential_ref,
                credential_mode: lease.credential_mode,
                contract_revision: lease.contract_revision,
                operation_id: lease.operation_id,
                audience: lease.audience,
                provider: lease.provider
            };
        });
    }

    async loadContractRevision({ tenant_id, contract_revision }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `SELECT tenant_id, contract_id, contract_revision, allowances,
                        thresholds_basis_points, overage_policy, hard_stop_basis_points,
                        rate_card_revision, fx_table_revision, sales_price_revision
                 FROM tenant_contract_revisions
                 WHERE tenant_id = $1
                   AND contract_revision = $2
                   AND status = 'active'
                   AND effective_from <= $3
                   AND (effective_until IS NULL OR effective_until > $3)
                 FOR SHARE`,
                [tenant_id, contract_revision, this.now().toISOString()]
            );
            const contract = result.rows[0];
            if (!contract) {
                throw new ContractError('UPSTREAM_UNAVAILABLE', {
                    status: 503,
                    retryable: true,
                    fault_domain: 'brainbase_cloud'
                });
            }
            return {
                ...contract,
                contract_revision: String(contract.contract_revision),
                rate_card_revision: Number(contract.rate_card_revision),
                fx_table_revision: Number(contract.fx_table_revision),
                sales_price_revision: Number(contract.sales_price_revision),
                hard_stop_basis_points: Number(contract.hard_stop_basis_points)
            };
        });
    }

    async recordQuotaDecision(decision, { idempotency_key, metric }) {
        return this.withTenant(decision.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO tenant_quota_decisions (
                    tenant_id, contract_revision, quota_revision, idempotency_key, metric,
                    decision, limit_value, used_value, remaining_value, unit,
                    window_started_at, window_ends_at, decided_at, failure_code, decision_payload
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
                 ON CONFLICT (tenant_id, idempotency_key) DO UPDATE
                 SET decision_payload = tenant_quota_decisions.decision_payload
                 RETURNING decision_payload`,
                [
                    decision.tenant_id, decision.contract_revision, decision.quota_revision,
                    idempotency_key, metric, decision.decision, decision.limit, decision.used,
                    decision.remaining, decision.unit, decision.window_started_at,
                    decision.window_ends_at, decision.decided_at, decision.failure_code,
                    canonicalJson(decision)
                ]
            );
            const stored = result.rows[0]?.decision_payload;
            if (!stored || canonicalJson(stored) !== canonicalJson(decision)) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return stored;
        });
    }

    async claimBusinessEffect({ claim, connection_revision }) {
        return this.withTenant(claim.tenant_id, async (client) => {
            const claimedAt = this.now().toISOString();
            const inserted = await client.query(
                `INSERT INTO tenant_business_effect_claims (
                    idempotency_key, tenant_id, connection_id, connection_revision, operation_id,
                    message_type, owner, scope, slack_event_id, payload_hash, context_hash,
                    claim_state, claimed_at, retain_until, claim_payload
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
                 ON CONFLICT (idempotency_key) DO NOTHING
                 RETURNING idempotency_key, payload_hash, context_hash, claim_state, claim_payload`,
                [
                    claim.idempotency_key, claim.tenant_id, claim.connection_id, connection_revision,
                    claim.operation_id, claim.message_type, claim.owner, claim.scope,
                    claim.slack_event_id, claim.payload_hash, claim.context_hash, claim.state,
                    claimedAt, claim.retention_until, canonicalJson(claim)
                ]
            );
            if (inserted.rows[0]) return { ...claim, replayed: false };
            const existingResult = await client.query(
                `SELECT idempotency_key, payload_hash, context_hash, claim_state, claim_payload
                 FROM tenant_business_effect_claims
                 WHERE tenant_id = $1 AND idempotency_key = $2
                 FOR UPDATE`,
                [claim.tenant_id, claim.idempotency_key]
            );
            const existing = existingResult.rows[0];
            if (!existing || existing.payload_hash !== claim.payload_hash || existing.context_hash !== claim.context_hash
                || (existing.claim_payload && canonicalJson(existing.claim_payload) !== canonicalJson(claim))) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return { ...(existing.claim_payload ?? claim), replayed: true };
        });
    }

    async recordUsage(event) {
        return this.withTenant(event.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO tenant_usage_events (
                    usage_event_id, protocol_version, tenant_id, tenant_revision_at_write,
                    connection_id, connection_revision, contract_revision, deployment_id,
                    correlation_id, operation_id, idempotency_key, kind, quantity, unit,
                    outcome, collection_state, failure_code, unknown_fields, observed_at, event_payload
                 ) SELECT $1,$2,$3,t.tenant_revision,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
                   FROM brainbase_tenants t
                  WHERE t.tenant_id = $3
                 ON CONFLICT (usage_event_id) DO UPDATE
                 SET event_payload = tenant_usage_events.event_payload
                 RETURNING event_payload`,
                [
                    event.usage_event_id, event.protocol_version, event.tenant_id, event.connection_id,
                    event.connection_revision, event.contract_revision, event.deployment_id, event.correlation_id,
                    event.operation_id, event.idempotency_key, event.kind, event.quantity, event.unit,
                    event.outcome, event.collection_state, event.failure_code, event.unknown_fields,
                    event.observed_at, canonicalJson(event)
                ]
            );
            const stored = result.rows[0]?.event_payload;
            if (!stored || canonicalJson(stored) !== canonicalJson(event)) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return stored;
        });
    }

    async finalizeReceipt(receipt) {
        return this.withTenant(receipt.tenant_id, (client) => insertReceipt(client, receipt));
    }

    async finalizeReceiptWithPricing({ receipt, pricing_snapshot: pricingSnapshot }) {
        return this.withTenant(receipt.tenant_id, async (client) => {
            const storedReceipt = await insertReceipt(client, receipt);
            const result = await client.query(
                `INSERT INTO tenant_receipt_pricing_snapshots (
                    receipt_id, tenant_id, rate_card_revision, fx_table_revision,
                    sales_price_revision, purchase_currency, purchase_minor_units,
                    billing_currency, billing_minor_units, fx_rate_decimal, effective_at,
                    pricing_payload
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
                 ON CONFLICT (receipt_id) DO UPDATE
                 SET pricing_payload = tenant_receipt_pricing_snapshots.pricing_payload
                 RETURNING pricing_payload`,
                [
                    receipt.receipt_id, receipt.tenant_id, pricingSnapshot.rate_card_revision,
                    pricingSnapshot.fx_table_revision, pricingSnapshot.sales_price_revision,
                    pricingSnapshot.purchase_currency, pricingSnapshot.purchase_minor_units,
                    pricingSnapshot.billing_currency, pricingSnapshot.billing_minor_units,
                    pricingSnapshot.fx_rate_decimal, pricingSnapshot.effective_at,
                    canonicalJson(pricingSnapshot)
                ]
            );
            const storedPricing = result.rows[0]?.pricing_payload;
            if (!storedPricing || canonicalJson(storedPricing) !== canonicalJson(pricingSnapshot)) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return { receipt: storedReceipt, pricing_snapshot: storedPricing };
        });
    }

    async readReceiptHistory({ tenant_id: tenantId, receipt_id: receiptId }) {
        return this.withTenant(tenantId, async (client) => {
            const result = await client.query(
                `SELECT r.receipt_payload, p.pricing_payload
                   FROM tenant_operation_receipts r
                   JOIN tenant_receipt_pricing_snapshots p
                     ON p.tenant_id = r.tenant_id AND p.receipt_id = r.receipt_id
                  WHERE r.tenant_id = $1 AND r.receipt_id = $2
                  ORDER BY p.effective_at ASC`,
                [tenantId, receiptId]
            );
            return result.rows.map((row) => ({
                receipt: row.receipt_payload,
                pricing_snapshot: row.pricing_payload
            }));
        });
    }
}
