---
spec_id: SPEC-brainbase-multitenant-platform
title: Brainbase Cloud／OSS共通マルチテナント契約
status: final
date: 2026-08-16
story_id: story-brainbase-multitenant-platform
related_adrs:
  - docs/architecture/story-brainbase-multitenant-platform.md
implementation_files:
  - server/services/multitenant/
  - server/routes/tenant-runtime.js
  - server/bootstrap/register-api-routes.js
  - packages/cloudflare-tenant-runtime-bridge/
  - scripts/run-sns-scheduled-posts.js
  - scripts/import-sns-review-pack-to-ledger.js
  - server/services/sns/posting-ledger-repository.js
  - server/services/sns/sns-scheduled-publisher.js
  - migrations/
test_files:
  - tests/server/services/multitenant/tenant-authority.test.js
  - tests/server/services/multitenant/tenant-authorization-boundary.test.js
  - tests/server/services/multitenant/workspace-connection.test.js
  - tests/server/services/multitenant/credential-broker.test.js
  - tests/server/services/multitenant/contract-usage-ledger.test.js
  - tests/server/services/multitenant/protocol-contract.test.js
  - tests/server/services/multitenant/migration-planner.test.js
  - tests/server/routes/tenant-runtime-contract.test.js
  - tests/server/bootstrap/tenant-entrypoint-fail-closed.test.js
  - tests/server/cloudflare/tenant-runtime-bridge.test.js
  - tests/sns/ops/run-sns-scheduled-posts.test.js
  - tests/sns/ops/import-sns-review-pack-to-ledger.test.js
  - tests/sns/posting-ledger/posting-ledger-repository.test.js
  - tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js
  - tests/e2e/str-brainbase-sns-scheduled-publisher-jst.spec.ts
  - tests/conformance/mana-brainbase-tenant-context.adapter.test.js
---

# Brainbase Cloud／OSS共通マルチテナント契約

## 0. 状態と境界

このSpecは実装着手用のfinalである。先行してVibePro draftを生成・検証した後、Storyとaccepted Architectureを具体化し、横断契約の正本入力としてmana-runtime PR #292の統合実装 `1b015def50a1ee21b616c87b717e821655bf2a48`のD-001〜D-009と`contracts/mana-brainbase-tenant-context/v1`を採用した。共通fixture setのSHA-256は`9f544ab944407db760e4dec79c455bea2fdc9076766ecfd4c7058417cfe7c833`である。実装開始ゲートはSpecのfingerprintとdriftを記録した時点で開くが、adapter fixture、CI、本番readbackの成功を意味しない。

Brainbaseのconformance testは共通manifestの1 positive、21 negative、1 non-applicableを固定HEADから直接読む。fixtureの複製や期待値の再定義はconformance証拠として扱わない。test keyはテスト実行時だけ読み、repository、ログ、PR本文へ秘密値を記録しない。

- Brainbaseが所有する: tenant正本、帰属、connection、credential参照、contract、quota、usage、Receipt、Cloud／OSS接続契約。
- mana-runtimeが所有する: Slack受信、Queue／Durable Object／Container内のtenant context伝播、返信。
- このSpecが初めて具体化する: API、object、event、state、schema、error code、fixture。
- このSpecが記録しない: token、secret、OAuth credential本文、顧客固有価格。

## 1. Invariants

- **INV-001 Canonical tenant**: `tenant_id`はTenant Authorityだけが発行・状態変更する。workspace ID、project code、organization名、deployment名から生成・推定しない。
- **INV-002 Explicit ownership**: organization、membership、project、Graph data、workspace connection、contract、usage event、Receiptは必ず1つの`tenant_id`へ帰属する。未帰属は業務経路から隔離する。
- **INV-003 Resolve before work**: actorの認証後かつ最初の業務処理前にtenantを一意解決し、actor、resource、connection、deployment、contract revisionを照合する。
- **INV-004 Fail closed**: 未解決、複数解決、失効、改ざん、scope不足、revision不一致、正本到達不能はdefault tenantや別resourceへfallbackせず拒否する。
- **INV-005 Non-disclosure**: 別tenant resourceへのアクセスは存在有無を漏らさず`scope_mismatch`として同じ外形で拒否する。
- **INV-006 Opaque credential**: Brainbaseの通常DB、Graph、ログ、event、Receiptはcredential本文を保持しない。Secret Storeのtenant限定opaque handleだけを保持する。
- **INV-007 Collection and outcome**: `collection_state=collected|partial|not_collected`と`outcome=succeeded|failed|cancelled|timed_out`を独立に保持し、未計測・取得不能・部分取得を0件、0円、成功へ変換しない。取得済み空結果だけは`collected`、`observed_units=0`、`failure_code=NO_DATA`とする。
- **INV-008 Immutable accounting**: canonical OperationReceipt wireは共通Schemaのまま確定後immutableとし、Brainbase価格台帳は同じ`receipt_id`へ当時のcontract、rate、FX、sales price revisionを別snapshotとして同一transactionで保持する。
- **INV-009 Deployment isolation**: tenant、deployment、connection、credentialのいずれかが一致しない場合、別の組み合わせへfallbackしない。
- **INV-010 Uniform boundary**: 管理API、MCP、background job、migration、監査ログで同じtenant解決・照合規則を使う。tenant runtime無効・未設定時も管理／監査を`next()`で通過させず503で拒否する。SNSを含む運用APIは認証とtenant guardを必須にし、対話APIから公開副作用を実行しない。公開副作用を行うjobはgatewayと永続tenant bindingを必須とし、claim／provider呼出しより前に`entry_point=background_job`で認可する。claimはPostgreSQL上で競合安全に行い、production接続先がない場合はローカルfileへfallbackしない。

## 2. 識別子と共通型

新規の共有IDは小文字prefixと26文字の大文字Crockford ULIDで発行する。provider IDと既存Brainbase entity IDはcanonical opaque stringとしてbyte-for-byte保持し、形式を推定・変換・再発行しない。

| 型 | draft形式 | 意味 |
|---|---|---|
| `tenant_id` | `ten_<ULID>` | Tenant Authorityが発行するcanonical ID |
| `tenant_revision` | canonical decimal string | `^(0|[1-9][0-9]*)$`。tenant状態・境界変更ごとに数値として単調増加 |
| `connection_id` | `wsc_<ULID>` | workspace installationの論理接続 |
| `connection_revision` | canonical decimal string | `^(0|[1-9][0-9]*)$`。reinstall、scope、credential、status変更ごとに数値として増加 |
| `contract_id` | `ctr_<ULID>` | tenant契約系列 |
| `contract_revision` | canonical decimal string | `^(0|[1-9][0-9]*)$`。適用条件のimmutable revision |
| `usage_event_id` | `usage_<ULID>` | 冪等な実消費event |
| `receipt_id` | `receipt_<ULID>` | 相関ID単位の利用証跡 |
| `correlation_id` | `cor_<ULID>` | runtimeをまたぐ実行相関 |
| `operation_id` | `op_<ULID>` | 論理的な副作用1件 |
| `idempotency_key` | `ik1_<base64url SHA-256>` | 固定導出式で生成する副作用claim key |
| `deployment_id` | `dep_<ULID>` | Cloud／OSSの接続先instance |
| `credential_ref` | provider opaque string | Brainbase credential broker内の参照。本文ではない |

