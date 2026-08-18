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

JST変換修正またはtenant境界導入より前に作られた既存rowは自動では変わらない。公開投稿を有効化する前に、対象日のreview packをcanonical tenant binding付きで再インポートし、既存mutable rowの `scheduled_at` とbindingを補正する。bindingのないrowはpublisherが`TENANT_BOUNDARY_INVALID`で拒否し、別tenantや既定tenantへ補完しない。

取込前に、deployment-local設定へ次の非秘密識別子を明示する。値は対象deploymentのTenant Authority／resource正本と照合し、このrepo、fixture、ログへ実値を固定しない。

- `BRAINBASE_SNS_TENANT_ID`
- `BRAINBASE_SNS_TENANT_REVISION`
- `BRAINBASE_SNS_RESOURCE_OBJECT_TYPE`
- `BRAINBASE_SNS_RESOURCE_ID`

いずれかが欠落またはcanonical形式でなければ、取込CLIはLedger APIへ送信する前に非zeroで停止する。

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

公開には`SNS_AUTO_PUBLISH_ENABLED=true`だけでなく、次のdeployment-local bindingが必要である。

- `BRAINBASE_TENANT_RUNTIME_ENABLED=1`
- `SNS_POSTING_LEDGER_DATABASE_URL`または既存の本番DB URL設定
- tenant runtimeの署名鍵、service auth、deployment設定
- 上記4つのSNS tenant／resource設定で再インポート済みのLedger row

`SNS_AUTO_PUBLISH_ENABLED=true`がない場合は`auto_publish_disabled`としてskipする。runtime／PostgreSQL gatewayがなければrunner起動時に停止し、row bindingがない、越境、またはrevision不一致ならclaimとprovider呼出しより前に停止する。

SNS Cockpitの`POST /api/sns-growth/posts/:id/publish`はdry-run確認専用であり、`confirm_public_post=true`を指定しても公開しない。実公開はこのrunnerだけがtenant認可、PostgreSQL claim、provider呼出しの順で行う。

productionでは`SNS_POSTING_LEDGER_DATABASE_URL`、`INFO_SSOT_DATABASE_URL`、`INFO_SSOT_DB_URL`のいずれかが必須である。未設定時は503で停止し、`var/sns-posting-ledger.json`へfallbackしない。JSON repositoryはtestで`BRAINBASE_TEST_MODE=true`と`SNS_POSTING_LEDGER_MODE=json_test`を同時に指定した場合だけ使用できる。

## launchd運用

1分間隔などで起動する場合は、LaunchAgentからこのコマンドを呼ぶ。repo内plistは安全な初期値として`SNS_AUTO_PUBLISH_ENABLED=false`、`BRAINBASE_TENANT_RUNTIME_ENABLED=0`を持つ。公開時はrepoへ識別子やDB資格情報を書かず、deployment-localのLaunchAgent／環境管理で必要設定を注入する。初回はdry-runまたはskipログを確認し、tenant binding再インポートと正本認可を確認してから有効化する。

ログで確認する値:

- `due`: 期限到来した `scheduled` 投稿数
- `posted`: 投稿成功数
- `failed`: 投稿失敗数
- `skipped`: 自動投稿無効またはclaim失敗でskipした数

失敗時はLedger statusが `publish_failed` になり、memoに失敗理由が残る。
