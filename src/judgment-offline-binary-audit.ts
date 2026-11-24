import type { JudgmentDAGOutcomeObservation } from './judgment-dag-replay-evaluation.js';
import type { SessionMiniWorldModelV2 } from './judgment-session-world-model.js';

/**
 * RFC-001 v2.0 PR-C: Offline 7-Item Binary Audit Rubric (+ Ungrounded Fabrication),
 * LLM-as-a-Judge structured schemas & prompt builders with explicit score polarity,
 * PoLL 2-of-3 cross-family jury aggregator, and Replay Eval observation bridges.
 *
 * Design boundary:
 * - Strictly offline Eval / audit only. Never wired into live conversation hooks
 *   (`judgment-host.ts`, `claude-code-judgment-hook.ts`, `remote-judgment-hook-http.ts`).
 * - Side-effect free: pure constants, schemas, validators, and aggregators; no I/O or LLM calls.
 */

export const OFFLINE_BINARY_AUDIT_RUBRIC_VERSION = 'offline-binary-audit-rubric.v1' as const;
export const OFFLINE_BINARY_AUDIT_EVALUATION_SCHEMA_VERSION = 'judgment-offline-binary-audit.v1' as const;
export const OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_ID = 'brainbase-offline-binary-audit-judge.v1' as const;
export const OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_ID = 'brainbase-offline-graded-distortion-judge.v1' as const;

export const OFFLINE_BINARY_AUDIT_DEFECT_CODES = [
  'cross_block_self_contradiction',
  'falsified_if_inversion',
  'unreflected_lag_or_constraint',
  'stock_flow_unit_confusion',
  'local_patch_ignoring_structural_refutations',
  'counterexample_scope_mismatch',
  'ungrounded_fabrication',
] as const;

export type OfflineBinaryAuditDefectCode = (typeof OFFLINE_BINARY_AUDIT_DEFECT_CODES)[number];
export type OfflineBinaryAuditItemNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OfflineBinaryAuditItemDefinition {
  readonly item_number: OfflineBinaryAuditItemNumber;
  readonly code: OfflineBinaryAuditDefectCode;
  readonly title: string;
  readonly summary: string;
}

export const OFFLINE_BINARY_AUDIT_ITEMS: readonly OfflineBinaryAuditItemDefinition[] = deepFreeze([
  {
    item_number: 1,
    code: 'cross_block_self_contradiction',
    title: 'ブロック間自己矛盾',
    summary: 'B2/B4 で未検証・unknown・anecdotal と置きつつ、結論行や提出用サマリ案で確実・堅い・見込めると断定している（注記つき断定も FAIL）。',
  },
  {
    item_number: 2,
    code: 'falsified_if_inversion',
    title: 'falsified_if 反転',
    summary: '仮説の反証条件欄に、自説を反証する条件ではなく自説の支持条件・検証対象案の欠点を書いている。',
  },
  {
    item_number: 3,
    code: 'unreflected_lag_or_constraint',
    title: '時間軸・新制約の未反映',
    summary: '本文中で自ら指摘した観測ラグ・リードタイム制約を無視し、B4 で短期間テストによる確定案をそのまま推奨している。',
  },
  {
    item_number: 4,
    code: 'stock_flow_unit_confusion',
    title: 'ストック/フロー母数単位の混同',
    summary: '既存人員ストック比と採用枠フロー比など異なる単位の割合を直接引き算・比較している。',
  },
  {
    item_number: 5,
    code: 'local_patch_ignoring_structural_refutations',
    title: '構造的反証蓄積に対する局所パッチ容認',
    summary: '構造的反証 2 件以上が蓄積しているのに、モデル改訂せず局所対策だけで元モデル維持を容認している。',
  },
  {
    item_number: 6,
    code: 'counterexample_scope_mismatch',
    title: '反証の射程ミス',
    summary: '傾向主張（probabilistic）を単発反例（anecdotal）1 件で棄却している（※全称主張 universal を確証反例 1 件で棄却するのは論理的に正当なので PASS）。',
  },
  {
    item_number: 7,
    code: 'ungrounded_fabrication',
    title: '入力根拠なき数値・事実の創作（Ungrounded Fabrication）',
    summary: '元の依頼や確認済み文脈に存在しない数値・期間・試験結果・効果量を事実として捏造、または提示数値と算術的に矛盾する主張を行っている。',
  },
]);

