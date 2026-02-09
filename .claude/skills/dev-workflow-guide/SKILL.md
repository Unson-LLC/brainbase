---
name: dev-workflow-guide
description: "開発ツール/運用統合ガイド（7 Skills統合版）。Git運用・CI/CD管理・Design-to-Code・Claude Code活用・ワークフロー検証・Worktree管理・CI/CD認証を統合。開発フローは story-arch-spec-code を優先し、本Skillは各ツール/運用の参照に限定する。"
---

**バージョン**: v3.0（7 Skills統合版）
**実装日**: 2025-12-30（v2.0）、2025-12-30（v3.0）
**統合済みSkills**: 7個（git-commit-rules, github-actions-management, cursor-design-to-code, claude-code-patterns, test-workflow-validator, branch-worktree-rules, code-cicd-auth）
**統合後サイズ**: 約1,300行 ✅ OPTIMAL範囲（1000-3000行）

---

## Triggers

以下の状況で使用：
- Gitコミットメッセージのフォーマットを確認したいとき
- GitHub Actionsワークフローを作成・変更するとき
- CursorでDesign-to-Codeを素早く実現したいとき
- Claude Code Hooksを設定・運用したいとき
- プロジェクトワークフロー（タスク・マイルストーン）の整合性を検証したいとき
- Worktree作成時のシンボリックリンク設定を確認したいとき
- ファイル配置先（_codex/ vs プロジェクトリポジトリ）を判断したいとき
- Claude CodeをCI/CD環境で動かしたいとき（setup-token認証）
- タスク開始前に該当Skillを確認したいとき（Skill Trigger Index）

---

## 統合の意図

**Before（5個のSkills分散）**:
- ❌ Git運用・CI/CD・Design-to-Code・Claude Code・ワークフロー検証が別ファイルに散在
- ❌ 開発プロセス全体の流れが見えにくい
- ❌ ツール横断の知識が分断

**After（dev-workflow-guide統合）**:
- ✅ 1ファイル内で開発ツール/運用を参照
- ✅ 5セクション構造で各領域を網羅
- ✅ メンテナンスコスト-70%

**注記**: 開発フロー（Story→Architecture→Spec→TDD→Code）は `story-arch-spec-code` を正本とする。

---

## 統合Skills一覧

| Skill名 | 行数 | 統合先セクション | 主要テーマ |
|---------|------|-----------------|-----------|
| git-commit-rules | 142行 | § 1 | Gitコミットルール、type一覧、HEREDOC形式 |
| github-actions-management | 53行 | § 2 | GitHub Actions管理、scheduled-jobs.md更新 |
| cursor-design-to-code | 50行 | § 3 | Cursor Planning mode、Design-to-Code手法 |
| claude-code-patterns | 286行 | § 4 | Hooks設定、@path記法、学習管理 |
| test-workflow-validator | 465行 | § 5 | ワークフロー検証Orchestrator、2 Phase |
| branch-worktree-rules | 320行 | § 6 | Worktree管理、シンボリックリンク方式、ファイル配置 |
| code-cicd-auth | 200行 | § 7 | Claude Code CI/CD認証、setup-token、GitHub Actions |

---

# § 1. Git Workflow (Commit Rules)

## 1.1 コミットメッセージフォーマット

```
<type>: <summary>（日本語可、50文字以内）

<why>
- なぜこの変更をしたのか（会話の文脈から）
- 何を達成しようとしていたのか

<what>（変更が多い場合のみ）
- 主な変更点1
- 主な変更点2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## 1.2 type一覧

| type | 用途 |
|------|------|
| `feat` | 新機能・新規追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `refactor` | リファクタリング（機能変更なし） |
| `chore` | ビルド・設定・運用系の変更 |
| `style` | フォーマット変更（機能に影響なし） |

---

## 1.3 コミット頻度

- **小さく・こまめに**（1つの論理的変更 = 1コミット）
- 大きな変更は分割してコミット
- タスクに紐づく場合はタスクIDを含める（推奨、例: `[TECHKNIGHT-HP-SALES]`）

---

## 1.4 コミット実行コマンド

HEREDOCを使用してフォーマットを保持：

```bash
git commit -m "$(cat <<'EOF'
<type>: <summary>

なぜ:
- 理由1
- 理由2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## 1.5 禁止事項

- `git commit --amend` は原則禁止（pre-commit hook修正後のみ許可）
- `--no-verify`, `--no-gpg-sign` はユーザー明示要求時のみ
- mainへの直接push禁止（セッション内作業時）
- 秘密情報（.env, credentials.json等）のコミット禁止

---

## 1.6 コミット例

### 例1: 機能追加

```
feat: ユーザー認証機能を追加

なぜ:
- セキュリティ要件への対応
- マルチテナント対応の準備

変更:
- auth/middleware.ts 追加
- pages/login.tsx 追加

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 例2: ドキュメント更新

```
docs: プロジェクトファイルをproject.mdに統合

なぜ:
- MCP Serverでコンテキスト自動ロードするため
- 01-05の分散管理より1ファイルの方が扱いやすい

変更:
- 13プロジェクトのproject.md作成
- architecture_map.mdに新構造を反映

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### 例3: バグ修正

