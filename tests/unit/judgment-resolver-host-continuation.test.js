import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildJudgmentRequest, canonicalJson, finalizeEpisode, recordBrainbaseToolUse, startEpisode
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const roots = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'hook-continuation-'));
    roots.push(root);
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const payload = { session_id: 'session', turn_id: 'turn', cwd: process.cwd(), prompt: '修正して' };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = {
        resolution_id: 'jr_continuation_test', turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)), context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved', host_binding: { status: 'managed' },
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Implement.' }],
        runtime_version: 'judgment-runtime-2.4.4',
        classification: { intent: 'implement', action_kind: 'write', risk: 'medium', domains: ['engineering'] },
        selected_dag_ids: ['engineering.v1', 'authority.v1'],
        autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope', autonomy_policy_ids: [],
        allowed_runtime_escalation_reasons: ['irreversible_action', 'missing_authority', 'owner_value_choice', 'required_input_unavailable', 'evidenced_terminal_blocker']
    };
    const episode = await startEpisode(payload, {
        env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }) })
    });
    let id = 0;
    const tool = (name, input, response) => recordBrainbaseToolUse({
        ...payload, tool_name: name, tool_use_id: `tool-${++id}`, tool_input: input, tool_response: response
    }, { env });
    const state = (status, reason = null) => {
        const input = { status, pending_safe_work: status === 'pending', runtime_reason_code: reason };
        return tool('mcp__brainbase__brainbase_judgment_state_record', input,
            { status: 'ok', data: { schema_version: 'brainbase-stop-state-v1', ...input } });
    };
    const audit = (continuation = false) => [episode.owner_audit.display_line,
        episode.audit_contract.zero_call_display_line,
        ...(continuation ? [episode.audit_contract.outcome_continuation_complete_line] : []),
        episode.audit_contract.stop_repair_complete_line].join('\n');
    const stop = (body = 'まだ安全な残作業があります。', active = true, continuation = true) => finalizeEpisode({
        ...payload, stop_hook_active: active, last_assistant_message: `${audit(continuation)}\n${body}`
    }, { env });
    const begin = () => { state('pending'); return stop('まだ安全な残作業があります。', false, false); };
    const work = (success = true) => tool('apply_patch', { patch: 'test fixture' }, { success });
    const directory = join(root, 'journal', hash(payload.session_id));
    return { env, payload, episode, tool, state, stop, begin, work, directory };
}

describe('Stop continuation outcome boundary', () => {
    it('継続前の作業とstateだけの再登録を継続後の実行に数えない', async () => {
        const f = await fixture();
        f.work();
        const first = f.begin();
        expect(first.output.decision).toBe('block');
        expect(first.output.reason).toContain('まず承認済み範囲の安全な次の作業・検証を実際に実行');
        expect(first.output.reason).not.toContain('作業完了 ✓');
        const boundary = first.continuation.event_sequence_boundary;
        f.state('completed');
        const second = f.stop('修正しました。');
        expect(second.final).toBeNull();
        expect(second.output.decision).toBe('block');
        expect(second.output.reason).toContain('差し戻し後の実行証跡がありません');
        expect(second.continuation.event_sequence_boundary).toBe(boundary);
        expect(second.continuation.stop_attempt).toBe(2);
    });

    it('継続後の実行とcompleted stateを確認して初めて継続完了を記録する', async () => {
        const f = await fixture();
        f.work(); f.begin(); f.work(); f.state('completed');
        const result = f.stop('修正と検証を完了しました。');
        expect(result.final).toMatchObject({ completion_status: 'complete',
            autonomy_continuation: { status: 'completed', execution_event_count: 1, attempt_count: 1 },
            content_verification_status: 'not_evaluated' });
    });

    it('3回の再開要求後もpendingなら未解決で有限終了し、再読込で成功に変わらない', async () => {
        const f = await fixture();
        const first = f.begin();
        expect(first.output.decision).toBe('block');
        for (const attempt of [2, 3]) {
            f.state('pending');
            const retry = f.stop();
            expect(retry.output.decision).toBe('block');
            expect(retry.continuation.stop_attempt).toBe(attempt);
            expect(JSON.parse(readFileSync(join(f.directory, `${hash('turn')}.continuation-retry-${attempt}.json`), 'utf8')).stop_attempt).toBe(attempt);
        }
        const result = f.stop();
        expect(result.output.decision).toBeUndefined();
        expect(result.output.systemMessage).toContain('継続未解決');
        expect(result.final).toMatchObject({ completion_status: 'audit_degraded',
            protocol_status: 'audit_protocol_incomplete',
            stop_state: { status: 'pending', pending_safe_work: true },
            autonomy_continuation: { status: 'unresolved', execution_event_count: 0, attempt_count: 3 } });
        expect(f.stop()).toEqual(result);
    });

    it('継続後でも許可された人間確認は作業完了と区別して止める', async () => {
        const f = await fixture();
        f.begin(); f.state('waiting_human', 'missing_authority');
        const result = f.stop('⚠️ 確認が必要[missing_authority]: 本番反映の承認をお願いします。');
        expect(result.final).toMatchObject({ completion_status: 'complete',
            autonomy_compliance_status: 'runtime_escalated',
            autonomy_continuation: { status: 'waiting_human', execution_event_count: 0 } });
    });

    it('失敗した作業やgoal記録だけでは再開後の完了証拠にならない', async () => {
        const f = await fixture();
        f.work(); f.begin(); f.work(false);
        f.tool('update_goal', { status: 'complete' }, { success: true });
        f.state('completed');
        expect(f.stop('完了しました。').output.decision).toBe('block');
    });

    it('状態登録の欠落だけなら継続前の実行を捨てず監査修復だけで完了できる', async () => {
        const f = await fixture();
        f.work();
        const first = f.stop('修正しました。', false, false);
        expect(first.output.decision).toBe('block');
        expect(first.continuation.autonomy_continuation).toBeUndefined();
        f.state('completed');
        expect(f.stop('修正しました。', true, false).final.completion_status).toBe('complete');
    });
});
