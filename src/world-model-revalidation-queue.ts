/**
 * RFC-003: World Model Revalidation & Outcome-Binding Loop (PR-1)
 *
 * Pure, deterministic triage and prioritization engine for unverified world
 * models. Read-only: never mutates inputs, files, or external stores.
 */

import type { WorldModelImpactAnalysis } from './world-model-impact-index.js';

export const WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION = 'world_model_revalidation_queue.v1' as const;
export const DEFAULT_REVALIDATION_QUEUE_TOP_K = 15 as const;
export const MAX_DOWNSTREAM_IMPACT_BONUS = 6 as const;

export type WorldModelStatus = 'active' | 'adopted_unverified' | 'draft' | 'retired';
export type RevalidationTier = 'T1_AUTO_TELEMETRY' | 'T2_REVIEW_PROMISE_CASE' | 'T3_LAZY_ON_CITATION';
export type TelemetrySource =
  | 'github_pr_evals'
  | 'orca_needs_you_and_stalls'
  | 'brainbase_judgment_journal'
  | 'brainbase_meeting_decisions'
  | 'finance_margin_ledger'
  | 'sales_crm_pipeline'
  | 'none_qualitative_only';

export interface CatalogModelRecord {
  id: string;
  status: WorldModelStatus | string;
  prefix: string;
  text: string;
  hasApply: boolean;
  hasExclude: boolean;
  hasNumber: boolean;
  hasCausal: boolean;
  outcomeCount?: number;
  citationCount30d?: number;
  downstreamImpactCount?: number;
}

export interface ScoredWorldModelBreakdown {
  observability: number; // 0..35
  leverage: number; // 0..30
  falsifiability: number; // 0..20
  freshnessOrDraftUrgency: number; // 0..15
}

export interface ScoredWorldModel {
  id: string;
  status: string;
  tier: RevalidationTier;
  lazyPromoted?: boolean;
  telemetrySources: TelemetrySource[];
  priorityScore: number; // 0..100
  breakdown: ScoredWorldModelBreakdown;
  proposedMetric: string;
  falsifiedIfDraft: string;
  summary: string;
}

export interface WorldModelRevalidationQueue {
  schemaVersion: typeof WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION;
  totalModels: number;
  verifiedWithOutcomes: number;
  tierCounts: Record<RevalidationTier, number>;
  topQueue: ScoredWorldModel[];
  allScored: ScoredWorldModel[];
}

export interface BuildRevalidationQueueOptions {
  topK?: number;
  /**
   * Optional lookup of model ID -> downstream impact count (compatible with
   * `WorldModelImpactAnalysis.affectedItems.length` from `world-model-impact-index.ts`).
   * Applied when a `CatalogModelRecord` omits `downstreamImpactCount`.
   */
  downstreamImpactCounts?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
}

interface TelemetryRule {
  readonly source: TelemetrySource;
  readonly pattern: RegExp;
  readonly metric: string;
  readonly falsifiedIf: string;
}

