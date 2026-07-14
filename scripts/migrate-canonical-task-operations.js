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
    return { ok: true, tables: REQUIRED_TABLES };
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