時刻はUTCのRFC 3339、通貨はISO 4217、金額はminor unitの整数、比率はbasis point、数量は整数またはdecimal stringで表す。JavaScriptの浮動小数金額を永続化しない。

## 3. Object／state契約

### Contract-01: Tenant

```json
{
  "tenant_id": "ten_<ULID>",
  "tenant_revision": "1",
  "status": "provisioning|active|suspended|deletion_pending|deleted",
  "display_name": "表示用。識別には使わない",
  "created_at": "RFC3339",
  "updated_at": "RFC3339",
  "suspension_reason_code": null,
  "deletion_after": null
}
```

状態遷移は`provisioning -> active -> suspended -> active`、`active|suspended -> deletion_pending -> deleted`だけを許す。`deleted`は終端状態で、IDを再利用しない。`suspended`以降は読取を含む許可をcapability単位で明示し、既定は業務処理拒否とする。削除は法令・監査保持期間を満たす非同期処理とし、帰属行を別tenantへ付け替えない。

### Contract-02: Tenant ownership

帰属対象は共通列`tenant_id NOT NULL`と`tenant_revision_at_write NOT NULL`を持つ。少なくとも次を対象とする。

| object | 追加する境界 | 補足 |
|---|---|---|
| organization | `tenant_id` | 1 tenantに複数organization可 |
| membership | `tenant_id`, `organization_id`, `principal_id` | 3者を同一tenantで照合 |
| project | `tenant_id` | project codeはtenant内表示キー |
| Graph entity／relation | `tenant_id` | public visibilityでも所有tenantを省略しない |
| workspace connection | `tenant_id` | 外部workspaceとの正本関係 |
| contract／quota decision | `tenant_id` | decisionはcontract revision固定 |
| usage event／Receipt | `tenant_id` | correlationとsource revisionを固定 |

DBの外部キーまたはrepository guardで親子の`tenant_id`一致を保証する。共有CloudではRLS相当のDB境界とrepository境界を併用し、専用Cloud／OSSでもrepository guardを省略しない。

### Contract-03: WorkspaceConnection

```json
{
  "connection_id": "wsc_<ULID>",
  "connection_revision": "3",
  "tenant_id": "ten_<ULID>",
  "provider": "slack",
  "installation_id": "provider opaque id",
  "workspace_id": "provider opaque id",
  "app_id": "provider opaque id",
  "granted_scopes": ["scope:name"],
  "status": "pending|active|revoked",
  "credential_ref": "opaque credential-broker reference",
  "installed_at": "RFC3339",
  "revoked_at": null,
  "supersedes_connection_revision": "2"
}
```

同じtenantは複数workspaceを持てる。同じprovider／workspace／appの再installは`connection_id`を維持してrevisionを増やす。異なるappへのinstallは別connectionとする。過去revisionは監査用に保持するが認可には使わない。`credential_ref`は`tenant_id`、`connection_id`、`connection_revision`、`operation_id`、`audience`、`credential_mode`へ束縛する。projection cacheは最大30秒とし、credential lease、Brainbase write、Slack deliveryの直前には`expected_connection_revision`を指定した正本readを必須にする。revision eventは単調増加するcache invalidation hintであり、不可逆な副作用を単独では許可しない。

### Contract-04: ServicePrincipalとTenantContextEnvelope

service tokenはcredentialとは別の短命な認証手段である。production内部runtimeは`bbsvc_` JWTの署名とdeployment-local tokenの一致を確認したうえで、`issuer`、非空の`subject`、対象を含む`audience`、一致する`deployment_id`、未来の`expires_at`、必要`capabilities`をすべて検証する。期限切れ、audience／deployment不一致、capability不足は`401 SERVICE_AUTH_INVALID`で拒否する。token payloadだけでtenantを決定しない。

```json
{
  "schema_version": "1.0",
  "protocol_id": "mana-brainbase-tenant-context",
  "protocol_version": "1.0",
  "issuer": "brainbase",
  "audience": ["mana-runtime", "brainbase-api"],
  "tenant": {
    "tenant_id": "ten_<ULID>",
    "tenant_revision": "7"
  },
  "workspace_connection": {
    "connection_id": "wsc_<ULID>",
    "connection_revision": "3",
    "status": "active",
    "provider": "slack",
    "installation_id": "provider opaque id",
    "workspace_id": "provider opaque id",
    "app_id": "provider opaque id"
  },
  "actor": {
    "principal_id": "Brainbase canonical opaque id",
    "principal_type": "person|service",
    "authenticated_subject_id": "authenticated opaque subject"
  },
  "authorization": {
    "organization_ids": ["organization opaque id"],
    "project_ids": ["project opaque id"],
    "data_scopes": ["graph:read"],
    "capability_ids": ["receipt:write"]
  },
  "placement": {
    "deployment_id": "dep_<ULID>",
    "profile": "shared_cloud|dedicated_cloud|customer_managed_oss"
  },
  "slack": {
    "event_id": "provider opaque id",
    "channel_id": "provider opaque id",
    "thread_ts": "provider opaque id",
    "requester_id": "provider opaque id"
  },
  "correlation_id": "cor_<ULID>",
  "operation_id": "op_<ULID>",
  "idempotency_key": "ik1_<base64url SHA-256>",
  "contract_revision": "11",
  "credential": {
    "mode": "cloud_standard|customer_oauth|customer_api",
    "credential_ref": "opaque tenant-bound reference",
    "billing_principal_id": "Brainbase canonical opaque id"
  },
  "issued_at": "RFC3339",
  "expires_at": "RFC3339",
  "integrity": {
    "method": "jws_detached",
    "algorithm": "EdDSA",
    "key_id": "published public key id",
    "value": "RFC 7515 detached compact JWS"
  }
}
```

Envelopeはsnake_caseのimmutable objectとし、`integrity`を除外したRFC 8785 canonical JSONをEdDSA／Ed25519 detached JWSで署名する。protected headerは`alg=EdDSA`、`b64=false`、`crit=["b64"]`、`kid=integrity.key_id`、`typ=application/mana-brainbase-tenant-context+jws`の5 fieldだけをRFC 8785でcanonicalizeする。署名入力は`ASCII(protected64 + ".") || UTF-8(JCS(unsigned envelope))`で、compact JWSのpayload segmentは空とし、payloadをbase64url化しない。`expires_at`は必ず`issued_at`より後、TTLは最大300秒、clock skewは最大30秒である。延長・mutationは禁止し、新しい解決と署名で置換する。各境界で署名、公開鍵status、issuer、audience、期限、deployment、tenant／connection revisionを再検証する。秘密値はEnvelopeへ入れない。

