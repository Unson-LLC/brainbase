#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import {
    applyCanonicalTaskSearchIndexes,
    checkCanonicalTaskPostgresSchema
} from './migrate-canonical-task-postgres-store.js';

export function hasExplicitSearchIndexApproval(argv = []) {
    return argv.length === 1 && argv[0] === '--approve-apply';
}

export async function runCanonicalTaskSearchIndexWorkflow({
    argv = process.argv.slice(2),
    pool = null
} = {}) {
    if (!hasExplicitSearchIndexApproval(argv)) {
        throw new Error(
            'Canonical Task search index apply requires explicit operator approval: pass --approve-apply'
        );
    }

    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');

    try {
        await checkCanonicalTaskPostgresSchema(activePool, { requireSearchIndexes: false });
        await applyCanonicalTaskSearchIndexes(activePool);
        await checkCanonicalTaskPostgresSchema(activePool, { requireSearchIndexes: true });
        return {
            ok: true,
            workflow: 'base-schema-check -> concurrent-index-apply -> valid-ready-check',
            final_check_passed: true
        };
    } finally {
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runCanonicalTaskSearchIndexWorkflow()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
