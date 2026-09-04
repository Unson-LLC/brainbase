// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../../../server/services/candidate-store/promotion-gate-service.js';
import {
    collectConversationMessages,
    extractConversationPersonalKgCandidates,
    parseArgs
} from '../../../scripts/oyasumi-conversation-personal-kg.js';
import { writeMeetingPersonalKgCandidates } from '../../../server/services/sns/oyasumi-meeting-personal-kg-service.js';

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

describe('oyasumi conversation personal KG script', () => {
    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oyasumi-conversation-kg-'));
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('keeps dry-run as default and supports write/json flags', () => {
        const args = parseArgs(['--date', '2026-05-23', '--write', '--json', '--allow-empty']);

        expect(args.date).toBe('2026-05-23');
        expect(args.write).toBe(true);
        expect(args.json).toBe(true);
        expect(args.allowEmpty).toBe(true);
        expect(args.includeCodex).toBe(true);
        expect(args.includeClaudeCode).toBe(true);
    });

    it('collects Codex and Claude Code direct user messages for the JST target day', () => {
        writeJsonl(path.join(tmpHome, '.codex', 'history.jsonl'), [
            { session_id: 'codex-1', ts: unixSeconds('2026-05-22T14:59:59Z'), text: '前日なので対象外' },
            { session_id: 'codex-1', ts: unixSeconds('2026-05-22T15:00:00Z'), text: 'VibeProでPRまで作って' },
            { session_id: 'codex-1', ts: unixSeconds('2026-05-22T15:00:01Z'), text: 'VibeProでPRまで作って' },
            { session_id: 'codex-2', ts: unixSeconds('2026-05-23T14:59:59Z'), text: 'ちゃんとローカルで動作確認してからデプロイしろ' }
        ]);
        writeJsonl(path.join(tmpHome, '.claude', 'projects', 'sample', 'session.jsonl'), [
            {
                type: 'user',
                timestamp: '2026-05-22T15:10:00.000Z',
                sessionId: 'claude-1',
                cwd: '/repo',
                message: { role: 'user', content: '公式MCPあるぞ' }
            },
            {
                type: 'user',
                timestamp: '2026-05-22T15:11:00.000Z',
                sessionId: 'claude-1',
                cwd: '/repo',
                message: { role: 'user', content: [{ type: 'tool_result', content: 'command output' }] }
            },
            {
                type: 'user',
                timestamp: '2026-05-22T15:12:00.000Z',
                sessionId: 'claude-1',
                cwd: '/repo',
                message: { role: 'user', content: '<command-name>/compact</command-name>' }
            }
        ]);

        const messages = collectConversationMessages({ date: '2026-05-23', homeDir: tmpHome });

        expect(messages.map((message) => message.text)).toEqual([
            'VibeProでPRまで作って',
            '公式MCPあるぞ',
            'ちゃんとローカルで動作確認してからデプロイしろ'
        ]);
        expect(messages.every((message) => message.event_id)).toBe(true);
    });

    it('extracts durable conversation candidates separately from meeting candidates', async () => {
        const messages = [
            {
                tool: 'codex',
                session_id: 's1',
                ts: '2026-05-23T10:00:00+09:00',
                text: 'VibeProでストーリーを切ってPRまで進めて',
                event_id: 'codex:s1:vibepro'
            },
            {
                tool: 'codex',
                session_id: 's1',
                ts: '2026-05-23T10:01:00+09:00',
                text: 'ちゃんとローカルで動作確認してからデプロイしろ',
                event_id: 'codex:s1:verify'
            },
            {
                tool: 'claude_code',
                session_id: 's2',
                ts: '2026-05-23T10:02:00+09:00',
                text: '今って公式MCP使ってるんだっけ？自作版の方？公式MCPあるぞ',
                event_id: 'claude:s2:mcp'
            },
            {
                tool: 'codex',
                session_id: 's3',
                ts: '2026-05-23T10:03:00+09:00',
                text: 'トシさんの1on1のAI分析についてどう思う？',
                event_id: 'codex:s3:person'
            }
        ];

        const extracted = extractConversationPersonalKgCandidates({ date: '2026-05-23', messages, identity: IDENTITY });
        const core = extracted.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'personal_kg_core'
        ));
        const needsReview = extracted.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'needs_review'
        ));

        expect(extracted.input_count).toBe(4);
        expect(core.map((candidate) => candidate.permission_snapshot.oyasumi_meeting_personal_kg.rule_id))
            .toEqual(expect.arrayContaining([
                'vibepro-for-story-to-pr-and-pdca',
                'verify-with-real-runtime-before-claiming-fixed',
                'prefer-official-mcp-and-remove-custom-when-available'
            ]));
        expect(needsReview.map((candidate) => candidate.permission_snapshot.oyasumi_meeting_personal_kg.rule_id))
            .toContain('person-analysis-must-avoid-unreviewed-sensitive-profiling');
        expect(core.every((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.source_kind === 'daily_interaction'
        ))).toBe(true);

        const repository = new InMemoryCandidateRepository();
        const candidateService = new PromotionGateService({ repository });
        const summary = await writeMeetingPersonalKgCandidates({ candidateService, extracted, identity: IDENTITY });

        expect(summary.inserted).toBe(extracted.adopted.length);
        expect(repository.list({ owner_person_id: 'sato_keigo' })).toHaveLength(extracted.adopted.length);
    });

    it('fails empty conversation input unless explicitly allowed and keeps artifacts private', () => {
        const inputPath = path.join(tmpHome, 'empty.jsonl');
        const outputDir = path.join(tmpHome, 'out');
        fs.writeFileSync(inputPath, '');

        let failure;
        try {
            execFileSync('node', [
                'scripts/oyasumi-conversation-personal-kg.js',
                '--date',
                '2026-05-23',
                '--input',
                inputPath,
                '--output-dir',
                outputDir,
                '--owner=sato_keigo',
                '--actor=sato_keigo',
                '--organization=unson',
                '--json'
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
        } catch (error) {
            failure = error;
        }

        expect(failure?.status).toBe(2);
        expect(failure?.stderr).toContain('conversation input_count is 0');
        const messagesPath = path.join(outputDir, 'conversation-user-messages.jsonl');
        const extractionPath = path.join(outputDir, 'conversation-personal-kg-extraction.json');
        expect((fs.statSync(messagesPath).mode & 0o777)).toBe(0o600);
        expect((fs.statSync(extractionPath).mode & 0o777)).toBe(0o600);
    });
});
