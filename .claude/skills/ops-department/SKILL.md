---
name: ops-department
description: 運用部（職能ベース）。Executive Assistant・Infrastructure Manager・Knowledge Analystの3職能が協働し、情報集約・システム監視・学習抽出を自動化
teammates:
  - name: executive-assistant
    agentType: executive-assistant
    description: 情報収集・優先順位付け・日程管理。朝のブリーフィング、メール仕分け、緊急メール抽出、日程調整、タスク優先順位付けを担当
    tools: Skill, Bash, Read, Write, Grep
  - name: infrastructure-manager
    agentType: infrastructure-manager
    description: リポジトリ・システム・バックアップ監視。リポジトリ同期、システムヘルスチェック、デプロイ前チェック、セキュリティ監査を担当
    tools: Bash, Read, Write, Grep, Glob
  - name: knowledge-analyst
    agentType: knowledge-analyst
    description: 学習抽出・KPI・バズ分析。学習抽出、学習レビュー、KPI計算、SNSバズ分析、月次レポートを担当
    tools: Skill, Read, Write, Bash, Grep
---

# Ops Department Skill

**概要**: 運用業務を3職能（Executive Assistant / Infrastructure Manager / Knowledge Analyst）で自動化。ops-daily/ohayo-orchestratorパターンを踏襲した職能ベース設計。運用の3レイヤー（情報層→基盤層→知識層）にマッピング。

**設計思想**: 1 job function = multiple workflows
- Executive Assistant（秘書）: 情報収集・優先順位付け・日程管理（5つのworkflow）
- Infrastructure Manager（インフラ管理者）: リポジトリ・システム・バックアップ監視（5つのworkflow）
- Knowledge Analyst（知識分析者）: 学習抽出・KPI・バズ分析（5つのworkflow）

**時間軸ベースのワークフロー**:
- 朝: ブリーフィング + 同期 + 学習抽出（並列）
- 日中: トリアージ + 障害対応 + KPI計測
- 夕方: クロージング + バックアップ + 月次レポート
- 週次: 週次レポート + セキュリティ監査

---

## Workflow Overview

```
Phase 1: Team作成
  └── TeamCreate("ops-department")

Phase 1.5: カレンダー予定取得（team lead直接実行）
  └── 全カレンダーから今日の予定を取得
      └── `/tmp/ops-department/calendar_events.json` に保存

Phase 2: Teammates並列起動（blocking）
  ├── executive-assistant: 情報収集・ブリーフィング・トリアージ
  ├── infrastructure-manager: リポジトリ同期・システム監視・セキュリティ
  └── knowledge-analyst: 学習抽出・KPI計算・バズ分析

Phase 3: 結果統合 & 運用サマリー生成
  └── 各teammateの成果物（JSON）を読み込み
      └── `/tmp/ops-department/ops_summary.md` に統合レポート出力

Phase 4: Review & Replan（Max 3 Retries）+ _schedules生成
  └── エラー発生時、該当teammateを再起動
  └── `_schedules/YYYY-MM-DD.md` を生成（右パネル表示用、カレンダー予定をテーブル形式で表示）

Phase 5: Team cleanup
  └── TeamDelete("ops-department")
```

**職能間のデータ共有**: `/tmp/ops-department/` 配下のJSONファイル + SendMessage

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
mkdir -p /tmp/ops-department
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "ops-department",
  description: "運用部: Executive Assistant / Infrastructure Manager / Knowledge Analyst",
  agent_type: "ops-department-lead"
})
```

---

## Phase 1.5: カレンダー予定取得（team lead直接実行）

**重要**: SubagentはMCPにアクセスできないため、team leadが直接全カレンダーから予定を取得する。

### Step 1: Google Calendar MCPツールをロード

```javascript
ToolSearch({
  query: "google-calendar",
  max_results: 5
})
```

### Step 2: 全カレンダーリストを取得

```javascript
const calendarsResult = mcp__google_calendar__list-calendars()
// 結果例: 8個のカレンダー（k.sato.unson@gmail.com, k.sato.knllc@gmail.com, k.sato@sales-tailor.jp, k.sato.baao@gmail.com, k0127s@gmail.com, k.sato.ncom@gmail.com, sin310135@gmail.com, 日本の祝日）
```

### Step 3: 全カレンダーから今日の予定を取得

```javascript
const today = new Date().toISOString().split('T')[0]
const calendarIds = calendarsResult.calendars.map(cal => cal.id)