Brainbaseは`GET /api/v1/runtime/verification-keys`でcurrentとretiringのEd25519公開鍵だけを公開する。各keyは`key_id`、`algorithm=EdDSA`、`public_key_format=jwk`、`public_key={kty:OKP,crv:Ed25519,x}`、`status=current|retiring`、有効期間を持つ。retiring keyは、そのkeyで署名した全Envelopeが期限切れになるまで公開し、private keyやsecretを返さない。

### Contract-04a: Credential broker

Brainbaseだけがcredential本文とOAuth refresh stateを所有する。外部runtimeはopaque `credential_ref`だけを保持し、`credential_lease_request`で`tenant_id + connection_id + connection_revision + contract_revision + operation_id + audience + credential_mode + credential_ref`をbindingとして送る。Brainbaseは`credential_lease_response`でopaqueな`lease_id`と`lease_token`、同一binding、canonical string `contract_revision`、`max_uses=1`、`issued_at`、`expires_at`を返す。lease TTLは要求値以下かつ最大60秒で、再利用、binding違い、revision違い、mode fallbackを拒否する。providerがcredential本文を要求する場合も、trusted injectorの揮発メモリにだけmaterializeし、Queue、Durable Object、model/tool payload、disk、log、fixture、Receiptへ記録しない。

OAuth refreshは`credential_ref`と`expected_refresh_revision`によるcompare-and-swapを必須とする。成功時だけrevisionを単調増加させ、競合は`OAUTH_REFRESH_CONFLICT`で拒否し、secretを含まない監査eventを残す。

### Contract-05: ContractRevision／QuotaDecision

```json
{
  "contract_id": "ctr_<ULID>",
  "contract_revision": "4",
  "tenant_id": "ten_<ULID>",
  "status": "draft|active|expired|superseded",
  "effective_from": "RFC3339",
  "effective_until": null,
  "plan_code": "opaque plan code",
  "allowances": {
    "ai_minor_units": "decimal string",
    "tool_calls": 10000,
    "container_milliseconds": 3600000,
    "support_minutes": 120
  },
  "thresholds_basis_points": [5000, 8000, 10000],
  "overage_policy": "deny|allow_and_bill|allow_with_approval",
  "hard_stop_basis_points": 10000,
  "rate_card_revision": 8,
  "fx_table_revision": 5
}
```

QuotaDecisionは`allowed|warning|hard_stopped|approval_required|unavailable`のいずれかで、tenant、contract revision、metric、observed quantity、threshold、reason、decided_atを含む。Contract Authorityへ到達不能な場合は`allowed`へ丸めない。

### Contract-06: UsageEvent

```json
{
  "usage_event_id": "usage_<ULID>",
  "protocol_version": "1.0",
  "tenant_id": "ten_<ULID>",
  "connection_id": "wsc_<ULID>",
  "connection_revision": "7",
  "contract_revision": "11",
  "deployment_id": "dep_<ULID>",
  "correlation_id": "cor_<ULID>",
  "operation_id": "op_<ULID>",
  "idempotency_key": "ik1_<base64url SHA-256>",
  "kind": "ai|tool|container|storage|retry|external_api",
  "quantity": "decimal string or null",
  "unit": "token|call|millisecond|byte|request",
  "outcome": "succeeded|failed|cancelled|timed_out",
  "collection_state": "collected|partial|not_collected",
  "failure_code": "NO_DATA|UPSTREAM_UNAVAILABLE|PARTIAL_RESULT|TIMEOUT|null",
  "observed_at": "RFC3339"
}
```

`collected`だけが完全な数量確定を許す。`partial`は既知部分のquantityとunknown fieldsを分離し、`not_collected`のquantityは`null`とする。失敗実行も観測済み消費を残す。timeout／unavailableはfailure observationでありoutcomeではない。取得済み空結果は`outcome=succeeded`、`collection_state=collected`、`quantity=0`、`failure_code=NO_DATA`とする。

### Contract-07: OperationReceipt

```json
{
  "receipt_id": "receipt_<ULID>",
  "protocol_version": "1.0",
  "tenant_id": "ten_<ULID>",
  "connection_id": "wsc_<ULID>",
  "connection_revision": "7",
  "contract_revision": "11",
  "deployment_id": "dep_<ULID>",
  "correlation_id": "cor_<ULID>",
  "operation_ids": ["op_<ULID>"],
  "idempotency_keys": ["ik1_<base64url SHA-256>"],
  "actor_principal_id": "Brainbase canonical opaque id",
  "project_id": "Brainbase canonical opaque id",
  "capability_id": "task.write",
  "quota_decision": "allowed|warning|hard_stopped|approval_required|unavailable",
  "credential_mode": "cloud_standard|customer_oauth|customer_api",
  "collection_state": "collected|partial|not_collected",
  "outcome": "succeeded|failed|cancelled|timed_out",
  "failure_code": null,
  "usage_event_ids": ["usage_<ULID>"],
  "reply": {
    "state": "not_requested|pending|succeeded|failed",
    "reply_count": 0,
    "legacy_reply_count": 0
  },
  "completed_at": "RFC3339"
}
```

canonical OperationReceiptはmana-runtime PR #292のSchemaと同値で、`pricing_snapshot`を含む追加propertyを拒否する。`partial|not_collected`では未知の金額を`0`にせず、既知部分と未知部分は紐づくUsageEventで保持する。Receiptはfinalize後immutableで、訂正Receiptだけが既存Receiptを参照できる。terminal claimとReceiptは最低30日保持する。

#### Brainbase価格台帳extension

価格情報はcanonical wireへ混ぜず、同じ`receipt_id`を主キーにBrainbase所有の別tableへ保存する。Receipt確定と価格snapshot保存は同一transactionで行い、tenant限定history APIだけが読み出せる。

```json
{
  "receipt_id": "receipt_<ULID>",
  "tenant_id": "ten_<ULID>",
  "contract_revision": "11",
  "rate_card_revision": "8",
  "fx_table_revision": "5",
  "sales_price_revision": "3",
  "purchase_currency": "USD",
  "purchase_minor_units": 123,
  "billing_currency": "JPY",
  "billing_minor_units": 190,
  "fx_rate_decimal": "150.1234",
  "effective_at": "RFC3339"
}
```

3つの価格revisionは確定時にContract Authorityのauthoritative revisionと一致しなければ拒否する。canonical Receiptと価格snapshotは追記訂正以外で更新しない。共通契約へこのextensionを追加する必要はなく、外部runtimeへ送るOperationReceiptは常にcanonical Schemaだけに従う。

### Contract-08: Business-effect idempotency ledger

`LP(v) = uint32be(UTF-8 byte length of v) || UTF-8(v)`とし、次の式だけをcanonical key生成に使う。

`ik1_ + base64url_without_padding(SHA-256(LP(protocol_id) || LP(protocol_major) || LP(tenant_id) || LP(connection_id) || LP(slack_event_id) || LP(operation_id)))`

同じaccepted Slack eventは同じ`correlation_id`を維持し、論理的な副作用ごとに安定した`operation_id`を持つ。Brainbase writeとSlack deliveryは別operation ID／別claimとする。claimは`pending|claimed|succeeded|failed_terminal`で、同一key・同一payload/context hashはreplay-safe、claim後のpayload hashまたはcontext hash不一致は`IDEMPOTENCY_CONFLICT`で追加副作用0件のまま拒否する。

