---
title: SNS Scheduled Publisher Runbook
status: active
date: 2026-05-14
story_id: str.brainbase.sns-scheduled-publisher
---

# SNS Scheduled Publisher Runbook

## 目的

SNS Posting Ledgerの `scheduled` 投稿を予定時刻以降に公開投稿する。対象は `status=scheduled` かつ `scheduled_at <= now` の投稿だけで、`approved` の投稿は自動投稿しない。

## 時刻の扱い

SNS運用上の `date` と `time` はJSTの壁時計時刻として扱う。review packに `scheduled_at` が明示されていない場合、Ledger importは `date + time` をJSTとして解釈し、DBにはUTC instantのISO文字列で保存する。

例:

- `2026-05-24 09:00` JST -> `2026-05-24T00:00:00.000Z`
- `2026-05-24 12:00` JST -> `2026-05-24T03:00:00.000Z`
- `2026-05-24 15:00` JST -> `2026-05-24T06:00:00.000Z`
- `2026-05-24 18:00` JST -> `2026-05-24T09:00:00.000Z`

`scheduled_at` がreview pack側に明示されている場合は、すでに確定済みの絶対時刻としてそのまま保持する。

## 既存Ledger行の補正

JST変換修正をデプロイした後、修正前に作られた既存の `scheduled_at` は自動では変わらない。公開投稿を有効化する前に、対象日のreview packを再インポートして既存のmutable rowを補正する。

```bash
TODAY=$(date +%F)
npm run sns:import-review-pack -- --date "$TODAY"
npm run sns:scheduled-publish -- --dry-run --json
```

再インポートは `posted` / `learning_ready` / `deleted` の公開履歴を上書きしない。`review_needed` / `approved` / `scheduled` / `publish_failed` の行は、同じaccount/date/slotなら本文・根拠・`time`・`scheduled_at` を更新する。

dry-runで過去時刻のdue postが出た場合、すぐ公開される可能性がある。`SNS_AUTO_PUBLISH_ENABLED=true` にする前に、即時投稿するのか、UIで未来時刻へずらすのかを決める。

## 手動確認

```bash
npm run sns:scheduled-publish -- --dry-run --json
```

`dry_run=true` の場合、due postの選択だけを確認し、Ledger更新もX投稿も行わない。

## 公開投稿

```bash
SNS_AUTO_PUBLISH_ENABLED=true npm run sns:scheduled-publish -- --json
```

`SNS_AUTO_PUBLISH_ENABLED=true` がない場合、due postがあっても `auto_publish_disabled` としてskipする。

## launchd運用

1分間隔などで起動する場合は、LaunchAgentからこのコマンドを呼ぶ。plistには公開投稿の副作用があるため、初回は `SNS_AUTO_PUBLISH_ENABLED=false` でdry-runまたはskipログを確認し、運用判断後に `true` へ切り替える。

ログで確認する値:

- `due`: 期限到来した `scheduled` 投稿数
- `posted`: 投稿成功数
- `failed`: 投稿失敗数
- `skipped`: 自動投稿無効またはclaim失敗でskipした数

失敗時はLedger statusが `publish_failed` になり、memoに失敗理由が残る。
