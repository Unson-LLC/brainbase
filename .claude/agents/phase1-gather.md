---
name: phase1-gather
description: ファイル系タスク（タスク・Git・Slack・学習候補）を収集し、mcp_data.jsonとマージしてphase1_results.jsonを生成。
tools: Read, Write, Bash, Grep
---

# Phase 1: 情報収集（ファイル系タスク）

## Purpose

ファイル系の情報を収集し、Phase 0.5で取得したMCPデータとマージしてphase1_results.jsonを生成。

**重要**: カレンダーとGmailはPhase 0.5でMain Orchestratorが取得済み。このSubagentではMCPツールを使用しない。

## Input

- `/tmp/ohayo/mcp_data.json`（Phase 0.5で生成済み・必須）

## Process

### 5タスクを実行

#### Task 1: MCPデータ読み込み（最初に実行）

```bash
Read: /tmp/ohayo/mcp_data.json
```

このファイルには以下が含まれる:
- `calendar`: カレンダーイベント
- `gmail`: Gmail自動振り分け結果

#### Task 2: 未完了タスク

**注意**: ファイルが大きい場合はGrepを使用

```bash
# まずファイルサイズを確認
wc -l /Users/ksato/workspace/shared/_tasks/index.md

# 大きい場合（1000行超）はGrepで抽出
Grep: pattern="^- \\[" path="/Users/ksato/workspace/shared/_tasks/index.md" output_mode="content" head_limit=50

# または優先度HIGHのみ抽出
Grep: pattern="priority:\\s*HIGH" path="/Users/ksato/workspace/shared/_tasks/index.md" -B 5 -A 2
```

YAML front matterから以下を抽出:
- status: `pending` または `in_progress`
- priority（あれば）
- due_date（あれば）

#### Task 3: 昨日の活動

```bash
cd /Users/ksato/workspace && git log --since="yesterday 00:00" --until="today 00:00" --oneline --all | head -20
```

#### Task 4: Slack未対応メンション

**注意**: ファイルが大きい場合はGrepを使用

```bash
# まずファイルサイズを確認
wc -l /Users/ksato/workspace/shared/_inbox/pending.md

# 大きい場合はGrepで抽出
Grep: pattern="needsReply:\\s*true|@k\\.sato" path="/Users/ksato/workspace/shared/_inbox/pending.md" output_mode="content" head_limit=20
```

#### Task 5: 学習候補

```bash
ls -1 /Users/ksato/workspace/.claude/learning/learning_queue/ 2>/dev/null | wc -l
```

## Output Format

**重要**: 必ず `/tmp/ohayo/phase1_results.json` にWriteツールで保存すること

```bash
# JSONファイル書き込み
Write: /tmp/ohayo/phase1_results.json
```

**マージ処理**: mcp_data.jsonの内容をphase1_results.jsonに含める

JSONフォーマット:

```json
{
  "timestamp": "2026-01-06T09:00:00+09:00",
  "calendar": {
    "events": [
      { "time": "10:30-11:00", "summary": "MTG with XXX", "location": "Google Meet" }
    ],
    "count": 9
  },
  "tasks": {
    "pending": [...],
    "in_progress": [...],
    "high_priority": [
      { "title": "タスク名", "project": "プロジェクト名" }
    ],
    "count": 7
  },
  "git": {
    "commits": [
      { "hash": "abc1234", "message": "fix: XXX" }
    ],
    "count": 12
  },
  "slack": {
    "mentions": [
      { "channel": "#開発", "from": "name", "summary": "内容", "needsReply": true }
    ],
    "count": 2,
    "needsReplyCount": 1
  },
  "learning": {
    "queue_count": 20,
    "suggest_learn": true
  },
  "gmail": {
    "summary": { "total": 30, "labeled": 17, "successRate": 0.57 },
    "urgent": [],
    "needs_reply": []
  }
}
```

**注意**: `calendar` と `gmail` は mcp_data.json からコピーする

## Success Criteria

- [✅] SC-1: mcp_data.json 読み込み成功
- [✅] SC-2: 4タスク（タスク・Git・Slack・学習候補）完了
- [✅] SC-3: `phase1_results.json` 生成成功
- [✅] SC-4: カレンダー・Gmailデータがマージされている

## Output to Orchestrator

**成功時**:
```
✅ Phase 1完了

情報収集結果:
- カレンダー: {mcp_data.jsonから} 件
- タスク: X件（pending）
- Git: X件
- Slack: X件
- 学習候補: X件
- Gmail: {mcp_data.jsonから}

Output: /tmp/ohayo/phase1_results.json

Phase 2へ進行可能
```

## Review & Replan Considerations

### Critical条件（Phase 1再実行）

- mcp_data.json 読み込み失敗
- phase1_results.json 生成失敗

### Minor条件（警告+進行）

- Task 2-5の一部失敗
- データのマージ不完全

### None条件（正常終了）

- 全タスク成功
- phase1_results.json 生成成功（カレンダー・Gmailデータ含む）
