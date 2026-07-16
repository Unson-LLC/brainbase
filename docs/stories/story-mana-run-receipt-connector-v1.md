# story-mana-run-receipt-connector-v1

Status: implementation_in_progress  
Control-plane dependency: `story-cross-runtime-run-receipt-inbox-v1`  
Implementation owner: `projects/mana`  
Implementation artifact: `docs/specs/story-mana-run-receipt-connector-v1.md`

## Outcome

ManaのEventBridge scheduled jobがterminalになった時点で`run_receipt.v1`をsource-owned outboxへ投入し、Brainbase Agent Run Inboxへ冪等配送する。ジョブ実行、raw log、credential、再送はManaが所有し、Brainbaseにはredacted summaryとsource-owned evidence referenceだけを渡す。

## Source identity

- `source.type=mana`
- `source.workflow_id=<runtime_target>:<scheduled_job>`
- `run.external_run_id=<runtime_target>:<scheduled_job>:<source invocation id>`
- 既知identityでterminal未確認ならMana outbox/pendingへ残し、`connector_observation`を作らない。

## Acceptance boundary

- success/failed/blocked/cancelledを子processのauthoritative terminal resultから作る。
- explicit non-`none` source actionを保持し、根拠がなければ`no_data`を保持する。
- SQS outboxのpartial batch failureで配送失敗だけを再試行し、source run statusを書き換えない。
- localhost＋公開ダミー値のcontract/queue/HTTP testsを先に通す。本番canaryとsecret設定は別の明示承認を要する。

