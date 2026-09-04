#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'server/sql/company-authority-schema.sql');
const MIGRATION_ID = 'company-authority-schema.v2';
const LOCK_NAME = 'brainbase:company-authority-schema:v2';
const TABLES = ['company_external_identities', 'company_authority_bindings'];

export class CompanyAuthorityMigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CompanyAuthorityMigrationError';
        this.code = code;
    }
}

export function parseCompanyAuthorityMigrationArgs(argv = [], env = process.env) {
    const modes = ['dry-run', 'check', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) {
        throw new CompanyAuthorityMigrationError(
            'ARGUMENT_INVALID',
            'Specify exactly one of --dry-run, --check, or --apply'
        );
    }
    const allowed = new Set([`--${modes[0]}`]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    if (argv.some((value) => !allowed.has(value))) {
        throw new CompanyAuthorityMigrationError('ARGUMENT_INVALID', 'Unsupported migration argument');
    }
    if (modes[0] === 'apply' && !argv.includes('--approve-apply')) {
        throw new CompanyAuthorityMigrationError(
            'APPLY_APPROVAL_REQUIRED',
            'Company authority schema apply requires --approve-apply'
        );
    }
    if (modes[0] === 'apply' && !String(env.BRAINBASE_MIGRATION_ACTOR ?? '').trim()) {
        throw new CompanyAuthorityMigrationError(
            'MIGRATION_ACTOR_REQUIRED',
            'BRAINBASE_MIGRATION_ACTOR is required for apply'
        );
    }
    return { mode: modes[0] };
}

async function readback(client, schemaHash) {
    const tableResult = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::TEXT[])
          ORDER BY table_name`,
        [TABLES]
    );
    const present = new Set(tableResult.rows.map((row) => row.table_name));
    const missing = TABLES.filter((table) => !present.has(table));
    if (missing.length > 0) {
        throw new CompanyAuthorityMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Missing company authority tables: ${missing.join(', ')}`
        );
    }

    const rlsResult = await client.query(
        `SELECT table_class.relname AS table_name,
                table_class.relrowsecurity,
                table_class.relforcerowsecurity
           FROM pg_class AS table_class
           JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
          WHERE namespace.nspname = current_schema()
            AND table_class.relname = ANY($1::TEXT[])`,
        [TABLES]
    );
    const rlsByTable = new Map(rlsResult.rows.map((row) => [row.table_name, row]));
    const unsafe = TABLES.filter((table) => {
        const row = rlsByTable.get(table);
        return !row || row.relrowsecurity !== true || row.relforcerowsecurity !== true;
    });
    if (unsafe.length > 0) {
        throw new CompanyAuthorityMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Company authority RLS is incomplete: ${unsafe.join(', ')}`
        );
    }

    const policyResult = await client.query(
        `SELECT DISTINCT tablename AS table_name
           FROM pg_policies
          WHERE schemaname = current_schema()
            AND tablename = ANY($1::TEXT[])`,
        [TABLES]
    );
    const policies = new Set(policyResult.rows.map((row) => row.table_name));
    const missingPolicies = TABLES.filter((table) => !policies.has(table));
    if (missingPolicies.length > 0) {
        throw new CompanyAuthorityMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Company authority policies are incomplete: ${missingPolicies.join(', ')}`
        );
    }

    const routeFunction = await client.query(
        `SELECT to_regprocedure('public.resolve_company_authority_route(text,text,text,text,text,text)')::TEXT AS signature`
    );
    if (!routeFunction.rows[0]?.signature) {
        throw new CompanyAuthorityMigrationError(
            'SCHEMA_READBACK_FAILED',
            'Company authority route resolver function is missing'
        );
    }

    const ledger = await client.query(
        `SELECT schema_sha256
           FROM brainbase_schema_migrations
          WHERE migration_id = $1`,
        [MIGRATION_ID]
    );
    if (ledger.rows[0]?.schema_sha256 !== schemaHash) {
        throw new CompanyAuthorityMigrationError(
            'SCHEMA_VERSION_MISMATCH',
            'Company authority schema ledger does not match repository SQL'
        );
    }
    return {
        table_count: TABLES.length,
        rls_table_count: TABLES.length,
        route_function_count: 1,
        ledger_matches: true
    };
}

export async function runCompanyAuthoritySchemaMigration({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null
} = {}) {
    const { mode } = parseCompanyAuthorityMigrationArgs(argv, env);
    const sql = await readFile(SCHEMA_PATH, 'utf8');
    const schemaHash = createHash('sha256').update(sql).digest('hex');
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new CompanyAuthorityMigrationError(
            'DATABASE_CONFIG_REQUIRED',
            'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }

    let client;
    let transactionStarted = false;
    try {
        client = await activePool.connect();
        if (mode === 'check') {
            return {
                ok: true,
                mode,
                migration_id: MIGRATION_ID,
                schema_sha256: schemaHash,
                persisted: true,
                readback: await readback(client, schemaHash)
            };
        }

        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '120s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [LOCK_NAME]);
        await client.query(sql);
        await client.query(
            `INSERT INTO brainbase_schema_migrations (
                migration_id, schema_sha256, applied_at, applied_by
             ) VALUES ($1, $2, now(), $3)
             ON CONFLICT (migration_id) DO UPDATE
                 SET schema_sha256 = EXCLUDED.schema_sha256,
                     applied_at = EXCLUDED.applied_at,
                     applied_by = EXCLUDED.applied_by`,
            [
                MIGRATION_ID,
                schemaHash,
                mode === 'apply' ? String(env.BRAINBASE_MIGRATION_ACTOR).trim() : 'dry-run'
            ]
        );
        const result = await readback(client, schemaHash);
        if (mode === 'dry-run') {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return {
                ok: true,
                mode,
                migration_id: MIGRATION_ID,
                schema_sha256: schemaHash,
                persisted: false,
                readback: result
            };
        }
        await client.query('COMMIT');
        transactionStarted = false;
        return {
            ok: true,
            mode,
            migration_id: MIGRATION_ID,
            schema_sha256: schemaHash,
            persisted: true,
            readback: result
        };
    } catch (error) {
        if (transactionStarted && client) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the primary error.
            }
        }
        throw error;
    } finally {
        client?.release();
        if (!pool) await activePool.end();
    }
}

async function main() {
    try {
        const result = await runCompanyAuthoritySchemaMigration();
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({
            ok: false,
            code: error.code ?? 'COMPANY_AUTHORITY_MIGRATION_FAILED',
            message: error.message
        })}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
