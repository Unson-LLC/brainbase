---
name: dev-server-worktree
description: worktreeで開発サーバーを起動し、本番環境のデータをコピーしてテスト環境を構築
version: 1.0.0
trigger: /dev-server-worktree
---

# Dev Server for Worktree

worktreeディレクトリで開発サーバーを起動し、本番環境のデータをコピーしてテスト環境を構築するSkill。

## 目的

- **問題**: 本番環境（localhost:31013）にマージせずにテストしたい
- **解決**: 別ポート（31014以降）でテスト環境を起動し、本番環境のデータをコピー

## 機能

1. **空きポート検出**: 31014以降で空いているポートを自動検出
2. **データコピー**: 本番環境のデータを`/tmp/brainbase-test-{PORT}/`にコピー
3. **開発サーバー起動**: コピーしたデータを参照して起動
4. **ブラウザ自動オープン**: 起動完了後、ブラウザで自動オープン

## 使い方

```bash
# worktreeディレクトリで
/dev-server-worktree

# → 空きポート検出（例: 31014）
# → 本番環境データをコピー
# → localhost:31014 で起動
# → ブラウザで自動オープン✨
```

## 実装スクリプト

`.claude/scripts/dev-server-worktree.sh`

## 停止方法

```bash
# 起動したポートのプロセスを停止
lsof -ti:31014 | xargs kill -9

# テストデータを削除
rm -rf /tmp/brainbase-test-31014/
```

## データコピー方針

**コピー対象**:
- セッション情報（`_sessions/`）
- タスク情報（`_tasks/`）
- スケジュール情報（`_schedule/`）
- NocoDB データ（必要に応じて）

**コピー元**:
- `/Volumes/UNSON-DRIVE/brainbase/` （本番環境のBRAINBASE_ROOT）

**コピー先**:
- `/tmp/brainbase-test-{PORT}/`

**最適化**:
- 静的ファイル（public/）はシンボリックリンクで共有

## 環境変数

テスト環境では以下の環境変数を設定：
```bash
PORT={動的に検出したポート}
BRAINBASE_ROOT=/tmp/brainbase-test-{PORT}/
NODE_ENV=development
```

## 注意事項

- テスト環境は`/tmp/`配下なので、再起動時に削除される
- 本番環境のデータはコピー時点のスナップショット（最新ではない可能性）
- テスト環境でのデータ変更は本番環境に影響しない

## Future Enhancements

- UI統合（「Test Environment」ボタン）
- データ差分コピー（rsync等）
- テスト環境一覧表示（`/list-test-servers`）

## Implementation

このSkillが呼ばれたとき、以下のスクリプトを実行する：

```bash
./.claude/scripts/dev-server-worktree.sh
```

停止する場合：

```bash
# 例: ポート31014のサーバーを停止
./.claude/scripts/stop-dev-server.sh 31014
```

## Example

```bash
# worktreeディレクトリで
/dev-server-worktree

# 出力例:
# 🚀 Starting dev server for worktree...
# ✅ Found available port: 31014
# 📋 Copying data from production to test environment...
#    ✅ Copied _sessions/
#    ✅ Copied _tasks/
#    ✅ Copied _schedule/
# 🚀 Starting development server on port 31014...
#    ✅ Server started with PID: 12345
# 🌐 Opening browser...
# ✅ Dev server for worktree started successfully!
```
