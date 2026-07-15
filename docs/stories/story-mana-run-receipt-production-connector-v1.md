---
story_id: story-mana-run-receipt-production-connector-v1
title: Mana production run receipt connector v1
status: proposed
created_at: 2026-07-15
updated_at: 2026-07-15
horizon: quarter
view: business
period: 2026Q3
depends_on:
  - story-cross-runtime-run-receipt-inbox-v1
related_stories:
  - story-cross-runtime-run-receipt-inbox-v1
implementation_repo: /Users/ksato/workspace/projects/mana
---

# Mana production run receipt connector v1

## User Story

Mana operatorとして、Lambda・self-hosted runner上で実際に完了したMana workflowの結果をBrainbaseへ自動送信したい。なぜなら、Manaの成功・失敗・停止・証跡不足をCloudWatchや個別runnerへ巡回せずAgent Run Inboxで判断したいから。

## Outcome

- Manaを4ソースのhubにせず、自身のrunだけを直接 `run_receipt.v1` でBrainbaseへ送る。
- 実run id、最終status、件数metric、CloudWatch/GitHub artifact refをsource-owned evidenceとして使う。
- delivery障害はMana outboxで再送し、source run statusを書き換えない。

## Acceptance Criteria

- [ ] `source.type=mana`、`source.workflow_id = "mana:" + runtime_target + ":" + workflow_key`、`run.external_run_id = "mana:" + runtime_target + ":" + workflow_key + ":run:" + native_execution_id + ":attempt:" + native_attempt` を使う。`native_attempt` を持たないsourceは1を固定し、同じnative executionのdelivery再送では増やさない。sourceが定義した別attemptだけが別receiptになる。同じnative execution idを返す2 workflowのcross-scope fixtureでも衝突しない。
- [ ] terminal stateは `succeeded|completed -> success`、`failed|timed_out -> failed`、`blocked -> blocked`、`waiting_human|action_required -> waiting_human`、`cancelled -> cancelled` と決定的に変換する。既知runのrunning/unknown/nullはoutboxでpendingのまま再観測し、run identity自体を得られない場合だけconnector observationを作る。
- [ ] production Lambdaとself-hosted runnerの双方からBrainbase S2S endpointへ認証接続できる。secretはInfisical/既存正規経路で供給し、ログへ出さない。
- [ ] 同一run再送は同じidempotency keyとなり、delivery attemptだけが増える。
- [ ] source API/Brainbase到達不能は永続outboxへ残り、次回再送される。source run identityを得られない場合だけconnector observationを送る。
- [ ] raw Slack本文、議事録本文、customer content、CloudWatch log本文をreceiptへ含めない。
- [ ] production canary runがBrainbase Inboxに表示され、Mana側run/evidenceと双方向に照合できる。

## Status / Evidence Mapping

| Native state | Receipt status | Evidence state | Action / blocker |
|---|---|---|---|
| `succeeded|completed` | `success` | source ref確認済みなら`confirmed`、参照取得不能なら`unconfirmed`、権威的に証跡なしなら`no_data` | `none` |
| `failed|timed_out` | `failed` | 上記と同じ | `check_error`とredacted blocker |
| `blocked` | `blocked` | 上記と同じ | `resolve_blocker`とredacted blocker |
| `waiting_human|action_required` | `waiting_human` | 上記と同じ | `review_run` |
| `cancelled` | `cancelled` | 上記と同じ | `none` |
| identity/status terminal既知、evidence取得不能 | source receiptのterminal statusを維持 | `unconfirmed|no_data` | status対応actionを維持し、取得不能理由をredacted blockerへ記録 |
| identity既知、status不明/非terminal | receiptなし | connector pending | 再観測 |
| identity不明 | `connector_observation`の`blocked` | `unconfirmed|no_data` | `check_error`または`reauthorize`とblocker |

`no_data` は処理件数0を意味せず、成功色・空結果へ変換しない。

## Failure Modes

- 認証不備、timeout、5xxはdelivery failureとして再送対象にする。
- 4xx contract errorは自動無限再送せずblocked outboxとして可視化する。
- no_dataを処理件数0のsuccessへ変換しない。

## Verification

- `tests/connectors/mana-run-receipt.test.js` は同じworkflow/native executionのattempt 1/2が別 `external_run_id` とidempotency keyで共存し、同じattemptのdelivery再送だけがduplicateになるpre-fix失敗fixtureを持つ。同じnative execution idを返す2 workflowも共存する。
- 同fixtureは全terminal mapping、既知runのunknown/null pending、identity取得不能のsynthetic observation、delivery outbox replay、CloudWatch/GitHub evidence ref、raw content排除を検証する。
- terminal identity/statusは取得済みだがCloudWatch/GitHub evidence取得だけが失敗するpre-fix失敗fixtureは、connector pendingや`connector_observation`へ変換せず、source receiptのterminal statusと`unconfirmed|no_data`を保存することを検証する。
