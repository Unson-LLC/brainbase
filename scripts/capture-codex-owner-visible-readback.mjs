#!/usr/bin/env node
import { chmodSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
    OWNER_VISIBLE_ITEM_TYPE,
    OWNER_VISIBLE_SCHEMA,
    OWNER_VISIBLE_SOURCE,
    OWNER_VISIBLE_SOURCE_DATABASE,
    codexHistoryPath,
    selectOwnerVisibleEvent,
    sha256,
    verifyOwnerVisibleSource
} from './lib/codex-owner-visible-readback.mjs';

function args(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith('--') || value === undefined) throw new Error('arguments_invalid');
        parsed[key.slice(2)] = value;
    }
    return parsed;
}

function assertBoundOutput(outputPath, codexHome) {
    if (!isAbsolute(outputPath) || !outputPath.endsWith('.json')) throw new Error('output_path_invalid');
    const root = resolve(codexHome, 'var', 'judgment-resolver', 'owner-visible-readback');
    const child = relative(root, resolve(outputPath));
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('output_path_outside_owner_journal');
    return root;
}

const options = args(process.argv.slice(2));
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
const taskId = options['task-id'];
const turnId = options['turn-id'];
const finalEventFingerprint = options['final-event-fingerprint'];
const outputPath = options.output;
if (!/^[0-9a-f]{64}$/u.test(finalEventFingerprint || '')) throw new Error('final_event_fingerprint_invalid');
const root = assertBoundOutput(outputPath, codexHome);
mkdirSync(root, { recursive: true, mode: 0o700 });

const databasePath = codexHistoryPath(codexHome);
const event = selectOwnerVisibleEvent({ taskId, turnId, databasePath });
const artifact = {
    schema_version: OWNER_VISIBLE_SCHEMA,
    source: OWNER_VISIBLE_SOURCE,
    source_database: OWNER_VISIBLE_SOURCE_DATABASE,
    source_item_type: OWNER_VISIBLE_ITEM_TYPE,
    source_rollout_ordinal: event.rollout_ordinal,
    source_created_at_ms: event.created_at_ms,
    source_row_digest: sha256(event.item_json),
    task_id: event.thread_id,
    turn_id: event.turn_id,
    event_id: event.item_id,
    final_event_fingerprint: finalEventFingerprint,
    captured_at: new Date().toISOString(),
    system_message: event.system_message,
    system_message_digest: sha256(event.system_message),
    occurrences: 1
};
verifyOwnerVisibleSource(artifact, { databasePath });

const temporaryPath = `${outputPath}.tmp-${process.pid}`;
writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(temporaryPath, 0o600);
renameSync(temporaryPath, outputPath);
process.stdout.write(`${realpathSync(outputPath)}\n`);