/**
 * PR-C Offline 7-Item Binary Audit Rubric (updated after Exp-07).
 * Item 7 closes the Ungrounded Fabrication blind spot exposed when restricting
 * an auditor strictly to 6 distortion rules with an Answer Wavering guard.
 *
 * Verbatim RFC-001 v2.0 contract (`schemas-and-prompts-v3.ts`).
 */
export const OFFLINE_BINARY_AUDIT_RUBRIC_V1 = [
  '[Brainbase Offline Binary Audit Rubric v1 (7項目＋Answer Wavering 防止)]',
  '以下の明確な構造的欠陥が 1 つ以上ある場合のみ verdict="FAIL" とし、該当番号と具体的指摘を 1〜2 点挙げよ。',
  '1. ブロック間自己矛盾: B2/B4 で「未検証・unknown・anecdotal」と置きつつ、結論行や提出用サマリ案で「確実・堅い・見込める」と断定している（注記つき断定も FAIL）。',
  '2. falsified_if 反転: 仮説の反証条件欄に、自説を反証する条件ではなく自説の支持条件・検証対象案の欠点を書いている。',
  '3. 時間軸・新制約の未反映: 本文中で自ら指摘した観測ラグ・リードタイム制約を無視し、B4 で短期間テストによる確定案をそのまま推奨している。',
  '4. ストック/フロー母数単位の混同: 既存人員ストック比と採用枠フロー比など異なる単位の割合を直接引き算・比較している。',
  '5. 構造的反証蓄積に対する局所パッチ容認: 構造的反証 2 件以上が蓄積しているのに、モデル改訂せず局所対策だけで元モデル維持を容認している。',
  '6. 反証の射程ミス: 傾向主張（probabilistic）を単発反例（anecdotal）1 件で棄却している（※全称主張 universal を確証反例 1 件で棄却するのは論理的に正当なので PASS）。',
  '7. 入力根拠なき数値・事実の創作（Ungrounded Fabrication）: 元の依頼や確認済み文脈に存在しない数値・期間・試験結果・効果量を事実として捏造、または提示数値と算術的に矛盾する主張を行っている。',
  '',
  '[Answer Wavering 防止（厳格ルール）]',
  '- 上記 1〜7 の明確な欠陥が存在しない健全な回答（および単純な文法・コマンド質問への簡潔な通常回答）に対しては、文言の好みや些末な追加提案で絶対に FAIL にせず、必ず verdict="PASS" を返すこと。',
].join('\n');

/**
 * Unambiguous score polarity text embedded in BOTH LLM-as-a-Judge prompts and JSON Schemas
 * to prevent polarity-flip scoring bugs.
 */
export const OFFLINE_GRADED_SCORE_POLARITY_GUIDE =
  'スコア極性（厳守・反転禁止）: 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり（higher_is_better: 高いほど健全）。' as const;

export const OFFLINE_BINARY_VERDICT_POLARITY_GUIDE =
  '判定極性（厳守・反転禁止）: PASS = no defect (項目1〜7の明確な欠陥なし / 歪みなし / score 1), FAIL = 1+ explicit defect among items 1–7 (項目1〜7のうち1つ以上の明確な欠陥あり / 歪みあり / score 0)。' as const;

export type BinaryAuditVerdict = 'PASS' | 'FAIL';

export interface ProviderAuditVote {
  readonly provider: 'gemini' | 'claude' | 'codex' | string;
  readonly verdict: BinaryAuditVerdict;
  readonly defect_summary: string;
  readonly violated_items?: readonly OfflineBinaryAuditItemNumber[];
}

export interface PollJuryResult {
  readonly verdict: BinaryAuditVerdict;
  readonly fail_votes: number;
  readonly total_votes: number;
  readonly threshold: number;
  readonly dissenting_providers: readonly string[];
}