const eventsResult = mcp__google_calendar__list-events({
  calendarId: calendarIds,  // 全カレンダーを配列で指定
  timeMin: `${today}T00:00:00+09:00`,
  timeMax: `${today}T23:59:59+09:00`
})
```

### Step 4: 予定をJSONファイルに保存

```javascript
// 重複を除去し、時系列順にソート
const uniqueEvents = []
const seenEventIds = new Set()

for (const event of eventsResult.events) {
  // 同じiCalUIDの重複イベントをスキップ
  if (!seenEventIds.has(event.iCalUID)) {
    seenEventIds.add(event.iCalUID)
    uniqueEvents.push({
      id: event.id,
      summary: event.summary,
      start: event.start.dateTime,
      end: event.end.dateTime,
      location: event.location || '-',
      conferenceData: event.conferenceData,
      hangoutLink: event.hangoutLink,
      calendarId: event.calendarId
    })
  }
}

// 時系列順にソート
uniqueEvents.sort((a, b) => new Date(a.start) - new Date(b.start))

// JSONファイルに保存
Write({
  file_path: "/tmp/ops-department/calendar_events.json",
  content: JSON.stringify({
    date: today,
    total_count: uniqueEvents.length,
    events: uniqueEvents
  }, null, 2)
})
```

---

## Phase 2: Teammates並列起動（blocking）

### Step 1: 3職能を並列起動

**重要**: `run_in_background: false` でblocking実行（全teammateの完了を待つ）

#### Executive Assistant起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "ops-department",
  name: "executive-assistant",
  description: "情報収集・ブリーフィング・トリアージ",
  prompt: `
# Executive Assistant Workflow

あなたは Ops Department チームの Executive Assistant です。

## 役割
情報収集・優先順位付け・日程管理。朝のブリーフィング、メール仕分け、緊急メール抽出、日程調整、タスク優先順位付け等を実行。ohayo-orchestratorのPhase 2（情報収集）とPhase 3（サマリー生成）を日常的に担当。

## Workflows（5つ）

### W1: 朝のブリーフィング
- カレンダー・タスク・メール状況を集約し、今日の全体像を提示
- Skill呼び出し: ohayo-orchestrator
- 成果物: /tmp/ops-department/briefing.json, _schedules/YYYY-MM-DD.md

### W2: 緊急対応トリアージ
- 緊急度3以上のメールを抽出し、即時対応が必要な事項を特定
- Skill呼び出し: email-classifier, gmail-auto-labeling
- 成果物: /tmp/ops-department/urgent_emails.json

### W3: 日中サマリー
- 午後の進捗確認と次アクション提案
- Skill呼び出し: task-format
- 成果物: /tmp/ops-department/afternoon_summary.md

### W4: 夕方クロージング
- 今日の成果まとめと明日の準備
- Skill呼び出し: task-format
- 成果物: /tmp/ops-department/daily_closing.md

### W5: 週次レポート
- 週の振り返りと来週計画
- Skill呼び出し: planning-okr
- 成果物: _codex/ops/weekly_report_YYYY-WW.md

## 実行手順

1. **カレンダー予定を読み込み** (team leadが事前に取得済み):
   - Read tool で `/tmp/ops-department/calendar_events.json` を読み込む
   - カレンダー予定の件数と詳細を確認

2. Skill tool で gmail-auto-labeling を参照（メール仕分け実行）

3. _tasks/index.md を読み込んでタスク状況を確認

4. 指定されたワークフローを実行

5. 成果物を確認（Read tool）

