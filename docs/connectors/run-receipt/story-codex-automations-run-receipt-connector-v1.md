# story-codex-automations-run-receipt-connector-v1

Status: implemented_locally
Control-plane dependency: `story-cross-runtime-run-receipt-inbox-v1`  
Implementation owner repo: `code/brainbase`

Implementation artifact: `scripts/run-receipt/codex-automations-reporter.mjs`

## Outcome

Codex Automationのrun identity、terminal state、thread/task evidenceを`run_receipt.v1`へ正規化し、ローカルのdurable outboxからBrainbaseへ配送する。自動化本文、thread transcript、secretは複製しない。

## Source identity

- `source.type=codex_automations`
- `source.workflow_id=<automation_id>`
- `run.external_run_id=<automation_id>:<source run id>`
- terminal stateが未確認ならpendingを維持し、source run identity自体が得られない観測試行だけを`connector_observation`にする。

## Acceptance boundary

- completed/failed/cancelled/waiting-humanをsource authorityから写像する。
- durable outbox、bounded retry、canonical idempotency key、redacted evidence refsを持つ。
- pre-fix rerunとautomation間collision fixtureを持つ。
- localhost fixtureで検証し、本番automationへの接続は別の明示承認を要する。

## Local implementation evidence

- terminal runとconnector observationを共通contract validatorへ通す。
- `var/run-receipt-outbox/codex-automations`へidempotency key単位でatomic enqueueし、既定5回でdead-letterへ移す。
- reporterはstdinの公開メタデータだけを受け、automation本文・transcript・secretをreceiptへ含めない。
- 本番automation scheduleへの組込み、service token設定、本番canaryは未実施。
