import { describe, expect, it } from 'vitest';

import {
    normalizeCompanyAuthorityRetirementManifest,
    readbackCompanyAuthorityRetirement,
    retireCompanyAuthority
} from '../../../../server/services/multitenant/company-authority-retirement.js';
import { parseRetireCompanyAuthorityArgs } from '../../../../scripts/retire-company-authority.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function manifest(overrides = {}) {
    return {
        version: 'company-authority-retirement.v1',
        tenant_id: tenantId,
        tenant_key: 'unson-business',
        organization_id: 'techknight',
        project_id: 'prj_techknight',
        memberships: [
            { membership_id: 'mem_sato_techknight', principal_id: 'per_sato', expected_revision: '1' },
            { membership_id: 'mem_umeda_techknight', principal_id: 'per_umeda', expected_revision: '3' }
        ],
        external_identities: [
            {
                identity_id: 'idn_sato_techknight', identity_revision: '2',
                membership_id: 'mem_sato_techknight', provider: 'slack',
                authenticated_subject_id: 'U_SATO', workspace_id: 'T_UNSON', app_id: 'A_MANA',
                project_id: 'prj_techknight', placement_id: 'biz-router'
            },
            {
                identity_id: 'idn_umeda_techknight', identity_revision: '1',
                membership_id: 'mem_umeda_techknight', provider: 'slack',
                authenticated_subject_id: 'U_UMEDA', workspace_id: 'T_UNSON', app_id: 'A_MANA',
                project_id: 'prj_techknight', placement_id: 'biz-router'
            }
        ],
        active_bindings: [
            {
                binding_id: 'bnd_sato_runtime', binding_revision: '1',
                membership_id: 'mem_sato_techknight', organization_id: 'techknight',
                project_id: 'prj_techknight', resource_ref: 'project:prj_techknight',
                capability_id: 'runtime.execute'
            }
        ],
        ...overrides
    };
}

function clone(value) {
    return structuredClone(value);
}

