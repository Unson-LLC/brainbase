---
spec_id: SPEC-sns-account-management
title: X Provider Adapter (sns-account-management)
status: implemented
date: 2026-05-15
story_id: str.brainbase.sns-account-management
related_adrs: [ADR-008]
related_specs: [SPEC-account-foundation, SPEC-settings-plugin-contract-v2]
implementation_files:
  - server/services/sns/providers/x-provider.js
  - server/services/sns/providers/x-client.js
  - server/routes/sns-growth.js
  - server/bootstrap/register-api-routes.js
  - public/modules/ui/views/sns-growth-cockpit-view.js
test_files:
  - tests/sns/account-management/**/*.test.js
  - tests/server/routes/sns-growth.test.js
  - tests/ui/views/sns-growth-cockpit-view.test.js
---

# SPEC: X Provider Adapter

## 目的

account-foundation + provider-registry の上に **X (Twitter) 用 ProviderAdapter** を実装。OAuth2 PKCE flow / credential exchange / revoke / health check / rate limit。

2026-05-15 の運用スライスでは、SNS Growth Cockpit から X アカウント状態を確認できる Account Strip と `/api/sns-growth/accounts` 系 API を追加する。DB 直操作で登録した `integration_accounts` を UI で見える状態にし、投稿既定・metrics既定・Health Check を運用者が同じ画面で扱えるようにする。

## Invariants

- INV-1: `credentialKeySpec` に `access_token` / `refresh_token` を含むが、これは provider 側のキー宣言。secret 値自体は Infisical に格納、DB の credential_ref には載らない。
- INV-2: OAuth state は SPEC-settings-plugin-contract-v2 の signOAuthState を経由（actor + return URL + nonce 署名）。
- INV-3: revoke は credential 失効 + account.status='revoked' を両方行う。
- INV-4: healthCheck は X API 呼び出し成否で `{ok: boolean}` 返す。テスト時は client mock。
- INV-5: postTweet は account.status='connected' でないと拒否。
- INV-6: Account Management API/UI は `credential_ref` の provider/path/env key と env presence だけを返し、secret 値を返さない。
- INV-7: SNS Growth Cockpit は X アカウント未接続・connected・health ok/ng・posting default・metrics default を同じ運用面に表示する。

## Contracts

```ts
function buildXProvider(deps: { xClient: XClient }): ProviderDefinition
```

X provider definition の shape は SPEC-settings-plugin-contract-v2 Contract-1 通り。capabilities: ['post', 'read']。

```ts
interface XClient {
  startOAuth(ctx): Promise<{url: string, state: string}>
  exchangeCallback(params): Promise<{external_account_id: string, external_handle: string, credential_metadata: {provider, path, version}}>
  refresh(credential_ref): Promise<{credential_metadata: any}>
  revoke(credential_ref): Promise<void>
  healthCheck(credential_ref): Promise<{ok: boolean, reason?: string}>
  getRateLimitStatus(credential_ref): Promise<{remaining: number, resetAt: string}>
  postTweet(credential_ref, payload): Promise<{tweet_id: string}>
  fetchTweetMetrics(credential_ref, tweet_id): Promise<{impressions: number, likes: number, replies: number, retweets: number}>
}
```

テスト用 `InMemoryXClient` を提供（mock）。

```http
GET /api/sns-growth/accounts
POST /api/sns-growth/accounts/:id/default
POST /api/sns-growth/accounts/:id/health-check
```

Account Management API は `AccountService` を通じて visible account のみ返す。`default` は `person:sato_keigo / x / sns_posting|sns_metrics` の現在値を返す。`health-check` は provider の `healthCheck` と `getRateLimitStatus` を呼ぶが、credential secret はレスポンスに含めない。

## Scenarios

- S-1: OAuth start で URL + state を返す
- S-2: callback で credential_ref + external_account_id を返す
- S-3: healthCheck ok=true で connected
- S-4: revoke で client revoke + account 無効化
- S-5: SNS Growth Cockpit で X account の connected/default/credential readiness が見える
- S-6: Health Check を押すと provider health/rate limit が同じ画面に戻る

## Anti-patterns

- AP-1: provider 外で X API を直接呼ぶ
- AP-2: credential_ref に access_token 直貼り

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜5, S-1〜4, AP-1〜2 | tests/sns/account-management/**/*.test.js | ✅ |
| INV-6〜7, S-5〜6 | tests/server/routes/sns-growth.test.js, tests/ui/views/sns-growth-cockpit-view.test.js | ✅ |

合計 13 test files。
