import { createHash } from 'node:crypto';
import { ContractError } from './errors.js';
import { canonicalJson } from './canonical-json.js';
import { isCanonicalId } from './ids.js';

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

const SLACK_INSTALLATION_CLAIM_STALE_SECONDS = 120;

function sha256(value) {
    return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

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
                wc.granted_scopes, wc.credential_ref AS current_credential_ref,
                revision.connection_snapshot,
                cbr.credential_ref AS credential_ref,
                cbr.credential_mode, cbr.refresh_revision
         FROM workspace_connections wc
         JOIN workspace_connection_revisions revision
           ON revision.tenant_id = wc.tenant_id
          AND revision.connection_id = wc.connection_id
          AND revision.connection_revision = wc.connection_revision
         JOIN credential_broker_refs cbr
           ON cbr.tenant_id = wc.tenant_id
          AND cbr.connection_id = wc.connection_id
          AND cbr.connection_revision = wc.connection_revision
         WHERE wc.tenant_id = $1 AND wc.connection_id = $2
         FOR SHARE OF wc, revision, cbr`,
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
    let snapshot = connection.connection_snapshot;
    if (typeof snapshot === 'string') {
        try {
            snapshot = JSON.parse(snapshot);
        } catch {
            snapshot = null;
        }
    }
    const sortedScopes = (value) => Array.isArray(value) ? [...value].map(String).sort() : null;
    const snapshotMatchesCurrent = snapshot
        && typeof snapshot === 'object'
        && String(snapshot.provider ?? '') === String(connection.provider)
        && String(snapshot.installation_id ?? '') === String(connection.installation_id)
        && String(snapshot.workspace_id ?? '') === String(connection.workspace_id)
        && String(snapshot.app_id ?? '') === String(connection.app_id)
        && String(snapshot.status ?? '') === String(connection.status)
        && String(snapshot.credential_ref ?? '') === String(connection.current_credential_ref)
        && (snapshot.credential_mode === undefined
            || String(snapshot.credential_mode) === String(connection.credential_mode))
        && Array.isArray(snapshot.granted_scopes)
        && Array.isArray(connection.granted_scopes)
        && JSON.stringify(sortedScopes(snapshot.granted_scopes)) === JSON.stringify(sortedScopes(connection.granted_scopes))
        && (snapshot.tenant_id === undefined || String(snapshot.tenant_id) === String(connection.tenant_id))
        && (snapshot.connection_id === undefined || String(snapshot.connection_id) === String(connection.connection_id))
        && (snapshot.connection_revision === undefined
            || String(snapshot.connection_revision) === String(connection.connection_revision));
    if (!snapshotMatchesCurrent) {
        throw new ContractError(
            snapshot ? 'WORKSPACE_CONNECTION_STALE_REVISION' : 'WORKSPACE_CONNECTION_UNAVAILABLE',
            snapshot
                ? { status: 409 }
                : { status: 503, retryable: true, fault_domain: 'brainbase_cloud' }
        );
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

    async createSlackInstallationIntent({
        installation_intent_id,
        tenant_id,
        app_id,
        expected_workspace_id = null,
        expected_enterprise_id = null,
        initiated_by_person_id,
        expected_connection_revision = null,
        issued_at,
        expires_at
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const tenantResult = await client.query(
                `SELECT tenant_id, tenant_revision, status
                   FROM brainbase_tenants
                  WHERE tenant_id = $1
                  FOR SHARE`,
                [tenant_id]
            );
            const tenant = tenantResult.rows[0];
            if (!tenant || tenant.status !== 'active') {
                throw new ContractError('INSTALLATION_AUTHORIZATION_REQUIRED', { status: 403 });
            }
            const result = await client.query(
                `INSERT INTO slack_installation_intents (
                    installation_intent_id, tenant_id, tenant_revision_at_write,
                    app_id, expected_workspace_id, expected_enterprise_id,
                    initiated_by_principal_id, expected_connection_revision,
                    issued_at, expires_at, created_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)
                 RETURNING installation_intent_id, tenant_id, app_id,
                           expected_workspace_id, expected_enterprise_id,
                           initiated_by_principal_id AS initiated_by_person_id, expected_connection_revision,
                           issued_at, expires_at, consumed_at`,
                [installation_intent_id, tenant_id, tenant.tenant_revision, app_id,
                    expected_workspace_id, expected_enterprise_id, initiated_by_person_id,
                    expected_connection_revision, issued_at, expires_at]
            );
            if (!result.rows[0]) throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
            return result.rows[0];
        });
    }

    async claimSlackInstallationExchange({
        intent,
        request_digest,
        claim_token,
        now = this.now().toISOString(),
        stale_after_seconds = SLACK_INSTALLATION_CLAIM_STALE_SECONDS
    }) {
        if (!intent || typeof request_digest !== 'string' || typeof claim_token !== 'string') {
            throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
        }
        return this.withTenant(intent.tenant_id, async (client) => {
            const intentResult = await client.query(
                `SELECT installation_intent_id, tenant_id, app_id,
                        expected_workspace_id, expected_enterprise_id,
                        initiated_by_principal_id AS initiated_by_person_id,
                        expected_connection_revision, issued_at, expires_at, consumed_at
                   FROM slack_installation_intents
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const storedIntent = intentResult.rows[0];
            if (!storedIntent) throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
            if (storedIntent.app_id !== intent.app_id
                || storedIntent.tenant_id !== intent.tenant_id
                || storedIntent.initiated_by_person_id !== intent.initiated_by_person_id
                || (storedIntent.expected_workspace_id ?? null) !== (intent.expected_workspace_id ?? null)
                || (storedIntent.expected_enterprise_id ?? null) !== (intent.expected_enterprise_id ?? null)
                || String(storedIntent.expected_connection_revision ?? '') !== String(intent.expected_connection_revision ?? '')) {
                throw new ContractError('INSTALLATION_BINDING_MISMATCH', { status: 409 });
            }
            const nowMs = Date.parse(now);
            const expiresMs = Date.parse(storedIntent.expires_at);
            if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) {
                throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
            }

            const ledgerResult = await client.query(
                `SELECT status, request_digest, response_payload, claimed_at, attempt
                   FROM slack_installation_exchange_ledger
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const ledger = ledgerResult.rows[0];
            if (ledger?.status === 'completed' && ledger.response_payload) {
                if (ledger.request_digest !== request_digest) {
                    throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409 });
                }
                return { status: 'completed', response_payload: ledger.response_payload };
            }
            if (storedIntent.consumed_at) {
                throw new ContractError('INSTALLATION_STATE_REPLAYED', { status: 409 });
            }
            if (expiresMs <= nowMs) {
                throw new ContractError('INSTALLATION_STATE_EXPIRED', { status: 410 });
            }
            if (ledger?.status === 'processing') {
                const claimedMs = Date.parse(ledger.claimed_at);
                const staleMs = nowMs - Number(stale_after_seconds) * 1000;
                if (Number.isFinite(claimedMs) && claimedMs > staleMs) {
                    throw new ContractError('INSTALLATION_IN_PROGRESS', { status: 409, retryable: true });
                }
            }
            if (ledger && ledger.request_digest !== request_digest) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409 });
            }

            const claimTokenHash = sha256(claim_token);
            if (ledger) {
                await client.query(
                    `UPDATE slack_installation_exchange_ledger
                        SET status = 'processing', request_digest = $3,
                            claim_token_hash = $4, claimed_at = $5,
                            attempt = attempt + 1, failure_code = NULL,
                            connection_id = NULL, connection_revision = NULL,
                            response_payload = NULL, completed_at = NULL
                      WHERE tenant_id = $1 AND installation_intent_id = $2`,
                    [intent.tenant_id, intent.installation_intent_id, request_digest, claimTokenHash, now]
                );
            } else {
                await client.query(
                    `INSERT INTO slack_installation_exchange_ledger (
                        installation_intent_id, tenant_id, request_digest, status,
                        claim_token_hash, claimed_at, attempt, created_at
                     ) VALUES ($1, $2, $3, 'processing', $4, $5, 1, $5)`,
                    [intent.installation_intent_id, intent.tenant_id, request_digest, claimTokenHash, now]
                );
            }
            return {
                status: 'claimed',
                attempt: Number(ledger?.attempt ?? 0) + 1
            };
        });
    }

    async readSlackInstallationResult({ tenant_id, installation_intent_id }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `SELECT i.consumed_at, l.status, l.response_payload
                   FROM slack_installation_intents i
              LEFT JOIN slack_installation_exchange_ledger l
                     ON l.tenant_id = i.tenant_id
                    AND l.installation_intent_id = i.installation_intent_id
                  WHERE i.tenant_id = $1 AND i.installation_intent_id = $2
                  FOR SHARE OF i`,
                [tenant_id, installation_intent_id]
            );
            const row = result.rows[0];
            if (!row) throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
            if (row.status === 'completed' && row.response_payload) return row.response_payload;
            if (row.status === 'processing') {
                throw new ContractError('INSTALLATION_IN_PROGRESS', { status: 409, retryable: true });
            }
            if (row.consumed_at) throw new ContractError('INSTALLATION_STATE_REPLAYED', { status: 409 });
            return null;
        });
    }

    async reserveSlackInstallationConnection({
        intent,
        workspace_id: workspaceId,
        app_id: appId,
        proposed_connection_id: proposedConnectionId,
        claim_token: claimToken,
        request_digest: requestDigest,
        now = this.now().toISOString()
    }) {
        if (!intent || typeof workspaceId !== 'string' || typeof appId !== 'string'
            || !isCanonicalId(proposedConnectionId, 'wsc')
            || typeof claimToken !== 'string' || typeof requestDigest !== 'string') {
            throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
        }
        return this.withTenant(intent.tenant_id, async (client) => {
            const intentResult = await client.query(
                `SELECT installation_intent_id, tenant_id, app_id,
                        expected_workspace_id, expected_enterprise_id,
                        initiated_by_principal_id AS initiated_by_person_id,
                        expected_connection_revision, expires_at, consumed_at
                   FROM slack_installation_intents
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const storedIntent = intentResult.rows[0];
            if (!storedIntent) throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });
            if (storedIntent.app_id !== intent.app_id
                || storedIntent.app_id !== appId
                || storedIntent.tenant_id !== intent.tenant_id
                || storedIntent.initiated_by_person_id !== intent.initiated_by_person_id
                || (storedIntent.expected_workspace_id ?? null) !== (intent.expected_workspace_id ?? null)
                || (storedIntent.expected_enterprise_id ?? null) !== (intent.expected_enterprise_id ?? null)
                || String(storedIntent.expected_connection_revision ?? '') !== String(intent.expected_connection_revision ?? '')
                || (storedIntent.expected_workspace_id && storedIntent.expected_workspace_id !== workspaceId)) {
                throw new ContractError('INSTALLATION_BINDING_MISMATCH', { status: 409 });
            }
            if (storedIntent.consumed_at || Date.parse(storedIntent.expires_at) <= Date.parse(now)) {
                throw new ContractError(storedIntent.consumed_at ? 'INSTALLATION_STATE_REPLAYED' : 'INSTALLATION_STATE_EXPIRED', {
                    status: storedIntent.consumed_at ? 409 : 410
                });
            }

            const ledgerResult = await client.query(
                `SELECT status, request_digest, claim_token_hash,
                        connection_id, connection_revision, response_payload
                   FROM slack_installation_exchange_ledger
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const ledger = ledgerResult.rows[0];
            if (ledger?.status === 'completed' && ledger.response_payload) {
                return {
                    status: 'completed',
                    response_payload: ledger.response_payload,
                    connection_id: ledger.connection_id,
                    connection_revision: String(ledger.connection_revision)
                };
            }
            if (!ledger || ledger.status !== 'processing'
                || ledger.request_digest !== requestDigest
                || ledger.claim_token_hash !== sha256(claimToken)) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }

            const currentResult = await client.query(
                `SELECT connection_id, connection_revision, status
                   FROM workspace_connections
                  WHERE tenant_id = $1 AND provider = 'slack'
                    AND workspace_id = $2 AND app_id = $3
                    AND status IN ('pending', 'active', 'reauth_required')
                  LIMIT 2
                  FOR UPDATE`,
                [intent.tenant_id, workspaceId, appId]
            );
            if ((currentResult.rows ?? []).length > 1) {
                throw new ContractError('WORKSPACE_CONNECTION_CONFLICT', { status: 409 });
            }
            const current = currentResult.rows[0] ?? null;
            if (current && intent.expected_connection_revision === undefined) {
                throw new ContractError('WORKSPACE_CONNECTION_CONFLICT', { status: 409 });
            }
            if (current && String(current.connection_revision) !== String(intent.expected_connection_revision)) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }
            if (!current && intent.expected_connection_revision !== undefined) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }

            const connectionId = current?.connection_id ?? proposedConnectionId;
            const connectionRevision = String(Number(current?.connection_revision ?? 0) + 1);
            if (!isCanonicalId(connectionId, 'wsc')) {
                throw new ContractError('WORKSPACE_CONNECTION_CONFLICT', { status: 409 });
            }
            if (ledger.connection_id || ledger.connection_revision) {
                if (ledger.connection_id !== connectionId
                    || String(ledger.connection_revision) !== connectionRevision) {
                    throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
                }
                return {
                    status: 'reserved',
                    connection_id: connectionId,
                    connection_revision: connectionRevision
                };
            }

            // A second callback for the same logical Slack target can have a
            // different intent.  Do not hand both external stores the same
            // next revision while the first claim is still processing.
            const reservationConflict = await client.query(
                `SELECT l.installation_intent_id
                   FROM slack_installation_exchange_ledger l
                   JOIN slack_installation_intents i
                     ON i.tenant_id = l.tenant_id
                    AND i.installation_intent_id = l.installation_intent_id
                  WHERE l.tenant_id = $1
                    AND l.status = 'processing'
                    AND l.connection_id = $2
                    AND l.connection_revision = $3
                    AND l.installation_intent_id <> $4
                    AND i.app_id = $5
                    AND i.expected_workspace_id = $6
                  LIMIT 1
                  FOR SHARE OF l`,
                [intent.tenant_id, connectionId, connectionRevision,
                    intent.installation_intent_id, appId, workspaceId]
            );
            if ((reservationConflict.rows ?? []).length > 0) {
                throw new ContractError('INSTALLATION_IN_PROGRESS', { status: 409, retryable: true });
            }

            const reserved = await client.query(
                `UPDATE slack_installation_exchange_ledger
                    SET connection_id = $3, connection_revision = $4
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                    AND status = 'processing'
                    AND request_digest = $5
                    AND claim_token_hash = $6
                 RETURNING connection_id, connection_revision`,
                [intent.tenant_id, intent.installation_intent_id, connectionId,
                    connectionRevision, requestDigest, sha256(claimToken)]
            );
            if (!reserved.rows[0]) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }
            return {
                status: 'reserved',
                connection_id: reserved.rows[0].connection_id,
                connection_revision: String(reserved.rows[0].connection_revision)
            };
        });
    }

    async registerSlackInstallation({
        intent,
        exchange,
        credential,
        connection_id,
        connection_revision,
        claim_token,
        request_digest,
        now = this.now().toISOString()
    }) {
        return this.withTenant(intent.tenant_id, async (client) => {
            const intentResult = await client.query(
                `SELECT installation_intent_id, tenant_id, app_id,
                        expected_workspace_id, expected_enterprise_id,
                        initiated_by_principal_id AS initiated_by_person_id, expected_connection_revision,
                        issued_at, expires_at, consumed_at
                   FROM slack_installation_intents
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const storedIntent = intentResult.rows[0];
            if (!storedIntent) throw new ContractError('INSTALLATION_STATE_INVALID', { status: 400 });

            const existingLedgerResult = await client.query(
                `SELECT request_digest, status, connection_id, connection_revision,
                        response_payload, claim_token_hash
                   FROM slack_installation_exchange_ledger
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                  FOR UPDATE`,
                [intent.tenant_id, intent.installation_intent_id]
            );
            const existingLedger = existingLedgerResult.rows[0];
            if (existingLedger?.status === 'completed' && existingLedger.response_payload) {
                return existingLedger.response_payload;
            }
            if (!existingLedger || existingLedger.status !== 'processing'
                || existingLedger.request_digest !== request_digest
                || existingLedger.claim_token_hash !== sha256(claim_token)) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }
            if (storedIntent.consumed_at) {
                throw new ContractError('INSTALLATION_STATE_REPLAYED', { status: 409 });
            }
            if (Date.parse(storedIntent.expires_at) <= Date.parse(now)) {
                throw new ContractError('INSTALLATION_STATE_EXPIRED', { status: 410 });
            }
            if (storedIntent.app_id !== intent.app_id
                || storedIntent.tenant_id !== intent.tenant_id
                || storedIntent.initiated_by_person_id !== intent.initiated_by_person_id
                || (storedIntent.expected_workspace_id ?? null) !== (intent.expected_workspace_id ?? null)
                || (storedIntent.expected_enterprise_id ?? null) !== (intent.expected_enterprise_id ?? null)
                || String(storedIntent.expected_connection_revision ?? '') !== String(intent.expected_connection_revision ?? '')) {
                throw new ContractError('INSTALLATION_BINDING_MISMATCH', { status: 409 });
            }

            const tenantResult = await client.query(
                `SELECT tenant_revision, status
                   FROM brainbase_tenants
                  WHERE tenant_id = $1
                  FOR SHARE`,
                [intent.tenant_id]
            );
            const tenant = tenantResult.rows[0];
            if (!tenant || tenant.status !== 'active') throw new ContractError('TENANT_UNKNOWN', { status: 403 });

            const contractResult = await client.query(
                `SELECT c.contract_revision, rb.deployment_id, rb.profile
                   FROM tenant_contract_revisions c
                   JOIN tenant_contract_revision_runtime_bindings rb
                     ON rb.tenant_id = c.tenant_id
                    AND rb.contract_id = c.contract_id
                    AND rb.contract_revision = c.contract_revision
                  WHERE c.tenant_id = $1 AND c.status = 'active'
                    AND c.effective_from <= $2
                    AND (c.effective_until IS NULL OR c.effective_until > $2)
                  ORDER BY c.contract_revision DESC
                  LIMIT 1
                  FOR SHARE`,
                [intent.tenant_id, now]
            );
            const contract = contractResult.rows[0];
            if (!contract) throw new ContractError('CONTRACT_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });

            const currentResult = await client.query(
                `SELECT connection_id, connection_revision, status
                   FROM workspace_connections
                  WHERE tenant_id = $1 AND provider = 'slack'
                    AND workspace_id = $2 AND app_id = $3
                    AND status IN ('pending', 'active', 'reauth_required')
                  LIMIT 2
                  FOR UPDATE`,
                [intent.tenant_id, exchange.workspace_id, intent.app_id]
            );
            if ((currentResult.rows ?? []).length > 1) {
                throw new ContractError('WORKSPACE_CONNECTION_CONFLICT', { status: 409 });
            }
            const current = currentResult.rows[0];
            if (current && intent.expected_connection_revision === undefined) {
                throw new ContractError('WORKSPACE_CONNECTION_CONFLICT', { status: 409 });
            }
            if (current && String(current.connection_revision) !== String(intent.expected_connection_revision)) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }
            if (!current && intent.expected_connection_revision !== undefined) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }
            const resolvedConnectionId = existingLedger.connection_id;
            const resolvedRevision = String(existingLedger.connection_revision ?? '');
            if (!isCanonicalId(resolvedConnectionId, 'wsc')
                || !/^[1-9][0-9]*$/u.test(resolvedRevision)
                || connection_id !== resolvedConnectionId
                || String(connection_revision ?? '') !== resolvedRevision
                || (current && (current.connection_id !== resolvedConnectionId
                    || String(current.connection_revision) === resolvedRevision))
                || (!current && resolvedRevision !== '1')) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }
            const expectedNextRevision = String(Number(current?.connection_revision ?? 0) + 1);
            if (resolvedRevision !== expectedNextRevision) {
                throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
            }
            const installedAt = now;
            const snapshot = {
                connection_id: resolvedConnectionId,
                connection_revision: resolvedRevision,
                tenant_id: intent.tenant_id,
                provider: 'slack',
                installation_id: exchange.installation_id,
                workspace_id: exchange.workspace_id,
                ...(exchange.enterprise_id ? { enterprise_id: exchange.enterprise_id } : {}),
                app_id: intent.app_id,
                installer_id: exchange.installer_id,
                granted_scopes: [...exchange.granted_scopes].sort(),
                status: 'active',
                credential_ref: credential.credential_ref,
                deployment_id: contract.deployment_id,
                profile: contract.profile,
                credential_mode: credential.credential_mode,
                contract_revision: String(contract.contract_revision)
            };
            const responsePayload = { ...snapshot };
            delete responsePayload.credential_ref;
            await client.query(
                `INSERT INTO workspace_connection_revisions (
                    tenant_id, connection_id, connection_revision, connection_snapshot, recorded_at
                 ) VALUES ($1,$2,$3,$4::jsonb,$5)`,
                [intent.tenant_id, resolvedConnectionId, resolvedRevision, canonicalJson(snapshot), installedAt]
            );
            if (!current) {
                await client.query(
                    `INSERT INTO workspace_connections (
                        connection_id, connection_revision, tenant_id, tenant_revision_at_write,
                        provider, installation_id, workspace_id, enterprise_id, app_id, installer_id,
                        granted_scopes, status, credential_ref, installed_at,
                        deployment_id, profile, contract_revision
                     ) VALUES ($1,1,$2,$3,'slack',$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13,$14)`,
                    [resolvedConnectionId, intent.tenant_id, tenant.tenant_revision,
                        exchange.installation_id, exchange.workspace_id, exchange.enterprise_id ?? null,
                        intent.app_id, exchange.installer_id, exchange.granted_scopes,
                        credential.credential_ref, installedAt, contract.deployment_id,
                        contract.profile, String(contract.contract_revision)]
                );
            }
            if (current) {
                await client.query(
                    `UPDATE workspace_connections
                        SET connection_revision = $3,
                            installation_id = $4, workspace_id = $5,
                            enterprise_id = $6, app_id = $7,
                            installer_id = $8, granted_scopes = $9,
                            status = 'active', credential_ref = $10,
                            installed_at = $11, revoked_at = NULL,
                            supersedes_connection_revision = $12,
                            deployment_id = $13, profile = $14,
                            contract_revision = $15
                      WHERE tenant_id = $1 AND connection_id = $2`,
                    [intent.tenant_id, resolvedConnectionId, resolvedRevision,
                        exchange.installation_id, exchange.workspace_id, exchange.enterprise_id ?? null,
                        intent.app_id, exchange.installer_id, exchange.granted_scopes,
                        credential.credential_ref, installedAt, current.connection_revision,
                        contract.deployment_id, contract.profile, String(contract.contract_revision)]
                );
            }
            await client.query(
                `INSERT INTO credential_broker_refs (
                    credential_ref, tenant_id, connection_id, connection_revision,
                    credential_mode, refresh_revision, created_at, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
                [credential.credential_ref, intent.tenant_id, resolvedConnectionId, resolvedRevision,
                    credential.credential_mode, credential.refresh_revision ?? 1, installedAt]
            );
            await client.query(
                `UPDATE slack_installation_intents
                    SET consumed_at = $3
                  WHERE tenant_id = $1 AND installation_intent_id = $2 AND consumed_at IS NULL`,
                [intent.tenant_id, intent.installation_intent_id, installedAt]
            );
            const ledger = await client.query(
                `UPDATE slack_installation_exchange_ledger
                    SET status = 'completed', claim_token_hash = NULL,
                        claimed_at = NULL, failure_code = NULL,
                        connection_id = $3, connection_revision = $4,
                        response_payload = $5::jsonb, completed_at = $6
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                    AND status = 'processing'
                    AND request_digest = $7
                    AND claim_token_hash = $8
                 RETURNING response_payload`,
                [intent.tenant_id, intent.installation_intent_id,
                    resolvedConnectionId, resolvedRevision, canonicalJson(responsePayload), installedAt,
                    request_digest, sha256(claim_token)]
            );
            if (!ledger.rows[0]?.response_payload) {
                throw new ContractError('INSTALLATION_CLAIM_STALE', { status: 409, retryable: true });
            }
            return ledger.rows[0].response_payload;
        });
    }

    async failSlackInstallationExchange({
        intent,
        claim_token,
        request_digest,
        failure_code = 'INSTALLATION_EXCHANGE_FAILED',
        now = this.now().toISOString()
    }) {
        if (!intent || typeof claim_token !== 'string' || typeof request_digest !== 'string') return false;
        const safeFailureCode = /^[A-Z0-9_:-]{1,128}$/u.test(String(failure_code))
            ? String(failure_code)
            : 'INSTALLATION_EXCHANGE_FAILED';
        return this.withTenant(intent.tenant_id, async (client) => {
            const result = await client.query(
                `UPDATE slack_installation_exchange_ledger
                    SET status = 'failed', claim_token_hash = NULL,
                        claimed_at = NULL, failure_code = $3,
                        completed_at = NULL, response_payload = NULL,
                        connection_id = NULL, connection_revision = NULL
                  WHERE tenant_id = $1 AND installation_intent_id = $2
                    AND status = 'processing'
                    AND request_digest = $4
                    AND claim_token_hash = $5`,
                [intent.tenant_id, intent.installation_intent_id, safeFailureCode,
                    request_digest, sha256(claim_token)]
            );
            if (result.rowCount !== 1) return false;
            return true;
        });
    }

    async resolveRuntimeContext({
        tenant_id, expected_tenant_revision, connection_id, expected_connection_revision,
        workspace_id, app_id, required_connection_scopes = []
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const workspaceConnection = await readConnectionRevision(client, {
                tenant_id,
                connection_id,
                expected_connection_revision,
                workspace_id,
                app_id,
                required_scopes: required_connection_scopes
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
                `SELECT tenant_contract_revisions.tenant_id,
                        tenant_contract_revisions.contract_id,
                        tenant_contract_revisions.contract_revision,
                        tenant_contract_revisions.allowances,
                        tenant_contract_revisions.thresholds_basis_points,
                        tenant_contract_revisions.overage_policy,
                        tenant_contract_revisions.hard_stop_basis_points,
                        tenant_contract_revisions.rate_card_revision,
                        tenant_contract_revisions.fx_table_revision,
                        tenant_contract_revisions.sales_price_revision,
                        rb.capabilities AS runtime_capabilities,
                        rb.audience AS runtime_audience,
                        rb.deployment_id AS runtime_deployment_id,
                        rb.profile AS runtime_profile
                 FROM tenant_contract_revisions
                 JOIN tenant_contract_revision_runtime_bindings rb
                   ON rb.tenant_id = tenant_contract_revisions.tenant_id
                  AND rb.contract_id = tenant_contract_revisions.contract_id
                  AND rb.contract_revision = tenant_contract_revisions.contract_revision
                 WHERE tenant_contract_revisions.tenant_id = $1
                   AND tenant_contract_revisions.contract_revision = $2
                   AND tenant_contract_revisions.status = 'active'
                   AND tenant_contract_revisions.effective_from <= $3
                   AND (tenant_contract_revisions.effective_until IS NULL OR tenant_contract_revisions.effective_until > $3)
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
                hard_stop_basis_points: Number(contract.hard_stop_basis_points),
                runtime_binding: {
                    capabilities: [...contract.runtime_capabilities],
                    audience: [...contract.runtime_audience],
                    deployment_id: contract.runtime_deployment_id,
                    profile: contract.runtime_profile
                }
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
