---
story_id: story-workflow-product-retirement-v1
title: Workflow product retirement and Automation Run extraction
source_requirement:
  type: product_direction
  description: 汎用Workflow製品を廃止し、Meeting AutomationとRun/Run Receipt/Auditの実行基盤だけをBrainbase Coreとして残す。
architecture_docs:
  - path: docs/architecture/workflow-product-retirement-architecture.md
    status: accepted
  - path: docs/architecture/ADR-017-agent-first-product-surface.md
    status: accepted
related_tasks:
  - task_source: story
    task_ids:
      - TSK-WFRET-001
      - TSK-WFRET-002
      - TSK-WFRET-003
      - TSK-WFRET-004
status: in_progress
created_at: 2026-07-16
updated_at: 2026-07-16
---

# Workflow product retirement and Automation Run extraction

## Background

Brainbaseは汎用Workflowを人間が作成・編集・公開・手動実行する製品である必要がない。Codex、Claude Code、Mana、GitHub Actionsなどが実行主体となり、Brainbaseが持つべき価値は実行定義のGUIではなく、project scope、run状態、承認待ち、出力、証跡、監査、再確認である。

一方、現行の`WorkflowService`と`workflow-ledger.json`には、文字起こしから議事録を生成するMeeting Packの実稼働経路と、Run Receipt Inboxの正本が同居している。`Workflow`という名称だけを根拠に一括削除すると、Meeting Source Sync、Eve dispatch/reconcile、human approval、run receipt ingestが停止する。

## User story

Brainbase operatorとして、汎用Workflowの作成・編集UIや抽象概念を管理せず、CodexまたはClaude CodeからAutomation RunとRun Receiptを確認・診断し、人間の判断が必要な時だけMac Companionで処理したい。Meeting Packなど実稼働中の自動化を止めずに、Workflow製品の維持コストをなくすためである。

## Target state

```text
Meeting Automation
  -> source sync / ingest / Eve dispatch / reconcile

Automation Run Core
  -> run / step / output / human approval / audit

Run Receipt Inbox
  -> cross-runtime receipt / priority / history / diagnosis

Codex + Claude Code via MCP
  -> inspect / diagnose / retry or resolve where explicitly supported

Mac Companion
  -> blocked / failed / waiting_human / unconfirmed / no_data
```

`Workflow Definition`、汎用draft/test/publish、任意workflowのmanual run、Workflow Builder、Workflow Mission Controlという製品面は廃止する。永続化互換のための`workflow_id`、`workflow_runs`、`/api/workflows`などの内部名は移行期間中だけ維持できるが、新しい公開契約には追加しない。

## Acceptance criteria

- [ ] ac:1 Workflow Mission Control、Workflow Builder、汎用Workflow CRUD/draft/test/publish/manual runをretiring surfaceとして固定する。
- [ ] ac:2 Meeting Source Sync、Meeting Pack ingest、Eve dispatch/reconcileのschedulerとstate transitionを維持する。
- [ ] ac:3 Run、Run Step、Output、Human Approval、Audit、Run Receiptの正本とproject/auth境界を維持する。
- [ ] ac:4 MCPへ汎用Workflow CRUDを移植せず、Run Receiptの全件・filter・history・failure stateと、必要なdomain-specific操作だけを提供する。
- [ ] ac:5 blocked、unconfirmed、no_data、unavailableを成功または0件へ丸めない。
- [ ] ac:6 Mac Companionの要介入projectionが成立した後に`/workflows`と専用client/state/view/testを削除する。
- [ ] ac:7 repository schema/API pathの互換名変更は、読み書き互換とrollback evidenceを持つ別sliceで実施する。
- [ ] ac:8 朝・昼のMeeting Prep PackはCodex Automationのまま維持し、Workflow engineへ移植しない。必要ならRun ReceiptだけをBrainbaseへ送る。

## Migration tasks

| Task | Scope | State |
|---|---|---|
| `TSK-WFRET-001` | 製品境界を固定し、汎用Workflowへの新機能追加とMCP移植を停止 | complete |
| `TSK-WFRET-002` | Run Receipt Inbox/history/diagnosisとMeeting Automationの必要操作をMCPへ追加 | in_progress |
| `TSK-WFRET-003` | 要介入RunをMac Companionへ投影後、Workflow Web surfaceを削除 | pending |
| `TSK-WFRET-004` | `WorkflowService`をMeeting Automation、Automation Run、Run Receiptへ段階分割し、互換名を縮退 | pending |

## Non-goals

- 汎用orchestration engineを別名で再実装しない。
- Workflow canvas、template marketplace、role-agent builderを作らない。
- 朝・昼のMeeting Prep PackをBrainbase server schedulerへ移さない。
- 現行ledgerを一括migrationまたは破棄しない。