const TELEMETRY_RULES: readonly TelemetryRule[] = [
  {
    source: 'orca_needs_you_and_stalls',
    pattern: /認知負荷|認知コスト|承認待ち|代理判断|放置可能|ガード|自律|タスク一覧|ボトルネック|並列/u,
    metric: 'Needs you 件数/h・再質問率・In progress 滞留時間・委任×差戻しペア率',
    falsifiedIf: '導入前後 2 週間で Needs you 率または差戻し率が改善せず、逆行（>= +15%）が観測された場合',
  },
  {
    source: 'brainbase_judgment_journal',
    pattern: /正本|SSOT|表記と判断|判断品質|学習ループ|反証|証跡|単発ツール|職責|二重管理|表示内容/u,
    metric: '判断ジャーナル監査通過率・E2E-G4 引用率・矛盾/巻き戻し発生率・PoLL 7 項目 FAIL 率',
    falsifiedIf: '実戦 2 週間カナリアで正本参照あり群の FAIL 率・巻き戻し率がベースラインを下回らない場合',
  },
  {
    source: 'github_pr_evals',
    pattern: /開発時間|再利用|高速|実行速度|複雑|多機能|文脈の受け渡し|並列AI開発|Decision.*Work.*Ship/u,
    metric: 'Unson-LLC 7d PR マージ中央値・自動マージ率・再レビュー往復回数・コード再利用比率',
    falsifiedIf: '4 週間窓で対象介入後の PR マージ中央値悪化（+20% 超）または自動マージ率低下が続く場合',
  },
  {
    source: 'finance_margin_ledger',
    pattern: /粗利率|買収|限界費用|SaaS|受託利益|単価|売上化|ROI|キャッシュ/u,
    metric: '案件別粗利率・モジュール再利用工数比・限界費用推移（月次財務正本）',
    falsifiedIf: '四半期 2 期連続で再利用あり案件の粗利率が非再利用案件を上回らない場合',
  },
  {
    source: 'brainbase_meeting_decisions',
    pattern: /RACI|立ち位置|決裁|非同期文書|属人化|創業者不在|会議/u,
    metric: '創業者非関与での決定完了率・決裁リードタイム・見直しの約束達成率',
    falsifiedIf: 'RACI 明示案件でも創業者エスカレーション比率が 70% 超のまま改善しない場合',
  },
  {
    source: 'sales_crm_pipeline',
    pattern: /営業|商談|顧客|信頼|口コミ|レビュー|面談|高額商材|LP|CVR|紹介|既存顧客|SLA|フィードバック/u,
    metric: '商談化率・受注率・顧客 NPS/継続率・CRM 案件別 ReviewPromise 結果',
    falsifiedIf: '対象セグメント 10 案件以上で適用群の成約/継続率が対照群を下回る場合',
  },
];

const AUTO_TELEMETRY_SOURCES: ReadonlySet<TelemetrySource> = new Set([
  'github_pr_evals',
  'orca_needs_you_and_stalls',
  'brainbase_judgment_journal',
  'brainbase_meeting_decisions',
]);

function sanitizeNonNegativeCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function clampPriorityScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function lookupDownstreamImpactCount(
  modelId: string,
  counts: ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined,
): number | undefined {
  if (!counts) return undefined;
  if (counts instanceof Map) return counts.get(modelId);
  const record = counts as Readonly<Record<string, number>>;
  return Object.prototype.hasOwnProperty.call(record, modelId) ? record[modelId] : undefined;
}

/**
 * Extracts a `downstreamImpactCount` scalar from a `world-model-impact-index`
 * reverse-dependency analysis result.
 */
export function downstreamImpactCountFromAnalysis(
  analysis: Pick<WorldModelImpactAnalysis, 'affectedItems'>,
): number {
  return analysis.affectedItems.length;
}

/**
 * Deterministically maps a world-model text to existing primary telemetry
 * sources, a proposed metric, and a falsification draft.
 */
export function detectTelemetrySources(text: string): {
  sources: TelemetrySource[];
  metric: string;
  falsifiedIf: string;
} {
  const matched = TELEMETRY_RULES.filter((rule) => rule.pattern.test(text));
  if (matched.length === 0) {
    return {
      sources: ['none_qualitative_only'],
      metric: '未接続（引用時に個別 ReviewPromise へ指標を紐付け）',
      falsifiedIf: '明示引用された意思決定で予測方向と逆の実測結果が 2 件以上蓄積した場合',
    };
  }
  return {
    sources: matched.map((rule) => rule.source),
    metric: matched[0]!.metric,
    falsifiedIf: matched[0]!.falsifiedIf,
  };
}

/**
 * Deterministically classifies a world model into T1/T2/T3 (including Lazy
 * Promotion from T3 to T2 when `citationCount30d >= 1`) and computes its
 * bounded 0..100 revalidation priority score.
 */
