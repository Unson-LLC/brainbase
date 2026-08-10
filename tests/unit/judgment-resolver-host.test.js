import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildOwnerReferenceLine,
    buildJudgmentRequest,
    canonicalJson,
    finalizeEpisode,
    recordBrainbaseToolUse,
    resolveAndAdopt,
    startEpisode,
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
            '🧠 判断参照: 直前の「俺がbrainbaseの運用をどのように監査したいか…」を参照 → 実装依頼として継続 ✓'
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
            '🧠 判断参照: 「顧客Aの過去の意思決定をBrainbaseで確認して」を参照 → Brainbase参照先の判断が必要 ✓'
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
            '⚠️ 判断参照: 「それでいい。修正して」の対象を特定できず → 確認質問'
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
        expect(line).toBe('🧠 判断参照: 「token=[秘密情報] を使って本番環境を確認し、…」を参照 → 調査として確認 ✓');
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
            '⚠️ 判断参照: 参照元の会話を確認できず → 判断証跡を要確認'
        );
    });

    it('複数message turnでは監査ブロックを最終回答だけに固定する', () => {
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
            `The final user-facing response for this turn must start with exactly this Host-generated line, before any other text:\n${line}`
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Intermediate commentary may omit the owner-visible audit block.'
        );
        expect(output.hookSpecificOutput.additionalContext).toContain(
            'Put the complete audit block only at the start of the final response, after all Brainbase tool calls are known.'
        );
        expect(output.hookSpecificOutput.additionalContext).not.toContain('The first user-facing assistant message');
    });

    it('successOutputはフルreceipt JSONをモデル文脈に含めない', () => {
        const args = { request: '修正して', conversation_context: { messages: [] } };
        const receipt = {
            resolution_id: 'jr_private-1',
            classification: { intent: 'implement', domains: ['engineering'], action_kind: 'write' },
            selected_dag_ids: ['engineering.v1', 'authority.v1'],
            applicable_policies: [{ id: 'global.goal-before-solution.v1' }]
        };
        const output = successOutput(args, receipt);
        const context = output.hookSpecificOutput.additionalContext;
        expect(context).toContain('Brainbase Judgment Resolver Host opened one judgment episode');
        expect(context).not.toContain('jr_private-1');
        expect(context).not.toContain('global.goal-before-solution.v1');
        expect(context).not.toContain('Initial route receipt:');
        expect(context).toContain('The full route receipt stays in the per-session judgment journal');
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
                display_line: '🧠 判断参照: 「判断して」を参照 → 回答方針を確認 ✓'
            }
        });
        expect(adoption.owner_audit.text_digest).toBe(hash(adoption.owner_audit.display_line));
        expect(adoption.owner_audit.source_receipt_digest).toBe(hash(canonicalJson(receipt)));
    });

    it('UserPromptSubmitでepisodeを1件だけ開始し、Stopまではfinal receiptを作らない', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            hook_event_name: 'UserPromptSubmit', session_id: 'session-episode', turn_id: 'turn-episode',
            prompt: 'Brainbaseの設計を確認して', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            classification: { intent: 'investigate', action_kind: 'read', domains: ['knowledge'] },
            selected_dag_ids: ['knowledge.v1'],
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true, status: 200,
            json: async () => ({ management_status: 'managed', receipt })
        });

        const first = await startEpisode(payload, { env, fetchImpl });
        const second = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn(() => { throw new Error('must not resolve an open episode twice'); })
        });

        expect(first).toEqual(second);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        await expect(startEpisode({ ...payload, prompt: '同じturnの別依頼' }, {
            env,
            fetchImpl: vi.fn(() => { throw new Error('must not resolve a conflicting episode'); })
        })).rejects.toThrow('judgment_episode_start_conflict');
        expect(first).toMatchObject({
            schema_version: 'brainbase-judgment-episode-v1',
            state: 'open',
            initial_route_receipt: { resolution_id: 'jr_host_test' }
        });
        const journalDirectory = join(root, 'journal', hash(payload.session_id));
        expect(readdirSync(journalDirectory).sort()).toEqual([
            `${hash(payload.turn_id)}.episode.json`,
            `${hash(payload.turn_id)}.transition.sqlite`
        ]);
        expect(existsSync(join(journalDirectory, `${hash(payload.turn_id)}.final.json`))).toBe(false);
    });

    it('PostToolUseを複数回記録し、routingを取得済みと誤表示せずraw payloadも保存しない', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'session-tools', turn_id: 'turn-tools', prompt: '意思決定の正本を確認して', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };
        await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            })
        });

        const unrelated = recordBrainbaseToolUse({
            hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__get_context', tool_use_id: 'tool-graph',
            tool_input: { topic: 'token=sk-secret-value' },
            tool_response: { content: [{ type: 'text', text: 'raw graph answer that must not be journaled' }] }
        }, { env });
        const routingPayload = {
            hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-route',
            tool_input: { intent: '意思決定の正本 token=sk-secret-value', audience: 'team', content_type: 'team_document' },
            tool_response: {
                status: 'ok',
                data: {
                    resolution_id: 'kr_1', status: 'resolved', source_class: 'owning_repo',
                    canonical_location: { repository: 'project:brainbase', path: 'docs/' },
                    retrieval_capability: 'repository.read', searched_scope: [], absence_confirmed: false
                }
            }
        };
        const routed = recordBrainbaseToolUse(routingPayload, { env });
        const replay = recordBrainbaseToolUse(routingPayload, { env });
        const searched = recordBrainbaseToolUse({
            hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-search',
            tool_input: { query: 'Judgment Resolver' },
            tool_response: { content: [{ type: 'text', text: '📚 Brainbase検索: Graphで「Judgment Resolver」を検索 → 2件 ✓' }] }
        }, { env });

        expect(unrelated).toMatchObject({ event_kind: 'retrieve', event_sequence: 0 });
        expect(routed).toEqual(replay);
        expect(routed).toMatchObject({
            event_kind: 'route', event_sequence: 1, success: true, satisfies: ['knowledge.resolve'],
            safe_metadata: { resolution_id: 'kr_1', source_class: 'owning_repo' }
        });
        expect(routed.display_line).toBe('📚 Brainbase参照先: 「意思決定の正本 [秘密情報]」→ owning_repoのdocs/を選択 ✓');
        expect(routed.display_line).not.toMatch(/検索済み|取得/);
        expect(searched.display_line).toBe('📚 Brainbase検索: Graphで「Judgment Resolver」を検索 → 2件 ✓');
        expect(searched.event_sequence).toBe(2);

        const eventsDirectory = join(root, 'journal', hash(payload.session_id), `${hash(payload.turn_id)}.events`);
        expect(readdirSync(eventsDirectory)).toHaveLength(3);
        const journalText = readdirSync(eventsDirectory)
            .map((name) => readFileSync(join(eventsDirectory, name), 'utf8')).join('\n');
        expect(journalText).not.toContain('sk-secret-value');
        expect(journalText).not.toContain('raw graph answer');

        expect(() => recordBrainbaseToolUse({
            ...routingPayload,
            tool_response: { status: 'error', error: { code: 'changed' } }
        }, { env })).toThrow('judgment_tool_event_conflict');
    });

    it('Stopは必要なrouting証拠がなければ一度だけ継続し、再Stopで無限ループしない', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'session-stop', turn_id: 'turn-stop', prompt: '正本を確認して答えて', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };
        await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            })
        });
        recordBrainbaseToolUse({
            hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__get_context', tool_use_id: 'tool-unrelated',
            tool_input: { topic: 'Brainbase' }, tool_response: { content: [{ type: 'text', text: 'context' }] }
        }, { env });

        const first = finalizeEpisode({
            hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: false, last_assistant_message: '仮回答'
        }, { env });
        const replay = finalizeEpisode({
            hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: false, last_assistant_message: '仮回答'
        }, { env });
        expect(first.output).toMatchObject({ decision: 'block' });
        expect(replay.output).toEqual(first.output);

        const second = finalizeEpisode({
            hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: true, last_assistant_message: '証拠未取得を明示した回答'
        }, { env });
        const finalReplay = finalizeEpisode({
            hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: true, last_assistant_message: '別の回答'
        }, { env });
        expect(second.output).toEqual({});
        expect(second.final).toMatchObject({ completion_status: 'incomplete', qualifying_event_count: 0 });
        expect(finalReplay.final).toEqual(second.final);
    });

    it('SQLite transition transactionでStopをfinal receiptへ収束させる', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'session-transition', turn_id: 'turn-transition',
            prompt: '判断結果を返して', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt: {
                    ...validReceipt(args),
                    classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
                    selected_dag_ids: ['general.v1']
                } })
            })
        });
        const journalDirectory = join(root, 'journal', hash(payload.session_id));
        const transitionDatabase = join(journalDirectory, `${hash(payload.turn_id)}.transition.sqlite`);

        const result = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: true,
            last_assistant_message: `${episode.owner_audit.display_line}\n回答`
        }, { env });

        expect(result.output).toEqual({});
        expect(result.final).toMatchObject({ completion_status: 'complete' });
        expect(existsSync(transitionDatabase)).toBe(true);
        expect(existsSync(join(journalDirectory, `${hash(payload.turn_id)}.final.json`))).toBe(true);
    });

    it('継続中にknowledge routeを取得すればcompleteとして一度だけ確定する', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = { session_id: 'session-complete', turn_id: 'turn-complete', prompt: '正本を確認', cwd: process.cwd() };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            })
        });
        expect(finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: false, last_assistant_message: '仮回答'
        }, { env }).output).toMatchObject({ decision: 'block' });
        const routePayload = {
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-route',
            tool_input: { intent: '正本を確認', audience: 'team', content_type: 'team_document' },
            tool_response: {
                status: 'ok', data: {
                    resolution_id: 'kr_complete', status: 'unconfirmed', source_class: null,
                    canonical_location: null, retrieval_capability: null, next_route: 'clarify',
                    searched_scope: [], absence_confirmed: false
                }
            }
        };
        const routed = recordBrainbaseToolUse(routePayload, { env });

        const result = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: true,
            last_assistant_message: [
                episode.owner_audit.display_line,
                routed.display_line,
                '参照先が未確定だと説明'
            ].join('\n')
        }, { env });
        expect(result.output).toEqual({});
        expect(result.final).toMatchObject({
            schema_version: 'brainbase-judgment-episode-final-v2',
            completion_status: 'complete', event_count: 1, qualifying_event_count: 1
        });
        expect(recordBrainbaseToolUse(routePayload, { env })).toEqual(routed);
        expect(() => recordBrainbaseToolUse({
            ...routePayload,
            tool_use_id: 'tool-after-final'
        }, { env })).toThrow('judgment_episode_already_finalized');
    });

    it('final receiptはevent fingerprintの集合だけでなくjournal commit順序も束縛する', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'session-event-order', turn_id: 'turn-event-order',
            prompt: '判断証跡の順序を確認', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt: {
                    ...validReceipt(args),
                    classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
                    selected_dag_ids: ['general.v1']
                } })
            })
        });
        const first = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-order-first',
            tool_input: { query: 'first' },
            tool_response: { content: [{ type: 'text', text: '📚 Brainbase検索: first → 1件 ✓' }] }
        }, { env });
        const second = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-order-second',
            tool_input: { query: 'second' },
            tool_response: { content: [{ type: 'text', text: '📚 Brainbase検索: second → 1件 ✓' }] }
        }, { env });

        expect(finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: false,
            last_assistant_message: [
                episode.owner_audit.display_line,
                first.display_line,
                second.display_line,
                '回答'
            ].join('\n')
        }, { env }).final).toMatchObject({ completion_status: 'complete', event_count: 2 });

        const eventsDirectory = join(root, 'journal', hash(payload.session_id), `${hash(payload.turn_id)}.events`);
        const eventPaths = readdirSync(eventsDirectory).map((name) => join(eventsDirectory, name));
        const events = eventPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')));
        for (const [index, eventPath] of eventPaths.entries()) {
            const event = events[index];
            const peer = events[1 - index];
            writeFileSync(eventPath, `${JSON.stringify({ ...event, event_sequence: peer.event_sequence }, null, 2)}\n`);
        }

        expect(() => finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: true,
            last_assistant_message: 'replay'
        }, { env })).toThrow('judgment_episode_final_event_set_mismatch');
    });

    it('既存のv1 final receiptはlegacy digestで読み取り互換を保つ', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = {
            session_id: 'session-final-v1', turn_id: 'turn-final-v1',
            prompt: '既存receiptを再生', cwd: process.cwd()
        };
        const args = buildJudgmentRequest(payload, { env });
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt: {
                    ...validReceipt(args),
                    classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
                    selected_dag_ids: ['general.v1']
                } })
            })
        });
        const recorded = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-final-v1',
            tool_input: { query: 'legacy' },
            tool_response: { content: [{ type: 'text', text: '📚 Brainbase検索: legacy → 1件 ✓' }] }
        }, { env });
        const answer = [episode.owner_audit.display_line, recorded.display_line, '回答'].join('\n');
        const created = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: false, last_assistant_message: answer
        }, { env }).final;
        const finalPath = join(root, 'journal', hash(payload.session_id), `${hash(payload.turn_id)}.final.json`);
        writeFileSync(finalPath, `${JSON.stringify({
            ...created,
            schema_version: 'brainbase-judgment-episode-final-v1',
            event_set_digest: hash(canonicalJson([recorded.event_fingerprint].sort()))
        }, null, 2)}\n`);

        expect(finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: true, last_assistant_message: answer
        }, { env }).final).toMatchObject({
            schema_version: 'brainbase-judgment-episode-final-v1',
            completion_status: 'complete'
        });
    });

    it('Brainbase capabilityが不要ならtool call 0件でもcompleteにし、orphan eventは証拠化しない', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        expect(recordBrainbaseToolUse({
            session_id: 'orphan-session', turn_id: 'orphan-turn',
            tool_name: 'mcp__brainbase__search', tool_use_id: 'orphan-tool',
            tool_input: { query: 'orphan' }, tool_response: { status: 'ok' }
        }, { env })).toBeNull();
        expect(finalizeEpisode({
            session_id: 'orphan-session', turn_id: 'orphan-turn', stop_hook_active: false
        }, { env })).toEqual({ output: {}, final: null });

        const payload = { session_id: 'session-zero', turn_id: 'turn-zero', prompt: 'こんにちは', cwd: process.cwd() };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
            selected_dag_ids: ['general.v1']
        };
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            })
        });

        const result = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id,
            stop_hook_active: false,
            last_assistant_message: `${episode.owner_audit.display_line}\nこんにちは`
        }, { env });
        expect(result.output).toEqual({});
        expect(result.final).toMatchObject({
            completion_status: 'complete', event_count: 0, qualifying_event_count: 0,
            owner_audit_complete: true, owner_audit_line_count: 1
        });
    });

    it('Stopは保存済み監査行の欠落・順序違い・過剰表示を一度だけ再生成させる', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = { session_id: 'session-audit', turn_id: 'turn-audit', prompt: '判断証跡を見せて', cwd: process.cwd() };
        const args = buildJudgmentRequest(payload, { env });
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt: {
                    ...validReceipt(args),
                    classification: { intent: 'answer', action_kind: 'none', domains: ['general'] },
                    selected_dag_ids: ['general.v1']
                } })
            })
        });
        const eventEntry = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__search', tool_use_id: 'tool-audit-search',
            tool_input: { query: '判断' },
            tool_response: { content: [{ type: 'text', text: '📚 Brainbase検索: Graphで「判断」を検索 → 2件 ✓' }] }
        }, { env });

        const malformed = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: false,
            last_assistant_message: `${eventEntry.display_line}\n${episode.owner_audit.display_line}\n${eventEntry.display_line}\n回答`
        }, { env });
        expect(malformed.output).toMatchObject({ decision: 'block' });
        expect(malformed.output.reason).toContain(`${episode.owner_audit.display_line}\n${eventEntry.display_line}`);
        expect(malformed.continuation).toMatchObject({ missing_capabilities: ['owner.audit.display'] });

        const corrected = finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: true,
            last_assistant_message: `${episode.owner_audit.display_line}\n${eventEntry.display_line}\n回答`
        }, { env });
        expect(corrected.final).toMatchObject({
            completion_status: 'complete', owner_audit_complete: true, owner_audit_line_count: 2
        });
    });

    it('失敗したknowledge routeはrequired capabilityを満たさず、complete finalだけを次turnへ渡す', async () => {
        const root = temporaryDirectory();
        const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
        const payload = { session_id: 'session-prior', turn_id: 'turn-first', prompt: '正本を確認して', cwd: process.cwd() };
        const args = buildJudgmentRequest(payload, { env });
        const receipt = {
            ...validReceipt(args),
            plan_digest: 'a'.repeat(64),
            classification: { intent: 'investigate', action_kind: 'read', domains: ['knowledge'] },
            selected_dag_ids: ['knowledge.v1'],
            required_capabilities: [{ capability: 'knowledge.resolve', status: 'required' }]
        };
        const episode = await startEpisode(payload, {
            env,
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true, status: 200,
                json: async () => ({ management_status: 'managed', receipt })
            })
        });
        const failed = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-failed-route',
            tool_input: { intent: '正本を確認して' },
            tool_response: { status: 'error', error: { code: 'unavailable' } }
        }, { env });
        expect(failed).toMatchObject({ success: false, satisfies: [] });
        expect(finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: false
        }, { env }).output).toMatchObject({ decision: 'block' });

        const routed = recordBrainbaseToolUse({
            session_id: payload.session_id, turn_id: payload.turn_id,
            tool_name: 'mcp__brainbase__brainbase_knowledge_resolve', tool_use_id: 'tool-good-route',
            tool_input: { intent: '正本を確認して' },
            tool_response: { data: {
                resolution_id: 'kr_prior', status: 'resolved', source_class: 'owning_repo',
                canonical_location: { repository: 'project:brainbase', path: 'docs/' }
            } }
        }, { env });
        expect(finalizeEpisode({
            session_id: payload.session_id, turn_id: payload.turn_id, stop_hook_active: true,
            last_assistant_message: [
                episode.owner_audit.display_line,
                failed.display_line,
                routed.display_line,
                '参照結果'
            ].join('\n')
        }, { env }).final).toMatchObject({ completion_status: 'complete', qualifying_event_count: 1 });

        const next = buildJudgmentRequest({
            session_id: payload.session_id, turn_id: 'turn-next', prompt: '続けて', cwd: process.cwd()
        }, { env });
        expect(next.conversation_context.prior_receipts).toEqual([
            expect.objectContaining({ turn_id: 'turn-first', resolution_id: 'jr_host_test' })
        ]);
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
