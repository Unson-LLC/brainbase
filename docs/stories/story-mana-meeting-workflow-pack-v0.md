---
story_id: story-mana-meeting-workflow-pack-v0
title: Mana Meeting Workflow Pack v0
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
architecture_docs:
  - docs/architecture/mana-meeting-workflow-pack-architecture.md
spec_docs:
  - docs/specs/story-mana-meeting-workflow-pack-v0-spec.md
design_docs:
  - path: docs/design/meeting-workflow-pack-ui.md
    status: imported
related_stories:
  - story-brainbase-workflow-mission-control
  - story-org-agent-loop-control-v0
  - STR-006
---

# Mana Meeting Workflow Pack v0

## 背景

Manaはすでに会議業務に関わっている。議事録作成、議事録からのタスク抽出、議事録からのDecision抽出、MTG前準備、MTG後の挨拶文作成は、単発のチャット依頼ではなく、繰り返し発生する業務ワークフローである。

最初にLoop化する対象は、広い意味での営業Agentではなく、実運用に近いManaの会議ワークフロー群がよい。会議業務は、3種類のTriggerをすべて含むため、Brainbase Business Loop Control Planeの最初の検証対象として適している。

- `schedule`: MTG開始前に準備する。
- `event`: MTG終了、文字起こし完了、議事録保存を契機に後続処理を起動する。
- `human`: 人間が「この議事録からタスクを切って」「Decisionにして」「お礼文を作って」と依頼する。

このStoryの中心はPrompt Templateではない。中心はWorkflow Definitionである。Workflow Definitionは、入力契約、参照Context、判断DAG、出力契約、Human Gate、反映先Mapping、監査証跡要件を持つ業務能力の単位である。

## User Story

Manaで会議業務を回すBrainbase operatorとして、会議前後の定型業務をWorkflow Definitionとして管理し、Workflow Mission Controlで追跡したい。そうすることで、Manaが会議を議事録、タスク、Decision、準備資料、フォロー文面へ変換しても、Brainbase側に所有者、Context Snapshot、承認、監査証跡、学習候補を残せる。

## Core Concept

`Meeting Ops Agent` は正本ではない。Meeting Ops Agentは、Brainbase管理下で会議Workflow Definitionを選択し、Loop Eligibilityを通して実行するRole Agentである。

```text
Trigger
  -> Meeting Ops Agent
  -> Workflow Definition選択
  -> Loop Eligibility
  -> Context Snapshot
  -> Eveまたはrunner実行
  -> Workflow Mission Control run
  -> Human Gate
  -> Task / Decision / Meeting Note / Message Draft / Learning Candidate
```

## Workflow Definition

Workflow Definitionは穴埋めテンプレートではない。

```text
Workflow Definition
  = input contract
  + context policy
  + judgment DAG
  + output contract
  + human gate
  + write-back mapping
  + audit evidence requirements
```

このStoryでは、少なくとも次の会議Workflow DefinitionをBrainbaseで表現できるようにする。

| Workflow Definition | Trigger class | 入力 | 出力 | Human Gate |
|---|---|---|---|---|
| `pre-meeting-briefing` | `schedule`, `human` | calendar event、参加者、関連project/customer/org、過去議事録、未完了task、過去Decision | agenda、context brief、想定論点、聞くべき質問 | 共有前は任意 |
| `transcript-to-meeting-note` | `event`, `human` | transcript、chat log、raw note、参加者、meeting metadata | 議事録ドラフト、要約、論点、未決事項 | 正式議事録化前に必須 |
| `meeting-note-to-tasks` | `event`, `human` | 議事録、発言根拠、参加者、担当者候補、期限らしき情報 | task candidate、owner、due date、source evidence、confidence | task作成または担当者確定前に必須 |
| `meeting-note-to-decisions` | `event`, `human` | 議事録、決定らしき発言、背景、代替案、影響するproject/org/customer | Decision candidate、decision owner、理由、根拠、影響範囲、未確認事項 | Graph SSOTのDecision昇格前に必須 |
| `post-meeting-follow-up-message` | `event`, `human` | 議事録、参加者、関係性context、次アクション、tone policy | Slack/email/DM draft、送信先、送信タイミング、フォロー理由 | 外部送信前に必須 |

## Product Boundary

BrainbaseがControl Planeを持つ。

- Workflow Definition registry。
- Role Agent binding。
- Trigger分類。
- Loop Eligibility。
- Context Snapshot。
- Human Gate。
- Workflow Mission Controlのrun、output、audit。
- Graph SSOT、task、Decision、candidate-storeへのwrite-back mapping。

ManaとEveは実行面である。

- Manaはmeeting event、transcript、Slack/channel context、人間向け会議操作を提供する。
- Eveまたは他runnerはWorkflow stepを実行してよい。
- runner outputは、Brainbaseが検証・記録するまで正本ではない。

## Trigger Scenarios

### Schedule Trigger: MTG前準備

Given Brainbaseから見えるprojectまたはchannelに紐づくcalendar eventがある。
When MTG前準備の時間窓に入る。
Then Brainbaseは `pre-meeting-briefing` のLoop Intentを作成し、関連Contextを解決し、生成されたbriefをWorkflow Mission Control outputとして記録する。

