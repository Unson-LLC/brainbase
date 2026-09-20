#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'server/sql/authenticated-tenant-access-resolver.sql');
const MIGRATION_ID = 'authenticated-tenant-access-resolver.v2';
const LOCK_NAME = `brainbase:${MIGRATION_ID}`;
const FUNCTION_SIGNATURE = 'public.resolve_active_tenant_for_authenticated_access(text,text,text,text)';

async function readback(client, sha256) {
    const result = await client.query(
        `SELECT procedure.prosecdef,
                procedure.proconfig,
                owner.rolname AS owner_name,
                owner.rolsuper AS owner_is_superuser,
                owner.rolbypassrls AS owner_bypasses_rls,
                owner.rolcanlogin AS owner_can_login,
                app_role.oid IS NOT NULL AS app_role_exists,
                CASE WHEN app_role.oid IS NULL THEN false
                     ELSE has_function_privilege(app_role.oid, procedure.oid, 'EXECUTE')
                 END AS app_can_execute,
                NOT EXISTS (
                    SELECT 1
                      FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
                     WHERE acl.grantee = 0
                       AND acl.privilege_type = 'EXECUTE'
                ) AS public_execute_revoked
           FROM pg_proc AS procedure
           JOIN pg_roles AS owner ON owner.oid = procedure.proowner
      LEFT JOIN pg_roles AS app_role ON app_role.rolname = 'brainbase_app'
          WHERE procedure.oid = to_regprocedure($1)`,
        [FUNCTION_SIGNATURE]
    );
    const contract = result.rows[0];
    const settings = new Set(contract?.proconfig ?? []);
    if (!contract
        || contract.prosecdef !== true
        || !settings.has('search_path=pg_catalog')
        || !settings.has('row_security=off')
        || contract.owner_name !== 'brainbase_authenticated_tenant_resolver'
        || contract.owner_is_superuser === true
        || contract.owner_bypasses_rls !== true
        || contract.owner_can_login === true
        || contract.app_role_exists !== true
        || contract.app_can_execute !== true
        || contract.public_execute_revoked !== true) {
        throw new Error('Authenticated tenant resolver security contract readback failed');
    }
    const ledger = await client.query('SELECT schema_sha256 FROM brainbase_schema_migrations WHERE migration_id = $1', [MIGRATION_ID]);
    if (ledger.rows[0]?.schema_sha256 !== sha256) {
        throw new Error('Authenticated tenant resolver schema ledger readback failed');
    }
    return { security_contract_verified: true, ledger_matches: true };
}

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
            const verification = await readback(client, sha256);
            return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: sha256, persisted: true, ...verification };
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
        else {
            await client.query('COMMIT');
            transactionStarted = false;
            const verification = await readback(client, sha256);
            return { ok: true, mode, migration_id: MIGRATION_ID, schema_sha256: sha256, persisted: true, ...verification };
        }
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
