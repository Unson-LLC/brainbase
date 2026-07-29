#!/usr/bin/env node
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

export function parseCanonicalTaskWriterRecoveryArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--expected-token') parsed.expectedToken = argv[++index];
        else if (argv[index] === '--expected-pid') parsed.expectedPid = Number(argv[++index]);
        else if (argv[index] === '--new-token') parsed.newToken = argv[++index];
        else throw new Error(`Unknown argument: ${argv[index]}`);
    }
    if (!parsed.expectedToken || !parsed.newToken || !Number.isSafeInteger(parsed.expectedPid) || parsed.expectedPid <= 0) {
        throw new Error('--expected-token, --expected-pid, and --new-token are required');
    }
    return parsed;
}

export function isCanonicalTaskWriterProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        return true;
    }
}

export async function recoverCanonicalTaskWriter({
    argv = process.argv.slice(2),
    pool = null,
    isProcessAlive = isCanonicalTaskWriterProcessAlive
} = {}) {
    const args = parseCanonicalTaskWriterRecoveryArgs(argv);
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const client = await activePool.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query(
            `SELECT writer_token, process_identity
             FROM canonical_task_writer
             WHERE singleton_id = TRUE
             FOR UPDATE`
        );
        const writer = current.rows[0];
        if (!writer || writer.writer_token !== args.expectedToken) {
            throw new Error('Expected writer token did not match; recovery was not applied');
        }
        const storedPid = Number(writer.process_identity?.pid);
        if (!Number.isSafeInteger(storedPid) || storedPid !== args.expectedPid) {
            throw new Error('Expected writer PID did not match the stored process identity; recovery was not applied');
        }
        if (isProcessAlive(storedPid)) {
            throw new Error('Expected writer process is still running; stop it before recovery');
        }
        const result = await client.query(
            `UPDATE canonical_task_writer
             SET writer_token = $3, process_identity = '{}'::jsonb, source_head = NULL, updated_at = NOW()
             WHERE singleton_id = TRUE
               AND writer_token = $1
               AND (process_identity->>'pid')::bigint = $2
             RETURNING writer_token`,
            [args.expectedToken, args.expectedPid, args.newToken]
        );
        if (!result.rowCount) throw new Error('Writer identity changed during recovery; recovery was not applied');
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
