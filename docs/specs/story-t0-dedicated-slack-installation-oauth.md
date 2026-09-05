---
story_id: story-t0-dedicated-slack-installation-oauth
spec_status: accepted
---

# TechKnight専用Slack installation OAuth仕様

## 設定解決

1. `BRAINBASE_SLACK_INSTALLATION_CLIENT_ID`と`BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET`が両方ある場合、installation OAuth交換へ専用値を渡す。
2. 両方ない場合、既存の`authService.slackClientId`と`authService.slackClientSecret`を使う。
3. 片方だけの場合は`slack_installation_oauth_configuration_incomplete`でcontrol planeを利用不可にする。
4. token URLは専用値、AuthService値の順で解決し、どちらもなければ利用不可にする。

## 交換契約

専用client ID/secretはSlack token endpointへのform bodyにだけ含める。結果の`api_app_id`は引き続きinstallation intentのApp IDと照合し、client IDをApp IDの代替値にしない。

T0本番検証の`redirect_uri`は操作端末のlocalhost callbackを使う。callbackは短命codeを永続化せず、既存のservice-only交換APIへ一度だけ渡す。公開callback routeやブラウザ内token保存は導入しない。

## コード参照

- `server/bootstrap/slack-installation-control-plane.js`
- `server/services/multitenant/slack-installation-control-plane.js`

## テスト参照

- `tests/server/bootstrap/slack-installation-control-plane.test.js`
- `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js`
