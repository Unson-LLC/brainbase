/**
 * RFC-001 v2.0 PR-A: Live Compact 4-Block Reasoning Gate v3.1.
 *
 * Pure prompt constants, feature-flag resolution, and clarification guards for
 * `UserPromptSubmit` `additionalContext` injection in `src/judgment-host.ts`.
 * Zero extra LLM calls; defaults to `'off'` for full backward compatibility.
 */

export const REASONING_GATE_MODES = [
  'off',
  'compact_4block_v3',
  'compact_4block_with_wm',
] as const;

export type ReasoningGateMode = (typeof REASONING_GATE_MODES)[number];

/** Accepted legacy env/option alias mapped transparently to `compact_4block_v3`. */
const LEGACY_MODE_ALIASES: Readonly<Record<string, ReasoningGateMode>> = Object.freeze({
  compact_4block_v2: 'compact_4block_v3',
});

export interface ReasoningGateHostConfig {
  readonly reasoningGateMode?: ReasoningGateMode | 'compact_4block_v2';
  readonly reasoningGateCanaryProjects?: readonly string[];
}

/**
 * Mirrors `resolveAutonomyMode()` in `src/judgment-host.ts`.
 * Throws `Error('judgment_reasoning_gate_mode_invalid')` on unknown mode strings.
 */
export function resolveReasoningGateMode(
  options: ReasoningGateHostConfig,
  env: Readonly<Record<string, string | undefined>>,
  projectCode?: string,
): ReasoningGateMode {
  const raw = options.reasoningGateMode ?? env.BRAINBASE_JUDGMENT_REASONING_GATE_MODE?.trim() ?? 'off';
  const normalized = Object.hasOwn(LEGACY_MODE_ALIASES, raw)
    ? LEGACY_MODE_ALIASES[raw]
    : raw;
  if (!(REASONING_GATE_MODES as readonly string[]).includes(normalized)) {
    throw new Error('judgment_reasoning_gate_mode_invalid');
  }
  const mode = normalized as ReasoningGateMode;
  if (mode === 'off') return 'off';

  const canary = options.reasoningGateCanaryProjects
    ? options.reasoningGateCanaryProjects.map((s) => s.trim()).filter(Boolean)
    : (env.BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS
      ? env.BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined);

  const normalizedProjectCode = projectCode?.trim();
  if (canary && canary.length > 0 && (!normalizedProjectCode || !canary.includes(normalizedProjectCode))) {
    return 'off';
  }
  return mode;
}

/**
 * Guard matching `successOutput()` in `src/judgment-host.ts`: never inject the
 * 4-block gate when the receipt requires a clarification-only turn
 * (`clarification.v1` or `status === 'needs_clarification'`).
 */
export function shouldApplyReasoningGate(receipt: {
  readonly status?: string;
  readonly selected_dag_ids?: readonly string[];
}): boolean {
  if (receipt.status === 'needs_clarification') return false;
  if (receipt.selected_dag_ids?.includes('clarification.v1')) return false;
  return true;
}

/**
 * Matches `normalizedAnswerBody()` stripping prefix in `src/judgment-host.ts`.
 * Prompt and rendered pins must never start any line with these prefixes.
 */
export const AUDIT_LINE_STRIP_PREFIX = /^(?:🧠 |📚 Brainbase|⚠️ (?:Brainbase|判断))/u;

/**
 * Live Compact 4-Block Reasoning Gate prompt (v3.1).
 * Verified across Exp-03, Exp-04, Exp-05, Exp-06 (3 model families: Gemini/Claude/Codex):
 * - Routine task misfire: 0/12 (0.0%, avg 137 chars)
 * - Over-stubbornness on valid evidence: 0/12 (0.0%), epistemic calibration 1.000 (24/24)
 * - Fake `owner_line:` hallucination: 0/543 turns (0.0%)
 */
export const COMPACT_FOUR_BLOCK_GATE_PROMPT_V3 = [
  '[Brainbase Live Reasoning Gate v3.1 (compact)]',
  '※単純な文法・コマンド・SQL・翻訳・事実照会など、意思決定や対立論点・仮説検証を含まない日常依頼には本4ブロック形式を使わず、通常の簡潔な回答（1〜6行程度）のみ返すこと。',
  '',
  '判断・仮説検証・対立論点・方針決定へ答える際のみ、Host から別途指定された先頭監査行（存在する場合）の直後に次の 4 ブロック順で簡潔に（全体 650〜900 字以内、各ブロック 2〜4 行）出力すること（自分で独自の監査行や `owner_line:` 等の文字列を捏造しないこと）：',
  '1. 【主張の幹（Steelman）】相手の意図や仮説を評価する前に、仮に真と置いた因果の幹を1〜2文で忠実に要約する。',
  '2. 【母数・代表性と支持/反証】母集団・サンプル規模・代表性（census / representative / anecdotal / unknown）およびストックとフロー等の母数単位を明示し、支持と反証を両面で簡潔に並べる。単発反例で傾向を全否定せず、小サンプルや未観測で全体断定もしない。',
  '3. 【層の分離（事実 / 因果 / 規範）】①確認済み事実（データ・合意済み前提）、②経験的因果仮説（反証条件 falsified_if は「自説/検討対象仮説が間違いだったと分かる観測条件」を書くこと。相手案の欠点や論理的誤謬への反論を falsified_if に混ぜない）、③価値・規範・介入選択・論理制約を分けて書く。規範レッテルで因果分析を打ち切らない。',
  '4. 【未検証点と次の一手】未確認の数値・競合案・モデル改訂要否（構造的反証蓄積時の LearningCandidate 等）を明示し、誤前提・段階的アンカリング・単一案固定には迎合せず訂正する。',
  '',
  '[内部整合ルール（厳守）]',
  '- B2/B4 で「未検証」「unknown」「anecdotal」と置いた主張を、冒頭・見出し・結論行・提出用ドラフトで「確実」「堅い」「見込める」と断定しないこと（注記つきの断定も禁止）。',
  '- 前ターンで合意・確定した事実や因果エッジは巻き戻さず、確定済みと未検証の差分だけ前に進めること。',
  '- 会話途中で自ら指摘・確認した新制約（例：観測ラグ・リードタイム・更新周期・母数差）は、必ず B4 の検証期間・次の一手へ反映し、古い短期間テスト設計のまま据え置かないこと。',
].join('\n');

/** @deprecated Use COMPACT_FOUR_BLOCK_GATE_PROMPT_V3 (v3.1). */
export const COMPACT_FOUR_BLOCK_GATE_PROMPT_V2 = COMPACT_FOUR_BLOCK_GATE_PROMPT_V3;
