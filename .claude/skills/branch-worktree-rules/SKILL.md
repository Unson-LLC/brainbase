---
name: branch-worktree-rules
description: brainbaseにおけるブランチ運用とworktree管理のルール。セッションベースワークフロー、コミット先の確認、パス解決を定義。worktreeで作業する際に使用。
---

# ブランチ・Worktree運用ルール

brainbase-uiのセッション管理とgit worktree運用の標準ルールです。

## Instructions

### 1. セッションベースワークフロー

```
セッション開始
  └─ worktree作成 + session/{id} ブランチ自動作成

作業中
  └─ session/{id} ブランチにコミット（小さく・こまめに）

セッション終了（アーカイブ）
  └─ UIで「アーカイブ」→ mainへマージ
  └─ マージコミット: "Merge session: {name}"
  └─ worktree削除
```

### 2. コミット先の確認

**重要**: コミット前に現在のブランチを確認すること。

```bash
git branch
# * session/session-XXXX  ← これにコミット（正しい）
# main ← 直接コミットしない
```

### 3. ブランチ運用ルール

| 状況 | コミット先 | マージ方法 |
|-----|----------|-----------|
| セッション内の通常作業 | `session/{id}` | UIからアーカイブ時にマージ |
| 緊急hotfix | `main` 直接可 | - |
| セッション外の軽微修正 | `main` 直接可 | - |

### 4. mainへの直接コミットが許容されるケース

- 緊急のhotfix（本番障害対応など）
- セッション外での軽微な修正（typo、設定値変更）
- CI/CD関連の設定変更

### 5. Worktree運用時のパス解決

brainbase-uiでセッションを開始すると、`.worktrees/` 配下にgit worktreeが作成される。

**正本パスは常に `/Users/ksato/workspace/` を使用**：

| ファイル種別 | 参照先 |
|-------------|--------|
| 正本（_codex, _tasks, _inbox） | `/Users/ksato/workspace/` |
| プロジェクトコード | worktree内（`.worktrees/<session>/`） |
| 共通スクリプト（_ops） | `/Users/ksato/workspace/_ops/` |
| スケジュール（_schedules） | `/Users/ksato/workspace/_schedules/` |

### 6. workspaceスクリプトの実行

`_ops/update-all-repos.sh` などのスクリプトは**必ず `/Users/ksato/workspace/` から実行**：

```bash
# worktreeから実行する場合
cd /Users/ksato/workspace && ./_ops/update-all-repos.sh
```

理由: スクリプトがカレントディレクトリからの相対パスで `.git` を探すため

### 7. アーカイブ時の注意

- 未コミットの変更がある場合、UIで確認ダイアログが表示される
- マージ前にdry-runでコンフリクトチェックが行われる
- コンフリクト発生時は手動解決が必要

## Examples

### 例1: セッション内での作業

```bash
# 現在のブランチを確認
git branch
# * session/session-1765194163310

# 変更をコミット
git add .
git commit -m "feat: 機能追加..."

# pushは不要（ローカルworktree）
```

### 例2: 正本ファイルの編集

```bash
# worktree内からでも、正本は絶対パスで参照
cat /Users/ksato/workspace/_tasks/index.md

# 編集も絶対パスで
vim /Users/ksato/workspace/_codex/projects/salestailor/project.md
```

### 例3: リポジトリ同期

```bash
# worktreeから同期スクリプトを実行
cd /Users/ksato/workspace && ./_ops/update-all-repos.sh

# 元のworktreeに戻る
cd /Users/ksato/workspace/.worktrees/session-1765194163310-brainbase-ui
```

### よくある失敗パターン

**❌ 失敗例1: worktreeから相対パスでスクリプト実行**
```bash
./_ops/update-all-repos.sh  # ❌ 失敗
```
→ **修正**: `cd /Users/ksato/workspace && ./_ops/update-all-repos.sh`

**❌ 失敗例2: worktree側の正本を編集**
```bash
vim _tasks/index.md  # ❌ worktree側のコピーを編集
```
→ **修正**: `vim /Users/ksato/workspace/_tasks/index.md`

**❌ 失敗例3: mainに直接コミット（セッション中）**
```bash
git checkout main && git commit  # ❌
```
→ **修正**: セッションブランチにコミット

---

このルールに従うことで、worktreeとブランチの混乱を防げます。
