# UNSON members' brainbase Setup Guide

**対象**: UNSONメンバー（初めてbrainbase-unsonをセットアップする方）

---

## 前提条件

- **Node.js** v20.0.0 以上
- **Git** v2.13.0 以上
- **Claude Code** インストール済み
- **UNSONメンバーアカウント**（Slack OAuth認証用）

---

## セットアップフロー（3分）

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

**ブラウザで表示される認証画面**:
1. https://graph.brain-base.work/device?user_code=WXYZ-1234 にアクセス
2. 8桁のコードが自動入力される
3. 「Slackでログイン」をクリック
4. UNSON Slackワークスペースで認証
5. 「許可」をクリック

**成功すると以下のメッセージが表示される**:
```
✅ 認証完了
✅ Tokens saved to ~/.brainbase/tokens.json
✅ brainbase MCP registered (scope: user)

✅ Setup complete!
   Restart Claude Code to apply MCP changes.
```

### Step 4: サーバー起動

```bash
npm start
```

**起動確認**:
- ターミナルに `Server running at http://localhost:31013` と表示される
- ブラウザで http://localhost:31013 にアクセス → brainbase UIが表示される

### Step 5: Claude Code で利用

1. Claude Code を再起動
2. `@brainbase` と入力 → MCPが利用可能になる
3. 以下のコマンドを試してみる:
   ```
   @brainbase get_context project:salestailor
   ```
   → SalesTailorプロジェクトの情報が取得できればOK！

必要に応じて再登録:

```bash
npm run mcp:add:brainbase
npm run mcp:get:brainbase
```

---

## 利用可能な機能

### 89個のSkills

Claude Codeで以下のSkillsが利用可能:

**開発系（15個）**:
- `verify-first-debugging`: バグ修正時の必須フレームワーク
- `tdd-workflow`: TDD自動化
- `git-commit-rules`: コミットルール

**マーケティング系（22個）**:
- `sns-smart`: SNS投稿の自動化（6 Phase）
- `note-smart`: note記事作成（4 Phase）
- `marketing-strategy-planner`: マーケ戦略立案

**経営系（12個）**:
- `1on1-mastery`: 1on1運用
- `90day-checklist`: 90日仕組み化

**タスク管理系（10個）**:
- `project-onboarding`: プロジェクト立ち上げ
- `sprint-management`: スプリント運用

**運用系（15個）**:
- `ohayo-orchestrator`: 朝のダッシュボード
- `gmail-auto-labeling`: Gmail自動仕分け

**事業開発系（7個）**:
- `all-for-saas-playbook`: SaaS立ち上げ
- `sales-playbook`: セールスプレイブック

詳細: [README.md](../../README.md)

### 20個のカスタムコマンド

Claude Codeで以下のコマンドが利用可能:

```bash
/ohayo           # 朝のダッシュボード
/task            # タスク実行準備
/commit          # 標準コミット
/sns             # SNS投稿
/auth-setup      # 認証セットアップ
/add-mcp         # MCP追加
/merge           # セッションマージ
/create-pr       # PR作成
/pull            # 全リポジトリ同期
/add-person      # 人物登録
/meishi          # 名刺OCR
/schedule        # スケジュール作成
/req             # 要件ベース開発
/atomic          # アトミックコミット
/wip             # WIP
/velocity        # 開発速度分析
/learn-skills    # 学習候補確認
/approve-skill   # Skills更新承認
/compact         # コンテキスト圧縮
/config          # 設定確認
```

### 6個のMCPサーバー

`npm run auth-setup` で `brainbase` MCP が user scope に登録されます。その他のMCPは必要に応じて `/add-mcp` で追加してください。
Brainbase MCP の正本は `brainbase-unson/mcp/brainbase` です。

| MCP | 用途 |
|-----|------|
| **brainbase** | UNSONプロジェクト情報取得、RACI権限管理 |

**MCP呼び出し例**:
```
@brainbase get_context project:salestailor
@gog gmail_search query:"未読"
@gog calendar_list_events
@nocodb list_records table:"タスク"
```

---

## トラブルシューティング

### 認証エラー

**症状**: `npm run auth-setup` で認証に失敗する

**原因**:
- Device codeが期限切れ（10分）
- Slack認証が失敗
- ネットワークエラー

