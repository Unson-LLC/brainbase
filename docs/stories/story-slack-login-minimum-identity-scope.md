---
story_id: story-slack-login-minimum-identity-scope
title: Slack管理画面ログインを本人確認専用の最小権限にする
status: active
source_requirement:
  type: user_report
  detail: 管理画面ログインがSlackの投稿・ファイル権限を要求しているため、本人確認だけに縮小して本番へ配備する。
architecture_docs: []
---

## Story

Brainbaseの管理画面へ入る利用者として、Slackログインでは本人確認に必要な権限だけを許可したい。ログインのためにメッセージ投稿やファイル操作を許可したくないからだ。

## Scope

- 管理画面ログインの既定経路をSlack OpenID Connectへ切り替える。
- ログイン用`scope`を`openid profile email`だけに固定し、legacy `user_scope`は使わない。
- legacy OAuthの既存許可は加算式で縮小できないため、ログインを独立したOIDC経路へ分離する。
- legacy OAuth fallbackは、`identity.basic`以外の実効権限を検出したら引き続きfail closedとする。
- Slack通知、ファイル連携、workspace installation OAuthは別の資格情報・経路として変更しない。

## Acceptance Criteria

- [x] OIDCログインURLの`scope`は`openid profile email`だけで、`user_scope`を含まない。
- [x] `chat:write`、`files:write`、欠落・追加scopeをOIDCログイン設定として受け付けない。
- [x] legacy OAuth fallbackではtoken exchangeの実効権限も`identity.basic`だけとし、bot権限・欠落・追加権限を受け付けない。
- [x] セットアップと環境変数例が同じOIDC最小権限を生成する。
- [x] Slack user IDとworkspace IDによる既存の`auth_grants`照合は変わらない。

## Verification

- `tests/unit/slack-auth-provider.test.js`
- `tests/unit/slack-login-configuration.test.js`
- 本番の`/api/auth/slack/start?json=true`から返る認可URLのquery readback
- 実ブラウザでSlack同意画面とログイン後の管理画面/API readback