function fakeClient() {
    const state = {
        memberships: manifest().memberships.map((membership) => ({
            membership_id: membership.membership_id,
            organization_id: 'techknight',
            principal_id: membership.principal_id,
            status: 'active',
            revision: membership.expected_revision
        })),
        identities: manifest().external_identities.map((identity) => ({ ...identity, status: 'active' })),
        bindings: manifest().active_bindings.map((binding) => ({ ...binding, status: 'active' })),
        operations: []
    };
    let snapshot = null;
    const queries = [];
    const query = async (sql, parameters = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, parameters: clone(parameters) });
        if (compact === 'BEGIN' || compact === 'BEGIN READ ONLY') {
            snapshot = clone(state);
            return { rows: [], rowCount: 0 };
        }
        if (compact === 'ROLLBACK') {
            Object.assign(state, snapshot);
            snapshot = null;
            return { rows: [], rowCount: 0 };
        }
        if (compact === 'COMMIT') {
            snapshot = null;
            return { rows: [], rowCount: 0 };
        }
        if (compact.includes("set_config('brainbase.tenant_id'")) return { rows: [{}], rowCount: 1 };
        if (compact.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: [{ tenant_id: tenantId, tenant_key: 'unson-business', status: 'active' }], rowCount: 1 };
        }
        if (compact.includes('FROM tenant_organizations')) {
            return { rows: parameters[1] === 'techknight' ? [{ organization_id: 'techknight' }] : [], rowCount: 1 };
        }
        if (compact.includes('FROM tenant_projects')) {
            return { rows: parameters[1] === 'prj_techknight' ? [{ project_id: 'prj_techknight' }] : [], rowCount: 1 };
        }
        if (compact.startsWith('SELECT operation_id')) {
            const rows = compact.includes('WHERE operation_id = $1')
                ? state.operations.filter((row) => row.operation_id === parameters[0]
                    && row.tenant_key === parameters[1] && row.idempotency_key === parameters[2])
                : state.operations.filter((row) =>
                    row.tenant_key === parameters[0] && row.idempotency_key === parameters[1]);
            return { rows: clone(rows), rowCount: rows.length };
        }
        if (compact.startsWith('INSERT INTO tenant_provisioning_operations')) {
            state.operations.push({
                operation_id: parameters[0], tenant_key: parameters[1], idempotency_key: parameters[2],
                desired_state_sha256: parameters[3], status: 'claimed', receipt_payload: null
            });
            return { rows: [], rowCount: 1 };
        }
        if (compact.startsWith('UPDATE tenant_provisioning_operations')) {
            const row = state.operations.find(({ operation_id: id }) => id === parameters[0]);
            if (!row || row.status !== 'claimed') return { rows: [], rowCount: 0 };
            row.status = 'applied';
            row.receipt_payload = JSON.parse(parameters[1]);
            return { rows: [], rowCount: 1 };
        }
        if (compact.includes('FROM tenant_memberships')) {
            const ids = parameters[1];
            const rows = state.memberships.filter(({ membership_id: id }) => ids.includes(id));
            return { rows: clone(rows), rowCount: rows.length };
        }
        if (compact.startsWith('UPDATE tenant_memberships')) {
            const row = state.memberships.find(({ membership_id: id }) => id === parameters[1]);
            if (!row || row.organization_id !== parameters[2] || row.principal_id !== parameters[3]
                || row.status !== 'active' || row.revision !== parameters[4]) {
                return { rows: [], rowCount: 0 };
            }
            row.status = 'inactive';
            row.revision = parameters[5];
            return { rows: [], rowCount: 1 };
        }
        if (compact.includes('FROM company_external_identities')) {
            let rows = state.identities;
            if (compact.includes("status = 'active'")) rows = rows.filter(({ status }) => status === 'active');
            if (compact.includes('identity_id = ANY')) {
                rows = rows.filter(({ identity_id: id }) => parameters[1].includes(id));
            } else {
                rows = rows.filter(({ membership_id: id }) => parameters[1].includes(id));
            }
            return { rows: clone(rows), rowCount: rows.length };
        }
        if (compact.startsWith('UPDATE company_external_identities')) {
            const rows = state.identities.filter(({ identity_id: id, status }) =>
                parameters[1].includes(id) && status === 'active');
            rows.forEach((row) => { row.status = 'revoked'; });
            return { rows: [], rowCount: rows.length };
        }
        if (compact.includes('FROM company_authority_bindings')) {
            let rows = state.bindings;
            if (compact.includes("status = 'active'")) rows = rows.filter(({ status }) => status === 'active');
            if (compact.includes('binding_id = ANY')) {
                rows = rows.filter(({ binding_id: id }) => parameters[1].includes(id));
            } else {
                rows = rows.filter(({ membership_id: id }) => parameters[1].includes(id));
            }
            return { rows: clone(rows), rowCount: rows.length };
        }
        if (compact.startsWith('UPDATE company_authority_bindings')) {
            const rows = state.bindings.filter(({ binding_id: id, status }) =>
                parameters[1].includes(id) && status === 'active');
            rows.forEach((row) => { row.status = 'revoked'; });
            return { rows: [], rowCount: rows.length };
        }
        if (compact.includes('resolve_company_authority_route')) {
            const active = state.identities.some((identity) =>
                identity.status === 'active'
                && identity.provider === parameters[0]
                && identity.authenticated_subject_id === parameters[1]
                && identity.workspace_id === parameters[2]
                && identity.app_id === parameters[3]
                && identity.project_id === parameters[4]
                && state.memberships.some((membership) =>
                    membership.membership_id === identity.membership_id && membership.status === 'active'));
            return { rows: active ? [{ tenant_id: tenantId, connection_id: 'wsc_unson' }] : [], rowCount: active ? 1 : 0 };
        }
        throw new Error(`unexpected query: ${compact}`);
    };
    return { query, state, queries };
}

