import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildJudgmentRequest,
    canonicalJson,
    finalizeEpisode,
    recordBrainbaseToolUse,
    startEpisode
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
const nodeIds = ['entry', 'reconcile', 'goal', 'problem-frame', 'observe', 'hypothesis', 'prediction', 'falsify', 'constraints', 'generate', 'reject', 'decide', 'merge', 'receipt'];
const evidenceNodeIds = new Set(['problem-frame', 'observe', 'falsify', 'decide']);

function retrievalAuditEnvelope(operation = '検索') {
    return `<!-- brainbase-knowledge-owner-audit:${JSON.stringify({
        schema_version: 'brainbase-knowledge-owner-audit-v1',
        operation,
        outcome: '結果を取得'
    })} -->`;
}

function activeNodeDefinitions() {
    return nodeIds.map((id) => ({
        id,
        kind: id === 'entry' || id === 'reconcile' || id === 'merge' || id === 'receipt' ? 'common' : 'judgment',
        instruction: `Run ${id}.`,
        ...(evidenceNodeIds.has(id) ? { execution_contract: 'judgment-node-evidence-v1' } : {})
    }));
}

function activeEdges() {
    return nodeIds.slice(0, -1).map((id, index) => [id, nodeIds[index + 1]]);
}

async function fixture({
    autonomyDecision = 'continue',
    autonomyReasonCode = 'routine_in_scope',
    prompt = 'UI改善の結論を検証する'
} = {}) {
    const root = mkdtempSync(join(tmpdir(), 'brainbase-node-evidence-'));
    temporaryPaths.push(root);
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const payload = {
        session_id: `session-${hash(root).slice(0, 12)}`,
        turn_id: 'turn-node-evidence',
        cwd: root,
        prompt
    };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = {
        resolution_id: 'jr_node_evidence_test',
        turn_id: args.turn_id,
        request_digest: hash(canonicalJson(args)),
        context_digest: hash(canonicalJson(args.conversation_context)),
        status: 'resolved',
        host_binding: { status: 'managed' },
        classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
        active_node_definitions: activeNodeDefinitions(),
        active_nodes: nodeIds,
        active_edges: activeEdges(),
        runtime_version: 'judgment-runtime-2.4.4',
        classification: {
            intent: 'investigate', action_kind: 'read', risk: 'medium', domains: ['engineering']
        },
        selected_dag_ids: ['engineering.v1'],
        autonomy_decision: autonomyDecision,
        autonomy_reason_code: autonomyReasonCode,
        autonomy_policy_ids: autonomyDecision === 'escalate' ? ['policy.human_approval'] : [],
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

    let sequence = 0;
    const call = (toolName, toolInput, toolResponse, {
        hookEventName = 'PostToolUse',
        error,
        isInterrupt,
        nativeFailureResult
    } = {}) => recordBrainbaseToolUse({
        ...payload,
        hook_event_name: hookEventName,
        tool_name: toolName,
        tool_use_id: `node-evidence-tool-${++sequence}`,
        tool_input: toolInput,
        tool_response: toolResponse,
        ...(error === undefined ? {} : { error }),
        ...(isInterrupt === undefined ? {} : { is_interrupt: isInterrupt })
    }, { env, ...(nativeFailureResult === undefined ? {} : { nativeFailureResult }) });

    const search = (query = 'primary evidence') => {
        const event = call(
            'mcp__brainbase__search',
            { query },
            { content: [
                { type: 'text', text: `evidence for ${query}` },
                { type: 'text', text: retrievalAuditEnvelope() }
            ] }
        );
        return { id: event.tool_use_id, event };
    };

    const failedSearch = (query = 'failed retrieval') => {
        const event = call(
            'mcp__brainbase__search',
            { query },
            { content: [{ type: 'text', text: 'upstream failed' }] },
            { hookEventName: 'PostToolUseFailure', error: 'upstream unavailable', isInterrupt: false, nativeFailureResult: { error: 'failed' } }
        );
        return { id: event.tool_use_id, event };
    };

    const node = ({
        nodeId,
        status = 'supported',
        finding = `${nodeId} supports the current framing.`,
        evidenceFit = 'The retrieved evidence directly tests the current question.',
        unknowns = ['The remaining uncertainty is bounded.'],
        evidenceToolUseIds = [],
        previousResultToolUseId = null,
        nextAction = 'Continue to the next judgment stage.',
        responseOverrides = {}
    }) => {
        const input = {
            node_id: nodeId,
            status,
            finding,
            evidence_fit: evidenceFit,
            unknowns,
            evidence_tool_use_ids: evidenceToolUseIds,
            previous_result_tool_use_id: previousResultToolUseId,
            next_action: nextAction
        };
        const event = call(
            'mcp__brainbase__brainbase_judgment_node_record',
            input,
            { status: 'ok', data: { schema_version: 'brainbase-judgment-node-result-v1', ...input, ...responseOverrides } }
        );
        return { id: event.tool_use_id, event, input };
    };

    const execution = () => call(
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
        return call(
            'mcp__brainbase__brainbase_judgment_state_record',
            input,
            { status: 'ok', data: { schema_version: 'brainbase-stop-state-v1', ...input } }
        );
    };

    const answer = (body) => [
        episode.owner_audit.display_line,
        episode.audit_contract.zero_call_display_line,
        body
    ].join('\n');
    const stop = (body) => finalizeEpisode({
        ...payload,
        stop_hook_active: false,
        last_assistant_message: answer(body)
    }, { env });

    return { episode, search, failedSearch, node, execution, state, stop };
}

describe('judgment node evidence Host integration', () => {
    it('missing node results become a bounded protocol repair after actual execution', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const result = f.stop('調査結果を報告します。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation).toMatchObject({
            stop_decision: {
                business_decision: 'RELEASE',
                protocol_status: 'repair',
                protocol_reasons: expect.arrayContaining(['judgment.node_evidence'])
            },
            missing_capabilities: expect.arrayContaining(['judgment.node_evidence'])
        });
        expect(result.output.reason).toContain('problem-frame');
        expect(result.output.reason).toContain('brainbase_judgment_node_record');
        expect(result.output.reason).not.toContain('最終回答の先頭に次の監査行');
        expect(result.output.reason).not.toContain(f.episode.owner_audit.display_line);
        expect(result.output.reason).not.toContain('📚 Brainbase未参照');
    });

    it('fake and failed evidence references cannot support a node result', async () => {
        const f = await fixture();
        const failed = f.failedSearch();
        const fake = f.node({
            nodeId: 'problem-frame',
            evidenceToolUseIds: ['not-an-event'],
            finding: 'This is a fabricated support claim.'
        });
        const failedEvidence = f.node({
            nodeId: 'observe',
            evidenceToolUseIds: [failed.id],
            previousResultToolUseId: fake.id,
            finding: 'This relies on a failed retrieval.'
        });
        f.state('completed');

        const result = f.stop('根拠を検証できませんでした。');

        expect(failed.event.success).toBe(false);
        expect(fake.event.success).toBe(true);
        expect(failedEvidence.event.success).toBe(true);
        expect(result.output.decision).toBe('block');
        expect(result.continuation.missing_capabilities).toContain('judgment.node_evidence');
        expect(result.output.reason).toContain('problem-frame');
    });

    it('normalizes node response whitespace but rejects a semantic response mismatch', async () => {
        const f = await fixture();
        const evidence = f.search('problem framing');
        const padded = f.node({
            nodeId: 'problem-frame',
            evidenceToolUseIds: [evidence.id],
            responseOverrides: {
                finding: '  problem-frame supports the current framing.  ',
                evidence_fit: '  The retrieved evidence directly tests the current question.  ',
                unknowns: ['  The remaining uncertainty is bounded.  '],
                next_action: '  Continue to the next judgment stage.  '
            }
        });
        expect(padded.event.success).toBe(true);

        const mismatch = f.node({
            nodeId: 'observe',
            evidenceToolUseIds: [evidence.id],
            previousResultToolUseId: padded.id,
            responseOverrides: { finding: 'The response does not match the submitted finding.' }
        });
        expect(mismatch.event.success).toBe(false);
        f.state('completed');

        const result = f.stop('応答整合性を検証しました。');
        expect(result.output.decision).toBe('block');
        expect(result.continuation.missing_capabilities).toContain('judgment.node_evidence');
    });

    it('insufficient observe returns its concrete next action instead of completing', async () => {
        const f = await fixture();
        const problemEvidence = f.search('problem framing');
        const problem = f.node({
            nodeId: 'problem-frame',
            evidenceToolUseIds: [problemEvidence.id]
        });
        const observeEvidence = f.search('behavior-generation research');
        f.node({
            nodeId: 'observe',
            status: 'insufficient',
            finding: 'The evaluation dataset is not enough to identify the behavior-generation model.',
            evidenceFit: 'It exposes the missing causal evidence but does not resolve it.',
            unknowns: ['The behavior-generation model is still unverified.'],
            evidenceToolUseIds: [observeEvidence.id],
            previousResultToolUseId: problem.id,
            nextAction: '一次資料の行動生成モデルを追加取得してobserveを再評価する。'
        });
        f.state('completed');

        const result = f.stop('不足している根拠を明示しました。');

        expect(result.output.decision).toBe('block');
        expect(result.continuation.missing_capabilities).toContain('judgment.node_evidence');
        expect(result.output.reason).toContain('一次資料の行動生成モデルを追加取得してobserveを再評価する。');
    });

    it('new retrieval and reassessment after insufficient observe can complete the chain', async () => {
        const f = await fixture();
        const problemEvidence = f.search('problem framing');
        const problem = f.node({ nodeId: 'problem-frame', evidenceToolUseIds: [problemEvidence.id] });
        expect(problemEvidence.event.system_message).toContain(`判断の参照ID: ${problemEvidence.id} (search)`);
        expect(problem.event.system_message).toContain(`判断の参照ID: ${problem.id} (node_evidence)`);
        const firstObserveEvidence = f.search('evaluation dataset');
        const insufficientObserve = f.node({
            nodeId: 'observe',
            status: 'insufficient',
            finding: 'The benchmark does not identify the behavior-generation model.',
            evidenceFit: 'The result establishes the gap, not the missing causal mechanism.',
            unknowns: ['The behavior-generation model is unknown.'],
            evidenceToolUseIds: [firstObserveEvidence.id],
            previousResultToolUseId: problem.id,
            nextAction: 'Retrieve primary behavior-generation research and reassess observe.'
        });
        const secondObserveEvidence = f.search('primary behavior-generation research');
        const observe = f.node({
            nodeId: 'observe',
            finding: 'Primary research supplies the missing behavior-generation model.',
            evidenceFit: 'The new retrieval directly addresses the unknown identified by observe.',
            unknowns: ['Transfer to this UI remains uncertain.'],
            evidenceToolUseIds: [secondObserveEvidence.id],
            previousResultToolUseId: problem.id,
            nextAction: 'Test the strongest counterexample in falsify.'
        });
        const falsifyEvidence = f.search('strongest counterexample UI behavior');
        const falsify = f.node({
            nodeId: 'falsify',
            finding: 'The strongest counterexample does not overturn the revised framing.',
            evidenceToolUseIds: [falsifyEvidence.id],
            previousResultToolUseId: observe.id,
            nextAction: 'Carry the surviving uncertainty into decide.'
        });
        const decideEvidence = f.search('decision comparison');
        f.node({
            nodeId: 'decide',
            finding: 'Use staged evidence and retain transfer uncertainty in the recommendation.',
            evidenceToolUseIds: [decideEvidence.id],
            previousResultToolUseId: falsify.id,
            nextAction: 'Report the decision and remaining uncertainty.'
        });
        f.execution();
        f.state('completed');

        const result = f.stop('新しい調査結果でobserveを再評価し、結論を更新しました。');

        expect(result.output.decision).toBeUndefined();
        expect(result.final).toMatchObject({
            completion_status: 'complete',
            stop_decision: { business_decision: 'RELEASE', protocol_status: 'ready' },
            judgment_node_evidence: { ready: true }
        });
        expect(result.final.judgment_node_evidence.next_action).toBeNull();
    });

    it('control node records do not satisfy business evidence or the selected contract', async () => {
        const f = await fixture();
        const controlEvidence = f.search('control record');
        const control = f.node({
            nodeId: 'reconcile',
            evidenceToolUseIds: [controlEvidence.id],
            finding: 'A control node claims the work is complete.'
        });
        f.state('completed');

        const result = f.stop('制御ノードの記録だけで完了を宣言します。');

        expect(control.event.success).toBe(true);
        expect(result.output.decision).toBe('block');
        expect(result.continuation.missing_capabilities).toContain('judgment.node_evidence');
        expect(result.continuation.stop_decision.business_reasons).toEqual([]);
    });

    it('bounded repair exhaustion never completes an unverified chain', async () => {
        const f = await fixture();
        f.execution();
        f.state('completed');

        const first = f.stop('根拠が不足したまま回答します。');
        const second = f.stop('根拠が不足したまま回答します。');
        const exhausted = f.stop('根拠が不足したまま回答します。');

        expect(first.output.decision).toBe('block');
        expect(second.output.decision).toBe('block');
        expect(exhausted.final).toMatchObject({
            completion_status: 'audit_degraded',
            judgment_node_evidence: { ready: false }
        });
        expect(exhausted.final.completion_status).not.toBe('complete');
    });

    it('human-authorization escalation takes precedence over missing node evidence', async () => {
        const f = await fixture({
            autonomyDecision: 'escalate',
            autonomyReasonCode: 'risk_or_external',
            prompt: '本番反映を承認して'
        });
        f.state('waiting_human', 'risk_or_external');

        const result = f.stop('⚠️ 確認が必要[risk_or_external]: 本番反映を実行しますか？');

        expect(result.final).toMatchObject({
            stop_decision: {
                business_decision: 'ASK_HUMAN',
                protocol_status: 'ready',
                protocol_reasons: []
            },
            judgment_node_evidence: { ready: false }
        });
        expect(result.final.stop_decision.protocol_reasons).not.toContain('judgment.node_evidence');
    });
});