### Event Trigger: 文字起こしまたは議事録が利用可能になる

Given ManaがMTG終了、文字起こし完了、または議事録保存イベントを受け取る。
When eventが既知のproject、channel、meeting identityへ紐づく。
Then Brainbaseは `transcript-to-meeting-note`、`meeting-note-to-tasks`、`meeting-note-to-decisions` など、eligibleな後続WorkflowのLoop Intentを作成する。

### Human Trigger: 人間の明示依頼

Given 人間がManaまたはBrainbaseに特定の議事録処理を依頼する。
When 依頼が成果物を指定する、またはMeeting Ops AgentがWorkflowを選択できる。
Then Brainbaseは `trigger_type=human`、選択されたWorkflow Definition、input payload、eligibility result、必要なHuman Gateを持つLoop Intentを作成する。

## Workflow State Scenarios

- `workflow state transition`: meeting eventまたは人間依頼は、runner実行前にLoop Intentを作る。
- `workflow state transition`: meeting identity、project mapping、transcriptが欠けている場合はsilent skipせず `needs_action` へ入れる。
- `workflow state transition`: `meeting-note-to-tasks` はtask candidateを生成してよいが、task作成または担当者確定はhuman stepを待つ。
- `workflow state transition`: `meeting-note-to-decisions` はDecision candidateを生成してよいが、Graph SSOTへのDecision昇格はhuman stepを待つ。
- `workflow state transition`: `post-meeting-follow-up-message` はmessage draftを生成してよいが、外部送信はapprovalを待つ。
- `workflow retry matrix`: 同じmeetingに対するrerunはmeeting identityを保持し、差分理由をevidenceとして残した新しいrunまたはretry attemptとして記録する。
- `workflow rollback guard`: 生成されたtask、Decision、message draftがrejectされた場合、Brainbaseはreject理由を記録し、対象surfaceへ反映しない。
- `workflow audit boundary`: すべてのoutputはmeeting source、transcript/note evidence ref、actor、project/org scope、利用可能なrunner trace refを保持する。

## Failure Modes

- `event_mapping_failure`: meeting eventをproject、channel、org、ownerへ紐づけられない。
- `context_missing`: 必要なcalendar、transcript、note、Graph SSOT、Slack/channel contextが欠けている。
- `speaker_or_actor_ambiguity`: task owner、decision owner、sender/recipientを根拠から特定できない。
- `decision_task_confusion`: action itemにすぎない発言をDecisionとして昇格する、またはDecisionをtaskへ潰してしまう。
- `external_send_risk`: フォロー文面がapprovalなしに外部送信される。
- `graph_promotion_risk`: Decision candidateがowner approvalまたはevidenceなしでGraph SSOTへ書き込まれる。
- `duplicate_output`: event retryにより、idempotency evidenceなしでtask、Decision、messageが重複作成される。
- `privacy_scope_leak`: private channelまたは限定meeting contextが、より広いproject/org scopeのoutputへ混入する。
- `ui_trace_gap`: Workflow Mission Controlで、どのmeetingからどの議事録、task、Decision、draft、human step、audit evidenceが生まれたか追跡できない。

## Acceptance Criteria

- [ ] `Meeting Ops Agent` は会議outputの正本ではなく、会議Workflow Definitionを選択するRole Agentとして表現されている。
- [ ] Brainbaseは `pre-meeting-briefing` をschedule triggerとhuman triggerを持つWorkflow Definitionとして表現できる。
- [ ] Brainbaseは `transcript-to-meeting-note` をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。
- [ ] Brainbaseは `meeting-note-to-tasks` をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。
- [ ] Brainbaseは `meeting-note-to-decisions` をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。
- [ ] Brainbaseは `post-meeting-follow-up-message` をevent triggerとhuman triggerを持つWorkflow Definitionとして表現できる。
- [ ] 各Workflow Definitionは、input contract、context policy、output contract、human gate、write-back mapping、audit evidence requirementを持つ。
- [ ] 会議WorkflowのLoop Intentは、`trigger_type`、meeting identity、project/org scope、選択されたWorkflow Definition、eligibility result、input payloadを保持する。
- [ ] task作成、Decision昇格、外部message送信は、write-backまたは送信前にhuman approvalを要求する。
- [ ] Workflow Mission Controlは、meeting sourceからoutput、human step、最終write-back resultまでのrun traceを表示できる。
- [ ] rejectされたtask、Decision、message candidateはaudit可能なまま残るが、対象surfaceを更新しない。
- [ ] event retryは、明示的なretry evidenceなしにtask、Decision、message outputを重複作成しない。
- [ ] 会議Workflow outputは、該当するpromotionまたはapproval gateを通るまでGraph SSOTとして扱われない。

## Non-goals

- このStoryではManaの人格やSlack UXを再設計しない。
- 後続taskで明示されない限り、このStoryではEve実行を実装しない。
- 既存正本と競合する新しいmeeting databaseを作らない。
- すべてのmeeting発言を自動でtaskまたはDecisionへ昇格しない。
- human approvalなしにMTG後messageを外部送信しない。
