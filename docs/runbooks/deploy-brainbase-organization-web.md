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
- 利用者認証: Slack OAuth。メールアドレスのドメインや送信元IPでは制限しない
- 認可: SlackワークスペースとSlackユーザーを正本 `auth_grants` に照合し、`ORGANIZATION_ID=unson` と許可プロジェクトをサーバー側で検証する
- リリース: `/home/ubuntu/brainbase-organization/releases/<brainbase-organization SHA>`
- 現行リンク: `/home/ubuntu/brainbase-organization/current`

サーバーは非公開GitHubリポジトリの認証を持たない。CI成功・マージ済みの `brainbase-organization` SHAをローカルでarchiveし、対象releaseへ転送する。

## 秘密の受け渡し

1. Infisicalのprod環境にある既存の正本 `BRAINBASE_TASK_API_TOKEN` を取得する。専用トークンへ切り替える場合も、Infisicalへの保存とreadbackが成功するまで配備に使わない。
2. トークンでBrainbase正本APIの組織、権限、期限と `/api/companion/tasks` の取得を確認する。
3. 値を表示せず、サーバーの `/etc/brainbase-organization/brainbase-service-token` へ、コンテナの実行UIDだけが読める権限で配置し、転送元との一致を確認する。
4. `/etc/brainbase-organization/runtime.env` はexampleの7項目と固定した `RELEASE_SHA` だけを持つ。トークン値は入れない。

## 認証の境界

- 顧客固有ドメインは、その顧客のログイン入口とOAuth結果の返却先として使う。メールドメイン制限には使わない。
- `ORGANIZATION_DIRECTORY_JSON` には、DNS、HTTPS、Slack OAuthの返却先、正本APIの許可origin、組織版Webの配備がすべて確認済みの顧客固有ドメインだけを載せる。SlackワークスペースのURLや未確定の候補ドメインは載せない。
- `BRAINBASE_AUTH_ALLOWED_ORIGINS` に `https://bb-app.unson.jp` を明示し、正本APIがOAuth結果を返せるoriginを限定する。
- 管理画面の利用者認証はSlack OAuth、組織版Webから正本APIへの接続はサービス認証とし、同じtokenを使い回さない。
- SlackのClient Secret、利用者token、サービスtokenはブラウザへ渡さない。組織版Webは検証済みセッションをHttpOnly cookieで保持する。

## リリースと確認

1. Route 53の `bb-app.unson.jp` Aレコードを `176.34.20.239` へ向け、変更が `INSYNC` になるまで待つ。
2. Brainbase正本APIへ `BRAINBASE_AUTH_ALLOWED_ORIGINS=https://bb-app.unson.jp` を反映し、サービス再起動後に設定の存在だけをreadbackする。
3. `brainbase-organization` の対象PRでEVO2 CIが成功したことを確認し、マージSHAを固定する。
4. archiveをreleaseディレクトリへ転送し、`current` を対象SHAへ切り替える。
5. `docker compose --env-file /etc/brainbase-organization/runtime.env -f current/deploy/production/docker-compose.yml up -d --build` で起動する。
6. コンテナのhealthyとイメージSHAを確認する。
7. 公開 `/api/health` の `release_sha` を照合する。
8. 未認証の `/` が `/login` へ遷移し、`/api/tasks` が401になることを確認する。
9. Slackログイン後、正本 `auth_grants` の組織・役割・許可プロジェクトと `/api/tasks` の正本データをreadbackする。
10. ブラウザでタスク表示とフィルター、ソート、グループ操作を確認する。

health、CI、公開URLの生成だけでは完了にしない。正本APIのreadbackとブラウザ操作までを別ゲートとして記録する。

## 切り戻し

直前のreleaseを残し、`current` を直前SHAへ戻して同じcomposeコマンドを再実行する。初回配備で直前releaseがない場合は組織版コンテナだけを停止する。DNS、Brainbase正本API、Canonical Task、既存NocoDBは変更しない。
