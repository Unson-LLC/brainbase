#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { runCanonicalTaskPostgresMigration } from './migrate-canonical-task-postgres-store.js';

const PHASES = [
    { name: 'dry-run', argv: ['--dry-run'] },
    { name: 'check', argv: ['--check'] },
    { name: 'apply', argv: ['--apply'] },
    { name: 'final-check', argv: ['--check'] }
];

function phaseSummary(name, result) {
    if (!result?.ok || Number(result.conflict_count) !== 0) {
        throw new Error(`Canonical Task migration workflow stopped at ${name}`);
    }
    return {
        phase: name,
        ok: true,
        source_count: Number(result.source_count),
        target_count: Number(result.target_count),
        matched_count: Number(result.matched_count),
        pending_count: Number(result.pending_count),
        inserted_count: Number(result.inserted_count),
        conflict_count: Number(result.conflict_count)
    };
}

export function hasExplicitApplyApproval(argv = []) {
    return argv.length === 1 && argv[0] === '--approve-apply';
}

export async function runCanonicalTaskPostgresMigrationWorkflow({
    runMigration = runCanonicalTaskPostgresMigration,
    pool = null,
    sourceRepository = null,
    applyAuthorized = false
} = {}) {
    if (!applyAuthorized) {
        throw new Error(
            'Canonical Task migration apply requires explicit operator approval: pass --approve-apply'
        );
    }

    const phases = [];
    for (const phase of PHASES) {
        const result = await runMigration({
            argv: phase.argv,
            pool,
            sourceRepository,
            workflowAuthorized: applyAuthorized && phase.name === 'apply'
        });
        phases.push(phaseSummary(phase.name, result));
    }

    const finalCheck = phases.at(-1);
    if (finalCheck.pending_count !== 0 || finalCheck.source_count !== finalCheck.target_count) {
        throw new Error(
            'Canonical Task migration final check failed: pending rows or count mismatch remain'
        );
    }

    return {
        ok: true,
        workflow: 'dry-run -> check -> apply -> final-check',
        final_check_passed: true,
        phases
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const applyAuthorized = hasExplicitApplyApproval(process.argv.slice(2));
    runCanonicalTaskPostgresMigrationWorkflow({ applyAuthorized })
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
