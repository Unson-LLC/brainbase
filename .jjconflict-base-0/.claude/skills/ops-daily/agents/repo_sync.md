---
name: repo-sync-teammate
description: 全リポジトリを最新状態に同期し、dirty状態を検出
tools: Bash, Read
---

# repo-sync-teammate

## Purpose

全リポジトリを最新状態に同期し、dirtyなリポジトリを検出。

## Input

- なし

## Process

### Step 1: カレントディレクトリ確認

```bash
pwd
```

**重要**: `/Users/ksato/workspace` ディレクトリから実行する必要がある。
worktreeから実行する場合はcdで移動。

### Step 2: update-all-repos.sh 実行

```bash
cd /Users/ksato/workspace && ./shared/_codex/common/ops/scripts/nocodb/update-all-repos.sh
```

**出力例**:
```
=== Updating all repositories ===
✅ brainbase: Already up to date
✅ salestailor: Already up to date
⚠️ tech-knight: Dirty (uncommitted changes)
❌ zeims: Pull failed (merge conflict)
```

### Step 3: 結果の解析

スクリプト出力から以下を抽出:
- 成功したリポジトリ（✅）
- dirtyなリポジトリ（⚠️）
- 失敗したリポジトリ（❌）

### Step 4: team lead に報告

```javascript
SendMessage({
  type: "message",
  recipient: "team-lead",
  summary: "リポジトリ同期完了",
  content: JSON.stringify({
    success: 5,
    dirty: ["tech-knight"],
    failed: []
  })
})
```

## Output

team lead への SendMessage:
```json
{
  "success": 5,
  "dirty": ["tech-knight"],
  "failed": []
}
```

## Success Criteria

- [✅] SC-1: update-all-repos.sh 実行成功
- [✅] SC-2: dirty/失敗リポジトリのリスト取得
- [✅] SC-3: team lead への SendMessage 完了

## Output to Team Lead

**成功時**:
```
✅ リポジトリ同期完了

結果:
- 成功: 5件
- Dirty: 1件（tech-knight）
- 失敗: 0件

次のアクション: tech-knight リポジトリの確認が必要
```

**失敗時（スクリプト実行失敗）**:
```
❌ リポジトリ同期失敗

エラー: update-all-repos.sh 実行失敗
詳細: {エラーメッセージ}

次のアクション: 手動実行を推奨
```

## Review & Replan Considerations

### Critical条件（再実行）

- スクリプト実行失敗（exit code != 0）
- 出力パース失敗

### Minor条件（警告+進行）

- Dirtyなリポジトリあり
- Pull失敗したリポジトリあり

### None条件（正常終了）

- 全リポジトリ同期成功
- Dirty/失敗なし
