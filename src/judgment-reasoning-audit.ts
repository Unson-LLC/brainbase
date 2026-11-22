import {
  JUDGMENT_FRAME_ROLE_BY_KIND,
  validateJudgmentFrameRecord,
  type JudgmentFrameCatalog,
  type JudgmentFrameCatalogItem,
  type JudgmentFrameEscalationCode,
  type JudgmentFrameOption,
  type JudgmentFramePredictionBalance,
  type JudgmentFrameRecord,
  type JudgmentFrameUse,
} from './judgment-frame.js';
import {
  isAnecdotalRefutation,
  summarizeJudgmentModelOutcomes,
  type JudgmentModelOutcomeStoredRecord,
  type JudgmentModelOutcomeSummary,
} from './judgment-model-outcome.js';
import type { JudgmentNodeResult } from './judgment-node-evidence.js';
import type { GraphRetrievalResponse } from './graph-retrieval.js';
import type { LearningCandidate } from './company-os-learning-adoption.js';
import type { JudgmentDAGOutcomeObservation } from './judgment-dag-replay-evaluation.js';

/**
 * Deterministic structural audit and shared rubric for the five canonical
 * reasoning-distortion patterns.
 *
 * Design boundary:
 * - This module evaluates ONLY structural fields (escalations, claim scopes,
 *   representativeness, population/support/counter balance fields, retrieval
 *   counts/coverage, option/catalog structure, verify node evidence IDs, and
 *   world-model refutation/learning-candidate links).
 * - It deliberately avoids free-text regex heuristics. Semantic assessment of
 *   free-text reasoning belongs to offline LLM-as-a-Judge evaluation using the
 *   co-exported `JUDGMENT_REASONING_DISTORTION_RUBRIC_V1` vocabulary.
 * - Side-effect free: never mutates inputs or performs I/O.
 */

export const JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION = 'judgment-reasoning-audit.v1' as const;
export const JUDGMENT_REASONING_DISTORTION_RUBRIC_VERSION = 'judgment-reasoning-distortion-rubric.v1' as const;

export const JUDGMENT_REASONING_DISTORTION_PATTERNS = [
  'counterexample_scope_mismatch',
  'base_rate_neglect',
  'layer_conflation',
  'conclusion_lock_cherry_picking',
  'local_patch_without_model_update',
] as const;

export type JudgmentReasoningDistortionPattern = typeof JUDGMENT_REASONING_DISTORTION_PATTERNS[number];
export type JudgmentReasoningPatternStatus = 'pass' | 'warn' | 'fail' | 'not_applicable';
export type JudgmentReasoningOverallStatus = 'pass' | 'warn' | 'fail';
export type JudgmentReasoningPatternScore = 0 | 0.5 | 1;

export type JudgmentReasoningLearningCandidate = LearningCandidate & {
  readonly addressedRefutationIds?: readonly string[];
};

export type JudgmentReasoningRetrievalSample = Pick<
  GraphRetrievalResponse,
  'coverage' | 'returnedCount' | 'totalScopedCount'
>;

export interface JudgmentReasoningAuditInput {
  readonly frame: JudgmentFrameRecord;
  readonly catalog: JudgmentFrameCatalog;
  readonly outcomes?: readonly JudgmentModelOutcomeStoredRecord[];
  readonly nodeResults?: readonly JudgmentNodeResult[];
  readonly retrieval?: readonly JudgmentReasoningRetrievalSample[];
  readonly learningCandidates?: readonly JudgmentReasoningLearningCandidate[];
}

export interface JudgmentReasoningPatternResult {
  readonly pattern: JudgmentReasoningDistortionPattern;
  readonly status: JudgmentReasoningPatternStatus;
  readonly score: JudgmentReasoningPatternScore;
  readonly signals: readonly string[];
  readonly evidence_paths: readonly string[];
}

export interface JudgmentReasoningAuditResult {
  readonly schema_version: typeof JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION;
  readonly overall_status: JudgmentReasoningOverallStatus;
  readonly overall_score: number;
  readonly patterns: Readonly<Record<JudgmentReasoningDistortionPattern, JudgmentReasoningPatternResult>>;
}

export interface JudgmentReasoningDistortionRubricEntry {
  readonly pattern: JudgmentReasoningDistortionPattern;
  readonly title: string;
  readonly definition: string;
  readonly pass_criteria: string;
  readonly warn_criteria: string;
  readonly fail_criteria: string;
  readonly positive_anchor: string;
  readonly negative_anchor: string;
}

