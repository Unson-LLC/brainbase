/**
 * 処理フロー自動検出システム
 *
 * 目的: プロジェクト全体の処理フローを自動検出し、
 *      変更ファイルが影響するフローを特定する
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import {
  CodeAnalyzer,
  FlowBuilder,
  ProcessingFlow,
  FlowStep,
} from "./flow-tracer";

const require = createRequire(import.meta.url);

interface FlowRegistry {
  flows: ProcessingFlow[];
  lastUpdate: Date;
  version: string;
}

interface ChangeImpactAnalysis {
  changedFiles: string[];
  affectedFlows: ProcessingFlow[];
  impactScope: "low" | "medium" | "high";
  criticalPaths: FlowStep[];
}

/**
 * メイン検出システム
 */
class FlowDetectionSystem {
  private analyzer: CodeAnalyzer;
  private builder: FlowBuilder;
  private registryPath: string;

  constructor(private projectRoot: string) {
    this.analyzer = new CodeAnalyzer(projectRoot);
    this.builder = new FlowBuilder(this.analyzer);
    this.registryPath = path.join(projectRoot, ".claude", "flow-registry.json");
  }

  /**
   * プロジェクト全体のフロー検出・更新
   */
  async detectAllFlows(forceUpdate = false): Promise<FlowRegistry> {
    const existing = this.loadFlowRegistry();

    // 強制更新または初回実行の場合
    if (forceUpdate || !existing || this.needsUpdate(existing)) {
      console.log("🔍 プロジェクト全体のフロー分析を開始...");

      const flows: ProcessingFlow[] = [];

      // 1. API Routes の検出
      console.log("📡 API Routes 分析中...");
      const apiFlows = this.builder.discoverApiFlows();
      flows.push(...apiFlows);
      console.log(`   検出: ${apiFlows.length} API処理フロー`);

      // 2. Worker 処理の検出
      console.log("⚡ Worker 処理分析中...");
      const workerFlows = this.builder.discoverWorkerFlows();
      flows.push(...workerFlows);
      console.log(`   検出: ${workerFlows.length} Worker処理フロー`);

      // 3. カスタムエントリーポイントの検出
      console.log("🎯 カスタムエントリーポイント分析中...");
      const customFlows = this.detectCustomEntryPoints();
      flows.push(...customFlows);
      console.log(`   検出: ${customFlows.length} カスタム処理フロー`);

      const registry: FlowRegistry = {
        flows,
        lastUpdate: new Date(),
        version: "1.0.0",
      };

      this.saveFlowRegistry(registry);
      console.log(`✅ 総検出フロー数: ${flows.length}`);

      return registry;
    }

    return existing;
  }

  /**
   * カスタムエントリーポイントの検出
   * - 特定の命名パターンの関数
   * - 特定のデコレーターが付いた関数
   * - 特定のディレクトリ配下の関数
   */
  private detectCustomEntryPoints(): ProcessingFlow[] {
    const flows: ProcessingFlow[] = [];

    // services/ 配下の主要関数を検出
    const serviceFiles = this.findFiles("**/services/**/*.{ts,tsx}");
    for (const file of serviceFiles) {
      const functions = this.analyzer.extractFunctionCalls(file);
      for (const [funcName] of functions) {
        // 主要なサービス関数の命名パターン
        if (this.isServiceEntryPoint(funcName)) {
          try {
            const flow = this.builder.buildFlow(file, funcName);
            flows.push(flow);
          } catch (error) {
            // エラーは無視して続行
          }
        }
      }
    }

    // lib/ 配下のユーティリティ関数
    const libFiles = this.findFiles("**/lib/**/*.{ts,tsx}");
    for (const file of libFiles) {
      const functions = this.analyzer.extractFunctionCalls(file);
      for (const [funcName] of functions) {
        if (this.isLibEntryPoint(funcName)) {
          try {
            const flow = this.builder.buildFlow(file, funcName);
            flows.push(flow);
          } catch (error) {
            // エラーは無視して続行
          }
        }
      }
    }

    return flows;
  }

  private isServiceEntryPoint(funcName: string): boolean {
    const patterns = [
      /^(create|update|delete|get|find|send|process|execute|handle|generate)/i,
      /Service$/i,
      /Manager$/i,
      /Handler$/i,
    ];
    return patterns.some((pattern) => pattern.test(funcName));
  }

  private isLibEntryPoint(funcName: string): boolean {
    const patterns = [
      /^(validate|parse|format|transform|calculate|compute)/i,
      /Util$/i,
      /Helper$/i,
    ];
    return patterns.some((pattern) => pattern.test(funcName));
  }

