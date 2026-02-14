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
- 📊 **一元管理**: タスク、スケジュール、受信箱を一画面で確認
- 🔄 **セッション分離**: プロジェクトごとにClaude Codeセッションを分離（git worktree）
- 📝 **ファイルベース**: Markdown/YAMLで管理。エディタやClaude Codeから直接編集可能

---

## 🚀 Quick Start

### 前提条件
- **Node.js** v20.0.0 以上
- **tmux** (ターミナル多重化)
- **ttyd** (Web ターミナル)
- **Jujutsu (jj)** v0.20.0 以上（AI-firstセッション管理）
- **Claude Code** (AI コーディング支援) - 任意
- **Git** v2.13.0 以上 (Jujutsuのバックエンド)

<details>
<summary>📦 前提条件のインストール方法</summary>

#### macOS (Homebrew)
```bash
# tmux
brew install tmux

# ttyd
brew install ttyd

# Jujutsu（必須）
brew install jj

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

# Jujutsu（必須）- cargoでインストール
cargo install jj-cli

# Claude Code (任意)
npm install -g @anthropic-ai/claude-code
```

#### Jujutsu初期化（既存Gitリポジトリがある場合）
```bash
cd /path/to/your/repo
jj git init  # 既存GitリポジトリにJujutsuを追加
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
   - `var/state.json` のサンプル作成（セッション管理用）
   - `data/_tasks/` ディレクトリ作成（サンプルタスク付き）
   - `data/_schedules/` ディレクトリ作成（サンプルスケジュール付き）
   - `data/_inbox/` ディレクトリ作成（受信箱）
   - `data/config.yml` の作成（設定ファイル）

4. **サーバー起動**
   ```bash
   npm start
   ```

5. **アクセス**

   **デスクトップ**: http://localhost:31013

   **モバイル**（3つの方法から選択）:

   ### 方法1: ローカルネットワーク経由（最も簡単）
   同じWi-Fi内からのみアクセス可能
   ```bash
   # ローカルIPアドレスを確認
   ifconfig | grep "inet "  # macOS/Linux

   # スマホのブラウザでアクセス
   # 例: http://192.168.1.10:31013
   ```

   ### 方法2: Quick Tunnels（一時的なテスト用）
   インターネット経由でアクセス可能。URLを知っていれば誰でもアクセス可能なので注意。
   ```bash
   # cloudflaredインストール（初回のみ）
   brew install cloudflared

   # Quick Tunnel起動
   cloudflared tunnel --url http://localhost:31013
   # → 表示されたURLにスマホからアクセス
   ```

   ### 方法3: Cloudflare Tunnel + Zero Trust（本番推奨）
   **前提条件**:
   - ✅ 独自ドメイン（Cloudflareで管理）
   - ✅ Cloudflareアカウント（無料）

   安全・継続的に外部からアクセス可能。WARPアプリで認証必須。

   📖 **詳細な手順**: [Cloudflare Tunnel設定ガイド](docs/cloudflare-tunnel-setup.md)

✅ **これで完了！** 3分でローカル環境が整います。

---

## 🔐 brainbase MCP セットアップ（Claude Code統合）

brainbase MCPサーバーを使用すると、Claude Codeから直接brainbaseのデータにアクセスできます。

### 前提条件
- brainbaseサーバーが起動していること（`npm start`）
- Slack Workspaceへのアクセス権限（認証用）

### セットアップ手順

1. **MCP Server用トークン取得**
   ```bash
   cd /path/to/brainbase
   npm run mcp-setup
   ```

2. **認証フロー**
   CLIに表示される8桁のコード（例: `WDJB-MJHT`）を以下のいずれかの方法で使用:

   **方法1: 自動リンクを開く（推奨）**
   - CLIに表示されたURL（例: `https://bb.unson.jp/device?user_code=WDJB-MJHT`）をブラウザで開く
   - コードが自動入力されるので、「次へ」→「Slackでログイン」→「許可」をクリック

   **方法2: 手動入力**
   - https://bb.unson.jp/device にアクセス
   - 8桁のコードを手動入力
   - 「Slackでログイン」→「許可」をクリック

