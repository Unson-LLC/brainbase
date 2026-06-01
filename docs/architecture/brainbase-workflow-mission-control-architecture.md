---
architecture_id: brainbase-workflow-mission-control-architecture
title: Brainbase Workflow Mission Control Architecture
related_stories:
  - docs/stories/story-brainbase-workflow-mission-control.md
status: proposed
created_at: 2026-06-01
updated_at: 2026-06-01
---

# Brainbase Workflow Mission Control Architecture

## 1. Intent

Brainbase Workflow Mission Control は、個人の反復作業をまず安定運用し、後から小規模チーム運用へ拡張するための workflow control plane である。cron や runner ではなく、project 所属、context、run ledger、human-in-the-loop、action required、audit を中核にする。

設計の主眼は「ワークフローを作れること」ではなく、「作ったワークフローがどの project の文脈で、何を読んで、誰の判断待ちで、どこまで終わっているかが分かること」である。

## 2. Product Boundary

Brainbase には既に Session、Project、terminal、VibePro、daily routine command がある。Workflow Mission Control はこれらを置き換えない。既存の作業面を、反復可能な運用単位へ接続する。

```text
Existing Brainbase

Project Catalog / Selector
  -> Session Creation
  -> Session / Terminal
  -> Commands: /ohayo, /oyasumi, /retro

New Workflow Mission Control

Project Catalog / Selector
  -> Workflow Definition
  -> Workflow Run Ledger
  -> Context Snapshot
  -> Human Step
  -> Output / Audit / Dashboard
```

Workflow は Session と同じ Project 概念に所属する。workflow 専用の project tree は作らない。

## 3. Architectural Principles

1. **Project reuse**: `project_id` は Session 作成時の Project catalog / selector と同じ概念を使う。
2. **Personal-first, team-ready**: 最初は owner / assignee / approver が同一人物でも成立させる。ただしデータモデルは分ける。
3. **Common runner**: UI、CLI、cron、human resume の全ては `runWorkflow()` を通る。
4. **Context visibility**: 実行前に予定 context、実行後に resolved context snapshot を見せる。
5. **Human-in-the-loop as workflow**: 承認・レビュー・追加入力は例外処理ではなく workflow step として扱う。
6. **Simple closure first**: MVP の closure は `open / closed / needs_action` から始める。
7. **No engine lock-in**: MVPでは Temporal / Airflow / Step Functions に寄せない。

## 4. Domain Shape

```text
Workspace
  -> Project
    -> WorkflowDefinition
      -> WorkflowRun
        -> RunStep
        -> ResolvedContextSnapshot
        -> HumanStep
        -> Output
        -> AuditLog
```

Session と Workflow は同じ Project にぶら下がる兄弟である。

```text
Project
  -> Sessions
  -> Workflows
  -> Project context defaults
```

これにより、ある project を開いた時に「会話セッション」と「定期/反復 workflow」が同じ文脈で見える。

## 5. Data Model

MVPでは専用DBを重厚に作らず、既存の永続化方式に合わせる。ただしデータ境界は以下の形で固定する。

```text
workflows
  id
  workspace_id
  project_id
  name
  description
  enabled
  schedule
  owner_id
  default_assignee_id
  default_approver_id
  execution_env
  risk_level
  hitl_policy
  timeout_ms
  created_at
  updated_at

workflow_context_sources
  id
  workspace_id
  project_id
  workflow_id
  source_type
  source_ref
  scope
  permission
  required
  created_at
  updated_at

workflow_runs
  id
  workspace_id
  project_id
  workflow_id
  status
  closure_state
  trigger_type
  env
  dry_run
  started_by
  owner_id
  assignee_id
  approver_id
  action_required
  human_waiting
  parent_run_id
  started_at
  finished_at
  duration_ms
  output_count
  message
  error_message
  created_at

workflow_run_steps
  id
  workspace_id
  project_id
  workflow_run_id
  step_key
  step_name
  status
  action_required
  message
  error_message
  output_count
  started_at
  finished_at

workflow_run_context_snapshots
  id
  workspace_id
  project_id
  workflow_run_id
  source_type
  source_ref
  source_version
  content_hash
  item_count
  permission
  preview
  created_at

workflow_human_steps
  id
  workspace_id
  project_id
  workflow_run_id
  workflow_id
  step_type
  requested_by
  requested_to
  status
  prompt
  response_ref
  reason
  created_at
  resolved_at

workflow_outputs
  id
  workspace_id
  project_id
  workflow_run_id
  workflow_id
  type
  title
  content_ref
  preview
  metadata
  created_at

audit_logs
  id
  workspace_id
  project_id
  actor_id
  action
  target_type
  target_id
  before
  after
  created_at
```