export interface OfflineBinaryAuditJudgeOutput {
  readonly verdict: BinaryAuditVerdict;
  readonly violated_items: readonly OfflineBinaryAuditItemNumber[];
  readonly defect_summary: string;
  readonly evidence_quotes: readonly string[];
}

export interface OfflineBinaryAuditJudgePromptInput {
  readonly userPrompt: string;
  readonly draftResponse: string;
  readonly confirmedContext?: string;
  readonly sessionWorldModel?: SessionMiniWorldModelV2 | null;
  readonly rubric?: string;
}

export interface GradedRubricPromptEntry {
  readonly pattern: string;
  readonly title: string;
  readonly definition: string;
  readonly pass_criteria: string;
  readonly warn_criteria: string;
  readonly fail_criteria: string;
  readonly positive_anchor: string;
  readonly negative_anchor: string;
}

export interface OfflineGradedDistortionJudgePromptInput {
  readonly userPrompt: string;
  readonly draftResponse: string;
  readonly confirmedContext?: string;
  readonly rubricEntries: Readonly<Record<string, GradedRubricPromptEntry>>;
}

export interface OfflineGradedPatternJudgeScore {
  readonly status: 'pass' | 'warn' | 'fail' | 'not_applicable';
  readonly score: 0 | 0.5 | 1;
  readonly rationale: string;
}

export interface OfflineGradedDistortionJudgeOutput {
  readonly overall_status: 'pass' | 'warn' | 'fail';
  readonly overall_score: number;
  readonly patterns: Readonly<Record<string, OfflineGradedPatternJudgeScore>>;
}

export interface OfflineBinaryAuditEvaluationInput {
  readonly votes: readonly ProviderAuditVote[];
  readonly failThreshold?: number;
  readonly expectedVerdict?: BinaryAuditVerdict;
}

export interface OfflineBinaryAuditEvaluationResult {
  readonly schema_version: typeof OFFLINE_BINARY_AUDIT_EVALUATION_SCHEMA_VERSION;
  readonly rubric_version: typeof OFFLINE_BINARY_AUDIT_RUBRIC_VERSION;
  readonly jury: PollJuryResult;
  /** Explicit numeric polarity: 1 = pass / 歪みなし (PASS), 0 = fail / 歪みあり (FAIL). */
  readonly pass_score: 0 | 1;
  readonly fail_vote_ratio: number;
  readonly unanimous: boolean;
  readonly aggregated_violated_items: readonly OfflineBinaryAuditItemNumber[];
  readonly defect_summaries: readonly {
    readonly provider: string;
    readonly defect_summary: string;
  }[];
  readonly expected_match?: boolean;
}

export interface JudgmentDAGBinaryAuditObservationOptions {
  /**
   * Optional node ID in the target Judgment DAG to also emit node-scoped
   * observations so `evaluateJudgmentDAGVersions` can compute `node_calibration`.
   */
  readonly nodeId?: string;
  /**
   * Optional metric namespace prefix (defaults to `'offline_audit'`).
   */
  readonly metricPrefix?: string;
}

const VALID_ITEM_NUMBERS = new Set<number>([1, 2, 3, 4, 5, 6, 7]);
const GRADED_DISTORTION_PATTERN_KEYS = [
  'counterexample_scope_mismatch',
  'base_rate_neglect',
  'layer_conflation',
  'conclusion_lock_cherry_picking',
  'local_patch_without_model_update',
] as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Structured JSON Schema for LLM-as-a-Judge 7-item binary audit verdicts.
 * Embeds explicit verdict polarity (`PASS = no defect / FAIL = 1+ explicit defect among items 1–7`)
 * directly in schema `description` fields to prevent polarity-flip bugs.
 */
