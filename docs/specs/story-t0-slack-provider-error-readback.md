---
story_id: story-t0-slack-provider-error-readback
spec_status: accepted
---

# Slack OAuth provider失敗コード読戻し仕様

## 固定コード

Slackの既知エラーだけを次の内部コードへ変換する。

- `invalid_code` → `OAUTH_EXCHANGE_INVALID_CODE`
- `bad_redirect_uri` → `OAUTH_EXCHANGE_REDIRECT_MISMATCH`
- `bad_client_secret | invalid_client_id` → `OAUTH_EXCHANGE_CLIENT_CREDENTIAL_REJECTED`
- `oauth_authorization_url_mismatch` → `OAUTH_EXCHANGE_FLOW_MISMATCH`
- `invalid_code_verifier | pkce_not_allowed` → `OAUTH_EXCHANGE_PKCE_REJECTED`
- `access_denied | no_scopes | team_access_not_granted` → `OAUTH_EXCHANGE_ACCESS_DENIED`
- `internal_error | fatal_error | service_unavailable | request_timeout | ratelimited` → `OAUTH_EXCHANGE_UNAVAILABLE`

未知、空、文字列以外のprovider errorは`OAUTH_EXCHANGE_REJECTED`へ閉じる。

## 保存と公開の境界

固定コードだけを既存の`oauth_exchange`診断allowlistへ追加する。provider response body、元のprovider error、authorization code、token、例外messageやstackは台帳へ保存しない。

公開routeは追加した内部コードも`503 / UPSTREAM_UNAVAILABLE`へ変換し、内部診断を公開しない。

## 検証

adapter単体テストで既知値の分類と未知値のfail closedを確認する。control-plane単体テストで固定コードが診断書込みへ渡ることを確認し、routeテストで公開応答が変わらないことを確認する。productionは新しいintentのreadbackを別途必要とする。
