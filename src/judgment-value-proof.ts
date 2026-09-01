export type JudgmentValueProofIntentState =
  | 'captured'
  | 'executing'
  | 'waiting_human'
  | 'outcome_verified'
  | 'blocked'
  | 'unconfirmed';

export type JudgmentValueProofResolution =
  | 'not_applicable'
  | 'continued_without_human'
  | 'human_required';

export type JudgmentValueProofEvidenceKind =
  | 'judgment_receipt'
  | 'autonomy_receipt'
  | 'tool_event'
  | 'artifact'
  | 'canonical_readback'
  | 'human_feedback';

export interface JudgmentValueProofEvidenceRef {
  kind: JudgmentValueProofEvidenceKind;
  ref: string;
  status: 'verified' | 'unconfirmed';
  label?: string;
}

export interface JudgmentValueProofArtifactRef {
  kind: string;
  ref: string;
  label?: string;
}

export interface JudgmentValueProofBasis {
  entity_id: string;
  application: string;
}

export interface JudgmentValueProofHumanOption {
  id: string;
  label: string;
  impact: string;
}

export interface JudgmentValueProof {
  schema_version: 'brainbase-judgment-value-proof-v1';
  intent_id: string;
  decision_attempt_id: string;
  recorded_at: string;
  state: JudgmentValueProofIntentState;
  interruption: {
    resolution: JudgmentValueProofResolution;
    question_display_text: string | null;
    question_digest: string | null;
    reason_code: string | null;
    human_reason: string | null;
  };
  decision: {
    summary: string | null;
    work_impact: string | null;
    basis: JudgmentValueProofBasis[];
    prior_learning_reused: boolean | 'unconfirmed';
  };
  execution: {
    status: 'not_started' | 'executing' | 'completed' | 'blocked';
    summary: string | null;
    artifact_refs: JudgmentValueProofArtifactRef[];
  };
  outcome: {
    status: 'outcome_verified' | 'unconfirmed' | 'not_applicable';
    summary: string | null;
    evidence_refs: JudgmentValueProofEvidenceRef[];
  };
  human_decision: {
    question: string;
    why_human: string;
    options: JudgmentValueProofHumanOption[];
  } | null;
  feedback: {
    status: 'none' | 'pending' | 'accepted' | 'corrected' | 'next_time_ask' | 'reverted';
    summary: string | null;
    evidence_ref: JudgmentValueProofEvidenceRef | null;
  };
}

export interface JudgmentValueProofPlacement {
  agent_progress: 'silent' | 'show';
  agent_completion: 'silent' | 'show';
  companion_attention:
    | 'none'
    | 'human_decision'
    | 'blocked'
    | 'outcome_unconfirmed'
    | 'feedback_requested';
  web_surface: 'none';
  weekly_digest: 'exclude' | 'include';
}

export interface JudgmentValueProofCompanionItem {
  schema_version: 'brainbase-judgment-value-proof-attention-v1';
  intent_id: string;
  decision_attempt_id: string;
  kind: Exclude<JudgmentValueProofPlacement['companion_attention'], 'none'>;
  title: string;
  summary: string;
  suggested_actions: string[];
}

