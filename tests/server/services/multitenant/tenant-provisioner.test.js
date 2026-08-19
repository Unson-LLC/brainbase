import { describe, expect, it, vi } from 'vitest';

import { exportServiceActorJwks, provisionTenant } from '../../../../server/services/multitenant/tenant-provisioner.js';

const TEST_SCHEMA_SHA256 = 'a'.repeat(64);

const manifest = {
    tenant_key: 'unson-business',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    display_name: 'Unson Business',
    project_code: 'mana',
    workspace_connection: {
        provider: 'slack',
        workspace_id: 'T0123456789',
        app_id: 'A0123456789',
        installation_id: 'install_01',
        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        credential_ref: 'credref://unson-business/slack/primary',
        credential_mode: 'customer_oauth',
        scopes: ['chat:write']
    },
    service_actor: {
        actor_id: 'svc_mana_runtime',
        canonical_project_id: 'project_mana',
        capabilities: ['send_message']
    },
    contract_revision: {
        contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        revision: '1',
        status: 'active',
        effective_from: '2026-08-18T00:00:00Z',
        effective_until: null,
        plan_code: 'mana-standard',
        allowances: { tool_calls: 1000 },
        thresholds_basis_points: [5000, 8000, 10000],
        overage_policy: 'deny',
        hard_stop_basis_points: 10000,
        rate_card_revision: 8,
        fx_table_revision: 5,
        sales_price_revision: 3,
        capabilities: [
            'signed_tenant_context',
            'connection_revision_recheck',
            'tenant_scoped_authorization',
            'credential_broker_v1',
            'usage_receipt_v1',
            'idempotent_effects_v1',
            'container_sanitization_v1'
        ],
        audience: ['mana-runtime'],
        deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        profile: 'shared_cloud'
    }
};

const expectedConnectionSnapshot = {
    provider: manifest.workspace_connection.provider,
    installation_id: manifest.workspace_connection.installation_id,
    workspace_id: manifest.workspace_connection.workspace_id,
    app_id: manifest.workspace_connection.app_id,
    granted_scopes: manifest.workspace_connection.scopes,
    status: 'active',
    credential_ref: manifest.workspace_connection.credential_ref,
    credential_mode: manifest.workspace_connection.credential_mode
};

