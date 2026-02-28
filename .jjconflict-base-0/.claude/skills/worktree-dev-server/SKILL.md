---
name: worktree-dev-server
description: worktreeで開発サーバーを起動する際のポート競合回避と手順まとめ。
---

## Triggers

以下の状況で使用：
- worktreeから開発サーバーを起動したいとき
- ポート競合を回避したいとき
- 正本とは別のポートで起動する必要があるとき

# worktree開発サーバー起動

worktreeから開発サーバーを起動する際の手順。ポート競合を自動回避。

## 手順

### 1. ポート確認
```bash
lsof -i :3000 -i :3001 -i :3002 -i :3003 2>/dev/null | grep LISTEN
```

使用されていない最小のポートを選択（3001から開始、3000は正本用）

### 2. 依存関係インストール（node_modulesがない場合）
```bash
cd [プロジェクトディレクトリ] && npm install
```

### 3. 開発サーバー起動
```bash
PORT=[空きポート] npm run dev
```

バックグラウンドで起動する場合は `run_in_background: true` を使用

## ポート割り当てルール

| ポート | 用途 |
|--------|------|
| 3000 | 正本（main）の開発サーバー |
| 3001〜 | worktree用（競合時は次のポートを使用） |

## 例

```bash
# ポート確認
lsof -i :3001 2>/dev/null | grep LISTEN

# 空いていれば起動
cd /Users/ksato/workspace/.worktrees/session-xxx/brainbase-ui && npm install && PORT=3001 npm run dev
```

## 注意事項

- worktreeでは必ずポート3000以外を使用
- node_modulesはworktreeごとに独立（シンボリックリンクではない）
- 起動後はBashOutputで状態を確認