### MVP simplifications

- `workspace_id` は最初は default workspace でもよい。
- `owner_id` / `assignee_id` / `approver_id` は最初は同一ユーザーでもよい。
- `closure_state` は `open | closed | needs_action` の3値から始める。
- `workflow_human_steps` は approval だけでなく、missing input や review request にも使う。

## 6. Workflow Contract

```ts
type WorkflowDefinition = {
  id: string
  workspaceId: string
  projectId: string
  name: string
  description: string
  enabled: boolean
  schedule?: string
  ownerId: string
  defaultAssigneeId?: string
  defaultApproverId?: string
  executionEnv: "cloud" | "local" | "hybrid"
  riskLevel: "low" | "medium" | "high"
  hitlPolicy: "none" | "before_execute" | "after_generate" | "before_publish" | "on_request"
  timeoutMs?: number
  contextSources: WorkflowContextSource[]
  run: (ctx: WorkflowContext) => Promise<WorkflowResult>
}

type WorkflowContext = {
  workspaceId: string
  projectId: string
  workflowId: string
  runId: string
  triggerType: "manual" | "cron" | "retry" | "local" | "human_resume"
  env: "local" | "cloud"
  dryRun?: boolean
  actorId?: string
  agentId?: string
  resolvedContext: ResolvedContextSnapshot[]
}

type WorkflowResult = {
  status: "success" | "failed" | "skipped" | "waiting_human" | "needs_action"
  closureState?: "open" | "closed" | "needs_action"
  outputCount?: number
  message?: string
  data?: unknown
  actionRequired?: ActionRequired
  steps?: WorkflowStepResult[]
  humanStep?: HumanStepRequest
}
```

Workflow本体は business logic に集中する。DB保存、context snapshot、audit、HITL判定、notification、lock、timeout は `runWorkflow()` 側に寄せる。

## 7. Core Runner

すべての実行入口は `runWorkflow()` を通る。

```text
Manual UI
Local CLI
Cloud Scheduler
Cloud API
Human Resume
    |
    v
runWorkflow()
    |
    +--> resolve workflow definition
    +--> validate workspace / project / owner
    +--> acquire lock
    +--> save run started
    +--> resolve context sources
    +--> save resolved context snapshot
    +--> evaluate HITL policy before execute
    +--> execute workflow.run(ctx)
    +--> save step results
    +--> save outputs
    +--> save action_required
    +--> save human step if waiting
    +--> save run finished
    +--> write audit log
    +--> release lock
```

### Runner adapters

```text
UI adapter
  - manual run
  - rerun
  - human resume

Local adapter
  - local filesystem / browser / terminal dependent runs
  - dry-run
  - routine command bridge

Cloud adapter
  - cloud-native scheduled runs
  - future queue worker

Hybrid adapter
  - cloud creates job
  - local executes
  - result returns to run ledger
```

MVPでは Local adapter と UI adapter を優先する。Cloud scheduler は `brainbase-alive` の後でよい。

## 8. Project and Context Binding

Workflow creation flow は Session creation と同じ Project selector を使う。

```text
Select Project
  -> Select or create Workflow
  -> Show inherited project context
  -> Add workflow-specific context
  -> Save workflow definition
```

Context source examples:

- project directory
- repository
- current session transcript reference
- Google Drive folder
- Slack channel
- Gmail label
- Calendar account
- Graph entity
- NocoDB table

