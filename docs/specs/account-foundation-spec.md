---
spec_id: SPEC-account-foundation
title: integration_accounts + integration_account_defaults Foundation
status: draft
date: 2026-05-11
story_id: str.brainbase.account-foundation
related_adrs:
  - ADR-008
related_specs:
  - SPEC-settings-phase0-guards
implementation_files:
  - server/sql/integration-accounts-schema.sql
  - server/services/account/account-repository.js
  - server/services/account/account-service.js
  - server/services/account/audit-service.js
  - server/controllers/account-controller.js
  - server/routes/account.js
test_files:
  - tests/account/**/*.test.js
---

# SPEC: Account Foundation

## 目的

Multi-account multi-service の足場。`integration_accounts` schema、credential_ref（Infisical metadata のみ）、`integration_account_defaults`（context default）、AccountController → AccountService → ProviderAdapter / CredentialVault / PolicyService / AuditService 階層を構築。

## Invariants

- **INV-1**: credential secret 値は DB / config.yml / localStorage に書かない（Infisical ref のみ）。
- **INV-2**: `active` を service global 1 個にしない。context default は `integration_account_defaults` の (subject_type, subject_id, service, purpose) で決まる。
- **INV-3**: account 操作 (CONNECTED / REAUTHORIZED / REVOKED / DEFAULT_CHANGED / USED_FOR_POST) は audit_events に必ず記録。
- **INV-4**: account.scope_type と owner/org/project の整合（personal なら owner_person_id 必須、org なら org_id 必須、project なら project_id 必須）。
- **INV-5**: scope_type=personal の account を他人が使用 → server-side で拒否（UI requiredLevel ではなく role_min + ownership）。

## Contracts

### Contract-1: schema

```sql
CREATE TABLE integration_accounts (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('personal','org','project')),
  owner_person_id TEXT,
  org_id TEXT,
  project_id TEXT,
  display_name TEXT NOT NULL,
  external_account_id TEXT,
  external_handle TEXT,
  credential_ref JSONB NOT NULL,  -- {provider, path, version}; NEVER actual secret
  oauth_client_ref JSONB,
  status TEXT NOT NULL CHECK (status IN ('connected','disabled','revoked','reauth_required')),
  capabilities TEXT[] NOT NULL,
  rate_limit_profile_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by_person_id TEXT NOT NULL,
  updated_by_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ
);

CREATE TABLE integration_account_defaults (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  service TEXT NOT NULL,
  purpose TEXT NOT NULL,  -- post|read|notify|sync
  account_id TEXT NOT NULL REFERENCES integration_accounts(id),
  priority INT NOT NULL DEFAULT 100,
  created_by_person_id TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id, service, purpose, account_id)
);

CREATE TABLE account_audit_events (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT REFERENCES integration_accounts(id),
  actor_person_id TEXT NOT NULL,
  action TEXT NOT NULL,  -- CONNECTED|REAUTHORIZED|REVOKED|DEFAULT_CHANGED|USED_FOR_POST
  context JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Contract-2: AccountService API

```ts
class AccountService {
  async create(input: { service, scope_type, ..., created_by_person_id }, credentialRef): Account
  async revoke(id, actor): Account
  async listForActor(actor: JWT): Account[]
  async getDefault(subject: {type, id}, service, purpose): Account | null
  async setDefault(subject, service, purpose, account_id, actor): void
  async canUseForPost(account_id, actor): { allow: boolean, reason: string }
  async listAudit(account_id): Event[]
}
```

### Contract-3: in-memory Repository（テスト）

candidate-store と同じパターン: `InMemoryAccountRepository` + service が DI。

## Scenarios

- **S-1**: connect new X account（scope_type=personal, owner=sato）→ row 作成 + audit CONNECTED
- **S-2**: setDefault(person, sato, x, post, account_id_corp) → 既存 default 上書き
- **S-3**: revoke → status=revoked, audit REVOKED
- **S-4**: canUseForPost(account_id_personal_corp, sato) → allow
- **S-5**: canUseForPost(account_id_personal_corp, umeda) → deny（scope_type=personal, owner mismatch）
- **S-6**: org account に role=member が canUseForPost → deny（role_min=gm required）

## Anti-patterns

- **AP-1**: credential_ref に access_token を直入れ（INV-1 違反）
- **AP-2**: service global active を再導入する（INV-2 違反）
- **AP-3**: audit を omit する API（INV-3 違反）
- **AP-4**: scope_type=personal で owner_person_id null（INV-4 違反）

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1〜5, S-1〜6, AP-1〜4 | tests/account/**/*.test.js | ✅ |

合計 15 test files。

## 受け入れ基準

- [ ] schema SQL 作成
- [ ] AccountService + InMemoryAccountRepository + AuditService
- [ ] 15 test files pass
- [ ] Spec ✅
