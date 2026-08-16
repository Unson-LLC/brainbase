---
spec_id: SPEC-brainbase-multitenant-platform
title: Brainbase Cloud／OSS共通マルチテナント契約
status: draft
date: 2026-08-16
story_id: story-brainbase-multitenant-platform
related_adrs:
  - docs/architecture/story-brainbase-multitenant-platform.md
implementation_files:
  - server/services/tenant/
  - server/services/workspace-connection/
  - server/services/contract/
  - server/services/usage-ledger/
  - server/services/run-receipt/
  - server/routes/tenant-runtime.js
  - migrations/
test_files:
  - tests/server/services/tenant-authority.test.js
  - tests/server/services/workspace-connection-registry.test.js
  - tests/server/services/tenant-authorization-boundary.test.js
  - tests/server/services/tenant-usage-receipt.test.js
  - tests/server/routes/tenant-runtime-contract.test.js
  - tests/migrations/tenant-backfill.test.js
---

# Brainbase Cloud／OSS共通マルチテナント契約

## 0. 状態と境界

このSpecは実装着手前のdraftである。Storyとaccepted Architectureを具体化するが、横断レーンとの照合が終わるまでプロダクションコードの正本にはしない。

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
- **INV-007 Evidence state**: `measured`、`partial`、`unavailable`を区別し、未計測・取得不能・部分取得を0件、0円、成功へ変換しない。
- **INV-008 Immutable accounting**: 確定Receiptは追記訂正だけを許し、当時のcontract、rate、FX revisionを保持する。
- **INV-009 Deployment isolation**: tenant、deployment、connection、credentialのいずれかが一致しない場合、別の組み合わせへfallbackしない。
- **INV-010 Uniform boundary**: 管理API、MCP、background job、migration、監査ログで同じtenant解決・照合規則を使う。

## 2. 識別子と共通型

外部に出るIDはopaque stringとして扱う。draftの推奨形式はprefix付きULIDであるが、横断レーンで形式を照合する。

| 型 | draft形式 | 意味 |
|---|---|---|
| `tenant_id` | `ten_<ULID>` | Tenant Authorityが発行するcanonical ID |
| `tenant_revision` | 正整数 | tenant状態・境界変更ごとに単調増加 |
| `connection_id` | `wsc_<ULID>` | workspace installationの論理接続 |
| `connection_revision` | 正整数 | reinstall、scope、credential、status変更ごとに増加 |
| `contract_id` | `ctr_<ULID>` | tenant契約系列 |
| `contract_revision` | 正整数 | 適用条件のimmutable revision |
| `usage_event_id` | `use_<ULID>` | 冪等な実消費event |
| `receipt_id` | `rcp_<ULID>` | 相関ID単位の利用証跡 |
| `correlation_id` | `cor_<ULID>` | runtimeをまたぐ実行相関 |
| `idempotency_key` | 1〜128文字 | producerとoperation内で一意 |
| `deployment_id` | `dep_<ULID>` | Cloud／OSSの接続先instance |
| `credential_handle` | provider opaque string | Secret Store内の参照。本文ではない |

時刻はUTCのRFC 3339、通貨はISO 4217、金額はminor unitの整数、比率はbasis point、数量は整数またはdecimal stringで表す。JavaScriptの浮動小数金額を永続化しない。

## 3. Object／state契約

### Contract-01: Tenant

```json
{
  "tenant_id": "ten_<ULID>",
  "tenant_revision": 1,
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
  "connection_revision": 3,
  "tenant_id": "ten_<ULID>",
  "provider": "slack",
  "installation_id": "provider opaque id",
  "workspace_id": "provider opaque id",
  "app_id": "provider opaque id",
  "granted_scopes": ["scope:name"],
  "status": "pending|active|revoked",
  "credential_handle": "opaque secret-store reference",
  "installed_at": "RFC3339",
  "revoked_at": null,
  "supersedes_connection_revision": 2
}
```

同じtenantは複数workspaceを持てる。同じprovider／workspace／appの再installは`connection_id`を維持してrevisionを増やす。異なるappへのinstallは別connectionとする。過去revisionは監査用に保持するが認可には使わない。`credential_handle`は`tenant_id`、`connection_id`、`connection_revision`、`deployment_id`へ束縛され、Secret Store解決時に再照合する。

### Contract-04: ServicePrincipalとTenantContextEnvelope

service tokenはcredentialとは別の短命な認証手段で、少なくとも`issuer`、`subject`、`audience`、`deployment_id`、`expires_at`、`capabilities`を検証する。token payloadだけでtenantを決定しない。

