#!/usr/bin/env tsx

/**
 * 必須確認システム - AI の思考プロセス強制変更
 *
 * 100%の確実性で以下を強制：
 * 1. 不明確な指示での推測行動を絶対禁止
 * 2. 重要操作前の必須確認ステップ
 * 3. 「わからない」状態での行動禁止
 */

import * as fs from "fs";
import * as path from "path";

import type {
  UserMessage,
  VerificationResult,
} from "../../../../src/types/claude-hooks.js";

/**
 * 絶対に推測してはいけないパターン
 */
const AMBIGUOUS_PATTERNS = [
  // 不完全なメッセージ
  { pattern: /^.{1,3}です$/, reason: "短すぎる指示（推測が必要）" },
  {
    pattern: /^(はい|いいえ|yes|no)$/,
    reason: "文脈なしの回答（何に対して？）",
  },
  { pattern: /^(これ|それ|あれ)/, reason: "指示語のみ（対象不明）" },
  { pattern: /NNです$/, reason: "意味不明な略語" },
  { pattern: /です$/, reason: "文が途中で切れている可能性" },

  // 曖昧な削除指示
  { pattern: /^削除/, reason: "削除対象が不明確" },
  { pattern: /^消/, reason: "削除対象が不明確" },
  { pattern: /いらない$/, reason: "何がいらないのか不明" },
  { pattern: /不要/, reason: "何が不要なのか不明確" },

  // 曖昧な修正指示
  { pattern: /^修正/, reason: "修正内容・対象が不明確" },
  { pattern: /^変更/, reason: "変更内容・対象が不明確" },
  { pattern: /^直/, reason: "修正内容が不明確" },
];

/**
 * 絶対確認が必要な重要操作
 */
const CRITICAL_OPERATIONS = [
  // ファイル削除
  {
    keywords: ["rm ", "unlink", "delete"],
    question: "どのファイルを、なぜ削除する必要がありますか？",
  },

  // 設定変更
  {
    keywords: ["settings.json", ".env", "config"],
    question: "どの設定を、どのように変更しますか？理由は？",
  },

  // データベース操作
  {
    keywords: ["prisma", "database", "migrate"],
    question: "データベースへの影響を理解していますか？具体的な操作内容は？",
  },

  // Git操作
  {
    keywords: ["git reset", "git clean", "git rm"],
    question:
      "この Git 操作の影響範囲と目的を確認します。詳細を教えてください。",
  },
];

/**
 * ユーザーメッセージの明確度を分析
 */
function analyzeMessageClarity(message: string): {
  confidence: number;
  ambiguities: string[];
} {
  const ambiguities: string[] = [];
  let confidence = 100;

  // 長さチェック
  if (message.length < 5) {
    confidence -= 60;
    ambiguities.push("メッセージが短すぎる（5文字未満）");
  }

  // 曖昧パターンチェック
  for (const { pattern, reason } of AMBIGUOUS_PATTERNS) {
    if (pattern.test(message.trim())) {
      confidence = 0; // 曖昧パターンは即座に0点
      ambiguities.push(`${reason}: "${message}"`);
      break;
    }
  }

  // 具体性チェック
  if (message.match(/^[ひらがな]{1,5}$/)) {
    confidence = 0;
    ambiguities.push("ひらがなのみの短い指示は推測が必要");
  }

  // 疑問符がない疑問文
  if (
    message.includes("何") &&
    !message.includes("？") &&
    !message.includes("?")
  ) {
    confidence -= 20;
    ambiguities.push("疑問文に疑問符がない");
  }

  return { confidence, ambiguities };
}

/**
 * 操作の重要度をチェック
 */
function checkOperationCriticality(command: string): {
  isCritical: boolean;
  requiredQuestion?: string;
} {
  for (const operation of CRITICAL_OPERATIONS) {
    for (const keyword of operation.keywords) {
      if (command.includes(keyword)) {
        return {
          isCritical: true,
          requiredQuestion: operation.question,
        };
      }
    }
  }

  return { isCritical: false };
}

