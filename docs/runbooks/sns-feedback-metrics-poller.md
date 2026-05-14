# SNS Feedback Metrics Poller Runbook

## 目的

SNS Posting Ledger の `posted` / `learning_ready` record から X の反応 metrics を取得し、`metrics_snapshots` に append する。

Graph SSOT へ raw metrics は書かない。Graph へ戻す場合は `learning_ready` record から candidate-store の learning candidate を作り、promotion gate を通す。

## 手動実行

```bash
npm run sns:poll-metrics -- --dry-run --json
```

本番反映:

```bash
SNS_METRICS_POLLING_ENABLED=true npm run sns:poll-metrics -- --json
```

必要な環境変数:

- `SNS_POSTING_LEDGER_DATABASE_URL` または `INFO_SSOT_DATABASE_URL`
- `SNS_X_ACCESS_TOKEN` または `X_ACCESS_TOKEN`

## launchd

テンプレート:

```text
config/com.brainbase.sns-feedback-metrics-poller.plist
```

安全側の初期値は `SNS_METRICS_POLLING_ENABLED=false`。有効化する場合は、ユーザーの LaunchAgents 側で true に変える。

ログ:

```text
var/logs/sns-feedback-metrics-poller.out.log
var/logs/sns-feedback-metrics-poller.err.log
```

## 異常検知

次を満たす場合、snapshot に `anomaly` を残し、notifier callback に渡す。

- `impressions > 1000`
- `replies / impressions > 0.1`

現時点の default notifier は stderr に JSON を出す。Slack / Brainbase 通知先の確定は次 slice。