export function classifyAndScoreModel(model: CatalogModelRecord): ScoredWorldModel {
  const { sources, metric, falsifiedIf } = detectTelemetrySources(model.text);
  const hasAutoTelemetry = sources.some((source) => AUTO_TELEMETRY_SOURCES.has(source));
  const hasCaseTelemetry = sources.includes('finance_margin_ledger') || sources.includes('sales_crm_pipeline');
  const citationCount30d = sanitizeNonNegativeCount(model.citationCount30d);

  let tier: RevalidationTier;
  let lazyPromoted = false;
  if (hasAutoTelemetry) {
    tier = 'T1_AUTO_TELEMETRY';
  } else if (hasCaseTelemetry && (model.hasExclude || model.hasNumber || model.prefix === 'fnd_unson_model')) {
    tier = 'T2_REVIEW_PROMISE_CASE';
  } else if (citationCount30d >= 1) {
    tier = 'T2_REVIEW_PROMISE_CASE';
    lazyPromoted = true;
  } else {
    tier = 'T3_LAZY_ON_CITATION';
  }

  // 1. Observability (0..35)
  let observability = 5;
  if (hasAutoTelemetry) observability = 30 + Math.min(5, (sources.length - 1) * 5);
  else if (hasCaseTelemetry) observability = 18;

  // 2. Strategic / operational leverage (0..30)
  let leverage = 10;
  if (model.prefix === 'fnd_unson_model') leverage = 28;
  else if (model.prefix === 'fnd_model_phi') leverage = 26;
  else if (model.hasCausal && model.hasExclude) leverage = 20;
  else if (model.hasCausal) leverage = 15;
  const downstreamImpactCount = sanitizeNonNegativeCount(model.downstreamImpactCount);
  if (downstreamImpactCount > 0) {
    leverage = Math.min(30, leverage + Math.min(MAX_DOWNSTREAM_IMPACT_BONUS, downstreamImpactCount * 2));
  }

  // 3. Falsifiability readiness (0..20)
  let falsifiability = 4;
  if (model.hasCausal) falsifiability += 6;
  if (model.hasApply) falsifiability += 3;
  if (model.hasExclude) falsifiability += 4;
  if (model.hasNumber) falsifiability += 3;
  falsifiability = Math.min(20, falsifiability);

  // 4. Unverified / draft urgency (0..15)
  let freshnessOrDraftUrgency = 0;
  const outcomes = sanitizeNonNegativeCount(model.outcomeCount);
  if (outcomes === 0) freshnessOrDraftUrgency += 8;
  if (model.status === 'draft' && (model.prefix === 'fnd_model_phi' || model.prefix === 'fnd_unson_model')) {
    freshnessOrDraftUrgency += 7;
  } else if (model.status === 'adopted_unverified') {
    freshnessOrDraftUrgency += 4;
  }

  const priorityScore = clampPriorityScore(
    observability + leverage + falsifiability + freshnessOrDraftUrgency,
  );

  return {
    id: model.id,
    status: model.status,
    tier,
    ...(lazyPromoted ? { lazyPromoted: true } : {}),
    telemetrySources: sources,
    priorityScore,
    breakdown: {
      observability,
      leverage,
      falsifiability,
      freshnessOrDraftUrgency,
    },
    proposedMetric: metric,
    falsifiedIfDraft: falsifiedIf,
    summary: model.text.slice(0, 120),
  };
}

/**
 * Builds a deterministic `world_model_revalidation_queue.v1` payload sorted by
 * descending `priorityScore`, breaking ties lexicographically by `id`.
 */