3. **認証完了**
   CLIで「✅ 認証成功！」と表示されたら、トークンが `~/.brainbase/tokens.json` に保存されます。

4. **Claude Code再起動**
   ```bash
   # Claude Codeを再起動してMCP設定を反映
   ```

### トラブルシューティング

| エラー | 原因 | 対処法 |
|-------|------|--------|
| `Device code expired` | 認証に10分以上かかった | `npm run mcp-setup` を再実行 |
| `Invalid or expired user code` | コードの入力ミス | 正しいコード（XXXX-XXXX形式）を確認 |
| `Access is not granted` | ユーザー権限がない | brainbase管理者に権限付与を依頼 |
| `Connection refused` | brainbaseサーバーが停止 | `npm start` でサーバーを起動 |

### セキュリティ

- トークンファイル（`~/.brainbase/tokens.json`）は permission 600 で保存され、他のユーザーからは読めません
- トークンの有効期限は1時間。期限切れ時は自動的にrefresh tokenで再取得されます
- Device Code Flowは OAuth 2.0 RFC 8628 に準拠した標準的な認証方式です

---

### 環境変数（任意）

```bash
# カスタムデータルート（デフォルト: ./data）
export BRAINBASE_ROOT=/path/to/your/data

# ランタイム用ディレクトリ（デフォルト: ./var）
export BRAINBASE_VAR_DIR=/path/to/your/var

# カスタムポート（デフォルト: 31013、worktree内では31014）
export PORT=4000

# Codex: auto handover (/handover) (opt-in)
export BRAINBASE_AUTO_HANDOVER=1
export BRAINBASE_AUTO_HANDOVER_DELAY_SEC=90  # default: 90

# サーバー起動
npm start
```

---

## 📖 使い方ガイド

### 初回起動後の流れ

1. **プロジェクト登録**
   - 左サイドバーの「+ New Session」をクリック
   - プロジェクト名とディレクトリパスを入力

2. **タスク管理**

  `data/_tasks/index.md` にYAMLフロントマター形式でタスクを記述します。

   ```markdown
   ---
   id: task-001
   title: "機能Aを実装する"
   status: todo
   project: my-project
   priority: 1
   tags: [feature]
   due: 2025-01-15
   ---

   # 機能Aを実装する

   詳細な説明をここに書く

   ---
   id: task-002
   title: "バグBを修正する"
   status: in-progress
   priority: 2
   ---

   # バグBを修正する
   ```

   | フィールド | 必須 | 説明 |
   |-----------|------|------|
   | `id` | ○ | 一意のタスクID |
   | `title` | ○ | タスク名 |
   | `status` | ○ | `todo` / `in-progress` / `done` |
   | `priority` | - | 優先度（数値、1が最高） |
   | `due` | - | 期限（YYYY-MM-DD） |
   | `tags` | - | タグ配列 |

   **UI操作**: 完了・優先度変更（defer）・削除はブラウザUIから可能

3. **スケジュール管理**

  `data/_schedules/YYYY-MM-DD.md` に日単位でスケジュールを作成します。

   ```markdown
   # 2025-01-09

   09:00 - 10:00 定例MTG
   10:00 - 12:00 開発作業
   14:00 - 15:00 クライアント打ち合わせ

   ## 作業可能時間
   - 午前: 10:30 〜 12:00
   - 午後: 15:00 〜 18:00

   ## タスク
   - [ ] 今日やること1
   - [ ] 今日やること2
   ```

   **対応フォーマット**:
   - `HH:MM - HH:MM タスク名`
   - `| HH:MM - HH:MM | タスク名 |`（テーブル形式）
   - `- [ ] タスク名`（チェックリスト）

