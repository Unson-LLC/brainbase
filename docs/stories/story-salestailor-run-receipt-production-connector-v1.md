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
- [ ] job id/run idから決定的なreceiptを生成し、success/failed/blocked/waiting human/cancelledを保持する。
- [ ] processed/succeeded/failed等のmetricは数値だけを送り、顧客・企業・返信内容を含めない。
- [ ] API/DB/auth障害でsource stateを読めない場合はconnector observationとし、0件successへ変換しない。
- [ ] delivery outboxと再送checkpointを持ち、Brainbase障害時もsource jobを再実行しない。
- [ ] production canaryがBrainbase Inbox、SalesTailor job、evidence refの3点で照合できる。

## Failure Modes

- 4xx contract/auth errorはblocked outbox、timeout/5xxはretryable deliveryとして分離する。
- 部分成功はoverall successへ丸めず、source statusとfailed count/actionを保持する。