**対処法**:
```bash
# トークンをリセット
rm ~/.brainbase/tokens.json

# 再度認証
npm run auth-setup

# 接続先を明示する場合（推奨）
BRAINBASE_API_URL=https://graph.brain-base.work npm run auth-setup
```

### MCP接続エラー

**症状**: Claude Codeで `@brainbase` が使えない

**原因**:
- brainbase MCPの登録が古い/壊れている
- Claude Codeが再起動されていない

**対処法**:
```bash
# MCPの登録状態を確認
npm run mcp:get:brainbase

# MCPを再登録
npm run mcp:add:brainbase

# Claude Code を再起動
```

### サーバー起動エラー

**症状**: `npm start` でポート31013が使われている

**原因**:
- 既存のbrainbaseプロセスが起動中
- 別のプロセスがポート31013を使用

**対処法**:
```bash
# ポート31013を使っているプロセスを確認
lsof -i :31013

# プロセスをkill
kill -9 $(lsof -t -i :31013)

# 再起動
npm start
```

### MCP登録がうまくいかない

**症状**: `npm run auth-setup` 後も `@brainbase` が使えない

**原因**:
- `claude` CLIがPATHにない
- 既存の project-scope MCP が優先されている
- Node依存が未インストール

**対処法**:
```bash
npm install
npm run mcp:add:brainbase
npm run mcp:get:brainbase
```

`mcp:get` で `Scope: Project config` が表示される場合は、既存設定を外してください:

```bash
claude mcp remove -s project brainbase
npm run mcp:add:brainbase
```

---

## よくある質問（FAQ）

### Q1: 既存のbrainbaseとbrainbase-unsonの違いは？

**A**: 以下の違いがあります:

| 項目 | brainbase (OSS) | brainbase-unson (UNSON版) |
|------|-----------------|---------------------------|
| Skills | 21個（公開のみ） | 89個（公開21 + 非公開68） |
| Commands | なし | 20個 |
| MCP初期設定 | 手動でMCP登録 | `npm run auth-setup` でbrainbase MCP自動登録 |
| UNSONプロジェクト | なし | 自動取得 |
| 公開範囲 | Public | Private |

### Q2: OSS版の更新はどうやって取り込む？

**A**: 月1回程度、以下のコマンドで更新を取り込みます:

```bash
git fetch upstream
git checkout main
git merge upstream/main

# 競合を解決
# - .gitignore: UNSON版の設定を保持
# - CLAUDE.md/README.md: UNSON向け説明を保持
# - .claude/skills/: 非公開Skillsを保持

npm install && npm test
git commit -m "chore: merge upstream brainbase updates"
git push origin main
```

### Q3: 複数人で使う場合は？

**A**: 各メンバーが個別にセットアップします:

1. 各自がbrainbase-unsonをclone
2. 各自が `npm run auth-setup` で認証
3. 各自のRACIに基づいてGraph APIからアクセス可能なプロジェクトのみ取得される

### Q4: _codexのデータはどう管理する？

**A**: _codexは個人データなので.gitignoreで除外されています:

- `_codex-sample/`: サンプル構造（Git管理対象）
- `_codex/`: 実データ（各自で管理、Git除外）

各自で _codex/ を作成し、サンプルを参考に構築してください。

### Q5: 新しいSkillを追加したい場合は？

**A**: `.claude/skills/` に追加してPRを作成:

```bash
# 新しいSkillを作成
mkdir .claude/skills/my-new-skill
echo "# My New Skill" > .claude/skills/my-new-skill/SKILL.md

# コミット
git add .claude/skills/my-new-skill/
git commit -m "feat: add my-new-skill"

# PR作成
git push origin feature/add-my-new-skill
# GitHubでPR作成
```

---

## 次のステップ

セットアップが完了したら、以下を試してみてください:

1. **朝のダッシュボード**:
   ```
   /ohayo
   ```

2. **タスク確認**:
   ```
   /task
   ```

3. **SNS投稿**:
   ```
   /sns
   ```

4. **プロジェクト情報取得**:
   ```
   @brainbase get_context project:salestailor
   ```

---

## サポート

問題が解決しない場合は、以下で質問してください:

- **Slack**: #brainbase チャンネル
- **GitHub Issues**: https://github.com/Unson-LLC/brainbase-unson/issues

---

最終更新: 2026-02-09