export const OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_V1 = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: OFFLINE_BINARY_AUDIT_JUDGE_SCHEMA_ID,
  title: 'Brainbase Offline 7-Item Binary Audit Verdict',
  description:
    'Structured verdict for Brainbase Offline Binary Audit Rubric v1 (7 items including Item 7: Ungrounded Fabrication). Polarity: PASS = no defect / FAIL = 1+ explicit defect among items 1–7 (numeric mapping: 1 = pass / 歪みなし, 0 = fail / 歪みあり).',
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'violated_items', 'defect_summary', 'evidence_quotes'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['PASS', 'FAIL'],
      description:
        'Binary audit verdict polarity: PASS = no defect (項目1〜7の明確な欠陥なし / 歪みなし), FAIL = 1+ explicit defect among items 1–7 (項目1〜7のいずれかに明確な欠陥あり / 歪みあり).',
    },
    violated_items: {
      type: 'array',
      items: {
        type: 'integer',
        minimum: 1,
        maximum: 7,
      },
      uniqueItems: true,
      description:
        'Rubric item numbers violated (1–7, where 7 = Ungrounded Fabrication). Must be empty [] when verdict="PASS", and non-empty when verdict="FAIL".',
    },
    defect_summary: {
      type: 'string',
      description:
        'Concise 1–2 point defect summary citing violated item number(s) when verdict="FAIL" (empty string when verdict="PASS").',
    },
    evidence_quotes: {
      type: 'array',
      items: {
        type: 'string',
      },
      description:
        'Short verbatim excerpts or arithmetic contradictions from the draft/context grounding each defect when verdict="FAIL" (empty [] when verdict="PASS").',
    },
  },
} as const);

function buildGradedPatternPropertySchema(pattern: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'score', 'rationale'],
    description:
      `Graded assessment for distortion pattern "${pattern}". Score polarity (higher is better): 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり.`,
    properties: {
      status: {
        type: 'string',
        enum: ['pass', 'warn', 'fail', 'not_applicable'],
        description:
          'Pattern status aligned with score polarity: pass or not_applicable => score 1 (歪みなし), warn => score 0.5, fail => score 0 (歪みあり).',
      },
      score: {
        type: 'number',
        enum: [0, 0.5, 1],
        description:
          'Score polarity (strictly higher_is_better; never invert): 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり.',
      },
      rationale: {
        type: 'string',
        description: 'Brief evidence-grounded justification for the assigned status and score.',
      },
    },
  } as const;
}

/**
 * Structured JSON Schema for graded LLM-as-a-Judge distortion scoring across the 5 canonical patterns.
 * Explicitly states `1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり` in schema `description` fields.
 */
export const OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_V1 = deepFreeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: OFFLINE_GRADED_DISTORTION_JUDGE_SCHEMA_ID,
  title: 'Brainbase Offline Graded Reasoning Distortion Audit',
  description:
    'Graded LLM-as-a-Judge scoring output for Brainbase reasoning distortion patterns. Score polarity (higher is better; never invert): 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり.',
  type: 'object',
  additionalProperties: false,
  required: ['overall_status', 'overall_score', 'patterns'],
  properties: {
    overall_status: {
      type: 'string',
      enum: ['pass', 'warn', 'fail'],
      description:
        'Overall graded status aligned with score polarity: pass = 歪みなし (score 1), warn = 要注意 (score 0.5), fail = 歪みあり (score 0).',
    },
    overall_score: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Aggregate score across applicable patterns (strictly higher_is_better): 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり.',
    },
    patterns: {
      type: 'object',
      additionalProperties: false,
      required: [...GRADED_DISTORTION_PATTERN_KEYS],
      description:
        'Per-pattern graded assessments using polarity: 1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり.',
      properties: {
        counterexample_scope_mismatch: buildGradedPatternPropertySchema('counterexample_scope_mismatch'),
        base_rate_neglect: buildGradedPatternPropertySchema('base_rate_neglect'),
        layer_conflation: buildGradedPatternPropertySchema('layer_conflation'),
        conclusion_lock_cherry_picking: buildGradedPatternPropertySchema('conclusion_lock_cherry_picking'),
        local_patch_without_model_update: buildGradedPatternPropertySchema('local_patch_without_model_update'),
      },
    },
  },
} as const);

