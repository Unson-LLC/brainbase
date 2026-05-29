#!/usr/bin/env npx tsx

// SSOT self-assessment (2026-05-29)
//
// 背景: 8日間の利用監査で、複数の弱介入 (条件付き reminder 2種 + kernel の
//       Entity ID 規範 + skill description) はいずれも graph/capmap/kg の
//       自発引き率を上げなかった (graph 0.8〜10%、capmap real ほぼ 0%)。
//       唯一機能したのは「ユーザが直接 SSOT を引けと叱った」ケースのみ。
//
// 方針転換: キーワード検出ベースの reminder をやめ、agent 自身に
//       「この依頼は記憶ベースで答えてよいか、SSOT を一次情報として
//        引くべきか」を毎回メタ認知させる単一の問いだけを注入する。
//       何を引くべきかの判断は agent に委ねる (キーワードで機械判定しない)。

import { logHookExecution } from "../../lib/logging/hook-logger.js";

function buildSelfAssessment(): string {
  return [
    "[SSOT self-check] 返答を書く前に1つだけ自問せよ: この依頼は、人物・組織・顧客・案件・意思決定・Brainbase の機能や障害・個人の判断履歴のいずれかに依存しているか。",
    "Yes なら、記憶や推測で書く前に一次情報を引く: 人物/組織/顧客/案件/決定 → brainbase MCP (search / get_entity / get_context / search_wiki)。Brainbase 機能・UI・障害 → brainbase-capability-map skill から該当 capability の yml 本体まで読む。個人の判断軸・思想・実績 → personal-kg (/oyasumi 系 candidate store)。",
    "No (純粋なコード/汎用作業) なら引かなくてよい。引く必要があるのに記憶で答えるのは規約違反。引いて該当が無ければ「SSOT に未登録」と明示してから推測に移る。",
  ].join(" ");
}

async function main() {
  try {
    logHookExecution("UserPromptSubmit", "ssot-self-assessment", "SSOT メタ認知チェックを注入");
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: buildSelfAssessment(),
        suppressOutput: true,
      }),
    );
  } catch (error) {
    logHookExecution(
      "UserPromptSubmit",
      "ssot-self-assessment",
      `エラー: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(
      JSON.stringify({ continue: true, systemMessage: "", suppressOutput: true }),
    );
  }
}

void main();
