/**
 * 汎用処理フロー自動追跡システム
 *
 * 目的: 任意の機能修正時に、エントリーポイントから終了点まで
 *      処理フロー全体を自動追跡し、修正箇所を含むテストを生成
 */

import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

// 処理フローの構造
interface ProcessingFlow {
  entryPoint: FlowStep;
  steps: FlowStep[];
  endPoints: FlowStep[];
  flowId: string;
}

interface FlowStep {
  file: string;
  function: string;
  line: number;
  callsNext: FunctionCall[];
  isEndPoint: boolean;
  isExternalCall: boolean; // API呼び出し、DB操作等
  modifiesData: boolean;
}

interface FunctionCall {
  functionName: string;
  targetFile?: string;
  isAsync: boolean;
  parameters: string[];
}

/**
 * AST解析によるコード追跡エンジン
 */
class CodeAnalyzer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(private projectRoot: string) {
    this.initializeTypeScript();
  }

  private initializeTypeScript() {
    // TypeScript設定を読み込み
    const configPath = ts.findConfigFile(
      this.projectRoot,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    if (!configPath) {
      throw new Error("tsconfig.json not found");
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const compilerOptions = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      this.projectRoot,
    );

    // 全TypeScriptファイルを対象にプログラム作成
    const sourceFiles = glob.sync("**/*.{ts,tsx}", {
      cwd: this.projectRoot,
      ignore: ["node_modules/**", "dist/**", ".next/**"],
      absolute: true,
    });

    this.program = ts.createProgram(sourceFiles, compilerOptions.options);
    this.checker = this.program.getTypeChecker();
  }

  /**
   * 指定ファイルから関数呼び出しを抽出
   */
  extractFunctionCalls(filePath: string): Map<string, FunctionCall[]> {
    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) return new Map();

    const functionCalls = new Map<string, FunctionCall[]>();

    const visit = (node: ts.Node, currentFunction?: string) => {
      // 関数・メソッド定義の検出
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node)
      ) {
        const functionName = this.getFunctionName(node);
        if (functionName) {
          currentFunction = functionName;
          functionCalls.set(functionName, []);
        }
      }

      // 関数呼び出しの検出
      if (ts.isCallExpression(node) && currentFunction) {
        const call = this.analyzeFunctionCall(node, sourceFile);
        if (call) {
          const calls = functionCalls.get(currentFunction) || [];
          calls.push(call);
          functionCalls.set(currentFunction, calls);
        }
      }

      ts.forEachChild(node, (child) => visit(child, currentFunction));
    };

    visit(sourceFile);
    return functionCalls;
  }

  private getFunctionName(
    node: ts.FunctionLikeDeclaration,
  ): string | undefined {
    if (ts.isFunctionDeclaration(node) && node.name) {
      return node.name.text;
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name.text;
    }
    if (
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      return node.parent.name.text;
    }
    return undefined;
  }

  private analyzeFunctionCall(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile,
  ): FunctionCall | null {
    const expression = node.expression;
    let functionName = "";
    let targetFile: string | undefined;

    // 関数名の抽出
    if (ts.isIdentifier(expression)) {
      functionName = expression.text;
      // インポートから対象ファイルを特定
      targetFile = this.resolveImportTarget(functionName, sourceFile);
    } else if (ts.isPropertyAccessExpression(expression)) {
      functionName = expression.name.text;
      // オブジェクトのメソッド呼び出し
      if (ts.isIdentifier(expression.expression)) {
        const objectName = expression.expression.text;
        targetFile = this.resolveImportTarget(objectName, sourceFile);
      }
    }

    if (!functionName) return null;

    // パラメータの抽出
    const parameters = node.arguments.map((arg) => arg.getText(sourceFile));

    // 非同期判定
    const isAsync = this.isAsyncCall(node, sourceFile);

    return {
      functionName,
      targetFile,
      isAsync,
      parameters,
    };
  }

  private resolveImportTarget(
    symbolName: string,
    sourceFile: ts.SourceFile,
  ): string | undefined {
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && statement.moduleSpecifier) {
        const moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral)
          .text;

        if (statement.importClause) {
          // default import
          if (statement.importClause.name?.text === symbolName) {
            return this.resolveModulePath(moduleSpecifier, sourceFile.fileName);
          }

          // named imports
          if (
            statement.importClause.namedBindings &&
            ts.isNamedImports(statement.importClause.namedBindings)
          ) {
            for (const element of statement.importClause.namedBindings
              .elements) {
              if (element.name.text === symbolName) {
                return this.resolveModulePath(
                  moduleSpecifier,
                  sourceFile.fileName,
                );
              }
            }
          }
        }
      }
    }
    return undefined;
  }

  private resolveModulePath(
    moduleSpecifier: string,
    currentFile: string,
  ): string {
    // 相対パスの解決
    if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
      const currentDir = path.dirname(currentFile);
      let resolved = path.resolve(currentDir, moduleSpecifier);

      // TypeScript拡張子の補完
      if (!path.extname(resolved)) {
        if (fs.existsSync(resolved + ".ts")) {
          resolved += ".ts";
        } else if (fs.existsSync(resolved + ".tsx")) {
          resolved += ".tsx";
        } else if (fs.existsSync(path.join(resolved, "index.ts"))) {
          resolved = path.join(resolved, "index.ts");
        }
      }

      return resolved;
    }

    // @/ エイリアスの解決
    if (moduleSpecifier.startsWith("@/")) {
      return path.join(this.projectRoot, "src", moduleSpecifier.slice(2));
    }

    return moduleSpecifier;
  }

  private isAsyncCall(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile,
  ): boolean {
    // await式に包まれているかチェック
    let parent = node.parent;
    while (parent) {
      if (ts.isAwaitExpression(parent)) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  /**
   * 外部API呼び出しやDB操作の検出
   */
  isExternalCall(functionCall: FunctionCall): boolean {
    const externalPatterns = [
      // API呼び出し
      /fetch|axios|request|http/i,
      // DB操作
      /prisma|query|find|create|update|delete|save/i,
      // Queue操作
      /queue|add|process|bull/i,
      // Email送信
      /resend|send|email|mail/i,
      // ファイル操作
      /fs\.|writeFile|readFile/i,
    ];

    return externalPatterns.some(
      (pattern) =>
        pattern.test(functionCall.functionName) ||
        (functionCall.targetFile && pattern.test(functionCall.targetFile)),
    );
  }

  /**
   * データ変更操作の検出
   */
  modifiesData(functionCall: FunctionCall): boolean {
    const modifyingPatterns = [
      /create|update|delete|save|insert|upsert/i,
      /set|write|modify|change/i,
      /add|remove|push|pop|splice/i,
    ];

    return modifyingPatterns.some((pattern) =>
      pattern.test(functionCall.functionName),
    );
  }
}

/**
 * 処理フロー構築エンジン
 */
class FlowBuilder {
  constructor(private analyzer: CodeAnalyzer) {}

  /**
   * エントリーポイントから処理フローを構築
   */
  buildFlow(entryFile: string, entryFunction: string): ProcessingFlow {
    const visited = new Set<string>();
    const steps: FlowStep[] = [];

    const buildStep = (
      file: string,
      func: string,
      depth = 0,
    ): FlowStep | null => {
      const stepId = `${file}:${func}`;
      if (visited.has(stepId) || depth > 20) {
        return null; // 循環参照防止
      }
      visited.add(stepId);

      const functionCalls = this.analyzer.extractFunctionCalls(file);
      const calls = functionCalls.get(func) || [];

      const step: FlowStep = {
        file,
        function: func,
        line: 0, // TODO: 行番号の取得
        callsNext: calls,
        isEndPoint:
          calls.length === 0 ||
          calls.every((call) => this.analyzer.isExternalCall(call)),
        isExternalCall: calls.some((call) =>
          this.analyzer.isExternalCall(call),
        ),
        modifiesData: calls.some((call) => this.analyzer.modifiesData(call)),
      };

      steps.push(step);

      // 次の関数を再帰的に追跡
      for (const call of calls) {
        if (call.targetFile && !this.analyzer.isExternalCall(call)) {
          buildStep(call.targetFile, call.functionName, depth + 1);
        }
      }

      return step;
    };

    const entryStep = buildStep(entryFile, entryFunction);
    if (!entryStep) {
      throw new Error(`Entry point not found: ${entryFile}:${entryFunction}`);
    }

    return {
      entryPoint: entryStep,
      steps,
      endPoints: steps.filter((step) => step.isEndPoint),
      flowId: `${path.basename(entryFile)}_${entryFunction}_${Date.now()}`,
    };
  }

  /**
   * API Routes から処理フローを自動検出
   */
  discoverApiFlows(): ProcessingFlow[] {
    const apiFiles = glob.sync("**/api/**/route.{ts,tsx}", {
      cwd: this.analyzer["projectRoot"],
      absolute: true,
    });

    const flows: ProcessingFlow[] = [];

    for (const file of apiFiles) {
      const httpMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      for (const method of httpMethods) {
        try {
          const flow = this.buildFlow(file, method);
          flows.push(flow);
        } catch {
          // メソッドが存在しない場合はスキップ
        }
      }
    }

    return flows;
  }

  /**
   * ワーカー処理フローの自動検出
   */
  discoverWorkerFlows(): ProcessingFlow[] {
    const workerFiles = glob.sync("**/workers/**/*.{ts,tsx}", {
      cwd: this.analyzer["projectRoot"],
      absolute: true,
    });

    const flows: ProcessingFlow[] = [];

    for (const file of workerFiles) {
      const functionCalls = this.analyzer.extractFunctionCalls(file);
      for (const [funcName] of functionCalls) {
        if (
          funcName.includes("process") ||
          funcName.includes("handle") ||
          funcName.includes("execute")
        ) {
          try {
            const flow = this.buildFlow(file, funcName);
            flows.push(flow);
          } catch {
            // 処理できない場合はスキップ
          }
        }
      }
    }

    return flows;
  }
}

export { CodeAnalyzer, FlowBuilder, ProcessingFlow, FlowStep, FunctionCall };