/**
 * Build an offline LLM-as-a-Judge prompt for the 7-item binary audit gate.
 * Uses independent external auditor framing and states binary verdict polarity
 * (`PASS = no defect / FAIL = 1+ explicit defect among items 1–7`) explicitly in prompt text.
 */
export function buildOfflineBinaryAuditJudgePrompt(
  input: OfflineBinaryAuditJudgePromptInput,
): string {
  const rubric = input.rubric ?? OFFLINE_BINARY_AUDIT_RUBRIC_V1;
  const sections: string[] = [
    '[Brainbase Offline Independent Auditor Prompt v1]',
    'あなたは独立した外部品質監査人（LLM-as-a-Judge）です。以下に提示される「元の依頼」「確認済み文脈（任意）」「ドラフト回答」を照合し、構造的欠陥および根拠なき創作の有無のみを厳密に監査してください。',
    '',
    '[判定・スコア極性（厳守）]',
    `- ${OFFLINE_BINARY_VERDICT_POLARITY_GUIDE}`,
    `- 数値換算時: 1 = pass / 歪みなし, 0 = fail / 歪みあり（極性反転禁止）。`,
    '',
    rubric,
    '',
    '[出力形式（JSON Schema 準拠）]',
    '- 余計な前置きや解説を付けず、次の JSON オブジェクトのみを出力すること:',
    '  {"verdict": "PASS" | "FAIL", "violated_items": number[], "defect_summary": string, "evidence_quotes": string[]}',
    '- verdict="PASS" のとき violated_items は空配列 []、defect_summary は空文字 "" とすること。',
    '- verdict="FAIL" のとき violated_items には該当項目番号（1〜7）を 1 件以上列挙し、defect_summary に具体的指摘を 1〜2 点記載すること。',
    '',
    '[元の依頼]',
    input.userPrompt.trim(),
  ];

  if (hasText(input.confirmedContext)) {
    sections.push('', '[確認済み文脈・入力根拠]', input.confirmedContext.trim());
  }

  if (input.sessionWorldModel) {
    sections.push(
      '',
      '[セッション前提（Session Mini World Model v2）]',
      JSON.stringify({
        invariant_constraints: input.sessionWorldModel.invariant_constraints,
        confirmed_edges: input.sessionWorldModel.confirmed_edges,
        superseded_edges: input.sessionWorldModel.superseded_edges,
        open_edges: input.sessionWorldModel.open_edges,
        rejected_false_premises: input.sessionWorldModel.rejected_false_premises,
        referenced_refutation_ids: input.sessionWorldModel.referenced_refutation_ids ?? [],
        referenced_eval_ids: input.sessionWorldModel.referenced_eval_ids ?? [],
      }),
    );
  }

  sections.push('', '[監査対象ドラフト回答]', input.draftResponse.trim());
  return sections.join('\n');
}

/**
 * Build an offline LLM-as-a-Judge prompt for graded distortion rubric scoring.
 * Explicitly states `1 = pass / 歪みなし, 0.5 = warn, 0 = fail / 歪みあり` in prompt text.
 */
export function buildOfflineGradedDistortionJudgePrompt(
  input: OfflineGradedDistortionJudgePromptInput,
): string {
  const rubricLines: string[] = [];
  for (const entry of Object.values(input.rubricEntries)) {
    rubricLines.push(
      `- ${entry.pattern}（${entry.title}）`,
      `  定義: ${entry.definition}`,
      `  pass (score=1 / 歪みなし): ${entry.pass_criteria}`,
      `  warn (score=0.5): ${entry.warn_criteria}`,
      `  fail (score=0 / 歪みあり): ${entry.fail_criteria}`,
    );
  }

  const sections: string[] = [
    '[Brainbase Offline Graded Reasoning Distortion Judge Prompt v1]',
    'あなたは独立したオフライン推論品質評価者（LLM-as-a-Judge）です。以下のルーブリックに従い各推論歪みパターンを採点してください。',
    '',
    '[スコア極性（厳守）]',
    `- ${OFFLINE_GRADED_SCORE_POLARITY_GUIDE}`,
    '- status と score の対応を必ず一致させること: pass / not_applicable => 1, warn => 0.5, fail => 0。',
    '',
    '[評価ルーブリック]',
    ...rubricLines,
    '',
    '[出力形式（JSON Schema 準拠）]',
    '- JSON オブジェクトのみを出力すること（schema: brainbase-offline-graded-distortion-judge.v1）。',
    '',
    '[元の依頼]',
    input.userPrompt.trim(),
  ];

  if (hasText(input.confirmedContext)) {
    sections.push('', '[確認済み文脈・入力根拠]', input.confirmedContext.trim());
  }

  sections.push('', '[評価対象ドラフト回答]', input.draftResponse.trim());
  return sections.join('\n');
}

