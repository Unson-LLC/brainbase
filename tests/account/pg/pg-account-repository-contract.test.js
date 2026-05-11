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
        expect(pg.calls[0].params).toContain(JSON.stringify(account.credential_ref));
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
});
