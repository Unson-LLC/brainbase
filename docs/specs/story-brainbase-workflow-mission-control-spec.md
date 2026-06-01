---
spec_id: story-brainbase-workflow-mission-control-spec
story_id: story-brainbase-workflow-mission-control
title: Brainbase Workflow Mission Control Spec
related_story: docs/stories/story-brainbase-workflow-mission-control.md
related_architecture: docs/architecture/brainbase-workflow-mission-control-architecture.md
status: proposed
created_at: 2026-06-01
updated_at: 2026-06-01
---

# Brainbase Workflow Mission Control Spec

## 1. Scope

Brainbase Workflow Mission Control は、Brainbase上の反復業務、routine、AI worker、人間判断を workflow として管理するための control plane である。

MVPでは、workflow editor や重厚な orchestration engine ではなく、以下を成立させる。

- Workflow を existing Project に所属させる。
- Workflow が使う予定の context と、run が実際に使った context snapshot を分けて記録する。
- UI、CLI、local scheduler、server scheduler、human resume の入口を `runWorkflow()` に集約する。
- Run を単なるログではなく、状態、次アクション、human waiting、closure を持つ作業単位として扱う。
- `/ohayo` を最初の実 routine 候補にし、`brainbase-alive` を最初の smoke workflow にする。

## 2. Invariants

### INV-001: Project identity

Workflow の `project_id` は、Brainbase の Session 作成時に選択する既存 Project と同じ概念を使う。Workflow 専用の別 Project tree は作らない。

Workflow protected API は Session selector と同じ Project identity と alias 正規化を使うが、空の `projectCodes` を unrestricted として扱わない。空 grant unrestricted は UI selector logic に限定する。

### INV-001A: Ownership fields

Workflow definition は `owner_id` を持つ。MVPでは `owner_id`、`default_assignee_id`、`default_approver_id` が同一人物でもよいが、後からチーム運用に拡張できるように別フィールドとして扱う。

### INV-002: Single execution entrance

Workflow の実行入口は、手動実行、CLI、launchd、Lightsail systemd timer、human resume を問わず、必ず `runWorkflow()` に戻る。

`workflow_runs` に状態を書き込む処理を、各 workflow implementation に直接持たせない。

### INV-003: Planned context and resolved context

Workflow definition は実行前に `context_sources` を持つ。Run は実行時に解決した `resolved_context_snapshot` を持つ。

UIでは、実行前に「何を使う予定か」、実行後に「何を実際に使ったか」が分かる必要がある。

### INV-004: Human-in-the-loop as workflow step

Human-in-the-loop は、未追跡の確認モーダルではなく、workflow gate または `workflow_human_steps` として記録する。

対象は approval、review、missing input、external action confirmation を含む。

### INV-005: Simple closure first

MVP の closure state は `open | closed | needs_action` から始める。

複雑な状態は `workflow_runs.status` や `workflow_human_steps.status` で表現し、closure の語彙を増やしすぎない。

### INV-006: Scheduler connectors are explicit future work

MVP は scheduler connector を実装必須にしない。

後続 Story でローカル定期実行を接続する場合は macOS `launchd` を一次選択にする。

`com.brainbase.ui` とは分け、workflow ごとに `com.brainbase.workflow.<workflow-id>` 相当の LaunchAgent を持つ。

後続 Story でサーバ側定期実行を接続する場合は AWS Lightsail 上の `systemd timer` と Node runner/API を一次選択にする。

### INV-007: No canonical in-process cron

Node server 内の `setInterval` や in-process cron は、production workflow run の canonical scheduler にしない。

## 3. Required Scenarios

### S-001: brainbase-alive manual run

Given `brainbase-alive` workflow が登録されている。
When owner が手動実行する。
Then `runWorkflow()` は `workflow_runs.status=success`、`closure_state=closed`、`action_required=none`、`output_count>=1` を記録する。

### S-002: manual local trigger records local run

Given workflow が local execution として登録されている。
When owner が API または local runner equivalent から手動実行する。
Then `runWorkflow()` を通った `env=local` の run が ledger に残る。

### S-003: missing required context

Given workflow に required context source がある。
When run 開始時に context source を解決できない。
Then run は silent failure ではなく `status=needs_action`、`closure_state=needs_action` になる。