```json
{
  "schema_version": "1.0",
  "protocol_version": "1.0",
  "tenant_id": "ten_<ULID>",
  "tenant_revision": 7,
  "actor": {
    "principal_id": "service or person id",
    "principal_type": "person|service",
    "delegated_by": null
  },
  "deployment_id": "dep_<ULID>",
  "connection": {
    "connection_id": "wsc_<ULID>",
    "connection_revision": 3
  },
  "organization_ids": ["organization id"],
  "project_ids": ["project id"],
  "data_scopes": ["graph:read"],
  "capabilities": ["receipt:write"],
  "contract_revision": 4,
  "correlation_id": "cor_<ULID>",
  "idempotency_key": "producer operation key",
  "issued_at": "RFC3339",
  "expires_at": "RFC3339",
  "integrity": {
    "method": "jws|mtls-bound",
    "key_id": "public key id only",
    "value": "detached or compact proof"
  }
}
```

Envelopeは各境界で署名／binding、期限、audience、deployment、全revisionを再検証する。cache hitでも正本revisionより古ければ拒否する。秘密値はEnvelopeへ入れない。

### Contract-05: ContractRevision／QuotaDecision

```json
{
  "contract_id": "ctr_<ULID>",
  "contract_revision": 4,
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
  "usage_event_id": "use_<ULID>",
  "schema_version": "1.0",
  "tenant_id": "ten_<ULID>",
  "tenant_revision": 7,
  "deployment_id": "dep_<ULID>",
  "correlation_id": "cor_<ULID>",
  "idempotency_key": "source event key",
  "execution_outcome": "succeeded|failed|cancelled|timed_out",
  "consumer": "ai|tool|container|storage|retry|external_api",
  "meter": "provider-specific normalized name",
  "quantity": "decimal string or null",
  "unit": "token|call|millisecond|byte|request",
  "evidence_state": "measured|partial|unavailable",
  "source_reference": "non-secret source receipt id",
  "occurred_at": "RFC3339",
  "recorded_at": "RFC3339"
}
```

`measured`だけが数量確定を許す。`partial`は既知部分のquantityと欠落sourceを別フィールドで記録し、`unavailable`のquantityは`null`とする。失敗実行もeventを残す。同一producer／operationの`idempotency_key`は同一内容なら再送成功、異なる内容なら`idempotency_conflict`とする。

### Contract-07: BillingReceipt

```json
{
  "receipt_id": "rcp_<ULID>",
  "receipt_revision": 1,
  "tenant_id": "ten_<ULID>",
  "deployment_id": "dep_<ULID>",
  "correlation_id": "cor_<ULID>",
  "execution_outcome": "succeeded|failed|cancelled|timed_out",
  "evidence_state": "measured|partial|unavailable",
  "usage_event_ids": ["use_<ULID>"],
  "contract_revision": 4,
  "rate_card_revision": 8,
  "fx_table_revision": 5,
  "cost": {
    "purchase_currency": "USD",
    "purchase_minor_units": 123,
    "billing_currency": "JPY",
    "billing_minor_units": 190,
    "fx_rate_decimal": "150.1234"
  },
  "pricing_effective_at": "RFC3339",
  "finalized_at": "RFC3339"
}
```

`partial|unavailable`では未知の金額を`0`にせず、未知フィールドを`null`、既知部分を`known_cost`として分離する。確定後の単価・為替変更は既存Receiptを書き換えず、訂正Receiptで参照する。

## 4. API契約

すべてのAPIは`application/problem+json`の共通ErrorEnvelopeを返す。外部runtime APIは`Authorization`、`Brainbase-Protocol-Version`、`Brainbase-Deployment-Id`を必須にする。tenant ID単体のheaderは解決根拠にしない。

### 管理API

| method／path | 入力 | 成功 | 主な拒否 |
|---|---|---|---|
| `POST /api/v1/tenants` | display name、owner principal | `201 Tenant` | invalid principal、duplicate idempotency |
| `PATCH /api/v1/tenants/{tenant_id}` | expected revision、状態変更 | `200 Tenant` | revision mismatch、invalid transition |
| `POST /api/v1/tenants/{tenant_id}/workspace-connections` | provider installation metadata、credential handle | `201 WorkspaceConnection` | wrong tenant／app、secret-like payload |
| `POST /api/v1/tenants/{tenant_id}/workspace-connections/{connection_id}:revoke` | expected revision、reason | `200 WorkspaceConnection` | stale revision、wrong tenant |
| `PUT /api/v1/tenants/{tenant_id}/contracts/{contract_id}/revisions/{revision}` | immutable contract revision | `201 ContractRevision` | overlapping active period、invalid threshold |
| `GET /api/v1/tenants/{tenant_id}/receipts/{receipt_id}` | tenant-scoped id | `200 BillingReceipt` | cross-tenant resource is non-disclosing denial |

