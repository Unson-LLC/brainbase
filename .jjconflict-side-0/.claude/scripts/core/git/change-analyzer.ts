/**
 * Git変更検出→影響フロー特定システム
 *
 * 目的: Git変更を検出し、影響を受ける処理フローを特定して
 *      自動テスト生成の基盤データを提供
 */

import { execSync } from "child_process";
import * as path from "path";
import { FlowDetectorService } from "../../../../src/services/flow-detector-service";
import type { ChangeImpactAnalysis } from "../../../../src/types/hooks/flow-tracking";

interface GitChangeInfo {
  type: "modified" | "added" | "deleted" | "renamed";
  file: string;
  oldFile?: string; // リネームの場合
}

interface ChangeContext {
  branch: string;
  commit: string;
  timestamp: Date;
  author: string;
  changes: GitChangeInfo[];
}

/**
 * Git変更分析エンジン
 */
class GitChangeAnalyzer {
  private flowDetector: FlowDetectorService;

  constructor(private projectRoot: string) {
    this.flowDetector = new FlowDetectorService(projectRoot);
  }

  /**
   * 現在のGit変更を検出
   */
  detectCurrentChanges(): ChangeContext {
    const branch = this.getCurrentBranch();
    const commit = this.getCurrentCommit();
    const author = this.getCurrentAuthor();
    const changes = this.getChangedFiles();

    return {
      branch,
      commit,
      timestamp: new Date(),
      author,
      changes,
    };
  }

  /**
   * 指定したコミット範囲の変更を検出
   */
  detectChangesInRange(fromCommit: string, toCommit = "HEAD"): ChangeContext {
    const branch = this.getCurrentBranch();
    const author = this.getCurrentAuthor();
    const changes = this.getChangedFilesInRange(fromCommit, toCommit);

    return {
      branch,
      commit: toCommit,
      timestamp: new Date(),
      author,
      changes,
    };
  }

  /**
   * ステージされた変更を検出
   */
  detectStagedChanges(): ChangeContext {
    const branch = this.getCurrentBranch();
    const commit = this.getCurrentCommit();
    const author = this.getCurrentAuthor();
    const changes = this.getStagedFiles();

    return {
      branch,
      commit,
      timestamp: new Date(),
      author,
      changes,
    };
  }

  /**
   * 変更影響分析の実行
   */
  async analyzeChangeImpact(
    context?: ChangeContext,
  ): Promise<ChangeImpactAnalysis> {
    if (!context) {
      context = this.detectCurrentChanges();
    }

    console.log("🔍 変更影響分析を開始...");
    console.log(`   ブランチ: ${context.branch}`);
    console.log(`   変更ファイル数: ${context.changes.length}`);

    // フローレジストリを更新（必要に応じて）
    await this.flowDetector.detectAllFlows();

    // 変更されたファイルのパスを取得
    const changedFilePaths = context.changes
      .filter((change) => change.type !== "deleted")
      .map((change) => path.resolve(this.projectRoot, change.file));

    // 影響分析を実行
    const analysis = this.flowDetector.analyzeChangeImpact(changedFilePaths);

    // 変更コンテキストを分析結果に追加
    (analysis as any).changeContext = context;

    console.log("📊 分析完了:");
    console.log(`   影響度: ${analysis.impactScope}`);
    console.log(`   影響フロー数: ${analysis.affectedFlows.length}`);
    console.log(`   重要パス数: ${analysis.criticalPaths.length}`);

    return analysis;
  }

  /**
   * 変更種別の詳細分析
   */
  analyzeChangeTypes(changes: GitChangeInfo[]): {
    sourceCode: GitChangeInfo[];
    tests: GitChangeInfo[];
    config: GitChangeInfo[];
    documentation: GitChangeInfo[];
  } {
    const sourceCode: GitChangeInfo[] = [];
    const tests: GitChangeInfo[] = [];
    const config: GitChangeInfo[] = [];
    const documentation: GitChangeInfo[] = [];

    for (const change of changes) {
      if (this.isTestFile(change.file)) {
        tests.push(change);
      } else if (this.isConfigFile(change.file)) {
        config.push(change);
      } else if (this.isDocumentationFile(change.file)) {
        documentation.push(change);
      } else if (this.isSourceCodeFile(change.file)) {
        sourceCode.push(change);
      }
    }

    return { sourceCode, tests, config, documentation };
  }

  /**
   * 高リスク変更の検出
   */
  detectHighRiskChanges(changes: GitChangeInfo[]): GitChangeInfo[] {
    const highRiskPatterns = [
      // データベース関連
      /prisma\/schema\.prisma$/,
      /\/migrations\//,

      // 認証・セキュリティ
      /auth/i,
      /security/i,
      /middleware/i,

      // API エンドポイント
      /\/api\//,
      /route\.ts$/,

      // 設定ファイル
      /\.env/,
      /config/i,
      /next\.config/,

      // ワーカー処理
      /\/workers\//,
      /queue/i,

      // 外部サービス連携
      /resend/i,
      /stripe/i,
      /claude/i,
    ];

    return changes.filter((change) =>
      highRiskPatterns.some((pattern) => pattern.test(change.file)),
    );
  }

