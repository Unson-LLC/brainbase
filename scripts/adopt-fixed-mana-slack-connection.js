#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { createRemoteCredentialStore } from '../server/services/multitenant/remote-credential-store.js';
import { MultitenantPostgresRepository } from '../server/services/multitenant/postgres-repository.js';
import { FixedManaSlackConnectionAdoptionService } from '../server/services/multitenant/slack-installation-adoption-service.js';

const PRODUCTION_DB_IDENTITY = 'lightsail-ssot';

export class FixedManaSlackAdoptionCliError extends Error {
    constructor(code) {
        super(code);
        this.name = 'FixedManaSlackAdoptionCliError';
        this.code = code;
    }
}

function fail(code) {
    throw new FixedManaSlackAdoptionCliError(code);
}

export function safeFixedManaSlackAdoptionErrorCode(error) {
    return typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : 'FIXED_MANA_SLACK_ADOPTION_FAILED';
}

export function parseFixedManaSlackAdoptionArgs(argv) {
    const values = [...argv];
    if (values.length === 1 && values[0] === '--dry-run') return { mode: 'dry-run', approved: false };
    if (values.length === 2 && values.includes('--check') && values.includes('--production-db=lightsail-ssot')) {
        return { mode: 'check', approved: false };
    }
    if (values.length === 3 && values.includes('--apply') && values.includes('--approve-apply')
        && values.includes('--production-db=lightsail-ssot')) {
        return { mode: 'apply', approved: true };
    }
    fail('FIXED_MANA_SLACK_ADOPTION_ARGS_INVALID');
}

function requiredRuntime(env) {
    const botToken = env.SLACK_BOT_TOKEN_UNSON;
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    if (typeof botToken !== 'string' || botToken.length === 0) fail('SLACK_BOT_TOKEN_UNSON_REQUIRED');
    if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) fail('INFO_SSOT_DATABASE_URL_REQUIRED');
    if (env.BRAINBASE_FIXED_MANA_ADOPTION_DB_IDENTITY !== PRODUCTION_DB_IDENTITY) {
        fail('LIGHTSAIL_SSOT_IDENTITY_REQUIRED');
    }
    const database = fixedProductionDatabaseUrl(databaseUrl, env);
    return { botToken, databaseUrl, database, credentialStoreEnv: fixedCredentialStoreEnv(env) };
}

function fixedCredentialStoreEnv(env) {
    const value = env.BRAINBASE_TENANT_CREDENTIAL_STORE_URL || env.BRAINBASE_SLACK_CREDENTIAL_STORE_URL;
    const expectedOrigin = env.BRAINBASE_FIXED_MANA_CREDENTIAL_STORE_ORIGIN;
    let endpoint;
    try {
        endpoint = new URL(value);
    } catch {
        fail('FIXED_MANA_CREDENTIAL_STORE_ORIGIN_REQUIRED');
    }
    if (typeof expectedOrigin !== 'string' || endpoint.origin !== expectedOrigin
        || endpoint.protocol !== 'https:' || endpoint.pathname !== '/api/v1/credentials'
        || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
        fail('FIXED_MANA_CREDENTIAL_STORE_ORIGIN_REQUIRED');
    }
    // Pin both legacy aliases to the same checked endpoint before delegating
    // to the generic broker client; no unvalidated alternate URL can win.
    return {
        ...env,
        BRAINBASE_TENANT_CREDENTIAL_STORE_URL: endpoint.toString(),
        BRAINBASE_SLACK_CREDENTIAL_STORE_URL: endpoint.toString()
    };
}

