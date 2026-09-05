#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'server/sql/multitenant-platform-schema.sql');
const MIGRATION_ID = 'multitenant-platform-schema.v2';
const ADVISORY_LOCK_NAME = 'brainbase:multitenant-platform-schema:v2';
const CREDENTIAL_REFRESH_REVISION_CONSTRAINT = 'credential_broker_refs_refresh_revision_check';
const QUOTA_AUTHORITY_COLUMN_TYPES = Object.freeze({
    'tenant_contract_revisions.quota_window_policy': Object.freeze({ data_type: 'jsonb', udt_name: 'jsonb' }),
    'tenant_quota_decisions.requested_value': Object.freeze({ data_type: 'numeric', udt_name: 'numeric' }),
    'tenant_quota_decisions.request_fingerprint': Object.freeze({ data_type: 'text', udt_name: 'text' })
});

class SchemaMigrationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SchemaMigrationError';
        this.code = code;
    }
}

function schemaContract(sql) {
    const tableColumns = new Map();
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)\s*\(([^;]+)\);/gis)) {
        const columns = [];
        for (const line of match[2].split('\n')) {
            const column = line.trim().match(/^([a-z][a-z0-9_]*)\s+/i)?.[1];
            if (column && !['primary', 'unique', 'foreign', 'references', 'check', 'constraint', 'and', 'or'].includes(column.toLowerCase())) {
                columns.push(column);
            }
        }
        tableColumns.set(match[1], columns);
    }
    const rlsTables = [...sql.matchAll(/ALTER TABLE\s+([a-z0-9_]+)\s+ENABLE ROW LEVEL SECURITY/gi)]
        .map((match) => match[1]);
    return {
        sha256: createHash('sha256').update(sql).digest('hex'),
        tableColumns,
        rlsTables
    };
}

function sortedMissing(expected, actual) {
    const actualSet = new Set(actual);
    return expected.filter((value) => !actualSet.has(value)).sort();
}

export function parseMultitenantSchemaMigrationArgs(argv = [], env = process.env) {
    const modes = ['dry-run', 'check', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) {
        throw new SchemaMigrationError('ARGUMENT_INVALID', 'Specify exactly one of --dry-run, --check, or --apply');
    }
    const allowed = new Set([`--${modes[0]}`]);
    if (modes[0] === 'apply') allowed.add('--approve-apply');
    const unexpected = argv.filter((value) => !allowed.has(value));
    if (unexpected.length > 0) {
        throw new SchemaMigrationError('ARGUMENT_INVALID', 'Unsupported multitenant schema migration argument');
    }
    const approved = argv.includes('--approve-apply');
    if (modes[0] === 'apply' && !approved) {
        throw new SchemaMigrationError(
            'APPLY_APPROVAL_REQUIRED',
            'Multitenant schema apply requires explicit operator approval: pass --approve-apply'
        );
    }
    if (modes[0] === 'apply' && !String(env.BRAINBASE_MIGRATION_ACTOR ?? '').trim()) {
        throw new SchemaMigrationError(
            'MIGRATION_ACTOR_REQUIRED',
            'BRAINBASE_MIGRATION_ACTOR is required for multitenant schema apply'
        );
    }
    return { mode: modes[0], approved };
}