### 外部runtime API

| method／path | 入力 | 成功 | 意味 |
|---|---|---|---|
| `POST /api/v1/runtime/negotiate` | protocol range、required／optional capabilities、deployment | `200 NegotiationResult` | 共通契約を開始する前のversion交渉 |
| `POST /api/v1/runtime/tenant-context:resolve` | signed service identity、connection selector、requested scopes | `200 TenantContextEnvelope` | Tenant Authorityで一意解決 |
| `POST /api/v1/runtime/quota:decide` | Envelope、metric、requested quantity | `200 QuotaDecision` | contract revisionを固定した判断 |
| `POST /api/v1/runtime/usage-events` | Envelope、UsageEvent | `202 UsageEvent` | 成否に関係なく冪等記録 |
| `POST /api/v1/runtime/receipts:finalize` | Envelope、correlation、event set | `201 BillingReceipt` | evidence stateを保存 |
| `GET /api/v1/runtime/receipts/{receipt_id}` | Envelope | `200 BillingReceipt` | tenant／deployment／correlationを照合 |

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

外部へ許す`code`は`not_found`、`ambiguous`、`revoked`、`scope_mismatch`、`revision_mismatch`、`integrity_failed`、`upstream_unavailable`、`partial`、`unsupported`、`protocol_incompatible`、`quota_exceeded`、`idempotency_conflict`。別tenantのresourceは`not_found`と区別できる詳細を返さない。内部監査には非公開の判断根拠を相関IDで保存する。

## 5. Protocol version negotiation

`POST /api/v1/runtime/negotiate`は次を返す。

```json
{
  "selected_protocol_version": "1.0",
  "server_supported_range": ">=1.0 <2.0",
  "compatibility_until": "RFC3339",
  "required_capabilities": [
    "tenant_context.v1",
    "workspace_connection_revision.v1",
    "usage_evidence_state.v1",
    "receipt_minimum.v1",
    "problem_details.v1"
  ],
  "optional_capabilities": {
    "cloud_billing_export.v1": "available|unsupported",
    "managed_operations.v1": "available|unsupported"
  },
  "deployment_id": "dep_<ULID>",
  "deployment_profile": "shared_cloud|dedicated_cloud|customer_managed_oss"
}
```

required capabilityまたはversion範囲が一致しなければ`protocol_incompatible`で停止する。optional capability不在は`unsupported`として機械判定でき、接続全体は成立してよい。Cloud課金exportやmanaged operationsをOSS必須にしない。互換期間の具体日、protocol `1.0`の確定、capability名は横断レーンで照合する。

## 6. Event契約

Brainbaseが外へ公開するeventはoutboxで冪等配信する。payloadは秘密値を含まず、`event_id`、`event_type`、`schema_version`、`tenant_id`、対象IDとrevision、`correlation_id`、`occurred_at`を共通に持つ。

