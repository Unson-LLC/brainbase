---
story_id: story-salestailor-run-receipt-production-connector-v1
title: SalesTailor production run receipt connector v1
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
implementation_repo: /Users/ksato/workspace/code/salestailor
runtime_owner: salestailor
---

# SalesTailor production run receipt connector v1

## User Story

SalesTailor operatorとして、campaign・form submission・batch job等の実行結果をBrainbaseへ自動集約したい。なぜなら、送信停止・認証切れ・人手確認・実データ未取得をSalesTailorの個別画面やログだけで追わず、経営上の要介入runとして確認したいから。

## Outcome

- SalesTailor自身のjob/run authorityからBrainbaseへ直接receiptを送る。
- 顧客本文・フォーム本文・返信本文・lead PIIは送らず、job identity、状態、集計metric、管理画面/artifact refだけを送る。
- campaign処理0件とsource未確認/no_dataを区別する。

## Acceptance Criteria

- [ ] productionで権威あるjob/run storeとstatus mappingをlive inspectionで確定し、campaign/form/batchの対象範囲を列挙する。
- [ ] authority確定後は `source.workflow_id = "salestailor:" + job_kind + ":" + job_definition_id`、`run.external_run_id = "salestailor:" + job_kind + ":" + job_definition_id + ":run:" + native_run_id + ":attempt:" + native_attempt` を使う。attemptを持たないauthorityは1を固定し、source-defined rerunだけを別receipt、同じattemptの再送をdelivery retryとして扱う。同じnative run idを返す2 job definitionのcross-scope fixtureでも衝突しない。
- [ ] terminal stateは `completed|success -> success`、`failed|timed_out -> failed`、`blocked|partial_success -> blocked`、`waiting_human|requires_action -> waiting_human`、`cancelled -> cancelled` と決定的に変換する。`partial_success` はfailed countと `review_run` actionを保持する。既知runのrunning/unknown/nullはoutboxでpendingのまま再観測し、authority障害でrun identity自体を得られない場合だけconnector observationを作る。
- [ ] processed/succeeded/failed等のmetricは数値だけを送り、顧客・企業・返信内容を含めない。
- [ ] API/DB/auth障害でsource stateを読めない場合、checkpoint等からrun identityが既知ならpendingのまま再観測し、terminal statusまで既知でevidenceだけ取得不能ならsource receiptを`unconfirmed|no_data`で送る。run identity自体を得られない観測試行だけconnector observationとし、0件successへ変換しない。
- [ ] delivery outboxと再送checkpointを持ち、Brainbase障害時もsource jobを再実行しない。
- [ ] production canaryがBrainbase Inbox、SalesTailor job、evidence refの3点で照合できる。

## Status / Evidence Mapping

| Native state | Receipt status | Evidence state | Action / blocker |
|---|---|---|---|
| `completed|success` | `success` | job/artifact ref確認済みなら`confirmed`、参照取得不能なら`unconfirmed`、権威的に証跡なしなら`no_data` | `none` |
| `failed|timed_out` | `failed` | 上記と同じ | `check_error`とredacted blocker |
| `blocked` | `blocked` | 上記と同じ | `resolve_blocker`とredacted blocker |
| `partial_success` | `blocked` | 上記と同じ | `review_run`とfailed countを含むredacted blocker |
| `waiting_human|requires_action` | `waiting_human` | 上記と同じ | `review_run` |
| `cancelled` | `cancelled` | 上記と同じ | `none` |
| identity既知、status不明/非terminal | receiptなし | connector pending | 再観測 |
| identity既知、terminal status既知、evidence取得不能 | source receipt | `unconfirmed|no_data` | statusに対応するaction |
| identity不明 | `connector_observation`の`blocked` | `unconfirmed|no_data` | `check_error`または`reauthorize`とblocker |

## Failure Modes

- 4xx contract/auth errorはblocked outbox、timeout/5xxはretryable deliveryとして分離する。
- 部分成功はoverall successへ丸めず、source statusとfailed count/actionを保持する。

## Verification

- `tests/connectors/salestailor-run-receipt.test.js` は同じjob definition/runのattempt 1/2が別identityで共存し、同じattemptのdelivery再送だけがduplicateになるpre-fix失敗fixtureを持つ。同じnative run idを返す2 job definitionも共存する。
- 同fixtureは全terminal mapping、partial success、known-run pending、terminal-known/evidence-unavailable、identity取得不能observation、outbox/checkpoint replay、数値metricだけの送信、顧客本文・PII排除、no_dataを0件successへ潰さないことを検証する。