  /**
   * 変更ファイルの影響分析
   */
  analyzeChangeImpact(changedFiles: string[]): ChangeImpactAnalysis {
    const registry = this.loadFlowRegistry();
    if (!registry) {
      throw new Error(
        "フローレジストリが初期化されていません。先に detectAllFlows() を実行してください。",
      );
    }

    const affectedFlows: ProcessingFlow[] = [];
    const criticalPaths: FlowStep[] = [];

    for (const flow of registry.flows) {
      const isAffected = this.isFlowAffectedByChanges(flow, changedFiles);
      if (isAffected) {
        affectedFlows.push(flow);

        // 変更されたファイルが含まれるステップを特定
        const affectedSteps = flow.steps.filter((step) =>
          changedFiles.some(
            (changedFile) =>
              path.resolve(changedFile) === path.resolve(step.file),
          ),
        );
        criticalPaths.push(...affectedSteps);
      }
    }

    // 影響度の評価
    const impactScope = this.evaluateImpactScope(affectedFlows, criticalPaths);

    return {
      changedFiles,
      affectedFlows,
      impactScope,
      criticalPaths,
    };
  }

  /**
   * フローが変更の影響を受けるかチェック
   */
  private isFlowAffectedByChanges(
    flow: ProcessingFlow,
    changedFiles: string[],
  ): boolean {
    return flow.steps.some((step) =>
      changedFiles.some(
        (changedFile) => path.resolve(changedFile) === path.resolve(step.file),
      ),
    );
  }

  /**
   * 影響度の評価
   */
  private evaluateImpactScope(
    affectedFlows: ProcessingFlow[],
    criticalPaths: FlowStep[],
  ): "low" | "medium" | "high" {
    // API処理フローが影響を受ける場合は高影響
    const hasApiImpact = affectedFlows.some((flow) =>
      flow.entryPoint.file.includes("/api/"),
    );

    // データ変更処理が影響を受ける場合は中〜高影響
    const hasDataModification = criticalPaths.some((step) => step.modifiesData);

    // 外部API呼び出しが影響を受ける場合は中〜高影響
    const hasExternalCall = criticalPaths.some((step) => step.isExternalCall);

    if (hasApiImpact && (hasDataModification || hasExternalCall)) {
      return "high";
    }

    if (hasApiImpact || hasDataModification || hasExternalCall) {
      return "medium";
    }

    return "low";
  }

  /**
   * 特定パターンでファイル検索
   */
  private findFiles(pattern: string): string[] {
    const { glob } = require("glob");
    return glob.sync(pattern, {
      cwd: this.projectRoot,
      absolute: true,
      ignore: ["node_modules/**", "dist/**", ".next/**"],
    });
  }

  /**
   * フローレジストリの読み込み
   */
  private loadFlowRegistry(): FlowRegistry | null {
    if (!fs.existsSync(this.registryPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.registryPath, "utf-8");
      const registry = JSON.parse(content);
      registry.lastUpdate = new Date(registry.lastUpdate);
      return registry;
    } catch (error) {
      console.warn("フローレジストリの読み込みに失敗:", error);
      return null;
    }
  }

  /**
   * フローレジストリの保存
   */
  private saveFlowRegistry(registry: FlowRegistry): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2));
  }

  /**
   * フローレジストリの更新が必要かチェック
   */
  private needsUpdate(registry: FlowRegistry): boolean {
    const daysSinceUpdate =
      (Date.now() - registry.lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate > 7; // 1週間経過していたら更新
  }

  /**
   * 詳細分析レポートの生成
   */
  generateAnalysisReport(analysis: ChangeImpactAnalysis): string {
    const report = [
      "📊 変更影響分析レポート",
      "=".repeat(50),
      "",
      `🎯 影響度: ${analysis.impactScope.toUpperCase()}`,
      `📝 変更ファイル数: ${analysis.changedFiles.length}`,
      `🔄 影響フロー数: ${analysis.affectedFlows.length}`,
      `⚡ 重要パス数: ${analysis.criticalPaths.length}`,
      "",
      "📁 変更ファイル:",
      ...analysis.changedFiles.map(
        (file) => `  - ${path.relative(this.projectRoot, file)}`,
      ),
      "",
      "🔄 影響を受ける処理フロー:",
      ...analysis.affectedFlows.map((flow) => {
        const entryPoint = path.relative(
          this.projectRoot,
          flow.entryPoint.file,
        );
        return `  - ${entryPoint}:${flow.entryPoint.function} (${flow.steps.length}ステップ)`;
      }),
      "",
      "⚡ 重要な変更箇所:",
      ...analysis.criticalPaths.map((step) => {
        const filePath = path.relative(this.projectRoot, step.file);
        const tags = [];
        if (step.modifiesData) tags.push("データ変更");
        if (step.isExternalCall) tags.push("外部呼び出し");
        if (step.isEndPoint) tags.push("終了点");
        return `  - ${filePath}:${step.function} ${tags.length ? `[${tags.join(", ")}]` : ""}`;
      }),
      "",
      "🚀 推奨アクション:",
      analysis.impactScope === "high"
        ? "  ⚠️  統合テストの実行を強く推奨"
        : analysis.impactScope === "medium"
          ? "  📋 関連テストの実行を推奨"
          : "  ✅ 基本テストの実行で十分",
      "",
    ].join("\n");

    return report;
  }
}

export { FlowDetectionSystem, ChangeImpactAnalysis, FlowRegistry };
