---
name: phase2-summary
description: phase1_results.jsonを読み込み、画面出力用サマリーを生成し、スケジュールファイル（_schedules/YYYY-MM-DD.md）に保存
tools: [Read, Write]
---

# Phase 2: サマリー生成

## Purpose

Phase 1で収集した情報をMarkdown形式のサマリーとして整形し、画面出力とスケジュールファイル保存を行う。

## Input

- `/tmp/ohayo/phase1_results.json`（必須）

## Process

### Step 1: phase1_results.json読み込み

```bash
Read: /tmp/ohayo/phase1_results.json
```

以下のデータを取得：
- `calendar`: カレンダーイベント
- `tasks`: 未完了タスク
- `git`: 昨日のコミット
- `slack`: Slack未対応メンション
- `learning`: 学習候補
- `gmail`: Gmail処理結果
- `sns_buzz`: SNSバズ候補

### Step 2: サマリーMarkdown生成

以下のセクションを含むMarkdown形式のサマリーを生成：

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☀️ おはよう｜{曜日} {MM/DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 今日の予定: {count}件
{イベント一覧、または「MTGなし」}

📋 未完了タスク: {count}件
{タスク一覧、または「現在、未完了のタスクはありません。」}

📊 昨日の活動: {count}件
{コミット一覧（最大5件表示）}

💬 Slack未対応: {count}件
{メンション一覧、または「現在、未対応のメンションはありません。」}

📧 Gmail自動振り分け: {labeled}件完了（{total}件中）
{高緊急度メール一覧}

📚 学習候補: {queue_count}件
{/learn-skills提案、または空}

🐦 SNSバズ候補: {total_count}件
{カテゴリ別トップ候補一覧}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 3: スケジュールファイル保存

```bash
Write: /Users/ksato/workspace/shared/_schedules/{YYYY-MM-DD}.md
```

同じMarkdown内容を `_schedules/{YYYY-MM-DD}.md` に保存。
- ファイル名例: `2026-01-09.md`
- 既存ファイルがある場合は上書き

### Step 4: 画面出力用テキスト返却

生成したMarkdownテキストをOrchestratorに返す。

## Output Format

**画面出力（Markdownテキスト）**:
```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☀️ おはよう｜金曜日 01/09
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 今日の予定: 3件
10:00-11:00 週次MTG (Google Meet)
14:00-15:00 1on1 (オフィス)
17:00-18:00 振り返り会

📋 未完了タスク: 5件
- [high] ohayo-orchestrator実装 (#dev, deadline: 01/10)
- [medium] Gmail自動振り分け改善 (#dev)

📊 昨日の活動: 12件
- abc1234 feat(ohayo): Phase 1実装
- def5678 fix(gmail): ラベル適用修正
- ghi9012 docs: README更新

💬 Slack未対応: 2件
- 田中太郎 (#dev): @k.sato レビューお願いします

📧 Gmail自動振り分け: 17件完了（30件中）
⚠️ 高緊急度メール: 2件
  - Fly.io支払い失敗 (techknight, urgency 4)
  - GMOサイン契約書署名 (techknight, urgency 4)

📚 学習候補: 3件
💡 信頼度0.8以上の候補があります。/learn-skillsを実行してください。

🐦 SNSバズ候補: 9件
[AI Coding] @DavidKPiano (Score: 16574) - Before AI coding agents...
[Claude Code] @Kyomesuke (Score: 6598) - Claude Codeおまえ…
[AI Agent] @mattn_jp (Score: 2628) - 僕の観測範囲で喋ってしまうけど...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**スケジュールファイル（`_schedules/2026-01-09.md`）**:
同じ内容を保存。

## Success Criteria

- [✅] SC-1: phase1_results.json 読み込み成功
- [✅] SC-2: Markdownサマリー生成成功
- [✅] SC-3: スケジュールファイル保存成功（`_schedules/YYYY-MM-DD.md`）

## Error Handling

- **phase1_results.json不在**: エラーを返す（Critical）
- **phase1_results.json読み込み失敗**: エラーを返す（Critical）
- **スケジュールファイル保存失敗**: エラーログ記録 + 画面出力は継続

**重要**: phase1_results.jsonが必須。不在の場合はこのPhaseを実行できない。

## Formatting Rules

**カレンダーイベント**:
- `{time} {summary} ({location})`形式
- 0件の場合: 「MTGなし」

**タスク**:
- `- [{priority}] {title} (#{tags}, deadline: {deadline})`形式
- 0件の場合: 「現在、未完了のタスクはありません。」

**Git活動**:
- コミットハッシュ + メッセージ（最大5件表示）
- 0件の場合: 「昨日のコミットはありません。」

**Slackメンション**:
- `- {from} (#{channel}): {message}`形式
- 0件の場合: 「現在、未対応のメンションはありません。」

**Gmail処理結果**:
- 高緊急度（urgency 4以上）のみ表示
- `- {subject} ({account}, urgency {urgency})`形式

**学習候補**:
- 3件以上: `/learn-skills`実行提案
- 3件未満: 件数のみ表示

**SNSバズ候補**:
- 各カテゴリのトップ1件を表示（最大3カテゴリ）
- `[{カテゴリ名}] @{author} (Score: {score}) - {text冒頭30文字}`形式
- 0件の場合: 「バズ候補なし」
- `sns_buzz`フィールド不在の場合: セクション非表示