Run開始時に context を解決し、`workflow_run_context_snapshots` へ envelope を保存する。全文保存は避ける。

```text
source_ref + version/hash + item_count + permission + preview
```

context 不足は単なる failed ではなく、次のように action required へ落とす。

```text
missing required file      -> update_input
missing credential         -> connect_account
expired secret             -> fix_secret
ambiguous project context  -> human_input
```

## 9. State Machine and Production Path Matrix

Workflow-heavy な設計では、状態遷移と本番実行経路をArchitecture上で明示する。

### Run state machine

```text
queued
  -> running
    -> success
    -> failed
    -> skipped
    -> needs_action
    -> waiting_human

waiting_human
  -> running         after approve / provide_input / resume
  -> cancelled       after reject / cancel
  -> needs_action    after expired / missing credential
```

MVPでは `queued` を永続化せず、manual/local run は `running` から始めてもよい。ただし将来queue化しても同じ状態語彙へ移行する。

### Closure state

```text
open
  -> closed
  -> needs_action
```

`status=success` でも `closure_state=open` はあり得る。たとえば draft 作成は成功したが、人間レビューが未完了の場合である。

### Production path matrix

| Path | Trigger infra | Runner env | Typical workflow | Required ledger fields | HITL |
|---|---|---|---|---|---|
| Manual local | UI / CLI | local | `brainbase-alive`, dry-run | `trigger_type=manual`, `env=local`, `started_by` | optional |
| Local scheduled | macOS launchd | local | `/ohayo`, local file/browser routine | `trigger_type=local|cron`, `env=local`, `agent_id` | on request |
| Server scheduled | Lightsail systemd timer | cloud | health check, API-only report | `trigger_type=cron`, `env=cloud`, `agent_id` | before publish |
| Human resume | UI human step | local or cloud | approve, provide input, review output | `trigger_type=human_resume`, `parent_run_id`, `started_by` | required |
| Hybrid future | cloud job + local runner | hybrid | GUI/local filesystem job | cloud job id + local result envelope | required by risk |

### Failure and retry ownership

- lock は `runWorkflow()` が取得・解放する。
- timeout は workflow definition の `timeout_ms` を使う。
- retry は API一時失敗など deterministic な失敗だけに限定する。
- credential / missing input / human waiting は自動retryせず `action_required` に落とす。
- retry run は新しい `workflow_runs` record として作り、`parent_run_id` で元runへリンクする。

### Observability ownership

- launchd / systemd は runner process の stdout/stderr を持つ。
- `workflow_runs` は実行事実の正本を持つ。
- `workflow_run_steps` は workflow 内部 step の状態を持つ。
- `audit_logs` は actor が関与する変更・resume・承認を持つ。
- UI は process log ではなく `workflow_runs` と `workflow_human_steps` を読む。

## 10. Human-in-the-loop Architecture

Human-in-the-loop は workflow の外側にある確認ダイアログではない。workflow step として永続化し、resume できる。

```text
Run
  -> Step: generate draft
  -> HumanStep: review_output / approve / provide_input
  -> Resume
  -> Step: publish / send / archive
```

### HITL step types

```text
approve
reject
review_output
provide_input
connect_account
fix_secret
rerun_decision
```

### HITL state

```text
pending
approved
rejected
answered
cancelled
expired
```

外部送信、SNS投稿、顧客通知、削除、本番更新は HITL policy なしで自動実行しない。

## 11. UI Architecture

### `/workflows`

Mission Control の入口。workflow 一覧ではなく、今見るべきものを優先する。

```text
Top summary
  - action required
  - waiting human
  - failed runs
  - latest /ohayo

Project scoped list
  - project
  - workflow
  - status
  - owner
  - next run
  - last run
  - action required
  - human waiting

Run detail panel
  - steps
  - context snapshot
  - outputs
  - human step
  - rerun
```

### Project detail integration

Project detail では、その project に紐づく workflow を見せる。Session と Workflow は同じ project 文脈に出る。

### Workflow detail

