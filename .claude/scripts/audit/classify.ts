/**
 * Prompt topic classification for the Graph SSOT / Capability Map / Personal KG
 * daily utilization audit.
 *
 * 役割:
 *   - 各 session の冒頭 prompt を見て、graph/capmap/kg のいずれの「候補」かを
 *     deterministic に判定する。
 *   - 監査の精度を歪める false positive (VibePro reviewer subagent / 監査タスク
 *     自身) を excluded として早期 return する。
 *
 * 関連:
 *   - .claude/scripts/hooks/user-prompt-submit/graph-ssot-reminder.ts
 *   - .claude/scripts/hooks/user-prompt-submit/capability-map-reminder.ts
 *
 * 注: テストフィクスチャを増やす時は .claude/scripts/test/test-classify.ts に
 *     1行追加し、それを通すように本ファイルの regex を最小修正する。
 */

// ──────────────────────────────────────────────────────────────────────────────
// Exclusion patterns (false positive — 監査の母集団から外す)
// ──────────────────────────────────────────────────────────────────────────────

// VibePro reviewer subagent. 「VibePro review task.」「VibePro final ...」
// 「You are performing (the final)? VibePro ... parallel review」「You are reviewing STR-...」など。
const EXCLUDE_VIBEPRO_REVIEWER_RE =
  /^(VibePro review task\.|VibePro final|You are performing (?:the final )?VibePro|You are reviewing\s+STR-)/i;

// 監査タスク自身。daily cron が送るプロンプトの特徴句で識別。
const EXCLUDE_AUDIT_META_RE =
  /Graph\s*SSOT\s*\/\s*Capability\s*Map\s*\/\s*個人KG/;

// 学び抽出 agent (transcript からの再発防止知見抽出)。
const EXCLUDE_LEARNING_EXTRACTOR_RE =
  /^あなたはこのトランスクリプトから「将来のセッションで再発防止・再利用に値する学び」だけを抽出する/;

// ──────────────────────────────────────────────────────────────────────────────
// Graph topic patterns (hook と一致させる)
// ──────────────────────────────────────────────────────────────────────────────

const GRAPH_PERSON_KANJI_SUFFIX_RE =
  /[\p{Script=Han}々ー]{2,4}[\s\u3000]?[\p{Script=Han}々ー]{0,3}(さん|氏|くん|ちゃん|社長|部長|専務|常務|取締役|GM|CFO|CTO|COO|CEO)/u;

const GRAPH_PERSON_KATAKANA_SUFFIX_RE =
  /[\u30A1-\u30FA]{2,8}(さん|氏|くん|ちゃん|社長)/u;

const GRAPH_ORG_NAMES = [
  "BAAO",
  "baao",
  "雲孫",
  "ユニバーサルアーツ",
  "SalesTailor",
  "salestailor",
  "TechKnight",
  "techknight",
  "tech-knight",
  "NEC",
  "GHP",
  "STAYe",
  "Cursorvers",
  "cursorvers",
  "exness",
  "freee",
  "good-times",
  "growin",
  "kakutoku",
  "Le-caldo",
  "Web-inn",
  "clarknova",
  "Unson",
  "unson",
  "Jibble",
  "jibble",
];
// Japanese-only names (e.g. ユニバーサルアーツ) は `\b` で挟むと boundary が
// 立たないので、ASCII 部分と日本語部分を分けて regex 構築する。
const GRAPH_ORG_ASCII = GRAPH_ORG_NAMES.filter((n) => /^[\x00-\x7f]+$/.test(n));
const GRAPH_ORG_NON_ASCII = GRAPH_ORG_NAMES.filter((n) => !/^[\x00-\x7f]+$/.test(n));
const GRAPH_ORG_RE = new RegExp(
  `(\\b(?:${GRAPH_ORG_ASCII.join("|")})\\b)|(${GRAPH_ORG_NON_ASCII.join("|")})`,
);

const GRAPH_RELATION_KEYWORDS_RE =
  /決裁|案件|顧客|担当者|契約|先方|クライアント|意思決定|RACI|決定者|連絡先|議事録|MTG準備|キックオフ|キーマン|決裁ルート|稟議|正本所在|営業案件|伴走型コンサル/;

// ──────────────────────────────────────────────────────────────────────────────
// Capmap topic patterns (hook と一致させる)
// ──────────────────────────────────────────────────────────────────────────────

const CAPMAP_KEYWORDS_RE =
  /session作成|sessionが|sessionの作成|auth\s?grant|auth grant|31013|xterm|terminal\b|launchd|capability|runbook|brainbase|project selector|projectが見え|プロジェクトが見え|プロジェクトが表示|セッションが作れ|表示されない|認証が|JWT|localStorage|オートマージ|オートリスタート|再起動が|プロセスが|起動しない|落ちる|ttyd|enter効か|IME|描画|Slack\s*3ワークスペース|何ができる/i;

const CAPMAP_FAILURE_WITH_CONTEXT_RE =
  /(brainbase|session|UI|画面|ttyd|xterm|terminal|port|localhost:31013)[^\n]{0,40}(動かない|見えない|壊れ|表示されない|消える|繋がらない|落ちる|起動しない|フリーズ)|(動かない|見えない|壊れ|表示されない|消える|繋がらない|落ちる|起動しない|フリーズ)[^\n]{0,40}(brainbase|session|UI|画面|ttyd|xterm|terminal|port|localhost:31013)/i;

// ──────────────────────────────────────────────────────────────────────────────
// KG topic patterns
// ──────────────────────────────────────────────────────────────────────────────

const KG_KEYWORDS_RE = /\/oyasumi|個人KG|personal[_-]?kg|oyasumi[\s_-]/i;

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface TopicResult {
  graph: boolean;
  capmap: boolean;
  kg: boolean;
  /** Non-null = excluded from audit denominator (VibePro reviewer / meta audit / etc.). */
  excluded: string | null;
}

export function classifyTopic(prompt: string): TopicResult {
  const empty: TopicResult = { graph: false, capmap: false, kg: false, excluded: null };
  if (!prompt || prompt.trim().length === 0) return empty;

  if (EXCLUDE_VIBEPRO_REVIEWER_RE.test(prompt)) {
    return { graph: false, capmap: false, kg: false, excluded: "vibepro-reviewer" };
  }
  if (EXCLUDE_AUDIT_META_RE.test(prompt)) {
    return { graph: false, capmap: false, kg: false, excluded: "audit-meta" };
  }
  if (EXCLUDE_LEARNING_EXTRACTOR_RE.test(prompt)) {
    return { graph: false, capmap: false, kg: false, excluded: "learning-extractor" };
  }

  const graph =
    GRAPH_PERSON_KANJI_SUFFIX_RE.test(prompt) ||
    GRAPH_PERSON_KATAKANA_SUFFIX_RE.test(prompt) ||
    GRAPH_ORG_RE.test(prompt) ||
    GRAPH_RELATION_KEYWORDS_RE.test(prompt);

  const capmap =
    CAPMAP_KEYWORDS_RE.test(prompt) || CAPMAP_FAILURE_WITH_CONTEXT_RE.test(prompt);

  const kg = KG_KEYWORDS_RE.test(prompt);

  return { graph, capmap, kg, excluded: null };
}
