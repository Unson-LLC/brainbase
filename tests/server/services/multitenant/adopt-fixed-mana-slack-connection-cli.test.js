import { describe, expect, it } from 'vitest';

import {
    parseFixedManaSlackAdoptionArgs,
    runFixedManaSlackAdoption,
    safeFixedManaSlackAdoptionErrorCode
} from '../../../../scripts/adopt-fixed-mana-slack-connection.js';

const RAW_TOKEN = 'xoxb-cli-secret-must-not-be-printed';
const OPAQUE_REF = 'credref://bbcs/cli-opaque-reference-must-not-be-printed';

function runtimeEnv() {
    return {
        SLACK_BOT_TOKEN_UNSON: RAW_TOKEN,
        INFO_SSOT_DATABASE_URL: 'postgres://10.0.0.5/brainbase_ssot',
        BRAINBASE_FIXED_MANA_ADOPTION_DB_IDENTITY: 'lightsail-ssot',
        BRAINBASE_FIXED_MANA_ADOPTION_DB_HOST: '10.0.0.5',
        BRAINBASE_FIXED_MANA_ADOPTION_DB_NAME: 'brainbase_ssot',
        BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://credentials.unson.test/api/v1/credentials',
        BRAINBASE_FIXED_MANA_CREDENTIAL_STORE_ORIGIN: 'https://credentials.unson.test'
    };
}

function pool(kind, connects) {
    const client = {
        async query(sql) {
            if (sql.includes('current_database()')) {
                return { rows: [{ database_name: 'brainbase_ssot', server_address: '10.0.0.5', in_recovery: false }] };
            }
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith("SELECT set_config('brainbase.tenant_id'")) return { rows: [] };
            if (sql.includes('fixed_mana_slack_connection_adoption_orphans')) return { rows: [] };
            if (sql.includes('FROM brainbase_tenants')) return { rows: [{ tenant_revision: '4', status: 'active' }] };
            if (sql.includes('FROM tenant_contract_revisions AS c')) {
                return { rows: [{ contract_revision: '9', deployment_id: 'dep_01M0HMA228ES64N4TFX846V8T8', profile: 'shared_cloud' }] };
            }
            if (sql.includes('SELECT connection_id, connection_revision, status\n                   FROM workspace_connections')) return { rows: [] };
            if (sql.includes('SELECT wc.tenant_id, wc.connection_id')) return { rows: [] };
            if (sql.includes('SELECT wc.connection_id, wc.status')) {
                return { rows: [{ connection_id: 'wsc_01M0HRK94FG2Y8DMBFYJHYT14K', status: 'active', connection_revision: '1', credential_mode: 'customer_oauth' }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    return {
        async connect() { connects.push(kind); return client; },
        async end() {}
    };
}

function slackFetch() {
    return async () => ({
        ok: true,
        async json() {
            return { ok: true, team_id: 'T0882T8N9UH', team: '雲孫 事業運営', user_id: 'U0BPM8B1JTU', bot_id: 'B0BP5T7M5AT' };
        },
        headers: { get: () => 'users:read.email, chat:write, app_mentions:read, assistant:write, canvases:read, canvases:write, channels:history, channels:read, chat:write.customize, commands, files:read, files:write, groups:history, groups:read, im:history, im:read, im:write, mpim:history, mpim:read, mpim:write, reactions:read, reactions:write, users:read' }
    });
}

describe('fixed Mana Slack adoption CLI', () => {
    it('permits only the fixed modes and requires an explicit Lightsail SSOT target for DB access', () => {
        expect(parseFixedManaSlackAdoptionArgs(['--dry-run'])).toEqual({ mode: 'dry-run', approved: false });
        expect(parseFixedManaSlackAdoptionArgs(['--check', '--production-db=lightsail-ssot'])).toEqual({ mode: 'check', approved: false });
        expect(parseFixedManaSlackAdoptionArgs(['--apply', '--approve-apply', '--production-db=lightsail-ssot'])).toEqual({ mode: 'apply', approved: true });
        expect(() => parseFixedManaSlackAdoptionArgs(['--apply', '--tenant=other'])).toThrow(/FIXED_MANA_SLACK_ADOPTION_ARGS_INVALID/u);
    });

    it('uses a distinct secondary pool for post-commit readback and returns no token or opaque reference', async () => {
        const connects = [];
        const credentialStore = {
            store: async () => ({ credential_ref: OPAQUE_REF, credential_mode: 'customer_oauth', refresh_revision: '1' }),
            verify: async () => ({ valid: true }),
            revoke: async () => ({ status: 'revoked' })
        };
        const result = await runFixedManaSlackAdoption({
            argv: ['--apply', '--approve-apply', '--production-db=lightsail-ssot'], env: runtimeEnv(),
            primaryPool: pool('primary', connects), readbackPool: pool('readback', connects),
            credentialStore, fetchImpl: slackFetch()
        });

        expect(result).toMatchObject({ state: 'adopted', production_database_identity: 'lightsail-ssot' });
        expect(connects).toContain('primary');
        expect(connects).toContain('readback');
        expect(JSON.stringify(result)).not.toContain(RAW_TOKEN);
        expect(JSON.stringify(result)).not.toContain(OPAQUE_REF);
    });

    it('formats CLI failures as a code only, never the upstream message', () => {
        const stderr = `${safeFixedManaSlackAdoptionErrorCode({ code: 'UPSTREAM_UNAVAILABLE', message: `${RAW_TOKEN} ${OPAQUE_REF}` })}\n`;
        expect(stderr).toBe('UPSTREAM_UNAVAILABLE\n');
        expect(stderr).not.toContain(RAW_TOKEN);
        expect(stderr).not.toContain(OPAQUE_REF);
        expect(safeFixedManaSlackAdoptionErrorCode({ code: 'unsafe-code!', message: RAW_TOKEN })).toBe('FIXED_MANA_SLACK_ADOPTION_FAILED');
    });

    it('rejects an unpinned credential-store origin and noncanonical loopback database URL before it can send the token', async () => {
        const untrustedStore = { ...runtimeEnv(), BRAINBASE_TENANT_CREDENTIAL_STORE_URL: 'https://attacker.test/api/v1/credentials' };
        let fetchCalls = 0;
        await expect(runFixedManaSlackAdoption({
            argv: ['--check', '--production-db=lightsail-ssot'], env: untrustedStore, primaryPool: pool('primary', []), readbackPool: pool('readback', []),
            fetchImpl: async () => { fetchCalls += 1; throw new Error('must not send token'); }
        })).rejects.toMatchObject({ code: 'FIXED_MANA_CREDENTIAL_STORE_ORIGIN_REQUIRED' });
        expect(fetchCalls).toBe(0);

        const localDatabase = { ...runtimeEnv(), INFO_SSOT_DATABASE_URL: 'postgres://127.0.0.1:5432/brainbase_ssot' };
        await expect(runFixedManaSlackAdoption({
            argv: ['--check', '--production-db=lightsail-ssot'], env: localDatabase, primaryPool: pool('primary', []), readbackPool: pool('readback', [])
        })).rejects.toMatchObject({ code: 'LIGHTSAIL_SSOT_IDENTITY_MISMATCH' });
    });
});
