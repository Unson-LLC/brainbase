#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';
import { CanonicalTaskOperationRepository } from '../server/services/companion/canonical-task-operation-repository.js';
import { checkCanonicalTaskOperationSchema } from './migrate-canonical-task-operations.js';

const TEST_SCOPE = 'canonical-task-concurrency-verification';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function currentSourceHead() {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

export async function checkCanonicalTaskPostgresConcurrency({
    pool,
    sourceHead = currentSourceHead(),
    operationKey = `verification-${randomUUID()}`,
    runDelayMs = 100,
    writerToken = `verification-${randomUUID()}`
}) {
    await checkCanonicalTaskOperationSchema(pool);
    const writer = await pool.query(
        `SELECT writer_token FROM canonical_task_writer
         WHERE singleton_id = TRUE`
    );
    if (writer.rowCount) {
        throw new Error('Canonical Task active writer appeared; concurrency verification will not borrow it');
    }

    const repositoryOptions = {
        pool,
        writerToken,
        processIdentity: { verification: 'postgres-concurrency', source_head: sourceHead },
        operationWaitTimeoutMs: 5000,
        operationPollIntervalMs: 10
    };
    const writerRepository = new CanonicalTaskOperationRepository(repositoryOptions);
    const firstRepository = new CanonicalTaskOperationRepository(repositoryOptions);
    const secondRepository = new CanonicalTaskOperationRepository(repositoryOptions);
    const fingerprint = `verification:${sourceHead}:${operationKey}`;
    let runCount = 0;
    const run = async () => {
        runCount += 1;
        await new Promise((resolve) => setTimeout(resolve, runDelayMs));
        return { source_head: sourceHead, operation_key: operationKey };
    };

    try {
        await writerRepository.claimWriter({ sourceHead });
        const [firstResult, secondResult] = await Promise.all([
            firstRepository.execute({ scope: TEST_SCOPE, operationKey, fingerprint, run }),
            secondRepository.execute({ scope: TEST_SCOPE, operationKey, fingerprint, run })
        ]);
        if (runCount !== 1) {
            throw new Error(`Canonical Task operation executed ${runCount} times instead of once`);
        }
        if (JSON.stringify(firstResult) !== JSON.stringify(secondResult)) {
            throw new Error('Concurrent Canonical Task callers received different results');
        }
        const operation = await pool.query(
            `SELECT state, fingerprint, result_json
             FROM canonical_task_operations
             WHERE scope = $1 AND operation_key = $2`,
            [TEST_SCOPE, operationKey]
        );
        if (
            operation.rowCount !== 1
            || operation.rows[0].state !== 'completed'
            || operation.rows[0].fingerprint !== fingerprint
            || JSON.stringify(operation.rows[0].result_json) !== JSON.stringify(firstResult)
        ) {
            throw new Error('Canonical Task persisted operation result does not match the concurrent result');
        }
        return {
            ok: true,
            source_head: sourceHead,
            scope: TEST_SCOPE,
            run_count: runCount,
            caller_count: 2,
            persisted_state: operation.rows[0].state,
            writer_mode: 'temporary-exclusive-claim',
            cleanup: 'pending'
        };
    } finally {
        await pool.query(
            `DELETE FROM canonical_task_operations
             WHERE scope = $1 AND operation_key = $2`,
            [TEST_SCOPE, operationKey]
        );
        await writerRepository.releaseWriter();
    }
}

export async function runCanonicalTaskPostgresConcurrencyCheck() {
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    if (!databaseUrl) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const pool = new Pool({ connectionString: databaseUrl });
    try {
        const result = await checkCanonicalTaskPostgresConcurrency({ pool });
        return { ...result, cleanup: 'completed' };
    } finally {
        await pool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskPostgresConcurrencyCheck()
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