## 4. API契約

すべてのAPIは`application/problem+json`の共通ErrorEnvelopeを返す。外部runtime APIは`Authorization`、`Brainbase-Protocol-Version`、`Brainbase-Deployment-Id`を必須にする。tenant ID単体のheaderは解決根拠にしない。

### 管理API

| method／path | 入力 | 成功 | 主な拒否 |
|---|---|---|---|
| `POST /api/v1/tenants` | display name、owner principal | `201 Tenant` | invalid principal、duplicate idempotency |
| `PATCH /api/v1/tenants/{tenant_id}` | expected revision、状態変更 | `200 Tenant` | revision mismatch、invalid transition |
| `POST /api/v1/tenants/{tenant_id}/workspace-connections` | provider installation metadata、credential ref | `201 WorkspaceConnection` | wrong tenant／app、secret-like payload |
| `POST /api/v1/tenants/{tenant_id}/workspace-connections/{connection_id}:revoke` | expected revision、reason | `200 WorkspaceConnection` | stale revision、wrong tenant |
| `PUT /api/v1/tenants/{tenant_id}/contracts/{contract_id}/revisions/{revision}` | immutable contract revision | `201 ContractRevision` | overlapping active period、invalid threshold |
| `GET /api/v1/tenants/{tenant_id}/receipts/{receipt_id}` | tenant-scoped id | `200 OperationReceipt` | cross-tenant resource is non-disclosing denial |

### SNS運用API境界

`/api/sns-growth`配下は`Authorization`と`Brainbase-Tenant-Context`、`Brainbase-Resource-Ref`を必須とし、`entry_point=admin_api`でtenant境界を照合する。`POST /api/sns-growth/posts/{post_id}/publish`は`{ "dry_run": true }`だけを受理し、Ledger mutationとprovider呼出しを行わない。`confirm_public_post=true`を含む非dry-run要求はHTTP 409、`code=sns_direct_public_publish_disabled`で拒否する。

productionのreview pack投入CLIは`BRAINBASE_SNS_SERVICE_TOKEN`に保持した`bbsvc_` service tokenを`Authorization: Bearer <token>`として使い、最初に`BRAINBASE_TENANT_RUNTIME_URL`（または`BRAINBASE_TENANT_RUNTIME_HOST`＋`BRAINBASE_TENANT_RUNTIME_PORT`）の`POST /api/v1/runtime/tenant-context:resolve`を呼ぶ。resolve requestは`BRAINBASE_SNS_TENANT_ID`／`BRAINBASE_SNS_TENANT_REVISION`、`BRAINBASE_SNS_CONNECTION_ID`／`BRAINBASE_SNS_CONNECTION_REVISION`、`BRAINBASE_SNS_SERVICE_PRINCIPAL_ID`、`BRAINBASE_SNS_CHANNEL_ID`と、実行ごとの`cor_`／`op_` IDを含む。`principal_type=service`、capability=`sns.review_pack.import`、data scope=`sns.review_pack`を固定し、project resourceの場合はresource IDを`authorization.project_ids`へ入れる。Tenant Authorityは正本DBのactive tenant、authoritative connection revision、granted capability、active contract revisionを照合し、最大300秒のEd25519署名済みTenantContextEnvelopeを返す。

CLIは署名秘密鍵を保持せず、返された完全なEnvelopeとcanonical resource refをそれぞれbase64url（paddingなし）の`Brainbase-Tenant-Context`／`Brainbase-Resource-Ref`へ設定して`POST /api/sns-growth/review-pack`を呼ぶ。tenant ID／revisionだけの部分objectはcanonical headerではなく、production verifierが`SCHEMA_INVALID`で拒否する。service token、runtime URL、selector／bindingが欠落・不正、またはresolveが失敗した場合はLedger APIを呼ばず非zeroで停止する。token値はpayload、標準出力、標準エラー、fixtureへ記録しない。

実公開の唯一のproduction entrypointは`scripts/run-sns-scheduled-posts.js`から`SnsScheduledPublisher.run`への経路である。各rowの永続tenant bindingを`entry_point=background_job`で認可し、`PgSnsPostingLedgerRepository.claimScheduledPost`でclaimを取得してからproviderを呼ぶ。claim競合は`claim_lost`としてskipし、providerを呼ばない。

SNS Ledger接続先は`SNS_POSTING_LEDGER_DATABASE_URL`を優先し、次に`INFO_SSOT_DATABASE_URL`／`INFO_SSOT_DB_URL`を使う。productionで全て未設定ならSNS Ledger操作はHTTP 503、`code=sns_posting_ledger_database_required`で拒否し、`var/sns-posting-ledger.json`を作らない。JSON repositoryは`BRAINBASE_TEST_MODE=true`かつ`SNS_POSTING_LEDGER_MODE=json_test`の明示的な組合せだけで使用できる。

### 外部runtime API

Cloudflare上のmana-runtimeは、公開URLではなく`BRAINBASE_TENANT_RUNTIME_SERVICE` Service BindingからBrainbase所有の`brainbase-tenant-runtime` private bridgeを呼ぶ。bridgeは`workers_dev=false`かつpreview URLなしで配備し、`POST /api/v1/runtime/provider-requests:forward`だけをAccess保護済みHTTPS Tunnel originへ中継する。別method、query、別route、256 KiBを超えるbody、Tunnel origin／hostname不一致、Access Service Token欠落はorigin到達前に拒否する。callerのAccess header、Cookie、forwarding header、任意headerは中継せず、Access資格情報はWorker Secretだけから注入する。

Tunnel hostのcloudflaredはNode runtimeの`127.0.0.1`専用portへ接続する。Node runtimeのnon-loopback listenは引き続き明示opt-inであり、bridge導入を理由にwildcard bindを有効化しない。bridgeはservice token、tenant context、revisionを判断せず、canonical Node routeのservice authとtenant boundaryを迂回しない。配備とreadbackは[Cloudflare Tenant Runtime Private Bridge runbook](../runbooks/cloudflare-tenant-runtime-bridge.md)に従う。

