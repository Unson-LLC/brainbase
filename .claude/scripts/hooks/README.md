# Claude Code Hooks システム

このディレクトリはClaude Code Hooksシステムのエントリーポイント（薄いラッパー）を管理します。

## 📁 ディレクトリ構造（ベストプラクティス4層アーキテクチャ）

```
.claude/scripts/
├── hooks/              # エントリーポイント（このディレクトリ）
│   ├── pre-tool-use/
│   │   ├── forbidden-commands-wrapper.ts
│   │   ├── serena-enforcement-wrapper.ts
│   │   └── edit-comprehensive-validator.ts
│   ├── post-tool-use/
│   │   ├── activity-bridge.ts
│   │   ├── edit-validator.ts
│   │   ├── git-notification-wrapper.ts
│   │   ├── requirement-checker-wrapper.ts
│   │   ├── verification-tracker-wrapper.ts
│   │   └── interrupt-detector.ts
│   ├── user-prompt-submit/
│   │   ├── activity-bridge.ts
│   │   ├── context-loader-wrapper.ts
│   │   └── test-enforcer.ts
│   ├── stop/
│   │   ├── activity-bridge.ts
│   │   └── completion-notifier-wrapper.ts
│   └── data/           # フックデータ保存
│       └── auto-context-loader/
│           └── session-state.json
├── core/               # ビジネスロジック
│   ├── git/            # Git関連処理
│   │   ├── change-analyzer.ts
│   │   ├── commit-validator.ts
│   │   └── pr-validator.ts
│   ├── quality/        # 品質管理
│   │   ├── edit-validator.ts (型チェック統合)
│   │   ├── type-checker.ts (型エラー自動検出)
│   │   └── eslint-enforcer.ts
│   ├── verification/   # 検証処理
│   │   └── requirement-checker.ts
│   ├── testing/        # テスト管理
│   │   └── auto-executor.ts
│   └── monitoring/     # 監視・追跡
│       ├── brainbase-activity-bridge.ts
│       ├── interrupt-detector.ts
│       └── verification-tracker.ts
├── lib/                # 再利用可能ユーティリティ
│   ├── notification/
│   │   ├── notifier.ts
│   │   ├── quick-notify.ts
│   │   └── hook-logger.ts (統一ログシステム)
│   ├── logging/
│   │   └── hook-logger.ts
│   ├── file-system/
│   │   └── forbidden-commands.ts
│   └── config/
│       ├── context-loader.ts
│       └── validate-settings.ts
├── test/               # フック自動テストスクリプト
│   ├── test-pre-tool-use-hooks.ts
│   ├── test-post-tool-use-hooks.ts
│   └── test-activity-bridge-hooks.ts
└── cli/                # スタンドアローンスクリプト
    ├── generate-verification-report.ts
    └── requirement-completion-check.ts
```

## 🔧 Hook種別と機能

### PreToolUse Hooks（ツール実行前）

#### Bash対象

| Hook                            | 機能                         | ログ | 実装 |
| ------------------------------- | ---------------------------- | ---- | ---- |
| `forbidden-commands-wrapper.ts` | 危険コマンドの実行前ブロック | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:pre`

#### Read対象

| Hook                            | 機能               | ログ | 実装 |
| ------------------------------- | ------------------ | ---- | ---- |
| `serena-enforcement-wrapper.ts` | Serena MCP使用強制 | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:pre`

#### Write/Edit/MultiEdit対象

| Hook                              | 機能                               | ログ | 実装 |
| --------------------------------- | ---------------------------------- | ---- | ---- |
| `edit-comprehensive-validator.ts` | ファイル編集前の影響範囲分析・検証 | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:pre`

### PostToolUse Hooks（ツール実行後）

#### Write/Edit/MultiEdit対象

| Hook                | 機能                                                                   | ログ | 実装 |
| ------------------- | ---------------------------------------------------------------------- | ---- | ---- |
| `edit-validator.ts` | **型エラー自動検出** + 品質検証（JSDoc、型定義、英語テキストチェック） | ✅   | ✅   |

**重要機能**:

- ✅ TypeScript型チェック自動実行（`npm run typecheck`）
- ✅ 型エラー検出時の通知（処理は継続）
- ✅ IDE診断エラー連携準備完了

**自動テスト**: `npm run claude:test:hooks:post`

#### Bash対象

| Hook                          | 機能                    | ログ | 実装 |
| ----------------------------- | ----------------------- | ---- | ---- |
| `git-notification-wrapper.ts` | git commit/push完了通知 | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:post`

