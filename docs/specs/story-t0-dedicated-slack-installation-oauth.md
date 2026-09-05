---
story_id: story-t0-dedicated-slack-installation-oauth
spec_status: accepted
---

# TechKnight専用Slack installation OAuth仕様

## 設定解決

1. `APP_ID`、`CLIENT_ID`、`CLIENT_SECRET`、`REDIRECT_URI`、`STATE_SECRET`、`BOT_SCOPES`、`TOKEN_URL`がすべてある場合、専用のinstallation OAuthを有効にする。
2. 専用設定がすべてない場合だけ、既存の`authService.slackClientId`と`authService.slackClientSecret`を使う。
3. 専用設定が一つでも存在し、必須設定が欠ける場合は`slack_installation_oauth_configuration_incomplete`でcontrol planeを利用不可にする。
4. 専用経路のtoken URLは専用値だけを使う。`TOKEN_URL`だけを含む部分設定も利用不可にし、AuthService資格情報と混在させない。

## 交換契約

専用client ID/secretはSlack token endpointへのform bodyにだけ含める。専用経路では結果の`api_app_id`または`app_id`を必須とし、installation intentのApp IDと照合する。client IDや設定済みApp IDでprovider応答を補完しない。

Slackが更新トークンを返さない場合、credential storeは`refresh_revision=0`を返す。`credential_broker_refs`はこの値を有効な初期状態として保存する。更新用資格情報がある場合と更新後の版数は正の整数を使い、負数は常に拒否する。

管理者認証済みauthorize routeは永続化済みintentをHMAC署名した10分以内のstateへ束縛し、固定HTTPS callbackを含むSlack authorization URLを返す。公開callback routeは署名、期限、固定redirect URI、canonical intentを検証し、control planeへcodeを一度だけ渡す。ブラウザにはservice token、OAuth secret、access tokenを保存・返却しない。重複callbackは交換台帳の同じ結果を読むため、credential登録効果は一度だけになる。

## コード参照

- `server/bootstrap/slack-installation-control-plane.js`
- `server/services/multitenant/slack-installation-control-plane.js`
- `server/services/multitenant/slack-installation-oauth-flow.js`
- `server/sql/multitenant-platform-schema.sql`

## テスト参照

- `tests/server/bootstrap/slack-installation-control-plane.test.js`
- `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js`
- `tests/server/services/multitenant/slack-installation-oauth-flow.test.js`
- `tests/server/services/multitenant/persistence-schema.test.js`