export function buildRevalidationQueue(
  models: readonly CatalogModelRecord[],
  options: BuildRevalidationQueueOptions = {},
): WorldModelRevalidationQueue {
  const topK = options.topK ?? DEFAULT_REVALIDATION_QUEUE_TOP_K;
  if (!Number.isInteger(topK) || topK < 0) {
    throw new RangeError('topK must be a non-negative integer');
  }

  const scored = models
    .map((model) => {
      if (model.downstreamImpactCount !== undefined) {
        return classifyAndScoreModel(model);
      }
      const mappedImpact = lookupDownstreamImpactCount(model.id, options.downstreamImpactCounts);
      return mappedImpact === undefined
        ? classifyAndScoreModel(model)
        : classifyAndScoreModel({ ...model, downstreamImpactCount: mappedImpact });
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));

  const tierCounts: Record<RevalidationTier, number> = {
    T1_AUTO_TELEMETRY: 0,
    T2_REVIEW_PROMISE_CASE: 0,
    T3_LAZY_ON_CITATION: 0,
  };
  for (const entry of scored) {
    tierCounts[entry.tier] += 1;
  }

  return {
    schemaVersion: WORLD_MODEL_REVALIDATION_QUEUE_SCHEMA_VERSION,
    totalModels: scored.length,
    verifiedWithOutcomes: models.filter((model) => sanitizeNonNegativeCount(model.outcomeCount) > 0).length,
    tierCounts,
    topQueue: scored.slice(0, topK),
    allScored: scored,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalNonNegativeNumber(value: unknown, field: string, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid catalog model at index ${index}: ${field} must be a non-negative number`);
  }
  return value;
}

/**
 * Parses and validates a world-model catalog JSON payload (`{ models: [...] }`
 * or a top-level array of `CatalogModelRecord`). Fails loudly on malformed input.
 */
export function parseCatalogModelsPayload(payload: unknown): CatalogModelRecord[] {
  const rawModels = Array.isArray(payload)
    ? payload
    : isPlainRecord(payload) && Array.isArray(payload.models)
      ? payload.models
      : null;
  if (!rawModels) {
    throw new Error('Catalog JSON must be an object with a "models" array or an array of model records');
  }

  return rawModels.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new Error(`Invalid catalog model at index ${index}: expected an object`);
    }
    if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
      throw new Error(`Invalid catalog model at index ${index}: id must be a non-empty string`);
    }
    if (typeof entry.status !== 'string' || entry.status.trim().length === 0) {
      throw new Error(`Invalid catalog model at index ${index}: status must be a non-empty string`);
    }
    if (typeof entry.prefix !== 'string') {
      throw new Error(`Invalid catalog model at index ${index}: prefix must be a string`);
    }
    if (typeof entry.text !== 'string') {
      throw new Error(`Invalid catalog model at index ${index}: text must be a string`);
    }
    if (
      typeof entry.hasApply !== 'boolean'
      || typeof entry.hasExclude !== 'boolean'
      || typeof entry.hasNumber !== 'boolean'
      || typeof entry.hasCausal !== 'boolean'
    ) {
      throw new Error(
        `Invalid catalog model at index ${index}: hasApply, hasExclude, hasNumber, and hasCausal must be booleans`,
      );
    }

    const outcomeCount = assertOptionalNonNegativeNumber(entry.outcomeCount, 'outcomeCount', index);
    const citationCount30d = assertOptionalNonNegativeNumber(entry.citationCount30d, 'citationCount30d', index);
    const downstreamImpactCount = assertOptionalNonNegativeNumber(
      entry.downstreamImpactCount,
      'downstreamImpactCount',
      index,
    );

    return {
      id: entry.id,
      status: entry.status,
      prefix: entry.prefix,
      text: entry.text,
      hasApply: entry.hasApply,
      hasExclude: entry.hasExclude,
      hasNumber: entry.hasNumber,
      hasCausal: entry.hasCausal,
      ...(outcomeCount !== undefined ? { outcomeCount } : {}),
      ...(citationCount30d !== undefined ? { citationCount30d } : {}),
      ...(downstreamImpactCount !== undefined ? { downstreamImpactCount } : {}),
    };
  });
}

/**
 * Formats a `WorldModelRevalidationQueue` as a deterministic, human-readable
 * report for the read-only CLI.
 */
export function renderRevalidationQueueText(queue: WorldModelRevalidationQueue): string {
  const lines: string[] = [
    `World Model Revalidation Queue (${queue.schemaVersion})`,
    `Total models: ${queue.totalModels} | Verified with outcomes: ${queue.verifiedWithOutcomes}`,
    `Tiers: T1=${queue.tierCounts.T1_AUTO_TELEMETRY}, T2=${queue.tierCounts.T2_REVIEW_PROMISE_CASE}, T3=${queue.tierCounts.T3_LAZY_ON_CITATION}`,
    '',
  ];

  if (queue.topQueue.length === 0) {
    lines.push('Top queue: (empty)');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Top ${queue.topQueue.length}:`);
  queue.topQueue.forEach((item, index) => {
    const promotedTag = item.lazyPromoted ? ' [lazy-promoted]' : '';
    const sources = item.telemetrySources.join(', ');
    lines.push(
      `${String(index + 1).padStart(2, ' ')}. [${item.priorityScore}] ${item.tier}${promotedTag} | ${item.id} (${item.status})`,
    );
    lines.push(`    telemetry: ${sources}`);
    lines.push(`    summary: ${item.summary}`);
  });

  return `${lines.join('\n')}\n`;
}
