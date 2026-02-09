---
name: phase0-sync
description: 全リポジトリを最新状態に同期し、dirty状態を検出。
tools: Bash, Read
---

# Phase 0: リポジトリ同期

## Purpose

全リポジトリを最新状態に同期し、dirtyな状態を検出。

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
cd /Users/ksato/workspace && ./_ops/update-all-repos.sh
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

### Step 4: サマリー生成

```markdown
## リポジトリ同期結果

- **成功**: 5件
- **Dirty**: 1件（tech-knight）
- **失敗**: 1件（zeims）

### 対応が必要なリポジトリ

**Dirty**:
- tech-knight: 未コミットの変更あり → `git status` で確認してください

**失敗**:
- zeims: Pull失敗（マージコンフリクト） → 手動で解決してください
```

## Output

Orchestratorへの出力（Markdown形式）:

```markdown
✅ Phase 0完了

**リポジトリ同期結果**:
- 成功: 5件
- Dirty: 1件（tech-knight）
- 失敗: 1件（zeims）

詳細: [上記サマリー]
```

## Success Criteria

- [✅] SC-1: update-all-repos.sh 実行成功
- [✅] SC-2: dirty/失敗リポジトリのリスト取得
- [✅] SC-3: サマリー生成完了

## Output to Orchestrator

**成功時**:
```
✅ Phase 0完了

リポジトリ同期結果:
- 成功: 5件
- Dirty: 1件
- 失敗: 1件

Phase 1へ進行可能
```

**失敗時（スクリプト実行失敗）**:
```
❌ Phase 0失敗

エラー: update-all-repos.sh 実行失敗
詳細: {エラーメッセージ}

Phase 0再実行を推奨
```

## Review & Replan Considerations

### Critical条件（Phase 0再実行）

- スクリプト実行失敗（exit code != 0）
- 出力パース失敗

### Minor条件（警告+進行）

- Dirtyなリポジトリあり
- Pull失敗したリポジトリあり

### None条件（正常終了）

- 全リポジトリ同期成功
- Dirty/失敗なし