| method／path | 入力 | 成功 | 意味 |
|---|---|---|---|
| `POST /api/v1/runtime/negotiate` | `protocol_negotiation_request`（protocol ID、range、versions、required／optional capabilities、deployment） | `200 protocol_negotiation_response` | 共通契約を開始する前のversion交渉 |
| `GET /api/v1/runtime/verification-keys` | なし | `200 VerificationKeySet` | current／retiring Ed25519公開鍵だけを返す |
| `POST /api/v1/runtime/tenant-context:resolve` | signed service identity、connection selector、requested scopes | `200 TenantContextEnvelope` | Tenant Authorityで一意解決 |
| `POST /api/v1/runtime/workspace-connections:validate-revision` | tenant、connection、expected revision、workspace／app | `200 RevisionValidation` | 不可逆副作用直前のauthoritative conditional read |
| `POST /api/v1/runtime/credential-leases` | Envelopeと`credential_lease_request`（binding、requested TTL） | `201 credential_lease_response` | 要求値以下かつ最大60秒、`max_uses=1`のopaque lease |
| `POST /api/v1/runtime/oauth-refresh:compare-and-swap` | credential ref、expected refresh revision、new opaque ref | `200 RefreshState` | Brainbase所有の競合安全なrefresh |
| `POST /api/v1/runtime/quota:decide` | Envelope、metric、requested quantity | `200 QuotaDecision` | contract revisionを固定した判断 |
| `POST /api/v1/runtime/usage-events` | Envelope、UsageEvent | `202 UsageEvent` | 成否に関係なく冪等記録 |
| `POST /api/v1/runtime/operation-receipts:finalize` | Envelope、correlation、operation／usage set | `201 OperationReceipt` | outcomeとcollection stateを分離して保存 |
| `POST /api/v1/runtime/operation-receipts:finalize-with-pricing` | Envelope、canonical OperationReceipt、Brainbase価格snapshot | `201 { receipt, pricing_snapshot }` | Receiptと価格revisionを同一transactionで保存 |
| `POST /api/v1/runtime/operation-receipts/{receipt_id}/history:read` | Envelope | `200 [{ receipt, pricing_snapshot }]` | tenantを照合しimmutable historyを返す |

`tenant-context:resolve`のselectorは`connection_id + connection_revision`、または管理面で事前登録したexternal mapping keyだけを許す。workspace ID単体から曖昧候補を選ばない。

### ErrorEnvelope

```json
{
  "type": "https://brainbase.example/problems/tenant-resolution",
  "status": 403,
  "code": "scope_mismatch",
  "title": "要求を処理できません",
  "retryable": false,
  "fault_domain": "customer_environment|brainbase_cloud|mana_runtime|protocol",
  "correlation_id": "cor_<ULID>",
  "details": {
    "required_action": "reauthorize|retry|upgrade|contact_operator|none"
  }
}
```

固定codeは従来のtenant／scope／fallback codeに加え、共通kitの`SCHEMA_INVALID`、`REVISION_INVALID`、`TIME_ORDER_INVALID`、`TTL_EXCEEDED`、`NOT_YET_VALID`、`EXPIRED`、`JWS_MALFORMED`、`JWS_PROTECTED_HEADER_INVALID`、`CREDENTIAL_LEASE_INVALID`、`CREDENTIAL_LEASE_TTL_INVALID`、`CREDENTIAL_LEASE_BINDING_MISMATCH`、`IDEMPOTENCY_OWNER_INVALID`、`IDEMPOTENCY_KEY_INVALID`、`COLLECTION_STATE_INVALID`、`OUTCOME_INVALID`、`USAGE_NOT_COLLECTED_HAS_QUANTITY`、`USAGE_PARTIAL_UNKNOWN_FIELDS_REQUIRED`、`USAGE_COLLECTED_QUANTITY_REQUIRED`、`USAGE_COLLECTED_UNKNOWN_FIELDS_FORBIDDEN`、`USAGE_ZERO_REQUIRES_NO_DATA`、`QUOTA_DECISION_INVALID`、`QUOTA_UNAVAILABLE_VALUE_INVALID`、`QUOTA_VALUE_INVALID`、`REPLY_OWNERSHIP_INVALID`を使う。別tenantのresourceは存在有無を漏らさない。内部監査には非公開の判断根拠を相関IDで保存する。

## 5. Protocol version negotiation

`POST /api/v1/runtime/negotiate`は次を返す。

```json
{
  "message_type": "protocol_negotiation_response",
  "protocol_id": "mana-brainbase-tenant-context",
  "selected_version": "1.0",
  "supported_range": ">=1.0 <2.0",
  "supported_versions": ["1.0"],
  "compatibility_until": "RFC3339",
  "required_capabilities": [
    "signed_tenant_context",
    "connection_revision_recheck",
    "tenant_scoped_authorization",
    "credential_broker_v1",
    "usage_receipt_v1",
    "idempotent_effects_v1",
    "container_sanitization_v1"
  ],
  "optional_capabilities": [
    {
      "capability": "cloud_billing_export",
      "status": "supported|unsupported|non_applicable",
      "reason": "non_applicableの場合は必須"
    }
  ]
}
```

requestは`message_type=protocol_negotiation_request`、responseは`message_type=protocol_negotiation_response`とし、両者が`protocol_id`、`supported_range`、`supported_versions`、7つのrequired capabilityを明示する。protocol IDは`mana-brainbase-tenant-context`、currentは`1.0`、rangeは`>=1.0 <2.0`で固定する。同一major内で共通の最高minorを選び、required capability不足は`PROTOCOL_CAPABILITY_UNSUPPORTED`、major不一致は`PROTOCOL_VERSION_UNSUPPORTED`で業務処理前に停止する。silent downgradeとfallbackは禁止する。互換性廃止は最低90日前に通知する。optional capabilityだけが理由付き`non_applicable`を返せる。

## 6. Event契約

Brainbaseが外へ公開するeventはoutboxで冪等配信する。payloadは秘密値を含まず、`event_id`、`event_type`、`schema_version`、`tenant_id`、対象IDとrevision、`correlation_id`、`occurred_at`を共通に持つ。

| event_type | 発生条件 | 最低payload |
|---|---|---|
| `tenant.status.changed.v1` | tenant状態変更 | tenant revision、from／to status |
| `workspace_connection.changed.v1` | install、scope変更、revoke | connection ID／revision／status。credential refも出さない |
| `contract.revision.activated.v1` | contract適用開始 | contract ID／revision／effective period |
| `quota.threshold.crossed.v1` | 50／80／100%等を横断 | metric、threshold、decision |
| `usage.collection.recorded.v1` | usage event永続化 | usage event ID、kind、collection state、outcome |
| `operation_receipt.finalized.v1` | Receipt確定 | receipt ID、collection state、outcome |

consumerはevent中のtenantを信頼せず、service identity、deployment、revisionと照合する。古いrevision eventは再適用せず、欠番は正本readbackを要求する。

## 7. Migration契約

### MigrationPlan

```json
{
  "migration_id": "mig_<ULID>",
  "source_snapshot": "immutable snapshot reference",
  "target_tenant_id": "ten_<ULID>",
  "mapping_rule_revision": 1,
  "mode": "dry_run|apply|rollback",
  "counts": {
    "scanned": 0,
    "eligible": 0,
    "migrated": 0,
    "unchanged": 0,
    "ambiguous": 0,
    "unowned": 0,
    "failed": 0
  },
  "collection_state": "collected|partial|not_collected",
  "attestation": {
    "algorithm": "EdDSA",
    "key_id": "tenant context signing key id",
    "digest": "sha256:<64 lowercase hex>",
    "signature": "base64url Ed25519 signature"
  }
}
```

