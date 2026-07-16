---
architecture_id: workflow-product-retirement-architecture
title: Workflow Product Retirement Architecture
related_stories:
  - docs/stories/story-workflow-product-retirement-v1.md
status: accepted
created_at: 2026-07-16
updated_at: 2026-07-17
---

# Workflow Product Retirement Architecture

## Decision boundary

廃止対象は`Workflow`という人間向け製品、汎用定義編集、汎用実行入口、Web Mission Controlである。維持対象はMeeting Automationの実行経路と、runnerを横断して実行事実を保持するAutomation Run / Run Receipt / Auditである。

## Current coupling

```text
MeetingSourceMcpSyncService
  -> MeetingAutomationService.bootstrapPack (direct injection)
  -> WorkflowService.ingestMeetingReviewPackage
  -> Eve session dispatch / reconciler
  -> WorkflowRepository

Meeting Automation routes
  -> MeetingAutomationService (direct injection)

WorkflowService._dispatchMeetingNoteGeneration
  -> MeetingAutomationService.dispatchNoteGeneration (compatibility adapter)
  -> Eve session dispatch / WorkflowRepository audit

WorkflowService.ingestMeetingReviewPackage
  -> MeetingAutomationService.resolveReviewPackageScope
  -> MeetingReviewContextResolver (scope / access / contract validation)
  -> idempotent replay check
  -> MeetingAutomationService.resolveReviewPackageGraphContext
  -> MeetingReviewContextResolver (Graph SSOT context / playbook / owner candidates)
  -> MeetingAutomationService.verifyReviewPackage
  -> meeting-review-contract (output / human gate / loop intent contract)
  -> MeetingReviewLedgerService (idempotency / run / output / human step / audit)
  -> WorkflowService Eve handoff orchestration (temporary compatibility boundary)

RunReceiptIngestService
  -> WorkflowRepository
RunReceiptQueryService
  -> WorkflowRepository
  -> project access callbacks
Run Receipt read routes
  -> RunReceiptQueryService (direct injection)

Automation Run routes
  -> AutomationRunService (direct injection)
  -> WorkflowRunner / WorkflowRepository
  -> project and human-step access callbacks

server/routes/workflows.js
  -> /control/*: Meeting Automation / org-agent control compatibility
  -> /api/workflow-runs/*: Automation Run detail / retry / human resolve compatibility
  -> generic list/create/detail/update/draft/draft-test/manual-run: retired (404)
```

Run Receiptのread modelは専用serviceへ分離済みである。Meeting Automationのroute、Meeting Source sync worker、内部callerは`MeetingAutomationService`へ直接接続し、`WorkflowService`のMeeting Automation互換adapterは削除済みである。Review Package ingestは`WorkflowService`へ残す。Meeting AutomationとAutomation Runのproduction callerが残る間は`WorkflowService`、workflow route、workflow ledgerを削除しない。Web surface廃止とCore分割を同じ操作にしない。

## Target components

| Component | Responsibility | Public surface |
|---|---|---|
| `MeetingAutomationService` | source sync、meeting ingest、candidate/note dispatch、reconcile | domain-specific API/MCP only |
| `MeetingReviewLedgerService` | Review Packageのidempotency、run、output、human step、context snapshot、audit | internal only |
| `AutomationRunService` | run、step、output、human approval、retry/cancel state transition | MCP + internal API |
| `RunReceiptService` | ingest、latest collapse、filter、history、diagnosis | MCP + service ingest API |
| `ExecutionLedgerRepository` | transaction、idempotency、run/output/audit persistence | internal only |

## Compatibility strategy

1. 新しいservice facadeとcontract testを既存実装の前に追加する。
2. Meeting schedulerとrun receipt ingestを新facadeへ接続する。
3. 旧`WorkflowService`は互換adapterとして残し、production callerが0になるまで削除しない。
4. Web routeを削除する前にMCPとCompanionのcurrent-HEAD evidenceを固定する。
5. `workflow_*` ledger fieldと残存するControl/Run互換pathの改名は最後に行い、dual-readまたはadapterでrollback可能にする。

最初の分割sliceでは`RunReceiptQueryService`を追加し、read routeへ直接注入して旧3 methodを`WorkflowService`から削除した。次のsliceでは`MeetingAutomationService`を追加し、Pack設計レビュー、bootstrap、Calendar入力の旧3 methodを薄いadapterに縮退した。その後、Meeting Automation routeへ専用serviceを直接注入し、HTTP経路を旧adapterから切り離した。Meeting Source sync workerと一部の内部callerは次のsliceまで互換adapterを利用する。続くsliceでReview Package取り込み後のEve note生成handoffと監査も同Serviceへ移した。さらにReview Packageのoutput/human gate定義とloop intent整合性検証を`meeting-review-contract`と`MeetingAutomationService.verifyReviewPackage`へ移し、Workflow側からMeeting固有contractを除去した。scope、access、contract validation、Graph SSOT context/playbook、task owner候補解決は`MeetingReviewContextResolver`へ移した。scope解決とGraph lookupを二段階に分け、既存のidempotent replayがGraphを再取得しない順序も維持している。Review Packageの二重取り込み防止、run/output/human-step/context snapshot/audit永続化は`MeetingReviewLedgerService`へ移し、Graph lookup後のtransaction内recheckも維持した。Automation Runの手動実行guard、retry、run詳細、human approval/rejection/cancel/resume状態遷移は`AutomationRunService`へ移した。汎用manual-run HTTP route廃止後にproduction callerが0件となった`WorkflowService.runWorkflow` adapterを削除し、続いてrun detail/retry/human resolve routeへ`AutomationRunService`を直接注入した。これにより実行系4 methodはすべて`WorkflowService`から外れた。汎用Workflow製品のproduction callerが0件であることを確認し、list/create/detail/update/draft/draft-test route、対応する`WorkflowService` method、draft generatorを削除した。いずれもrepositoryとproject access policyはconstructor injectionし、新旧経路が同じ認可と永続化を使うため、caller単位で段階移行できる。Meeting review packageのnote/candidate write-backと汎用Eve dispatchは次のMeeting sliceまで`WorkflowService`に残す。Eveの完了検知とreconcileは既存の`EveMeetingNoteReconciler`がすでに独立している。

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

2026-07-16に5 gateを満たし、`/workflows`、shell overlay、専用browser modules、旧UI E2Eを削除した。2026-07-17には汎用Workflowのlist/create/detail/update/draft/draft-test/manual-run HTTP APIと、対応するCRUD/draft service実装も削除した。Meeting Control、scheduler/reconciler、Automation Runのdetail/retry/human resolve、Human Approval、Audit、Run ReceiptのAPIとledgerは維持している。旧pageを戻す場合もschema rollbackは不要である。
