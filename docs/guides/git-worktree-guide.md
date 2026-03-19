# brainbase Git Worktree運用ガイド

**バージョン**: 1.0.0
**作成日**: 2026-01-11
**対象**: brainbaseプロジェクト開発者、コントリビューター

---

## 目次

1. [Worktreeとは？](#1-worktreeとは)
2. [セットアップ](#2-セットアップ)
3. [運用フロー](#3-運用フロー)
4. [トラブルシューティング](#4-トラブルシューティング)
5. [ベストプラクティス](#5-ベストプラクティス)

---

## 1. Worktreeとは？

### 1.1 概要

**Git Worktree**は、1つのリポジトリで複数のブランチを同時に扱える機能です。

**従来の方法**:
```bash
# ブランチ切り替えで作業ディレクトリが変わる
git checkout main
git checkout session/feature-A
git checkout session/feature-B  # ❌ 毎回切り替えが必要
```

**Worktreeの方法**:
```bash
# 各ブランチが独立したディレクトリで作業可能
cd /main-branch/              # mainブランチ
cd /worktrees/feature-A/      # feature-Aブランチ
cd /worktrees/feature-B/      # feature-Bブランチ  # ✅ 同時に開ける
```

### 1.2 brainbaseでの採用理由

| 課題 | Worktreeによる解決 |
|------|-------------------|
| 複数セッションの並行開発 | 各セッションが独立したディレクトリで作業可能 |
| ブランチ切り替えのコスト | 切り替えなしで複数ブランチにアクセス |
| mainとの比較・参照 | mainディレクトリと並列で参照可能 |
| IDE設定の維持 | 各worktreeで独立したIDE設定を保持 |

### 1.3 ディレクトリ構造

```
/Users/ksato/workspace/shared/
├── brainbase/                          # メインリポジトリ（mainブランチ）
│   ├── .git/                           # Gitメタデータ（実体）
│   ├── public/
│   ├── server/
│   └── package.json
│
└── .worktrees/                         # Worktree専用ディレクトリ
    ├── session-1767361754399-brainbase/  # セッションworktree
    │   ├── .git                          # Gitメタデータ（リンク）
    │   ├── public/
    │   ├── server/
    │   └── package.json
    │
    └── session-1767362000000-brainbase/  # 別のセッションworktree
        └── ...
```

**重要**: `.git`の実体はメインリポジトリにあり、worktreeは`.git`ファイル（リンク）を持つ。

---

## 2. セットアップ

### 2.1 新規Worktree作成

**基本コマンド**:
```bash
cd /Users/ksato/workspace/shared/brainbase

# session/* ブランチでworktree作成
git worktree add .worktrees/session-XXXXXXX session/XXXXXX
```

**AITMダッシュボード開発の例**:
```bash
# セッションブランチ作成（まだworktreeなし）
git checkout -b session/session-1767361754399

# worktree作成
git worktree add .worktrees/session-1767361754399-brainbase session/session-1767361754399

# 作成されたworktreeに移動
cd .worktrees/session-1767361754399-brainbase
```

### 2.2 Worktree一覧確認

```bash
# 全worktreeを表示
git worktree list

# 出力例:
# /Users/ksato/workspace/shared/brainbase        abc1234 [main]
# /Users/ksato/workspace/shared/.worktrees/...  def5678 [session/session-1767361754399]
```

### 2.3 依存関係のインストール

```bash
cd .worktrees/session-XXXXXXX-brainbase

# Node.js依存関係
npm install

# Python依存関係（必要な場合）
source /Users/ksato/workspace/.venv/bin/activate
pip install -r requirements.txt
deactivate
```

---

## 3. 運用フロー

### 3.1 新規機能開発フロー

**ステップ1: セッションブランチ作成**
```bash
# メインリポジトリで作業
cd /Users/ksato/workspace/shared/brainbase
git checkout main
git pull origin main

# 新規セッションブランチ作成
TIMESTAMP=$(date +%s)000
git checkout -b session/session-${TIMESTAMP}
```

**ステップ2: Worktree作成**
```bash
# worktree作成
git worktree add .worktrees/session-${TIMESTAMP}-brainbase session/session-${TIMESTAMP}

# worktreeに移動
cd .worktrees/session-${TIMESTAMP}-brainbase
```

**ステップ3: 開発実施**
```bash
# 依存関係インストール
npm install

# 開発サーバー起動（worktreeは手動起動）
PORT=31014 npm run dev  # 他worktreeと被る場合は31015以降

# 開発実施
# ファイル編集、テスト、デバッグ等
```

**ステップ4: コミット**
```bash
# ステージング
git add .

# コミット（Conventional Commits形式）
git commit -m "$(cat <<'EOF'
feat(dashboard): Section 1 - Critical Alerts実装

- EventBus統合
- NocoDBService呼び出し
- UI Components実装

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

**ステップ5: Push**
```bash
# リモートにpush
git push origin session/session-${TIMESTAMP}
```

**ステップ6: マージ**
```bash
# mainブランチに戻る
cd /Users/ksato/workspace/shared/brainbase
git checkout main

# マージ（--no-ff で merge commit作成）
git merge --no-ff session/session-${TIMESTAMP}

# リモートにpush
git push origin main
```

**ステップ7: Worktree削除**
```bash
# worktree削除
git worktree remove .worktrees/session-${TIMESTAMP}-brainbase

# セッションブランチ削除（ローカル）
git branch -d session/session-${TIMESTAMP}

# セッションブランチ削除（リモート）
git push origin --delete session/session-${TIMESTAMP}
```

### 3.2 複数worktreeの並行開発

**例**: Week 11-12実装とバグ修正を並行

```bash
# Week 11-12実装用worktree
cd .worktrees/session-1767361754399-brainbase
# API.md作成中...

# 別ターミナルでバグ修正用worktree
cd .worktrees/session-1767362000000-brainbase
# バグ修正中...

# 両方のworktreeが独立して作業可能
```

---

## 4. トラブルシューティング

### 4.1 Worktreeが削除できない

**症状**:
```bash
git worktree remove .worktrees/session-XXXXXXX-brainbase
# error: 'remove' is not locked
```

**原因**:
- worktree内で実行している
- ファイルシステムのロック

**対処**:
```bash
# 1. worktree外に移動
cd /Users/ksato/workspace/shared/brainbase

# 2. 強制削除
git worktree remove --force .worktrees/session-XXXXXXX-brainbase

# 3. それでも削除できない場合
rm -rf .worktrees/session-XXXXXXX-brainbase
git worktree prune  # 不要なworktree参照を削除
```

### 4.2 ブランチが切り替わらない

**症状**:
```bash
git checkout main
# error: Your local changes to the following files would be overwritten
```

**原因**:
- worktree内で変更がコミットされていない

**対処**:
```bash
# 1. 変更をstash
git stash

# 2. ブランチ切り替え
git checkout main

# 3. 必要に応じてstash適用
git stash pop
```

### 4.3 Worktreeのブランチが表示されない

**症状**:
```bash
git branch
# session/session-XXXXXXX が表示されない
```

**原因**:
- worktree内でブランチを確認している
- リモートブランチが表示されていない

**対処**:
```bash
# リモートブランチも表示
git branch -a

# 特定のworktreeのブランチ確認
git worktree list
```

### 4.4 .gitファイルが壊れた

**症状**:
```bash
cd .worktrees/session-XXXXXXX-brainbase
git status
# fatal: not a git repository
```

**原因**:
- `.git`ファイル（リンク）が削除された
- メインリポジトリの`.git/worktrees/`が壊れた

**対処**:
```bash
# 1. worktree削除
cd /Users/ksato/workspace/shared/brainbase
git worktree remove --force .worktrees/session-XXXXXXX-brainbase

# 2. worktree再作成
git worktree add .worktrees/session-XXXXXXX-brainbase session/session-XXXXXXX

# 3. 変更を復元（必要に応じて）
cd .worktrees/session-XXXXXXX-brainbase
git stash pop  # または手動で復元
```

### 4.5 開発サーバーが起動しない（ポート競合）

**症状**:
```bash
npm run dev
# error: listen EADDRINUSE: address already in use :::31014
```

**原因**:
- 指定ポートが既に使用されている
- 他のworktreeや起動中プロセスと競合している

**対処**:
```bash
# 1. 使用中ポート確認
lsof -nP -iTCP:31014 -sTCP:LISTEN

# 2. 別ポートで再起動
PORT=31015 npm run dev
```

---

## 5. ベストプラクティス

### 5.1 Worktree命名規則

**推奨**:
```
session-{timestamp}-brainbase
```

**理由**:
- `session-`: セッションブランチであることを明示
- `{timestamp}`: 一意性を保証（タイムスタンプ）
- `-brainbase`: プロジェクト名を明記

**例**:
```bash
# Good
session-1767361754399-brainbase

# Bad
my-feature  # ❌ プロジェクト名がない
brainbase-dev  # ❌ 一意性がない
```

### 5.2 Worktreeの定期クリーンアップ

**定期的に不要なworktreeを削除**:
```bash
# 不要なworktree削除
git worktree prune

# 古いworktreeを手動削除
rm -rf .worktrees/session-OLD-brainbase
```

**理由**:
- ディスク容量の節約
- worktree一覧の整理
- `.git/worktrees/`の肥大化防止

### 5.3 Worktree間でのファイル比較

**メインブランチとの差分確認**:
```bash
# worktree内で実行
cd .worktrees/session-XXXXXXX-brainbase

# mainブランチとの差分
git diff main

# 特定ファイルの差分
git diff main -- public/index.html
```

**別worktreeとの比較**:
```bash
# ファイル比較
diff /Users/ksato/workspace/shared/brainbase/public/index.html \
     .worktrees/session-XXXXXXX-brainbase/public/index.html
```

### 5.4 Worktree作成の自動化

**エイリアス設定**:
```bash
# ~/.gitconfig または ~/.zshrc に追加
alias gwt-add='git worktree add .worktrees/session-$(date +%s)000-brainbase session/session-$(date +%s)000'
alias gwt-list='git worktree list'
alias gwt-remove='git worktree remove'
```

**使用例**:
```bash
# 新規worktree作成
gwt-add

# worktree一覧
gwt-list

# worktree削除
gwt-remove .worktrees/session-XXXXXXX-brainbase
```

---

## よくある質問（FAQ）

**Q: Worktreeとブランチの違いは？**
A: ブランチは作業履歴の分岐。Worktreeは複数のブランチを同時に扱うための作業ディレクトリ。

**Q: Worktreeを削除すると、ブランチも削除される？**
A: いいえ。Worktreeは作業ディレクトリのみ削除されます。ブランチは残ります。

**Q: Worktree間で変更を共有できる？**
A: いいえ。各worktreeは独立しています。共有するにはコミット→push→pullが必要です。

**Q: mainブランチでもworktreeを作成できる？**
A: はい。ただし、brainbaseでは通常mainブランチはメインリポジトリで作業します。

**Q: Worktreeの数に制限はある？**
A: 技術的には無制限ですが、ディスク容量とパフォーマンスを考慮して適切な数を維持してください。

**Q: Worktree削除後、ブランチをどうする？**
A: マージ済みの場合は削除してOK。未マージの場合は、必要に応じて保持または新しいworktreeを作成。

---

**最終更新**: 2026-01-11
**作成者**: Unson LLC
**フィードバック**: 改善提案は GitHub Issues へ