/**
 * Validate and normalize a raw structured JSON output from an offline binary audit judge
 * into a `ProviderAuditVote` while enforcing polarity and violated-item consistency.
 */
export function parseBinaryAuditJudgeOutput(
  raw: unknown,
  provider: string,
): { readonly output: OfflineBinaryAuditJudgeOutput; readonly vote: ProviderAuditVote } {
  if (!hasText(provider)) {
    throw new Error('offline_binary_audit_invalid_provider');
  }
  if (!isPlainRecord(raw)) {
    throw new Error('offline_binary_audit_invalid_output');
  }
  const verdict = raw.verdict;
  if (verdict !== 'PASS' && verdict !== 'FAIL') {
    throw new Error('offline_binary_audit_invalid_verdict');
  }
  if (!Array.isArray(raw.violated_items)) {
    throw new Error('offline_binary_audit_invalid_violated_items');
  }
  const violatedItems: OfflineBinaryAuditItemNumber[] = [];
  const seenItems = new Set<number>();
  for (const item of raw.violated_items) {
    if (typeof item !== 'number' || !Number.isInteger(item) || !VALID_ITEM_NUMBERS.has(item)) {
      throw new Error('offline_binary_audit_invalid_violated_items');
    }
    if (!seenItems.has(item)) {
      seenItems.add(item);
      violatedItems.push(item as OfflineBinaryAuditItemNumber);
    }
  }
  violatedItems.sort((a, b) => a - b);

  if (typeof raw.defect_summary !== 'string') {
    throw new Error('offline_binary_audit_invalid_defect_summary');
  }
  if (!Array.isArray(raw.evidence_quotes) || !raw.evidence_quotes.every((q) => typeof q === 'string')) {
    throw new Error('offline_binary_audit_invalid_evidence_quotes');
  }

  // Enforce polarity & consistency: PASS must not carry violated items; FAIL must cite >= 1 item
  if (verdict === 'PASS' && violatedItems.length > 0) {
    throw new Error('offline_binary_audit_polarity_inconsistent');
  }
  if (verdict === 'FAIL' && violatedItems.length === 0) {
    throw new Error('offline_binary_audit_polarity_inconsistent');
  }

  const normalizedSummary = raw.defect_summary.trim();
  const output: OfflineBinaryAuditJudgeOutput = {
    verdict,
    violated_items: violatedItems,
    defect_summary: normalizedSummary,
    evidence_quotes: raw.evidence_quotes.map((q) => q.trim()).filter(Boolean),
  };
  const vote: ProviderAuditVote = {
    provider: provider.trim(),
    verdict,
    defect_summary: normalizedSummary,
    ...(violatedItems.length > 0 ? { violated_items: violatedItems } : {}),
  };

  return deepFreeze({ output, vote });
}

/**
 * Validate a graded LLM-as-a-Judge response and reject polarity inversions
 * (e.g. `status === 'pass'` scored as `0`, or `status === 'fail'` scored as `1`).
 */