dry-runは書込み0件で、対象ID、推奨tenant、根拠、ambiguityを出力する。Brainbaseは`attestation`を除くdry-run plan全体のcanonical JSONをSHA-256し、既存のtenant context用Ed25519鍵で署名する。applyは`mode=dry_run`、4項目だけのattestation schema、key ID、digest、署名を再検証し、candidate、source snapshot、mapping rule、件数、対象tenantのいずれかが変わったplanを403で拒否する。秘密鍵・秘密鍵素材はDB、ログ、応答へ保存しない。非秘密のcanonical plan/result payloadはdigest検証、監査、rollback正本としてDB・応答に保存でき、ログへ出す場合はsecret-freeかつredactedにする。candidateの推奨tenantと対象tenantが一致しない場合は、plan生成・quarantine・ledger書込みより前に`CROSS_TENANT_CANDIDATE`でdenyし、tenant値を開示しないredactedな`audit_event=cross_tenant_candidate_denied`を拒否証跡として返す。

runtimeのapply／rollbackは通常のservice authに加え、それぞれ`tenant_migration:apply`／`tenant_migration:rollback` capabilityを必須とする。applyは署名済みplanと`{approved:true, reason, approval_id}`だけを受理し、監査actorはrequest bodyから受け取らず、検証済みservice tokenの`subject`から決定する。apply済みplanのdigest、結果payload、actor、approval ID／理由／時刻を`tenant_migrations`へ同一transactionで保存する。

`scanned = eligible + ambiguous + unowned`を照合し、apply後は`eligible = migrated + unchanged + failed`を照合する。`ambiguous|unowned|failed`は隔離tableへ置き通常queryから除外する。rollback requestはapplyの`migration_id`と明示承認だけを受理し、caller提供の`applied_rows`やtarget tenantを受け取らない。tenantは署名検証済みTenantContextへ束縛し、対象行はDBのapply ledgerから`FOR UPDATE`で読み戻す。元identifier／revisionが一致する行だけを復元し、既に新規更新された行は自動上書きせず`rollback_conflict`に隔離する。rollback ledgerは元applyのmigration IDを外部キーで保持する。

基盤スキーマは`npm run migrate:multitenant-platform-schema`をproduction runnerとする。`--check`は書込みなしのcatalog／schema hash読戻し、`--dry-run`は同じDDLとreadbackをtransaction内で実行後rollback、`--apply --approve-apply`はoperator識別子、advisory lock、同一transaction内のschema hash台帳、readback成功を必須とする。接続先はInfo SSOT用の明示環境変数だけから取得し、接続文字列やsecretを引数、出力、Receiptへ含めない。運用順序と証跡は`docs/runbooks/multitenant-platform-schema-migration.md`を正本とする。

## 8. Scenariosとfixture

fixtureは設計／CI証拠であり本番readbackではない。Brainbase adapterは環境変数で指定したmana-runtime固定HEADの`contracts/mana-brainbase-tenant-context/v1/fixtures/manifest.json`を直接読み、manifestに列挙された23件だけを実行する。Brainbase repositoryへ共通fixtureやtest keyを複製しない。

### positive

- **BBMT-P-001**: active tenant、active connectionの最新revision、正しいapp／scope／deploymentでTenant AのGraphとReceiptへ到達する。
- **BBMT-P-002**: Tenant Aが2つのworkspace connectionを持ち、いずれも同じtenantへ一意解決される。
- **BBMT-P-003**: reinstallでrevisionが増え、旧revisionは`WORKSPACE_CONNECTION_STALE_REVISION`、新revisionだけが最大60秒single-use credential leaseを取得できる。
- **BBMT-P-004**: failed executionのAI／tool／retry消費が同じcorrelationでReceiptへ入る。
- **BBMT-P-005**: Cloud／OSSの両adapterがrequired capability、ErrorEnvelope、minimum Receiptの同じfixtureを満たす。
- **BBMT-P-006**: detached Ed25519 JWS、TTL 300秒、current／retiring key、audienceを満たすcanonical Envelopeが受理される。

### negative

- **BBMT-N-001**: 未解決／複数解決は`TENANT_UNKNOWN`／`TENANT_AMBIGUOUS`。
- **BBMT-N-002**: JWS不正、期限切れ、TTL 301秒は`TENANT_CONTEXT_SIGNATURE_INVALID`／`TENANT_CONTEXT_EXPIRED`。
- **BBMT-N-003**: 別tenant credential／leaseは`CROSS_TENANT_CANDIDATE`。
- **BBMT-N-004**: revoked／stale／正本read不能は`WORKSPACE_CONNECTION_REVOKED`／`WORKSPACE_CONNECTION_STALE_REVISION`／`WORKSPACE_CONNECTION_UNAVAILABLE`。
- **BBMT-N-005**: workspace／app、project、capability不一致はそれぞれ`WORKSPACE_OR_APP_MISMATCH`、`PROJECT_SCOPE_MISMATCH`、`CAPABILITY_SCOPE_MISMATCH`。
- **BBMT-N-006**: credential本文らしいfieldは`SECRET_ARTIFACT_FORBIDDEN`で保存・log前に拒否する。
- **BBMT-N-007**: Contract Authority到達不能は`UPSTREAM_UNAVAILABLE`でallowへ丸めない。
- **BBMT-N-008**: unavailable／partial／timeoutを`UPSTREAM_UNAVAILABLE`／`PARTIAL_RESULT`／`TIMEOUT`とし、0または成功へ丸めない。
- **BBMT-N-009**: protocol major／required capability不足は`PROTOCOL_VERSION_UNSUPPORTED`／`PROTOCOL_CAPABILITY_UNSUPPORTED`で別deploymentへfallbackしない。
- **BBMT-N-010**: migrationの曖昧・未帰属行を通常queryから読めない。
- **BBMT-N-011**: 同一idempotency keyのpayload／context hash不一致を`IDEMPOTENCY_CONFLICT`で拒否する。
- **BBMT-N-012**: credential leaseの再利用、60秒超過、audience／mode不一致を拒否する。
- **BBMT-N-013**: tenant、connection、credential、deployment、protocolのfallback試行を`FALLBACK_FORBIDDEN`で拒否する。

### non-applicable

- **BBMT-NA-001**: `customer_managed_oss`に`cloud_billing_export`、`managed_operations`、`cloud_standard_credential`がない場合、optional capabilityだけを理由付き`non_applicable`とし、minimum Receipt契約は通す。
- **BBMT-NA-002**: single-tenant OSS配置でもtenant context省略は不可だが、共有Cloud固有RLS testは`non_applicable`理由付きで除外できる。
- **BBMT-NA-003**: 顧客固有価格が未確定でもrate revisionのschema contractは検証し、実価格fixtureは非適用とする。

tenant context、署名／時刻、revision、認可、credential scope、isolation、idempotency、failure semantics、Usage／Receipt、fallback禁止はCloud／OSSとも常に必須で、`non_applicable`にできない。全fixtureのruntime／本番実行証拠は作成時点で`not_collected`とする。

## 9. Anti-patterns