#### TodoWrite対象

| Hook                             | 機能                           | ログ | 実装 |
| -------------------------------- | ------------------------------ | ---- | ---- |
| `requirement-checker-wrapper.ts` | タスク完了時の要件自動チェック | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:post`

#### 全ツール対象

| Hook                              | 機能                 | ログ | 実装 |
| --------------------------------- | -------------------- | ---- | ---- |
| `activity-bridge.ts`              | brainbase working heartbeat送信 | ✅   | ✅   |
| `verification-tracker-wrapper.ts` | 検証結果の追跡・記録 | ✅   | ✅   |
| `interrupt-detector.ts`           | ツール使用中断の検出 | ✅   | ✅   |

**自動テスト**: `npm run claude:test:hooks:post`

### UserPromptSubmit Hooks（ユーザー入力時）

| Hook                        | 対象パターン                     | 機能                                | ログ                 | 実装 |
| --------------------------- | -------------------------------- | ----------------------------------- | -------------------- | ---- | --- |
| `activity-bridge.ts`        | 全プロンプト                     | brainbase turn開始通知              | ✅                   | ✅   |
| `context-loader-wrapper.ts` | 全プロンプト（セッション開始時） | CLAUDE.md参照ファイルの自動読み込み | ✅                   | ✅   |
| `graph-ssot-reminder.ts`    | 全プロンプト                     | Graph SSOT確認とPhilosophy Context前提化 | ✅              | ✅   |
| `test-enforcer.ts`          | テスト言及時（`._test._          | ._テスト._`）                       | テスト実行の強制検証 | ✅   | ✅  |

### Stop Hooks（停止時）

| Hook                             | 機能                                     | ログ | 実装 |
| -------------------------------- | ---------------------------------------- | ---- | ---- |
| `activity-bridge.ts`             | brainbase turn完了/入力待ち通知          | ✅   | ✅   |
| `completion-notifier-wrapper.ts` | 作業完了・ユーザーアクション待ち状態通知 | ✅   | ✅   |

## 🧪 自動テストシステム

### PreToolUseフックテスト

```bash
# 全PreToolUseフックをテスト
npm run claude:test:hooks:pre
```

**テスト対象**:

- ✅ forbidden-commands-wrapper.ts (Bash)
- ✅ serena-enforcement-wrapper.ts (Read)
- ✅ edit-comprehensive-validator.ts (Edit|Write|MultiEdit)

**レポート出力**: `.claude/output/reports/pre-tool-use-hook-test-report.md`

### PostToolUseフックテスト

```bash
# 全PostToolUseフックをテスト
npm run claude:test:hooks:post
```

**テスト対象**:

- ✅ edit-validator.ts (Write|Edit|MultiEdit) - 型チェック含む
- ✅ git-notification-wrapper.ts (Bash)
- ✅ requirement-checker-wrapper.ts (TodoWrite)
- ✅ verification-tracker-wrapper.ts (.\* 全ツール)
- ✅ interrupt-detector.ts (.\* 全ツール)

**レポート出力**: `.claude/output/reports/post-tool-use-hook-test-report.md`

## 🛡️ Hook設定（settings.json）

Hookの設定は `.claude/settings.json` で管理されています：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/pre-tool-use/forbidden-commands-wrapper.ts \\\"$CLAUDE_TOOL_INPUT\\\""
          }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/pre-tool-use/serena-enforcement-wrapper.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 5000
          }
        ]
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/pre-tool-use/edit-comprehensive-validator.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 30000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/edit-validator.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 20000
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/git-notification-wrapper.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 5000
          }
        ]
      },
      {
        "matcher": "TodoWrite",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/requirement-checker-wrapper.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 30000
          }
        ]
      },
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/verification-tracker-wrapper.ts",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/interrupt-detector.ts",
            "timeout": 3000
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/user-prompt-submit/context-loader-wrapper.ts",
            "timeout": 30000
          }
        ]
      },
      {
        "matcher": ".*test.*|.*テスト.*",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/user-prompt-submit/test-enforcer.ts",
            "timeout": 120000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/stop/completion-notifier-wrapper.ts"
          }
        ]
      }
    ]
  }
}
```

