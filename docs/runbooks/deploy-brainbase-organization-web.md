# 雲孫向けBrainbase Organization Web配備

## 責務

- `brainbase-organization`: 会社非依存のWeb/API、Dockerfile、汎用composeを所有する。
- `brainbase-unson`: `bb-app.unson.jp`、`bb.unson.jp`、Lightsail、プロキシネットワーク、秘密の配置先を所有する。
- Brainbase正本API: Canonical Taskを保持する。組織版Webは正本APIだけへ接続し、NocoDBへ直接接続しない。

雲孫固有の非秘密設定は `infra/brainbase-organization/production.env.example` が正本。サービス認証トークンはInfisicalのprod環境で管理し、Gitへ保存しない。

## 配備先

- AWS Lightsail: `brainbase-nocodb` (`176.34.20.239`)
- 公開URL: `https://bb-app.unson.jp`
- 正本API: `https://bb.unson.jp`
- リバースプロキシ: 既存の `nginx-proxy` / Let's Encrypt
- 外部Dockerネットワーク: `ubuntu_nocodb-network`
- リリース: `/home/ubuntu/brainbase-organization/releases/<brainbase-organization SHA>`
- 現行リンク: `/home/ubuntu/brainbase-organization/current`

サーバーは非公開GitHubリポジトリの認証を持たない。CI成功・マージ済みの `brainbase-organization` SHAをローカルでarchiveし、対象releaseへ転送する。

## 秘密の受け渡し

1. Brainbase正本APIで組織版Web専用のサービス認証トークンを発行する。
2. Infisicalのprod環境へ `BRAINBASE_ORGANIZATION_SERVICE_TOKEN` として保存し、値を再取得して一致を確認する。
3. サーバーの `/etc/brainbase-organization/brainbase-service-token` へ、コンテナの実行UIDだけが読める権限で配置する。
4. `/etc/brainbase-organization/runtime.env` はexampleの4項目と固定した `RELEASE_SHA` だけを持つ。トークン値は入れない。

## リリースと確認

1. Route 53の `bb-app.unson.jp` Aレコードを `176.34.20.239` へ向け、変更が `INSYNC` になるまで待つ。
2. `brainbase-organization` の対象PRでEVO2 CIが成功したことを確認し、マージSHAを固定する。
3. archiveをreleaseディレクトリへ転送し、`current` を対象SHAへ切り替える。
4. `docker compose --env-file /etc/brainbase-organization/runtime.env -f current/deploy/production/docker-compose.yml up -d --build` で起動する。
5. コンテナのhealthyとイメージSHAを確認する。
6. 公開 `/api/health` の `release_sha` を照合する。
7. 公開 `/api/tasks` で正本データをreadbackする。
8. ブラウザでタスク表示とフィルター、ソート、グループ操作を確認する。

health、CI、公開URLの生成だけでは完了にしない。正本APIのreadbackとブラウザ操作までを別ゲートとして記録する。

## 切り戻し

直前のreleaseを残し、`current` を直前SHAへ戻して同じcomposeコマンドを再実行する。初回配備で直前releaseがない場合は組織版コンテナだけを停止する。DNS、Brainbase正本API、Canonical Task、既存NocoDBは変更しない。
