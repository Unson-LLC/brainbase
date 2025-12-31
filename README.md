# 🧠 Brainbase

**複数プロジェクトを一元管理。見落とし・切り替えコストをゼロに。**
ローカル完結のAI-firstプロジェクト管理コンソール。デスクトップでもスマホでも、どこからでもアクセス。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Status](https://img.shields.io/badge/status-beta-yellow.svg)]()

---

## 🤔 こんな悩みありませんか？

- 複数案件を抱えると、各プロジェクトの状況把握に毎日30分溶ける
- タスク管理ツール、Slack、GitHub、メール...複数チャネルを行き来して疲弊
- 外出先で「あのタスク今どうなってたっけ？」→PCないと確認できない
- Claude Codeで作業→別プロジェクトに切り替え→Claude Codeセッション再起動の手間

**Brainbaseなら、すべてを一箇所に集約。デスクトップでもスマホでも、いつでもプロジェクト全体が見渡せます。**

---

## 📸 使用イメージ

### デスクトップ版
![Brainbase Desktop - Project Overview](docs/screenshots/desktop-overview.png)
*複数プロジェクトのタスク・スケジュール・受信箱を一画面で確認*

### モバイル版
![Brainbase Mobile - On the Go](docs/screenshots/mobile-tasks.png)
*外出先でもスマホからタスク確認・更新が可能*

### セッション管理
![Multi-session Support](docs/screenshots/session-management.gif)
*プロジェクトごとにClaude Codeセッションを分離・切り替え*

---

## ✨ Key Features

- 📱 **モバイル対応**: スマホ・タブレットからも快適にアクセス。外出先でもプロジェクト状況を確認・タスク更新が可能
- 🔒 **ローカル完結**: データはすべて自分のマシンに保存。クラウド不要で安全
- 🤖 **AI統合**: Claude Code、Cursor等のAIコーディングアシスタントと連携
- 📊 **一元管理**: タスク、スケジュール、Inbox、Slackメッセージを一画面で確認
- 🔄 **セッション分離**: プロジェクトごとにClaude Codeセッションを分離（git worktree）
- 🎨 **カスタマイズ可能**: YAML設定でプロジェクト・タスク管理をカスタマイズ
- 🔗 **MCP統合**: Gmail、Slack、Airtable、GitHub等のMCPサーバーと連携

---

## 🚀 Quick Start

### 前提条件
- **Node.js** v20.0.0 以上
- **tmux** (ターミナル多重化)
- **ttyd** (Web ターミナル)
- **Claude Code** (AI コーディング支援) - 任意
- **Git** v2.13.0 以上 (worktree サポート)

<details>
<summary>📦 前提条件のインストール方法</summary>

#### macOS (Homebrew)
```bash
# tmux
brew install tmux

# ttyd
brew install ttyd

# Claude Code (任意)
npm install -g @anthropic-ai/claude-code

# Git (通常は既にインストール済み)
brew install git
```

#### Linux (Ubuntu/Debian)
```bash
# tmux
sudo apt-get install tmux

# ttyd
sudo apt-get install ttyd

# Claude Code (任意)
npm install -g @anthropic-ai/claude-code
```

</details>

### セットアップ（3分）

1. **リポジトリクローン**
   ```bash
   git clone https://github.com/Unson-LLC/brainbase.git
   cd brainbase
   ```

2. **依存関係インストール**
   ```bash
   npm install
   ```

3. **初回セットアップ**
   ```bash
   ./setup.sh
   ```

   このスクリプトは以下を実行します:
   - `state.json` のサンプル作成（セッション管理用）
   - `_tasks/` ディレクトリ作成（サンプルタスク付き）
   - `_schedules/` ディレクトリ作成（サンプルスケジュール付き）
   - `_inbox/` ディレクトリ作成（受信箱）

4. **サーバー起動**
   ```bash
   npm start
   ```

5. **アクセス**
   - **デスクトップ**: http://localhost:3000
   - **モバイル**: http://<your-local-ip>:3000

   ローカルIPアドレスの確認方法:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet "
   ```

✅ **これで完了！** 3分でローカル環境が整います。

### 環境変数（任意）

```bash
# カスタムワークスペースルート（デフォルト: カレントディレクトリ）
export BRAINBASE_ROOT=/path/to/your/workspace

# カスタムポート（デフォルト: 3000、worktree内では3001）
export PORT=4000

# サーバー起動
npm start
```

---

## 📖 使い方ガイド

### 初回起動後の流れ

1. **プロジェクト登録**
   - 左サイドバーの「+ New Session」をクリック
   - プロジェクト名とディレクトリパスを入力
   - GitHub連携（任意）、Slack連携（任意）を設定

2. **タスク管理**
   - プロジェクトを選択 → 「Tasks」タブ
   - `_tasks/index.md` に Markdown形式でタスクを記述
   - ブラウザで編集・確認が可能

3. **スケジュール確認**
   - 「Schedule」タブで週次・月次スケジュールを確認
   - `_schedules/` 配下のYAMLファイルで管理

4. **受信箱（Inbox）**
   - Gmail、Slackからの通知を一元表示
   - MCP連携で自動取得

5. **セッション切り替え**
   - プロジェクトタブをクリックで即座に切り替え
   - Claude Codeセッションも自動切り替え（git worktree使用）

詳細: [ユーザーガイド](docs/USER_GUIDE.md)

---

## 🌳 git worktree による並行作業

Brainbaseは **git worktree** を活用し、プロジェクトごとにClaude Codeセッションを分離します。

### なぜworktreeを使うのか？

**従来の問題**:
- プロジェクトAで作業中 → プロジェクトBに切り替え → Claude Codeセッションが混在
- ブランチ切り替えのたびに作業ディレクトリが変わり、コンテキストが失われる

**worktreeの利点**:
- **並行作業**: 同じリポジトリの複数ブランチを同時に開ける
- **セッション分離**: プロジェクトごとにClaude Codeセッションを維持
- **高速切り替え**: ディレクトリ移動のみでプロジェクト切り替え完了

### 使い方（自動セットアップ）

Brainbaseは初回起動時に自動的にworktreeを作成します。手動操作は不要です。

詳細: [git worktree ガイド](docs/git-worktree-guide.md)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           UI Components (View)           │
├─────────────────────────────────────────┤
│        Services (Business Logic)         │
├─────────────────────────────────────────┤
│      Repositories (Data Access)          │
├─────────────────────────────────────────┤
│      EventBus (Cross-Cutting)            │
└─────────────────────────────────────────┘
```

Brainbaseは以下のアーキテクチャパターンを採用:
- **Event-Driven Architecture**: EventBus, Reactive Store, DI Container
- **Test-Driven Development**: 80%+ coverage, Red-Green-Refactor cycle
- **Service Layer Pattern**: ビジネスロジックの一元化

詳細: [DESIGN.md](./DESIGN.md)

---

## 📚 Documentation

- [開発者向けガイド](./CLAUDE.md) - 開発標準・アーキテクチャ原則
- [設計ドキュメント](./DESIGN.md) - UI/UX設計・データフロー
- [リファクタリング計画](./docs/REFACTORING_PLAN.md) - 3-Phase移行戦略
- [git worktree ガイド](./docs/git-worktree-guide.md) - worktree詳細説明

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

**開発ワークフロー**:
1. **Explore**: 既存コード調査
2. **Plan**: 実装方針決定
3. **Branch**: feature/session/* branch作成
4. **Edit**: TDD実装 (Red-Green-Refactor)
5. **Test**: カバレッジ80%以上
6. **Commit**: Decision capture + Conventional Commits
7. **Merge**: --no-ff merge to main

---

## ❓ FAQ・トラブルシューティング

### Q1: ttydが起動しない

**A**: tmuxがインストールされているか確認してください。
```bash
tmux -V
# tmux 3.x 以上が必要
```

### Q2: Claude Codeと連携できない

**A**: Claude CodeのAPIキーが設定されているか確認してください。
```bash
claude-code --version
# v1.0.0 以上推奨
```

### Q3: モバイルからアクセスできない

**A**: ファイアウォール設定を確認し、ポート3000が開放されているか確認してください。
```bash
# macOS
sudo lsof -i :3000

# ローカルIPアドレス確認
ifconfig | grep "inet "
```

### Q4: git worktreeが自動作成されない

**A**: Git v2.13.0以上が必要です。バージョンを確認してください。
```bash
git --version
```

### Q5: `./setup.sh`を実行せずに起動できますか？

**A**: 可能です。以下を手動で実行してください:
```bash
cp state.sample.json state.json
cp -r _tasks-sample _tasks
cp -r _schedules-sample _schedules
cp -r _inbox-sample _inbox
```

その他のトラブルは [Issues](https://github.com/Unson-LLC/brainbase/issues) で報告してください。

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

🤖 Built with [Claude Code](https://claude.com/claude-code)
