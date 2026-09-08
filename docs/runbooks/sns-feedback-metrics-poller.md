# SNS Feedback Metrics Poller Runbook

## 廃止済み（2026-09-04）

以下は履歴として残した旧運用手順です。コマンドの実行や定期取得の再有効化は行わないでください。現在の手順は [SNS廃止の配備・読戻し](retire-sns.md) を参照してください。既存台帳とログは保全します。

## 目的

SNS Posting Ledger の `posted` / `learning_ready` record から X の反応 metrics を取得し、`metrics_snapshots` に append する。

Graph SSOT へ raw metrics は書かない。Graph へ戻す場合は `learning_ready` record から candidate-store の learning candidate を作り、promotion gate を通す。

## 手動実行

```bash
npm run sns:poll-metrics -- --date YYYY-MM-DD --dry-run --json
```

本番反映:

```bash
SNS_METRICS_POLLING_ENABLED=true npm run sns:poll-metrics -- --date YYYY-MM-DD --json
```

`--date` は本番反映時に必須。省略すると複数日の Ledger record を poll / 更新し得るため、CLI は non-dry-run の日付未指定を失敗させる。

必要な環境変数:

- `SNS_POSTING_LEDGER_DATABASE_URL` または `INFO_SSOT_DATABASE_URL`
- `SNS_X_ACCESS_TOKEN` または `X_ACCESS_TOKEN`

## launchd

テンプレート:

```text
config/com.brainbase.sns-feedback-metrics-poller.plist
```

安全側の初期値は `SNS_METRICS_POLLING_ENABLED=false`。有効化する場合は、ユーザーの LaunchAgents 側で true に変える。
テンプレートは実行日の `--date "$(date +%F)"` を渡すため、scheduled polling も日付スコープ外の Ledger record を更新しない。

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
