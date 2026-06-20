---
story_id: story-org-agent-loop-control-v0
title: Org Agent Loop Control v0
status: active
created_at: 2026-06-20
updated_at: 2026-06-20
architecture_docs:
  - docs/architecture/org-agent-loop-control-architecture.md
spec_docs:
  - docs/specs/story-org-agent-loop-control-v0-spec.md
related_stories:
  - story-external-runner-adapter-contract-v0
---

# Org Agent Loop Control v0

## 背景

BrainbaseをBusiness Loop Control Planeとして使う場合、Eveは実行基盤であり、Brainbaseは組織別のRole Agent、Workflow選択、Trigger、Loop Eligibility、承認、証跡、学習候補を管理する。

Graph SSOTにはUnson、SalesTailorなどの組織・プロジェクト正本がすでに存在する。一方で、営業Agent、マーケAgent、バックオフィスAgentがどの組織で、どのWorkflowを、どのTriggerで、どの自律度で実行してよいかはWorkflow Mission Controlの運用正本である。

## User Story

Brainbase operatorとして、UnsonとSalesTailorで異なるRole Agent設定、Workflow選択ルール、Trigger、Loop EligibilityをBrainbase上で管理したい。なぜなら、Eveに実行を委譲しても、組織ごとの判断資産・承認境界・学習ループをBrainbase側に残したいから。

## Acceptance Criteria

- [ ] ac:1 Role Agent Instanceは `org_id` と `project_id` を持ち、同じ営業AgentでもUnsonとSalesTailorで別のcontext policy / tool scope / workflow制約を持てる。
- [ ] ac:2 Workflow TemplateとWorkflow Bindingは、Role Agentが選べるWorkflow候補、選択理由、Judgment DAG参照、自律度を表現できる。
- [ ] ac:3 Triggerは `human`、`event`、`schedule` を区別し、すべて同じLoop Eligibility判定へ接続できる。
- [ ] ac:4 Loop Intentは、Trigger、Role Agent、Workflow Binding、入力、eligibility result、人間承認要否を保存できる。
- [ ] ac:5 Eve `external_runner.v0` payloadは `org_id`、Role Agent Instance、Workflow Template、Trigger、Loop IntentをWorkflow Mission ControlとLearning Candidateへ伝播できる。
- [ ] ac:6 Workflow Mission Control UIのRun Traceで、Org、Role Agent Instance、Workflow Template、Trigger、Loop Intent、Eligibilityを確認できる。
- [ ] ac:7 新しい台帳はGraph SSOTを置き換えず、Graphの `org_id` / `project_id` / `person_id` / `raci_id` を参照する。
- [ ] ac:8 Mermaid図は既存ビューアで構文エラーにならない。

## Trigger Scenarios

- `human trigger`: 人間が営業Agentへ依頼した時、BrainbaseはRole AgentとWorkflow候補を選択し、Eligibilityを保存してからEveへ委譲する。
- `event trigger`: CRM、Slack、Gmail、Webhookなどのイベントが来た時、Brainbaseは同じBindingとEligibilityを使ってLoop Intentを作る。
- `schedule trigger`: 毎朝・毎週・月次などの時間条件が来た時、Brainbaseはscheduled triggerとしてLoop Intentを作る。

## Workflow State Scenarios

- `workflow state transition`: `human`、`event`、`schedule` triggerは入口が違っても、同じ `workflow_bindings` と `loop_intents.eligibility` へ遷移する。
- `workflow state transition`: `autonomy_level=approval_required` のBindingは `loop_intents.eligibility.status=needs_approval` へ遷移する。
- `workflow state transition`: disabledなBindingまたはTriggerは `loop_intents.eligibility.status=blocked` へ遷移し、Eveへ委譲しない。
- `workflow state transition`: Eveから戻る `run.org_id`、Role Agent Instance、Workflow Template、Trigger、Loop IntentはWorkflow Mission Controlのrun/context/output/auditとLearning Candidateへ遷移する。
- `workflow retry matrix`: 同じRole Agent InstanceとWorkflow Bindingから複数Triggerを作っても、Loop IntentはTriggerごとに別記録として保存し、Eligibility判定は同じルールで再生できる。
- `workflow rollback guard`: Role Agent Instance、Workflow Binding、Workflow Triggerの `org_id` が一致しない場合は保存前に拒否する。
- `workflow rollback guard`: Loop Control参照付きEve payloadが既存 `workflow_id` を再利用する場合、既存Workflowの `org_id` が欠落または不一致なら保存前に拒否する。
- `workflow auth boundary`: Eve ingestは既存 `external_runner.v0` の認証境界を使い、未認証payloadをWorkflow Mission Controlへ入れない。
- `workflow state transition`: Eve `run.status=cancelled` はWMC `status=cancelled`、`closure_state=closed`、`action_required=none` に正規化し、承認待ちや再試行待ちには入れない。

## Failure Modes

- `parse_failure`: malformed JSONや非object payloadは外部runner ingestのparser/contract境界で拒否し、Workflow Mission Controlへ保存しない。
- `schema_failure`: Loop Control参照付きpayloadで必須になる `org_id`、不正な `trigger_type`、不正な `autonomy_level`、org不一致は保存前に拒否する。
- `auth_denied`: `/api/external-runner` の未認証requestはRole Agent / Workflow / Learning Candidateへ保存されない。
- `retry_or_async_failure`: Eveやevent/schedule triggerの同一内容再送は同じrunを冪等に再利用し、内容差分のある再送はsilent duplicateにせず拒否する。
- `runner_cancelled`: Eveがcancelledで返したrunはclosedな取り消し結果として保存し、人間承認・自動再実行の対象にしない。
- `persistence_failure`: WMC run/context/output/auditの一部だけが保存される状態、またはLearning Candidate失敗がaudit evidenceなしで隠れる状態を失敗として扱う。
- `persistence_mismatch`: APIでは成功しても、run/context/output/auditとLearning Candidate stored/deferred evidenceへ `org_id` とLoop参照が落ちない場合は失敗として扱う。
- `ui_trace_gap`: Run Trace UIでOrg、Role Agent Instance、Workflow Template、Trigger、Loop Intent、Eligibilityが見えない場合は失敗として扱う。

## 非目標

- Graph SSOTへRole AgentやTriggerをGraph真理として直入れしない。
- Eveのschedule、channel、approval UIをBrainbase内に再実装しない。
- v0ではEve agent directoryのdeployやconnection登録をBrainbaseから直接操作しない。