- project
- owner
- execution env
- schedule
- context sources
- latest runs
- human steps
- outputs
- audit trail

### Human step UI

MVPでは専用の大きな承認システムを作らず、Run detail panel 内で処理する。

- approve / reject
- add input
- mark reviewed
- rerun

## 12. API Boundary

MVP API は次の境界を持つ。

```text
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
PATCH  /api/workflows/:id
POST   /api/workflows/:id/run
POST   /api/workflow-runs/:runId/rerun
GET    /api/workflow-runs/:runId
POST   /api/workflow-runs/:runId/human-steps/:stepId/resolve
POST   /api/workflow-human-steps/:stepId/resolve  # compatibility alias
```

APIは `runWorkflow()` を迂回しない。`POST /run`、rerun、human resume は必ず core runner に入る。

正本の human resume path は run-scoped API である。alias は既存クライアント移行用であり、内部では同じ `resolveHumanStep()` と `runWorkflow(triggerType=human_resume)` に接続する。

## 13. Routine Integration

最初の実Routineは `/ohayo`。ただしいきなり `/ohayo` 全体を作り替えない。

### Step 1: brainbase-alive

runner、ledger、dashboard、audit の疎通確認。

### Step 2: ohayo ledger bridge

既存 `/ohayo` 実行結果を workflow run として記録する。Calendar / Gmail / Slack / SNS / archive などの各処理を step result に分解する。

### Step 3: ohayo context visibility

使った Calendar、Gmail、Slack、Graph、NocoDB などを context snapshot として保存する。

### Step 4: ohayo human step

不足入力、レビュー待ち、送信前確認を workflow_human_steps に載せる。

`/oyasumi`、`/retro`、月末処理はこの構造に乗せる後続routineである。

## 14. Local / Cloud Boundary

### Local-native

- local file
- local repo
- browser session
- terminal
- GUI
- SSO / 2FA

### Cloud-native

- API
- DB
- shared storage
- health check
- daily summary

### Hybrid

cloud が job と dashboard を持ち、local runner が実行して result envelope を返す。

MVPでは cloud/hybrid を先に作り込まない。local/manual ledger を先に完成させる。

## 15. Scheduling and Infrastructure

Workflow Mission Control は runner を抽象化するが、定期実行基盤は曖昧にしない。ただし、このStoryのMVP実装では scheduler connector 自体は作らない。ここでは後続Storyで接続する時の制約を固定する。

### Local scheduling

ローカルMac上の定期実行は **macOS launchd** を一次選択にする。

理由:

- Brainbase の canonical local runtime `31013` は既に launchd 管理である。
- launchd はログ、再起動、ユーザーセッション、起動時再開を扱える。
- macOS 上では cron より launchd の方が現行Brainbase運用と合う。
- local filesystem、browser session、terminal、SSO/2FA 依存の処理はユーザーMac上で走る必要がある。

後続Storyで local scheduled workflow を実装する場合は、launchd job から Brainbase の local runner を呼ぶ。

```text
launchd
  -> brainbase workflow run <workflow-id>
    -> local runner adapter
      -> POST /api/workflows/:id/run or direct runWorkflow()
        -> workflow_runs ledger
```

後続Storyでも既存 `com.brainbase.ui` と同じ plist に workflow schedule を混ぜない。workflow ごと、または workflow scheduler 用の別 LaunchAgent を作る。

```text
~/Library/LaunchAgents/com.brainbase.workflow.<workflow-id>.plist
~/Library/Logs/brainbase-workflow.<workflow-id>.log
~/Library/Logs/brainbase-workflow.<workflow-id>.error.log
```

`/ohayo` のような個人routineを後続Storyで scheduled workflow 化する場合、実行結果は必ず `workflow_runs` に戻す。

### Server scheduling

後続Storyでサーバ側の定期実行を実装する場合は **AWS Lightsail 上の systemd timer + Node runner/API** を一次選択にする。

現在の本番バックエンドは Lightsail 上の Node.js brainbase server、System PostgreSQL、Docker Compose 群で構成されている。server-native workflow を scheduled connector として実装する場合はこの Lightsail 上で定期起動する。