async function readbackSchema(client, contract) {
    const tables = [...contract.tableColumns.keys()];
    const tableResult = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::text[])
          ORDER BY table_name`,
        [tables]
    );
    const presentTables = tableResult.rows.map((row) => row.table_name);
    const missingTables = sortedMissing(tables, presentTables);
    if (missingTables.length > 0) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Multitenant schema has missing tables: ${missingTables.join(', ')}`
        );
    }

    const columnResult = await client.query(
        `SELECT table_name, column_name, data_type, udt_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = ANY($1::text[])
          ORDER BY table_name, ordinal_position`,
        [tables]
    );
    const actualColumns = new Map(tables.map((table) => [table, []]));
    for (const row of columnResult.rows) actualColumns.get(row.table_name)?.push(row.column_name);
    const missingColumns = [];
    for (const [table, expected] of contract.tableColumns) {
        for (const column of sortedMissing(expected, actualColumns.get(table) ?? [])) {
            missingColumns.push(`${table}.${column}`);
        }
    }
    if (missingColumns.length > 0) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Multitenant schema has missing columns: ${missingColumns.join(', ')}`
        );
    }

    const invalidQuotaAuthorityTypes = Object.entries(QUOTA_AUTHORITY_COLUMN_TYPES)
        .filter(([qualified, expected]) => {
            const [table, column] = qualified.split('.');
            const row = columnResult.rows.find((candidate) =>
                candidate.table_name === table && candidate.column_name === column);
            return !row || row.data_type !== expected.data_type || row.udt_name !== expected.udt_name;
        })
        .map(([qualified, expected]) => `${qualified} must be ${expected.data_type}/${expected.udt_name}`);
    if (invalidQuotaAuthorityTypes.length > 0) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Multitenant schema has invalid quota authority column types: ${invalidQuotaAuthorityTypes.join(', ')}`
        );
    }

    const rlsResult = await client.query(
        `SELECT table_class.relname AS table_name,
                table_class.relrowsecurity,
                table_class.relforcerowsecurity
           FROM pg_class AS table_class
           JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
          WHERE namespace.nspname = current_schema()
            AND table_class.relname = ANY($1::text[])`,
        [contract.rlsTables]
    );
    const rlsByTable = new Map(rlsResult.rows.map((row) => [row.table_name, row]));
    const invalidRls = contract.rlsTables.filter((table) => {
        const row = rlsByTable.get(table);
        return !row || row.relrowsecurity !== true || row.relforcerowsecurity !== true;
    });
    if (invalidRls.length > 0) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Multitenant schema has missing ENABLE/FORCE RLS: ${invalidRls.join(', ')}`
        );
    }

    const policyResult = await client.query(
        `SELECT DISTINCT tablename AS table_name
           FROM pg_policies
          WHERE schemaname = current_schema()
            AND tablename = ANY($1::text[])`,
        [contract.rlsTables]
    );
    const missingPolicies = sortedMissing(
        contract.rlsTables,
        policyResult.rows.map((row) => row.table_name)
    );
    if (missingPolicies.length > 0) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            `Multitenant schema has missing RLS policies: ${missingPolicies.join(', ')}`
        );
    }

    const refreshConstraintResult = await client.query(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'credential_broker_refs'::regclass
            AND conname = $1`,
        [CREDENTIAL_REFRESH_REVISION_CONSTRAINT]
    );
    const refreshConstraint = refreshConstraintResult.rows[0]?.definition ?? '';
    if (refreshConstraintResult.rows.length !== 1
        || !/refresh_revision\s*>=\s*0/iu.test(refreshConstraint)) {
        throw new SchemaMigrationError(
            'SCHEMA_READBACK_FAILED',
            'Multitenant schema does not allow credential refresh revision zero'
        );
    }

    const ledgerResult = await client.query(
        `SELECT schema_sha256
           FROM brainbase_schema_migrations
          WHERE migration_id = $1`,
        [MIGRATION_ID]
    );
    const ledgerHash = ledgerResult.rows[0]?.schema_sha256 ?? null;
    if (ledgerHash !== contract.sha256) {
        throw new SchemaMigrationError(
            'SCHEMA_VERSION_MISMATCH',
            'Multitenant schema ledger does not match the repository schema hash'
        );
    }

    return {
        table_count: tables.length,
        column_count: [...contract.tableColumns.values()].reduce((sum, columns) => sum + columns.length, 0),
        rls_table_count: contract.rlsTables.length,
        policy_table_count: policyResult.rows.length,
        credential_refresh_revision_zero_allowed: true,
        ledger_matches: true
    };
}

async function recordSchemaVersion(client, { sha256, actor }) {
    await client.query(
        `INSERT INTO brainbase_schema_migrations (
            migration_id, schema_sha256, applied_at, applied_by
         ) VALUES ($1, $2, now(), $3)
         ON CONFLICT (migration_id) DO UPDATE
             SET schema_sha256 = EXCLUDED.schema_sha256,
                 applied_at = EXCLUDED.applied_at,
                 applied_by = EXCLUDED.applied_by`,
        [MIGRATION_ID, sha256, actor]
    );
}

export async function runMultitenantSchemaMigration({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null
} = {}) {
    const { mode } = parseMultitenantSchemaMigrationArgs(argv, env);
    const sql = await readFile(SCHEMA_PATH, 'utf8');
    const contract = schemaContract(sql);
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) {
        throw new SchemaMigrationError(
            'DATABASE_CONFIG_REQUIRED',
            'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }

    let client;
    let transactionStarted = false;
    try {
        client = await activePool.connect();
        if (mode === 'check') {
            const readback = await readbackSchema(client, contract);
            return {
                ok: true,
                mode,
                migration_id: MIGRATION_ID,
                schema_sha256: contract.sha256,
                persisted: true,
                readback
            };
        }

        await client.query('BEGIN');
        transactionStarted = true;
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '120s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ADVISORY_LOCK_NAME]);
        await client.query(sql);
        await recordSchemaVersion(client, {
            sha256: contract.sha256,
            actor: mode === 'apply' ? String(env.BRAINBASE_MIGRATION_ACTOR).trim() : 'dry-run'
        });
        const readback = await readbackSchema(client, contract);

        if (mode === 'dry-run') {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return {
                ok: true,
                mode,
                migration_id: MIGRATION_ID,
                schema_sha256: contract.sha256,
                persisted: false,
                readback
            };
        }

        await client.query('COMMIT');
        transactionStarted = false;
        return {
            ok: true,
            mode,
            migration_id: MIGRATION_ID,
            schema_sha256: contract.sha256,
            persisted: true,
            readback
        };
    } catch (error) {
        if (transactionStarted && client) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Keep the original safe failure and never expose driver details.
            }
        }
        if (error instanceof SchemaMigrationError) throw error;
        throw new SchemaMigrationError(
            'UPSTREAM_UNAVAILABLE',
            'Multitenant schema migration failed; inspect PostgreSQL server logs'
        );
    } finally {
        client?.release();
        if (!pool) {
            try {
                await activePool.end();
            } catch {
                // Connection details from driver cleanup errors are intentionally not surfaced.
            }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMultitenantSchemaMigration()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'MIGRATION_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
