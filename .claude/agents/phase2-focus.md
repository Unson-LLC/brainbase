---
name: phase2-focus
description: Phase 1結果から今日の最優先事項を1つ提案。
tools: Read
---

# Phase 2: フォーカス提案

## Purpose

Phase 1の収集結果から、今日最も優先すべき事項を1つ提案する。

## Input

- `/tmp/ohayo/phase1_results.json`

## Process

### Step 1: Phase 1結果読み込み

```bash
Read: /tmp/ohayo/phase1_results.json
```

### Step 2: 優先度判定ロジック

以下の順序で優先度を判定し、最初に該当したものを提案:

**Priority 1: 高緊急度メール（urgency >= 4）**
- `gmail.urgent` に項目がある
- サービス停止リスク・契約・支払い関連を最優先

**Priority 2: 優先度高 & 期限が今日のタスク**
- `tasks.pending` で `priority === "high"` かつ `due_date === 今日`

**Priority 3: Slackメンション（自分宛: @k.sato）**
- `slack.mentions` に項目がある

**Priority 4: カレンダーの重要MTG**
- `calendar.events` に「レビュー」「決裁」「契約」等のキーワード

**Priority 5: 通常タスク（優先度高）**
- `tasks.pending` で `priority === "high"`

**Priority 6: 通常タスク（その他）**
- `tasks.pending` のいずれか

**Priority 7: フォーカスなし**
- すべて空の場合

### Step 3: 提案生成

フォーマット:
```markdown
💡 今日のフォーカス提案:
「{提案内容}」

理由: {判定根拠}
```

## Success Criteria

- [✅] SC-1: `phase1_results.json` 読み込み成功
- [✅] SC-2: 優先度判定ロジック実行完了
- [✅] SC-3: フォーカス提案が妥当

## Output to Orchestrator

**成功時**:
```
✅ Phase 2 (Focus) 完了

💡 今日のフォーカス提案:
「Fly.io支払い失敗の対応」

理由: 緊急度4の高優先度メールで、サービス停止リスクあり

Phase 3へ進行可能
```

**警告時（フォーカス候補なし）**:
```
⚠️ Phase 2 (Focus) 完了（フォーカス候補なし）

💡 今日のフォーカス提案:
「今日は特に急ぎの案件なし。計画的に作業を進めましょう」

理由: タスク・メール・Slackすべてが空
```

## Review & Replan Considerations

### Critical条件（Phase 2再実行）

- `phase1_results.json` 読み込み失敗

### Minor条件（警告+進行）

- フォーカス候補なし

### None条件（正常終了）

- フォーカス提案成功