```text
systemd timer
  -> systemd service
    -> node scripts/workflow-runner.mjs --workflow <workflow-id>
      -> runWorkflow()
        -> PostgreSQL workflow_runs ledger
```

systemd timer を選ぶ理由:

- Lightsail単体構成に合う。
- OSレベルで起動、再起動、失敗ログ、journalctl を扱える。
- Node process 内 cron より二重起動や再起動時の取りこぼしを制御しやすい。
- 将来 queue worker に移行しても、timer は trigger layer として剥がしやすい。

この段階では EventBridge、Step Functions、Temporal、Airflow は使わない。Lightsail を超える必要が出た時に Cloud Scheduler / queue / worker へ拡張する。

### Node in-process cron policy

Node server 内の `setInterval` や in-process cron は canonical scheduler にしない。

許可する用途:

- 開発中の一時的な検証。
- dashboard refresh など、失敗しても workflow run を失わない軽量処理。

禁止する用途:

- `/ohayo`、月末処理、外部送信、human approval 待ちを含む workflow の正規スケジュール。
- workflow_runs に残すべき本番/定期実行。

### Scheduling ownership

```text
WorkflowDefinition.schedule
  -> desired schedule

Local launchd plist / server systemd timer
  -> actual trigger

workflow_runs
  -> source of truth for what actually ran
```

`schedule` は意図であり、実行事実ではない。実際に動いたかどうかは `workflow_runs` を正とする。

## 16. Security and Audit

記録対象:

- workflow create / update / enable / disable
- manual run
- rerun
- human step resolve
- schedule change
- context source change
- owner change

credential の扱い:

- secret の中身は workflow definition に保存しない。
- context snapshot に raw secret を保存しない。
- user credential / workspace credential / workflow binding の区別を後続Specで固定する。

## 16A. UX Surface Architecture

Workflow Mission Control の UI は Project-first にする。

```text
Workspace Home
  -> Project cards
  -> Operational Inbox

Project Detail
  -> Workflows
  -> Documents / Context
  -> Project-fixed workflow creation

Workflow Detail
  -> Builder / Canvas preview
  -> Context sources
  -> Runs / Trace

Run Detail
  -> Step timeline
  -> Resolved context
  -> Outputs
  -> Human / Audit
```

`/workflows` は cross-project operational inbox と Project browsing の入口を兼ねる。ただし workflow 作成の自然な文脈は Project Detail であり、作成時の `project_id` は選択中 Project に固定する。

Run Detail は audit / resolved context / human decision の evidence surface である。Human step の approve / reject は run-scoped API に接続し、未追跡の modal state に閉じ込めない。

## 17. MVP Implementation Order

Architecture後の実装順序は次の通り。

1. `WorkflowDefinition` / `WorkflowContext` / `WorkflowResult` 型を定義する。
2. 既存 Project catalog / selector と workflow `project_id` の接続境界を決める。
3. `runWorkflow()` と `workflow_runs` ledger を作る。
4. `brainbase-alive` を manual/local で ledger に残す。
5. `/workflows` dashboard v0 を作る。
6. context snapshot を保存する。
7. human step / waiting_human を追加する。
8. rerun と audit を追加する。
9. `/ohayo` を最初の実 routine として ledger に接続する後続Storyを切る。
10. local launchd で `/ohayo` schedule を登録する後続Storyを切る。
11. server-native workflow 用に Lightsail systemd timer の最小形を追加する後続Storyを切る。
12. hybrid local runner は後続で拡張する。

## 18. Explicit Non-goals

- workflow 専用の新しい project tree を作る。
- 最初から visual node editor を完成させる。
- 最初から複数人RBACを作り込む。
- 最初から Temporal / Airflow / Step Functions を導入する。
- `/ohayo` の全処理を一気に置き換える。
- local launchd / Lightsail systemd timer connector をこのStoryで実装する。
- human confirmation を一時的な modal state だけで扱う。
- context full text を無制限にDB保存する。
- Node process 内 cron を正規の定期実行基盤にする。