- **AP-001**: `access.organizationId || access.tenantId`のようにorganizationとtenantを相互fallbackする。
- **AP-002**: `x-brainbase-organization-id`、workspace ID、project codeだけでtenantを決定する。
- **AP-003**: service tokenの自己申告tenantを正本照合なしで採用する。
- **AP-004**: connection cacheが失効・revision変更を上書きする。
- **AP-005**: token、secret、OAuth credential本文をGraph、DB列、log、event、Receiptへ保存する。
- **AP-006**: 失敗実行をusage集計から除く、またはmissing valueを0へ変換する。
- **AP-007**: OSS非対応のCloud機能をrequired capabilityにする。
- **AP-008**: 障害時に別tenant、別deployment、別credential、default projectへfallbackする。
- **AP-009**: fixture／CI成功を対象deploymentや本番利用者のreadbackと呼ぶ。

## 10. TDD Red設計

プロダクションコードより先に次のtestを追加し、既存実装で意図どおり失敗することを確認した。最初の8 suiteは対象moduleのimport不能、永続化schemaは`ENOENT`、PostgreSQL repositoryはmodule import不能、route登録は`registerTenantRuntimeApiRoute is not a function`、service authはmodule import不能、Envelope業務境界は越境bodyに`200`を返す失敗でRedを固定した。環境変数、外部service、秘密値には依存していない。

| test file | 最初のRed | 主な対象 |
|---|---|---|
| `tests/server/services/multitenant/tenant-authority.test.js` | Tenant Authority module／schemaが存在せず失敗 | tenant lifecycle、一意解決、状態、ID非推定 |
| `tests/server/services/multitenant/tenant-authorization-boundary.test.js` | 現行authがorganization／tenantをfallbackし越境fixtureを拒否できず失敗 | API、MCP、job、Graph、projectの同一境界 |
| `tests/server/services/multitenant/workspace-connection.test.js` | connection revision／reinstall／credential bindingが未実装で失敗 | connection正本、opaque credential ref、scope、revoke |
| `tests/server/services/multitenant/credential-broker.test.js` | single-use lease／OAuth refresh CASが存在せず失敗 | opaque ref、最大60秒lease、operation／audience束縛、CAS |
| `tests/server/services/multitenant/contract-usage-ledger.test.js` | canonical UsageEvent／OperationReceipt、collection stateとoutcome分離、rate revisionがなく失敗 | contract、quota、usage、Receipt、business-effect ledger |
| `tests/server/services/multitenant/protocol-contract.test.js` | canonical Envelope検証／protocol negotiationが存在せず失敗 | Ed25519、TTL、Cloud／OSS、failure分類 |
| `tests/server/routes/tenant-runtime-contract.test.js` | negotiate／tenant-context APIがなく404で失敗 | service auth、Cloud／OSS共通contract、failure分類 |
| `tests/server/services/multitenant/migration-planner.test.js` | tenant列／dry-run／quarantine／rollbackがなく失敗 | 既存データ移行 |
| `tests/server/services/multitenant/persistence-schema.test.js` | `server/sql/multitenant-platform-schema.sql`がなく3件とも`ENOENT`で失敗 | tenant FK、RLS、secret非保存、Usage／Receipt制約 |
| `tests/server/services/multitenant/postgres-repository.test.js` | PostgreSQL repository moduleがなくimport不能 | transaction-local RLS、authoritative revision、refresh CAS、idempotency claim |
| `tests/server/services/multitenant/service-auth.test.js` | service auth moduleがなくimport不能 | issuer、subject、audience、deployment、expiry、capability |
| `tests/server/routes/tenant-runtime-contract.test.js`（Envelope境界） | tenant不一致bodyを`403`で拒否できず`200`になり失敗 | 検証済みEnvelopeへの業務入力束縛 |
| `tests/server/services/multitenant/canonical-wire-strictness.test.js` | required欠落、unknown property、ID／enum／時刻／hash／revision／数量違反を旧validatorが受理して失敗 | canonical Schema同値のstrict rejection |
| `tests/server/services/multitenant/tenant-boundary-entrypoints.test.js` | 5 entrypoint共通gatewayがなく永続resource ownerを照合できず失敗 | 管理API、MCP、background job、migration、audit log |
| `tests/server/services/multitenant/postgres-migration-adapter.integration.test.js` | PostgreSQL adapterが存在せずtransactional apply／rollback／tenant readback不能。SNS bindingもproduction schedulerのDB接続・認可・claim・provider合成経路で未証明 | 実PostgreSQL migration境界、rollback、tenant isolation、production scheduler entrypoint→Ledger→background_job認可→claim→publish |
| `tests/server/bootstrap/tenant-entrypoint-fail-closed.test.js` | runtime無効時の認証済みadmin／auditがtenant guardを通過して業務handlerへ到達する | 管理API／監査APIの503 fail-closed |
| `tests/sns/ops/run-sns-scheduled-posts.test.js` | public publish runnerがruntime無効でもboundaryなしで起動する | production background job起動時のgateway必須化 |
| `tests/sns/ops/import-sns-review-pack-to-ledger.test.js` | production review-pack producerがtenant bindingを永続化せず、署名済みEnvelopeの発行を通らない | deployment-local service tokenとruntime selectorで`tenant-context:resolve`を先行し、完全な署名済みEnvelope／canonical resource headerを送信。欠落またはresolve失敗時はLedger API前に拒否 |
| `tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js` | due postをtenant認可前にclaimしproviderへ送る、またはclaim競合後もproviderへ進む | 永続bindingの副作用前認可、missing／cross-tenant拒否、claim fencing |
| `tests/server/bootstrap/sns-growth-production-boundary.test.js` | SNS APIが認証・tenant guardなしで直接publishでき、DB未設定時にJSON fileへfallbackする | 未認証／tenant欠落拒否、direct publish 409、DB未設定503、file／provider副作用なし |
| `tests/server/bootstrap/tenant-runtime-internal-server.test.js` | production合成経路が固定token比較だけでclaims不正tokenも200にする | 実内部HTTPでJWT署名、issuer、subject、audience、deployment、expiry、capabilityを検証し401でfail closed |
| `tests/e2e/str-brainbase-sns-scheduled-publisher-jst.spec.ts` | review-packからpublisherまでtenant binding／authorizerが未配線 | import→Ledger→background_job認可→provider呼出しの既存経路回帰 |

Redの成立条件は「新contractがないため期待した箇所で失敗する」ことであり、環境変数不足、外部サービス停止、秘密値不足による失敗はRed証拠にしない。各Redを確認後、slice単位で最小実装し、Green、既存回帰、Refactorへ進む。

## 11. 受入条件traceability

