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
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }]
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Codex Judgment Resolver Host', () => {
    it('prior receiptの根拠turnから具体的な会話をowner向け1行へ投影する', () => {
        const args = {
            request: 'そうだね、そのようなメッセージが表示されるように修正して',
            turn_id: 'turn-current',
            conversation_context: {
                messages: [
                    {
                        sequence: 0,
                        turn_id: 'turn-prior',
                        role: 'user',
                        phase: 'final',
                        text: '俺がbrainbaseの運用をどのように監査したいか個人KGを引いてシミュレーションしてみろ'
                    },
                    {
                        sequence: 1,
                        turn_id: 'turn-current',
                        role: 'user',
                        phase: null,
                        text: 'そうだね、そのようなメッセージが表示されるように修正して'
                    }
                ]
            }
        };
        const receipt = {
            classification_evidence: { source: 'prior_receipt', source_turn_ids: ['turn-prior'] },
            classification: { intent: 'implement', domains: ['operations'], action_kind: 'write' },
            selected_dag_ids: ['operations.v1', 'authority.v1']
        };

        expect(buildOwnerReferenceLine(args, receipt)).toBe(
            '🧠 Brainbase参照: 直前の「俺がbrainbaseの運用をどのように監査したいか…」を参照 → 実装依頼として継続 ✓'
        );
    });

    it('current requestの具体的な内容とknowledge handoffの判断を表示する', () => {
        const args = {
            request: '顧客Aの過去の意思決定をBrainbaseで確認して',
            turn_id: 'turn-current',
            conversation_context: {
                messages: [{
                    sequence: 0,
                    turn_id: 'turn-current',
                    role: 'user',
                    phase: null,
                    text: '顧客Aの過去の意思決定をBrainbaseで確認して'
                }]
            }
        };
        const receipt = {
            classification_evidence: { source: 'current_request', source_turn_ids: ['turn-current'] },
            classification: { intent: 'investigate', domains: ['knowledge'], action_kind: 'read' },
            selected_dag_ids: ['knowledge.v1'],
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };

        const line = buildOwnerReferenceLine(args, receipt);
        expect(line).toBe(
            '🧠 Brainbase参照: 「顧客Aの過去の意思決定をBrainbaseで確認して」を参照 → Brainbase内検索が必要と判断 ✓'
        );
        expect(line).not.toContain('取得しました');
        expect(line).not.toContain('使用しました');
    });

    it('clarification receiptは停止ではなく追加確認の判断として表示する', () => {
        const args = {
            request: 'それでいい。修正して',
            turn_id: 'turn-current',
            conversation_context: { messages: [] }
        };
        const receipt = {
            status: 'needs_classification',
            classification_evidence: { source: 'current_request' },
            selected_dag_ids: ['clarification.v1']
        };

        expect(buildOwnerReferenceLine(args, receipt)).toBe(
            '⚠️ Brainbase参照: 「それでいい。修正して」の対象を特定できず → 確認質問'
        );
    });

    it('監査行を1行に保ち、秘密らしい値と長文を表示しない', () => {
        const args = {
            request: 'token=sk-secret-value-1234567890\nを使って本番環境を確認し、その後の長い説明も参照して判断して',
            turn_id: 'turn-current',
            conversation_context: { messages: [] }
        };
        const receipt = {
            classification_evidence: { source: 'current_request' },
            classification: { intent: 'investigate', domains: ['operations'], action_kind: 'read' },
            selected_dag_ids: ['operations.v1']
        };

        const line = buildOwnerReferenceLine(args, receipt);
        expect(line).toBe('🧠 Brainbase参照: 「token=[秘密情報] を使って本番環境を確認し、…」を参照 → 調査として確認 ✓');
        expect(line).not.toContain('sk-secret-value');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('receiptが指定したprior turnを見つけられない場合は別の会話へ黙って代替しない', () => {
        const args = {
            request: 'それでいい',
            turn_id: 'turn-current',
            conversation_context: {
                messages: [{ turn_id: 'turn-other', role: 'user', text: '別件を実装して' }]
            }
        };
        const receipt = {
            status: 'resolved',
            classification_evidence: { source: 'prior_receipt', source_turn_ids: ['turn-missing'] },
            classification: { intent: 'implement', action_kind: 'write' },
            selected_dag_ids: ['operations.v1']
        };

        expect(buildOwnerReferenceLine(args, receipt)).toBe(
            '⚠️ Brainbase参照: 参照元の会話を確認できず → 判断証跡を要確認'
        );
    });

    it('Hostが確定した参照文を全user-facing responseの先頭行に固定する', () => {
        const args = {
            request: 'この設計をレビューして',
            turn_id: 'turn-current',
            conversation_context: { messages: [] }
        };
        const receipt = {
            classification_evidence: { source: 'prior_message' },
            classification: { intent: 'answer', domains: ['engineering'], action_kind: 'none' },
            selected_dag_ids: ['problem-frame.v1']
        };
        const line = buildOwnerReferenceLine(args, receipt);
        const output = successOutput(args, receipt);

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
        const adoption = JSON.parse(journalFiles);
        expect(adoption).toMatchObject({
            schema_version: 'brainbase-judgment-adoption-v2',
            receipt: { resolution_id: 'jr_host_test' },
            owner_audit: {
                schema_version: 'brainbase-owner-audit-v1',
                historical_exact: true,
                source_kind: 'current_request',
                source_turn_ids: ['turn-retry'],
                source_excerpt: '判断して',
                display_line: '🧠 Brainbase参照: 「判断して」を参照 → 回答方針を確認 ✓'
            }
        });
        expect(adoption.owner_audit.text_digest).toBe(hash(adoption.owner_audit.display_line));
        expect(adoption.owner_audit.source_receipt_digest).toBe(hash(canonicalJson(receipt)));
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
