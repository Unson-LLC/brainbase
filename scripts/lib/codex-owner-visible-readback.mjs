import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OWNER_VISIBLE_SCHEMA = 'brainbase-owner-visible-readback-v1';
export const OWNER_VISIBLE_SOURCE = 'codex_event_stream';
export const OWNER_VISIBLE_SOURCE_DATABASE = 'codex_thread_history_v1';
export const OWNER_VISIBLE_ITEM_TYPE = 'hookPrompt';

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/u;

export function sha256(value) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function codexHistoryPath(codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')) {
    return join(codexHome, 'thread_history_1.sqlite');
}

function sqlLiteral(value, label) {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) {
        throw new Error(`${label}_invalid`);
    }
    return `'${value.replaceAll("'", "''")}'`;
}

function queryRows(databasePath, sql) {
    if (!existsSync(databasePath)) throw new Error('codex_event_stream_database_missing');
    const result = spawnSync('sqlite3', ['-readonly', '-json', realpathSync(databasePath), sql], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024
    });
    if (result.status !== 0) {
        throw new Error(`codex_event_stream_query_failed:${(result.stderr || '').trim()}`);
    }
    return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}

export function systemMessageFromItemJson(itemJson) {
    const item = JSON.parse(itemJson);
    if (item?.type !== OWNER_VISIBLE_ITEM_TYPE || !Array.isArray(item.fragments) || item.fragments.length !== 1) {
        throw new Error('codex_owner_visible_event_shape_invalid');
    }
    const text = item.fragments[0]?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('codex_owner_visible_system_message_missing');
    return text;
}

export function readTurnHookEvents({ taskId, turnId, databasePath = codexHistoryPath() }) {
    const sql = `SELECT thread_id, turn_id, item_id, item_type, rollout_ordinal, created_at_ms, item_json
FROM thread_items
WHERE thread_id = ${sqlLiteral(taskId, 'task_id')}
  AND turn_id = ${sqlLiteral(turnId, 'turn_id')}
  AND item_type = '${OWNER_VISIBLE_ITEM_TYPE}'
ORDER BY rollout_ordinal ASC;`;
    return queryRows(databasePath, sql).map((row) => ({
        ...row,
        system_message: systemMessageFromItemJson(row.item_json)
    }));
}

export function selectOwnerVisibleEvent({ taskId, turnId, databasePath = codexHistoryPath() }) {
    const candidates = readTurnHookEvents({ taskId, turnId, databasePath }).filter(({ system_message }) => {
        const lines = system_message.split('\n');
        return lines.some((line) => line.startsWith('🧠 '))
            && lines.some((line) => line.startsWith('📚 '));
    });
    if (candidates.length !== 1) {
        throw new Error(`codex_owner_visible_event_count_invalid:${candidates.length}`);
    }
    return candidates[0];
}

export function verifyOwnerVisibleSource(artifact, { databasePath = codexHistoryPath() } = {}) {
    if (artifact?.source !== OWNER_VISIBLE_SOURCE) throw new Error('owner_visible_source_invalid');
    if (artifact?.source_database !== OWNER_VISIBLE_SOURCE_DATABASE) throw new Error('owner_visible_source_database_invalid');
    if (artifact?.source_item_type !== OWNER_VISIBLE_ITEM_TYPE) throw new Error('owner_visible_source_item_type_invalid');

    const events = readTurnHookEvents({
        taskId: artifact.task_id,
        turnId: artifact.turn_id,
        databasePath
    });
    const matchingIdentity = events.filter((event) => event.item_id === artifact.event_id);
    if (matchingIdentity.length !== 1) throw new Error(`owner_visible_source_identity_count_invalid:${matchingIdentity.length}`);
    const event = matchingIdentity[0];
    if (event.rollout_ordinal !== artifact.source_rollout_ordinal) throw new Error('owner_visible_source_ordinal_mismatch');
    if (event.created_at_ms !== artifact.source_created_at_ms) throw new Error('owner_visible_source_timestamp_mismatch');
    if (sha256(event.item_json) !== artifact.source_row_digest) throw new Error('owner_visible_source_row_digest_mismatch');
    if (event.system_message !== artifact.system_message) throw new Error('owner_visible_source_system_message_mismatch');
    const occurrences = events.filter(({ system_message }) => system_message === artifact.system_message).length;
    if (occurrences !== 1 || artifact.occurrences !== occurrences) {
        throw new Error(`owner_visible_source_occurrences_invalid:${occurrences}`);
    }
    return event;
}