| AC | Spec clause／scenario | planned test case | 実装前差分とRed理由 |
|---|---|---|---|
| `AC-001` | INV-001、Contract-01 | `tenant-authority: lifecycle and terminal delete` | canonical Tenant Authority／stateがない |
| `AC-002` | INV-002、Contract-02 | `tenant-authorization-boundary: every owned row has tenant` | organization／project／Graph／Receiptを束ねるtenant列がない |
| `AC-003` | INV-001、AP-001／002 | `tenant-authority: aliases never resolve tenant` | authがorganizationIdとtenantIdをfallbackする |
| `AC-004` | INV-003〜005、BBMT-N-001／002／012 | `tenant-authority: rejects unresolved ambiguous invalid before work` | 一意解決・revision検証がない |
| `AC-005` | INV-010、Contract-02、Contract-04 | `tenant-entrypoint-fail-closed: runtime disabled admin/audit 503`、`sns-growth production boundary: auth + tenant guard + direct publish disabled + DB required`、`review-pack producer: service auth + canonical tenant/resource headers`、`tenant runtime internal server: canonical service-token claims`、`import-sns-review-pack: canonical binding or fail before HTTP`、`run-sns-scheduled-posts: public runner requires gateway`、`sns-scheduled-publisher: authorize before claim/provider and claim-loss fencing`、`scheduled-publisher E2E`、`PostgreSQL binding readback→authorize→claim→publish` | runtime無効時の管理／監査fail-open、SNS API直送、JSON production fallback、固定token比較のみのservice auth、producer auth/header欠落、binding欠落、production scheduler未配線をREDで固定 |
| `AC-006` | MigrationPlan、BBMT-N-010 | `tenant-backfill: dry-run counts quarantine rollback` | tenant migrationがない |
| `AC-101` | Contract-03 | `workspace-connection-registry: canonical relationship` | connection正本objectがない |
| `AC-102` | Contract-03、BBMT-P-002／003 | `workspace-connection-registry: multi-workspace reinstall revoke` | revision履歴がない |
| `AC-103` | Contract-03、event契約 | `workspace-connection-registry: audit fields and revision` | installation／app／scope履歴が一体化されていない |
| `AC-104` | INV-006、BBMT-N-006 | `workspace-connection-registry: rejects secret material` | credential ref検証はあるがtenant／connection束縛がない |
| `AC-105` | INV-004、BBMT-N-003〜005 | `workspace-connection-registry: classified fail closed matrix` | connection別failure分類とfallback禁止がない |
| `AC-201` | Contract-05 | `tenant-usage-receipt: stores plan allowances and policy` | tenant別Contract Authorityがない |
| `AC-202` | Contract-06、BBMT-P-004 | `tenant-usage-receipt: attributes every consumer by correlation` | token集計はあるがtenant ledgerがない |
| `AC-203` | Contract-05、quota event | `tenant-usage-receipt: 50 80 100 and overage decisions` | quota policy／decisionがない |
| `AC-204` | INV-007、Contract-06／07、BBMT-N-008 | `tenant-usage-receipt: failed cost and not_collected are distinct` | OperationReceiptにcollection state分離がない |
| `AC-205` | INV-008、Contract-05／07、Brainbase価格台帳extension | `tenant-usage-receipt: canonical receipt plus historical rate fx sales revisions` | canonical wireと価格履歴の永続境界が分離されていない |
| `AC-301` | Contract-04〜08、BBMT-P-005／006 | `tenant-runtime-contract: cloud and oss fixture parity` | 共通runtime APIがない |
| `AC-302` | Protocol negotiation、BBMT-N-009 | `tenant-runtime-contract: version range required optional compatibility` | negotiation endpoint／capability schemaがない |
| `AC-303` | Protocol negotiation、BBMT-NA-001／003 | `tenant-runtime-contract: cloud optional features are non-applicable` | Cloud／OSS capability分類がない |
| `AC-304` | ErrorEnvelope | `tenant-runtime-contract: machine-readable fault domains` | 現行errorに統一fault domainがない |
| `AC-305` | INV-009、AP-008、BBMT-N-003／009 | `tenant-runtime-contract: never falls back across isolation keys` | tenant／deployment／credentialの統一照合がない |

21件すべてが最低1つのclauseとplanned testへ対応する。VibePro機械Specでは同じAC IDを`story_refs`へ保持する。

## 12. 横断契約の固定判断

| ID | Brainbase実装入力 |
|---|---|
| D-001 | canonical snake_case Envelope、RFC 8785、detached JWS EdDSA／Ed25519、TTL最大300秒、skew 30秒、current／retiring公開鍵 |
| D-002 | 新規共有IDは小文字prefix＋大文字Crockford ULID、既存Brainbase／provider IDはopaque、`op_<ULID>`追加 |
| D-003 | ordered revision event＋副作用直前のauthoritative expected-revision read、cache最大30秒 |
| D-004 | `mana-brainbase-tenant-context`、current `1.0`、`>=1.0 <2.0`、最高共通minor、最低90日互換通知 |
| D-005 | Brainbaseがcredential／refresh sole owner、最大60秒single-use lease、OAuth refresh CAS |
| D-006 | Brainbaseがquota、UsageEvent、OperationReceipt、business-effect ledger owner、固定length-prefixed key、terminal claim最低30日 |
| D-007 | `collection_state`と`outcome`を分離、取得済み空は`NO_DATA` |
| D-008 | BrainbaseはContainer実装を所有せず、sanitization statusがあればReceipt evidenceとしてのみ受理 |
| D-009 | wire profileは`customer_managed_oss`、明示optional capabilityだけ理由付き`non_applicable` |

blocking open decisionは0件である。今後D-001〜D-009の意味を変える必要が生じた場合は、Brainbase Spec単独で変更せず横断契約へ戻して再決定する。

## 13. Verification

| 証拠 | 現在地 |
|---|---|
| Story／accepted Architecture | 確認済み |
| Graphify／codebase graph差分調査 | 確認済み。現行のorganization fallback、tenant ledger不在、Receipt境界不足を確認 |
| VibePro Spec readiness | ready |
| 21 AC trace | 本SpecとVibePro機械Specで定義 |
| canonical conformance kit | mana-runtime PR #292の統合実装 `1b015def50a1ee21b616c87b717e821655bf2a48`、fixture SHA-256 `9f544ab944407db760e4dec79c455bea2fdc9076766ecfd4c7058417cfe7c833`へ固定 |
| positive／negative／non-applicable fixture | 共通manifestの23件を直接読むBrainbase adapter testで検証する。本番readbackではない |
| TDD Red | P0追従で管理／監査が`200`で通過する失敗、production runnerの境界resolver不在、ledgerのbinding未保存、claim／provider実行前authorize不在、境界欠落／cross-tenantが拒否されない失敗を先に固定した。review-pack producer追補では4 tests、既存production E2Eでは1 test、service auth追補ではcanonical claims未発行1 testと不正expiry／audience／deployment／capabilityを受理する4 testsの合5件が意図した理由でRedになったことを確認した |
| 対象unit／schema／repository／route／contract | 関連unitは31 files、218 tests Green。実PostgreSQL Testcontainersは9 tests Green。共通adapterは25 tests Green（manifest 23件とsource-lock／冪等式2件）。MCP tenant boundaryは2 tests Green。production E2Eは1 test Green |
| Spec fingerprint | accepted Specの明示code refsを入力したVibePro fingerprint engineで影響code 20 files、test 120 files、Architecture 1 fileを走査。VibePro inputs digestのcode SHA-256 `2c2efc82464fdf436d66f91e445257fd2baf43ae4197d872551994f7b8aa50cc` |
| repository全体のCI | この時点では未取得。PR push後に別途readbackする |
| Cloud／OSS deployment readback | `not_collected` |
| 実Slackイベント〜Receipt E2E | `not_collected` |
| tenant別請求照合 | `not_collected` |