/**
 * 最後のユーザーメッセージを取得
 */
function getLastUserMessage(): string {
  // 環境変数から取得（実際のClaude Codeで設定が必要）
  return process.env.LAST_USER_MESSAGE || "";
}

/**
 * メイン検証処理
 */
function mandatoryVerification(toolInput: string): VerificationResult {
  const lastMessage = getLastUserMessage();

  // ユーザーメッセージがない場合は安全側に倒す
  if (!lastMessage || lastMessage.trim().length === 0) {
    return {
      canProceed: false,
      blockReason: "ユーザーメッセージが取得できません",
      mandatoryQuestion:
        "どのような操作をご希望ですか？具体的に教えてください。",
    };
  }

  // メッセージの明確度を分析
  const clarity = analyzeMessageClarity(lastMessage);

  // 明確度が低い場合は即座にブロック
  if (clarity.confidence < 80) {
    return {
      canProceed: false,
      blockReason: "不明確な指示での推測行動は禁止されています",
      mandatoryQuestion: `「${lastMessage}」について詳しく教えてください。何を、どのように、なぜ行いたいのですか？`,
      detectedAmbiguity: clarity.ambiguities,
    };
  }

  // 重要操作のチェック
  const commandMatch = toolInput.match(/"command"\s*:\s*"([^"]+)"/);
  if (commandMatch) {
    const command = commandMatch[1];
    const criticality = checkOperationCriticality(command);

    if (criticality.isCritical) {
      // 重要操作では、明確な指示があっても追加確認を要求
      if (!lastMessage.includes("確認") && !lastMessage.includes("実行")) {
        return {
          canProceed: false,
          blockReason: "重要操作には明示的な確認が必要です",
          mandatoryQuestion:
            criticality.requiredQuestion || "本当にこの操作を実行しますか？",
        };
      }
    }
  }

  return {
    canProceed: true,
    detectedAmbiguity: [],
  };
}

/**
 * 検証結果の表示とブロック
 */
function enforceVerification(result: VerificationResult): void {
  if (!result.canProceed) {
    console.log("🛑 必須確認システム - 操作をブロックしました");
    console.log("━".repeat(70));
    console.log(`❌ ブロック理由: ${result.blockReason}`);
    console.log("");

    if (result.detectedAmbiguity && result.detectedAmbiguity.length > 0) {
      console.log("🔍 検出された曖昧さ:");
      result.detectedAmbiguity.forEach((ambiguity) => {
        console.log(`   - ${ambiguity}`);
      });
      console.log("");
    }

    if (result.mandatoryQuestion) {
      console.log("❓ 必須確認事項:");
      console.log(`   ${result.mandatoryQuestion}`);
      console.log("");
    }

    console.log("📋 対処法:");
    console.log("   1. ユーザーに上記の質問を投げてください");
    console.log("   2. 明確な回答を得てから再実行してください");
    console.log("   3. 推測での補完は絶対に行わないでください");
    console.log("");
    console.log("⚠️  このルールは100%遵守が必要です");
    console.log("━".repeat(70));

    // エラーコードで終了（操作を強制ブロック）
    process.exit(1);
  }
}

// 記録用ログ
function logVerification(toolInput: string, result: VerificationResult): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    lastUserMessage: getLastUserMessage(),
    toolInput: toolInput.substring(0, 200), // 最初の200文字のみ
    canProceed: result.canProceed,
    blockReason: result.blockReason,
    detectedAmbiguity: result.detectedAmbiguity,
  };

  const logPath = ".claude/output/logs/mandatory-verification.log";
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
}

// メイン実行
const toolInput = process.argv[2] || process.env.CLAUDE_TOOL_INPUT || "";

if (toolInput) {
  const result = mandatoryVerification(toolInput);

  // ログ記録
  try {
    logVerification(toolInput, result);
  } catch {
    // ログ失敗しても処理は継続
  }

  // 結果に基づいてブロックまたは通過
  enforceVerification(result);
}

export {
  mandatoryVerification,
  analyzeMessageClarity,
  checkOperationCriticality,
};