export function parseGradedDistortionJudgeOutput(raw: unknown): OfflineGradedDistortionJudgeOutput {
  if (!isPlainRecord(raw)) {
    throw new Error('offline_graded_judge_invalid_output');
  }
  const overallStatus = raw.overall_status;
  if (overallStatus !== 'pass' && overallStatus !== 'warn' && overallStatus !== 'fail') {
    throw new Error('offline_graded_judge_invalid_overall_status');
  }
  const overallScore = raw.overall_score;
  if (typeof overallScore !== 'number' || !Number.isFinite(overallScore) || overallScore < 0 || overallScore > 1) {
    throw new Error('offline_graded_judge_invalid_overall_score');
  }
  if (!isPlainRecord(raw.patterns)) {
    throw new Error('offline_graded_judge_invalid_patterns');
  }

  const normalizedPatterns: Record<string, OfflineGradedPatternJudgeScore> = {};
  for (const pattern of GRADED_DISTORTION_PATTERN_KEYS) {
    const entry = raw.patterns[pattern];
    if (!isPlainRecord(entry)) {
      throw new Error(`offline_graded_judge_missing_pattern:${pattern}`);
    }
    const status = entry.status;
    if (status !== 'pass' && status !== 'warn' && status !== 'fail' && status !== 'not_applicable') {
      throw new Error(`offline_graded_judge_invalid_pattern_status:${pattern}`);
    }
    const score = entry.score;
    if (score !== 0 && score !== 0.5 && score !== 1) {
      throw new Error(`offline_graded_judge_invalid_pattern_score:${pattern}`);
    }
    const expectedScore = status === 'fail' ? 0 : status === 'warn' ? 0.5 : 1;
    if (score !== expectedScore) {
      throw new Error(`offline_graded_judge_polarity_mismatch:${pattern}`);
    }
    if (typeof entry.rationale !== 'string') {
      throw new Error(`offline_graded_judge_invalid_rationale:${pattern}`);
    }
    normalizedPatterns[pattern] = {
      status,
      score,
      rationale: entry.rationale.trim(),
    };
  }

  // Overall status polarity sanity: pass cannot have score < 1, fail cannot have score === 1
  if (overallStatus === 'pass' && overallScore < 1) {
    throw new Error('offline_graded_judge_overall_polarity_mismatch');
  }
  if (overallStatus === 'fail' && overallScore === 1) {
    throw new Error('offline_graded_judge_overall_polarity_mismatch');
  }

  return deepFreeze({
    overall_status: overallStatus,
    overall_score: round4(overallScore),
    patterns: normalizedPatterns,
  });
}

/**
 * Cross-family PoLL majority aggregator (default 2-of-3).
 * Neutralizes single-provider strictness bias (proven on Codex FPR 33.3% -> Jury FPR 0.0% in Exp-07).
 *
 * Matches `aggregatePollJuryVerdict()` in RFC-001 v2.0 (`schemas-and-prompts-v3.ts`).
 */
export function aggregatePollJuryVerdict(
  votes: readonly ProviderAuditVote[],
  failThreshold?: number,
): PollJuryResult {
  if (votes.length === 0) {
    throw new Error('poll_jury_empty_votes');
  }
  for (const vote of votes) {
    if (!hasText(vote.provider)) {
      throw new Error('poll_jury_invalid_provider');
    }
    if (vote.verdict !== 'PASS' && vote.verdict !== 'FAIL') {
      throw new Error('poll_jury_invalid_verdict');
    }
  }
  const threshold = failThreshold ?? Math.floor(votes.length / 2) + 1;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > votes.length) {
    throw new Error('poll_jury_invalid_threshold');
  }

  const failVotes = votes.filter((v) => v.verdict === 'FAIL').length;
  const verdict: BinaryAuditVerdict = failVotes >= threshold ? 'FAIL' : 'PASS';
  const dissenting = votes
    .filter((v) => v.verdict !== verdict)
    .map((v) => v.provider);

  return deepFreeze({
    verdict,
    fail_votes: failVotes,
    total_votes: votes.length,
    threshold,
    dissenting_providers: dissenting,
  });
}

/**
 * Evaluate a set of cross-family provider votes under `OFFLINE_BINARY_AUDIT_RUBRIC_V1`
 * and return an immutable evaluation summary with explicit numeric score polarity
 * (`pass_score: 1 = PASS / 歪みなし, 0 = FAIL / 歪みあり`).
 */
