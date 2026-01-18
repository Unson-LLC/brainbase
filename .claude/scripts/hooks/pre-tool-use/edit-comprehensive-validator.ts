#!/usr/bin/env node
/**
 * Edit/Write実行前の包括的検証フック
 *
 * 目的: 今回のBUG-039で発生した全ての失敗を防止
 *
 * 検証項目:
 * 1. 共有コンポーネント変更時の影響範囲分析強制
 * 2. 数値変更時の関連制約値検出・提示
 * 3. 必須確認事項の明示的提示
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type {
  EditToolInput,
  ComprehensiveValidationResult,
  ImpactAnalysisResult,
  RelatedValuesResult,
  ReferenceInfo,
} from "../../../../src/types/hooks/edit-validation";

/**
 * 共有コンポーネントパスの判定
 */
function isSharedComponent(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  const sharedPaths = [
    "src/components/ui/",
    "src/lib/",
    "src/utils/",
    "src/types/",
    "src/constants/",
  ];

  return sharedPaths.some((p) => filePath.includes(p));
}

/**
 * 影響範囲分析の実行
 */
async function analyzeImpact(
  filePath: string | undefined,
): Promise<ImpactAnalysisResult> {
  const result: ImpactAnalysisResult = {
    isSharedComponent: isSharedComponent(filePath),
    referencesFound: 0,
    references: [],
    requiresConfirmation: false,
    analysisPerformed: false,
    timestamp: new Date().toISOString(),
  };

  if (!filePath || !result.isSharedComponent) {
    return result;
  }

  // 過去5分以内の分析結果キャッシュをチェック
  const cacheFile = ".claude/output/data/impact-analysis-cache.json";
  if (fs.existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      const cached = cache[filePath];
      if (
        cached &&
        Date.now() - new Date(cached.timestamp).getTime() < 5 * 60 * 1000
      ) {
        return { ...cached, analysisPerformed: true };
      }
    } catch {
      // キャッシュ読み込み失敗は無視
    }
  }

  // Grepで参照箇所を検索（簡易的な影響範囲分析）
  try {
    const fileName = path.basename(filePath, path.extname(filePath));
    const importPattern = `from.*['"](.*${fileName}|@/.*${fileName})['"]`;

    const output = execSync(
      `grep -rn -E "${importPattern}" src/ --include="*.ts" --include="*.tsx" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 10000 },
    );

    const references: ReferenceInfo[] = [];
    if (output.trim()) {
      const lines = output.trim().split("\n");
      for (const line of lines) {
        const match = line.match(/^([^:]+):(\d+):(.+)$/);
        if (match && match[1] !== filePath) {
          references.push({
            file: match[1],
            line: parseInt(match[2]),
            component: fileName,
            context: match[3].trim(),
          });
        }
      }
    }

    result.referencesFound = references.length;
    result.references = references;
    result.requiresConfirmation = references.length > 0;
    result.analysisPerformed = true;

    // キャッシュに保存
    const cache = fs.existsSync(cacheFile)
      ? JSON.parse(fs.readFileSync(cacheFile, "utf-8"))
      : {};
    cache[filePath] = result;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(
      `❌ [IMPACT-ANALYSIS] 参照検索に失敗: ${error instanceof Error ? error.message : String(error)}`,
    );
    // 検証失敗時は安全側に倒してブロック
    result.requiresConfirmation = true;
    result.analysisPerformed = false;
  }

  return result;
}

/**
 * 数値抽出
 */
function extractNumber(text: string): number | null {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

/**
 * 関連制約値の検出
 */
async function detectRelatedValues(
  params: EditToolInput,
): Promise<RelatedValuesResult> {
  const result: RelatedValuesResult = {
    numericChangeDetected: false,
    oldValue: null,
    newValue: null,
    relatedConstraints: [],
    requiresConfirmation: false,
  };

  if (!params.old_string || !params.new_string) {
    return result;
  }

  const oldNum = extractNumber(params.old_string);
  const newNum = extractNumber(params.new_string);

  if (!oldNum || !newNum || oldNum === newNum) {
    return result;
  }

  result.numericChangeDetected = true;
  result.oldValue = oldNum;
  result.newValue = newNum;

  // 関連ファイルを検索（同じディレクトリ + API/UI対応ファイル）
  const fileDir = path.dirname(params.file_path);
  const relatedPatterns = [
    `${fileDir}/*.ts`,
    `${fileDir}/*.tsx`,
    `src/components/**/*pagination*.tsx`, // ページネーション関連
    `src/app/api/**/*route.ts`, // API routes
  ];

  try {
    // Math.min/max, 配列オプション, limit/max/minパラメータを検索
    const searchPatterns = [
      `Math\\.(min|max)\\([^)]*\\d+[^)]*\\)`,
      `\\[\\s*\\d+[\\s,\\d]*\\]`, // [10, 20, 50, 100, ...]
      `(limit|max|min)\\s*[:=]\\s*\\d+`,
      `Math\\.min\\(\\d+,`,
    ];

    for (const pattern of searchPatterns) {
      const output = execSync(
        `grep -rn -E "${pattern}" ${relatedPatterns.join(" ")} 2>/dev/null || true`,
        { encoding: "utf-8", timeout: 5000 },
      );

      if (output.trim()) {
        const lines = output.trim().split("\n");
        for (const line of lines) {
          const match = line.match(/^([^:]+):(\d+):(.+)$/);
          if (match) {
            const [, file, lineNum, context] = match;
            const value = extractNumber(context);
            if (value && value !== newNum) {
              result.relatedConstraints.push({
                file,
                line: parseInt(lineNum),
                constraintType: "limit_param",
                currentValue: value,
                context: context.trim(),
              });
            }
          }
        }
      }
    }

    result.requiresConfirmation = result.relatedConstraints.length > 0;
  } catch (error) {
    console.error(
      `❌ [RELATED-VALUES] 関連値検索に失敗: ${error instanceof Error ? error.message : String(error)}`,
    );
    // 検証失敗時は安全側に倒す：数値変更が検出されていればブロック
    if (result.numericChangeDetected) {
      result.requiresConfirmation = true;
    }
  }

  return result;
}

/**
 * メイン検証ロジック
 */
async function validate(
  toolInput: string,
): Promise<ComprehensiveValidationResult> {
  let params: EditToolInput;

  try {
    params = JSON.parse(toolInput) as EditToolInput;
  } catch (error) {
    console.error(
      `❌ [EDIT-VALIDATOR] ツール入力のパース失敗: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      permissionDecision: "deny",
      blocked: true,
      reason:
        "ツール入力の解析に失敗しました。検証を実行できないため、操作をブロックします。",
      requiredActions: ["ツール入力形式を確認してください"],
    };
  }

  // 1. 影響範囲分析
  const impactResult = await analyzeImpact(params.file_path);

  if (impactResult.requiresConfirmation && !impactResult.analysisPerformed) {
    return {
      permissionDecision: "deny",
      blocked: true,
      reason: `共有コンポーネント ${params.file_path} の影響範囲分析が必要です`,
      impactAnalysis: impactResult,
      requiredActions: [
        "影響範囲分析を実行してください",
        `参照箇所: ${impactResult.referencesFound}ファイル`,
      ],
    };
  }

  // 2. 関連値検出
  const relatedResult = await detectRelatedValues(params);

  if (relatedResult.requiresConfirmation) {
    const constraintList = relatedResult.relatedConstraints
      .map(
        (c, i) =>
          `  ${i + 1}. ${c.file}:${c.line} - 現在値: ${c.currentValue}\n     ${c.context}`,
      )
      .join("\n");

    return {
      permissionDecision: "deny",
      blocked: true,
      reason: `数値変更 (${relatedResult.oldValue} → ${relatedResult.newValue}) に関連する制約値が ${relatedResult.relatedConstraints.length}件 見つかりました`,
      relatedValues: relatedResult,
      requiredActions: [
        "以下の関連制約値も確認・変更する必要があります：",
        constraintList,
        "全て一貫性を保って変更してください",
      ],
    };
  }

  // 検証通過
  return {
    permissionDecision: "allow",
    blocked: false,
    impactAnalysis: impactResult,
    relatedValues: relatedResult,
  };
}

/**
 * エントリーポイント
 */
async function main() {
  const toolInput = process.argv[2];

  if (!toolInput) {
    console.error("❌ [EDIT-VALIDATOR] ツール入力が提供されていません");
    process.exit(1);
  }

  const result = await validate(toolInput);

  // 結果を出力（Claude Codeが読み取る）
  console.log(JSON.stringify(result));

  // blocked=trueの場合はエラーで終了
  if (result.blocked) {
    console.error(`\n❌ [EDIT-VALIDATOR] ${result.reason}`);
    if (result.requiredActions) {
      console.error("\n📋 必須アクション:");
      result.requiredActions.forEach((action) => console.error(action));
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