6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "executive-assistant",
  "workflows_executed": ["briefing", "triage"],
  "results": {
    "briefing_path": "/tmp/ops-department/briefing.json",
    "urgent_emails_count": 2,
    "priority_task": "Fly.io支払い失敗対応",
    "status": "success"
  },
  "errors": []
}
\`\`\`

5. Write tool で /tmp/ops-department/executive_assistant.json に保存
6. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 朝のブリーフィングが生成されている
- [ ] 緊急メールが抽出されている
- [ ] JSON形式で結果を報告している
- [ ] _schedules/YYYY-MM-DD.md が生成されている

## Notes

- デフォルトワークフロー: W1 (朝のブリーフィング) + W2 (緊急対応トリアージ)
- gmail-auto-labeling Skillでメール仕分けを実行
- エラー時は errors 配列に詳細を記録
`
})
```

#### Infrastructure Manager起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "ops-department",
  name: "infrastructure-manager",
  description: "リポジトリ同期・システム監視・セキュリティ",
  prompt: `
# Infrastructure Manager Workflow

あなたは Ops Department チームの Infrastructure Manager です。

## 役割
リポジトリ・システム・バックアップ監視。brainbase-ops-guideの7 Skills統合知見でインフラ全体を管理。

## Workflows（5つ）

### W1: 朝の同期
- 全リポジトリ同期+システムヘルスチェック
- Skill呼び出し: brainbase-ops-guide
- 成果物: /tmp/ops-department/repo_status.json, /tmp/ops-department/system_health.json

### W2: デプロイ前チェック
- 本番デプロイゲート（テスト・セキュリティ・バックアップ確認）
- Skill呼び出し: deployment-platforms, context-check
- 成果物: /tmp/ops-department/deploy_gate_report.md

### W3: 障害対応
- ログ分析+復旧手順提案
- Skill呼び出し: brainbase-ops-guide
- 成果物: /tmp/ops-department/incident_report.md

### W4: セキュリティ監査
- Secrets検出+脆弱性スキャン
- Skill呼び出し: security-patterns, codex-validation
- 成果物: /tmp/ops-department/secrets_status.json

### W5: バックアップ検証
- 定期バックアップ確認（NocoDB/_codex/config）
- Skill呼び出し: codex-validation
- 成果物: /tmp/ops-department/backup_status.json

## 実行手順

1. brainbase-ops-guide を参照してリポジトリ同期
2. 指定されたワークフローを実行
3. 成果物を確認（Read tool）
4. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "infrastructure-manager",
  "workflows_executed": ["repo_sync", "system_health"],
  "results": {
    "repo_total": 10,
    "repo_success": 8,
    "repo_dirty": 2,
    "system_health": "green",
    "secrets_at_risk": 0,
    "status": "success"
  },
  "errors": []
}
\`\`\`

5. Write tool で /tmp/ops-department/infrastructure_manager.json に保存
6. SendMessage で team lead に完了報告

## Success Criteria

- [ ] リポジトリ同期が完了している
- [ ] システムヘルスチェックが完了している
- [ ] JSON形式で結果を報告している
- [ ] Secrets検出が完了している

## Notes

- デフォルトワークフロー: W1 (朝の同期) + W4 (セキュリティ監査)
- brainbase-ops-guideの7 Skills統合知見を活用
- エラー時は errors 配列に詳細を記録
`
})
```

#### Knowledge Analyst起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "ops-department",
  name: "knowledge-analyst",
  description: "学習抽出・KPI計算・バズ分析",
  prompt: `
# Knowledge Analyst Workflow

あなたは Ops Department チームの Knowledge Analyst です。

## 役割
学習抽出・KPI・バズ分析。Decision→Work→Ship→LearnのLearnフェーズを担当し、組織の学習サイクルを加速。

## Workflows（5つ）

