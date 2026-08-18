import { describe, expect, it, vi } from 'vitest';

import { exportServiceActorJwks, provisionTenant } from '../../../../server/services/multitenant/tenant-provisioner.js';

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
    }
};

function createClient({ existingOperation = null, project = { project_id: 'project_mana' }, connection = null, existingProject = null } = {}) {
    const queries = [];
    const query = vi.fn(async (text, values = []) => {
        queries.push({ text: String(text), values });
        if (String(text).includes('FROM tenant_provisioning_operations')) {
            return { rows: existingOperation ? [existingOperation] : [] };
        }
        if (String(text).includes('INSERT INTO tenant_provisioning_operations')) {
            return { rows: [{ operation_id: 'op_01', status: 'claimed' }] };
        }
        if (String(text).includes('FROM workspace_connections')) {
            return { rows: connection ? [connection] : [] };
        }
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
        if (String(text).includes('FROM brainbase_tenants t')) return {
            rows: [{
                tenant_id: manifest.tenant_id,
                tenant_key: manifest.tenant_key,
                tenant_revision: 1,
                project_id: project?.project_id ?? 'project_mana',
                project_code: manifest.project_code,
                connection_id: manifest.workspace_connection.connection_id,
                connection_revision: 1,
                actor_id: manifest.service_actor.actor_id
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

    it('replays the same operation without duplicate writes', async () => {
        const client = createClient({
            existingOperation: {
                operation_id: 'op_existing',
                desired_state_sha256: 'same',
                status: 'applied',
                receipt_payload: { operation_id: 'op_existing', outcome: 'succeeded' }
            }
        });
        const result = await provisionTenant({
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
        await expect(provisionTenant({
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

        await expect(provisionTenant({
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

        await expect(provisionTenant({
            client,
            manifest,
            idempotencyKey: 'ik_failed',
            actorId: 'operator@example.test',
            graphResolver: ambiguousGraph,
            credentialResolver
        })).rejects.toMatchObject({ code: 'PROJECT_AMBIGUOUS' });

        const failureInsert = client.queries.find(({ text }) => text.includes('INSERT INTO tenant_provisioning_operations') && text.includes('receipt_payload'));
        expect(failureInsert).toBeDefined();
        const failureReceipt = JSON.parse(failureInsert.values[5]);
        expect(failureReceipt).toMatchObject({ outcome: 'failed', failure_code: 'PROJECT_AMBIGUOUS' });
        expect(JSON.stringify(failureReceipt)).not.toContain('project_a');
        expect(client.queries.map(({ text }) => text)).toContain('COMMIT');
    });

    it('does not silently retry a previously failed operation', async () => {
        const client = createClient({
            existingOperation: {
                operation_id: 'op_failed',
                desired_state_sha256: 'same',
                status: 'failed',
                receipt_payload: { failure_code: 'PROJECT_AMBIGUOUS' }
            }
        });
        await expect(provisionTenant({
            client,
            manifest,
            idempotencyKey: 'ik_failed_replay',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        })).rejects.toMatchObject({ code: 'PROJECT_AMBIGUOUS' });
        expect(client.queries.some(({ text }) => text.includes('INSERT INTO brainbase_tenants'))).toBe(false);
    });

    it('fails closed when the tenant project code belongs to another canonical project', async () => {
        const client = createClient({ existingProject: { project_id: 'project_other' } });
        await expect(provisionTenant({
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
        const result = await provisionTenant({
            client,
            manifest,
            idempotencyKey: 'ik_apply',
            actorId: 'operator@example.test',
            graphResolver,
            credentialResolver,
            fingerprint: 'same'
        });

        expect(result.replayed).toBe(false);
        expect(result.receipt).toMatchObject({ tenant_key: 'unson-business', outcome: 'succeeded' });
        expect(result.receipt).not.toHaveProperty('credential_value');
        expect(client.queries.map(({ text }) => text)).toContain('BEGIN');
        expect(client.queries.map(({ text }) => text)).toContain('COMMIT');
        expect(JSON.stringify(result)).not.toContain('operator@example.test');
    });
});
