---
name: phase1-gather
description: ファイル系タスク（タスク・Git・Slack・学習候補）を収集し、Phase 0.5で取得したMCPデータとマージしてphase1_results.jsonを生成
tools: [Read, Bash, Write, Grep]
---

# Phase 1: 情報収集（ファイル系タスク）

## Purpose

ファイル系の情報を収集し、Phase 0.5で取得したMCPデータとマージしてphase1_results.jsonを生成。

**重要**: SubagentはMCPツールにアクセスできないため、カレンダー・Gmailデータは既にPhase 0.5で取得済み。このPhaseではmcp_data.jsonから読み込んでマージする。

## Input

- `/tmp/ohayo/mcp_data.json`（Phase 0.5で生成、必須）

## Process

### Step 1: MCPデータ読み込み

```bash
Read: /tmp/ohayo/mcp_data.json
```

以下のデータを取得：
- `calendar`: カレンダーイベント（Phase 0.5で取得済み）
- `gmail`: Gmail自動振り分け結果（Phase 0.5で実行済み）

### Step 2: 未完了タスク取得

```bash
Read: /Users/ksato/workspace/shared/_tasks/index.md
```

YAML front matterから以下を抽出：
- `status: pending` または `status: in_progress` のタスク
- `title`, `priority`, `deadline`, `tags` を記録

### Step 3: 昨日の活動取得

```bash
cd /Users/ksato/workspace/shared && git log --since="yesterday 00:00" --until="today 00:00" --oneline
```

昨日のコミット一覧を取得（最大20件）。

### Step 4: Slack未対応メンション取得

```bash
Read: /Users/ksato/workspace/shared/_inbox/pending.json
```

JSON配列から以下を抽出：
- `status: "pending"` のSlackメンション
- 各エントリから `sender`, `channel`, `text`, `timestamp`, `slackLink` を記録

**ファイル形式**:
```json
[
  {
    "id": "INBOX-2026-01-12-ABC123",
    "channel": "dev",
    "sender": "田中太郎",
    "text": "@k.sato レビューお願いします",
    "timestamp": "1736640000.000000",
    "slackLink": "https://slack.com/archives/C123/p1736640000000000",
    "status": "pending",
    "createdAt": "2026-01-12T09:00:00.000Z"
  }
]
```

### Step 5: 学習候補確認

```bash
ls /Users/ksato/workspace/.claude/learning/learning_queue/ | wc -l
```

学習候補ファイル数をカウント。
- 3件以上の場合: `/learn-skills` 実行を提案（`suggest_learn: true`）
- 3件未満の場合: 提案なし（`suggest_learn: false`）

### Step 6: SNSバズ候補取得

```bash
Read: /Users/ksato/workspace/shared/_inbox/sns_candidates.md
```

Markdownから各カテゴリの候補を抽出：
- `## 🔍` セクションごとにカテゴリを識別
- 各カテゴリからScore上位3件を抽出（engagement順）
- 各候補から `投稿者名`, `Score`, `URL`, `投稿内容の冒頭50文字` を記録

**抽出ルール**:
- `**Score**:` 行からスコアを取得
- `**URL**:` 行からURLを取得
- `> ` 行から投稿本文を取得（50文字で切る）
- カテゴリ見出しの `## 🔍` からカテゴリ名を取得

### Step 7: データマージ

Step 1で読み込んだMCPデータ（カレンダー・Gmail）とStep 2-6で収集したファイル系データをマージ。

### Step 8: 結果JSON出力

```bash
Write: /tmp/ohayo/phase1_results.json
```

## Output Format

```json
{
  "timestamp": "2026-01-09T09:00:00+09:00",
  "calendar": {
    "events": [
      { "time": "10:00-11:00", "summary": "週次MTG", "location": "Google Meet" }
    ],
    "count": 3
  },
  "tasks": {
    "pending": [
      { "title": "タスク1", "priority": "high", "deadline": "2026-01-10", "tags": ["dev"] }
    ],
    "in_progress": [
      { "title": "タスク2", "priority": "medium", "deadline": null, "tags": [] }
    ],
    "count": 5
  },
  "git": {
    "commits": [
      "abc1234 feat(ohayo): Phase 1実装",
      "def5678 fix(gmail): ラベル適用修正"
    ],
    "count": 12
  },
  "slack": {
    "mentions": [
      {
        "from": "田中太郎",
        "channel": "#dev",
        "message": "@k.sato レビューお願いします",
        "timestamp": "2026-01-08T17:30:00+09:00"
      }
    ],
    "count": 2
  },
  "learning": {
    "queue_count": 3,
    "suggest_learn": true
  },
  "gmail": {
    "total": 30,
    "labeled": 17,
    "urgent": [
      {
        "account": "techknight",
        "from": "Fly.io",
        "subject": "Payment failed",
        "urgency": 4,
        "needsReply": true
      }
    ],
    "needs_reply": []
  },
  "sns_buzz": {
    "categories": [
      {
        "name": "English: AI Coding",
        "candidates": [
          { "author": "DavidKPiano", "score": 16574, "url": "https://x.com/...", "text": "Before AI coding agents..." }
        ]
      }
    ],
    "total_count": 9
  }
}
```

## Success Criteria

- [✅] SC-1: mcp_data.json 読み込み成功
- [✅] SC-2: 6タスク（タスク・Git・Slack・学習候補・SNSバズ・MCPマージ）すべて完了
- [✅] SC-3: phase1_results.json 生成成功（カレンダー・Gmail・SNSバズデータ含む）

## Error Handling

- **mcp_data.json不在**: 空のcalendar/gmailデータで続行（`{"calendar": {"events": [], "count": 0}, "gmail": {"total": 0, "labeled": 0, "urgent": [], "needs_reply": []}}`）
- **_tasks/index.md不在**: 空のtasksデータで続行（`{"pending": [], "in_progress": [], "count": 0}`）
- **git log失敗**: 空のgitデータで続行（`{"commits": [], "count": 0}`）
- **_inbox/pending.json不在**: 空のslackデータで続行（`{"mentions": [], "count": 0}`）
- **learning_queue不在**: `{"queue_count": 0, "suggest_learn": false}`
- **sns_candidates.md不在**: 空のsns_buzzデータで続行（`{"categories": [], "total_count": 0}`）

**重要**: 一部データ取得失敗でもphase1_results.jsonは必ず生成する。エラーが発生した項目は空データで記録し、続行する。
