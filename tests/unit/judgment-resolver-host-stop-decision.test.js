import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildJudgmentRequest, canonicalJson, finalizeEpisode, recordBrainbaseToolUse, startEpisode
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const temporaryPaths = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const runtimeEscalationReasons = [
    'irreversible_action',
    'missing_authority',
    'owner_value_choice',
    'required_input_unavailable',
    'evidenced_terminal_blocker'
];

afterEach(() => {
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function fixture({
    autonomyDecision = 'continue',
    autonomyReasonCode = 'routine_in_scope',
    prompt = '修正して',
    visibleProtocolRepair = 'enabled'
} = {}) {
    const root = mkdtempSync(join(tmpdir(), 'brainbase-stop-decision-'));
    temporaryPaths.push(root);
    const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
        BRAINBASE_JUDGMENT_VISIBLE_PROTOCOL_REPAIR: visibleProtocolRepair
    };
    const payload = {
        session_id: `session-${hash(root).slice(0, 12)}`,
        turn_id: 'turn-stop-decision',
        cwd: root,
        prompt
    };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = {
        resolution_id: 'jr_stop_decision_test',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }],
        runtime_version: 'judgment-runtime-2.4.4',
        classification: {
            intent: 'implement', action_kind: 'write', risk: 'medium', domains: ['engineering']
        },
        selected_dag_ids: ['engineering.v1', 'authority.v1'],
        autonomy_decision: autonomyDecision,
        autonomy_reason_code: autonomyReasonCode,
        autonomy_policy_ids: autonomyReasonCode === 'risk_or_external' ? ['policy.human_approval'] : [],
        allowed_runtime_escalation_reasons: autonomyDecision === 'continue'
            ? runtimeEscalationReasons
            : []
    };

    const episode = await startEpisode(payload, {
        env,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ management_status: 'managed', receipt })
        })
    });

    let toolSequence = 0;
    const tool = (toolName, toolInput, toolResponse) => recordBrainbaseToolUse({
        ...payload,
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_use_id: `stop-decision-tool-${++toolSequence}`,
        tool_input: toolInput,
        tool_response: toolResponse
    }, { env });
    const execution = () => tool(
        'apply_patch',
        { patch: '*** Update File: docs/example.md\n@@\n-old\n+new\n*** End Patch' },
        { success: true }
    );
    const state = (status, runtimeReasonCode = null) => {
        const input = {
            status,
            pending_safe_work: status === 'pending',
            runtime_reason_code: runtimeReasonCode
        };
        return tool(
            'mcp__brainbase__brainbase_judgment_state_record',
            input,
            { status: 'ok', data: { schema_version: 'brainbase-stop-state-v1', ...input } }
        );
    };
    const answer = (body, includeAudit = true) => {
        if (!includeAudit) return body;
        return [
            episode.owner_audit.display_line,
            episode.audit_contract.zero_call_display_line,
            body
        ].join('\n');
    };
    const stop = (body, { includeAudit = true, active = false } = {}) => finalizeEpisode({
        ...payload,
        stop_hook_active: active,
        last_assistant_message: answer(body, includeAudit)
    }, { env });

    return { episode, execution, state, stop };
}