### W1: 学習抽出
- 昨日のセッションから学習候補を自動抽出
- Skill呼び出し: learning-extraction
- 成果物: .claude/learning/learning_queue/*.md

### W2: 学習レビュー
- learning_queue優先度付け+Skill化提案
- Skill呼び出し: knowledge-frontmatter
- 成果物: /tmp/ops-department/learning_summary.json

### W3: KPI計算
- 6指標算出+ダッシュボード生成
- Skill呼び出し: kpi-calculation
- 成果物: /tmp/ops-department/kpi_report.json

### W4: SNSバズ分析
- Top投稿特定+戦略提案
- Skill呼び出し: x-analytics-source, x-bookmarks-source
- 成果物: /tmp/ops-department/sns_analysis.json

### W5: 月次レポート
- 学習・KPI・バズの総括
- Skill呼び出し: kpi-calculation
- 成果物: _codex/ops/monthly_report_YYYY-MM.md

## 実行手順

1. Skill tool で learning-extraction / kpi-calculation を参照
2. 指定されたワークフローを実行
3. 成果物を確認（Read tool）
4. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "knowledge-analyst",
  "workflows_executed": ["learning_extraction", "kpi_calculation"],
  "results": {
    "learning_extracted": 3,
    "queue_state": { "validated": 1, "pending": 2 },
    "kpi_scores": { "task_unification": 0.75, "raci_compliance": 0.80 },
    "status": "success"
  },
  "errors": []
}
\`\`\`

5. Write tool で /tmp/ops-department/knowledge_analyst.json に保存
6. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 学習抽出が完了している
- [ ] KPI計算が完了している
- [ ] JSON形式で結果を報告している
- [ ] 学習サマリーが生成されている

## Notes

- デフォルトワークフロー: W1 (学習抽出) + W3 (KPI計算)
- learning-extractionでセッションログを分析
- エラー時は errors 配列に詳細を記録
`
})
```

---

## Phase 3: 結果統合 & 運用サマリー生成

### Step 1: 各teammateの成果物を読み込み

```javascript
const executiveAssistantResult = Read({ file_path: "/tmp/ops-department/executive_assistant.json" })
const infrastructureManagerResult = Read({ file_path: "/tmp/ops-department/infrastructure_manager.json" })
const knowledgeAnalystResult = Read({ file_path: "/tmp/ops-department/knowledge_analyst.json" })
```

### Step 2: 運用サマリー生成

```markdown
# Ops Department Summary
生成日時: {timestamp}

## Executive Assistant（情報層）
- 実行ワークフロー: {workflows_executed}
- ブリーフィング: {briefing_path}
- 緊急メール: {urgent_emails_count}件
- 最優先タスク: {priority_task}
- ステータス: {status}
- エラー: {errors}

## Infrastructure Manager（基盤層）
- 実行ワークフロー: {workflows_executed}
- リポジトリ同期: {repo_success}/{repo_total}件（dirty: {repo_dirty}）
- システムヘルス: {system_health}
- Secrets検出: {secrets_at_risk}件
- ステータス: {status}
- エラー: {errors}

## Knowledge Analyst（知識層）
- 実行ワークフロー: {workflows_executed}
- 学習抽出: {learning_extracted}件
- KPIスコア: {kpi_scores}
- ステータス: {status}
- エラー: {errors}

## 運用全体ステータス
- 情報層: {executive_assistant.status}
- 基盤層: {infrastructure_manager.status}
- 知識層: {knowledge_analyst.status}

## Next Actions
1. [アクション1]
2. [アクション2]
3. [アクション3]
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/ops-department/ops_summary.md",
  content: summary
})
```

---

## Phase 4: Review & Replan（Max 3 Retries）+ _schedules生成

### Step 1: エラーチェック

```javascript
const hasErrors =
  executiveAssistantResult.errors?.length > 0 ||
  infrastructureManagerResult.errors?.length > 0 ||
  knowledgeAnalystResult.errors?.length > 0
```

### Step 2: エラー時の再起動

```javascript
if (hasErrors && retryCount < 3) {
  if (executiveAssistantResult.errors?.length > 0) {
    Task({ ... }) // executive-assistant 再起動
  }
  if (infrastructureManagerResult.errors?.length > 0) {
    Task({ ... }) // infrastructure-manager 再起動
  }
  if (knowledgeAnalystResult.errors?.length > 0) {
    Task({ ... }) // knowledge-analyst 再起動
  }
  retryCount++
} else if (retryCount >= 3) {
  console.log("3回のリトライに失敗しました。手動確認が必要です。")
}
```

### Step 3: _schedules生成（右パネル表示用）

**重要**: brainbaseの右パネル（timeline-view）は「## 今日の予定」セクションのテーブル形式を表示する。

```javascript
const today = new Date().toISOString().split('T')[0]
const now = new Date()
const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()]

// Step 3-1: カレンダー予定を読み込み
let calendarEvents = []
try {
  const calendarData = JSON.parse(
    await Read({ file_path: "/tmp/ops-department/calendar_events.json" })
  )
  calendarEvents = calendarData.events || []
} catch (error) {
  console.error("Failed to read calendar_events.json:", error)
}

// Step 3-2: カレンダー予定テーブル生成
const calendarSection = calendarEvents.length > 0
  ? `## 今日の予定

| 時間 | 内容 | 場所 |
|------|------|------|
${calendarEvents.map(event => {
  const startTime = new Date(event.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endTime = new Date(event.end).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false })
  const location = event.conferenceData?.conferenceSolution?.name || event.location || '-'
  return `| ${startTime}-${endTime} | ${event.summary} | ${location} |`
}).join('\n')}

`
  : `## 今日の予定

今日の予定はありません

`

// Step 3-3: 緊急メール詳細を読み込み
let urgentEmails = []
if (executiveAssistantResult.results?.urgent_emails_count > 0) {
  try {
    const urgentEmailsData = JSON.parse(
      await Read({ file_path: "/tmp/ops-department/urgent_emails.json" })
    )
    urgentEmails = urgentEmailsData.urgent_emails || []
  } catch (error) {
    console.error("Failed to read urgent_emails.json:", error)
  }
}

// Step 3-2: 緊急メールからタスクリストを生成
const urgentEmailsSection = urgentEmails.length > 0
  ? `### 🚨 緊急対応（${urgentEmails.length}件）

${urgentEmails.map(email =>
  `- [ ] ${email.subject} (${email.account}, urgency ${email.urgency})`
).join('\n')}

`
  : ''

// Step 3-3: 優先タスク・期限超過タスクをタスクリスト形式で生成
let priorityTasksSection = ''
const tasks = []

if (executiveAssistantResult.results?.overdue_task && executiveAssistantResult.results.overdue_task !== 'N/A') {
  tasks.push(`- [ ] ⚠️ ${executiveAssistantResult.results.overdue_task}`)
}
if (executiveAssistantResult.results?.priority_task && executiveAssistantResult.results.priority_task !== 'N/A') {
  tasks.push(`- [ ] ${executiveAssistantResult.results.priority_task}`)
}

if (tasks.length > 0) {
  priorityTasksSection = `### 📋 優先タスク

${tasks.join('\n')}

`
}

// Step 3-4: インフラ状況をタスク形式で生成（dirty リポジトリがあれば）
const infraSection = infrastructureManagerResult.results?.repo_dirty > 0
  ? `### 🔧 インフラ対応

- [ ] リポジトリ同期 (dirty: ${infrastructureManagerResult.results.repo_dirty}件)

`
  : ''

// Step 3-5: KPI状況をタスク形式で生成（要改善項目があれば）
const criticalKpis = knowledgeAnalystResult.results?.kpi_summary?.critical || []
const kpiSection = criticalKpis.length > 0
  ? `### 📊 KPI改善（要対応）

${criticalKpis.map(kpi => `- [ ] ${kpi}`).join('\n')}

`
  : ''

// Step 3-7: _schedulesファイル生成
Write({
  file_path: `_schedules/${today}.md`,
  content: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☀️ おはよう｜${dayOfWeek}曜日 ${today.split('-')[1]}/${today.split('-')[2]}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 今日の予定: ${calendarEvents.length}件
📋 未完了タスク: {active_tasks_count}件
📊 昨日の活動: {yesterday_commits}コミット
💬 Slack未対応: 0件
📧 緊急メール: ${urgentEmails.length}件
📚 学習候補: ${knowledgeAnalystResult.results?.learning_extracted || 0}件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${calendarSection}
${urgentEmailsSection}### 未完了タスク

${priorityTasksSection}${infraSection}${kpiSection}### 📈 運用状況サマリー

**Executive Assistant**
- 緊急メール: ${executiveAssistantResult.results?.urgent_emails_count || 0}件
- 最優先タスク: ${executiveAssistantResult.results?.priority_task || 'N/A'}
- ステータス: ${executiveAssistantResult.results?.status || 'unknown'}

**Infrastructure Manager**
- リポジトリ: ${infrastructureManagerResult.results?.repo_success || 0}/${infrastructureManagerResult.results?.repo_total || 0}件同期
- dirty: ${infrastructureManagerResult.results?.repo_dirty || 0}件
- システムヘルス: ${infrastructureManagerResult.results?.system_health || 'N/A'}
- Secrets: ${infrastructureManagerResult.results?.secrets_at_risk || 0}件

**Knowledge Analyst**
- 学習抽出: ${knowledgeAnalystResult.results?.learning_extracted || 0}件
- KPIスコア: タスク一本化率 ${knowledgeAnalystResult.results?.kpi_scores?.task_unification || 'N/A'}

### 🔗 詳細レポート
- 統合サマリー: \`/tmp/ops-department/ops_summary.md\`
- 生成時刻: ${currentTime}
`
})
```

---

## Phase 5: Team cleanup

### Step 1: Team削除

```javascript
TeamDelete()
```

---

## Usage Examples

### 例1: 運用部全体起動（デフォルト）

```bash
/ops-department
```

→ 3職能を並列起動し、運用サマリーを生成

### 例2: 朝のブリーフィングのみ

```bash
/ops-department --job-function executive-assistant --workflow briefing
```

→ Executive Assistant のみ起動し、朝のブリーフィングを生成

### 例3: セキュリティ監査のみ

```bash
/ops-department --job-function infrastructure --workflow security
```

→ Infrastructure Manager のみ起動し、セキュリティ監査を実行

### 例4: KPI計算のみ

```bash
/ops-department --job-function knowledge --workflow kpi
```

→ Knowledge Analyst のみ起動し、KPIダッシュボードを更新

---

## RACI Structure

| 職能 | Responsible | Accountable | Consulted | Informed |
|------|-------------|-------------|-----------|----------|
| **Executive Assistant** | ブリーフィング・トリアージ・サマリー・クロージング・週次レポート | 情報集約品質・優先順位付けの妥当性 | Infrastructure Manager（システム状況）, Knowledge Analyst（KPI状況） | 全メンバー |
| **Infrastructure Manager** | リポジトリ同期・ヘルスチェック・デプロイゲート・セキュリティ監査・バックアップ | システム安定性・セキュリティ品質 | Executive Assistant（緊急対応の優先順位） | Knowledge Analyst |
| **Knowledge Analyst** | 学習抽出・学習レビュー・KPI計算・バズ分析・月次レポート | 学習の型化・KPI正確性 | Executive Assistant（週次レポートへのKPI提供） | Infrastructure Manager |

---

## Skills Mapping

| 職能 | Primary Skill | Skills |
|------|--------------|--------|
| **Executive Assistant** | ohayo-orchestrator | ohayo-orchestrator, gmail-auto-labeling, email-classifier, task-format, planning-okr |
| **Infrastructure Manager** | brainbase-ops-guide | brainbase-ops-guide, codex-validation, context-check, deployment-platforms, security-patterns |
| **Knowledge Analyst** | learning-extraction | learning-extraction, kpi-calculation, x-analytics-source, x-bookmarks-source, knowledge-frontmatter |

**Skills Coverage**: ops_tools 9/15 (60%) + dev_tech 1個 + sns_marketing 2個 + project_task 3個 = 15個（ユニーク、重複なし）

---

## Notes

- **ops-daily/ohayo-orchestratorパターン踏襲**: 3職能並列起動、JSON成果物、team lead統合
- **運用の3レイヤー**: 情報層（EA）→ 基盤層（IM）→ 知識層（KA）
- **時間軸ベース**: 朝→日中→夕方→週次→月次のワークフロー設計
- **Phase 1.5でカレンダー取得**: team leadが全8カレンダーから予定を取得し、JSONに保存
- **_schedules生成**: Phase 4で当日のスケジュールファイルを生成（右パネル表示用）
  - カレンダー予定をテーブル形式（`| 時間 | 内容 | 場所 |`）で表示
  - タイムラインパーサーが認識する「## 今日の予定」セクションを生成
- **Review & Replan**: エラー時は最大3回まで再実行
- **各職能のSkillsは重複なし**: 15個のユニークSkillsで効率的な装備

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-02-09
