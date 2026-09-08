import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    selectOwnerVisibleEvent,
    sha256,
    verifyOwnerVisibleSource
} from '../../scripts/lib/codex-owner-visible-readback.mjs';

const roots = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sqlString(value) {
    return `'${value.replaceAll("'", "''")}'`;
}

function fixture() {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-owner-visible-'));
    roots.push(codexHome);
    const databasePath = join(codexHome, 'thread_history_1.sqlite');
    const taskId = '01a-test-task';
    const turnId = '01a-test-turn';
    const eventId = 'msg_test_owner_visible';
    const systemMessage = '🧠 判断参照: test ✓\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
    const itemJson = JSON.stringify({
        type: 'hookPrompt',
        id: eventId,
        fragments: [{ text: systemMessage, hookRunId: 'stop:test' }]
    });
    const sql = `
CREATE TABLE thread_items (
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rollout_ordinal INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  item_type TEXT NOT NULL,
  updated_at_ordinal INTEGER NOT NULL,
  PRIMARY KEY(thread_id, turn_id, item_id)
);
INSERT INTO thread_items VALUES (
  ${sqlString(taskId)}, ${sqlString(turnId)}, ${sqlString(eventId)}, 42, 1700000000000,
  ${sqlString(itemJson)}, 'hookPrompt', 42
);`;
    const created = spawnSync('sqlite3', [databasePath], { input: sql, encoding: 'utf8' });
    expect(created.status, created.stderr).toBe(0);
    return { codexHome, databasePath, taskId, turnId, eventId, itemJson, systemMessage };
}

describe('Codex owner-visible event-stream readback', () => {
    it('capture command binds the artifact to the exact thread_items row', () => {
        const data = fixture();
        const outputRoot = join(data.codexHome, 'var', 'judgment-resolver', 'owner-visible-readback');
        mkdirSync(outputRoot, { recursive: true });
        const outputPath = join(outputRoot, `${data.taskId}.json`);
        const fingerprint = 'a'.repeat(64);
        const captured = spawnSync(process.execPath, [
            'scripts/capture-codex-owner-visible-readback.mjs',
            '--task-id', data.taskId,
            '--turn-id', data.turnId,
            '--final-event-fingerprint', fingerprint,
            '--output', outputPath
        ], {
            cwd: process.cwd(),
            env: { ...process.env, CODEX_HOME: data.codexHome },
            encoding: 'utf8'
        });
        expect(captured.status, captured.stderr).toBe(0);
        const artifact = JSON.parse(readFileSync(outputPath, 'utf8'));
        expect(artifact).toMatchObject({
            source: 'codex_event_stream',
            source_database: 'codex_thread_history_v1',
            source_item_type: 'hookPrompt',
            source_rollout_ordinal: 42,
            source_created_at_ms: 1700000000000,
            source_row_digest: sha256(data.itemJson),
            task_id: data.taskId,
            turn_id: data.turnId,
            event_id: data.eventId,
            final_event_fingerprint: fingerprint,
            system_message: data.systemMessage,
            occurrences: 1
        });
        expect(() => verifyOwnerVisibleSource(artifact, { databasePath: data.databasePath })).not.toThrow();
    });

    it('rejects a self-reported event identity or altered source row', () => {
        const data = fixture();
        const event = selectOwnerVisibleEvent(data);
        const artifact = {
            source: 'codex_event_stream',
            source_database: 'codex_thread_history_v1',
            source_item_type: 'hookPrompt',
            source_rollout_ordinal: event.rollout_ordinal,
            source_created_at_ms: event.created_at_ms,
            source_row_digest: sha256(event.item_json),
            task_id: data.taskId,
            turn_id: data.turnId,
            event_id: 'msg_forged',
            system_message: data.systemMessage,
            occurrences: 1
        };
        expect(() => verifyOwnerVisibleSource(artifact, { databasePath: data.databasePath }))
            .toThrow('owner_visible_source_identity_count_invalid:0');
        artifact.event_id = data.eventId;
        artifact.source_row_digest = `sha256:${'0'.repeat(64)}`;
        expect(() => verifyOwnerVisibleSource(artifact, { databasePath: data.databasePath }))
            .toThrow('owner_visible_source_row_digest_mismatch');
    });
});
