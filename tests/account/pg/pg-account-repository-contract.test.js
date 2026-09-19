// @ts-check
import { describe, it, expect } from 'vitest';
import {
    PgAccountRepository,
    CredentialSecretLeakError
} from '../../../server/services/account/account-repository.js';
import { personalAccountInput } from '../_helpers.js';

class ScriptedPg {
    constructor(responses = []) {
        this.responses = responses;
        this.calls = [];
    }

    async query(sql, params = []) {
        this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        const next = this.responses.shift();
        if (!next) return { rows: [] };
        if (next.error) throw next.error;
        return { rows: next.rows || [] };
    }
}

const accountRow = (overrides = {}) => ({
    id: 'acc_pg_1',
    service: 'x',
    scope_type: 'personal',
    owner_person_id: 'sato_keigo',
    org_id: null,
    project_id: null,
    display_name: 'sato @ X corp',
    external_account_id: 'X-123',
    external_handle: null,
    credential_ref: { provider: 'infisical', path: '/integrations/x/sato-corp', version: 'v1' },
    oauth_client_ref: null,
    status: 'connected',
    capabilities: ['post', 'read'],
    rate_limit_profile_id: null,
    metadata: {},
    created_by_person_id: 'sato_keigo',
    updated_by_person_id: null,
    created_at: new Date('2026-05-11T00:00:00.000Z'),
    updated_at: new Date('2026-05-11T00:00:00.000Z'),
    last_verified_at: null,
    ...overrides
});

describe('PgAccountRepository contract', () => {
    it('creates account rows without materializing credential secrets', async () => {
        const pg = new ScriptedPg([{ rows: [accountRow()] }]);
        const repo = new PgAccountRepository({ pool: pg });
        const account = await repo.create(personalAccountInput({
            id: 'acc_pg_1',
            created_by_person_id: 'sato_keigo'
        }));

        expect(account.created_at).toBe('2026-05-11T00:00:00.000Z');
        expect(account.credential_ref.path).toBe('/integrations/x/sato-corp');
        expect(pg.calls[0].sql).toContain('INSERT INTO integration_accounts');
        expect(pg.calls[0].params).toHaveLength(17);
        expect(pg.calls[0].params).toContain(JSON.stringify(account.credential_ref));
        expect(pg.calls[0].params[14]).toBe('{}');
        expect(pg.calls[0].params[15]).toBe('sato_keigo');
        expect(pg.calls[0].params[16]).toBeNull();
        expect(pg.calls[0].params.join(' ')).not.toContain('access_token');
    });

    it('maps database credential guard violations to CredentialSecretLeakError', async () => {
        const pg = new ScriptedPg([
            { error: new Error('credential_ref must not contain secret key: access_token') }
        ]);
        const repo = new PgAccountRepository({ pool: pg });
        await expect(repo.create(personalAccountInput({
            created_by_person_id: 'sato_keigo',
            credential_ref: { provider: 'infisical', path: '/x' }
        }))).rejects.toBeInstanceOf(CredentialSecretLeakError);
    });

    it('replaces defaults inside a transaction', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [{ id: 'acc_pg_1' }] },
            {},
            { rows: [{ subject_type: 'person', subject_id: 'sato_keigo', service: 'x', purpose: 'post', account_id: 'acc_pg_1', priority: 100 }] },
            {}
        ]);
        const repo = new PgAccountRepository({ pool: pg });
        const result = await repo.setDefault({
            subject_type: 'person',
            subject_id: 'sato_keigo',
            service: 'x',
            purpose: 'post',
            account_id: 'acc_pg_1',
            created_by_person_id: 'sato_keigo'
        });

        expect(result.account_id).toBe('acc_pg_1');
        expect(pg.calls.map((c) => c.sql)).toEqual(expect.arrayContaining([
            'BEGIN',
            'COMMIT'
        ]));
        expect(pg.calls.some((c) => c.sql.startsWith('DELETE FROM integration_account_defaults'))).toBe(true);
    });

    it('binds an account to one tenant transactionally and writes an audit event', async () => {
        const binding = {
            tenant_id: 'tenant_unson',
            account_id: 'acc_pg_1',
            created_by_person_id: 'sato_keigo',
            created_at: new Date('2026-09-18T00:00:00.000Z')
        };
        const pg = new ScriptedPg([
            {}, // BEGIN
            { rows: [{ id: 'acc_pg_1' }] },
            { rows: [] },
            { rows: [binding] },
            {}, // audit insert
            {} // COMMIT
        ]);
        const repo = new PgAccountRepository({ pool: pg });

        await expect(repo.bindTenant({
            tenant_id: 'tenant_unson',
            account_id: 'acc_pg_1',
            created_by_person_id: 'sato_keigo'
        })).resolves.toMatchObject({
            tenant_id: 'tenant_unson',
            account_id: 'acc_pg_1'
        });

        expect(pg.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
            'BEGIN',
            'COMMIT'
        ]));
        expect(pg.calls.some((call) => call.sql.includes('INSERT INTO integration_account_tenants'))).toBe(true);
        expect(pg.calls.some((call) => call.sql.includes("'TENANT_BOUND'"))).toBe(true);
    });

    it('maps missing accounts to AccountValidationError instead of leaking a raw FK failure', async () => {
        const pg = new ScriptedPg([
            {},
            { rows: [] },
            {}
        ]);
        const repo = new PgAccountRepository({ pool: pg });

        await expect(repo.bindTenant({
            tenant_id: 'tenant_unson',
            account_id: 'missing',
            created_by_person_id: 'sato_keigo'
        })).rejects.toMatchObject({
            name: 'AccountValidationError',
            message: 'account not found for tenant binding'
        });
        expect(pg.calls.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('checks tenant ownership through the tenant-binding table', async () => {
        const pg = new ScriptedPg([{ rows: [{ '?column?': 1 }] }]);
        const repo = new PgAccountRepository({ pool: pg });

        await expect(repo.isBoundToTenant('tenant_unson', 'acc_pg_1')).resolves.toBe(true);
        expect(pg.calls[0].sql).toContain('SELECT 1 FROM integration_account_tenants');
        expect(pg.calls[0].params).toEqual(['tenant_unson', 'acc_pg_1']);
    });

    it('enumerates defaults with deterministic priority and C-collated account-id ordering', async () => {
        const rows = [
            { subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read', account_id: 'acc_A', priority: 100 },
            { subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read', account_id: 'acc_a', priority: 100 }
        ];
        const pg = new ScriptedPg([{ rows }]);
        const repo = new PgAccountRepository({ pool: pg });

        await expect(repo.listDefaults('org', 'org_a', 'freee', 'runtime_read')).resolves.toEqual(rows);
        expect(pg.calls[0].sql).toContain('ORDER BY priority ASC, account_id COLLATE "C" ASC');
    });
});