function fixedProductionDatabaseUrl(databaseUrl, env) {
    let endpoint;
    try {
        endpoint = new URL(databaseUrl);
    } catch {
        fail('LIGHTSAIL_SSOT_IDENTITY_MISMATCH');
    }
    const expectedHost = env.BRAINBASE_FIXED_MANA_ADOPTION_DB_HOST;
    const expectedDatabase = env.BRAINBASE_FIXED_MANA_ADOPTION_DB_NAME;
    const databaseName = endpoint.pathname.replace(/^\//u, '');
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
    // The production control-plane may use only its named local tunnel port;
    // other loopback URLs are rejected rather than silently targeting a Mac DB.
    const canonicalTunnel = loopback && endpoint.port === '25432';
    const directProductionHost = !loopback && endpoint.hostname === expectedHost;
    if (typeof expectedHost !== 'string' || expectedHost.length === 0
        || typeof expectedDatabase !== 'string' || expectedDatabase.length === 0
        || endpoint.protocol !== 'postgres:' && endpoint.protocol !== 'postgresql:'
        || databaseName !== expectedDatabase || (!canonicalTunnel && !directProductionHost)) {
        fail('LIGHTSAIL_SSOT_IDENTITY_MISMATCH');
    }
    return { expectedHost, expectedDatabase };
}

async function slackAuthTest({ token, fetchImpl }) {
    let response;
    try {
        response = await fetchImpl('https://slack.com/api/auth.test', {
            method: 'POST', headers: { authorization: `Bearer ${token}` }
        });
    } catch {
        fail('FIXED_MANA_SLACK_VERIFICATION_UNAVAILABLE');
    }
    let body;
    try {
        body = await response.json();
    } catch {
        fail('FIXED_MANA_SLACK_VERIFICATION_UNAVAILABLE');
    }
    if (!response.ok || body?.ok !== true) fail('FIXED_MANA_SLACK_VERIFICATION_UNAVAILABLE');
    const rawScopes = response.headers?.get?.('x-oauth-scopes');
    if (typeof rawScopes !== 'string' || rawScopes.length === 0) fail('FIXED_MANA_SLACK_VERIFICATION_UNAVAILABLE');
    return { body, scopes: rawScopes.split(',').map((scope) => scope.trim()).filter(Boolean) };
}

function fixedSlackVerifier({ botToken, fetchImpl }) {
    return {
        async authTest() {
            return (await slackAuthTest({ token: botToken, fetchImpl })).body;
        },
        async listScopes() {
            return (await slackAuthTest({ token: botToken, fetchImpl })).scopes;
        }
    };
}

async function verifyProductionDatabaseIdentity(pool, database) {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query(
            'SELECT current_database() AS database_name, inet_server_addr()::text AS server_address, pg_is_in_recovery() AS in_recovery'
        );
        const row = result.rows[0];
        if (row?.database_name !== database.expectedDatabase
            || row?.server_address !== database.expectedHost || row.in_recovery === true) {
            fail('LIGHTSAIL_SSOT_IDENTITY_MISMATCH');
        }
    } catch (error) {
        if (error instanceof FixedManaSlackAdoptionCliError) throw error;
        fail('LIGHTSAIL_SSOT_IDENTITY_MISMATCH');
    } finally {
        client?.release();
    }
}

export async function runFixedManaSlackAdoption({
    argv = process.argv.slice(2), env = process.env, primaryPool = null, readbackPool = null,
    credentialStore = null, fetchImpl = globalThis.fetch
} = {}) {
    const { mode, approved } = parseFixedManaSlackAdoptionArgs(argv);
    if (mode === 'dry-run') {
        return {
            state: 'dry_run',
            target: 'fixed_mana_slack_connection',
            production_database_identity: PRODUCTION_DB_IDENTITY
        };
    }
    const runtime = requiredRuntime(env);
    const ownPrimaryPool = !primaryPool;
    const ownReadbackPool = !readbackPool;
    const primary = primaryPool ?? new Pool({ connectionString: runtime.databaseUrl });
    const secondary = readbackPool ?? new Pool({ connectionString: runtime.databaseUrl });
    try {
        // The marker is injected alongside INFO_SSOT_DATABASE_URL and this
        // live query proves the process reached a non-replica PostgreSQL host.
        // The second Pool is intentionally distinct from the write repository.
        await verifyProductionDatabaseIdentity(primary, runtime.database);
        const writeRepository = new MultitenantPostgresRepository({ pool: primary });
        const readRepository = new MultitenantPostgresRepository({ pool: secondary });
        const service = new FixedManaSlackConnectionAdoptionService({
            repository: writeRepository,
            slack: fixedSlackVerifier({ botToken: runtime.botToken, fetchImpl }),
            credentialStore: credentialStore ?? createRemoteCredentialStore({ env: runtime.credentialStoreEnv, fetchImpl }),
            botToken: runtime.botToken,
            readback: (input) => readRepository.readFixedManaSlackConnection(input)
        });
        const result = await service.execute({ mode, approved });
        return { ...result, production_database_identity: PRODUCTION_DB_IDENTITY };
    } finally {
        if (ownPrimaryPool) await primary.end();
        if (ownReadbackPool) await secondary.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runFixedManaSlackAdoption()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            // Never serialize Error.message: upstream drivers and SDKs may
            // include bearer material or credential references in it.
            process.stderr.write(`${safeFixedManaSlackAdoptionErrorCode(error)}\n`);
            process.exitCode = 1;
        });
}
