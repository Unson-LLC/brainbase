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
    'server/sql/candidate-store-schema.sql',
    'server/sql/integration-accounts-schema.sql'
];

function databaseConfig() {
    if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL };
    }
    return {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 25432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD
    };
}

function validateConfig(config) {
    if (config.connectionString) return;
    const missing = ['database', 'user'].filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set DATABASE_URL or PGDATABASE/PGUSER.`);
    }
}

async function main() {
    const config = databaseConfig();
    validateConfig(config);
    const pool = new Pool(config);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const relative of MIGRATIONS) {
            const absolute = path.join(repoRoot, relative);
            const sql = await fs.readFile(absolute, 'utf8');
            await client.query(sql);
            console.log(`applied ${relative}`);
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

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