function createClient({
    existingOperation = null,
    project = { project_id: 'project_mana' },
    connection = null,
    existingProject = null,
    existingContract = null,
    existingBinding = null,
    omitReadback = false,
    readbackConnectionSnapshot = expectedConnectionSnapshot
} = {}) {
    const queries = [];
    let operationRow = existingOperation;
    let contractRow = existingContract;
    let bindingRow = existingBinding;
    const query = vi.fn(async (text, values = []) => {
        queries.push({ text: String(text), values });
        const sql = String(text);
        if (String(text).includes('FROM brainbase_schema_migrations')) {
            return { rows: [{ migration_id: 'tenant-production-provisioning.v1', schema_sha256: TEST_SCHEMA_SHA256 }] };
        }
        if (String(text).includes('FROM tenant_provisioning_operations')) {
            if (sql.includes('status = \'claimed\'')) return { rows: operationRow?.status === 'claimed' ? [operationRow] : [] };
            return { rows: operationRow ? [operationRow] : [] };
        }
        if (String(text).includes('INSERT INTO tenant_provisioning_operations')) {
            operationRow = { operation_id: 'op_01', status: 'claimed', claim_token_hash: values[5], claimed_at: values[6], attempt: 1 };
            return { rows: [operationRow] };
        }
        if (sql.includes('UPDATE tenant_provisioning_operations') && sql.includes("SET status = 'claimed'")) {
            operationRow = { ...(operationRow ?? {}), status: 'claimed', claim_token_hash: values[1], claimed_at: values[2], attempt: Number(operationRow?.attempt ?? 1) + 1 };
            return { rows: [operationRow], rowCount: 1 };
        }
        if (sql.includes('UPDATE tenant_provisioning_operations') && sql.includes("SET status = 'applied'")) {
            operationRow = { ...(operationRow ?? {}), status: 'applied', receipt_payload: JSON.parse(values[2]) };
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE tenant_provisioning_operations') && sql.includes("SET status = 'failed'")) {
            operationRow = { ...(operationRow ?? {}), status: 'failed', receipt_payload: JSON.parse(values[3]) };
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('FROM tenant_contract_revision_runtime_bindings')) {
            return { rows: bindingRow ? [bindingRow] : [] };
        }
        if (sql.includes('FROM tenant_contract_revisions')) {
            return { rows: contractRow ? [contractRow] : [] };
        }
        if (sql.includes('INSERT INTO tenant_contract_revisions')) {
            contractRow = {
                tenant_id: values[2],
                contract_id: values[0],
                contract_revision: Number(values[1]),
                tenant_revision_at_write: Number(values[3]),
                status: values[4],
                effective_from: values[5],
                effective_until: values[6],
                plan_code: values[7],
                allowances: JSON.parse(values[8]),
                thresholds_basis_points: values[9],
                overage_policy: values[10],
                hard_stop_basis_points: values[11],
                rate_card_revision: values[12],
                fx_table_revision: values[13],
                sales_price_revision: values[14]
            };
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO tenant_contract_revision_runtime_bindings')) {
            bindingRow = {
                capabilities: values[3],
                audience: values[4],
                deployment_id: values[5],
                profile: values[6]
            };
            return { rows: [], rowCount: 1 };
        }
        if (String(text).includes('FROM workspace_connections')) {
            return { rows: connection ? [connection] : [] };
        }
        if (sql.includes('FROM brainbase_service_actor_capabilities')) {
            return { rows: manifest.service_actor.capabilities.map((capability_id) => ({ capability_id })) };
        }
        if (sql.includes('FROM brainbase_service_actor_keys')) return { rows: [] };
        if (sql.includes('FROM brainbase_tenants') && sql.includes('WHERE tenant_id = $1')) return { rows: [] };
        if (String(text).includes('FROM tenant_projects')) return { rows: existingProject ? [existingProject] : [] };
        if (String(text).includes('INSERT INTO tenant_projects')) return {
            rows: [{ project_id: project?.project_id ?? 'project_mana', tenant_id: manifest.tenant_id, project_code: manifest.project_code }],
            rowCount: 1
        };
        if (String(text).includes('RETURNING tenant_id, tenant_key, tenant_revision')) {
            return { rows: [{ tenant_id: manifest.tenant_id, tenant_key: manifest.tenant_key, tenant_revision: 1 }] };
        }
        if (String(text).includes('RETURNING connection_id, connection_revision')) {
            return { rows: [{ connection_id: manifest.workspace_connection.connection_id, connection_revision: 1 }] };
        }
        if (String(text).includes('SELECT operation_id, status, receipt_payload')) {
            return { rows: [{ operation_id: 'op_01', status: 'applied', receipt_payload: { ok: true } }] };
        }
        if (String(text).includes('SELECT project_id')) return { rows: project ? [project] : [] };
        if (String(text).includes('FROM brainbase_tenants t')) return omitReadback ? { rows: [] } : {
            rows: [{
                tenant_id: manifest.tenant_id,
                tenant_key: manifest.tenant_key,
                tenant_revision: 1,
                project_id: project?.project_id ?? 'project_mana',
                project_code: manifest.project_code,
                connection_id: manifest.workspace_connection.connection_id,
                connection_revision: 1,
                connection_snapshot: readbackConnectionSnapshot,
                actor_id: manifest.service_actor.actor_id,
                contract_id: contractRow?.contract_id ?? manifest.contract_revision.contract_id,
                contract_revision: contractRow?.contract_revision ?? Number(manifest.contract_revision.revision),
                contract_status: contractRow?.status ?? manifest.contract_revision.status,
                effective_from: contractRow?.effective_from ?? manifest.contract_revision.effective_from,
                effective_until: contractRow?.effective_until ?? manifest.contract_revision.effective_until,
                plan_code: contractRow?.plan_code ?? manifest.contract_revision.plan_code,
                allowances: contractRow?.allowances ?? manifest.contract_revision.allowances,
                thresholds_basis_points: contractRow?.thresholds_basis_points ?? manifest.contract_revision.thresholds_basis_points,
                overage_policy: contractRow?.overage_policy ?? manifest.contract_revision.overage_policy,
                hard_stop_basis_points: contractRow?.hard_stop_basis_points ?? manifest.contract_revision.hard_stop_basis_points,
                rate_card_revision: contractRow?.rate_card_revision ?? manifest.contract_revision.rate_card_revision,
                fx_table_revision: contractRow?.fx_table_revision ?? manifest.contract_revision.fx_table_revision,
                sales_price_revision: contractRow?.sales_price_revision ?? manifest.contract_revision.sales_price_revision,
                runtime_capabilities: bindingRow?.capabilities ?? manifest.contract_revision.capabilities,
                runtime_audience: bindingRow?.audience ?? manifest.contract_revision.audience,
                runtime_deployment_id: bindingRow?.deployment_id ?? manifest.contract_revision.deployment_id,
                runtime_profile: bindingRow?.profile ?? manifest.contract_revision.profile
            }]
        };
        return { rows: [], rowCount: 1 };
    });
    return { query, queries };
}

