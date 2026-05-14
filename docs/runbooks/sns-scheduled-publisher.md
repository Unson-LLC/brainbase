---
title: SNS Scheduled Publisher Runbook
status: active
date: 2026-05-14
story_id: str.brainbase.sns-scheduled-publisher
---

# SNS Scheduled Publisher Runbook

## 目的

SNS Posting Ledgerの `scheduled` 投稿を予定時刻以降に公開投稿する。対象は `status=scheduled` かつ `scheduled_at <= now` の投稿だけで、`approved` の投稿は自動投稿しない。

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