4. **受信箱（Inbox）**

  `data/_inbox/pending.md` で通知・メモを管理します。

   ```markdown
   ---
   id: INBOX-001
   sender: John
   timestamp: 2025-01-09T10:00:00Z
   status: pending
   ---

   ### 確認依頼

   〇〇について確認お願いします。
   ```

   **UI操作**: 対応済みにするとリストから消えます

5. **セッション切り替え**
   - 左サイドバーでプロジェクトをクリック → 即座に切り替え
   - 各プロジェクトのClaude Codeセッションはgit worktreeで分離

6. **セッション引き継ぎ（/handover）**
   - セッション終了/切り替え前に `/handover` を実行すると、プロジェクトルートに `HANDOVER.md` が生成されます
   - 自動生成したい場合は `bash .claude/hooks/auto-handover.sh` を使います（失敗時はテンプレのみを出力）
   - 自動実行（任意, opt-in）
     - **Codex**: `BRAINBASE_AUTO_HANDOVER=1` を付けて起動すると、処理完了後にアイドル状態が `BRAINBASE_AUTO_HANDOVER_DELAY_SEC` 秒（デフォルト 90）続いたタイミングで自動生成されます
     - **Claude Code**: `.claude/settings.json` の `SessionEnd` hook で `bash .claude/hooks/auto-handover.sh` を実行してください
   - 注意: 自動生成は `claude -p` を呼ぶためトークンを消費します

---

## 🥋 JujutsuによるAI-firstセッション管理

Brainbaseは **Jujutsu (jj)** を採用し、AIエージェントに最適化されたセッション管理を実現しています。

### Jujutsuとは？