  // Git操作のヘルパーメソッド
  private getCurrentBranch(): string {
    try {
      return execSync("git branch --show-current", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private getCurrentCommit(): string {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private getCurrentAuthor(): string {
    try {
      return execSync("git config user.name", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  private getChangedFiles(): GitChangeInfo[] {
    try {
      // ワーキングディレクトリとステージの変更を取得
      const output = execSync("git status --porcelain", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      });

      return this.parseGitStatusOutput(output);
    } catch {
      return [];
    }
  }

  private getStagedFiles(): GitChangeInfo[] {
    try {
      const output = execSync("git diff --cached --name-status", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      });

      return this.parseGitDiffOutput(output);
    } catch {
      return [];
    }
  }

  private getChangedFilesInRange(
    fromCommit: string,
    toCommit: string,
  ): GitChangeInfo[] {
    try {
      const output = execSync(
        `git diff --name-status ${fromCommit}..${toCommit}`,
        {
          cwd: this.projectRoot,
          encoding: "utf-8",
        },
      );

      return this.parseGitDiffOutput(output);
    } catch {
      return [];
    }
  }

  private parseGitStatusOutput(output: string): GitChangeInfo[] {
    const changes: GitChangeInfo[] = [];
    const lines = output.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      let type: GitChangeInfo["type"];
      if (status.includes("M")) {
        type = "modified";
      } else if (status.includes("A")) {
        type = "added";
      } else if (status.includes("D")) {
        type = "deleted";
      } else if (status.includes("R")) {
        type = "renamed";
      } else {
        type = "modified"; // デフォルト
      }

      changes.push({ type, file });
    }

    return changes;
  }

  private parseGitDiffOutput(output: string): GitChangeInfo[] {
    const changes: GitChangeInfo[] = [];
    const lines = output.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 2) continue;

      const status = parts[0];
      const file = parts[1];

      let type: GitChangeInfo["type"];
      if (status === "M") {
        type = "modified";
      } else if (status === "A") {
        type = "added";
      } else if (status === "D") {
        type = "deleted";
      } else if (status.startsWith("R")) {
        type = "renamed";
        // リネームの場合、oldFile も設定
      } else {
        type = "modified";
      }

      changes.push({ type, file });
    }

    return changes;
  }

  // ファイル種別判定のヘルパーメソッド
  private isTestFile(file: string): boolean {
    return (
      /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || file.includes("/tests/")
    );
  }

  private isConfigFile(file: string): boolean {
    return (
      /\.(config|conf)\.(ts|js|json)$/.test(file) ||
      /(package\.json|tsconfig\.json|\.env)$/.test(file)
    );
  }

  private isDocumentationFile(file: string): boolean {
    return /\.(md|txt|rst)$/.test(file) || file.includes("/docs/");
  }

  private isSourceCodeFile(file: string): boolean {
    return (
      /\.(ts|tsx|js|jsx)$/.test(file) &&
      !this.isTestFile(file) &&
      !this.isConfigFile(file)
    );
  }

  /**
   * レポート生成
   */
  generateChangeReport(context: ChangeContext): string {
    const changeTypes = this.analyzeChangeTypes(context.changes);
    const highRiskChanges = this.detectHighRiskChanges(context.changes);

    const report = [
      "📊 Git変更分析レポート",
      "=".repeat(50),
      "",
      `🌿 ブランチ: ${context.branch}`,
      `📝 コミット: ${context.commit.substring(0, 8)}`,
      `👤 作成者: ${context.author}`,
      `⏰ 時刻: ${context.timestamp.toLocaleString("ja-JP")}`,
      "",
      "📈 変更統計:",
      `  📁 ソースコード: ${changeTypes.sourceCode.length}`,
      `  🧪 テスト: ${changeTypes.tests.length}`,
      `  ⚙️  設定: ${changeTypes.config.length}`,
      `  📖 ドキュメント: ${changeTypes.documentation.length}`,
      "",
      highRiskChanges.length > 0
        ? [
            "⚠️  高リスク変更:",
            ...highRiskChanges.map(
              (change) => `  - ${change.file} (${change.type})`,
            ),
            "",
          ].join("\n")
        : "",
      "📂 全変更ファイル:",
      ...context.changes.map((change) => `  - ${change.file} (${change.type})`),
      "",
    ].join("\n");

    return report;
  }
}

export { GitChangeAnalyzer, GitChangeInfo, ChangeContext };
