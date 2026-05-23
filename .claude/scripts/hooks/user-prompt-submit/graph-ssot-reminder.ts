#!/usr/bin/env npx tsx

// 2026-05-21: 常時注入だと「wallpaper化」して agent に無視されるため、
// プロンプトが人物名/顧客名/関係性キーワードを含む時だけ強リマインドを返す。
// 検出しない時は空文字を返し、agent context を汚さない。

import { logHookExecution } from "../../lib/logging/hook-logger.js";

// 漢字2-4字 + 任意の半角/全角空白 + 0-3 字漢字 + 敬称 (姓だけ/姓名 両対応)
const PERSON_KANJI_SUFFIX_RE =
  /[\p{Script=Han}々ー]{2,4}[\s\u3000]?[\p{Script=Han}々ー]{0,3}(さん|氏|くん|ちゃん|社長|部長|専務|常務|取締役|GM|CFO|CTO|COO|CEO)/u;

// カタカナ姓 + 敬称
const PERSON_KATAKANA_SUFFIX_RE =
  /[\u30A1-\u30FA]{2,8}(さん|氏|くん|ちゃん|社長)/u;

// 顧客/組織名 (Brainbase 内部 project 名 brainbase/mana/aitle/oyasumi 等は除く — それらは capmap-reminder の管轄)
const ORG_NAMES = [
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
const ORG_RE = new RegExp(`\\b(${ORG_NAMES.join("|")})\\b`);

// 関係性 / 意思決定 / 議事録キーワード
const RELATION_KEYWORDS_RE =
  /決裁|案件|顧客|担当者|契約|先方|クライアント|意思決定|RACI|決定者|連絡先|議事録|MTG準備|キックオフ|キーマン|決裁ルート|稟議/;

function shouldEmit(prompt: string): boolean {
  if (!prompt || prompt.trim().length === 0) return false;
  return (
    PERSON_KANJI_SUFFIX_RE.test(prompt) ||
    PERSON_KATAKANA_SUFFIX_RE.test(prompt) ||
    ORG_RE.test(prompt) ||
    RELATION_KEYWORDS_RE.test(prompt)
  );
}

function buildGraphSsotReminder(): string {
  return [
    "[GRAPH_TRIGGER_DETECTED] 人物名・顧客名・関係性キーワードを検出した。返答前に Graph SSOT を引け:",
    "- 人名/組織名: mcp__brainbase__search({query}) または mcp__brainbase__get_entity({type:'person'|'org', id:'name or alias'})",
    "- 案件/decision: mcp__brainbase__list_entities({type:'decision'}) または mcp__brainbase__search_wiki({query})",
    "- 議事録由来の固有名詞は wiki page にあって entity に無い場合あり (search_wiki も併用)。",
    "- curl 直叩きは Authorization + x-brainbase-role + x-brainbase-projects + x-brainbase-clearance ヘッダ必須。",
    "- Graph hit ゼロでも『Graph に無いことを確認』と明示してから記憶/議事録ベースに移行する。推測ベース返答は規約違反。",
  ].join(" ");
}

async function main() {
  const prompt = process.env.CLAUDE_USER_PROMPT || "";
  const emit = shouldEmit(prompt);
  try {
    logHookExecution(
      "UserPromptSubmit",
      "graph-ssot-reminder",
      emit ? "trigger 検出 → 強リマインド注入" : "trigger 未検出 → スキップ",
    );
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: emit ? buildGraphSsotReminder() : "",
        suppressOutput: true,
      }),
    );
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "graph-ssot-reminder",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: "",
        suppressOutput: true,
      }),
    );
  }
}

void main();
