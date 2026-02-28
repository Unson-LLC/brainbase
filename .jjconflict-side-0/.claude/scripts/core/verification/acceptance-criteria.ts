/**
 * 受け入れ基準自動検証フック
 * コミット前に要件の受け入れ基準が満たされているかを検証
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface AcceptanceCriteria {
  description: string;
  checked: boolean;
  line: number;
}

interface Requirement {
  id: string;
  title: string;
  file: string;
  acceptanceCriteria: AcceptanceCriteria[];
  testScenarios: string[];
}

/**
 * 要件ファイルから受け入れ基準を抽出
 */
function extractRequirements(): Requirement[] {
  const dirs = [
    path.join(process.cwd(), "docs/management/requirements/active"),
    path.join(process.cwd(), "docs/management/user_stories/active"),
    path.join(process.cwd(), "docs/management/tasks/active"),
  ];

  const allFiles: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.warn("ディレクトリが見つかりません:", dir);
      continue;
    }

    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.join(dir, file));

    allFiles.push(...files);
  }

  const reqFiles = allFiles;

  const requirements: Requirement[] = [];

  for (const file of reqFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    // 要件IDとタイトルを抽出 (REQ-XXX, US-XXX, TASK-XXXに対応)
    const idMatch = content.match(/^id:\s*(.+)$/m);
    const titleMatch = content.match(/^title:\s*"(.+)"$/m);

    if (!idMatch || !titleMatch) continue;

    const id = idMatch[1].trim();
    const title = titleMatch[1];

    // 受け入れ基準を抽出（全てのチェックボックスを対象とする）
    const acceptanceCriteria: AcceptanceCriteria[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // すべてのチェックボックスを検出
      if (line.match(/^- \[([ x])\]/)) {
        const checked = line.includes("[x]");
        const description = line.replace(/^- \[([ x])\]\s*/, "");
        acceptanceCriteria.push({
          description,
          checked,
          line: i + 1,
        });
      }
    }

    // テストシナリオを抽出
    const testScenarios: string[] = [];
    let inTestSection = false;

    for (const line of lines) {
      if (line.includes("テストシナリオ")) {
        inTestSection = true;
        continue;
      }

      if (inTestSection && line.startsWith("##")) {
        inTestSection = false;
        continue;
      }

      if (inTestSection && line.startsWith("### テストシナリオ")) {
        testScenarios.push(line);
      }
    }

    requirements.push({
      id,
      title,
      file,
      acceptanceCriteria,
      testScenarios,
    });
  }

  return requirements;
}

/**
 * 変更されたファイルから関連する要件IDを特定
 */
function getRelatedRequirements(changedFiles: string[]): string[] {
  const reqIds = new Set<string>();

  for (const file of changedFiles) {
    // ファイル名からID検索 (REQ-, US-, TASK-に対応)
    const fileIdMatches = file.match(/(REQ|US|TASK)-(\d+)/g);
    if (fileIdMatches) {
      fileIdMatches.forEach((match) => reqIds.add(match));
    }

    // ファイル内容からID検索
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        // id: 行からIDを抽出
        const idMatch = content.match(/^id:\s*(.+)$/m);
        if (idMatch) {
          const id = idMatch[1].trim();
          if (id.match(/^(REQ|US|TASK)-\d+$/)) {
            reqIds.add(id);
          }
        }
        // 内容中のREF-XXX参照も検索
        const refMatches = content.match(/(REQ|US|TASK)-\d+/g);
        if (refMatches) {
          refMatches.forEach((match) => reqIds.add(match));
        }
      } catch (error) {
        // ファイル読み込みエラーは無視
      }
    }
  }

  return Array.from(reqIds);
}

/**
 * 単一責任の原則チェック
 */
