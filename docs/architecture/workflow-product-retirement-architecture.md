---
architecture_id: workflow-product-retirement-architecture
title: Workflow Product Retirement Architecture
related_stories:
  - docs/stories/story-workflow-product-retirement-v1.md
status: accepted
created_at: 2026-07-16
updated_at: 2026-07-18
---

# Workflow Product Retirement Architecture

## Decision boundary

廃止対象は`Workflow`という人間向け製品、汎用定義編集、汎用実行入口、Web Mission Controlである。維持対象はMeeting Automationの実行経路と、runnerを横断して実行事実を保持するAutomation Run / Run Receipt / Auditである。

## Current coupling

```text
MeetingSourceMcpSyncService
  -> MeetingAutomationService.bootstrapPack (direct injection)
  -> MeetingAutomationService.ingestReviewPackage
  -> external-runtime handoff / write-back
  -> WorkflowRepository

Meeting Automation routes
  -> MeetingAutomationService (direct injection)

MeetingAutomationService.ingestReviewPackage
  -> MeetingAutomationService.resolveReviewPackageScope
  -> MeetingReviewContextResolver (scope / contract validation)
  -> ProjectAccessPolicy (project/org selection and actor access)
  -> idempotent replay check
  -> MeetingAutomationService.resolveReviewPackageGraphContext
  -> MeetingReviewContextResolver (Graph SSOT context / playbook)
  -> MeetingTaskOwnerResolver (People SSOT / owner candidates)
  -> MeetingAutomationService.verifyReviewPackage
  -> meeting-review-contract (output / human gate / loop intent contract)
  -> MeetingReviewLedgerService (idempotency / run / output / human step / audit)
  -> MeetingAutomationService.dispatchNoteGeneration
  -> external-runtime handoff / WorkflowRepository audit

RunReceiptIngestService
  -> WorkflowRepository
RunReceiptQueryService
  -> WorkflowRepository
  -> ProjectAccessPolicy
Run Receipt read routes
  -> RunReceiptQueryService (direct injection)

Automation Run routes
  -> AutomationRunService (direct injection)
  -> WorkflowRunner / WorkflowRepository
  -> ProjectAccessPolicy / human-step access callback

server/routes/workflows.js
  -> AgentControlCatalogService / LoopIntentService / MeetingAutomationService handoff
  -> /control/*: Meeting Automation / automation-control compatibility
  -> /api/workflow-runs/*: Automation Run detail / retry / human resolve compatibility
  -> generic list/create/detail/update/draft/draft-test/manual-run: retired (404)
```

Run Receipt、Meeting Automation、Automation Run、Companion approval、Agent control、Loop Intent、external-runtime handoffのproduction callerはすべて専用serviceへ直接接続した。旧`WorkflowService`と`AgentLoopControlService`のproduction callerは0件で、実装fileも削除済みである。`workflow` prefixを持つrouteとledger schemaはrollback互換のため残すが、製品面や汎用serviceを意味しない。

## Target components

| Component | Responsibility | Public surface |
|---|---|---|
| `MeetingAutomationService` | source sync、meeting ingest、candidate/note dispatch、reconcile | domain-specific API/MCP only |
| `MeetingTaskOwnerResolver` | People SSOT検索、owner候補の順位付け、選択済みownerの検証 | internal only |
| `MeetingReviewLedgerService` | Review Packageのidempotency、run、output、human step、context snapshot、audit | internal only |
| `ProjectAccessPolicy` | project設定の読込、選択可能性、org参照、actor accessの共通判定 | internal only |
| `AutomationRunService` | run、step、output、human approval、retry/cancel state transition | MCP + internal API |
| `RunReceiptIngestService` / `RunReceiptQueryService` | ingest、latest collapse、filter、history、diagnosis | MCP + service ingest API |
| `AgentControlCatalogService` | role agent、template、binding、triggerのcatalog操作 | compatibility API + internal |
| `LoopIntentService` | Loop Intentの作成、eligibility、一覧 | compatibility API + internal |
| `CompanionApprovalInboxService` | human interventionが必要なRunのread projection | Mac Companion API |
| `AutomationRuntimeDefaultsService` | 必須default automationの明示的seed | internal only |
| `ExecutionLedgerRepository` | transaction、idempotency、run/output/audit persistence | internal only |

## Compatibility strategy

1. 新しいservice facadeとcontract testを既存実装の前に追加する。
2. Meeting schedulerとrun receipt ingestを新facadeへ接続する。
3. 旧`WorkflowService`はproduction callerが0になった時点で削除する。
4. Web routeを削除する前にMCPとCompanionのcurrent-HEAD evidenceを固定する。
5. `workflow_*` ledger fieldと残存するControl/Run互換pathの改名は最後に行い、dual-readまたはadapterでrollback可能にする。

この手順は完了した。旧service名を残すadapterはなく、互換性はroute pathとledger schemaだけで維持している。

最初の分割sliceでは`RunReceiptQueryService`を追加し、read routeへ直接注入して旧3 methodを`WorkflowService`から削除した。次のsliceでは`MeetingAutomationService`を追加し、Pack設計レビュー、bootstrap、Calendar入力の旧3 methodを薄いadapterに縮退した。その後、Meeting Automation routeへ専用serviceを直接注入し、HTTP経路を旧adapterから切り離した。Meeting Source sync workerも同Serviceへ直接注入し、Review Package ingestの旧adapterを削除した。Review Package取り込み後のnote生成は、Brainbase内でruntime sessionを起動・監視する方式を廃止し、`MeetingAutomationService`がCloudflare/computer向けhandoffを返し、外部runtimeが結果を書き戻す境界へ移した。候補の検証、決定論的正規化、source hash照合、SSOT owner解決、human approval gateは維持している。

## Public contract rule

- 新規MCP tool名に`workflow`を使わない。
- 汎用create/update/draft/test/publish/manual-run toolを追加しない。
- Run Receipt readは`ok | unavailable | error`を区別し、依存先失敗を空配列へ変換しない。
- retry、cancel、human resolveは対象runが許可する操作だけを返し、汎用実行へfallbackしない。
- Meeting操作は`meeting_automation_*`としてdomainを明示する。

## Retirement gates

`/workflows`削除には次をすべて要求する。

1. Run Receiptの全件・history・filter・failure stateがMCPで取得できる。
2. waiting_human/blocked/failed/unconfirmed/no_dataがMac Companionへ投影される。
3. Meeting schedulerとreconcilerのcontract testsが旧Webなしでgreenになる。
4. generic Workflow UIへのproduction導線が0件になる。
5. rollback時に旧pageを戻してもledger schemaを巻き戻す必要がない。

## Gate result

2026-07-16に5 gateを満たし、`/workflows`、shell overlay、専用browser modules、旧UI E2Eを削除した。2026-07-17には汎用WorkflowのHTTP APIとCRUD/draft service実装を削除した。2026-07-18には残存責務を専用serviceへ分割し、旧`WorkflowService`と`AgentLoopControlService`を削除した。Meeting Control、scheduler/reconciler、Automation Run、Human Approval、Audit、Run Receiptの契約とledger互換は維持している。