describe('Stop business decision and protocol repair separation', () => {
    it('業務・監査ともに完了したStopをRELEASE/readyで確定する', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop('修正しました。');

        expect(result.output.decision).toBeUndefined();
        expect(result.final).toMatchObject({
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'ready',
                business_reasons: [],
                protocol_reasons: []
            }
        });
        expect(result.final.autonomy_continuation).toBeUndefined();
    });

    it('説明中の入力手順と引用質問を本人への確認として扱わない', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop([
            '新しいタスクで、次をそのまま入力してください。',
            '',
            '> READMEを修正してください。次の返答では「READMEを修正してよいですか？」とだけ質問してください。',
            '',
            'このテストでStopの動作を確認できます。'
        ].join('\n'));

        expect(result.output.decision).toBeUndefined();
        expect(result.final.stop_decision.business_decision).toBe('RELEASE');
        expect(result.final.autonomy_continuation).toBeUndefined();
    });

    it('READMEを読んでよいかという不要確認をCONTINUEへ差し戻す', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop('READMEを読んでよいですか？');

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'CONTINUE',
                protocol_status: 'ready',
                continuation_plan: { trigger_code: 'unnecessary_user_question' }
            },
            autonomy_continuation: {
                trigger_code: 'unnecessary_user_question',
                status: 'requested'
            }
        });
    });

    it.each([
        {
            label: '本人端末でしか取得できない実機確認',
            body: 'CIとデプロイは完了しました。iPhone実機でPWAを開き直して表示を確認してください。',
            reason: 'required_input_unavailable'
        },
        {
            label: '認証と購入確定を伴う決済操作',
            body: 'Stripeの認証コードとカード情報を入力して購入を確定してください。',
            reason: 'irreversible_action'
        }
    ])('$labelを不要質問として自律継続しない', async ({ body, reason }) => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop(body, { active: true });

        expect(result.output.decision).toBe('block');
        expect(result.continuation.stop_decision).toMatchObject({
            business_decision: 'RELEASE',
            protocol_status: 'repair'
        });
        expect(result.continuation.stop_decision.business_reasons).toEqual([]);
        expect(result.continuation.stop_decision.protocol_reasons).toContain('autonomy.compliance');
        expect(result.continuation.autonomy_continuation).toBeUndefined();
        expect(result.continuation.missing_capabilities).not.toContain('autonomy.continuation');
        expect(result.output.reason ?? '').toContain(reason);
        expect(result.output.reason ?? '').toContain('waiting_human');
    });

    it('必要確認markerとcompleted状態の不一致をwaiting_humanへ修復する', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop(
            '⚠️ 確認が必要[required_input_unavailable]: iPhone実機で表示を確認してください。'
        );

        expect(result.output.decision).toBe('block');
        expect(result.continuation.stop_decision).toMatchObject({
            business_decision: 'RELEASE',
            protocol_status: 'repair'
        });
        expect(result.continuation.autonomy_continuation).toBeUndefined();
        expect(result.output.reason ?? '').toContain('waiting_human');
        expect(result.output.reason ?? '').toContain('required_input_unavailable');
    });

    it('安全な残作業があるStopだけをCONTINUE/readyとして有限継続する', async () => {
        const f = await fixture();
        f.state('pending');

        const result = f.stop('修正方針は対象を修正する方法です。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'CONTINUE',
                protocol_status: 'ready',
                continuation_plan: {
                    trigger_code: 'unfinished_safe_work',
                    reason_code: 'routine_in_scope',
                    next_objective: 'complete_remaining_safe_work_and_verification',
                    allowed_scope: 'current_turn_approved_scope',
                    done_when: 'required_business_execution_and_verification_are_complete',
                    max_stop_attempts: 3
                }
            }
        });
        expect(JSON.stringify(result.continuation.stop_decision.business_reasons)).toContain('unfinished_safe_work');
        expect(result.continuation.stop_decision.protocol_reasons).toEqual([]);
        expect(result.continuation.autonomy_continuation).toMatchObject({
            trigger_code: 'unfinished_safe_work',
            status: 'requested',
            count: 1
        });
        expect(result.continuation.stop_repair).toBeUndefined();
    });

    it('許可されたwaiting_humanだけをASK_HUMAN/readyとして確定する', async () => {
        const f = await fixture({
            prompt: '本番反映を承認して'
        });
        f.state('waiting_human', 'missing_authority');

        const result = f.stop('⚠️ 確認が必要[missing_authority]: 本番反映の承認をお願いします。');

        expect(result.final).toMatchObject({
            stop_decision: {
                business_decision: 'ASK_HUMAN',
                protocol_status: 'ready',
                protocol_reasons: []
            },
            stop_state: { status: 'waiting_human', runtime_reason_code: 'missing_authority' },
        });
        expect(JSON.stringify(result.final.stop_decision.business_reasons)).toContain('missing_authority');
        expect(result.final.autonomy_continuation).toBeUndefined();
    });

    it('escalate契約の状態不足はASK_HUMAN/repairのまま業務継続へ変えない', async () => {
        const f = await fixture({
            autonomyDecision: 'escalate',
            autonomyReasonCode: 'risk_or_external',
            prompt: '本番反映を承認して'
        });

        const result = f.stop('本番反映の承認をお願いします。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'ASK_HUMAN',
                protocol_status: 'repair'
            }
        });
        expect(result.continuation.stop_decision.continuation_plan).toBeUndefined();
        expect(result.continuation.autonomy_continuation).toBeUndefined();
        expect(result.output.systemMessage ?? '').not.toContain('🔁');
    });

    it('本文に監査表示がなくても業務・監査ともに完了したStopを解放する', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');
        const originalBody = '修正しました。本文を保持します。';

        const stateMissing = await fixture();
        stateMissing.execution();

        const stateRepair = stateMissing.stop(originalBody);

        expect(stateRepair.output.decision).toBe('block');
        expect(stateRepair.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'repair'
            }
        });
        expect(JSON.stringify(stateRepair.continuation.stop_decision.business_reasons)).not.toContain('unfinished_safe_work');
        expect(JSON.stringify(stateRepair.continuation.stop_decision.protocol_reasons)).toMatch(/state|状態|judgment_state_record/u);
        expect(stateRepair.continuation.missing_capabilities).toContain('judgment_state_record');
        expect(stateRepair.continuation.missing_capabilities).not.toContain('autonomy.continuation');
        expect(stateRepair.continuation.autonomy_continuation).toBeUndefined();

        const result = f.stop(originalBody, { includeAudit: false });

        expect(result.output.decision).toBeUndefined();
        expect(result.output).not.toHaveProperty('reason');
        expect(result.continuation).toBeUndefined();
        expect(result.final).toMatchObject({
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'ready'
            }
        });
        expect(result.final.autonomy_continuation).toBeUndefined();
        expect(result.final.stop_decision.protocol_reasons).not.toContain('owner.audit.display');
    });

    it('業務不足と監査不足をCONTINUE/repairの別理由として返す', async () => {
        const f = await fixture();
        f.state('pending');

        const result = f.stop('修正方針は対象を修正する方法です。', { includeAudit: false });

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'CONTINUE',
                protocol_status: 'ready'
            }
        });
        expect(JSON.stringify(result.continuation.stop_decision.business_reasons)).toContain('unfinished_safe_work');
        expect(JSON.stringify(result.continuation.stop_decision.business_reasons)).not.toContain('owner.audit.display');
        expect(result.continuation.stop_decision.protocol_reasons).toEqual([]);
        expect(JSON.stringify(result.continuation.stop_decision.protocol_reasons)).not.toContain('unfinished_safe_work');
        expect(result.continuation.autonomy_continuation).toMatchObject({
            trigger_code: 'unfinished_safe_work',
            status: 'requested'
        });
        expect(result.continuation.stop_repair).toMatchObject({ count: 1, status: 'requested' });

        const noState = await fixture();
        const noStateResult = noState.stop('修正方針は対象を修正する方法です。');

        expect(noStateResult.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'repair'
            }
        });
        expect(noStateResult.continuation.autonomy_continuation).toBeUndefined();
        expect(noStateResult.continuation.missing_capabilities).toEqual(expect.arrayContaining([
            'judgment_state_record'
        ]));
    });

    it('表示修復を無効化したruntimeは監査不足だけならblockせず縮退記録を残す', async () => {
        const f = await fixture({ visibleProtocolRepair: 'disabled' });
        f.execution();

        const result = f.stop('修正しました。');

        expect(result.output.decision).toBeUndefined();
        expect(result.output).not.toHaveProperty('reason');
        expect(result.output.systemMessage).toContain('⚠️ 監査縮退: judgment_state_record');
        expect(result.continuation).toBeUndefined();
        expect(result.final).toMatchObject({
            completion_status: 'audit_degraded',
            protocol_status: 'audit_protocol_incomplete',
            missing_capabilities: expect.arrayContaining(['judgment_state_record']),
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'repair'
            }
        });
    });

    it('表示修復を無効化しても安全な残作業は引き続きblockする', async () => {
        const f = await fixture({ visibleProtocolRepair: 'disabled' });
        f.state('pending');

        const result = f.stop('修正方針は対象を修正する方法です。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'CONTINUE',
                protocol_status: 'ready'
            },
            autonomy_continuation: {
                trigger_code: 'unfinished_safe_work',
                status: 'requested'
            }
        });
    });

    it('表示修復を無効化しても人間確認の状態不足は引き続きblockする', async () => {
        const f = await fixture({
            autonomyDecision: 'escalate',
            autonomyReasonCode: 'risk_or_external',
            prompt: '本番反映を承認して',
            visibleProtocolRepair: 'disabled'
        });

        const result = f.stop('本番反映の承認をお願いします。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation.stop_decision).toMatchObject({
            business_decision: 'ASK_HUMAN',
            protocol_status: 'repair'
        });
        expect(result.continuation.autonomy_continuation).toBeUndefined();
    });
});