export interface JudgmentDAGDistortionObservationOptions {
  /**
   * Optional node ID in the target Judgment DAG to also emit node-scoped
   * observations so `evaluateJudgmentDAGVersions` can compute `node_calibration`.
   */
  readonly nodeId?: string;
  /**
   * Optional per-pattern node IDs for finer-grained `node_calibration`.
   * Overrides `nodeId` for the specified patterns.
   */
  readonly patternNodeIds?: Readonly<Partial<Record<JudgmentReasoningDistortionPattern, string>>>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const JUDGMENT_REASONING_DISTORTION_RUBRIC_V1: Readonly<
  Record<JudgmentReasoningDistortionPattern, JudgmentReasoningDistortionRubricEntry>
> = deepFreeze({
  counterexample_scope_mismatch: {
    pattern: 'counterexample_scope_mismatch',
    title: '反証の射程ミス（Counterexample Scope Mismatch）',
    definition:
      '傾向・確率的な主張（claim_scope: probabilistic）を単発・逸話的な反例（counter_representativeness: anecdotal）だけで全面否定したり、逆に全称主張（universal）の反証範囲を取り違える推論歪み。',
    pass_criteria:
      '主張の射程（universal / probabilistic / bounded_case）と反証証拠の代表性（census / representative / anecdotal）が整合している。傾向主張を failed とする場合は census または representative な反証に基づく。',
    warn_criteria:
      '傾向主張を failed と判定しているが、反証の代表性が unknown または未指定（かつ履歴上は逸話反証のみ）で射程の妥当性を構造的に確定できない。',
    fail_criteria:
      'prediction_scope_mismatch エスカレーションが発火している、または claim_scope === "probabilistic" の予測チェックを counter_representativeness === "anecdotal" のまま status === "failed" と判定している。',
    positive_anchor:
      '全12施設×30日の集計（representative）で傾向が逆転したことを確認して probabilistic 予測を failed とする、または universal 予測を単発の確証反例（anecdotal）で棄却する。',
    negative_anchor:
      '全体では改善傾向にある probabilistic 予測を、1施設の特例日（counter_representativeness: anecdotal）だけを根拠に status: failed として棄却する。',
  },
  base_rate_neglect: {
    pattern: 'base_rate_neglect',
    title: '全体傾向・母集団の無視（Base Rate Neglect）',
    definition:
      '母集団（population）や支持・反証の双方の要約（supporting_summary / counter_summary）を確認せず、局所的・部分的な検索結果や偏った事例だけで結論を下す推論歪み。',
    pass_criteria:
      '予測チェックに balance（population / supporting_summary / counter_summary）が欠落なく記載されており、部分検索（coverage: partial や returnedCount < totalScopedCount）がある場合でも母集団の分母が明示されている。',
    warn_criteria:
      '部分検索の兆候はないが、採用案の検証済み予測チェック（held / failed）に balance 自体が省略されており、母集団と支持・反証の対比が明示されていない。',
    fail_criteria:
      'prediction_unbalanced_evidence が発火している、balance 付き予測で population / supporting_summary / counter_summary が欠落・空白である、または retrieval が部分取得（coverage: partial または returnedCount < totalScopedCount）であるのに balance.population が未記載である。',
    positive_anchor:
      'retrieval が 5/50 件の partial 取得であることを踏まえ、balance.population に全50件の母集団と抽出範囲を明記し、支持例と反例を両方要約したうえで判断する。',
    negative_anchor:
      '上位5件しか返らない部分検索結果のみを根拠に balance.population を記載せず判断する、あるいは counter_summary を空のまま予測成立（held）とする。',
  },
  layer_conflation: {
    pattern: 'layer_conflation',
    title: '事実・因果・価値（制約）の混同（Layer Conflation）',
    definition:
      '哲学（constraint）・目的（criterion）・世界モデル（prediction）の役割境界を混同したり、未検証の因果仮説（draft / adopted_unverified）を反証条件の検証なしに既定の事実として扱う推論歪み。',
    pass_criteria:
      'philosophy は constraint（verdict 必須・check なし）、objective は criterion（check/verdict なし）、model は prediction（falsified_if を持つ check で検証）として層が分離され、採用案が依存する未検証モデルはすべて検証済み（held）である。',
    warn_criteria:
      '層・ロールの混同はないが、採用案が依存する verified モデルについて当ケースでの予測チェックが unchecked（または未記載）のまま残っている。',
    fail_criteria:
      '採用案が draft / adopted_unverified の未検証モデルを unchecked（または check なし）のまま依存している、予測チェックの falsified_if が欠落している、またはカタログ種別とロール・verdict・check の対応が構造的に混同されている。',
    positive_anchor:
      'adopted_unverified のモデルを prediction として明示的に falsified_if と実測データで検証（status: held）したうえで採用し、philosophy は constraint + verdict として独立に評価する。',
    negative_anchor:
      'adopted_unverified の因果モデルを check.status: unchecked のまま採用案の根拠にする、またはモデルを constraint として扱ったり falsified_if を空にする。',
  },
  conclusion_lock_cherry_picking: {
    pattern: 'conclusion_lock_cherry_picking',
    title: '結論先固定・チェリーピッキング（Conclusion Lock & Cherry-Picking）',
    definition:
      '単一案のみを並べて代替案比較を行わない、同スコープの競合モデルや現行版で構造的反証済みのモデルを無視して都合のよい根拠だけを集める、あるいは検証ノード（node_id を区切り文字で分割したトークンに verify を含むノード）に実行証跡を伴わせない推論歪み。',
    pass_criteria:
      '2案以上の選択肢（options.length >= 2）を比較し、モデル使用時に同スコープの他モデルまたは現行版の構造的反証済みモデルが存在する場合は competing_hypotheses または counter_summary で明示的に対比し、verify ノード（例: verify, judgment.verify）には業務ツールの証跡（evidence_tool_use_ids）が紐づいている。',
    warn_criteria:
      '結論先固定の直接違反はないが、verify ノード（node_id の区切りトークンに verify を含むノード）が insufficient かつ evidence_tool_use_ids が空のまま残っている。',
    fail_criteria:
      'options.length <= 1（代替案比較なし）、モデル使用時にカタログ内に同スコープの他モデルまたは現行版の構造的反証済みモデルがあるのに competing_hypotheses が空かつ counter_summary も空・未記載、または nodeResults の verify ノード（区切り文字で分割したトークンに verify を含む node_id）が証跡（evidence_tool_use_ids）なしで supported となっている。',
    positive_anchor:
      '2案以上を同一基準で比較し、同スコープの競合モデルを competing_hypotheses で比較したうえで、verify ノードに実測クエリの tool_use_id を紐づける。',
    negative_anchor:
      '採用したい1案だけを options に並べる、カタログ内の競合モデルを無視して counter_summary も空にする、または verify ノードを evidence_tool_use_ids: [] のまま supported と記録する。',
  },
  local_patch_without_model_update: {
    pattern: 'local_patch_without_model_update',
    title: '局所訂正のみで世界モデル未更新（Local Patch Without Model Update）',
    definition:
      '反証済みモデルや失敗した予測に依存したまま結論を通す、あるいは構造的反証が蓄積しているのに世界モデルの改訂候補（LearningCandidate）や反証IDの紐づけ（addressedRefutationIds）を行わず場当たり的に済ませる推論歪み。',
    pass_criteria:
      '採用案が反証済みモデルや failed 予測に依存しておらず、使用モデルに構造的反証が2件以上蓄積している場合は該当モデルに対する LearningCandidate が存在し、記録済み構造的反証IDを addressedRefutationIds で漏れなく参照している。',
    warn_criteria:
      '反証蓄積モデルに対して LearningCandidate と非空の addressedRefutationIds が提示されているが、現行版の構造的反証IDの一部が addressedRefutationIds に含まれていない。',
    fail_criteria:
      'chosen_uses_refuted_model または chosen_relies_on_failed_prediction が発火している、使用モデルに構造的反証が2件以上蓄積しているのに該当モデルへの LearningCandidate が0件である、または世界モデルの LearningCandidate で addressedRefutationIds が空のまま改訂提案している。',
    positive_anchor:
      '構造的反証が2件蓄積したモデルAへの依存を避けてモデルBの案を採用しつつ、モデルAに対する LearningCandidate を addressedRefutationIds に両反証IDを紐づけて起票する。',
    negative_anchor:
      '構造的反証が2件以上あるモデルを使い続ける、あるいは別案へ切り替えてもモデル改訂候補を0件のまま放置する、または addressedRefutationIds を空配列で提出する。',
  },
});

const VALID_CONSTRAINT_VERDICTS = new Set<string>(['satisfied', 'violated', 'tension']);

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizedScopeKey(appliesWhen: string | undefined): string {
  return typeof appliesWhen === 'string' ? appliesWhen.trim() : '';
}

/**
 * Structural verify-node matcher: splits `node_id` on delimiter characters
 * (`-`, `.`, `_`, `/`, `:`, whitespace) and returns true when one of the
 * lowercase tokens is `"verify"` (e.g., `"verify"`, `"judgment.verify"`,
 * `"hypothesis-verify"`).
 */
function isVerifyNodeId(nodeId: string): boolean {
  const normalized = nodeId.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.split(/[-._/:\s]+/u).includes('verify');
}

function isPartialRetrievalSample(sample: JudgmentReasoningRetrievalSample): boolean {
  if (sample.coverage === 'partial') return true;
  if (typeof sample.returnedCount === 'number' && typeof sample.totalScopedCount === 'number') {
    return sample.returnedCount < sample.totalScopedCount;
  }
  return false;
}

function structuralRefutationCount(summary: JudgmentModelOutcomeSummary | undefined): number {
  if (!summary) return 0;
  return summary.structural_refutes ?? summary.refutes;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

interface IndexedUse {
  readonly optionIndex: number;
  readonly useIndex: number;
  readonly option: JudgmentFrameOption;
  readonly use: JudgmentFrameUse;
  readonly path: string;
  readonly isChosen: boolean;
}

interface PatternAccumulator {
  readonly failSignals: string[];
  readonly warnSignals: string[];
  readonly evidencePaths: string[];
}

function createAccumulator(): PatternAccumulator {
  return { failSignals: [], warnSignals: [], evidencePaths: [] };
}

function addFail(acc: PatternAccumulator, signal: string, paths: readonly string[] = []): void {
  acc.failSignals.push(signal);
  acc.evidencePaths.push(...paths);
}

function addWarn(acc: PatternAccumulator, signal: string, paths: readonly string[] = []): void {
  acc.warnSignals.push(signal);
  acc.evidencePaths.push(...paths);
}

function finalizePattern(
  pattern: JudgmentReasoningDistortionPattern,
  applicable: boolean,
  acc: PatternAccumulator,
): JudgmentReasoningPatternResult {
  const hasFail = acc.failSignals.length > 0;
  const hasWarn = acc.warnSignals.length > 0;
  if (!applicable && !hasFail && !hasWarn) {
    return {
      pattern,
      status: 'not_applicable',
      score: 1,
      signals: [],
      evidence_paths: [],
    };
  }
  if (hasFail) {
    return {
      pattern,
      status: 'fail',
      score: 0,
      signals: uniqueStrings([...acc.failSignals, ...acc.warnSignals]),
      evidence_paths: uniqueStrings(acc.evidencePaths),
    };
  }
  if (hasWarn) {
    return {
      pattern,
      status: 'warn',
      score: 0.5,
      signals: uniqueStrings(acc.warnSignals),
      evidence_paths: uniqueStrings(acc.evidencePaths),
    };
  }
  return {
    pattern,
    status: 'pass',
    score: 1,
    signals: [],
    evidence_paths: [],
  };
}

function hasBalancePopulated(balance: JudgmentFramePredictionBalance | undefined): boolean {
  return Boolean(balance && hasText(balance.population));
}

function hasCompetingHypotheses(balance: JudgmentFramePredictionBalance | undefined): boolean {
  return Array.isArray(balance?.competing_hypotheses) && balance.competing_hypotheses.length > 0;
}

function hasCounterSummary(balance: JudgmentFramePredictionBalance | undefined): boolean {
  return Boolean(balance && hasText(balance.counter_summary));
}

/**
 * Audit a judgment frame and its optional surrounding evidence (model outcomes,
 * node results, retrieval samples, and learning candidates) against the five
 * canonical reasoning-distortion patterns using purely structural checks.
 */
export function auditJudgmentReasoning(input: JudgmentReasoningAuditInput): JudgmentReasoningAuditResult {
  const frame = input.frame;
  const catalog = input.catalog;
  const outcomes = input.outcomes ?? [];
  const nodeResults = input.nodeResults ?? [];
  const retrieval = input.retrieval ?? [];
  const learningCandidates = input.learningCandidates ?? [];

  const outcomeSummaries = summarizeJudgmentModelOutcomes(outcomes, catalog);
  const validation = validateJudgmentFrameRecord(frame, catalog, outcomeSummaries);

  const escalationRefsByCode = new Map<JudgmentFrameEscalationCode, readonly string[]>();
  for (const escalation of validation.escalations) {
    escalationRefsByCode.set(escalation.code, escalation.refs);
  }
  const hasEscalation = (code: JudgmentFrameEscalationCode): boolean => escalationRefsByCode.has(code);

  const catalogItems: readonly JudgmentFrameCatalogItem[] = Array.isArray(catalog.items) ? catalog.items : [];
  const catalogById = new Map<string, JudgmentFrameCatalogItem>();
  const catalogIndexById = new Map<string, number>();
  catalogItems.forEach((item, index) => {
    catalogById.set(item.id, item);
    catalogIndexById.set(item.id, index);
  });

  const options: readonly JudgmentFrameOption[] = Array.isArray(frame.options) ? frame.options : [];
  const chosenOptionIndex = options.findIndex((option) => option.label === frame.chosen_option);
  const allUses: IndexedUse[] = [];
  options.forEach((option, optionIndex) => {
    const uses: readonly JudgmentFrameUse[] = Array.isArray(option.uses) ? option.uses : [];
    const isChosen = optionIndex === chosenOptionIndex;
    uses.forEach((use, useIndex) => {
      allUses.push({
        optionIndex,
        useIndex,
        option,
        use,
        path: `options[${optionIndex}].uses[${useIndex}]`,
        isChosen,
      });
    });
  });

  const predictionUses = allUses.filter((entry) => entry.use.role === 'prediction');
  const chosenPredictionUses = predictionUses.filter((entry) => entry.isChosen);

  const modelCatalogItems = catalogItems.filter((item) => item.kind === 'model');
  const currentModelRevisionById = new Map(modelCatalogItems.map((item) => [item.id, item.revision]));

  // Map model id -> current-revision structural refutation outcomes with original index
  const structuralRefutationOutcomesByModel = new Map<string, Array<{ readonly index: number; readonly record: JudgmentModelOutcomeStoredRecord }>>();
  outcomes.forEach((record, index) => {
    if (record.verdict !== 'refutes') return;
    if (currentModelRevisionById.get(record.model.id) !== record.model.revision) return;
    if (isAnecdotalRefutation(record)) return;
    const list = structuralRefutationOutcomesByModel.get(record.model.id) ?? [];
    list.push({ index, record });
    structuralRefutationOutcomesByModel.set(record.model.id, list);
  });

  // -------------------------------------------------------------------------
  // 1. counterexample_scope_mismatch
  // -------------------------------------------------------------------------
  const scopeAcc = createAccumulator();
  if (hasEscalation('prediction_scope_mismatch')) {
    const refs = new Set(escalationRefsByCode.get('prediction_scope_mismatch') ?? []);
    const matchingPaths = predictionUses
      .filter((entry) => refs.has(entry.use.ref) && entry.use.check?.balance)
      .map((entry) => `${entry.path}.check.balance`);
    addFail(scopeAcc, 'escalation:prediction_scope_mismatch', matchingPaths);
  }
  for (const entry of predictionUses) {
    const check = entry.use.check;
    const balance = check?.balance;
    if (!check || check.status !== 'failed' || !balance) continue;
    if (balance.claim_scope === 'probabilistic') {
      if (balance.counter_representativeness === 'anecdotal') {
        addFail(scopeAcc, 'probabilistic_failed_by_anecdotal', [`${entry.path}.check.balance`]);
      } else if (balance.counter_representativeness === 'unknown') {
        addWarn(scopeAcc, 'probabilistic_failed_with_unknown_representativeness', [`${entry.path}.check.balance`]);
      } else if (balance.counter_representativeness === undefined) {
        const summary = outcomeSummaries.get(entry.use.ref);
        if (summary && (summary.anecdotal_refutes ?? 0) > 0 && structuralRefutationCount(summary) === 0) {
          addWarn(scopeAcc, 'probabilistic_failed_on_anecdotal_only_outcomes', [`${entry.path}.check.balance`]);
        }
      }
    }
  }
  const scopeApplicable =
    predictionUses.length > 0
    || outcomes.some((record) => record.verdict === 'refutes')
    || hasEscalation('prediction_scope_mismatch');
  const scopeResult = finalizePattern('counterexample_scope_mismatch', scopeApplicable, scopeAcc);

  // -------------------------------------------------------------------------
  // 2. base_rate_neglect
  // -------------------------------------------------------------------------
  const baseRateAcc = createAccumulator();
  if (hasEscalation('prediction_unbalanced_evidence')) {
    const refs = new Set(escalationRefsByCode.get('prediction_unbalanced_evidence') ?? []);
    const matchingPaths = predictionUses
      .filter((entry) => refs.has(entry.use.ref) && entry.use.check?.balance)
      .map((entry) => `${entry.path}.check.balance`);
    addFail(baseRateAcc, 'escalation:prediction_unbalanced_evidence', matchingPaths);
  }
  for (const entry of predictionUses) {
    const check = entry.use.check;
    const balance = check?.balance;
    if (!check || !balance) continue;
    if (!hasText(balance.population)) {
      addFail(baseRateAcc, 'balance_missing_population', [`${entry.path}.check.balance.population`]);
    }
    if (!hasText(balance.counter_summary)) {
      addFail(baseRateAcc, 'balance_missing_counter_summary', [`${entry.path}.check.balance.counter_summary`]);
    }
    if (!hasText(balance.supporting_summary)) {
      if (check.status === 'failed' && balance.claim_scope === 'universal') {
        addWarn(baseRateAcc, 'balance_missing_supporting_summary', [`${entry.path}.check.balance.supporting_summary`]);
      } else {
        addFail(baseRateAcc, 'balance_missing_supporting_summary', [`${entry.path}.check.balance.supporting_summary`]);
      }
    }
  }

  const partialRetrievalPaths: string[] = [];
  retrieval.forEach((sample, index) => {
    if (isPartialRetrievalSample(sample)) {
      partialRetrievalPaths.push(`retrieval[${index}]`);
    }
  });
  if (partialRetrievalPaths.length > 0) {
    const anyPredictionHasPopulation = predictionUses.some((entry) => hasBalancePopulated(entry.use.check?.balance));
    const chosenMissingPopulation = chosenPredictionUses.filter((entry) => !hasBalancePopulated(entry.use.check?.balance));
    if (!anyPredictionHasPopulation || chosenMissingPopulation.length > 0) {
      addFail(baseRateAcc, 'partial_retrieval_missing_population', [
        ...partialRetrievalPaths,
        ...chosenMissingPopulation.map((entry) => entry.use.check ? `${entry.path}.check` : entry.path),
      ]);
    }
  } else {
    // When retrieval is not partial (or omitted), warn if a checked prediction on the chosen option omits balance entirely.
    for (const entry of chosenPredictionUses) {
      const check = entry.use.check;
      if (check && (check.status === 'held' || check.status === 'failed') && check.balance === undefined) {
        addWarn(baseRateAcc, 'prediction_check_missing_balance', [`${entry.path}.check`]);
      }
    }
  }
  const baseRateApplicable =
    predictionUses.length > 0
    || retrieval.length > 0
    || hasEscalation('prediction_unbalanced_evidence');
  const baseRateResult = finalizePattern('base_rate_neglect', baseRateApplicable, baseRateAcc);

  // -------------------------------------------------------------------------
  // 3. layer_conflation
  // -------------------------------------------------------------------------
  const layerAcc = createAccumulator();
  for (const issue of validation.issues) {
    if (issue.code === 'frame_role_mismatch') {
      addFail(layerAcc, 'role_kind_conflation', [issue.path]);
    } else if (issue.code === 'frame_verdict_missing') {
      addFail(layerAcc, 'constraint_verdict_conflation', [issue.path]);
    }
  }
  for (const entry of allUses) {
    const catalogItem = catalogById.get(entry.use.ref);
    if (catalogItem && entry.use.role !== JUDGMENT_FRAME_ROLE_BY_KIND[catalogItem.kind]) {
      addFail(layerAcc, 'role_kind_conflation', [`${entry.path}.role`]);
    }
    if (entry.use.role !== 'prediction' && entry.use.check !== undefined) {
      addFail(layerAcc, 'check_on_non_prediction_role', [`${entry.path}.check`]);
    }
    if (entry.use.role === 'constraint') {
      if (!VALID_CONSTRAINT_VERDICTS.has(String(entry.use.verdict ?? ''))) {
        addFail(layerAcc, 'constraint_verdict_conflation', [`${entry.path}.verdict`]);
      }
    } else if (entry.use.verdict !== undefined) {
      addFail(layerAcc, 'constraint_verdict_conflation', [`${entry.path}.verdict`]);
    }
    if (entry.use.role === 'prediction' && entry.use.check !== undefined && !hasText(entry.use.check.falsified_if)) {
      addFail(layerAcc, 'prediction_check_missing_falsified_if', [`${entry.path}.check.falsified_if`]);
    }
    if (entry.isChosen && entry.use.role === 'prediction' && catalogItem?.kind === 'model') {
      const checkStatus = entry.use.check?.status ?? 'unchecked';
      if (checkStatus === 'unchecked') {
        const evidencePath = entry.use.check ? `${entry.path}.check` : entry.path;
        if (catalogItem.status !== 'verified') {
          addFail(layerAcc, 'chosen_unverified_model_unchecked', [evidencePath]);
        } else {
          addWarn(layerAcc, 'chosen_verified_model_unchecked', [evidencePath]);
        }
      }
    }
  }
  const layerApplicable = allUses.length > 0 || validation.issues.length > 0;
  const layerResult = finalizePattern('layer_conflation', layerApplicable, layerAcc);

  // -------------------------------------------------------------------------
  // 4. conclusion_lock_cherry_picking
  // -------------------------------------------------------------------------
  const lockAcc = createAccumulator();
  if (options.length <= 1) {
    addFail(lockAcc, 'single_option_no_alternative', ['options']);
  }

  const usedModelIds = new Set(
    predictionUses
      .map((entry) => entry.use.ref)
      .filter((ref) => catalogById.get(ref)?.kind === 'model'),
  );

  // Only check competing / structurally-refuted catalog models when the frame
  // actually uses at least one model; a philosophy/objective-only frame must
  // not treat unrelated catalog models as unaddressed competitors.
  const competingOrRefutedCatalogPaths: string[] = [];
  if (usedModelIds.size > 0) {
    const usedModelScopes = new Set(
      [...usedModelIds].map((id) => normalizedScopeKey(catalogById.get(id)?.applies_when)),
    );
    for (const modelItem of modelCatalogItems) {
      const idx = catalogIndexById.get(modelItem.id);
      const itemPath = idx === undefined ? `catalog.items` : `catalog.items[${idx}]`;
      const isOtherSameScope =
        !usedModelIds.has(modelItem.id)
        && usedModelScopes.has(normalizedScopeKey(modelItem.applies_when));
      const summary = outcomeSummaries.get(modelItem.id);
      const isRefuted = structuralRefutationCount(summary) > 0;
      if (isOtherSameScope || isRefuted) {
        competingOrRefutedCatalogPaths.push(itemPath);
      }
    }
  }

  if (competingOrRefutedCatalogPaths.length > 0) {
    const anyCompeting = predictionUses.some((entry) => hasCompetingHypotheses(entry.use.check?.balance));
    const anyCounter = predictionUses.some((entry) => hasCounterSummary(entry.use.check?.balance));
    if (!anyCompeting && !anyCounter) {
      const targetUsePaths = chosenPredictionUses.length > 0
        ? chosenPredictionUses.map((entry) => entry.use.check?.balance ? `${entry.path}.check.balance` : entry.path)
        : predictionUses.map((entry) => entry.use.check?.balance ? `${entry.path}.check.balance` : entry.path);
      addFail(lockAcc, 'unaddressed_competing_or_refuted_models', [
        ...competingOrRefutedCatalogPaths,
        ...targetUsePaths,
      ]);
    }
  }

  nodeResults.forEach((result, index) => {
    if (!isVerifyNodeId(result.node_id)) return;
    const evidenceIds = Array.isArray(result.evidence_tool_use_ids)
      ? result.evidence_tool_use_ids.filter((id) => hasText(id))
      : [];
    if (evidenceIds.length === 0) {
      const path = `nodeResults[${index}].evidence_tool_use_ids`;
      if (result.status === 'supported') {
        addFail(lockAcc, 'verify_node_without_evidence', [path]);
      } else {
        addWarn(lockAcc, 'verify_node_insufficient_without_evidence', [path]);
      }
    }
  });
  const lockResult = finalizePattern('conclusion_lock_cherry_picking', true, lockAcc);

  // -------------------------------------------------------------------------
  // 5. local_patch_without_model_update
  // -------------------------------------------------------------------------
  const patchAcc = createAccumulator();
  if (hasEscalation('chosen_uses_refuted_model')) {
    const refs = new Set(escalationRefsByCode.get('chosen_uses_refuted_model') ?? []);
    const paths = chosenPredictionUses
      .filter((entry) => refs.has(entry.use.ref))
      .map((entry) => entry.path);
    addFail(patchAcc, 'escalation:chosen_uses_refuted_model', paths);
  }
  if (hasEscalation('chosen_relies_on_failed_prediction')) {
    const refs = new Set(escalationRefsByCode.get('chosen_relies_on_failed_prediction') ?? []);
    const paths = chosenPredictionUses
      .filter((entry) => refs.has(entry.use.ref) && entry.use.check?.status === 'failed')
      .map((entry) => `${entry.path}.check`);
    addFail(patchAcc, 'escalation:chosen_relies_on_failed_prediction', paths);
  }

  const worldModelCandidatesByModelId = new Map<string, Array<{ readonly index: number; readonly candidate: JudgmentReasoningLearningCandidate }>>();
  learningCandidates.forEach((candidate, index) => {
    if (candidate.target?.kind !== 'world_model') return;
    const list = worldModelCandidatesByModelId.get(candidate.target.id) ?? [];
    list.push({ index, candidate });
    worldModelCandidatesByModelId.set(candidate.target.id, list);
  });

  for (const modelId of usedModelIds) {
    const structuralCount = structuralRefutationCount(outcomeSummaries.get(modelId));
    if (structuralCount < 2) continue;
    const matchingCandidates = worldModelCandidatesByModelId.get(modelId) ?? [];
    if (matchingCandidates.length === 0) {
      const outcomePaths = (structuralRefutationOutcomesByModel.get(modelId) ?? [])
        .map((entry) => `outcomes[${entry.index}]`);
      const usePaths = predictionUses
        .filter((entry) => entry.use.ref === modelId)
        .map((entry) => entry.path);
      addFail(patchAcc, 'accumulated_structural_refutations_without_learning_candidate', [
        ...outcomePaths,
        ...usePaths,
      ]);
    }
  }

  learningCandidates.forEach((candidate, index) => {
    if (candidate.target?.kind !== 'world_model') return;
    const targetId = candidate.target.id;
    const structuralOutcomes = structuralRefutationOutcomesByModel.get(targetId) ?? [];
    const structuralCount = structuralRefutationCount(outcomeSummaries.get(targetId));
    const hasExplicitField = candidate.addressedRefutationIds !== undefined;
    const addressedIds = Array.isArray(candidate.addressedRefutationIds)
      ? candidate.addressedRefutationIds.filter((id) => hasText(id))
      : [];

    if ((hasExplicitField && addressedIds.length === 0) || (structuralCount > 0 && addressedIds.length === 0)) {
      const path = hasExplicitField
        ? `learningCandidates[${index}].addressedRefutationIds`
        : `learningCandidates[${index}]`;
      addFail(patchAcc, 'learning_candidate_empty_addressed_refutation_ids', [path]);
      return;
    }

    if (structuralOutcomes.length > 0 && addressedIds.length > 0) {
      const addressedSet = new Set(addressedIds);
      const missingOutcomePaths = structuralOutcomes
        .filter((entry) => !addressedSet.has(entry.record.id))
        .map((entry) => `outcomes[${entry.index}]`);
      if (missingOutcomePaths.length > 0) {
        addWarn(patchAcc, 'learning_candidate_partial_refutation_coverage', [
          `learningCandidates[${index}].addressedRefutationIds`,
          ...missingOutcomePaths,
        ]);
      }
    }
  });

  const patchApplicable =
    usedModelIds.size > 0
    || outcomes.length > 0
    || learningCandidates.length > 0
    || hasEscalation('chosen_uses_refuted_model')
    || hasEscalation('chosen_relies_on_failed_prediction');
  const patchResult = finalizePattern('local_patch_without_model_update', patchApplicable, patchAcc);

  // -------------------------------------------------------------------------
  // Aggregate overall status and score
  // -------------------------------------------------------------------------
  const patterns: Record<JudgmentReasoningDistortionPattern, JudgmentReasoningPatternResult> = {
    counterexample_scope_mismatch: scopeResult,
    base_rate_neglect: baseRateResult,
    layer_conflation: layerResult,
    conclusion_lock_cherry_picking: lockResult,
    local_patch_without_model_update: patchResult,
  };

  const results = JUDGMENT_REASONING_DISTORTION_PATTERNS.map((pattern) => patterns[pattern]);
  const overall_status: JudgmentReasoningOverallStatus = results.some((r) => r.status === 'fail')
    ? 'fail'
    : results.some((r) => r.status === 'warn')
      ? 'warn'
      : 'pass';

  const applicableResults = results.filter((r) => r.status !== 'not_applicable');
  const rawScore = applicableResults.length === 0
    ? 1
    : applicableResults.reduce((sum, r) => sum + r.score, 0) / applicableResults.length;
  const overall_score = Math.round(rawScore * 10_000) / 10_000;

  return deepFreeze({
    schema_version: JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION,
    overall_status,
    overall_score,
    patterns,
  });
}

/**
 * Convert a `JudgmentReasoningAuditResult` into `JudgmentDAGOutcomeObservation[]`
 * consumable directly by `createJudgmentDAGOutcomeAttachment` and
 * `evaluateJudgmentDAGVersions` in `src/judgment-dag-replay-evaluation.ts`.
 *
 * Emits 5 per-pattern numeric scores (`distortion.<pattern>`, range 0..1) and
 * 1 overall boolean pass indicator (`distortion.overall_pass`) at run scope.
 * When `options.nodeId` or `options.patternNodeIds` is provided, matching
 * node-scoped observations are appended to enable `node_calibration`.
 */
export function toJudgmentDAGDistortionObservations(
  audit: JudgmentReasoningAuditResult,
  options: JudgmentDAGDistortionObservationOptions = {},
): readonly JudgmentDAGOutcomeObservation[] {
  const observations: JudgmentDAGOutcomeObservation[] = [];

  for (const pattern of JUDGMENT_REASONING_DISTORTION_PATTERNS) {
    const score = audit.patterns[pattern].score;
    const metricId = `distortion.${pattern}`;
    observations.push({
      metric_id: metricId,
      scope: 'run',
      value: score,
    });
    const patternNodeId = options.patternNodeIds?.[pattern] ?? options.nodeId;
    if (hasText(patternNodeId)) {
      observations.push({
        metric_id: metricId,
        scope: 'node',
        node_id: patternNodeId.trim(),
        value: score,
      });
    }
  }

  const overallPass = audit.overall_status === 'pass';
  observations.push({
    metric_id: 'distortion.overall_pass',
    scope: 'run',
    value: overallPass,
  });
  if (hasText(options.nodeId)) {
    observations.push({
      metric_id: 'distortion.overall_pass',
      scope: 'node',
      node_id: options.nodeId.trim(),
      value: overallPass,
    });
  }

  return deepFreeze(observations);
}