```
fix: ログイン時のセッション切れを修正

なぜ:
- ユーザーから「5分でログアウトされる」との報告
- トークン更新ロジックの不具合

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## 1.7 Version Management

### セマンティックバージョニング

brainbaseプロジェクトは `0.MINOR.PATCH` 形式を採用：

| 変更タイプ | バージョン更新 | 対象コミットtype |
|-----------|---------------|-----------------|
| **MINOR**: 新機能追加 | 0.1.0 → 0.2.0 | `feat`, `refactor`（機能変更を伴う） |
| **PATCH**: バグ修正・改善 | 0.1.85 → 0.1.86 | `fix`, `chore`, `style`, `docs` |

---

### バージョン更新のタイミング

**重要**: brainbaseではバージョン番号がUI表示されるため、**コードの一部として扱う**

**推奨フロー（同じPR内で別コミット）**:

```
session/* ブランチで開発
  ↓
コミット1: fix(mobile): モバイルUI修正
  ↓
コミット2: chore: bump version to 0.1.X
  ↓
PR作成・マージ（2コミット含む）
```

**理由**:
- バージョン番号はUIに表示される = コードの一部
- 機能修正とバージョン更新を別PRにすると無駄なPRが増える
- 同じPR内で別コミットにすることで、履歴が明確になる

---

### 更新対象ファイル

バージョン更新時は以下の2ファイルを同時に更新：

1. **package.json**
   ```json
   "version": "0.1.86"
   ```

2. **public/index.html** (2箇所)
   ```html
   <!-- デスクトップ表示 -->
   <h3 id="app-version" class="app-version">v0.1.86</h3>

   <!-- モバイル表示 -->
   <h3 id="mobile-app-version" class="mobile-version-display">v0.1.86</h3>
   ```

---

### コミット例

```bash
# 機能修正コミット
git add public/style.css
git commit -m "fix(mobile): モバイルUI 黒い隙間を修正

なぜ:
- キーボード表示時に黒い隙間が発生
- flexレイアウトに高さ計算を任せる

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# バージョン更新コミット
git add package.json public/index.html
git commit -m "chore: bump version to 0.1.86

なぜ:
- モバイルUI黒い隙間修正のリリース

変更:
- package.json: 0.1.85 → 0.1.86
- public/index.html: v0.1.85 → v0.1.86 (2箇所)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### 別の選択肢（非推奨）

**Option A: 機能修正と同じコミット**
```bash
git add public/style.css package.json public/index.html
git commit -m "fix(mobile): モバイルUI修正 (v0.1.86)"
```
- デメリット: コミットが大きくなる、履歴が不明確

**Option C: PRマージ後に別PR**
```
PR #21: fix(mobile): モバイルUI修正
PR #22: chore: bump version to 0.1.86
```
- デメリット: 無駄なPRが増える、バージョンが遅れる

---

# § 2. CI/CD (GitHub Actions Management)

## 2.1 概要

GitHub Actionsワークフローを作成・変更した際の管理ルール。

---

## 2.2 必須アクション

### ワークフロー作成時

1. **管理ドキュメントを更新**: `_codex/common/ops/scheduled-jobs.md`
   - スケジュール実行の場合: 「スケジュール実行」テーブルに追加
   - イベントトリガーの場合: 「イベントトリガー実行」テーブルに追加
   - 必要なSecretsがあれば「必要なSecrets」セクションに追加

2. **ランナー選択基準**:
   - `ubuntu-latest`（クラウド）: 外部API呼び出しのみで完結するジョブ
   - `[self-hosted, local]`（セルフホスト）: ローカルファイルアクセスが必要なジョブ

---

## 2.3 記載項目

| 項目 | 内容 |
|------|------|
| ジョブ名 | わかりやすい日本語名 |
| スケジュール | JST表記（例: 毎日 21:00 JST） |
| 目的 | 何をするか簡潔に |
| ワークフロー | `.github/workflows/xxx.yml` |
| ランナー | ubuntu-latest または self-hosted |

---

## 2.4 ローカルファースト検証原則（最重要）

### 基本ルール

**必須厳守**: ローカルで実行可能なものは必ずローカルで確認してからCIで実行する

1. **ローカルで実行可能なものは必ずローカルで確認**
   - スクリプト実行
   - テスト実行
   - ビルド確認
   - 環境変数設定

2. **CI専用の確認のみCIを使う**
   - サービスコンテナ（PostgreSQL、Redis等）が必要なもの
   - マトリックスビルド（複数Node.jsバージョン等）
   - 環境特有の問題（GitHub Actionsランナー環境）

3. **段階的検証**: スクリプト単体 → ローカル統合 → CI統合

---

### CI専用の確認とは

以下の場合のみCI上での確認が許容される：

- **サービスコンテナ必須**: GitHub Actions PostgreSQL/Redisコンテナでの動作確認
- **マトリックスビルド**: 複数Node.jsバージョンでの互換性確認
- **環境特有問題**: GitHub Actionsランナー固有の問題調査

---

### ローカルで確認すべきもの

**以下は必ずローカル確認必須**:

- ✅ データベースseedスクリプト（`npx tsx prisma/seed-*.ts`）
- ✅ E2Eテスト実行（`npm run test:e2e:basic`）
- ✅ ビルド成功確認（`npm run build`）
- ✅ 環境変数設定（`.env.test`等）
- ✅ 新規スクリプトの動作確認

---

### 違反例と正しい例

#### ❌ 違反例（CI資源の浪費）

```bash
# 1. コードを読んで「これで動くはず」と推測
# 2. いきなりCIワークフローに追加してプッシュ
git add .github/workflows/e2e-nocodb-integration.yml
git commit -m "fix: seed処理を追加"
git push

# 3. CI上で動作確認（15分 × 複数回 = 資源浪費）
# - 1回目: seed-plans.ts が動かない → 修正 → push
# - 2回目: seed-user.ts が動かない → 修正 → push
# - 3回目: やっと成功
```

**問題点**:
- ローカル確認なしでCI投入
- 1回の確認に15分 × 複数回
- CI資源の無駄遣い

---

#### ✅ 正しい例（段階的検証）

```bash
# 1. ローカルでスクリプト単体確認
npx tsx prisma/seed-plans.ts
# → Plans作成確認（数秒）

# 2. ローカルで次のスクリプト確認
npx tsx prisma/seed-user.ts
# → test1@example.com作成確認（数秒）

# 3. ローカルでE2Eテスト実行
npm run test:e2e:basic
# → 認証成功確認（数分）

# 4. 全て成功を確認してからCIに統合
git add .github/workflows/e2e-nocodb-integration.yml
git commit -m "fix: seed処理を追加（ローカル確認済み）"
git push

# 5. CI上で最終確認（1回で成功）
```

**メリット**:
- ローカル確認は数秒〜数分
- CIは最終確認のみ（1回で成功）
- CI資源の効率的利用

---

### 例外ケース

以下の場合のみ、ローカル確認をスキップしてCI直接確認が許容される：

1. **サービスコンテナ依存**: ローカルにPostgreSQL/Redisがない場合
2. **GitHub Actions固有**: Actions専用機能（matrix、secrets等）の確認
3. **緊急対応**: Hotfix等で時間的制約がある場合（事後にローカル検証必須）

---

## 2.5 参照

- 管理ドキュメント: `_codex/common/ops/scheduled-jobs.md`
- ワークフロー置き場: `.github/workflows/`
- セルフホストランナー設定: `~/actions-runner/`

---

## 2.6 例

```markdown
| mana日次処理 | 毎日 21:00 JST | Airtableスプリントに日次ログ追記 | `.github/workflows/mana-daily.yml` | ubuntu-latest |
```

---

# § 3. Design-to-Code (Cursor Planning Mode)

## 3.1 核心ポイント

- **Planningモードで先に設計を書く**: コードを書かせる前に「仕様案」をAIに書かせる。Markdownの計画が生成される → 人が修正 → Build でコード生成
- **曖昧な依頼ほどPlanningモード**: AIが質問やTODOを自動で出す。仕様粒度が上がるほど一発で目的のUI/機能が出る
- **ライブ状態でプロトタイピング**: FigmaなしでCursor上でUIを動かしながら調整。デザイナーが直接コードを触ることでピクセルずれの往復を削減
- **テンプレ＋テーマをAIに流用**: Shadcn等の既存UIコンポーネント＋テーマ調整で再現性とアクセシビリティを担保
- **役割の境界を薄くする**: PM/Design/Engが同じCursor空間で計画→実装→テストまで回す
- **短いループを複数並列**: ローカルのメインAgentで大きな変更、背景で小タスクAgentを走らせる
- **仕様は"死んでいない"**: モデル精度が上がるほど、良い仕様を書けば良い実装が返る。チャット一発より「計画→レビュー→Build」の方が品質が安定

---

## 3.2 推奨ワークフロー

1. **Planningモード起動**: 曖昧な要望を投げ、AIに仕様ドラフトを書かせる（コードはまだ生成させない）
2. **編集・追記**: 要求・非機能・UIテーマ・依存・テスト観点を人が追記。アイコン/アセットは placeholder 指定でOK
3. **Build実行**: ドラフトが十分なら Build。差分を確認し、必要ならプロンプトに変更点を追記して再Build
4. **ローカル確認**: ブラウザプレビューでUXとアクセシビリティをチェック。軽微修正は直接編集、またはAgentに「このdiffを適用して」と指示
5. **並列小タスク**: 文言修正・軽微バグはバックグラウンドAgentに投げる。完了通知をSlack/一覧で受け取る
6. **テスト/ログ確認**: エラーやconsoleログはAIに要約させ、原因候補とfix案をもらう

---

## 3.3 UI検証（Chrome DevTools MCP活用）

Design-to-Codeで生成したUIの品質を、Chrome DevTools MCPで自動検証：

### ビジュアル確認

**スクリーンショット取得でデザイン意図との乖離を検出**:
```bash
# ページ全体のスクリーンショット
take_screenshot()

# 特定要素のスクリーンショット
take_screenshot({ uid: 'header-component' })

# レスポンシブチェック（複数ブレークポイント）
resize_page({ width: 375, height: 667 })  # Mobile
take_screenshot()
resize_page({ width: 1920, height: 1080 })  # Desktop
take_screenshot()
```

**アクセシビリティツリーでARIA構造を検証**:
```bash
# ページ構造をテキストで取得
take_snapshot()
# → heading, button, link等の要素とARIA属性を確認
```

### パフォーマンス計測

**Core Web Vitals測定**:
```bash
# パフォーマンストレース開始
performance_start_trace({ reload: true, autoStop: true })

# トレース停止・分析
performance_stop_trace()
# → LCP, FID, CLS等のメトリクスを取得
```

### コンソールログ確認

**JavaScriptエラー・警告・アクセシビリティissueの検出**:
```bash
# 全コンソールメッセージ取得
list_console_messages()

# エラーのみフィルタ
list_console_messages({ types: ['error'] })

# アクセシビリティissueの確認
list_console_messages({ types: ['issue'] })
```

### 実行例

```bash
# UI検証フロー（Claude Codeで実行）
claude "localhost:31013を開いてスクリーンショット取得"
claude "コンソールログを取得してエラーがないか確認"
claude "パフォーマンストレース実行してLCPを計測"
```

### Cursorとの連携

1. **Cursor Planning mode**でUI設計
2. **Cursor Build**でコード生成
3. **ローカルサーバー起動**（`npm run dev`）
4. **Claude Code + Chrome DevTools MCP**でUI検証
5. 問題があれば**Cursorに戻ってfix**

---

## 3.4 プロンプトスニペット

- **Planning開始**: `Enable planning mode. Do not write code yet. Produce a markdown plan with requirements, UI, data, steps, tests.`
- **仕様更新**: `Add constraints: use shadcn/ui, theme = XP-like retro, placeholder icon from /icons.`
- **Build前チェック**: `If plan is coherent, proceed to build. Otherwise ask clarifying questions first.`

---

## 3.5 デザイナー向けTips

- **小さく始める**: ライトな機能（電卓・簡易フォーム）で流れを掴む。Figmaから始めずCursor内で触る
- **テーマはAIに塗らせる**: 既存CSSトークンを指定し、"respect existing CSS variables" を明示
- **恐れずエラーを投げる**: `fix the build error shown in terminal` と丸投げし、解説も要求する

---

## 3.6 注意点

- 並列Agentで同じファイルを触らせると衝突リスク。ワークツリー/ブランチを分けるか順次実行
- アクセシビリティとテストは人が確認：AI生成後にコントラスト/フォーカス/ARIAを目視チェック
- 大規模変更はPlanning→レビュー→Buildの3段階を守る（直接チャット一発生成は避ける）

---

# § 4. Claude Code Patterns

## 4.1 Hooks設定

### JSON形式は必ず `{"hooks": {...}}` のネスト構造で記述する

**問題**: hooks設定をトップレベルに直接書くと動作しない

```json
❌ 誤った例
{
  "sessionStart": {...},
  "userPromptSubmit": {...}
}
```

```json
✅ 正しい例
{
  "hooks": {
    "sessionStart": {...},
    "userPromptSubmit": {...}
  }
}
```

**原因**: Claude Codeの設定パーサーは `hooks` キーの存在を前提としている

**確認方法**:
```bash
cat ~/.config/claude-code/settings.json | jq '.hooks'
```

---

## 4.2 Stopトリガーの発火タイミング

### Stopトリガーは「エージェントの応答完了時のみ」発火する

**重要**: ユーザーによる中断（Ctrl+C等）では発火しない

**発火するケース**:
- エージェントが応答を完了した直後
- エラーなく正常終了した時

**発火しないケース**:
- ユーザーがCtrl+Cで中断した時
- セッションがクラッシュした時
- タイムアウトで強制終了した時

**適した用途**:
- 応答完了後のクリーンアップ
- セッション統計の記録
- 完了通知の送信

**不適切な用途**:
- 必ず実行されるべきクリーンアップ（→ sessionEnd推奨）
- 中断時の状態保存（→ 別の仕組みが必要）

---

## 4.3 デバッグとトラブルシューティング

### Hooksが動作しない時の確認手順

1. **設定ファイルの構文チェック**
   ```bash
   cat ~/.config/claude-code/settings.json | jq .
   ```
   エラーが出る場合はJSON構文エラー

2. **hooks キーの存在確認**
   ```bash
   cat ~/.config/claude-code/settings.json | jq '.hooks'
   ```
   `null` が返る場合は設定形式が誤っている

3. **コマンドの実行権限確認**
   ```bash
   bash /path/to/hook-script.sh
   ```

4. **ログの確認**
   Hooksの実行ログは Claude Code のセッションログに出力される

---

## 4.4 よくあるエラーパターン

| エラー症状 | 原因 | 解決策 |
|-----------|------|--------|
| Hooksが全く動作しない | `{"hooks": {...}}` 形式になっていない | ネスト構造に修正 |
| Stopが発火しない | ユーザーが中断している | sessionEndトリガーを検討 |
| スクリプトがエラーになる | パスが相対パス | 絶対パスに変更 |
| 環境変数が使えない | シェルの初期化が不完全 | スクリプト内で明示的にsource |

---

## 4.5 実践的なHooks設定例

### セッション開始時の環境チェック

```json
{
  "hooks": {
    "sessionStart": {
      "command": "~/.config/claude-code/hooks/check-environment.sh",
      "showOutput": true
    }
  }
}
```

### 応答完了後の統計記録

```json
{
  "hooks": {
    "stop": {
      "command": "echo \"Session completed: $(date)\" >> ~/claude-sessions.log",
      "showOutput": false
    }
  }
}
```

### 複数のトリガーを組み合わせた構成

```json
{
  "hooks": {
    "sessionStart": {
      "command": "/path/to/startup-check.sh",
      "showOutput": true
    },
    "userPromptSubmit": {
      "command": "/path/to/log-prompt.sh",
      "showOutput": false
    },
    "stop": {
      "command": "/path/to/cleanup.sh",
      "showOutput": false
    }
  }
}
```

---

## 4.6 @path記法による動的ファイル参照

Claude Codeでファイルの内容を直接プロンプトとして読み込む記法：

```
@/path/to/file
```

**使用例**:
```bash
# カスタムコマンドの内容を直接実行
claude @/Users/ksato/workspace/.claude/commands/commit.md

# 複数ファイルの組み合わせ
claude @/path/to/context.md "上記を踏まえて実装してください"
```

**メリット**:
- プロンプトの外部ファイル化で管理が容易
- 長大な指示を再利用可能
- バージョン管理が可能

**注意点**:
- ファイルパスは絶対パスを推奨
- ファイルが存在しない場合はエラー

---

## 4.7 JSON形式のみで出力させる方法

説明文やマークダウンを除き、JSONペイロードのみを返させる指示：

```
以下の内容をJSONのみで出力してください。説明文は不要です。

{...}
```

**効果**:
- 機械処理が容易（パースエラーを防ぐ）
- 後処理の標準化
- スクリプトでの自動処理に最適

**使用例**:
```bash
# 学習候補をJSON形式で抽出
claude "以下のセッションから学習内容を抽出し、JSONのみで出力してください"
```

**注意点**:
- プロンプトで明確に「JSONのみ」と指示する
- Claude Codeの出力形式制御と組み合わせる

---

## 4.8 学習管理パターン

### JSON構造化による学習の管理

学習内容を以下のJSON形式で構造化：

```json
{
  "title": "学習タイトル",
  "category": "workflow | architecture | gotcha | ...",
  "content": "学習内容の詳細",
  "tags": ["tag1", "tag2"],
  "confidence": 0.95
}
```

**メリット**:
- 機械処理可能な形式
- 学習の再利用性・検索性向上
- 集約・分析が容易

**運用フロー**:
1. セッション終了時に学習内容を抽出
2. JSON形式で構造化
3. `.claude/learning/learning_queue/` に保存
4. `/learn-skills` で確認・適用

---

## 4.9 信頼度スコア（confidence）による品質評価

学習内容の信頼度を0.0〜1.0のスコアで評価：

| 信頼度 | 基準 |
|--------|------|
| 0.95〜 | 検証済みのベストプラクティス |
| 0.8〜0.94 | 実践的な学習内容 |
| 0.5〜0.79 | 参考情報 |
| 〜0.49 | 未検証・要確認 |

**使用例**:
```bash
# 信頼度0.8以上の学習候補を抽出
jq '.confidence >= 0.8' learning_queue/*.json
```

---

## 4.10 Gotchaと教訓

### Web調査の重要性

**事例**: Skillsとカスタムコマンドの作り方について、最初は誤った方法を提案

**教訓**: 実装方法が不確かな場合は必ずWebで確認する

**対策**:
- 公式ドキュメントを第一に参照
- 実装例を複数確認
- コミュニティのベストプラクティスを調査

---

# § 5. Workflow Validation (test-workflow-validator)

## 5.1 概要

**Purpose**: プロジェクトの既存ワークフロー（タスク、マイルストーン）を調査し、brainbase標準プロセスとの整合性をチェックするOrchestrator

**Why this exists**:
- プロジェクトの現状を客観的に把握するため
- brainbase標準（task-format, milestone-management）との乖離を定量化するため
- 課題リストと改善提案を自動生成するため

---

## 5.2 Orchestrator構造（2 Phase）

**Phase 1: 要件分析（phase1_requirements_analysis）**:
- プロジェクトのタスク・マイルストーン情報を収集
- task-format Skillに基づいてタスクフォーマット適合率を算出
- milestone-management Skillに基づいてマイルストーン粒度を評価
- 課題リストと整合性チェック結果をmarkdown見出し構造で出力

**Phase 2: 検証レポート生成（phase2_report_generation）**:
- Phase 1の課題リストと適合率を受け取る
- 推奨アクション生成と優先度付けを実施
- 最終レポートを生成

---

## 5.3 Phase 1: 要件分析の実行内容

### Step 1: プロジェクト情報の収集

**実行内容**:
```bash
# 1. プロジェクトディレクトリの存在確認
Read _codex/projects/{project}/

# 2. タスクファイルの検索
Grep pattern:"^\\-\\s*\\[" path:_tasks/index.md

# 3. マイルストーンファイルの検索
Grep pattern:"^##\\s*Milestone" path:_codex/projects/{project}/
```

**抽出する情報**:
- タスク総数
- YAML front matter形式のタスク数
- マイルストーン総数
- 各マイルストーンの期間スパン

**思考パターン適用**:
- task-formatの「YAML front matter形式」を使用 → タスクフォーマット適合率を算出
- milestone-managementの「適切な粒度」を使用 → マイルストーン粒度の評価

---

### Step 2: 整合性チェックの実行

**実行内容**:
1. **タスクフォーマット適合率の算出**:
   - YAML front matter形式のタスク数 / タスク総数
   - 必須フィールド充足率

2. **マイルストーン粒度チェック**:
   - 1〜4週間スパンのマイルストーン数 / マイルストーン総数
   - Success Criteria明示率

3. **課題の特定**:
   - 適合率が80%未満の項目を課題としてリスト化
   - 重大度（Critical/Medium）を判定

**思考パターン適用**:
```
タスク適合率 < 80% → task-format違反 → Critical課題
マイルストーン粒度不適切 → milestone-management違反 → Medium課題
```

---

### Step 3: 課題リストと整合性チェック結果の出力

**ファイル構造**:
```markdown
# Phase 1 実行結果: 要件分析

**作成日**: 2025-12-30
**Phase**: 1/2

## 課題リスト
- 課題1: タスクフォーマット不整合（_tasks/index.md）
- 課題2: マイルストーン粒度が大きすぎる（3ヶ月スパン）
- 課題3: RACI定義が一部不明確

## 整合性チェック結果
- task-format適合率: 70%
- milestone-management適合率: 60%
- RACI充足率: 80%

---

**課題総数**: 3件
**次Phase**: Phase 2（検証レポート生成）
```

---

## 5.4 Phase 2: 検証レポート生成の実行内容

**Input**: Phase 1の課題リストと適合率

**Output**: 最終検証レポート（推奨アクション付き）

**実行内容**:
1. 課題の優先度付け（Critical → Medium → Low）
2. 各課題に対する推奨アクションの生成
3. 改善ロードマップの作成
4. 最終レポートの生成

**レポート構造**:
```markdown
# ワークフロー検証レポート

## Executive Summary
- 検証対象: {project}
- 検証日: 2025-12-30
- 総合評価: 改善の余地あり

## 課題と推奨アクション

### Critical課題
- 課題1: タスクフォーマット不整合
  - 推奨アクション: YAML front matter形式への移行
  - 期待効果: タスク管理の一元化、検索性向上

### Medium課題
- 課題2: マイルストーン粒度が大きすぎる
  - 推奨アクション: 1〜4週間スパンへの分割
  - 期待効果: 進捗可視化の向上

## 改善ロードマップ
1. Week 1-2: タスクフォーマット移行
2. Week 3-4: マイルストーン再設計
3. Week 5-6: RACI定義の明確化
```

---

## 5.5 Success Criteria

Phase 1の成功条件：
- [ ] 課題が具体的に特定されている（最低3件）
- [ ] task-format適合率が算出されている
- [ ] milestone-management適合率が算出されている
- [ ] markdown見出し構造が正しい（`## 課題リスト`, `## 整合性チェック結果`）
- [ ] 引き継ぎデータが明記されている（課題総数、適合率）

**検証方法**:
1. 課題リストが3件以上存在するか確認
2. 適合率が%形式で記載されているか確認
3. markdown見出し構造がPhase 2の期待形式と一致するか確認

---

## 5.6 実行方法

**Skillとして実行**:
```bash
# Orchestratorとして実行
/test-workflow-validator
```

**手動でPhaseを実行**:
```bash
# Phase 1のみ実行
Task tool with phase1_requirements_analysis agent

# Phase 2のみ実行（Phase 1の結果が必要）
Task tool with phase2_report_generation agent
```

---

## 5.7 Troubleshooting

### プロジェクトディレクトリが見つからない

**原因**:
- プロジェクト名が不正
- _codex/projects/ 配下にディレクトリが存在しない

**対処**:
1. プロジェクト名を確認（brainbase-ui, mana等）
2. _codex/projects/ 配下のディレクトリ構造を確認
3. 正しいプロジェクト名で再実行

**Example**:
```bash
# プロジェクト一覧確認
ls _codex/projects/
# → brainbase-ui/ mana/ etc.
```

---

### タスクファイルが存在しない

**原因**:
- _tasks/index.md が存在しない
- プロジェクト固有のタスクファイルが未作成

**対処**:
- _tasks/index.md を作成
- task-format Skillに基づいてYAML front matter形式で記述

**Fallback**:
- タスクファイルが存在しない場合は、task-format適合率を0%として報告

---

## 5.8 E2Eテスト自動化（Chrome DevTools MCP）

**目的**: Critical User Flowsの自動検証・デバッグ

**Why this exists**:
- Playwrightの軽量代替として、開発中のクイック検証に最適
- CI/CDでの軽量E2Eチェック
- デバッグ・トラブルシューティングに特化

---

### テスト対象

**Critical User Flows**:
- ユーザー登録フロー（入力 → 送信 → 確認）
- セッション作成フロー（新規 → 編集 → 保存）
- タスク管理フロー（追加 → 完了 → アーカイブ）

---

### 実行方法

**基本フロー**:
```javascript
// 1. ページナビゲーション
navigate_page({ type: 'url', url: 'http://localhost:31013' })

// 2. ページ構造確認
take_snapshot()  // → uid付きで要素を確認

// 3. フォーム入力
fill({ uid: '1_15', value: 'test@example.com' })  // email input
fill({ uid: '1_20', value: 'password123' })        // password input

// 4. ボタンクリック
click({ uid: '1_25' })  // submit button

// 5. 結果検証
take_snapshot()  // → ログイン後のページ構造を確認
list_console_messages({ types: ['error'] })  // → エラーがないか確認
```

**スクリーンショット比較**:
```javascript
// Before
take_screenshot({ filePath: '/tmp/before.png' })

// 操作実行
click({ uid: '1_10' })

// After
take_screenshot({ filePath: '/tmp/after.png' })
// → 手動またはツールで差分確認
```

---

### Playwrightとの使い分け

| ツール | 用途 | 実行環境 | 並列実行 |
|--------|------|---------|---------|
| **Playwright** | 複雑なシナリオ・クロスブラウザ・大規模E2E | CI/CD | ✅ |
| **Chrome DevTools MCP** | シンプルなフロー・デバッグ・クイック検証 | CLI・開発環境 | ❌ |

**使い分けの基準**:
```
複雑なシナリオ（複数ページ遷移・認証フロー） → Playwright
シンプルな検証（単一ページ・コンソール確認） → Chrome DevTools MCP
クロスブラウザテスト → Playwright
デバッグ・トラブルシューティング → Chrome DevTools MCP
CI/CDでの大規模テスト → Playwright
開発中のクイック検証 → Chrome DevTools MCP
```

---

### 実行例（CLI）

**開発中のクイック検証**:
```bash
# スクリーンショット取得
claude "localhost:31013を開いてスクリーンショット取得"

# コンソールエラー確認
claude "localhost:31013を開いてコンソールログのエラーを確認"

# フォーム送信テスト
claude "localhost:31013のログインフォームにtest@example.comとpassword123を入力して送信、結果を確認"
```

**CI/CDでの軽量E2Eチェック**:
```yaml
# .github/workflows/quick-e2e-check.yml
- name: Quick E2E Check
  run: |
    npm run dev &
    sleep 5
    echo "localhost:31013を開いてコンソールエラーがないか確認" | claude --print
```

---

### デバッグワークフロー

**問題発生時の調査手順**:
1. **スナップショット取得** → ページ構造確認
2. **コンソールログ確認** → JavaScriptエラー検出
3. **ネットワークリクエスト確認** → API呼び出しの失敗を検出
4. **パフォーマンストレース** → ロード時間・リソース使用量を計測

**実行例**:
```bash
# 1. スナップショット
take_snapshot()

# 2. コンソールログ
list_console_messages()

# 3. ネットワークリクエスト
list_network_requests({ resourceTypes: ['fetch', 'xhr'] })

# 4. パフォーマンストレース
performance_start_trace({ reload: true, autoStop: true })
performance_stop_trace()
```

---

### Best Practices

1. **Playwrightと併用** - 複雑なシナリオはPlaywright、クイック検証はChrome DevTools MCP
2. **CI/CDで使い分け** - PRマージ前はPlaywright、開発中はChrome DevTools MCP
3. **デバッグに活用** - テスト失敗時の原因調査にChrome DevTools MCPを使用
4. **スクリーンショット記録** - 視覚的な変更の履歴を残す

---

# § 6. Branch & Worktree Management

## 6.1 基本原則

**簡素化方針（優先）**:
- 複雑さはバグの温床。特殊処理より「普通のgitフロー」を優先する。
- **正本/非正本の区別を持ち込まず**、worktreeはworktreeとして扱う。
- **コミット先を1つに統一**し、認知負荷とミスを減らす。
- すべて **セッションブランチ → PRでmainマージ** を基本とする。

### 6.1.1 レガシー運用（シンボリックリンク方式）

**ファイルの性質によってコミット先を分離する（旧方式）:**

| ファイル種別 | 性質 | コミット先 |
|-------------|------|------------|
| 正本ディレクトリ | 全セッションで共有 | main直接 |
| プロジェクトコード | ブランチごとに異なりうる | セッションブランチ |

---

## 6.2 正本ディレクトリの定義

以下は「正本」として、全worktreeで共有される：

```
/Users/ksato/workspace/
├── shared/                    # 共有リソース
│   ├── _codex/               # ナレッジ正本（brainbase-codexサブモジュール）
│   ├── _tasks/               # タスク正本
│   ├── _inbox/               # 受信箱
│   ├── _schedules/           # スケジュール
│   └── .worktrees/           # worktree配置先
├── _ops/                      # 共通スクリプト
├── .claude/                   # Claude設定・Skills
└── config.yml                 # 設定ファイル
```

**正本の特徴:**
- 常に最新を全セッションで共有したい
- ブランチ分岐の対象ではない
- mainに直接コミットする（_codex/はbrainbase-codexサブモジュール）

---

## 6.3 Worktree構造（シンボリックリンク方式）

worktree作成時、正本ディレクトリはシンボリックリンクで正本パスを参照：

```
/Users/ksato/workspace/shared/.worktrees/session-xxx/
├── _codex -> /Users/ksato/workspace/shared/_codex         # シンボリックリンク
├── _tasks -> /Users/ksato/workspace/shared/_tasks         # シンボリックリンク
├── _inbox -> /Users/ksato/workspace/shared/_inbox         # シンボリックリンク
├── _schedules -> /Users/ksato/workspace/shared/_schedules # シンボリックリンク
├── _ops -> /Users/ksato/workspace/_ops
├── .claude -> /Users/ksato/workspace/.claude
├── config.yml -> /Users/ksato/workspace/config.yml
├── CLAUDE.md                                     # 実ファイル（各worktreeに存在）
├── brainbase-ui/                                # 実ファイル（ブランチローカル）
└── projects/                                    # 実ファイル（ブランチローカル）
```

**メリット:**
- どのworktreeからでも同じ正本を編集
- 正本の変更はmainに自動的に属する
- パス解決の混乱がない

**注意点 / Gotcha:**
- `create()` 内のシンボリックリンク作成処理は**削除しない**（正本参照に必須）。
- 削除できるのは **`fixSymlinks()` のエラーリカバリー機能のみ**。
- シンボリックリンク方式は `git status` が「削除」扱いになる**汚染問題**が発生しやすい。
  - この地雷は**シンボリックリンク方式の廃止**で解消される。

---

## 6.4 コミットフロー

### プロジェクトコード（セッションブランチ経由）

```
worktreeで編集 → セッションブランチにコミット → mainにマージ
```

```bash
# 現在のブランチを確認
git branch
# * session/session-XXXX

# コードの変更をコミット
git add brainbase-ui/
git commit -m "feat: 機能追加"

# アーカイブ時にmainにマージ
```

### 正本ファイル（main直接コミット）

```
worktreeで編集（シンボリックリンク経由）→ mainで直接コミット
```

```bash
# 正本ファイルを編集（シンボリックリンク経由で自動的に正本を編集）
vim _codex/projects/salestailor/project.md
vim .claude/skills/new-skill/SKILL.md

# mainに直接コミット
cd /Users/ksato/workspace
git add shared/_codex/ .claude/
git commit -m "docs: ナレッジ追加"

# _codex/がサブモジュールの場合は、サブモジュール側でもコミット
cd shared/_codex
git add .
git commit -m "docs: ナレッジ追加"
```

---

## 6.5 /merge コマンドの動作

セッション終了時の `/merge` コマンドは以下を実行：

1. **セッションブランチの変更確認**
   - プロジェクトコードの変更があればセッションブランチにコミット

2. **正本の変更確認**
   - 正本ディレクトリの変更があればmainに直接コミット
   - 「正本の変更をmainにコミットしますか？」と確認

3. **マージ実行**
   - セッションブランチをmainにマージ

---

## 6.6 Worktree作成時のセットアップ

brainbase-uiがworktree作成時に自動実行：

```bash
# worktree作成
git worktree add shared/.worktrees/session-xxx -b session/session-xxx

# シンボリックリンク作成
cd shared/.worktrees/session-xxx
rm -rf _codex _tasks _inbox _schedules _ops .claude config.yml
ln -s /Users/ksato/workspace/shared/_codex _codex
ln -s /Users/ksato/workspace/shared/_tasks _tasks
ln -s /Users/ksato/workspace/shared/_inbox _inbox
ln -s /Users/ksato/workspace/shared/_schedules _schedules
ln -s /Users/ksato/workspace/_ops _ops
ln -s /Users/ksato/workspace/.claude .claude
ln -s /Users/ksato/workspace/config.yml config.yml
```

---

## 6.7 ルールまとめ

| 状況 | 編集場所 | コミット先 |
|-----|---------|------------|
| Skills追加・更新 | worktree内（シンボリックリンク経由） | main直接 |
| タスク更新 | worktree内（シンボリックリンク経由） | main直接 |
| ナレッジ追加 | worktree内（シンボリックリンク経由） | main直接 |
| プロジェクトコード | worktree内（実ファイル） | セッションブランチ |

---

## 6.8 Worktree簡素化の移行方針（PR一本化）

**ドキュメント先行が基本**:
- 新フローは**ドキュメント改訂のみで即適用**できる。
- コード削除・クリーンアップは**後日対応でOK**。

**段階的移行（影響最小化）**:
1. 新規セッションから「PR一本化」フローを適用  
2. `branch-worktree-rules` / `merge.md` をPRモード一本化に統一  
3. 既存worktreeは順次クリーンアップ

**リスク許容の判断**:
- シンボリックリンク廃止後、正本変更の反映は**マージまで遅れる**。
- **重要変更は即マージ**すれば問題なし（競合はほぼ起きない前提）。

**狙い**:
- コミット先二重管理の**認知負荷を削減**
- 特殊処理（汚染検出/複雑マージ）を排除し、**普通のgitフロー**へ統一
| 設定ファイル変更 | worktree内（シンボリックリンク経由） | main直接 |

---

## 6.8 ファイル配置の判断フロー

新規ファイルを作成する際、**どこに配置すべきか**を判断するフローチャート：

### ステップ1: ファイルの性質を確認

**質問**: このファイルは誰がアクセスするか？

- **佐藤のみ** → `_codex/` へ進む
- **GM・関係者も** → プロジェクトリポジトリへ進む

---

### ステップ2: _codex/ に置く場合

`_codex/` は**運用ドキュメントの正本**であり、以下に該当する場合のみ使用：

**✅ _codex/ に置くべきもの:**
- 戦略・方針（01_strategy.md）
- 体制図・RACI定義
- KPI定義（数値目標の定義）
- 意思決定ログ
- 顧客情報（機密含む）
- 社内専用の運用ルール

**❌ _codex/ に置かないもの:**
- GM・メンバーと共有する資料
- 外部公開する資料（イベント登壇、ブログ記事等）
- 顧客向け納品物
- マーケティング資料

---

### ステップ3: プロジェクトリポジトリに置く場合

プロジェクトリポジトリ（例: `baao/`, `salestailor/`）の配置先：

| ディレクトリ | 用途 | 例 |
|-------------|------|-----|
| `docs/` | GM・関係者と共有する資料 | イベント資料、提案書テンプレート、FAQ |
| `app/` | アプリケーションコード | ソースコード、テスト |
| `meetings/` | 議事録 | 会議メモ、トランスクリプト |
| `drive/` | 共有ドライブ（シンボリックリンク） | 契約書、納品物、顧客資料 |

**判断基準:**

```
このファイルは...
├─ コードか？ → app/
├─ 会議の記録か？ → meetings/
├─ GM・関係者と共有するドキュメントか？ → docs/
└─ ファイルそのものを共有するか？ → drive/
```

---

### ステップ4: docs/ のサブディレクトリ構成

`docs/` に置く場合、さらに適切なサブディレクトリを選択：

| サブディレクトリ | 用途 | 例 |
|----------------|------|-----|
| `events/` | イベント関連資料 | 登壇スライド、ワークショップ資料 |
| `templates/` | 再利用可能なテンプレート | 提案書テンプレート、報告書フォーマット |
| `internal/` | 社内向け（外部非公開） | 運用マニュアル、オンボーディング資料 |
| `programs/` | プログラム別ドキュメント | 研修資料、カリキュラム |

---

## 6.9 よくある間違いと修正方法

### ❌ 間違い1: イベント資料を _codex/ に置く

**間違った配置:**
```
_codex/projects/baao/events/2025-12-21_ai-dojo/
```

**正しい配置:**
```
baao/docs/events/2025-12-21_ai-dojo/
```

**理由:**
- イベント資料 = 外部公開・GM共有
- `_codex/` = 佐藤のみアクセスする運用ドキュメント

---

### ❌ 間違い2: KPI実績を _codex/ に置く

**間違った配置:**
```
_codex/projects/salestailor/kpi_results.csv
```

**正しい配置:**
```
Airtable（実績トラッキング）
または salestailor/drive/reports/
```

**理由:**
- `_codex/` = KPI**定義**のみ
- KPI**実績** = Airtableまたは共有ドライブで管理

---

### ❌ 間違い3: コードを _codex/ に置く

**間違った配置:**
```
_codex/projects/baao/scripts/export.js
```

**正しい配置:**
```
baao/app/scripts/export.js
```

**理由:**
- コード = プロジェクトリポジトリの `app/` に配置
- `_codex/` = ドキュメントのみ

---

## 6.10 チェックリスト

新規ファイル作成前に以下を確認：

- [ ] このファイルは**佐藤のみ**がアクセスするか？ → YES なら `_codex/`
- [ ] このファイルは**GM・関係者と共有**するか？ → YES なら `<project>/docs/`
- [ ] このファイルは**コード**か？ → YES なら `<project>/app/`
- [ ] このファイルは**会議記録**か？ → YES なら `<project>/meetings/`
- [ ] このファイルは**共有ドライブで管理**するか？ → YES なら `<project>/drive/`

**迷ったら**: GM・関係者が見る可能性があるなら、`<project>/docs/` に置く

---

## 6.11 よくある質問

### Q: セッションブランチで正本を編集したらどうなる？

A: シンボリックリンク方式では、正本ディレクトリはworktreeにコピーされないため、「セッションブランチで正本を編集」という状況は発生しません。正本の編集は常にmainのファイルを直接編集することになります。

### Q: 正本の変更をセッションブランチでレビューしたい場合は？

A: 正本の変更は即座に反映されるべきナレッジなので、通常はmain直接コミットで問題ありません。レビューが必要な大きな変更の場合は、一時的にシンボリックリンクを解除して実ファイルとして編集し、セッションブランチでコミット→マージの流れも可能です。

### Q: コンフリクトは発生する？

A: 正本ファイルは常にmainに直接コミットされるため、ブランチ間のコンフリクトは発生しません。プロジェクトコードのみがセッションブランチ経由となります。

---

# § 7. CI/CD Authentication (Claude Code)

## 7.1 認証方式の比較

| 方式 | 有効期限 | コスト | 用途 |
|------|---------|--------|------|
| `/login`（通常OAuth） | 約2-3時間 | Maxプラン内 | 対話的開発 |
| `setup-token` | 1年 | Maxプラン内 | CI/CD・自動化 |
| `ANTHROPIC_API_KEY` | 無期限 | 従量課金 | 大量処理・チーム利用 |

---

## 7.2 setup-token（推奨）

### 生成方法

```bash
# ターミナルで対話的に実行（1回のみ）
claude setup-token
```

出力例：
```
✓ Long-lived authentication token created successfully!

Your OAuth token (valid for 1 year):
sk-ant-oat01-xxxxx...

Store this token securely. You won't be able to see it again.
Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>
```

### 特徴

- **1年間有効** - 年1回の再生成で運用可能
- **Maxプラン範囲内** - 追加の従量課金なし
- **単一ユーザー向け** - 個人プロジェクト・少人数チーム向け

---

## 7.3 GitHub Actionsでの設定

### Step 1: Secretsに追加

```
Settings → Secrets and variables → Actions → New repository secret

Name: CLAUDE_CODE_OAUTH_TOKEN
Value: sk-ant-oat01-xxxxx...（setup-tokenで生成した値）
```

### Step 2: ワークフロー設定

```yaml
# .github/workflows/example.yml
name: Claude Code Job
on:
  workflow_dispatch:

jobs:
  run-claude:
    runs-on: [self-hosted, local]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Claude Code environment
        run: |
          mkdir -p ~/.claude
          echo '{"hasCompletedOnboarding": true}' > ~/.claude.json

      - name: Build prompt
        run: |
          cat > /tmp/prompt.txt << 'EOF'
          あなたのタスク内容をここに記述
          複数行のプロンプトも可能
          EOF

      - name: Run Claude Code
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
        run: |
          cat /tmp/prompt.txt | claude --print > /tmp/result.txt 2>&1
          cat /tmp/result.txt
```

### 稼働例

以下のワークフローで実績あり：
- `.github/workflows/task-triage.yml` - 週次タスク棚卸し
- `.github/workflows/mana-self-improve.yml` - mana応答品質の自動改善

### Step 3: Onboarding設定（初回のみ）

コンテナ/新環境では `~/.claude.json` が必要：

```bash
mkdir -p ~/.claude
echo '{"hasCompletedOnboarding": true}' > ~/.claude.json
```

---

## 7.4 セルフホストランナーでの利用

### 環境変数設定

```bash
# .bashrc または .zshrc
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-xxxxx..."
```

### headlessモードでの実行

```bash
# シンプルなプロンプト（特殊文字なし）
claude -p "プロンプト" --print

# 複雑なプロンプト（推奨：stdin経由）
cat prompt.txt | claude --print

# ツールを制限して実行
claude -p "コードレビューして" --allowedTools "Read,Glob,Grep" --print
```

**重要**: シェル特殊文字（`$`, `` ` ``, `"`, 改行等）を含むプロンプトは `claude -p "$PROMPT"` で失敗します。
必ず **stdinパイプ** (`cat prompt.txt | claude --print`) を使用してください。

---

## 7.5 トークン管理

### 有効期限の確認

Keychainに保存されたトークン情報を確認：

```bash
# macOS
security find-generic-password -s "Claude Code-credentials" -w | \
  python3 -c "import sys,json,datetime; \
  d=json.loads(sys.stdin.read()); \
  exp=datetime.datetime.fromtimestamp(d['claudeAiOauth']['expiresAt']/1000); \
  print(f'有効期限: {exp}')"
```

### 更新タイミング

- **setup-token**で生成したトークン → 1年後に再生成
- **通常OAuth**（/login） → 2-3時間で期限切れ（自動更新あり）

### トークン失効時

```bash
# 新しいトークンを生成
claude setup-token

# GitHub Secretsを更新
# Settings → Secrets → CLAUDE_CODE_OAUTH_TOKEN を編集
```

---

## 7.6 注意事項

### 制限

- **単一ユーザー向け** - Maxプランは個人利用想定
- **複数人チーム** - APIキー（従量課金）を推奨
- **大量処理** - レート制限あり、APIキー推奨

### セキュリティ

- トークンは**一度しか表示されない** - 安全に保管
- GitHub Secretsで管理 - 平文でコミットしない
- 漏洩時は即座に再生成

### トラブルシューティング

| 問題 | 原因 | 対策 |
|------|------|------|
| `OAuth token has expired` | 通常OAuthの期限切れ | `setup-token`で長期トークン生成 |
| onboarding画面が出る | `~/.claude.json`がない | `hasCompletedOnboarding: true`を設定 |
| `authentication_error` | トークン無効 | `setup-token`で再生成 |

---

## 7.7 実績

- **検証日**: 2025-12-15
- **Claude Code Version**: 2.0.65
- **確認済み**: `setup-token`で「valid for 1 year」のメッセージ出力を確認
- **稼働実績**: task-triage.yml, mana-self-improve.yml で動作確認済み

---

## 7.8 参考

- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [GitHub Issue #12447 - OAuth token expiration](https://github.com/anthropics/claude-code/issues/12447)
- [GitHub Issue #1454 - M2M Authentication Request](https://github.com/anthropics/claude-code/issues/1454)

---

# Quick Reference: 状況別参照ガイド

## Gitコミット作成
→ § 1.1 コミットメッセージフォーマット
→ § 1.2 type一覧
→ § 1.4 コミット実行コマンド
→ § 1.6 コミット例
→ § 1.7 Version Management（バージョン管理）

## CI/CD構築
→ § 2.2 必須アクション
→ § 2.3 記載項目
→ § 2.4 ローカルファースト検証原則（最重要）
→ § 2.6 例

## Design-to-Code実現
→ § 3.1 核心ポイント
→ § 3.2 推奨ワークフロー
→ § 3.3 プロンプトスニペット
→ § 3.4 デザイナー向けTips

## Claude Code運用
→ § 4.1 Hooks設定
→ § 4.2 Stopトリガーの発火タイミング
→ § 4.3 デバッグとトラブルシューティング
→ § 4.6 @path記法による動的ファイル参照
→ § 4.8 学習管理パターン

## ワークフロー検証
→ § 5.1 概要
→ § 5.2 Orchestrator構造（2 Phase）
→ § 5.3 Phase 1: 要件分析の実行内容
→ § 5.4 Phase 2: 検証レポート生成の実行内容
→ § 5.6 実行方法

## Worktree管理
→ § 6.1 基本原則
→ § 6.2 正本ディレクトリの定義
→ § 6.3 Worktree構造（シンボリックリンク方式）
→ § 6.4 コミットフロー
→ § 6.7 ルールまとめ
→ § 6.8 ファイル配置の判断フロー

## CI/CD認証（Claude Code）
→ § 7.1 認証方式の比較
→ § 7.2 setup-token（推奨）
→ § 7.3 GitHub Actionsでの設定
→ § 7.4 セルフホストランナーでの利用
→ § 7.5 トークン管理

---

## Version History

### v3.2 (2026-01-03)
- **§ 2.4 追加**: ローカルファースト検証原則（最重要）
  - 基本ルール（ローカル→CI段階的検証）
  - CI専用の確認とローカル確認すべきものの明確化
  - 違反例と正しい例（具体的なコマンド例付き）
  - 例外ケースの明記
- **背景**: CI資源浪費防止、開発効率向上のため
- **実例**: seed処理のCI直接投入による資源浪費事例を元に追加
- **Quick Reference更新**: § 2.4への参照追加
- **統合後サイズ**: ~1,820行 ✅ OPTIMAL範囲（1000-3000行）

### v3.1 (2026-01-02)
- **§ 1.7 追加**: Version Management（バージョン管理）
  - セマンティックバージョニングのルール（0.MINOR.PATCH）
  - バージョン更新のタイミング（同じPR内で別コミット）
  - 更新対象ファイル（package.json, public/index.html）
  - コミット例とベストプラクティス
- **Quick Reference更新**: § 1.7への参照追加
- **統合後サイズ**: ~1,670行 ✅ OPTIMAL範囲（1000-3000行）

### v3.0 (2025-12-30)
- **7 Skills統合**: v2.0の5 Skills + branch-worktree-rules, code-cicd-auth
- **7セクション構造**: Git Workflow・CI/CD・Design-to-Code・Claude Code・Workflow Validation・Worktree管理・CI/CD認証
- **統合後サイズ**: ~1,300行 ✅ OPTIMAL範囲（1000-3000行）
- **新セクション追加**:
  - § 6: Branch & Worktree Management（正本ディレクトリ・シンボリックリンク方式・ファイル配置ルール）
  - § 7: CI/CD Authentication（setup-token・GitHub Actions・セルフホストランナー）
- **Quick Reference更新**: Worktree管理・CI/CD認証への参照追加

### v2.0 (2025-12-30)
- **5 Skills統合**: git-commit-rules, github-actions-management, cursor-design-to-code, claude-code-patterns, test-workflow-validator
- **5セクション構造**: Git Workflow・CI/CD・Design-to-Code・Claude Code・Workflow Validation
- **統合後サイズ**: ~1,000行 ✅ OPTIMAL範囲達成
- **Quick Reference追加**: 状況別参照ガイド

---

**最終更新**: 2026-01-03
**作成者**: Claude Code (Phase 5.3 Consolidation)
**Skill Type**: Knowledge Skill (統合参照ガイド)
