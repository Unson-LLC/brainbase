---
spec_id: SPEC-settings-plugin-contract-v2
title: Settings Provider Plugin Contract v2
status: draft
date: 2026-05-11
story_id: str.brainbase.settings-plugin-contract-v2
related_adrs:
  - ADR-008
related_specs:
  - SPEC-account-foundation
implementation_files:
  - public/modules/settings/provider-registry.js
  - server/services/account/provider-registry.js
test_files:
  - tests/settings/provider-contract/**/*.test.js
---

# SPEC: Settings Provider Plugin Contract v2

## 目的

既存 `settings-plugin-api.js` を UI registry として温存しつつ、外部 service の **provider manifest** を別建てに。X / Slack / Google などの service adapter を統一 interface で扱う。

## Invariants

- **INV-1**: ProviderDefinition は service / authMethods / capabilities / publicMetadataSchema / credentialKeySpec / startOAuth / handleCallback / refreshCredential / revokeCredential / healthCheck / getRateLimitStatus を持つ。
- **INV-2**: ProviderRegistry は service code で provider を解決（重複登録は最後勝ち、warning）。
- **INV-3**: provider が要求する credentialKeySpec のキー以外は credential store に書かない。
- **INV-4**: OAuth state は actor / scope / org / project / return URL / nonce を含み、署名 + one-time（Codex 警告 #4）。

## Contracts

### Contract-1: ProviderDefinition shape

```ts
interface ProviderDefinition {
  service: string;                         // 'x' | 'slack' | 'google' | 'github' | 'nocodb'
  authMethods: Array<'oauth2_pkce' | 'oauth2_confidential' | 'api_key'>;
  capabilities: Array<string>;             // 'post' | 'read' | 'sync' | 'notify'
  publicMetadataSchema: Record<string, 'string'|'number'|'boolean'>;
  credentialKeySpec: Array<string>;        // 例: ['access_token', 'refresh_token']
  startOAuth?(ctx: OAuthContext): Promise<{url: string, state: string}>;
  handleCallback?(params: any): Promise<{credentialRef: any, externalAccountId: string}>;
  refreshCredential?(credentialRef: any): Promise<any>;
  revokeCredential?(credentialRef: any): Promise<void>;
  healthCheck?(credentialRef: any): Promise<{ok: boolean, reason?: string}>;
  getRateLimitStatus?(credentialRef: any): Promise<{remaining: number, resetAt: string}>;
}
```

### Contract-2: ProviderRegistry

```ts
class ProviderRegistry {
  register(provider: ProviderDefinition): void
  get(service: string): ProviderDefinition | null
  list(): ProviderDefinition[]
}
```

### Contract-3: OAuth state signing

```ts
function signOAuthState(payload: {actor_person_id, scope, org_id?, project_id?, return_url, nonce}, secret: string): string
function verifyOAuthState(token: string, secret: string): {valid: boolean, payload?: any, reason?: string}
```

one-time enforcement: nonce を redis-equivalent or in-memory で使い切り管理（テストは in-memory）。

## Scenarios

- **S-1**: register(xProvider) → get('x') 解決
- **S-2**: 重複 register → 後勝ち + warning ログ
- **S-3**: signOAuthState → verifyOAuthState で復号、tampered token は invalid
- **S-4**: nonce 二回目使用は invalid（one-time）

## Anti-patterns

- **AP-1**: credentialKeySpec 外のキーを credential ref に書く（INV-3）
- **AP-2**: OAuth state を unsigned で渡す（INV-4）
- **AP-3**: provider を bypass して service code から直接 OAuth flow を呼ぶ

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜4, S-1〜4, AP-1〜3 | tests/settings/provider-contract/**/*.test.js | ✅ |

合計 11 test files。

## 受け入れ基準

- [ ] ProviderRegistry + ProviderDefinition contract
- [ ] OAuth state sign / verify（one-time）
- [ ] 11 test files pass
- [ ] Spec ✅