function checkSingleResponsibility(file: string): string[] {
  const issues: string[] = [];

  if (!fs.existsSync(file)) return issues;

  try {
    const content = fs.readFileSync(file, "utf-8");

    // APIエンドポイントでの直接DB操作チェック
    if (file.includes("/api/") && file.includes("route.ts")) {
      if (
        content.includes("db.") ||
        content.includes("prisma.") ||
        content.includes("$transaction")
      ) {
        issues.push(
          `${file}: APIエンドポイントで直接DB操作を行っています。サービス層に分離すべきです`,
        );
      }

      if (
        content.includes("findUnique") ||
        content.includes("create") ||
        content.includes("update")
      ) {
        issues.push(
          `${file}: APIエンドポイントでCRUD操作を直接実行しています。リポジトリ層に分離すべきです`,
        );
      }

      if (
        content.includes("sendEmail") ||
        content.includes("sendCustomEmail")
      ) {
        issues.push(
          `${file}: APIエンドポイントで直接メール送信を行っています。通知サービスに分離すべきです`,
        );
      }
    }

    // HTMLメール文面のベタ書きチェック
    if (
      file.includes("email") &&
      content.includes("html:") &&
      content.includes("<html>")
    ) {
      const htmlLines = content
        .split("\n")
        .filter((line) => line.includes("<")).length;
      if (htmlLines > 5) {
        issues.push(
          `${file}: HTMLメール文面がベタ書きされています。テンプレートファイルに分離すべきです`,
        );
      }
    }

    // 長大な関数チェック
    const functionMatches = content.match(
      /export\s+(async\s+)?function\s+\w+[^{]*{/g,
    );
    if (functionMatches) {
      for (const match of functionMatches) {
        const functionStart = content.indexOf(match);
        const functionContent = content.substring(functionStart);
        const lines = functionContent.split("\n").length;

        if (lines > 50) {
          issues.push(
            `${file}: 長大な関数が検出されました (${lines}行)。小さな関数に分割すべきです`,
          );
        }
      }
    }

    // 複数責任のチェック
    const responsibilities: string[] = [];
    if (content.includes("validation") || content.includes("schema"))
      responsibilities.push("入力検証");
    if (
      content.includes("db.") ||
      content.includes("create") ||
      content.includes("findUnique")
    )
      responsibilities.push("データアクセス");
    if (content.includes("sendEmail") || content.includes("mail"))
      responsibilities.push("通知処理");
    if (content.includes("auth") || content.includes("session"))
      responsibilities.push("認証処理");
    if (content.includes("hash") || content.includes("encrypt"))
      responsibilities.push("暗号化処理");

    if (responsibilities.length > 2) {
      issues.push(
        `${file}: 複数の責任を持っています: ${responsibilities.join(", ")}。責任を分離すべきです`,
      );
    }
  } catch (error) {
    // エラーは無視
  }

  return issues;
}

/**
 * 保守性チェック
 */
function checkMaintainability(file: string): string[] {
  const issues: string[] = [];

  if (!fs.existsSync(file)) return issues;

  try {
    const content = fs.readFileSync(file, "utf-8");

    // ハードコーディングチェック
    const hardcodedStrings = content.match(/"[^"]{20,}"/g);
    if (hardcodedStrings && hardcodedStrings.length > 3) {
      issues.push(
        `${file}: 長い文字列のハードコーディングが検出されました。設定ファイルまたは定数に移すべきです`,
      );
    }

    // マジックナンバーチェック
    const magicNumbers = content.match(/\b(?!0|1|2|100|1000)\d{3,}\b/g);
    if (magicNumbers && magicNumbers.length > 0) {
      issues.push(
        `${file}: マジックナンバーが検出されました: ${magicNumbers.join(", ")}。定数として定義すべきです`,
      );
    }

    // 重複コードチェック
    const lines = content.split("\n");
    const duplicateLines = new Map<string, number>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length > 20 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*")
      ) {
        duplicateLines.set(trimmed, (duplicateLines.get(trimmed) || 0) + 1);
      }
    }

    const duplicates = Array.from(duplicateLines.entries())
      .filter(([_, count]) => count > 2)
      .map(([line, count]) => `"${line.substring(0, 50)}..." (${count}回)`);

    if (duplicates.length > 0) {
      issues.push(
        `${file}: 重複コードが検出されました: ${duplicates.join(", ")}`,
      );
    }

    // コメント不足チェック
    const codeLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    }).length;

    const commentLines = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    }).length;

    const commentRatio = commentLines / (codeLines + commentLines);
    if (commentRatio < 0.1 && codeLines > 20) {
      issues.push(
        `${file}: コメント率が低すぎます (${Math.round(commentRatio * 100)}%)。保守性を向上させるためコメントを追加してください`,
      );
    }
  } catch (error) {
    // エラーは無視
  }

  return issues;
}

/**
 * 受け入れ基準の実装状況をチェック
 */