[Jujutsu](https://jj-vcs.github.io/jj/latest/) は、Git互換の次世代バージョン管理システムです。**AIエージェントにとって嬉しい**機能が多数搭載されています。

| 機能 | 説明 | AIにとってのメリット |
|------|------|-------------------|
| **Working-copy-as-a-commit** | 変更が自動的にコミットとして扱われる | セッション中断しても変更が失われない |
| **Operation log** | 全操作履歴が記録される | いつ何をやったか完全に追跡可能 |
| **Undo** | いつでも操作を取り消せる | ミスっても復元可能 |
| **Conflicts as first-class** | コンフリクトを先送り可能 | 詰まらずに作業継続 |
| **Colocated repo** | Gitと同じディレクトリで共存 | 既存Git環境と互換 |

### なぜJujutsuなのか？

**従来のGit（worktree）の問題**:
- セッション中断 → 未コミット変更が失われるリスク
- AIが何をやったか追跡困難（reflogは人間向け）
- コンフリクトで作業が止まる

**Jujutsuの解決策**:
```
Git worktree:
  未コミット変更 → 失われる可能性

Jujutsu workspace:
  未コミット変更 → 自動的にコミットとして保存
  操作履歴 → operation logで完全追跡
```

### セッション管理フロー

Brainbaseの「Merge to Main」ボタンは、以下のJujutsuワークフローを自動実行します：

```
┌─────────────────────────────────────────────────────────────┐
│  1. セッション開始                                            │
│     jj workspace add --name <session-id> <path>             │
│     jj bookmark create -r main <session-id>                 │
│                                                             │
│  2. 作業（Working-copy-as-a-commit）                         │
│     変更が自動的にコミットとして扱われる                        │
│     セッション中断しても変更は保持される                        │
│                                                             │
│  3. マージ（Merge to Main）                                   │
│     jj git push --bookmark <session-id>                     │
│     gh pr create → gh pr merge                              │
│                                                             │
│  4. クリーンアップ                                            │
│     jj workspace forget <session-id>                        │
│     jj bookmark delete <session-id>                         │
│     rm -rf <workspace-path>                                 │
└─────────────────────────────────────────────────────────────┘
```

### Workspace vs Git Worktree

| 項目 | Git worktree | Jujutsu workspace |
|------|-------------|-------------------|
| 物理ディレクトリ | 別の場所に作成 | 別の場所に作成 |
| リポジトリ共有 | 各worktree独立 | **全workspace共通** |
| 履歴管理 | reflog（人間向け） | **operation log（機械可読）** |
| undo | worktree単位 | **リポジトリ全体**で可能 |

### インストール

```bash
# macOS
brew install jj

# Linux
cargo install jj-cli

# 確認
jj version
```

### 既存リポジトリへの導入

```bash
cd /path/to/your/repo

# GitリポジトリにJujutsuを初期化（共存可能）
jj git init

# 確認
jj workspace list
# default: xxxxxx (no description set)
```

### よく使うコマンド

```bash
# ワークスペース作成
jj workspace add --name my-session /path/to/workspace

# ステータス確認
jj status

# 変更をコミット（明示的に）
jj commit -m "feat: 新機能追加"

# 操作履歴確認
jj op log

# 最後の操作を取り消し
jj undo

# ブックマーク（ブランチ相当）をpush
jj git push --bookmark my-session
```

### 注意点

- Jujutsuは **Apache 2.0ライセンス**（商用利用可能）
- 既存のGitリポジトリと**共存可能**（colocated repo）
- GitHub連携は `jj git push` / `jj git fetch` で可能

詳細: [Jujutsu公式ドキュメント](https://jj-vcs.github.io/jj/latest/)

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
- [git worktree ガイド](./docs/git-worktree-guide.md) - worktree詳細説明（レガシー）
- [Jujutsu公式ドキュメント](https://jj-vcs.github.io/jj/latest/) - AI-first VCS

---

## 🔮 Coming Soon

Brainbaseは今後、以下の機能拡張を予定しています：

### `/ohayo` コマンド（Google Calendar連携）

Claude CodeでMCPを使用してGoogle Calendarと連携し、今日の予定をタスクとして取り込むことができます。

```bash
# Claude Codeで実行
/ohayo
```

**フロー**:
1. Google Calendar MCPを通じてClaudeが今日の予定を読み取る
2. 予定を `data/_tasks/index.md` にタスクとして自動追加
3. Brainbase UIでタスク・タイムラインとして表示

> **Note**: この機能を使用するにはGoogle Calendar MCPサーバーの設定が必要です。

### その他の予定機能

- 📬 **Slack連携**: @メンションを受信箱に自動蓄積
- ⏰ **リマインダー**: 期限間近タスクの自動通知
- 📝 **会議議事録**: 音声ファイルからの自動議事録生成

これらの機能はプラグイン形式で提供予定です。

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

**A**: ファイアウォール設定を確認し、ポート31013が開放されているか確認してください。
```bash
# macOS
sudo lsof -i :31013

# ローカルIPアドレス確認
ifconfig | grep "inet "
```

### Q4: Jujutsu workspaceが作成されない

**A**: Jujutsuがインストールされ、リポジトリで初期化されているか確認してください。
```bash
# Jujutsuのバージョン確認
jj version

# リポジトリで初期化済みか確認
jj workspace list
# → "default: ..." が表示されればOK

# 未初期化の場合
jj git init
```

### Q5: Git worktreeを使いたい（Jujutsuを使いたくない）

**A**: Jujutsuはオプションです。従来のGit worktreeも引き続き利用可能です。ただし、AIエージェントによる自動管理を活用するにはJujutsuを推奨します。`

### Q6: `./setup.sh`を実行せずに起動できますか？

**A**: 可能です。以下を手動で実行してください:
```bash
mkdir -p data var
cp state.sample.json var/state.json
cp -r _tasks-sample data/_tasks
cp -r _schedules-sample data/_schedules
cp -r _inbox-sample data/_inbox
cp config.sample.yml data/config.yml
```

その他のトラブルは [Issues](https://github.com/Unson-LLC/brainbase/issues) で報告してください。

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

🤖 Built with [Claude Code](https://claude.com/claude-code)
