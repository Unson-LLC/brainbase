# GitHub Actions運用ガイド

## CIの責務

変更対象に応じて、必要な検証だけを実行する。

| 変更・操作 | 実行する検証 | 副作用 |
| --- | --- | --- |
| パッケージ関連のPull Request | Node 22の`npm test`（Vitestの完全収集）とbuild、Node 20の代表統合スイート | deployなし |
| ドキュメント関連のPull Request | `docs:check`、公開契約テスト、VitePress build、built HTML smoke | deployなし |
| `develop`への公開サイト入力のpush | 上記ドキュメント検証、Cloudflare Pages deploy、`docs:verify-public`による公開後readback | 公開サイトのみ |
| npm公開 | immutable commitのrelease validation、artifact/proofの受け渡し、provenance付きpublish、GitHub Release確認 | npm公開権限はrelease workflowだけが使用 |
| public-message promotion | 候補の契約検証とドキュメント検証を済ませたreview PRの作成 | 自動merge・自動deployなし |

`docs-cloudflare-pages.yml`のpush deploy入力は、`docs/manual/**`、`docs/.vitepress/**`、`docs/publication/public-message.json`、`docs/publication/organization-teaser.json`、`package.json`、`package-lock.json`、同workflow自身に限定する。CIガイドやStoryなど内部文書だけの変更ではdeployしない。

`.vibepro/**`だけのPull Requestは、Story metadataやローカル証跡としてpackage/docs CIの対象外とする。`.vibepro`の設定がCI実行、package、docs、publicationの生成へ作用する変更を追加する場合は、この免除を使わず対象workflowの入力へ追加し、安全側で検証する。

`npm ci`はlifecycleの`prepare`でbuildを起動するため、各workflowは`npm ci --ignore-scripts`を使い、必要なbuildを明示的に一度だけ実行する。docs workflowはpackage build/testを担当せず、ドキュメント契約に集中する。

失敗またはキャンセル時は、各workflowの`GITHUB_STEP_SUMMARY`に保護していた要件、再現コマンド、期待結果、未確認の状態を記録する。package CIはpackage検証、docs CIは公開readback、npm publishはartifact・registry・Releaseのreadback、promotionはreview PRの状態を確認対象とする。公開やnpm publishの再実行は、この未確認状態を確認してから判断する。

## 手動実行

| ジョブ名 | 目的 | ワークフロー | ランナー |
| --- | --- | --- | --- |
| Cloudflare Worker secret同期 | 対象account IDを固定確認し、`brainbase-tenant-runtime`の`BRAINBASE_SERVICE_JWT`を1件だけ更新する | `.github/workflows/docs-cloudflare-pages.yml` | `ubuntu-latest` |

## 必要なSecrets

- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`: Worker secretを更新できる限定API token
- `BRAINBASE_SERVICE_JWT`: `brainbase-tenant-runtime`へ同期するservice token

`workflow_dispatch`の`expected_account_id`が`CLOUDFLARE_ACCOUNT_ID`と一致しない場合は、書き込み前に失敗する。
