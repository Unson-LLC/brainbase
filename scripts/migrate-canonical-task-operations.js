#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'server/sql/canonical-task-operation-schema.sql');
const REQUIRED_TABLES = [
    'canonical_task_writer',
    'canonical_task_readiness',
    'canonical_task_operations'
];
const REQUIRED_COLUMNS = Object.freeze({
    canonical_task_writer: ['writer_token', 'process_identity', 'source_head'],
    canonical_task_readiness: ['ready', 'writer_token', 'manifest_hash', 'schema_version', 'source_head', 'evidence_hash', 'evidence_path'],
    canonical_task_operations: ['scope', 'operation_key', 'state', 'writer_token', 'authorization_snapshot', 'recovery_checkpoint']
});

export function parseCanonicalTaskOperationMigrationArgs(argv) {
    const apply = argv.includes('--apply');
    const check = argv.includes('--check');
    if (apply === check) throw new Error('Specify exactly one of --apply or --check');
    return { apply, check };
}

export async function checkCanonicalTaskOperationSchema(pool) {
    const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES]
    );
    const present = new Set(result.rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
    if (missing.length) throw new Error(`Canonical Task operation schema is incomplete: ${missing.join(', ')}`);

    const columnResult = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES]
    );
    const columns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, names]) =>
        names.filter((name) => !columns.has(`${table}.${name}`)).map((name) => `${table}.${name}`)
    );
    if (missingColumns.length) throw new Error(`Canonical Task operation schema has missing columns: ${missingColumns.join(', ')}`);

    const constraintResult = await pool.query(
        `SELECT constraint_def.contype AS contype,
                array_agg(att.attname::text ORDER BY key_col.ordinality) AS columns
         FROM pg_constraint constraint_def
         JOIN pg_class table_def ON table_def.oid = constraint_def.conrelid
         LEFT JOIN LATERAL unnest(constraint_def.conkey) WITH ORDINALITY AS key_col(attnum, ordinality) ON TRUE
         LEFT JOIN pg_attribute att ON att.attrelid = table_def.oid AND att.attnum = key_col.attnum
         WHERE table_def.relname = 'canonical_task_operations'
           AND constraint_def.contype IN ('u', 'c')
         GROUP BY constraint_def.oid, constraint_def.contype`,
    );
    const hasOperationUnique = constraintResult.rows.some((row) =>
        (row.contype === 'u' || row.contype === 'UNIQUE')
        && JSON.stringify(row.columns) === JSON.stringify(['scope', 'operation_key'])
    );
    const hasStateCheck = constraintResult.rows.some((row) =>
        (row.contype === 'c' || row.contype === 'CHECK') && row.columns?.includes('state')
    );
    if (!hasOperationUnique || !hasStateCheck) {
        throw new Error('Canonical Task operation schema is missing required UNIQUE or CHECK constraint');
    }

    const indexResult = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'canonical_task_operations'
           AND indexname = 'canonical_task_operations_state_idx'`,
    );
    if (!indexResult.rows.length) throw new Error('Canonical Task operation schema is missing canonical_task_operations_state_idx');
    return {
        ok: true,
        tables: REQUIRED_TABLES,
        constraints: ['operations_scope_operation_key_unique', 'operations_state_check'],
        indexes: ['canonical_task_operations_state_idx']
    };
}

export async function runCanonicalTaskOperationMigration({ argv = process.argv.slice(2), pool = null } = {}) {
    const args = parseCanonicalTaskOperationMigrationArgs(argv);
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');
    try {
        if (args.apply) await activePool.query(await readFile(SCHEMA_PATH, 'utf8'));
        return await checkCanonicalTaskOperationSchema(activePool);
    } finally {
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskOperationMigration()
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