## 📊 ログシステム

### ログファイル

全フックの実行ログは日付別に自動記録されます：

```
.claude/output/logs/
├── pretooluse-2025-10-15.log      # PreToolUseフック
├── posttooluse-2025-10-15.log     # PostToolUseフック
└── userpromptsubmit-2025-10-15.log # UserPromptSubmitフック
```

### ログ確認コマンド

```bash
# PostToolUseログの確認
tail -f .claude/output/logs/posttooluse-$(date +%Y-%m-%d).log

# PreToolUseログの確認
tail -f .claude/output/logs/pretooluse-$(date +%Y-%m-%d).log

# 型エラー検出ログの確認
tail -f .claude/output/logs/posttooluse-$(date +%Y-%m-%d).log | grep EDIT-VALIDATOR
```

### ログ出力例

```
2025-10-15T05:24:31.757Z [EDIT-VALIDATOR-START] PostToolUse: 検証開始 - Input: {}
2025-10-15T05:24:38.830Z [EDIT-VALIDATOR-COMPLETE] PostToolUse: 検証完了 - {"continue":true,"systemMessage":"✅ 品質検証完了 (スコア: 100/100) - 問題なし","suppressOutput":false}
```

## 🚨 型エラー自動検出システム

### 概要

PostToolUse(Edit)フックに統合された型エラー自動検出システムが、ファイル編集後に自動的に型チェックを実行します。

### 検出される型エラーの種類

#### 1. TypeScript Compiler (tsc) による型エラー

**検出方法**: `npm run typecheck`を実行して検出

**判定ロジック**:

```typescript
// type-checker.ts:50, 69
const hasErrors = output.includes("error TS");
```

**検出される型エラーパターン**:

| エラーコード | 説明                     | 検出例                                                        |
| ------------ | ------------------------ | ------------------------------------------------------------- |
| **TS2322**   | 型の不一致               | `const num: number = "string";` ❌                            |
| **TS2304**   | 名前の未定義             | `console.log(unknownVariable);` ❌                            |
| **TS2345**   | 引数の型不一致           | `function greet(name: string) {} greet(123);` ❌              |
| **TS2339**   | プロパティの不存在       | `const obj = { name: "test" }; obj.age;` ❌                   |
| **TS2769**   | 必須引数の不足           | `function fn(a: string, b: number) {} fn("test");` ❌         |
| **TS2307**   | モジュールが見つからない | `import { Foo } from "./non-existent";` ❌                    |
| **TS7006**   | 暗黙的any型              | `function test(param) {}` ❌ (strict mode)                    |
| **TS2741**   | プロパティの欠落         | `const user: User = { name: "test" };` (ageプロパティなし) ❌ |

**エラー抽出ロジック**:

```typescript
// type-checker.ts:54-60, 74-78
if (hasErrors) {
  result.hasErrors = true;
  const lines = output.split("\n");
  for (const line of lines) {
    if (line.includes("error TS")) {
      result.errors.push(line.trim());
    }
  }
}
```

#### 2. IDE診断エラー（tsc経由で対応済み）

**対応状況**: ✅ **TypeScript Compiler (tsc) による完全な型診断を実装済み**

**検出方法**: `npm run typecheck`を実行して、VS Code LSPと同等の診断を実現

**実装の理由**:

- `mcp__ide__getDiagnostics`はClaude AI実行コンテキストでのみ利用可能
- PostToolUseフックは外部プロセス（`npx tsx`）として実行される
- 外部プロセスからMCPツールにアクセスできない技術的制約

**tscによる診断の利点**:

- ✅ TypeScript Compilerによる完全な型チェック
- ✅ LSPと同等の診断結果を取得可能
- ✅ すべての型エラーを確実に検出
- ✅ CI/CDでも同じ診断結果を保証

**実装コード**:

```typescript
// type-checker.ts:15-30
async function getIdeDiagnostics(): Promise<
  Array<{ file: string; line: number; message: string }>
> {
  try {
    // Claude Code環境では mcp__ide__getDiagnostics が利用可能
    // しかし、MCPツールはClaude AI実行時のみ利用可能
    // このスクリプトは外部プロセスとして実行されるため、MCPツールにアクセスできない
    // 解決策: tscによる型チェックで完全にカバー（npm run typecheck）

    // 現時点では未実装（技術的制約により不要）
    return [];
  } catch {
    return [];
  }
}
```

**結論**: tscによる型チェックで、IDE診断エラーと同等の機能を実現済み

### 動作フロー

```
1. Edit/Write/MultiEdit実行
   ↓
2. PostToolUse(Edit)フック自動実行 (edit-validator.ts)
   ↓
3. 型チェック実行 (type-checker.ts:34)
   3-1. npm run typecheck実行 (type-checker.ts:44)
   3-2. 出力から"error TS"を含む行を抽出 (type-checker.ts:54-60, 74-78)
   3-3. IDE診断エラー取得（現在は空） (type-checker.ts:84)
   ↓
4. 型エラー検出時 (edit-validator.ts:532-540)
   - ⚠️ エラー内容をClaude AIに通知
   - ✅ continue: trueで処理継続（Fail-Safe原則）
   ↓
5. 品質検証実行 (edit-validator.ts:544)
```

### 通知内容例

#### 型エラー検出時

```
⚠️ TypeScript型エラーが検出されました（3件）

【検出されたエラー】
src/example.ts(42,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/example.ts(45,10): error TS2304: Cannot find name 'unknownVar'.
src/example.ts(50,3): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.

【推奨対処】
• npm run typecheckで全エラー確認
• 型定義の修正
• import文のパス確認
```

**エラー表示件数制限**:

```typescript
// edit-validator.ts:535
${typeCheckResult.errors.slice(0, 5).join("\n")}
${typeCheckResult.errors.length > 5 ? `\n...他${typeCheckResult.errors.length - 5}件のエラー` : ""}
```

- 最大5件まで表示
- 6件目以降は「...他N件のエラー」として省略

#### 型エラーなし時

```
✅ 品質検証完了 (スコア: 100/100) - 問題なし
```

### 実装ファイル

| ファイル                             | 役割                                  | 主要関数/行番号                    |
| ------------------------------------ | ------------------------------------- | ---------------------------------- |
| `core/quality/type-checker.ts`       | TypeScript型チェック実行              | `runTypeCheck()` (34-88)           |
| `core/quality/type-checker.ts`       | IDE診断エラー取得（プレースホルダー） | `getIdeDiagnostics()` (15-27)      |
| `core/quality/edit-validator.ts`     | 型エラー検出時の通知生成              | `main()` (529-541)                 |
| `src/types/hooks/edit-validation.ts` | TypeCheckResult型定義                 | `TypeCheckResult`, `IdeDiagnostic` |

### Fail-Safe原則

- **エラー検出後も処理継続**: `continue: true`で開発フローを妨げない
- **即座通知**: Claude AIがエラー内容を即座に認識し、修正提案可能
- **開発フロー中断なし**: 通知のみで開発を妨げない設計
- **5件まで表示**: エラーが5件を超える場合は省略表示で可読性維持

## 📝 新しいHookの追加

### 1. 適切な層を選択

- **エントリーポイントのみ**: `hooks/` ディレクトリ
- **ビジネスロジック**: `core/` ディレクトリの適切なドメイン配下
- **汎用ユーティリティ**: `lib/` ディレクトリの適切なカテゴリ配下
- **スタンドアローンツール**: `cli/` ディレクトリ

### 2. Hook実装時の必須要件