function verifyImplementation(
  requirement: Requirement,
  _changedFiles: string[],
): string[] {
  const issues: string[] = [];

  // 未チェックの受け入れ基準がある場合
  const unchecked = requirement.acceptanceCriteria.filter((c) => !c.checked);
  if (unchecked.length > 0) {
    issues.push(`要件 ${requirement.id}: 未達成の受け入れ基準があります:`);
    unchecked.forEach((criteria) => {
      issues.push(`  - ${criteria.description} (行 ${criteria.line})`);
    });
  }

  // 関連テストファイルの存在チェック
  const reqNumber = requirement.id.replace("REQ-", "");
  const possibleTestFiles = [
    `tests/e2e/req-${reqNumber.toLowerCase()}.spec.ts`,
    `tests/integration/req-${reqNumber.toLowerCase()}.test.ts`,
    `src/**/*req-${reqNumber.toLowerCase()}*.test.ts`,
  ];

  const existingTestFiles = possibleTestFiles.filter((pattern) => {
    if (pattern.includes("**")) {
      // glob パターンの簡単な実装
      try {
        const files = execSync(
          `find . -path "${pattern}" 2>/dev/null || true`,
          { encoding: "utf-8" },
        );
        return files.trim().length > 0;
      } catch {
        return false;
      }
    }
    return fs.existsSync(pattern);
  });

  if (existingTestFiles.length === 0 && requirement.testScenarios.length > 0) {
    issues.push(
      `要件 ${requirement.id}: テストシナリオが定義されていますが、対応するテストファイルが見つかりません`,
    );
    issues.push(`  期待されるテストファイル: ${possibleTestFiles.join(", ")}`);
  }

  return issues;
}

/**
 * メイン検証関数
 */
export default function verifyAcceptanceCriteria(): void {
  console.log("🔍 受け入れ基準・品質チェックを実行中...");

  if (process.env.SKIP_ACCEPTANCE_CHECK === "1") {
    console.log(
      "⚠️ 受け入れ基準チェックをスキップします (SKIP_ACCEPTANCE_CHECK)",
    );
    return;
  }

  // 変更されたファイルを取得
  let changedFiles: string[] = [];
  try {
    const output = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
    });
    changedFiles = output
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch (error) {
    console.warn(
      "変更ファイルの取得に失敗しました。全ファイルをチェックします。",
    );
    changedFiles = ["src/**/*"];
  }

  console.log("📁 変更されたファイル:", changedFiles);

  // 関連要件を特定
  const relatedReqIds = getRelatedRequirements(changedFiles);
  console.log("🎯 関連要件:", relatedReqIds);

  // 要件を読み込み
  const requirements = extractRequirements();
  console.log(`🔍 検出された全要件数: ${requirements.length}`);
  console.log(`🔍 全要件ID: ${requirements.map((r) => r.id).join(", ")}`);

  const relevantReqs = requirements.filter(
    (req) => relatedReqIds.length === 0 || relatedReqIds.includes(req.id),
  );
  console.log(`🎯 対象要件: ${relevantReqs.map((r) => r.id).join(", ")}`);
  console.log(`🎯 対象要件数: ${relevantReqs.length}`);

  const allIssues: string[] = [];

  // 受け入れ基準チェック
  for (const req of relevantReqs) {
    console.log(`📋 要件 ${req.id} をチェック中...`);
    const implementationIssues = verifyImplementation(req, changedFiles);
    allIssues.push(...implementationIssues);
  }

  // 品質チェック
  for (const file of changedFiles) {
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      console.log(`🔧 ${file} の品質をチェック中...`);

      const srpIssues = checkSingleResponsibility(file);
      const maintainabilityIssues = checkMaintainability(file);

      allIssues.push(...srpIssues);
      allIssues.push(...maintainabilityIssues);
    }
  }

  // デバッグ：各要件の詳細を表示
  console.log("\n📊 要件詳細:");
  for (const req of relevantReqs) {
    console.log(`  ${req.id}: ${req.acceptanceCriteria.length}個の基準`);
    if (req.acceptanceCriteria.length > 0) {
      console.log(
        `    最初の基準: ${req.acceptanceCriteria[0].description.substring(0, 50)}...`,
      );
    }
  }

  // 結果報告
  if (allIssues.length > 0) {
    console.error("\n❌ 品質チェックに失敗しました:\n");
    allIssues.forEach((issue) => console.error(`  ${issue}`));
    console.error("\n🛠️  上記の問題を修正してからコミットしてください。");
    process.exit(1);
  }

  console.log("\n✅ 受け入れ基準・品質チェックに合格しました!");
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyAcceptanceCriteria();
}
