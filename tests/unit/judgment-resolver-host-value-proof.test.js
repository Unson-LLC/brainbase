import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildJudgmentRequest,
  buildOwnerReferenceLine,
  canonicalJson,
  finalizeEpisode,
  recordBrainbaseToolUse,
  startEpisode,
  successOutput,
} from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const temporaryPaths = [];

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'brainbase-value-proof-host-'));
  temporaryPaths.push(path);
  return path;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function retrievalResultResponse(subject) {
  return {
    content: [{
      type: 'text',
      text: [
        'Brainbase retrieval audit: reproduce the next line exactly once in the next user-facing assistant message.',
        'Do not merge it with the turn-level Judgment audit and do not repeat it without another tool call.',
        `📚 Brainbase取得: ${subject} → 結果を取得 ✓`,
      ].join('\n'),
    }],
    structuredContent: { items: [{ id: 'updated-ssot' }] },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function receiptFor(args) {
  return {
    resolution_id: 'jr_value_proof_test',
    runtime_version: 'judgment-runtime-2.4.0',
    turn_id: args.turn_id,
    request_digest: hash(canonicalJson(args)),
    context_digest: hash(canonicalJson(args.conversation_context)),
    status: 'resolved',
    host_binding: { status: 'managed' },
    classification_evidence: { source: 'current_request', source_turn_ids: [args.turn_id] },
    classification: { intent: 'implement', action_kind: 'write', risk: 'medium', domains: ['engineering'] },
    selected_dag_ids: ['engineering.v1', 'authority.v1'],
    active_node_definitions: [{ id: 'entry', kind: 'common', instruction: 'Judge first.' }],
    autonomy_decision: 'continue',
    autonomy_reason_code: 'routine_in_scope',
    allowed_runtime_escalation_reasons: [
      'irreversible_action', 'missing_authority', 'owner_value_choice',
      'required_input_unavailable', 'evidenced_terminal_blocker',
    ],
  };
}

function valueProofInput(overrides = {}) {
  const defaults = {
    schema_version: 'brainbase-judgment-value-proof-input-v1',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '既存文書を更新するか、新規文書を作るか？',
      reason_code: 'routine_reversible_work',
    },
    decision: {
      summary: '既存SSOTを最小更新する',
      work_impact: '確認で止めず、変更と検証まで継続した',
      basis: [{
        entity_id: 'dec_example',
        application: '正本が存在する場合は重複する文書を増やさない',
      }],
    },
    execution: {
      summary: '既存文書を更新し、テストを実行した',
      artifact_refs: [{ kind: 'file', ref: 'docs/existing.md', label: '既存文書' }],
    },
    outcome: {
      status: 'outcome_verified',
      summary: '変更後の正本を読み戻し、テスト成功を確認した',
      evidence_refs: [
        { kind: 'tool_event', tool_use_id: 'execution-1', subject_ref: 'docs/existing.md', label: '正本更新' },
        { kind: 'canonical_readback', tool_use_id: 'readback-1', subject_ref: 'docs/existing.md', label: '正本読み戻し' },
      ],
    },
    human_decision: null,
    feedback_requested: false,
  };
  return {
    ...defaults,
    ...overrides,
    interruption: { ...defaults.interruption, ...overrides.interruption },
    decision: { ...defaults.decision, ...overrides.decision },
    execution: { ...defaults.execution, ...overrides.execution },
    outcome: { ...defaults.outcome, ...overrides.outcome },
  };
}

describe('Judgment Resolver Host value proof integration', () => {
  it('records a hidden structured event and appends a result-first receipt after the legacy audit block', async () => {
    const root = temporaryDirectory();
    const env = {
      BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'canary',
      BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
      BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS: 'brainbase',
    };
    const payload = {
      session_id: 'session-value-proof',
      turn_id: 'turn-value-proof',
      prompt: '既存の正本を更新してテストまで完了して',
      cwd: process.cwd(),
    };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = receiptFor(args);
    await startEpisode(payload, {
      env,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ management_status: 'managed', receipt }),
      }),
    });

    const ownerLine = buildOwnerReferenceLine(args, receipt);
    const zeroCallLine = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
    const interruption = finalizeEpisode({
      hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n${zeroCallLine}\n\n既存文書を更新するか、新規文書を作るか？`,
    }, { env });
    expect(interruption.output.decision).toBe('block');

    const mutation = recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse',
      session_id: payload.session_id,
      turn_id: payload.turn_id,
      tool_name: 'apply_patch',
      tool_use_id: 'execution-1',
      tool_input: { patch: '*** Begin Patch\n*** Update File: docs/existing.md\n@@\n-old\n+new\n*** End Patch' },
      tool_response: { success: true },
    }, { env });
    expect(mutation).toMatchObject({
      event_kind: 'execution', success: true,
      safe_metadata: { artifact_refs: ['docs/existing.md'] },
    });

    const execution = recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse',
      session_id: payload.session_id,
      turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__get_context',
      tool_use_id: 'readback-1',
      tool_input: { topic: 'docs/existing.md' },
      tool_response: retrievalResultResponse('docs/existing.md'),
    }, { env });
    expect(execution).toMatchObject({ event_kind: 'retrieve', success: true });

    const valueProof = recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse',
      session_id: payload.session_id,
      turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_value_proof_record',
      tool_use_id: 'value-proof-1',
      tool_input: valueProofInput(),
      tool_response: { status: 'ok', data: valueProofInput() },
    }, { env });
    expect(valueProof).toMatchObject({ event_kind: 'value_proof', success: true, display_line: null });

    const stopState = {
      schema_version: 'brainbase-stop-state-v1',
      status: 'completed',
      pending_safe_work: false,
      runtime_reason_code: null,
    };
    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse',
      session_id: payload.session_id,
      turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_state_record',
      tool_use_id: 'state-1',
      tool_input: {
        status: 'completed', pending_safe_work: false, runtime_reason_code: null,
      },
      tool_response: { status: 'ok', data: stopState },
    }, { env });

    const result = finalizeEpisode({
      hook_event_name: 'Stop',
      session_id: payload.session_id,
      turn_id: payload.turn_id,
      stop_hook_active: true,
      last_assistant_message: `${ownerLine}\n${execution.display_line}\n🔁 実行継続: 方針説明での停止を1回差し戻し → 作業完了 ✓\n🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓\n\n既存の正本更新とテストを完了しました。`,
    }, { env });

    expect(result.output.systemMessage).toContain(`${ownerLine}\n${execution.display_line}`);
    expect(result.output.systemMessage).toContain('🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓\n\nBrainbase判断レシート');
    expect(result.output.systemMessage).toContain('結果: 変更後の正本を読み戻し、テスト成功を確認した');
    expect(result.output.systemMessage).toContain('判断: 既存SSOTを最小更新する');
    expect(result.output.systemMessage).toContain('状態: 成果確認済み');
    expect(result.output.systemMessage).not.toContain('dec_example');
    const receiptSurface = result.output.systemMessage.split('\n\nBrainbase判断レシート\n')[1];
    expect(receiptSurface).not.toContain('docs/existing.md');

    const turnRef = hash(payload.turn_id);
    const directory = join(root, 'journal', hash(payload.session_id));
    const proofPath = join(directory, `${turnRef}.value-proof.json`);
    const attentionPath = join(directory, `${turnRef}.value-proof-attention.json`);
    expect(existsSync(proofPath)).toBe(true);
    expect(existsSync(attentionPath)).toBe(false);
    expect(JSON.parse(readFileSync(proofPath, 'utf8'))).toMatchObject({
      schema_version: 'brainbase-judgment-value-proof-v1',
      state: 'outcome_verified',
      outcome: { status: 'outcome_verified' },
    });
  });

  it('persists and revalidates an unconfirmed receipt when canonical readback evidence is missing', async () => {
    const root = temporaryDirectory();
    const env = {
      BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'enabled',
    };
    const payload = {
      session_id: 'session-unconfirmed-proof', turn_id: 'turn-unconfirmed-proof',
      prompt: '既存の正本を更新して', cwd: process.cwd(),
    };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = receiptFor(args);
    await startEpisode(payload, { env, fetchImpl: vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }),
    }) });
    const ownerLine = buildOwnerReferenceLine(args, receipt);
    const zeroCallLine = '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓';
    expect(finalizeEpisode({
      hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n${zeroCallLine}\n\n既存文書を更新するか、新規文書を作るか？`,
    }, { env }).output.decision).toBe('block');

    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'apply_patch', tool_use_id: 'execution-1',
      tool_input: { patch: '*** Begin Patch\n*** Update File: docs/existing.md\n@@\n-old\n+new\n*** End Patch' },
      tool_response: { success: true },
    }, { env });
    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_value_proof_record', tool_use_id: 'value-proof-unconfirmed',
      tool_input: valueProofInput(), tool_response: { status: 'ok', data: valueProofInput() },
    }, { env });
    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_state_record', tool_use_id: 'state-unconfirmed',
      tool_input: { status: 'completed', pending_safe_work: false, runtime_reason_code: null },
      tool_response: { status: 'ok', data: {
        schema_version: 'brainbase-stop-state-v1', status: 'completed',
        pending_safe_work: false, runtime_reason_code: null,
      } },
    }, { env });

    const result = finalizeEpisode({
      hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: true,
      last_assistant_message: [
        ownerLine, zeroCallLine,
        '🔁 実行継続: 方針説明での停止を1回差し戻し → 作業完了 ✓',
        '🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓',
        '既存文書を更新しました。',
      ].join('\n'),
    }, { env });
    expect(result.output.systemMessage).toContain('状態: 結果未確認');
    const directory = join(root, 'journal', hash(payload.session_id));
    const turnRef = hash(payload.turn_id);
    expect(JSON.parse(readFileSync(join(directory, `${turnRef}.value-proof.json`), 'utf8')))
      .toMatchObject({ state: 'unconfirmed', outcome: { status: 'unconfirmed' } });
    expect(JSON.parse(readFileSync(join(directory, `${turnRef}.value-proof-attention.json`), 'utf8')))
      .toMatchObject({ kind: 'outcome_unconfirmed' });
    expect(() => finalizeEpisode({
      hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: true, last_assistant_message: result.output.systemMessage,
    }, { env })).not.toThrow();
  });

  it('instructs the model to record value proof before the existing final state tool', () => {
    const context = successOutput({
      request: '修正して', conversation_context: { messages: [] },
    }, {
      runtime_version: 'judgment-runtime-2.4.0',
      classification: { intent: 'implement', action_kind: 'write', risk: 'medium' },
      autonomy_decision: 'continue',
      autonomy_reason_code: 'routine_in_scope',
      allowed_runtime_escalation_reasons: [
        'irreversible_action', 'missing_authority', 'owner_value_choice',
        'required_input_unavailable', 'evidenced_terminal_blocker',
      ],
      active_node_definitions: [],
    }, undefined, undefined, {
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'enabled',
    }).hookSpecificOutput.additionalContext;

    const proofIndex = context.indexOf('brainbase_judgment_value_proof_record');
    const stateIndex = context.indexOf('brainbase_judgment_state_record');
    expect(proofIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeGreaterThan(proofIndex);
    expect(context).toContain('先行する中断候補がない単なる代理判断ではvalue proofを記録しない');
  });

  it('keeps value proof default-off until a canary or enabled rollout is selected', () => {
    const context = successOutput({ request: '修正して', conversation_context: { messages: [] } }, {
      runtime_version: 'judgment-runtime-2.4.0',
      classification: { intent: 'implement', action_kind: 'write', risk: 'medium' },
      autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope',
      allowed_runtime_escalation_reasons: [
        'irreversible_action', 'missing_authority', 'owner_value_choice',
        'required_input_unavailable', 'evidenced_terminal_blocker',
      ], active_node_definitions: [],
    }).hookSpecificOutput.additionalContext;
    expect(context).not.toContain('brainbase_judgment_value_proof_record');
  });

  it('enables value proof canary only for an allowlisted project', () => {
    const result = {
      runtime_version: 'judgment-runtime-2.4.0',
      classification: { intent: 'implement', action_kind: 'write', risk: 'medium' },
      autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope',
      allowed_runtime_escalation_reasons: [
        'irreversible_action', 'missing_authority', 'owner_value_choice',
        'required_input_unavailable', 'evidenced_terminal_blocker',
      ], active_node_definitions: [],
    };
    const input = { request: '修正して', conversation_context: { messages: [] } };
    const matched = successOutput(input, result, undefined, undefined, {
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'canary',
      BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
      BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS: 'brainbase,other',
    }).hookSpecificOutput.additionalContext;
    const missed = successOutput(input, result, undefined, undefined, {
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'canary',
      BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
      BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS: 'other',
    }).hookSpecificOutput.additionalContext;
    const missingProject = successOutput(input, result, undefined, undefined, {
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'canary',
      BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS: 'brainbase',
    }).hookSpecificOutput.additionalContext;

    expect(matched).toContain('brainbase_judgment_value_proof_record');
    expect(missed).not.toContain('brainbase_judgment_value_proof_record');
    expect(missingProject).not.toContain('brainbase_judgment_value_proof_record');
  });

  it('keeps the judgment value proof CI read-only and free of branch self-updates', () => {
    const workflow = readFileSync(join(
      process.cwd(),
      '.github/workflows/judgment-value-proof-consumer.yml',
    ), 'utf8');

    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/git\s+(?:commit|push)/u);
    expect(workflow).not.toContain('contents: write');
  });

  it('renders human_required through the Host only when it matches the waiting-human question', async () => {
    const root = temporaryDirectory();
    const env = {
      BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'enabled',
    };
    const payload = { session_id: 'session-human', turn_id: 'turn-human', prompt: '契約条件を整理して', cwd: process.cwd() };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = receiptFor(args);
    await startEpisode(payload, { env, fetchImpl: vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }),
    }) });
    const input = valueProofInput({
      interruption: { resolution: 'human_required', question_display_text: '契約上限をいくらにするか？', reason_code: 'owner_value_choice' },
      decision: { summary: null, work_impact: null, basis: [] },
      execution: { summary: null, artifact_refs: [] },
      outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
      human_decision: {
        question: '契約上限をいくらにするか？', why_human: '金銭条件の価値判断になるため',
        options: [{ id: 'A', label: '30万円', impact: '利益率を優先' }, { id: 'B', label: '50万円', impact: '受注率を優先' }],
      },
    });
    recordBrainbaseToolUse({ hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_value_proof_record', tool_use_id: 'human-proof',
      tool_input: input, tool_response: { status: 'ok', data: input } }, { env });
    recordBrainbaseToolUse({ hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_state_record', tool_use_id: 'human-state',
      tool_input: { status: 'waiting_human', pending_safe_work: false, runtime_reason_code: 'owner_value_choice' },
      tool_response: { status: 'ok', data: { schema_version: 'brainbase-stop-state-v1', status: 'waiting_human', pending_safe_work: false, runtime_reason_code: 'owner_value_choice' } } }, { env });
    const ownerLine = buildOwnerReferenceLine(args, receipt);
    const result = finalizeEpisode({ hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n\n⚠️ 確認が必要[owner_value_choice]: 契約上限をいくらにするか？` }, { env });
    expect(result.output.systemMessage).toContain('人間判断が必要です');
    expect(result.output.systemMessage).toContain('判断: 契約上限をいくらにするか');

    const turnRef = hash(payload.turn_id);
    const attentionPath = join(root, 'journal', hash(payload.session_id), `${turnRef}.value-proof-attention.json`);
    expect(existsSync(attentionPath)).toBe(true);
    rmSync(attentionPath);
    expect(() => finalizeEpisode({ hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: true, last_assistant_message: result.output.systemMessage }, { env }))
      .toThrow('judgment_value_proof_attention_missing');
  });

  it('fails closed when a persisted attention artifact is modified', async () => {
    const root = temporaryDirectory();
    const env = {
      BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
      BRAINBASE_JUDGMENT_VALUE_PROOF_MODE: 'enabled',
    };
    const payload = { session_id: 'session-human-tampered', turn_id: 'turn-human-tampered', prompt: '契約条件を整理して', cwd: process.cwd() };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = receiptFor(args);
    await startEpisode(payload, { env, fetchImpl: vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ management_status: 'managed', receipt }),
    }) });
    const input = valueProofInput({
      interruption: { resolution: 'human_required', question_display_text: '契約上限をいくらにするか？', reason_code: 'owner_value_choice' },
      decision: { summary: null, work_impact: null, basis: [] }, execution: { summary: null, artifact_refs: [] },
      outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
      human_decision: { question: '契約上限をいくらにするか？', why_human: '金銭条件の価値判断になるため', options: [{ id: 'A', label: '30万円', impact: '利益率を優先' }] },
    });
    recordBrainbaseToolUse({ hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_value_proof_record', tool_use_id: 'human-proof-tampered',
      tool_input: input, tool_response: { status: 'ok', data: input } }, { env });
    recordBrainbaseToolUse({ hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_state_record', tool_use_id: 'human-state-tampered',
      tool_input: { status: 'waiting_human', pending_safe_work: false, runtime_reason_code: 'owner_value_choice' },
      tool_response: { status: 'ok', data: { schema_version: 'brainbase-stop-state-v1', status: 'waiting_human', pending_safe_work: false, runtime_reason_code: 'owner_value_choice' } } }, { env });
    const ownerLine = buildOwnerReferenceLine(args, receipt);
    const result = finalizeEpisode({ hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: false, last_assistant_message: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n\n⚠️ 確認が必要[owner_value_choice]: 契約上限をいくらにするか？` }, { env });
    const turnRef = hash(payload.turn_id);
    const attentionPath = join(root, 'journal', hash(payload.session_id), `${turnRef}.value-proof-attention.json`);
    const attention = JSON.parse(readFileSync(attentionPath, 'utf8'));
    attention.summary = '改ざん済み';
    writeFileSync(attentionPath, JSON.stringify(attention));
    expect(() => finalizeEpisode({ hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: true, last_assistant_message: result.output.systemMessage }, { env }))
      .toThrow('judgment_value_proof_attention_digest_mismatch');
  });

  it('does not let a value-proof event satisfy the completed-work evidence requirement', async () => {
    const root = temporaryDirectory();
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const payload = {
      session_id: 'session-proof-only', turn_id: 'turn-proof-only',
      prompt: '実作業をして', cwd: process.cwd(),
    };
    const args = buildJudgmentRequest(payload, { env });
    const receipt = receiptFor(args);
    await startEpisode(payload, {
      env,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ management_status: 'managed', receipt }),
      }),
    });

    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_value_proof_record', tool_use_id: 'value-proof-only',
      tool_input: valueProofInput(), tool_response: { status: 'ok', data: valueProofInput() },
    }, { env });
    recordBrainbaseToolUse({
      hook_event_name: 'PostToolUse', session_id: payload.session_id, turn_id: payload.turn_id,
      tool_name: 'mcp__brainbase__brainbase_judgment_state_record', tool_use_id: 'state-only',
      tool_input: { status: 'completed', pending_safe_work: false, runtime_reason_code: null },
      tool_response: {
        status: 'ok',
        data: {
          schema_version: 'brainbase-stop-state-v1', status: 'completed',
          pending_safe_work: false, runtime_reason_code: null,
        },
      },
    }, { env });

    const ownerLine = buildOwnerReferenceLine(args, receipt);
    const result = finalizeEpisode({
      hook_event_name: 'Stop', session_id: payload.session_id, turn_id: payload.turn_id,
      stop_hook_active: false,
      last_assistant_message: `${ownerLine}\n📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓\n\n完了しました。`,
    }, { env });

    expect(result.output.decision).toBe('block');
    expect(result.output.reason).toContain('成功したPostToolUse実行証跡');
  });
});
