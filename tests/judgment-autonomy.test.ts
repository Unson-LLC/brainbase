import { describe, expect, it, vi } from 'vitest';
import {
  evaluateJudgmentAutonomy,
  extractHumanDecisionQuestion,
  renderJudgmentAutonomyContinuation,
  visibleAnswerBody
} from '../src/judgment-autonomy.js';

const base = {
  turn_id: 'turn-1',
  request: 'Brainbase hooksを代理判断できるように実装して',
  project_code: 'brainbase',
  selected_dag_ids: ['engineering.v1', 'personal-judgment.v1']
};

describe('Brainbase proxy judgment autonomy gate', () => {
  it('strips owner audit lines before reading the final answer', () => {
    const answer = '🧠 判断参照: x\n📚 Brainbase未参照: y\nテストを実行しますか？';
    expect(visibleAnswerBody(answer)).toBe('テストを実行しますか？');
    expect(extractHumanDecisionQuestion(answer)).toBe('テストを実行しますか？');
  });

  it('blocks routine test approval and resumes the same Codex turn', async () => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: 'テストを実行しますか？' });
    expect(result).toMatchObject({
      verdict: 'continue',
      reason_code: 'routine_reversible_work',
      source: 'deterministic'
    });
    expect(renderJudgmentAutonomyContinuation(result)).toContain('同じターンを続行');
    expect(renderJudgmentAutonomyContinuation(result)).toContain('通常工程をそのまま実行');
  });

  it('uses the current Codex as the semantic resolver when no independent provider exists', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: '証跡台帳と代理判断の縦切りのどちらを先にしますか？'
    });
    expect(result).toMatchObject({
      verdict: 'continue',
      reason_code: 'semantic_judgment_required',
      source: 'same_codex'
    });
    expect(renderJudgmentAutonomyContinuation(result)).toContain('過去Decision');
    expect(renderJudgmentAutonomyContinuation(result)).toContain('OK / NG');
  });

  it('allows a clarification explicitly selected by the accepted Judgment Receipt', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      selected_dag_ids: ['clarification.v1'],
      final_answer: 'どちらの対象を指していますか？'
    });
    expect(result).toMatchObject({
      verdict: 'human_required',
      reason_code: 'resolver_selected_clarification'
    });
  });

  it('allows a human question for an external action boundary', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: 'この変更を本番へデプロイしますか？'
    });
    expect(result).toMatchObject({
      verdict: 'human_required',
      reason_code: 'irreversible_external_action'
    });
  });

  it.each([
    '本番環境でテストを実行しますか？',
    'データベースを削除しますか？',
    'ユーザー全員の権限を変更しますか？',
    '個人情報を外部APIへ渡してよいですか？',
    '顧客にSlackメッセージを送りますか？',
    'PRを作成しますか？'
  ])('fails closed for an unapproved boundary: %s', async (finalAnswer) => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: finalAnswer });
    expect(result).toMatchObject({
      verdict: 'human_required',
      reason_code: 'irreversible_external_action',
      source: 'deterministic'
    });
  });

  it('does not ask again for a release action explicitly authorized by the task', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: '修正してPR作成から本番展開まで実行して',
      final_answer: 'PRを作成しますか？'
    });
    expect(result).toMatchObject({
      verdict: 'continue',
      reason_code: 'semantic_judgment_required',
      source: 'same_codex'
    });
  });

  it('does not ask again for an explicitly authorized production deployment', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: '修正して本番展開まで実行して',
      final_answer: '本番環境へデプロイしますか？'
    });
    expect(result).toMatchObject({
      verdict: 'continue',
      reason_code: 'semantic_judgment_required',
      source: 'same_codex'
    });
  });

  it('keeps external message delivery human-required even when requested', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      request: '顧客へSlackで送って',
      final_answer: '顧客へSlackメッセージを送りますか？'
    });
    expect(result).toMatchObject({
      verdict: 'human_required',
      reason_code: 'irreversible_external_action'
    });
  });

  it('allows a human question when a secret or authority is missing', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: '権限がありません。認証情報を教えてください。'
    });
    expect(result).toMatchObject({
      verdict: 'human_required',
      reason_code: 'missing_authority_or_secret'
    });
  });

  it('routes an existing business-priority choice through Brainbase instead of escalating by keyword', async () => {
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: '売上と安全性のどちらを優先しますか？'
    });
    expect(result).toMatchObject({
      verdict: 'continue',
      reason_code: 'semantic_judgment_required',
      source: 'same_codex'
    });
  });

  it('calls an independent resolver only for the semantic gray zone', async () => {
    const resolver = vi.fn(async (request) => ({
      schema_version: 'brainbase-autonomy-resolver-decision-v1' as const,
      case_id: request.case_id,
      verdict: 'continue' as const,
      reason_code: 'centerpin_first',
      reason: '代理判断の縦切りがセンターピンを直接証明するため',
      basis: [{ entity_id: 'dec_centerpin', application: '代理判断を先行する' }],
      instruction_patch: {
        cancel: ['証跡台帳の先行実装'],
        do_next: ['代理判断の縦切りを実装する'],
        acceptance_criteria: ['人間へ確認せず続行する']
      }
    }));
    const result = await evaluateJudgmentAutonomy({
      ...base,
      final_answer: '証跡台帳と代理判断の縦切りのどちらを先にしますか？'
    }, resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      verdict: 'continue',
      source: 'independent_resolver',
      reason_code: 'resolver_continue'
    });
  });

  it('rejects a resolver decision bound to another case', async () => {
    await expect(evaluateJudgmentAutonomy({
      ...base,
      final_answer: '証跡台帳と代理判断の縦切りのどちらを先にしますか？'
    }, async () => ({
      schema_version: 'brainbase-autonomy-resolver-decision-v1',
      case_id: 'wrong',
      verdict: 'continue',
      reason_code: 'x',
      reason: 'x',
      basis: [],
      instruction_patch: { cancel: [], do_next: ['x'], acceptance_criteria: ['x'] }
    }))).rejects.toThrow('judgment_autonomy_resolver_invalid');
  });

  it('rejects a resolver decision without a Brainbase basis', async () => {
    await expect(evaluateJudgmentAutonomy({
      ...base,
      final_answer: '証跡台帳と代理判断の縦切りのどちらを先にしますか？'
    }, async (request) => ({
      schema_version: 'brainbase-autonomy-resolver-decision-v1',
      case_id: request.case_id,
      verdict: 'continue',
      reason_code: 'x',
      reason: 'x',
      basis: [],
      instruction_patch: { cancel: [], do_next: ['x'], acceptance_criteria: ['x'] }
    }))).rejects.toThrow('judgment_autonomy_resolver_invalid');
  });

  it('does not intercept ordinary completed prose', async () => {
    const result = await evaluateJudgmentAutonomy({ ...base, final_answer: '実装とテストが完了しました。' });
    expect(result).toMatchObject({
      verdict: 'not_applicable',
      reason_code: 'not_a_human_escalation'
    });
  });
});
