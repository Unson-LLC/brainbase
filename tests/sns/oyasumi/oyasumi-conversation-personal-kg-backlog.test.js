// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    buildConversationBacklog,
    parseArgs
} from '../../../scripts/oyasumi-conversation-personal-kg-backlog.js';

const IDENTITY = {
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    org_ids: ['unson']
};

let tmpHome;

function writeJsonl(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function unixSeconds(iso) {
    return Math.floor(Date.parse(iso) / 1000);
}

describe('oyasumi conversation personal KG backlog', () => {
    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oyasumi-conversation-kg-backlog-'));
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('parses date range, server comparison, and output flags', () => {
        const args = parseArgs([
            '--from',
            '2026-05-23',
            '--to=2026-05-24',
            '--compare-server',
            '--json',
            '--codex-only',
            '--limit',
            '10'
        ]);

        expect(args.dateFrom).toBe('2026-05-23');
        expect(args.dateTo).toBe('2026-05-24');
        expect(args.compareServer).toBe(true);
        expect(args.json).toBe(true);
        expect(args.includeCodex).toBe(true);
        expect(args.includeClaudeCode).toBe(false);
        expect(args.limit).toBe(10);
    });

    it('groups raw logs by JST date and compares deterministic candidate refs without exposing raw text', () => {
        writeJsonl(path.join(tmpHome, '.codex', 'history.jsonl'), [
            {
                session_id: 'codex-1',
                ts: unixSeconds('2026-05-22T15:00:00Z'),
                text: 'VibeProでストーリーを切ってPRまで進めて'
            },
            {
                session_id: 'codex-2',
                ts: unixSeconds('2026-05-23T15:00:00Z'),
                text: '単発の確認だけ'
            }
        ]);
        writeJsonl(path.join(tmpHome, '.claude', 'projects', 'sample', 'session.jsonl'), [
            {
                type: 'user',
                timestamp: '2026-05-22T16:00:00.000Z',
                sessionId: 'claude-1',
                cwd: '/repo',
                message: { role: 'user', content: 'ちゃんとローカルで動作確認してからデプロイしろ' }
            }
        ]);
        const existingSourceRef = 'codex-claude-conversation:2026-05-23#personal_kg_core:vibepro-for-story-to-pr-and-pdca';

        const backlog = buildConversationBacklog({
            homeDir: tmpHome,
            dateFrom: '2026-05-23',
            dateTo: '2026-05-24',
            existingCandidates: [{
                source_event_ids: [existingSourceRef],
                permission_snapshot: {
                    oyasumi_meeting_personal_kg: {
                        source_ref: existingSourceRef
                    }
                }
            }],
            identity: IDENTITY
        });

        expect(backlog.raw_log_file_count).toBe(2);
        expect(backlog.summary.dates_considered).toBe(2);
        expect(backlog.summary.input_messages).toBe(3);
        expect(backlog.summary.adopted_candidates).toBe(2);
        expect(backlog.summary.existing_candidates).toBe(1);
        expect(backlog.summary.missing_candidates).toBe(1);
        expect(backlog.summary.by_status).toEqual({ needs_write: 1, no_candidate: 1 });
        expect(backlog.dates[0]).toEqual(expect.objectContaining({
            date: '2026-05-23',
            status: 'needs_write',
            input_count: 2,
            adopted_count: 2,
            existing_count: 1,
            missing_count: 1
        }));
        expect(JSON.stringify(backlog)).not.toContain('VibeProでストーリー');
        expect(JSON.stringify(backlog)).not.toContain('ちゃんとローカルで動作確認');
    });
});