`action_required` は `update_input` または `connect_account` のように、次に人間が何をすべきかを示す。

### S-004: human review before external action

Given workflow がメール送信、SNS投稿、外部公開、本番更新のような外部副作用を要求する。
When `hitl_policy` が該当 step に一致する。
Then run は `status=waiting_human` になり、pending の `workflow_human_steps` が作成される。

### S-005: human step resume

Given pending の human step が存在する。
When assigned approver または admin が approve する。
Then resume path は `runWorkflow()` を通り、run ledger と audit log に証跡を残す。

When assigned approver または admin が reject / cancel する。
Then workflow handler は再開されず、元の run は `status=cancelled`、`closure_state=closed` になる。

### S-006: scheduler entrance remains explicit future work

Given local `/ohayo` launchd や Lightsail systemd timer のような scheduled entrance が必要になる。
When この Story のMVPではなく後続 Story で scheduler を接続する。
Then scheduler は直接 business logic を呼ばず、`runWorkflow()` に接続し、`trigger_type=local|cron` と `env=local|cloud` を ledger に残す。

## 4. API Contract

MVP の API 境界は以下を含む。

- `GET /api/workflows`
- `POST /api/workflows`
- `GET /api/workflows/:workflowId`
- `PATCH /api/workflows/:workflowId`
- `POST /api/workflows/:workflowId/run`
- `POST /api/workflow-runs/:runId/rerun`
- `GET /api/workflow-runs/:runId`
- `POST /api/workflow-runs/:runId/human-steps/:stepId/resolve`

API は workspace/project authorization を解決した上で service 層へ渡す。Run state の作成・更新は `runWorkflow()` の責務に寄せる。

`/api/workflow-human-steps/:stepId/resolve` は既存クライアント移行用の compatibility alias として残してよいが、正本の human resume API は run-scoped path とする。

## 5. Data Contract

MVPで first-class に扱う概念は以下である。

- `workflows`
- `workflow_context_sources`
- `workflow_runs`
- `workflow_run_steps`
- `workflow_run_context_snapshots`
- `workflow_human_steps`
- `workflow_outputs`
- `audit_logs`

すべての主要レコードは `workspace_id` と `project_id` を持つ。

## 6. UI Contract

Workflow Mission Control の画面は、workflow一覧だけではなく、次に見るべき operational state を優先する。

- Action Required
- Human Waiting
- Failed Runs
- Last Runs
- Context Sources
- Resolved Context Snapshot
- Owner / Assignee / Approver
- Project association

Project 詳細からは、その Project に紐づく Sessions と Workflows が同じ文脈で見える。

MVPでは `/workflows` に独立した Mission Control surface を置き、最低限 `project_id`、`owner_id`、latest run、`action_required`、human waiting、context sources を表示する。

### UI-001: Workspace home project cards

Workspace home は Project cards を表示する。

Each Project card shows project name, document/context count, workflow count, latest operational state summary when available, and overflow menu.

### UI-002: Project detail owns workflow browsing and creation

Project detail は、その Project に紐づく Workflows と Documents を同じ文脈で表示する。

Project detail の Add Workflow は、その Project の `project_id` を初期値として workflow draft を作る。

### UI-003: Global `/workflows` is an operational inbox

`/workflows` は workflow creation の主入口ではなく、cross-project operational inbox とする。

Ordering priority is human waiting, action required, failed / needs action, running, stale, recently successful, then healthy scheduled.

### UI-004: Workflow detail before full canvas

Workflow detail は full canvas editor より先に実装されるべき画面である。

### UI-005: Workflow canvas is future editor surface

Canvas / node graph は望ましい方向性だが、MVPの最初の必須実装ではない。

### UI-006: Run detail / trace

Run detail は実行ログを作業証跡として表示する。

### UI-007: Context binding visibility

UI は Project に document が存在する状態と、workflow context source に bind されている状態を区別する。

Before run: planned context sources, required / optional, source type, source ref, permission, and missing state.

After run: resolved context snapshot, source version or hash when available, item count, preview, and permission used.

## 7. Out Of Scope

- 複数段階承認。
- 高度な RBAC。
- Temporal / Airflow / Step Functions への移行。
- workflow node editor の本格実装。
- local agent polling の本格実装。
- `/ohayo` / `/oyasumi` / `/retro` の完全移行。
