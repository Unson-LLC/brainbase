---
name: branch-worktree-rules
description: brainbaseにおけるブランチ運用とworktree管理のルール。正本ディレクトリのシンボリックリンク方式、コミット先の分離を定義。worktreeで作業する際に使用。
---

## Triggers

以下の状況で使用：
- worktreeで作業を開始するとき
- コミット先を確認したいとき
- セッションブランチを作成したいとき

# ブランチ・Worktree運用ルール

brainbase-uiのセッション管理とgit worktree運用の標準ルールです。

## 基本原則

**ファイルの性質によってコミット先を分離する:**

| ファイル種別 | 性質 | コミット先 |
|-------------|------|------------|
| 正本ディレクトリ | 全セッションで共有 | main直接 |
| プロジェクトコード | ブランチごとに異なりうる | セッションブランチ |

---

## 正本ディレクトリの定義

以下は「正本」として、全worktreeで共有される：

```
/Users/ksato/workspace/
├── _codex/          # ナレッジ正本
├── _tasks/          # タスク正本
├── _inbox/          # 受信箱
├── _schedules/      # スケジュール
├── _ops/            # 共通スクリプト
├── .claude/         # Claude設定・Skills
└── config.yml       # 設定ファイル
```

**正本の特徴:**
- 常に最新を全セッションで共有したい
- ブランチ分岐の対象ではない
- mainに直接コミットする

---

## Worktree構造（シンボリックリンク方式）

worktree作成時、正本ディレクトリはシンボリックリンクで正本パスを参照：

```
/Users/ksato/workspace/.worktrees/session-xxx/
├── _codex -> /Users/ksato/workspace/_codex      # シンボリックリンク
├── _tasks -> /Users/ksato/workspace/_tasks      # シンボリックリンク
├── _inbox -> /Users/ksato/workspace/_inbox      # シンボリックリンク
├── _schedules -> /Users/ksato/workspace/_schedules
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

---

## コミットフロー

### 1. プロジェクトコード（セッションブランチ経由）

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

### 2. 正本ファイル（main直接コミット）

```
worktreeで編集（シンボリックリンク経由）→ mainで直接コミット
```

```bash
# 正本ファイルを編集（シンボリックリンク経由で自動的に正本を編集）
vim _codex/projects/salestailor/project.md
vim .claude/skills/new-skill/SKILL.md

# mainに直接コミット
cd /Users/ksato/workspace
git add _codex/ .claude/
git commit -m "docs: ナレッジ追加"
```

---

## /merge コマンドの動作

セッション終了時の `/merge` コマンドは以下を実行：

1. **セッションブランチの変更確認**
   - プロジェクトコードの変更があればセッションブランチにコミット

2. **正本の変更確認**
   - 正本ディレクトリの変更があればmainに直接コミット
   - 「正本の変更をmainにコミットしますか？」と確認

3. **マージ実行**
   - セッションブランチをmainにマージ

---

## Worktree作成時のセットアップ

brainbase-uiがworktree作成時に自動実行：

```bash
# worktree作成
git worktree add .worktrees/session-xxx -b session/session-xxx

# シンボリックリンク作成
cd .worktrees/session-xxx
rm -rf _codex _tasks _inbox _schedules _ops .claude config.yml
ln -s /Users/ksato/workspace/_codex _codex
ln -s /Users/ksato/workspace/_tasks _tasks
ln -s /Users/ksato/workspace/_inbox _inbox
ln -s /Users/ksato/workspace/_schedules _schedules
ln -s /Users/ksato/workspace/_ops _ops
ln -s /Users/ksato/workspace/.claude .claude
ln -s /Users/ksato/workspace/config.yml config.yml
```

---

## ルールまとめ

| 状況 | 編集場所 | コミット先 |
|-----|---------|------------|
| Skills追加・更新 | worktree内（シンボリックリンク経由） | main直接 |
| タスク更新 | worktree内（シンボリックリンク経由） | main直接 |
| ナレッジ追加 | worktree内（シンボリックリンク経由） | main直接 |
| プロジェクトコード | worktree内（実ファイル） | セッションブランチ |
| 設定ファイル変更 | worktree内（シンボリックリンク経由） | main直接 |

---

## よくある質問

### Q: セッションブランチで正本を編集したらどうなる？

A: シンボリックリンク方式では、正本ディレクトリはworktreeにコピーされないため、「セッションブランチで正本を編集」という状況は発生しません。正本の編集は常にmainのファイルを直接編集することになります。

### Q: 正本の変更をセッションブランチでレビューしたい場合は？

A: 正本の変更は即座に反映されるべきナレッジなので、通常はmain直接コミットで問題ありません。レビューが必要な大きな変更の場合は、一時的にシンボリックリンクを解除して実ファイルとして編集し、セッションブランチでコミット→マージの流れも可能です。

### Q: コンフリクトは発生する？

A: 正本ファイルは常にmainに直接コミットされるため、ブランチ間のコンフリクトは発生しません。プロジェクトコードのみがセッションブランチ経由となります。

---

最終更新: 2025-12-09