- **$CLAUDE_TOOL_INPUT**: 必ず引数として受け取る（`\\\"$CLAUDE_TOOL_INPUT\\\"`）
- **戻り値**: Claude Code Hook仕様に準拠したJSON応答オブジェクトを返す
- **型定義**: `Promise<any>`として戻り値を定義
- **応答形式**: `{continue: boolean, systemMessage: string, suppressOutput: boolean}`
- **ログ出力**: `logHookExecution()`を使用した統一ログ

```typescript
import { logHookExecution } from "../../lib/logging/hook-logger.js";

async function main(): Promise<any> {
  // $CLAUDE_TOOL_INPUT を取得
  const toolInput = process.argv[2] || "{}";

  logHookExecution("PostToolUse", "HOOK-START", "処理開始");

  const hookResponse = {
    continue: true, // 処理継続の場合はtrue
    systemMessage: "Claude CLIへのメッセージ",
    suppressOutput: false,
  };

  logHookExecution("PostToolUse", "HOOK-COMPLETE", "処理完了");
  console.log(JSON.stringify(hookResponse));
  return hookResponse;
}
```

### 3. settings.jsonへの登録

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsx .claude/scripts/hooks/post-tool-use/new-hook.ts \\\"$CLAUDE_TOOL_INPUT\\\"",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

## 🚨 重要な注意事項

### Claude Code Hook仕様の厳守

- **$CLAUDE_TOOL_INPUT**: 必ず引数として渡す（忘れるとフックが実行されない）
- **戻り値**: 必ずJSON応答オブジェクトを戻り値として返す（`return hookResponse;`）
- **応答形式**: `{continue, systemMessage, suppressOutput}`の形式を厳守
- **ログ出力**: `logHookExecution()`を使用した統一ログ形式

### Fail-Safe原則

- エラー検出時も`continue: true`で処理継続
- 通知のみで開発フローを妨げない
- システムエラー時も確実に動作

### セキュリティ

- Hookは強力な機能のため、悪意のあるコードを含まないよう注意
- 外部コマンド実行時は適切なエスケープを実施

### パフォーマンス

- Hookは開発フローに影響するため、実行時間を最小限に抑制
- タイムアウト設定を適切に設定

## 📊 監視・デバッグ

### Hook実行ログ

```bash
# PostToolUseログの確認
tail -f .claude/output/logs/posttooluse-$(date +%Y-%m-%d).log

# 型エラー検出の確認
tail -f .claude/output/logs/posttooluse-$(date +%Y-%m-%d).log | grep EDIT-VALIDATOR
```

### Hook設定の検証

```bash
# 設定の妥当性確認
npx tsx .claude/scripts/lib/config/validate-settings.ts

# 全8フックの設定確認
npm run claude:validate
```

### 自動テスト実行

```bash
# PreToolUseフックテスト
npm run claude:test:hooks:pre

# PostToolUseフックテスト
npm run claude:test:hooks:post
```

## 🤝 開発チーム向けガイドライン

1. **Hook追加時**: 必ずREADME.md を更新
2. **設定変更時**: 変更前後で validate-settings.ts を実行
3. **デバッグ時**: ログファイルを確認
4. **アーキテクチャ遵守**: 適切な層（hooks/core/lib/cli）に配置
5. **$CLAUDE_TOOL_INPUT**: 必ず引数として渡す（settings.json）
6. **ログ出力**: `logHookExecution()`を使用

## 🎯 設計原則のまとめ

- **関心の分離**: エントリーポイント、ビジネスロジック、ユーティリティ、CLIツールを明確に分離
- **再利用性**: core/とlib/は他のスクリプトから参照可能
- **保守性**: ドメイン別にファイルを整理
- **拡張性**: 新しいHookやスクリプト追加が容易
- **Fail-Safe**: エラー時も処理を継続する設計

---

**関連ドキュメント**:

- プロジェクトメモリ: `/CLAUDE.md`
- Hook通知システム: `./.claude/scripts/hooks/documentation/hook-notification-system.md`
- 開発ルール: `@docs/rules/development/`
- 型エラー自動検出: PostToolUse(Edit)フックに統合済み