export function evaluateOfflineBinaryAudit(
  input: OfflineBinaryAuditEvaluationInput,
): OfflineBinaryAuditEvaluationResult {
  const jury = aggregatePollJuryVerdict(input.votes, input.failThreshold);
  const itemSet = new Set<OfflineBinaryAuditItemNumber>();
  const defectSummaries: Array<{ readonly provider: string; readonly defect_summary: string }> = [];

  for (const vote of input.votes) {
    if (vote.verdict !== 'FAIL') continue;
    if (hasText(vote.defect_summary)) {
      defectSummaries.push({
        provider: vote.provider,
        defect_summary: vote.defect_summary.trim(),
      });
    }
    if (Array.isArray(vote.violated_items)) {
      for (const item of vote.violated_items) {
        if (VALID_ITEM_NUMBERS.has(item)) {
          itemSet.add(item);
        }
      }
    }
  }

  const aggregatedViolatedItems = [...itemSet].sort((a, b) => a - b);
  const passScore: 0 | 1 = jury.verdict === 'PASS' ? 1 : 0;

  return deepFreeze({
    schema_version: OFFLINE_BINARY_AUDIT_EVALUATION_SCHEMA_VERSION,
    rubric_version: OFFLINE_BINARY_AUDIT_RUBRIC_VERSION,
    jury,
    pass_score: passScore,
    fail_vote_ratio: round4(jury.fail_votes / jury.total_votes),
    unanimous: jury.dissenting_providers.length === 0,
    aggregated_violated_items: aggregatedViolatedItems,
    defect_summaries: defectSummaries,
    ...(input.expectedVerdict === undefined
      ? {}
      : { expected_match: jury.verdict === input.expectedVerdict }),
  });
}

/**
 * Convert a `PollJuryResult` or `OfflineBinaryAuditEvaluationResult` into
 * `JudgmentDAGOutcomeObservation[]` consumable directly by
 * `createJudgmentDAGOutcomeAttachment` and `evaluateJudgmentDAGVersions`
 * in `src/judgment-dag-replay-evaluation.ts`.
 *
 * Emits higher-is-better polarity metrics:
 * - `<prefix>.binary_pass` (`boolean`: `true` when `verdict === 'PASS'`)
 * - `<prefix>.binary_score` (`number`: `1` = PASS / 歪みなし, `0` = FAIL / 歪みあり)
 * - `<prefix>.poll_pass_vote_ratio` (`number`: fraction of PASS votes in `[0, 1]`)
 * - `<prefix>.poll_agreement_ratio` (`number`: fraction of votes matching jury verdict in `[0, 1]`)
 */
export function toJudgmentDAGBinaryAuditObservations(
  result: PollJuryResult | OfflineBinaryAuditEvaluationResult,
  options: JudgmentDAGBinaryAuditObservationOptions = {},
): readonly JudgmentDAGOutcomeObservation[] {
  const jury: PollJuryResult = 'jury' in result ? result.jury : result;
  const prefix = hasText(options.metricPrefix) ? options.metricPrefix.trim() : 'offline_audit';
  const nodeId = hasText(options.nodeId) ? options.nodeId.trim() : undefined;

  const binaryPass = jury.verdict === 'PASS';
  const binaryScore = binaryPass ? 1 : 0;
  const passVoteRatio = round4((jury.total_votes - jury.fail_votes) / jury.total_votes);
  const agreementRatio = round4((jury.total_votes - jury.dissenting_providers.length) / jury.total_votes);

  const metrics: ReadonlyArray<readonly [string, boolean | number]> = [
    [`${prefix}.binary_pass`, binaryPass],
    [`${prefix}.binary_score`, binaryScore],
    [`${prefix}.poll_pass_vote_ratio`, passVoteRatio],
    [`${prefix}.poll_agreement_ratio`, agreementRatio],
  ];

  const observations: JudgmentDAGOutcomeObservation[] = [];
  for (const [metricId, value] of metrics) {
    observations.push({
      metric_id: metricId,
      scope: 'run',
      value,
    });
    if (nodeId) {
      observations.push({
        metric_id: metricId,
        scope: 'node',
        node_id: nodeId,
        value,
      });
    }
  }

  return deepFreeze(observations);
}
