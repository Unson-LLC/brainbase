import { describe, expect, it } from 'vitest';
import {
  placeJudgmentValueProof,
  projectJudgmentValueProofAttention,
  renderJudgmentHumanDecisionRequest,
  renderJudgmentValueProofCompletion,
  renderJudgmentValueProofProgress,
  renderJudgmentValueProofWeeklyDigest,
  type JudgmentValueProof
} from '../src/judgment-value-proof.js';

function verifiedProof(): JudgmentValueProof {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: 'intent-example',
    decision_attempt_id: 'decision-example',
    recorded_at: '2026-09-01T00:00:00.000Z',
    state: 'outcome_verified',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '新規文書を作るか',
      question_digest: 'sha256:question',
      reason_code: 'routine_reversible_work',
      human_reason: null
    },
    decision: {
      summary: '既存SSOTを最小更新する',
      work_impact: '確認で止めずPR作成まで進めた',
      basis: [{
        entity_id: 'dec-example',
        application: '正本が存在する場合は重複する文書を増やさない'
      }],
      prior_learning_reused: true
    },
    execution: {
      status: 'completed',
      summary: 'PR #142を作成',
      artifact_refs: [{ kind: 'pull_request', ref: 'github://pull/142', label: 'PR #142' }]
    },
    outcome: {
      status: 'outcome_verified',
      summary: 'PR #142を作成し、テスト14件が合格',
      evidence_refs: [{
        kind: 'canonical_readback',
        ref: 'github://pull/142',
        status: 'verified',
        label: 'PR #142'
      }]
    },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null }
  };
}

describe('judgment value proof placement', () => {
  it('keeps ordinary references silent and off the Web surface', () => {
    const proof = verifiedProof();
    proof.interruption = {
      resolution: 'not_applicable',
      question_display_text: null,
      question_digest: null,
      reason_code: null,
      human_reason: null
    };
    proof.decision = {
      summary: null,
      work_impact: null,
      basis: [],
      prior_learning_reused: 'unconfirmed'
    };
    proof.execution = { status: 'completed', summary: '通常回答を完了', artifact_refs: [] };
    proof.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };

    expect(placeJudgmentValueProof(proof)).toEqual({
      agent_progress: 'silent',
      agent_completion: 'silent',
      companion_attention: 'none',
      web_surface: 'none',
      weekly_digest: 'exclude'
    });
  });

  it('shows one progress line only while a delegated decision is continuing work', () => {
    const proof = verifiedProof();
    proof.state = 'executing';
    proof.execution.status = 'executing';
    proof.execution.summary = '既存文書の修正と検証を続けています';
    proof.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };

    expect(renderJudgmentValueProofProgress(proof)).toBe(
      'Brainbaseが判断を代行：既存SSOTを最小更新する。確認で止めず、既存文書の修正と検証を続けています。'
    );
    expect(renderJudgmentValueProofCompletion(proof)).toBeNull();
  });

  it('renders outcome first and hides internal entity IDs from the default receipt', () => {
    const proof = verifiedProof();
    const receipt = renderJudgmentValueProofCompletion(proof);

    expect(receipt).toMatch(/^Brainbase判断レシート\n結果:/u);
    expect(receipt).toContain('判断: 既存SSOTを最小更新する');
    expect(receipt).toContain('状態: 成果確認済み');
    expect(receipt).not.toContain('dec-example');
    expect(receipt).not.toContain('github://pull/142');
    expect(projectJudgmentValueProofAttention(proof)).toBeNull();
  });

  it('routes explicit feedback requests to Companion without notifying every successful run', () => {
    const proof = verifiedProof();
    proof.feedback = { status: 'pending', summary: null, evidence_ref: null };

    expect(projectJudgmentValueProofAttention(proof)?.kind).toBe('feedback_requested');
  });

  it('routes real owner decisions to agent text and Companion attention', () => {
    const proof = verifiedProof();
    proof.state = 'waiting_human';
    proof.interruption = {
      resolution: 'human_required',
      question_display_text: '月額上限をいくらにするか',
      question_digest: 'sha256:human-question',
      reason_code: 'material_commitment',
      human_reason: '外部への金銭的コミットメントになるため'
    };
    proof.decision = {
      summary: null,
      work_impact: null,
      basis: [],
      prior_learning_reused: 'unconfirmed'
    };
    proof.execution = { status: 'not_started', summary: null, artifact_refs: [] };
    proof.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };
    proof.human_decision = {
      question: '月額上限をいくらにするか',
      why_human: '外部への金銭的コミットメントになるため',
      options: [
        { id: 'A', label: '30万円', impact: '利益率を守れるが受注可能性が下がる' },
        { id: 'B', label: '50万円', impact: '受注可能性は上がるが初月赤字の可能性がある' }
      ]
    };

    expect(renderJudgmentHumanDecisionRequest(proof)).toContain('AIで決めない理由');
    expect(projectJudgmentValueProofAttention(proof)?.kind).toBe('human_decision');
    expect(placeJudgmentValueProof(proof).web_surface).toBe('none');
  });

  it('does not turn unavailable weekly evidence into zero', () => {
    expect(renderJudgmentValueProofWeeklyDigest({
      period_label: '今週',
      coverage: 'unavailable',
      proofs: []
    })).toContain('0件としては扱いません');
  });

  it('aggregates delegated, verified, human-required and corrected cases separately', () => {
    const delegated = verifiedProof();
    const humanRequired = verifiedProof();
    humanRequired.intent_id = 'intent-human';
    humanRequired.decision_attempt_id = 'decision-human';
    humanRequired.state = 'waiting_human';
    humanRequired.interruption.resolution = 'human_required';
    humanRequired.interruption.human_reason = '新しい契約条件だから';
    humanRequired.decision = {
      summary: null,
      work_impact: null,
      basis: [],
      prior_learning_reused: 'unconfirmed'
    };
    humanRequired.execution = { status: 'not_started', summary: null, artifact_refs: [] };
    humanRequired.outcome = { status: 'not_applicable', summary: null, evidence_refs: [] };
    humanRequired.human_decision = {
      question: '契約上限をどこに置くか',
      why_human: '新しいowner価値判断だから',
      options: []
    };

    const digest = renderJudgmentValueProofWeeklyDigest({
      period_label: '今週',
      coverage: 'complete',
      proofs: [delegated, humanRequired]
    });

    expect(digest).toContain('確認せず続行した判断: 1件');
    expect(digest).toContain('成果確認まで完了: 1件');
    expect(digest).toContain('人間判断が必要: 1件');
  });
});