const graphResolver = {
    resolveCanonicalProject: vi.fn(async () => ({ project_id: 'project_mana', matches: 1 }))
};
const credentialResolver = {
    verifyOpaqueReference: vi.fn(async ({ tenant_key }) => ({ tenant_key, valid: true }))
};

function provision(options) {
    return provisionTenant({ ...options, schemaSha256: TEST_SCHEMA_SHA256 });
}

describe('tenant provisioner', () => {
    it('exports only the tenant-scoped standard JWKS view', async () => {
        const client = {
            query: vi.fn(async (text) => {
                expect(text).toContain('brainbase_service_actor_jwks');
                return {
                    rows: [{
                        actor_id: manifest.service_actor.actor_id,
                        tenant_key: manifest.tenant_key,
                        jwks: { keys: [{ kty: 'RSA', kid: 'kid_01', alg: 'RS256', use: 'sig', n: 'public', e: 'AQAB' }] }
                    }]
                };
            })
        };
        await expect(exportServiceActorJwks({
            client,
            tenantKey: manifest.tenant_key,
            actorId: manifest.service_actor.actor_id
        })).resolves.toEqual({
            actor_id: manifest.service_actor.actor_id,
            tenant_key: manifest.tenant_key,
            keys: [{ kty: 'RSA', kid: 'kid_01', alg: 'RS256', use: 'sig', n: 'public', e: 'AQAB' }]
        });
    });

    it('requires the migration ledger hash before any provisioning transaction', async () => {
        const client = createClient();
        await expect(provisionTenant({
            client,
            manifest,
            idempotencyKey: 'ik_schema_required',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver
        })).rejects.toMatchObject({ code: 'SCHEMA_VERSION_REQUIRED' });
        expect(client.queries.map(({ text }) => text)).not.toContain('BEGIN');
    });

    it('replays the same operation without duplicate writes', async () => {
        const client = createClient({
            existingOperation: {
                operation_id: 'op_existing',
                desired_state_sha256: 'same',
                status: 'applied',
                receipt_payload: { operation_id: 'op_existing', outcome: 'succeeded' }
            }
        });
        const result = await provision({
            client,
            manifest,
            idempotencyKey: 'ik_same',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        });

        expect(result.replayed).toBe(true);
        expect(result.receipt.operation_id).toBe('op_existing');
        expect(client.queries.some(({ text }) => text.includes('INSERT INTO brainbase_tenants'))).toBe(false);
        expect(client.queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('conflicts on idempotency fingerprint mismatch without side effects', async () => {
        const client = createClient({
            existingOperation: {
                operation_id: 'op_existing',
                desired_state_sha256: 'different',
                status: 'applied',
                receipt_payload: { operation_id: 'op_existing' }
            }
        });
        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_same',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        expect(client.queries.some(({ text }) => text.includes('INSERT INTO brainbase_tenants'))).toBe(false);
        expect(client.queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('fails closed on ambiguous Graph project and never writes a Graph person', async () => {
        const client = createClient();
        const ambiguousGraph = {
            resolveCanonicalProject: vi.fn(async () => ({ matches: 2, candidates: ['project_a', 'project_b'] }))
        };

        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_ambiguous',
            actorId: 'operator@example.test',
            graphResolver: ambiguousGraph,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'PROJECT_AMBIGUOUS' });
        expect(client.queries.some(({ text }) => text.includes('INSERT INTO brainbase_tenants'))).toBe(false);
        expect(client.queries.some(({ text }) => /person|graph.*write/iu.test(text))).toBe(false);
    });

    it('records a redacted failed operation after an apply rollback', async () => {
        const client = createClient();
        const ambiguousGraph = {
            resolveCanonicalProject: vi.fn(async () => ({ matches: 2, candidates: ['project_a', 'project_b'] }))
        };

        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_failed',
            actorId: 'operator@example.test',
            graphResolver: ambiguousGraph,
            credentialResolver
        })).rejects.toMatchObject({ code: 'PROJECT_AMBIGUOUS' });

        const failureUpdate = client.queries.find(({ text }) => text.includes('UPDATE tenant_provisioning_operations') && text.includes("SET status = 'failed'"));
        expect(failureUpdate).toBeDefined();
        const failureReceipt = JSON.parse(failureUpdate.values[3]);
        expect(failureReceipt).toMatchObject({
            outcome: 'failed',
            failure_code: 'PROJECT_AMBIGUOUS',
            schema_migration: {
                migration_id: 'tenant-production-provisioning.v1',
                schema_sha256: TEST_SCHEMA_SHA256
            }
        });
        expect(JSON.stringify(failureReceipt)).not.toContain('project_a');
        expect(client.queries.map(({ text }) => text)).toContain('COMMIT');
    });

    it('reclaims a failed operation with the same fingerprint and fences the old attempt', async () => {
        const client = createClient({
            existingOperation: {
                operation_id: 'op_failed',
                desired_state_sha256: 'same',
                status: 'failed',
                receipt_payload: { failure_code: 'PROJECT_AMBIGUOUS' },
                attempt: 1
            }
        });
        const result = await provision({
            client,
            manifest,
            idempotencyKey: 'ik_failed_replay',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        });
        expect(result.receipt.operation_id).toBe('op_failed');
        expect(client.queries.some(({ text }) => text.includes("SET status = 'claimed'"))).toBe(true);
    });

    it('fails closed when the tenant project code belongs to another canonical project', async () => {
        const client = createClient({ existingProject: { project_id: 'project_other' } });
        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_project_conflict',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'PROJECT_CANONICAL_ID_CONFLICT' });
        expect(client.queries.some(({ text }) => text.includes('INSERT INTO tenant_projects'))).toBe(false);
        expect(client.queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('returns a redacted readback receipt after an atomic apply', async () => {
        const client = createClient();
        const result = await provision({
            client,
            manifest,
            idempotencyKey: 'ik_apply',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        });

        expect(result.replayed).toBe(false);
        expect(result.receipt).toMatchObject({
            tenant_key: 'unson-business',
            outcome: 'succeeded',
            schema_migration: {
                migration_id: 'tenant-production-provisioning.v1',
                schema_sha256: TEST_SCHEMA_SHA256
            },
            contract_revision: { revision: '1', deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV' }
        });
        expect(result.receipt.readback.workspace_connection_revision).toBe(true);
        const snapshotInsert = client.queries.findIndex(({ text }) => text.includes('INSERT INTO workspace_connection_revisions'));
        const currentInsert = client.queries.findIndex(({ text }) => text.includes('INSERT INTO workspace_connections'));
        expect(snapshotInsert).toBeGreaterThanOrEqual(0);
        expect(snapshotInsert).toBeLessThan(currentInsert);
        expect(result.receipt).not.toHaveProperty('credential_value');
        expect(client.queries.map(({ text }) => text)).toContain('BEGIN');
        expect(client.queries.map(({ text }) => text)).toContain('COMMIT');
        expect(JSON.stringify(result)).not.toContain('operator@example.test');
    });

    it('fails closed when the current connection revision has no immutable snapshot readback', async () => {
        const client = createClient({ omitReadback: true });
        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_missing_snapshot',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'READBACK_FAILED' });
        expect(client.queries.some(({ text }) => text.includes('JOIN workspace_connection_revisions wcr'))).toBe(true);
        expect(client.queries.map(({ text }) => text)).toContain('ROLLBACK');
    });

    it('fails closed when a canonical contract revision already has a different payload', async () => {
        const client = createClient({ existingContract: {
            tenant_id: manifest.tenant_id,
            contract_id: manifest.contract_revision.contract_id,
            contract_revision: 1,
            status: 'active',
            effective_from: manifest.contract_revision.effective_from,
            effective_until: null,
            plan_code: 'different-plan',
            allowances: manifest.contract_revision.allowances,
            thresholds_basis_points: manifest.contract_revision.thresholds_basis_points,
            overage_policy: manifest.contract_revision.overage_policy,
            hard_stop_basis_points: manifest.contract_revision.hard_stop_basis_points,
            rate_card_revision: manifest.contract_revision.rate_card_revision,
            fx_table_revision: manifest.contract_revision.fx_table_revision,
            sales_price_revision: manifest.contract_revision.sales_price_revision
        } });
        await expect(provision({
            client,
            manifest,
            idempotencyKey: 'ik_contract_conflict',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'CONTRACT_REVISION_CONFLICT' });
        expect(client.queries.map(({ text }) => text)).toContain('ROLLBACK');
    });
});
