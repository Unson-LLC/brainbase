# GitHub Actions運用ガイド

## 手動実行

| ジョブ名 | 目的 | ワークフロー | ランナー |
| --- | --- | --- | --- |
| Cloudflare Worker secret同期 | 対象account IDを固定確認し、`brainbase-tenant-runtime`の`BRAINBASE_SERVICE_JWT`を1件だけ更新する | `.github/workflows/docs-cloudflare-pages.yml` | `ubuntu-latest` |

## 必要なSecrets

- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`: Worker secretを更新できる限定API token
- `BRAINBASE_SERVICE_JWT`: `brainbase-tenant-runtime`へ同期するservice token

`workflow_dispatch`の`expected_account_id`が`CLOUDFLARE_ACCOUNT_ID`と一致しない場合は、書き込み前に失敗する。
