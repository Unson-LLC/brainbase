# 🧠 brainbase-unson

**UNSON members' brainbase distribution**

UNSONメンバー向けのbrainbase配布版。90個のSkills、20個のカスタムコマンド、UNSON統一運用フローを最初から利用可能。

[![Private Repository](https://img.shields.io/badge/repository-private-red.svg)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-production-green.svg)]()

---

## ✨ 特徴

- **90個のSkills**: 開発・マーケティング・経営・運用の全領域をカバー
- **20個のカスタムコマンド**: `/ohayo`、`/task`、`/sns` など統一運用
- **3分でセットアップ完了**: clone → auth-setup → 完了
- **UNSONプロジェクトに即アクセス**: salestailor、zeims等の情報を自動取得
- **OSS版の更新を自動取り込み**: upstream merge で最新機能を継続的に導入

---

## 🚀 セットアップ手順

### 前提条件
- **Node.js** v20.0.0 以上
- **Git** v2.13.0 以上 (worktree サポート)
- **Claude Code** (AI コーディング支援)

### Step 1: リポジトリクローン

```bash
git clone https://github.com/Unson-LLC/brainbase-unson.git
cd brainbase-unson
```

### Step 2: 依存関係インストール

```bash
npm install
```

### Step 3: 認証 + bundled MCP登録

```bash
npm run auth-setup
```

**自動実行される処理**:
1. Device Code Flow でブラウザ認証（Slack OAuth）
2. トークンを `~/.brainbase/tokens.json` に保存（mode: 0o600）
3. 同梱済み Brainbase MCP を user scope に再登録
4. `BRAINBASE_ENTITY_SOURCE=graphapi` / `BRAINBASE_GRAPH_API_URL=https://graph.brain-base.work` を自動設定

**出力例**:
```
🔐 Brainbase MCP Setup - OAuth 2.0 Device Code Flow

📡 Requesting device code from https://graph.brain-base.work...
✅ Device code received

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. ブラウザで開く:
     https://graph.brain-base.work/device?user_code=WXYZ-1234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 認証完了
✅ Tokens saved to ~/.brainbase/tokens.json
✅ brainbase MCP registered (scope: user)

✅ Setup complete!
   Restart Claude Code to apply changes.
```

### Step 4: サーバー起動

```bash
npm start
```

→ http://localhost:31013 にアクセス

### Step 5: Claude Code で利用

Claude Code を再起動 → `@brainbase` MCP が利用可能

既存の`project`設定が残っている場合は、配布版より優先されるため先に削除:

```bash
claude mcp remove -s project brainbase
claude mcp remove -s local brainbase
```

必要に応じて再登録:

```bash
npm run mcp:add:brainbase
npm run mcp:get:brainbase
```

セットアップレポート提出（任意/運用時）:

```bash
npm run report:brainbase-setup
```

出力先:

```text
_ops/reports/brainbase-setup-report-<user>-<timestamp>.json
```

---

## 📚 利用可能なSkills（90個）

### 🛠️ 開発・技術（16個）

| Skill | 1行要約 |
|-------|---------|
| verify-first-debugging | 【必須】証拠階層で検証→仮説禁止→根本原因修正 |
| tdd-workflow | Red→Green→Refactor自動化 |
| refactoring-workflow | 3-Phase段階的移行、既存機能保護 |
| git-commit-rules | type(scope): HEREDOC形式、Co-Authored-By必須 |
| git-workflow | Conventional Commits・Decision capture検証 |
| architecture-patterns | EventBus/DI/Reactive/Service準拠チェック |
| security-patterns | XSS/CSRF/Input Validation検証 |
| test-strategy | Unit80%/API15%/E2E5%、カバレッジ80%以上 |
| test-orchestrator | git履歴→タスク提案（検証用） |
| test-workflow-validator | ワークフロー課題特定 |
| context-check | 実行環境確認、誤ディレクトリ防止 |
| codex-validation | _codex整合性検証（リンク切れ・誤編集） |
| pdf-read-python | pdfplumberでPDF読み込み（Read tool不可） |
| cursor-design-to-code | Cursor Planning→Build活用 |
| ui-design-resources | shadcn/ui + SaaS/AIデザインパターン |
| agent-browser | Vercel製ブラウザ自動化CLI（スナップショット参照で操作） |

### 📱 SNS・マーケティング（22個）

| Skill | 1行要約 |
|-------|---------|
| sns-smart | git→9セグ→ドラフト→レビュー→画像→投稿（6 Phase） |
| note-smart | 構成→本文→鬼レビュー→画像（4 Phase） |
| marketing-strategy-planner | WHO×WHAT→戦術→実行→GenAI（4 Phase） |
| customer-centric-marketing-n1 | N=1深掘り→9セグ施策設計 |
| marketing-compass | WHO×WHAT起点で価値設計 |
| marketing-failure-patterns | 失敗パターン診断→打ち手決定 |
| marketing-framework-115-methods | 3要素・5プロセス・115手法全体図 |
| sns-copy-patterns | X/note構文パターン集 |
| sns-16-tricks-doshiroto | バズ戦略16の裏技（2025年版） |
| sns-account-factory | 返信/遷移逆算、レーン設計 |
| note-article-writing | note記事ベストプラクティス |
| x-analytics-source | Xアナリティクス取得（OAuth PKCE） |
| x-bookmarks-source | Xブックマーク取得（完全コンテキスト） |
| x-curate-smart | 海外バズ→日本向けキュレーション |
| x-curate-strategy | 情報鮮度で先行者優位 |
| x-quote-smart | バズ引用→軸足視点展開 |
| x-quote-strategy | 引用リポスト戦略 |
| x-reply-smart | コメ欄上位狙い、エビデンス補強 |
| x-reply-strategy | リプライ戦略4ステップ |
| ai-driven-marketing-genai-playbook | 生成AI/エージェントでマーケ変革 |
| b2b-marketing-60-tactics-playbook | BtoBリード〜受注60施策 |
| branding-strategy-guide | ブランド22法則・カルト倫理・X集客 |

### 💼 経営・組織（12個）

| Skill | 1行要約 |
|-------|---------|
| 1on1-mastery | 部下主導、アウトライン、コーチング、保留バッチ |
| hiring-retention | 面接80%傾聴、退職即対応 |
| performance-review | 3L（Level/Listen/Leave out）評価 |
| planning-okr | 需要予測→現状→ギャップ→OKR設計 |
| manager-leverage | 情報・判断・役割・監視・時間でレバレッジ最大化 |
| task-relevant-maturity | TRM判定→スタイル選択（タスク/コミュ/最小） |
| leadership-frameworks | EOS・財務・システム思考・SL・PM・AIファースト |
| raci-format | 立ち位置最上位、法人単位管理 |
| principles | 佐藤の価値観・NGライン・運用ルール |
| garber-shikumi-keiei | 社長不在で回る仕組み経営 |
| small-company-shikumika | 社員30人規模の仕組み化 |
| business-growth-playbook | SaaS/AI製品→売上組織→経営FW→仕組み化→Lean |

### 🚀 プロジェクト・タスク管理（10個）

| Skill | 1行要約 |
|-------|---------|
| project-onboarding | 戦略→RACI→タスク→マイル→進捗→自律（6 Phase） |
| 90day-checklist | 90日仕組み化、戦略→RACI（2 Phase） |
| task-format | _tasks/index.md YAML形式、RACI・期限・タグ |
| milestone-management | NocoDB正本、_codex参照用 |
| sprint-management | 週次サイクル、mana自動、GM目標設定 |
| ship-management | ステータスフロー、Ship種別、N:1タスク紐付け |
| strategy-template | 01_strategy.md必須項目（ICP・価値・KPI） |
| nocodb-4table-guide | 4テーブル（マイル・スプリント・タスク・シップ） |
| kpi-calculation | タスク一本化率・RACI運用率等6指標 |
| learning-extraction | セッション学習自動抽出 |

### 🔧 運用・ツール（15個）

| Skill | 1行要約 |
|-------|---------|
| brainbase-ops-guide | プロセス・_codex・環境変数・worktree・launchd |
| brainbase-content-ssot | note/X Article/X投稿の_codex集約ルール |
| brainbase-marketing-10x-ops | SSOT・作業場所・成果物・ループ・NocoDB |
| ohayo-orchestrator | 朝の同期→収集→サマリー→フォーカス |
| gmail-auto-labeling | 3アカ並列、5 Phaseメール仕分け |
| email-classifier | LLMメール分析、ラベル・緊急度判断 |
| add-mcp | MCP追加一発成功、トラブルシュート |
| mana-deployment | mana Lambda 3ワークスペース同時デプロイ |
| mana-slack-test | mana E2Eテスト手順 |
| drive-organize | Google Drive 5ステップ安全整理 |
| ops-tools-guide | Claude Code・brainbase安全・version・worktree |
| dev-workflow-guide | Git・CI/CD・Design2Code・Claude・worktree |
| data-meta-guide | 人物・顧客二層管理、Airtable/freee連携 |
| ttyd-upload-locator | ttydアップロード画像を素早く発見 |
| knowledge-frontmatter | Skills登録フォーマット |

### 📊 事業開発・セールス（7個）

| Skill | 1行要約 |
|-------|---------|
| all-for-saas-playbook | SaaS 0→1、調査〜開発〜GTM〜リリース |
| saas-ai-roadmap-playbook | MVP〜PMF、OKR/KPI、検証サイクル |
| jutaku-1oku-shikumi | 受託1億円、スコープ・期待値・法人購買 |
| sales-playbook | 非対面コピー・対面5ステップ・オンライン提案 |
| kernel-prompt-engineering | KERNEL 6原則、精度340%↑・時間67%↓ |
| ismp-vulnerability-check | ISMP/ISM脆弱性レポート解析、対応要否判定 |
| nano-banana-pro-tips | Gemini画像生成、文字・図解・写真合成 |

---

## 🎯 利用可能なカスタムコマンド（20個）

| コマンド | 用途 |
|---------|------|
| `/ohayo` | 朝のダッシュボード（同期→収集→サマリー→フォーカス） |
| `/task` | タスク実行準備（_tasks/index.md確認→タスク選択） |
| `/commit` | 標準コミット（type(scope): message形式） |
| `/sns` | SNS投稿（sns-smart Orchestrator統合版） |
| `/auth-setup` | brainbase認証セットアップ（OAuth + bundled MCP自動登録） |
| `/add-mcp` | MCP Server追加（一発成功手順） |
| `/merge` | セッションマージ（PRモード） |
| `/create-pr` | PR作成 |
| `/pull` | 全リポジトリ同期 |
| `/add-person` | 人物登録（_codex/common/meta/people/） |
| `/meishi` | 名刺OCRワークフロー |
| `/schedule` | タイムスケジュール作成 |
| `/req` | 要件ベース開発（REQ-XXX） |
| `/atomic` | アトミックコミット（小さく・頻繁に） |
| `/wip` | WIP（作業中チェックポイント） |
| `/velocity` | 開発速度分析 |
| `/learn-skills` | 学習候補の確認・適用 |
| `/approve-skill` | Skills更新案を承認・適用（ワンクリック） |
| `/compact` | コンテキスト圧縮 |
| `/config` | 設定確認 |

---

## 🔌 利用可能なMCP（6個）

`npm run auth-setup` で `brainbase` MCP が user scope に登録されます。  
その他のMCPは必要に応じて `/add-mcp` で追加してください。
Brainbase MCP の正本はこのリポジトリ内（`mcp/brainbase`）で管理します。

| MCP | 用途 | 主な機能 |
|-----|------|---------|
| **brainbase** | Graph API統合（必須） | UNSONプロジェクト情報取得、RACI権限管理、_codex構造へのアクセス |
| **gog** | Google統合（任意追加） | Gmail（メール管理・自動仕分け）、Google Calendar（スケジュール統合） |
| **nocodb** | タスク管理（任意追加） | タスク・マイルストーン・スプリント・シップ管理 |
| **chrome-devtools** | ブラウザ自動化（任意追加） | Chrome DevTools Protocol、ページ操作、スクリーンショット |
| **freee** | 会計連携（任意追加） | 取引先・請求書・経費管理 |
| **jibble** | 勤怠管理（任意追加） | 勤怠記録・レポート取得 |

### MCP呼び出し例

```
Claude Codeで:
@brainbase get_context project:salestailor
@gog gmail_search query:"未読"
@gog calendar_list_events
@nocodb list_records table:"タスク"
```

## 🧪 Vercel agent-browser（任意）

Vercel製 `agent-browser` を使うと、CLIベースでブラウザ操作・検証を実行できます。  
Skillは同梱済み: `.claude/skills/agent-browser/SKILL.md`

```bash
npm run agent-browser:install
npm run agent-browser:help
```

---

## 🔧 トラブルシューティング

### 認証エラー

```bash
# トークンをリセット
rm ~/.brainbase/tokens.json
npm run auth-setup
```

### MCP接続エラー

```bash
# MCP状態を確認
npm run mcp:get:brainbase

# brainbase MCPを再登録
npm run mcp:add:brainbase

# Claude Code を再起動
```

### サーバー起動エラー

```bash
# ポート31013が使われているか確認
lsof -i :31013

# 既存プロセスをkill
kill -9 $(lsof -t -i :31013)

# 再起動
npm start
```

---

## 🔄 OSS版（brainbase）の更新を取り込む

```bash
# upstream remote は既に追加済み
git remote -v
# upstream	https://github.com/Unson-LLC/brainbase.git (fetch)
# upstream	https://github.com/Unson-LLC/brainbase.git (push)

# 定期的に（月1回程度）:
git fetch upstream
git checkout main
git merge upstream/main

# 競合を解決
# - .gitignore: UNSON版の設定を保持
# - CLAUDE.md/README.md: UNSON向け説明を保持
# - .claude/skills/: 非公開Skillsを保持
# - .claude/commands/: カスタムコマンドを保持

# テスト・コミット
npm install && npm test
git commit -m "chore: merge upstream brainbase updates"
git push origin main
```

---

## 📖 ドキュメント

- **運用ガイド**: [CLAUDE.md](./CLAUDE.md)
- **詳細セットアップ**: [docs/onboarding/unson-setup-guide.md](./docs/onboarding/unson-setup-guide.md)
- **OSS版README**: [upstream brainbase README](https://github.com/Unson-LLC/brainbase/blob/main/README.md)

---

## 🤝 Contributing

UNSON版への変更は以下の手順で：

1. **feature/session/* ブランチ作成**
   ```bash
   git checkout -b feature/session-$(date +%s)-your-feature
   ```

2. **変更を実装**
   - Skills/Commandsの追加・更新
   - UNSON運用フロー改善

3. **テスト・コミット**
   ```bash
   npm test
   git commit -m "feat: add your feature"
   ```

4. **PR作成**
   ```bash
   git push origin feature/session-*
   # GitHubでPR作成
   ```

---

## 📝 ライセンス

Private repository - UNSON members only

---

🤖 Built with [Claude Code](https://claude.com/claude-code)

最終更新: 2026-02-09