describe('company authority retirement', () => {
    it('normalizes an exact manifest and rejects hidden scope or secret material', () => {
        expect(normalizeCompanyAuthorityRetirementManifest(manifest()).active_bindings).toHaveLength(1);
        expect(() => normalizeCompanyAuthorityRetirementManifest({
            ...manifest(), access_token: 'xoxb-not-allowed'
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeCompanyAuthorityRetirementManifest({
            ...manifest(),
            external_identities: [{ ...manifest().external_identities[0], membership_id: 'mem_other' }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SCOPE_MISMATCH' }));
        expect(() => normalizeCompanyAuthorityRetirementManifest({
            ...manifest(),
            active_bindings: [{ ...manifest().active_bindings[0], project_id: 'prj_other' }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SCOPE_MISMATCH' }));
    });

    it('requires explicit apply approval and actor', () => {
        expect(() => parseRetireCompanyAuthorityArgs([
            '--apply', '--manifest', 'manifest.json', '--idempotency-key', 'retire-001'
        ], {})).toThrowError(expect.objectContaining({ code: 'APPLY_APPROVAL_REQUIRED' }));
        expect(() => parseRetireCompanyAuthorityArgs([
            '--apply', '--approve-apply', '--manifest', 'manifest.json', '--idempotency-key', 'retire-001'
        ], {})).toThrowError(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
        expect(parseRetireCompanyAuthorityArgs([
            '--apply', '--approve-apply', '--manifest', 'manifest.json', '--idempotency-key', 'retire-001'
        ], { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' })).toMatchObject({
            mode: 'apply', actorId: 'operator-keigo'
        });
    });

    it('executes the full retirement and route check but rolls a dry-run back', async () => {
        const client = fakeClient();
        const result = await retireCompanyAuthority({
            client, manifest: manifest(), idempotencyKey: 'retire-001', actorId: 'dry-run', commit: false
        });
        expect(result).toMatchObject({
            persisted: false,
            transaction_readback: {
                runtime_routes: [
                    { identity_id: 'idn_sato_techknight', route_count: 0 },
                    { identity_id: 'idn_umeda_techknight', route_count: 0 }
                ]
            }
        });
        expect(client.state.memberships.every(({ status }) => status === 'active')).toBe(true);
        expect(client.state.identities.every(({ status }) => status === 'active')).toBe(true);
        expect(client.state.bindings.every(({ status }) => status === 'active')).toBe(true);
        expect(client.state.operations).toHaveLength(0);
    });

    it('commits atomically, reads back the retired state, and replays without new writes', async () => {
        const client = fakeClient();
        const first = await retireCompanyAuthority({
            client, manifest: manifest(), idempotencyKey: 'retire-001', actorId: 'operator-keigo', commit: true
        });
        expect(first).toMatchObject({ persisted: true, replayed: false, receipt: { runtime_route_count: 0 } });
        expect(client.state.memberships.map(({ status }) => status)).toEqual(['inactive', 'inactive']);
        expect(client.state.identities.map(({ status }) => status)).toEqual(['revoked', 'revoked']);
        expect(client.state.bindings.map(({ status }) => status)).toEqual(['revoked']);
        expect(client.state.operations).toHaveLength(1);
        await expect(readbackCompanyAuthorityRetirement({
            client, manifest: manifest(), idempotencyKey: 'retire-001'
        }))
            .resolves.toMatchObject({
                runtime_routes: expect.arrayContaining([expect.objectContaining({ route_count: 0 })]),
                operation: { status: 'applied', receipt: { outcome: 'succeeded' } }
            });

        const replay = await retireCompanyAuthority({
            client, manifest: manifest(), idempotencyKey: 'retire-001', actorId: 'operator-keigo', commit: true
        });
        expect(replay).toMatchObject({ persisted: true, replayed: true });
        expect(client.state.operations).toHaveLength(1);
    });

    it('fails a separate readback when the committed ledger receipt is missing', async () => {
        const client = fakeClient();
        await retireCompanyAuthority({
            client, manifest: manifest(), idempotencyKey: 'retire-001', actorId: 'operator-keigo', commit: true
        });
        client.state.operations = [];
        await expect(readbackCompanyAuthorityRetirement({
            client, manifest: manifest(), idempotencyKey: 'retire-001'
        })).rejects.toMatchObject({ code: 'RETIREMENT_LEDGER_READBACK_FAILED' });
    });

    it('fails closed and rolls back when an undeclared active identity shares a target membership', async () => {
        const client = fakeClient();
        client.state.identities.push({
            ...client.state.identities[0], identity_id: 'idn_undeclared', authenticated_subject_id: 'U_OTHER'
        });
        await expect(retireCompanyAuthority({
            client, manifest: manifest(), idempotencyKey: 'retire-001', actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'ACTIVE_IDENTITY_SET_MISMATCH' });
        expect(client.state.memberships.every(({ status }) => status === 'active')).toBe(true);
        expect(client.state.identities.every(({ status }) => status === 'active')).toBe(true);
        expect(client.state.operations).toHaveLength(0);
    });
});
