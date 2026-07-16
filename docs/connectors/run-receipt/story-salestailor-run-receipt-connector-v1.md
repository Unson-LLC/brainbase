# story-salestailor-run-receipt-connector-v1

Status: planned  
Control-plane dependency: `story-cross-runtime-run-receipt-inbox-v1`  
Implementation owner repo: `code/salestailor`

Planned implementation artifact: `src/services/run-receipt/run-receipt-outbox.ts`

## Outcome

SalesTailorのcampaign、form submission、batch job等のterminal stateを`run_receipt.v1`へ正規化し、source-owned outboxからBrainbaseへ配送する。顧客本文、送信本文、raw responseはSalesTailor側に残す。

## Source identity

- `source.type=salestailor`
- `source.workflow_id=<job_kind>:<job_definition_id>`
- `run.external_run_id=<job_kind>:<job_definition_id>:<source run id>`

## Acceptance boundary

- blocked/unconfirmed/no_dataを成功や0件へ変換しない。
- source transactionと同じcommit boundaryでoutbox intentを作り、配送だけを非同期再試行する。
- job kind/definition間collisionとpre-fix rerun fixtureを持つ。
- localhost/public fake fixtureで検証し、本番DB migration、worker enable、secret設定は別の明示承認を要する。
