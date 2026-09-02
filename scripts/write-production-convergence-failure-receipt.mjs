#!/usr/bin/env node

import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const required = (name) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
};

const runDir = required('BRAINBASE_PRODUCTION_RUN_DIR');
const runId = required('BRAINBASE_PRODUCTION_RUN_ID');
const targetSha = required('BRAINBASE_PRODUCTION_TARGET_SHA');
const failedStage = required('BRAINBASE_PRODUCTION_STAGE');
const stateChanged = required('BRAINBASE_PRODUCTION_STATE_CHANGED') === 'true';
const exitCode = Number.parseInt(required('BRAINBASE_PRODUCTION_EXIT_CODE'), 10);

if (!/^[0-9a-f]{40}$/u.test(targetSha)) throw new Error('target SHA must be a full Git SHA');
if (!/^[a-z0-9_]+$/u.test(failedStage)) throw new Error('failed stage is invalid');
if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
    throw new Error('exit code must be between 1 and 255');
}

const safeEvidenceFiles = [
    'infisical.evidence.json',
    'surfaces.evidence.json',
    'ontology.evidence.json',
    'graph.evidence.json',
    'graph.validate.json',
    'local-ui.version.json',
    'mcp.version.json',
    'lightsail.version.json',
];
const evidencePaths = safeEvidenceFiles.filter((name) => existsSync(join(runDir, name)));
const receiptPath = join(runDir, 'production-convergence-failure.json');
const receipt = {
    schema_version: 'brainbase.production-convergence-failure.v1',
    run_id: runId,
    target_sha: targetSha,
    status: 'failed',
    failed_stage: failedStage,
    state_changed: stateChanged,
    rollback_required: stateChanged,
    exit_code: exitCode,
    evidence_paths: evidencePaths,
};

writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
chmodSync(receiptPath, 0o600);
process.stderr.write(
    `Production convergence failed: stage=${failedStage} state_changed=${stateChanged} ` +
        `rollback_required=${stateChanged} receipt=${receiptPath}\n`
);
