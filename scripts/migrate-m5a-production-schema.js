#!/usr/bin/env node
// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MIGRATIONS = [
    { id: 'candidate-store', path: 'server/sql/candidate-store-schema.sql' },
    { id: 'knowledge-events', path: 'server/sql/knowledge-event-schema.sql' },
    { id: 'integration-accounts', path: 'server/sql/integration-accounts-schema.sql' },
    { id: 'sns-posting-ledger', path: 'server/sql/sns-posting-ledger-schema.sql' }
];

export function selectedMigrations(argv = process.argv.slice(2)) {
    const onlyIndex = argv.indexOf('--only');
    if (onlyIndex === -1) return MIGRATIONS;
    const requested = argv[onlyIndex + 1];
    const selected = MIGRATIONS.filter((migration) => migration.id === requested);
    if (selected.length === 0) {
        throw new Error(`Unknown migration id: ${requested}. Available: ${MIGRATIONS.map((migration) => migration.id).join(', ')}`);
    }
    return selected;
}

export function databaseConfig(env = process.env) {
    if (env.SNS_POSTING_LEDGER_DATABASE_URL) {
        return { connectionString: env.SNS_POSTING_LEDGER_DATABASE_URL };
    }
    if (env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL) {
        return { connectionString: env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL };
    }
    if (env.DATABASE_URL) {
        return { connectionString: env.DATABASE_URL };
    }
    return {
        host: env.PGHOST || '127.0.0.1',
        port: Number(env.PGPORT || 25432),
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD
    };
}

function validateConfig(config) {
    if (config.connectionString) return;
    const missing = ['database', 'user'].filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set DATABASE_URL, INFO_SSOT_DATABASE_URL, SNS_POSTING_LEDGER_DATABASE_URL, or PGDATABASE/PGUSER.`);
    }
}

async function main() {
    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const migration of selectedMigrations()) {
            const absolute = path.join(repoRoot, migration.path);
            const sql = await fs.readFile(absolute, 'utf8');
            await client.query(sql);
            console.log(`applied ${migration.path}`);
        }
        await client.query('COMMIT');
        console.log('M5-A schema migration complete');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
