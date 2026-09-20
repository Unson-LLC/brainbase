#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'server/sql/authenticated-tenant-access-resolver.sql');
const MIGRATION_ID = 'authenticated-tenant-access-resolver.v1';
const LOCK_NAME = `brainbase:${MIGRATION_ID}`;

export async function runAuthenticatedTenantAccessResolverMigration({ argv = process.argv.slice(2), env = process.env, pool = null } = {}) {
    const modes = ['dry-run', 'check', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1 || (modes[0] === 'apply' && !argv.includes('--approve-apply'))) {
        throw new Error('Specify exactly one mode; apply also requires --approve-apply');
    }
    const mode = modes[0];
    const actor = String(env.BRAINBASE_MIGRATION_ACTOR ?? '').trim();
    if (mode === 'apply' && !actor) throw new Error('BRAINBASE_MIGRATION_ACTOR is required for apply');
    const sql = await readFile(SQL_PATH, 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required');
    let client;
    let transactionStarted = false;
    try {
        client = await activePool.connect();
        if (mode === 'check') {
            const ledger = await client.query('SELECT schema_sha256 FROM brainbase_schema_migrations WHERE migration_id = $1', [MIGRATION_ID]);
            const fn = await client.query("SELECT to_regprocedure('public.resolve_active_tenant_for_authenticated_access(text,text,text,text)') IS NOT NULL AS present");
            if (ledger.rows[0]?.schema_sha256 !== sha256 || fn.rows[0]?.present !== true) throw new Error('Authenticated tenant resolver readback failed');
            return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: sha256, persisted: true };
        }
        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [LOCK_NAME]);
        await client.query(sql);
        await client.query(`INSERT INTO brainbase_schema_migrations (migration_id, schema_sha256, applied_at, applied_by)
            VALUES ($1, $2, now(), $3) ON CONFLICT (migration_id) DO UPDATE
            SET schema_sha256 = EXCLUDED.schema_sha256, applied_at = EXCLUDED.applied_at, applied_by = EXCLUDED.applied_by`,
        [MIGRATION_ID, sha256, mode === 'apply' ? actor : 'dry-run']);
        if (mode === 'dry-run') await client.query('ROLLBACK');
        else await client.query('COMMIT');
        transactionStarted = false;
        return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: sha256, persisted: mode === 'apply' };
    } catch (error) {
        if (transactionStarted && client) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client?.release();
        if (!pool) await activePool.end();
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    runAuthenticatedTenantAccessResolverMigration().then((result) => console.log(JSON.stringify(result))).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
