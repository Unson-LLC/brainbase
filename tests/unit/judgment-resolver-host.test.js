import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildOwnerReferenceLine,
    buildJudgmentRequest,
    canonicalJson,
    resolveAndAdopt,
    successOutput
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const temporaryPaths = [];

function temporaryDirectory() {
    const path = mkdtempSync(join(tmpdir(), 'brainbase-judgment-host-'));
    temporaryPaths.push(path);
    return path;
}

function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}

function event(type, payload) {
    return JSON.stringify({ type, payload });
}

function validReceipt(args) {
    return {
        resolution_id: 'jr_host_test',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }]
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Codex Judgment Resolver Host', () => {
    it('採用receiptの実根拠をowner向けの短い日本語1文へ投影する', () => {
        const receipt = {
            classification_evidence: { source: 'prior_receipt' },
            classification: { intent: 'implement', domains: ['operations'], action_kind: 'write' },
            selected_dag_ids: ['operations.v1', 'authority.v1']
        };

        expect(buildOwnerReferenceLine(receipt)).toBe(
            '🧠 Brainbase参照: 直前の会話を引き継ぎ、運用方針と権限条件を判断しました。'
        );
    });

    it('knowledge handoffは取得済みと誤表示せず検索の必要性として表示する', () => {
        const receipt = {
            classification_evidence: { source: 'current_request' },
            classification: { intent: 'investigate', domains: ['knowledge'], action_kind: 'read' },
            selected_dag_ids: ['knowledge.v1'],
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };

        const line = buildOwnerReferenceLine(receipt);
        expect(line).toBe(
            '🧠 Brainbase参照: 現在の質問をもとに、Brainbase内の知識検索が必要かを判断しました。'
        );
        expect(line).not.toContain('取得しました');
        expect(line).not.toContain('使用しました');
    });

    it('clarification receiptは停止ではなく追加確認の判断として表示する', () => {
        const receipt = {
            status: 'needs_classification',
            classification_evidence: { source: 'current_request' },
            selected_dag_ids: ['clarification.v1']
        };

        expect(buildOwnerReferenceLine(receipt)).toBe(
            '🧠 Brainbase参照: 現在の質問をもとに、追加確認が必要かを判断しました。'
        );
    });

    it('Hostが確定した参照文を全user-facing responseの先頭行に固定する', () => {
        const receipt = {
            classification_evidence: { source: 'prior_message' },
            classification: { intent: 'answer', domains: ['engineering'], action_kind: 'none' },
            selected_dag_ids: ['problem-frame.v1']
        };
        const line = buildOwnerReferenceLine(receipt);
        const output = successOutput(receipt);

        expect(output.hookSpecificOutput.additionalContext).toContain(
            `The first line of every user-facing response must be exactly this Host-generated line, before any other text:\n${line}`
        );
    });

    it('raw transcriptから順序付き文脈を作り、host envelopeと内部情報を除外する', () => {
        const root = temporaryDirectory();
        const transcript = join(root, 'session.jsonl');
        const sessionId = 'private-session-id';
        const turnId = 'turn-current';
        const prompt = 'それでいい。修正して';
        writeFileSync(transcript, [
            event('session_meta', { id: sessionId }),
            event('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<recommended_plugins>hidden</recommended_plugins>' }] }),
            event('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'hidden instruction body' }] }),
            event('response_item', {
                type: 'message', role: 'user', content: [{ type: 'input_text', text: '文脈は入る？' }],
                internal_chat_message_metadata_passthrough: { turn_id: 'turn-prior', phase: 'final' }
            }),
            event('response_item', {
                type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hostが生の履歴を渡します。' }],
                internal_chat_message_metadata_passthrough: { turn_id: 'turn-prior', phase: 'final' }
            }),
            event('response_item', { type: 'function_call', name: 'exec', arguments: '{"secret":"hidden"}' }),
            event('response_item', {
                type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }],
                internal_chat_message_metadata_passthrough: { turn_id: turnId }
            })
        ].join('\n'));

        const args = buildJudgmentRequest({
            hook_event_name: 'UserPromptSubmit', session_id: sessionId, turn_id: turnId,
            transcript_path: transcript, cwd: process.cwd(), model: 'gpt-test',
            permission_mode: 'never', prompt
        }, {
            env: {
                BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
                BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal')
            }
        });

        expect(args.request).toBe(prompt);
        expect(args.conversation_context.messages).toEqual([
            { sequence: 0, turn_id: 'turn-prior', role: 'user', phase: 'final', text: '文脈は入る？' },
            { sequence: 1, turn_id: 'turn-prior', role: 'assistant', phase: 'final', text: 'Hostが生の履歴を渡します。' },
            { sequence: 2, turn_id: turnId, role: 'user', phase: null, text: prompt }
        ]);
        expect(args.conversation_context.messages.filter((message) => message.turn_id === turnId)).toHaveLength(1);
        expect(args.conversation_context.runtime).toMatchObject({ host: 'codex', model: 'gpt-test', permission_mode: 'never' });
        expect(args.conversation_context.instruction_bindings).toContainEqual(expect.objectContaining({
            scope: 'repository', source_ref: 'AGENTS.md'
        }));
        expect(canonicalJson(args)).not.toContain(sessionId);
        expect(canonicalJson(args)).not.toContain(transcript);
        const { source_digest: _digest, ...withoutDigest } = args.conversation_context;
        expect(args.conversation_context.source_digest).toBe(hash(canonicalJson(withoutDigest)));
    });

    it('rolloutとroot sessionの複数metaがあっても一致済みsessionを維持する', () => {
        const root = temporaryDirectory();
        const transcript = join(root, 'session.jsonl');
        const rolloutSessionId = 'rollout-session-id';
        const rootSessionId = 'root-session-id';
        writeFileSync(transcript, [
            event('session_meta', { id: rolloutSessionId, session_id: rootSessionId }),
            event('session_meta', { id: rootSessionId, session_id: rootSessionId }),
            event('response_item', {
                type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Resolverの実装に進んで' }],
                internal_chat_message_metadata_passthrough: { turn_id: 'turn-prior' }
            })
        ].join('\n'));

        const args = buildJudgmentRequest({
            session_id: rolloutSessionId, turn_id: 'turn-current', prompt: 'それでいい。修正して',
            transcript_path: transcript, cwd: process.cwd()
        }, {
            env: {
                BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: root,
                BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal')
            }
        });

        expect(args.conversation_context.completeness).toBe('complete');
        expect(args.conversation_context.messages.map((message) => message.text)).toEqual([
            'Resolverの実装に進んで',
            'それでいい。修正して'
        ]);
    });

    it('receipt採用前だけtransient retryし、同じturnでは採用済みreceiptを再利用する', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const args = buildJudgmentRequest({
            session_id: 'session-retry', turn_id: 'turn-retry', prompt: '判断して', cwd: process.cwd()
        }, { env });
        const receipt = validReceipt(args);
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({
                ok: false, status: 503,
                json: async () => ({ reason: 'brainbase_api_unavailable' })
            })
            .mockResolvedValueOnce({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            });

        await expect(resolveAndAdopt(args, { env, fetchImpl })).resolves.toEqual(receipt);
        await expect(resolveAndAdopt(args, {
            env,
            fetchImpl: vi.fn(() => { throw new Error('must not fetch after adoption'); })
        })).resolves.toEqual(receipt);
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        const sessionRef = args.conversation_context.session_ref;
        const journalFiles = readFileSync(join(root, 'journal', sessionRef, `${hash(args.turn_id)}.json`), 'utf8');
        expect(JSON.parse(journalFiles).receipt.resolution_id).toBe('jr_host_test');
    });

    it('requestに束縛されないreceiptを採用しない', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const args = buildJudgmentRequest({
            session_id: 'session-invalid', turn_id: 'turn-invalid', prompt: '判断して', cwd: process.cwd()
        }, { env });
        const receipt = { ...validReceipt(args), request_digest: '0'.repeat(64) };
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ management_status: 'managed', receipt })
        });

        await expect(resolveAndAdopt(args, { env, fetchImpl })).rejects.toThrow('judgment_receipt_request_mismatch');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