| event_type | 発生条件 | 最低payload |
|---|---|---|
| `tenant.status.changed.v1` | tenant状態変更 | tenant revision、from／to status |
| `workspace_connection.changed.v1` | install、scope変更、revoke | connection ID／revision／status。credential handleも出さない |
| `contract.revision.activated.v1` | contract適用開始 | contract ID／revision／effective period |
| `quota.threshold.crossed.v1` | 50／80／100%等を横断 | metric、threshold、decision |
| `usage.evidence.recorded.v1` | usage event永続化 | usage event ID、consumer、evidence state |
| `receipt.finalized.v1` | Receipt確定 | receipt ID／revision、evidence state、outcome |

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
  "evidence_state": "measured|partial|unavailable"
}
```

dry-runは書込み0件で、対象ID、推奨tenant、根拠、ambiguityを出力する。`scanned = eligible + ambiguous + unowned`を照合し、apply後は`eligible = migrated + unchanged + failed`を照合する。`ambiguous|unowned|failed`は隔離tableへ置き通常queryから除外する。rollbackはmigration ID単位で、元identifier／revisionを復元し、既に新規更新された行は自動上書きせず`rollback_conflict`に隔離する。

## 8. Scenariosとfixture

fixtureは設計／CI証拠であり本番readbackではない。`tests/fixtures/multitenant-contract/v1/`に同じJSONを置き、Cloud adapterとOSS adapterへパラメータ化して適用する計画とする。

### positive

- **BBMT-P-001**: active tenant、active connectionの最新revision、正しいapp／scope／deploymentでTenant AのGraphとReceiptへ到達する。
- **BBMT-P-002**: Tenant Aが2つのworkspace connectionを持ち、いずれも同じtenantへ一意解決される。
- **BBMT-P-003**: reinstallでrevisionが増え、旧revisionは拒否、新revisionだけがcredential解決できる。
- **BBMT-P-004**: failed executionのAI／tool／retry消費が同じcorrelationでReceiptへ入る。
- **BBMT-P-005**: Cloud／OSSの両adapterがrequired capability、ErrorEnvelope、minimum Receiptの同じfixtureを満たす。

### negative

- **BBMT-N-001**: Tenant AのactorがTenant B resource IDを指定すると存在を漏らさず拒否する。
- **BBMT-N-002**: workspace IDだけで複数connection候補が出た場合は`ambiguous`で拒否する。
- **BBMT-N-003**: revoked connectionは古いcacheやdefault tenantへfallbackしない。
- **BBMT-N-004**: connection revision不一致を`revision_mismatch`で拒否する。
- **BBMT-N-005**: app不一致、scope不足、deployment不一致をそれぞれfail closedにする。
- **BBMT-N-006**: credential本文らしいfieldを管理APIへ送ると保存前に拒否し、ログへ出さない。
- **BBMT-N-007**: Tenant Authority／Contract Authority到達不能を成功やallowへ丸めない。
- **BBMT-N-008**: `unavailable` usageをquantity 0、cost 0として確定しない。
- **BBMT-N-009**: protocol required capability不足時に別deploymentへfallbackしない。
- **BBMT-N-010**: migrationの曖昧・未帰属行を通常queryから読めない。
- **BBMT-N-011**: 同一idempotency keyの異なるpayloadを拒否する。
- **BBMT-N-012**: expired service token、audience不一致、Envelope改ざんを業務処理前に拒否する。

### non-applicable

- **BBMT-NA-001**: OSSに`cloud_billing_export.v1`がない場合、optional capabilityを`unsupported`とし、minimum Receipt契約は通す。
- **BBMT-NA-002**: single-tenant OSS配置でもtenant context省略は不可だが、共有Cloud固有RLS testは`not_applicable`理由付きで除外できる。
- **BBMT-NA-003**: 顧客固有価格が未確定でもrate revisionのschema contractは検証し、実価格fixtureは非適用とする。

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

プロダクションコードより先に次のtestを追加し、既存実装で意図どおり失敗することを確認する。現段階ではtestコード自体も未作成である。

| test file | 最初のRed | 主な対象 |
|---|---|---|
| `tests/server/services/tenant-authority.test.js` | Tenant Authority module／schemaが存在せず失敗 | tenant lifecycle、一意解決、状態、ID非推定 |
| `tests/server/services/tenant-authorization-boundary.test.js` | 現行authがorganization／tenantをfallbackし越境fixtureを拒否できず失敗 | API、MCP、job、Graph、projectの同一境界 |
| `tests/server/services/workspace-connection-registry.test.js` | connection revision／reinstall／credential bindingが未実装で失敗 | connection正本、opaque handle、scope、revoke |
| `tests/server/services/tenant-usage-receipt.test.js` | Run Receiptにtenant／evidence state／rate revisionがなく失敗 | contract、quota、usage、Receipt |
| `tests/server/routes/tenant-runtime-contract.test.js` | negotiate／tenant-context APIがなく404で失敗 | service auth、Cloud／OSS共通contract、failure分類 |
| `tests/migrations/tenant-backfill.test.js` | tenant列／dry-run／quarantine／rollbackがなく失敗 | 既存データ移行 |

Redの成立条件は「新contractがないため期待した箇所で失敗する」ことであり、環境変数不足、外部サービス停止、秘密値不足による失敗はRed証拠にしない。各Redを確認後、slice単位で最小実装し、Green、既存回帰、Refactorへ進む。

## 11. 受入条件traceability

| AC | Spec clause／scenario | planned test case | 現行差分とRed理由 |
|---|---|---|---|
| `AC-001` | INV-001、Contract-01 | `tenant-authority: lifecycle and terminal delete` | canonical Tenant Authority／stateがない |
| `AC-002` | INV-002、Contract-02 | `tenant-authorization-boundary: every owned row has tenant` | organization／project／Graph／Receiptを束ねるtenant列がない |
| `AC-003` | INV-001、AP-001／002 | `tenant-authority: aliases never resolve tenant` | authがorganizationIdとtenantIdをfallbackする |
| `AC-004` | INV-003〜005、BBMT-N-001／002／012 | `tenant-authority: rejects unresolved ambiguous invalid before work` | 一意解決・revision検証がない |
| `AC-005` | INV-010、Contract-02 | `tenant-authorization-boundary: parameterized entry points` | 管理API／MCP／job／migrationの共通guardがない |
| `AC-006` | MigrationPlan、BBMT-N-010 | `tenant-backfill: dry-run counts quarantine rollback` | tenant migrationがない |
| `AC-101` | Contract-03 | `workspace-connection-registry: canonical relationship` | connection正本objectがない |
| `AC-102` | Contract-03、BBMT-P-002／003 | `workspace-connection-registry: multi-workspace reinstall revoke` | revision履歴がない |
| `AC-103` | Contract-03、event契約 | `workspace-connection-registry: audit fields and revision` | installation／app／scope履歴が一体化されていない |
| `AC-104` | INV-006、BBMT-N-006 | `workspace-connection-registry: rejects secret material` | credential ref検証はあるがtenant／connection束縛がない |
| `AC-105` | INV-004、BBMT-N-003〜005 | `workspace-connection-registry: classified fail closed matrix` | connection別failure分類とfallback禁止がない |
| `AC-201` | Contract-05 | `tenant-usage-receipt: stores plan allowances and policy` | tenant別Contract Authorityがない |
| `AC-202` | Contract-06、BBMT-P-004 | `tenant-usage-receipt: attributes every consumer by correlation` | token集計はあるがtenant ledgerがない |
| `AC-203` | Contract-05、quota event | `tenant-usage-receipt: 50 80 100 and overage decisions` | quota policy／decisionがない |
| `AC-204` | INV-007、Contract-06／07、BBMT-N-008 | `tenant-usage-receipt: failed cost and unavailable are distinct` | Run Receiptにevidence stateがない |
| `AC-205` | INV-008、Contract-05／07 | `tenant-usage-receipt: historical rate fx sales revisions` | rate／FX／販売価格revisionがない |
| `AC-301` | Contract-04〜07、BBMT-P-005 | `tenant-runtime-contract: cloud and oss fixture parity` | 共通runtime APIがない |
| `AC-302` | Protocol negotiation、BBMT-N-009 | `tenant-runtime-contract: version range required optional compatibility` | negotiation endpoint／capability schemaがない |
| `AC-303` | Protocol negotiation、BBMT-NA-001／003 | `tenant-runtime-contract: cloud optional features are non-applicable` | Cloud／OSS capability分類がない |
| `AC-304` | ErrorEnvelope | `tenant-runtime-contract: machine-readable fault domains` | 現行errorに統一fault domainがない |
| `AC-305` | INV-009、AP-008、BBMT-N-003／009 | `tenant-runtime-contract: never falls back across isolation keys` | tenant／deployment／credentialの統一照合がない |

21件すべてが最低1つのclauseとplanned testへ対応する。VibePro機械Specでは同じAC IDを`story_refs`へ保持する。

## 12. 横断レーンとの照合待ち

次は意図を確定しているが、名前・形式・versionをBrainbase単独でfinalにしない。

1. mana-runtimeが運ぶ`TenantContextEnvelope`のfield名、署名方式、TTL、idempotency scope。
2. Issue #466横断契約の`tenant_id`、`connection_id`、`deployment_id`形式。
3. protocol version初版、互換期間、required／optional capability名。
4. `fault_domain`の責務境界と、customer environment／Brainbase Cloud／mana-runtimeの判定主体。
5. usage consumer／meter／unitの共通語彙、retry二重計上防止、correlation ID生成主体。
6. Receipt minimum schemaと、mana-runtime側execution receiptからBrainbase billing Receiptへの参照方法。
7. Secret Store opaque handleをmana-runtimeが解決するか、Brainbase proxyだけが解決するか。
8. connection revision変更eventの再試行・順序・欠番回復契約。

照合でfield名が変わってもINV-001〜010の意味は変えない。意味が衝突する場合はStory／Architectureへ戻して判断する。

## 13. Verification

| 証拠 | 現在地 |
|---|---|
| Story／accepted Architecture | 確認済み |
| Graphify／codebase graph差分調査 | 確認済み。現行のorganization fallback、tenant ledger不在、Receipt境界不足を確認 |
| VibePro Spec readiness | ready |
| 21 AC trace | 本SpecとVibePro機械Specで定義 |
| positive／negative／non-applicable fixture | 設計済み、未実装 |
| TDD Red | 設計済み、未実行 |
| unit／integration／migration／contract CI | 未実行。コード変更なし |
| Cloud／OSS deployment readback | `not_collected` |
| 実Slackイベント〜Receipt E2E | `not_collected` |
| tenant別請求照合 | `not_collected` |