export interface JudgmentValueProofWeeklyDigestInput {
  period_label: string;
  coverage: 'complete' | 'partial' | 'unavailable';
  proofs: JudgmentValueProof[];
  representative_limit?: number;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function optionalText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function outcomeStatusLabel(status: JudgmentValueProof['outcome']['status']): string {
  if (status === 'outcome_verified') return '成果確認済み';
  if (status === 'unconfirmed') return '結果未確認';
  return '成果確認の対象外';
}

function evidenceLabel(evidence: JudgmentValueProofEvidenceRef): string {
  const label = evidence.label?.trim() || evidence.kind;
  return `${label} (${evidence.status === 'verified' ? '確認済み' : '未確認'})`;
}

export function validateJudgmentValueProof(proof: JudgmentValueProof): JudgmentValueProof {
  if (proof?.schema_version !== 'brainbase-judgment-value-proof-v1') {
    throw new TypeError('unsupported judgment value proof schema');
  }
  requiredText(proof.intent_id, 'intent_id');
  requiredText(proof.decision_attempt_id, 'decision_attempt_id');
  requiredText(proof.recorded_at, 'recorded_at');

  if (proof.interruption.resolution === 'continued_without_human') {
    if (!optionalText(proof.decision.summary)) {
      throw new TypeError('continued_without_human requires decision.summary');
    }
    if (!optionalText(proof.interruption.question_display_text)
      && !optionalText(proof.interruption.question_digest)) {
      throw new TypeError('continued_without_human requires a redacted question or digest');
    }
  }

  if (proof.interruption.resolution === 'human_required') {
    if (!proof.human_decision) {
      throw new TypeError('human_required requires human_decision');
    }
    requiredText(proof.human_decision.question, 'human_decision.question');
    requiredText(proof.human_decision.why_human, 'human_decision.why_human');
    for (const option of proof.human_decision.options) {
      requiredText(option.id, 'human_decision.options[].id');
      requiredText(option.label, 'human_decision.options[].label');
      requiredText(option.impact, 'human_decision.options[].impact');
    }
  }

  if (proof.outcome.status === 'outcome_verified') {
    if (!optionalText(proof.outcome.summary)) {
      throw new TypeError('outcome_verified requires outcome.summary');
    }
    if (!proof.outcome.evidence_refs.some((entry) => entry.status === 'verified')) {
      throw new TypeError('outcome_verified requires verified evidence');
    }
  }

  if (proof.feedback.status !== 'none' && proof.feedback.status !== 'pending'
    && !proof.feedback.evidence_ref) {
    throw new TypeError('recorded feedback requires evidence_ref');
  }

  return proof;
}

export function placeJudgmentValueProof(proof: JudgmentValueProof): JudgmentValueProofPlacement {
  validateJudgmentValueProof(proof);

  let companionAttention: JudgmentValueProofPlacement['companion_attention'] = 'none';
  if (proof.interruption.resolution === 'human_required') {
    companionAttention = 'human_decision';
  } else if (proof.state === 'blocked' || proof.execution.status === 'blocked') {
    companionAttention = 'blocked';
  } else if (proof.outcome.status === 'unconfirmed' && proof.execution.status === 'completed') {
    companionAttention = 'outcome_unconfirmed';
  } else if (proof.feedback.status === 'pending') {
    companionAttention = 'feedback_requested';
  }

  const behaviorChanged = proof.interruption.resolution === 'continued_without_human';
  const completed = proof.execution.status === 'completed';

  return {
    agent_progress: behaviorChanged && proof.execution.status === 'executing' ? 'show' : 'silent',
    agent_completion: behaviorChanged && completed ? 'show' : 'silent',
    companion_attention: companionAttention,
    web_surface: 'none',
    weekly_digest: proof.interruption.resolution === 'not_applicable'
      && proof.feedback.status === 'none'
      && proof.state !== 'blocked'
      && proof.outcome.status === 'not_applicable'
      ? 'exclude'
      : 'include'
  };
}

export function renderJudgmentValueProofProgress(proof: JudgmentValueProof): string | null {
  const placement = placeJudgmentValueProof(proof);
  if (placement.agent_progress === 'silent') return null;

  const decision = requiredText(proof.decision.summary ?? '', 'decision.summary');
  const execution = optionalText(proof.execution.summary) ?? '作業を続行しています';
  return `Brainbaseが判断を代行：${decision}。確認で止めず、${execution}。`;
}

export function renderJudgmentValueProofCompletion(proof: JudgmentValueProof): string | null {
  const placement = placeJudgmentValueProof(proof);
  if (placement.agent_completion === 'silent') return null;

  const result = optionalText(proof.outcome.summary)
    ?? optionalText(proof.execution.summary)
    ?? '実行は完了しましたが、結果の要約はありません';
  const decision = requiredText(proof.decision.summary ?? '', 'decision.summary');
  const impact = optionalText(proof.decision.work_impact) ?? '確認による中断を避けて作業を継続';
  const basis = proof.decision.basis.length > 0
    ? proof.decision.basis.map((entry) => entry.application).join(' / ')
    : '適用根拠は未確認';
  const evidence = proof.outcome.evidence_refs.length > 0
    ? proof.outcome.evidence_refs.map(evidenceLabel).join(' / ')
    : '成果証跡なし';

  return [
    'Brainbase判断レシート',
    `結果: ${result}`,
    `判断: ${decision}`,
    `仕事への影響: ${impact}`,
    `根拠: ${basis}`,
    `状態: ${outcomeStatusLabel(proof.outcome.status)}`,
    `証拠: ${evidence}`,
    '修正する場合: 「判断を修正: …」または「次回は確認」と返信'
  ].join('\n');
}

export function renderJudgmentHumanDecisionRequest(proof: JudgmentValueProof): string | null {
  validateJudgmentValueProof(proof);
  if (proof.interruption.resolution !== 'human_required' || !proof.human_decision) return null;

  const options = proof.human_decision.options.length > 0
    ? proof.human_decision.options.map((option) => (
      `${option.id}. ${option.label}\n   影響: ${option.impact}`
    )).join('\n')
    : '選択肢はまだ整理できていません';

  return [
    '人間判断が必要です',
    `判断: ${proof.human_decision.question}`,
    `AIで決めない理由: ${proof.human_decision.why_human}`,
    '選択肢:',
    options
  ].join('\n');
}

export function projectJudgmentValueProofAttention(
  proof: JudgmentValueProof
): JudgmentValueProofCompanionItem | null {
  const placement = placeJudgmentValueProof(proof);
  const kind = placement.companion_attention;
  if (kind === 'none') return null;

  if (kind === 'human_decision' && proof.human_decision) {
    return {
      schema_version: 'brainbase-judgment-value-proof-attention-v1',
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      kind,
      title: '人間判断が必要',
      summary: `${proof.human_decision.question} — ${proof.human_decision.why_human}`,
      suggested_actions: proof.human_decision.options.map((option) => `${option.id}: ${option.label}`)
    };
  }

  if (kind === 'blocked') {
    return {
      schema_version: 'brainbase-judgment-value-proof-attention-v1',
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      kind,
      title: '作業が停止しています',
      summary: optionalText(proof.execution.summary) ?? '停止理由は未確認です',
      suggested_actions: ['停止理由を確認', '再実行条件を決める']
    };
  }

  if (kind === 'outcome_unconfirmed') {
    return {
      schema_version: 'brainbase-judgment-value-proof-attention-v1',
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      kind,
      title: '実行結果を確認できていません',
      summary: optionalText(proof.execution.summary) ?? '実行は完了しました',
      suggested_actions: ['正本を読み戻す', '結果未確認のまま保持']
    };
  }

  return {
    schema_version: 'brainbase-judgment-value-proof-attention-v1',
    intent_id: proof.intent_id,
    decision_attempt_id: proof.decision_attempt_id,
    kind: 'feedback_requested',
    title: '判断へのフィードバックが必要',
    summary: optionalText(proof.decision.summary) ?? '判断内容を確認してください',
    suggested_actions: ['正しい', '判断を修正', '次回は確認']
  };
}

export function renderJudgmentValueProofWeeklyDigest(
  input: JudgmentValueProofWeeklyDigestInput
): string {
  const periodLabel = requiredText(input.period_label, 'period_label');
  if (input.coverage === 'unavailable') {
    return `${periodLabel}のBrainbase判断実績は取得できませんでした。0件としては扱いません。`;
  }

  const proofs = input.proofs.map(validateJudgmentValueProof);
  const included = proofs.filter((proof) => placeJudgmentValueProof(proof).weekly_digest === 'include');
  const verified = included.filter((proof) => proof.outcome.status === 'outcome_verified').length;
  const humanRequired = included.filter((proof) => proof.interruption.resolution === 'human_required').length;
  const corrected = included.filter((proof) => proof.feedback.status === 'corrected'
    || proof.feedback.status === 'reverted'
    || proof.feedback.status === 'next_time_ask').length;
  const unconfirmed = included.filter((proof) => proof.outcome.status === 'unconfirmed').length;
  const blocked = included.filter((proof) => proof.state === 'blocked'
    || proof.execution.status === 'blocked').length;
  const continued = included.filter((proof) => proof.interruption.resolution === 'continued_without_human').length;
  const coverage = input.coverage === 'partial' ? '（一部データのみ）' : '';
  const representativeLimit = Math.max(0, Math.floor(input.representative_limit ?? 3));
  const examples = included
    .filter((proof) => proof.decision.summary || proof.outcome.summary)
    .slice(0, representativeLimit)
    .map((proof, index) => {
      const decision = optionalText(proof.decision.summary) ?? '人間判断';
      const result = optionalText(proof.outcome.summary) ?? outcomeStatusLabel(proof.outcome.status);
      return `${index + 1}. ${decision}\n   → ${result}`;
    });

  return [
    `${periodLabel}、Brainbaseが仕事をどう前に進めたか${coverage}`,
    `確認せず続行した判断: ${continued}件`,
    `成果確認まで完了: ${verified}件`,
    `人間判断が必要: ${humanRequired}件`,
    `判断の訂正・取消: ${corrected}件`,
    `結果未確認: ${unconfirmed}件`,
    `停止中: ${blocked}件`,
    ...(examples.length > 0 ? ['', '代表例', ...examples] : [])
  ].join('\n');
}
