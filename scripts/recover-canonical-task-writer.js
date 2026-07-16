#!/usr/bin/env node
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

export function parseCanonicalTaskWriterRecoveryArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--expected-token') parsed.expectedToken = argv[++index];
        else if (argv[index] === '--new-token') parsed.newToken = argv[++index];
        else throw new Error(`Unknown argument: ${argv[index]}`);
    }
    if (!parsed.expectedToken || !parsed.newToken) throw new Error('--expected-token and --new-token are required');
    return parsed;
}

export async function recoverCanonicalTaskWriter({ argv = process.argv.slice(2), pool = null } = {}) {
    const args = parseCanonicalTaskWriterRecoveryArgs(argv);
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const client = await activePool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE canonical_task_writer
             SET writer_token = $2, process_identity = '{}'::jsonb, source_head = NULL, updated_at = NOW()
             WHERE singleton_id = TRUE AND writer_token = $1
             RETURNING writer_token`,
            [args.expectedToken, args.newToken]
        );
        if (!result.rowCount) throw new Error('Expected writer token did not match; recovery was not applied');
        await client.query(
            `INSERT INTO canonical_task_readiness (singleton_id, ready, reason, updated_at)
             VALUES (TRUE, FALSE, 'writer_recovered_requires_reverification', NOW())
             ON CONFLICT (singleton_id) DO UPDATE SET ready = FALSE, reason = EXCLUDED.reason, updated_at = NOW()`
        );
        await client.query('COMMIT');
        return {
            recovered: true,
            writer_token: args.newToken,
            required_restart_environment: {
                BRAINBASE_SERVER_GENERATION: args.newToken
            }
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    recoverCanonicalTaskWriter()
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
