#!/usr/bin/env node

import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const [mode, beforePath, observedPath, evidencePath] = process.argv.slice(2);
if (!['pre-delete', 'final'].includes(mode) || !beforePath || !observedPath || !evidencePath) {
    console.error('usage: verify-production-signing-config.mjs <pre-delete|final> <before.json> <observed.json> <evidence.json>');
    process.exit(2);
}

const PUBLIC = 'ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY';
const PRIVATE = 'ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY';
const KEY_ID = 'ONTOLOGY_PUBLICATION_SIGNING_KEY_ID';
let before = {};
let observed = {};
let parseError = false;
try {
    before = JSON.parse(readFileSync(beforePath, 'utf8'));
    observed = JSON.parse(readFileSync(observedPath, 'utf8'));
} catch {
    parseError = true;
}

const beforeSchemaValid = [PUBLIC, PRIVATE, KEY_ID].every((key) => Object.hasOwn(before, key));
const observedSchemaValid = [PRIVATE, KEY_ID].every((key) => Object.hasOwn(observed, key));
const privateKeyPreserved = beforeSchemaValid && observedSchemaValid && before[PRIVATE] === observed[PRIVATE];
const keyIdPreserved = beforeSchemaValid && observedSchemaValid && before[KEY_ID] === observed[KEY_ID];
const publicOverridePresent = Object.hasOwn(observed, PUBLIC);
const passed = !parseError && beforeSchemaValid && observedSchemaValid && privateKeyPreserved && keyIdPreserved &&
    (mode === 'pre-delete' || !publicOverridePresent);
const evidence = {
    status: passed ? (mode === 'pre-delete' ? 'ready_to_repair' : 'repaired') : 'blocked',
    failed_stage: passed ? null : mode,
    rollback_complete: mode === 'final' && passed,
    partial_state: !passed,
    next_action: passed ? null : 'stop_and_inspect_saved_rollback_state',
    parse_error: parseError,
    before_schema_valid: beforeSchemaValid,
    observed_schema_valid: observedSchemaValid,
    public_key_override_present: publicOverridePresent,
    private_key_preserved_before_delete: mode === 'pre-delete' ? privateKeyPreserved : null,
    key_id_preserved_before_delete: mode === 'pre-delete' ? keyIdPreserved : null,
    private_key_preserved_after_rollback: mode === 'final' ? privateKeyPreserved : null,
    key_id_preserved_after_rollback: mode === 'final' ? keyIdPreserved : null,
};
const temporaryPath = join(dirname(evidencePath), `.${process.pid}-${Date.now()}.signing-evidence.tmp`);
writeFileSync(temporaryPath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
chmodSync(temporaryPath, 0o600);
renameSync(temporaryPath, evidencePath);

if (!passed) {
    console.error(`[brainbase-runtime] signing configuration ${mode} verification blocked; evidence=${evidencePath}; rollback_complete=false`);
    process.exit(1);
}
