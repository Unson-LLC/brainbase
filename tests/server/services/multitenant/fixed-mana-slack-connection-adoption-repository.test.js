import { describe, expect, it } from 'vitest';

import { MultitenantPostgresRepository } from '../../../../server/services/multitenant/postgres-repository.js';
import { FIXED_MANA_SLACK_CONNECTION } from '../../../../server/services/multitenant/slack-installation-adoption-service.js';

const OPAQUE_REF = 'credref://bbcs/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const NOW = '2026-09-05T00:00:00.000Z';

function exactSnapshot() {
    return {
        ...FIXED_MANA_SLACK_CONNECTION,
        granted_scopes: [...FIXED_MANA_SLACK_CONNECTION.required_scopes],
        credential_ref: OPAQUE_REF,
        credential_mode: 'customer_oauth',
        refresh_revision: '1',
        status: 'active'
    };
}

function transactionalPool({ failWrite = null, currentRows = [], orphanRows = [], readRows = [] } = {}) {
    const calls = [];
    const committed = [];
    const staged = [];
    const client = {
        async query(sql, values = []) {
            calls.push({ sql, values });
            if (sql === 'BEGIN' || sql.startsWith("SELECT set_config('brainbase.tenant_id'")) return { rows: [] };
            if (sql === 'COMMIT') {
                committed.push(...staged);
                staged.length = 0;
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                staged.length = 0;
                return { rows: [] };
            }
            if (sql.includes('FROM fixed_mana_slack_connection_adoption_orphans')) return { rows: orphanRows };
            if (sql.includes('FROM brainbase_tenants')) return { rows: [{ tenant_revision: '4', status: 'active' }] };
            if (sql.includes('FROM tenant_contract_revisions AS c')) {
                return { rows: [{ contract_revision: '9', deployment_id: 'dep_01M0HMA228ES64N4TFX846V8T8', profile: 'shared_cloud' }] };
            }
            if (sql.includes('SELECT connection_id, connection_revision, status\n                   FROM workspace_connections')) {
                return { rows: currentRows };
            }
            if (sql.includes('SELECT wc.tenant_id, wc.connection_id')) return { rows: currentRows };
            if (sql.includes('SELECT wc.connection_id, wc.status')) return { rows: readRows };
            const write = sql.includes('INSERT INTO workspace_connection_revisions') ? 'revision'
                : sql.includes('INSERT INTO workspace_connections') ? 'connection'
                    : sql.includes('INSERT INTO credential_broker_refs') ? 'broker'
                        : sql.includes('INSERT INTO fixed_mana_slack_connection_adoption_orphans') ? 'orphan'
                            : null;
            if (write) {
                if (write === failWrite) throw new Error('simulated database failure');
                staged.push(write);
            }
            return { rows: [] };
        },
        release() {}
    };
    return { pool: { connect: async () => client }, calls, committed };
}

function credential() {
    return { credential_ref: OPAQUE_REF, credential_mode: 'customer_oauth', refresh_revision: '1' };
}

describe('MultitenantPostgresRepository fixed Mana Slack adoption', () => {
    it('uses tenant-local RLS, locks competing connections, and commits revision/current/broker records together', async () => {
        const fixture = transactionalPool();
        const repository = new MultitenantPostgresRepository({ pool: fixture.pool, now: () => new Date(NOW) });

        const result = await repository.adoptFixedManaSlackConnection({
            definition: FIXED_MANA_SLACK_CONNECTION, credential: credential(), now: NOW
        });

        expect(result).toMatchObject({ connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id, status: 'active' });
        expect(JSON.stringify(result)).not.toContain(OPAQUE_REF);
        expect(fixture.committed).toEqual(['revision', 'connection', 'broker']);
        expect(fixture.calls.some(({ sql }) => sql.startsWith("SELECT set_config('brainbase.tenant_id'"))).toBe(true);
        expect(fixture.calls.find(({ sql }) => sql.includes('FROM workspace_connections\n                  WHERE'))?.sql).toContain('FOR UPDATE');
    });

    it('rolls back every staged DB record when one of the three writes fails', async () => {
        const fixture = transactionalPool({ failWrite: 'connection' });
        const repository = new MultitenantPostgresRepository({ pool: fixture.pool, now: () => new Date(NOW) });

        await expect(repository.adoptFixedManaSlackConnection({
            definition: FIXED_MANA_SLACK_CONNECTION, credential: credential(), now: NOW
        })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', status: 503 });
        expect(fixture.committed).toEqual([]);
        expect(fixture.calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    });

    it('rejects service-bypassing scope changes and all existing pending/active/reauth connections', async () => {
        const fixture = transactionalPool({ currentRows: [{
            connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
            connection_revision: '1', status: 'reauth_required'
        }] });
        const repository = new MultitenantPostgresRepository({ pool: fixture.pool, now: () => new Date(NOW) });

        await expect(repository.adoptFixedManaSlackConnection({
            definition: { ...FIXED_MANA_SLACK_CONNECTION, required_scopes: FIXED_MANA_SLACK_CONNECTION.required_scopes.slice(1) },
            credential: credential(), now: NOW
        })).rejects.toMatchObject({ code: 'FIXED_MANA_SLACK_CONNECTION_CONFLICT', status: 409 });
        await expect(repository.adoptFixedManaSlackConnection({
            definition: FIXED_MANA_SLACK_CONNECTION, credential: credential(), now: NOW
        })).rejects.toMatchObject({ code: 'FIXED_MANA_SLACK_CONNECTION_CONFLICT', status: 409 });
        expect(fixture.committed).toEqual([]);
    });

    it('treats snapshot/credential disagreement as a conflict and returns no credential reference to callers', async () => {
        const snapshot = exactSnapshot();
        const fixture = transactionalPool({ currentRows: [{
            tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
            connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
            connection_revision: '1', status: 'active', provider: 'slack',
            installation_id: FIXED_MANA_SLACK_CONNECTION.installation_id,
            workspace_id: FIXED_MANA_SLACK_CONNECTION.workspace_id,
            app_id: FIXED_MANA_SLACK_CONNECTION.app_id,
            granted_scopes: [...FIXED_MANA_SLACK_CONNECTION.required_scopes],
            current_credential_ref: OPAQUE_REF,
            credential_ref: 'credref://mismatch', credential_mode: 'customer_oauth', refresh_revision: '1',
            connection_snapshot: snapshot
        }] });
        const repository = new MultitenantPostgresRepository({ pool: fixture.pool });

        const inspection = await repository.inspectFixedManaSlackConnection({ definition: FIXED_MANA_SLACK_CONNECTION });
        expect(inspection.state).toBe('conflict');
        expect(JSON.stringify(inspection)).not.toContain(OPAQUE_REF);
    });

    it('reads the post-commit records through the repository without returning credential material', async () => {
        const fixture = transactionalPool({ readRows: [{
            connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id, status: 'active',
            connection_revision: '1', credential_mode: 'customer_oauth', credential_ref: OPAQUE_REF
        }] });
        const repository = new MultitenantPostgresRepository({ pool: fixture.pool });

        const result = await repository.readFixedManaSlackConnection({ definition: FIXED_MANA_SLACK_CONNECTION });
        expect(result).toEqual({
            connection: { connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id, status: 'active' },
            revision: { connection_revision: '1' }, credential: { credential_mode: 'customer_oauth' }
        });
        expect(JSON.stringify(result)).not.toContain(OPAQUE_REF);
        expect(fixture.calls.find(({ sql }) => sql.includes('SELECT wc.connection_id, wc.status'))?.sql).toContain('FOR SHARE');
    });
});
