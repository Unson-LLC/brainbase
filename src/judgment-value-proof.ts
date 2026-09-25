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

/** Which part of the organization's judgment a basis came from. Absent means not recorded. */
export type JudgmentValueProofBasisLayer =
  | 'philosophy'
  | 'objective'
  | 'world_model'
  | 'method'
  | 'constraint'
  | 'other';

export interface JudgmentValueProofBasis {
  entity_id: string;
  application: string;
  layer?: JudgmentValueProofBasisLayer;
  /** Version of the referenced entity used for this judgment. */
  version?: string | null;
}

export interface JudgmentValueProofInheritanceSource {
  kind: 'judgment' | 'method' | 'decision' | 'other';
  ref: string;
  version: string | null;
  label: string;
}

/** Earlier experience carried into this judgment, recorded at judgment time. */
export interface JudgmentValueProofInheritance {
  sources: JudgmentValueProofInheritanceSource[];
  /** Conditions judged to be the same as the source, so the source could be reused. */
  same_conditions: string[];
  /** Conditions that differed and were checked again for this judgment. */
  rechecked_conditions: string[];
}

/** Stable grouping for delegation scope, e.g. `production_release`. */
export interface JudgmentValueProofKind {
  key: string;
  label: string;
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
    judgment_kind?: JudgmentValueProofKind | null;
    inheritance?: JudgmentValueProofInheritance | null;
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
  /** `review`: listed on the local owner review surface (same scope as the weekly digest). */
  web_surface: 'none' | 'review';
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

const BASIS_LAYER_LABELS: Readonly<Record<JudgmentValueProofBasisLayer, string>> = {
  philosophy: '大切にすること',
  objective: '目的',
  world_model: '現状と見通し',
  method: '判断方法',
  constraint: '守る条件',
  other: 'その他'
};

function basisLabel(entry: JudgmentValueProofBasis): string {
  return entry.layer ? `[${BASIS_LAYER_LABELS[entry.layer]}] ${entry.application}` : entry.application;
}

function inheritanceLine(inheritance: JudgmentValueProofInheritance | null | undefined): string | null {
  if (!inheritance || inheritance.sources.length === 0) return null;
  const sources = inheritance.sources.map((source) => source.label.trim()).join(' / ');
  const same = inheritance.same_conditions.length > 0 ? `。今回も同じ: ${inheritance.same_conditions.join('、')}` : '';
  const rechecked = inheritance.rechecked_conditions.length > 0 ? `。今回だけ確認: ${inheritance.rechecked_conditions.join('、')}` : '';
  return `引き継ぎ: ${sources}${same}${rechecked}`;
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

  const layers: readonly JudgmentValueProofBasisLayer[] = ['philosophy', 'objective', 'world_model', 'method', 'constraint', 'other'];
  for (const entry of proof.decision.basis) {
    if (entry.layer !== undefined && !layers.includes(entry.layer)) {
      throw new TypeError(`unsupported decision.basis[].layer: ${String(entry.layer)}`);
    }
  }

  const kind = proof.decision.judgment_kind;
  if (kind !== undefined && kind !== null) {
    if (!/^[a-z0-9_]{1,64}$/u.test(kind.key ?? '')) {
      throw new TypeError('decision.judgment_kind.key must be 1-64 lowercase letters, digits or underscores');
    }
    requiredText(kind.label, 'decision.judgment_kind.label');
  }

  const inheritance = proof.decision.inheritance;
  if (inheritance !== undefined && inheritance !== null) {
    for (const source of inheritance.sources) {
      requiredText(source.ref, 'decision.inheritance.sources[].ref');
      requiredText(source.label, 'decision.inheritance.sources[].label');
    }
    if (inheritance.sources.length > 0 && proof.decision.prior_learning_reused === false) {
      throw new TypeError('decision.inheritance.sources contradicts prior_learning_reused=false');
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
  const weeklyDigest = proof.interruption.resolution === 'not_applicable'
    && proof.feedback.status === 'none'
    && proof.state !== 'blocked'
    && proof.outcome.status === 'not_applicable'
    ? 'exclude'
    : 'include';

  return {
    agent_progress: behaviorChanged && proof.execution.status === 'executing' ? 'show' : 'silent',
    agent_completion: behaviorChanged && completed ? 'show' : 'silent',
    companion_attention: companionAttention,
    web_surface: weeklyDigest === 'include' ? 'review' : 'none',
    weekly_digest: weeklyDigest
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
    ? proof.decision.basis.map(basisLabel).join(' / ')
    : '適用根拠は未確認';
  const inheritance = inheritanceLine(proof.decision.inheritance);
  const evidence = proof.outcome.evidence_refs.length > 0
    ? proof.outcome.evidence_refs.map(evidenceLabel).join(' / ')
    : '成果証跡なし';

  return [
    'Brainbase判断レシート',
    `結果: ${result}`,
    `判断: ${decision}`,
    `仕事への影響: ${impact}`,
    `根拠: ${basis}`,
    ...(inheritance ? [inheritance] : []),
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
