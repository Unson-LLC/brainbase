---
architecture_id: workflow-product-retirement-architecture
title: Workflow Product Retirement Architecture
related_stories:
  - docs/stories/story-workflow-product-retirement-v1.md
status: accepted
created_at: 2026-07-16
updated_at: 2026-07-16
---

# Workflow Product Retirement Architecture

## Decision boundary

廃止対象は`Workflow`という人間向け製品、汎用定義編集、汎用実行入口、Web Mission Controlである。維持対象はMeeting Automationの実行経路と、runnerを横断して実行事実を保持するAutomation Run / Run Receipt / Auditである。

## Current coupling

```text
MeetingSourceMcpSyncService
  -> WorkflowService.bootstrapMeetingWorkflowPack
  -> MeetingAutomationService.bootstrapPack (compatibility adapter)
  -> WorkflowService.ingestMeetingReviewPackage
  -> Eve session dispatch / reconciler
  -> WorkflowRepository

WorkflowService.reviewMeetingWorkflowPackDesign/bootstrapMeetingWorkflowPack/createMeetingPackCalendarLoopIntents
  -> MeetingAutomationService (compatibility adapter)
  -> WorkflowRepository / GoogleCalendarService

WorkflowService._dispatchMeetingNoteGeneration
  -> MeetingAutomationService.dispatchNoteGeneration (compatibility adapter)
  -> Eve session dispatch / WorkflowRepository audit

RunReceiptIngestService
  -> WorkflowRepository
RunReceiptQueryService
  -> WorkflowRepository
  -> project access callbacks
WorkflowService.listRunReceiptInbox/history/diagnosis
  -> RunReceiptQueryService (compatibility adapter)
```

Run Receiptのread modelは専用serviceへ分離済みである。Meeting AutomationとAutomation Runのproduction callerが残る間は`WorkflowService`、workflow route、workflow ledgerを削除しない。Web surface廃止とCore分割を同じ操作にしない。

## Target components

| Component | Responsibility | Public surface |
|---|---|---|
| `MeetingAutomationService` | source sync、meeting ingest、candidate/note dispatch、reconcile | domain-specific API/MCP only |
| `AutomationRunService` | run、step、output、human approval、retry/cancel state transition | MCP + internal API |
| `RunReceiptService` | ingest、latest collapse、filter、history、diagnosis | MCP + service ingest API |
| `ExecutionLedgerRepository` | transaction、idempotency、run/output/audit persistence | internal only |

## Compatibility strategy

1. 新しいservice facadeとcontract testを既存実装の前に追加する。
2. Meeting schedulerとrun receipt ingestを新facadeへ接続する。
3. 旧`WorkflowService`は互換adapterとして残し、production callerが0になるまで削除しない。
4. Web routeを削除する前にMCPとCompanionのcurrent-HEAD evidenceを固定する。
5. `workflow_*` ledger fieldとAPI pathの改名は最後に行い、dual-readまたはadapterでrollback可能にする。

最初の分割sliceでは`RunReceiptQueryService`を追加し、旧3 methodを薄いadapterに縮退した。次のsliceでは`MeetingAutomationService`を追加し、Pack設計レビュー、bootstrap、Calendar入力の旧3 methodを薄いadapterに縮退した。続くsliceでReview Package取り込み後のEve note生成handoffと監査も同Serviceへ移した。いずれもrepositoryとproject access policyはconstructor injectionし、新旧経路が同じ認可と永続化を使うため、caller単位で段階移行できる。Meeting review package ingest、task owner/Graph解決、note/candidate write-back、汎用Eve dispatchは次のMeeting sliceまで`WorkflowService`に残す。Eveの完了検知とreconcileは既存の`EveMeetingNoteReconciler`がすでに独立している。

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

2026-07-16に5 gateを満たし、`/workflows`、shell overlay、専用browser modules、旧UI E2Eを削除した。Meeting scheduler/reconciler、Automation Run、Human Approval、Audit、Run ReceiptのAPIとledgerは変更せず維持している。旧pageを戻す場合もschema rollbackは不要である。
