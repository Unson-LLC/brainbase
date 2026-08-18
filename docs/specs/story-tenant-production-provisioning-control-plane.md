# テナント本番プロビジョニング制御面 Spec

## 目的と実装境界

`unson-business` を本番のBrainbase制御面へ登録するための宣言的な入口を定義する。現在の実装対象は、既存の `multitenant-platform.v1` を前提にした schema blocker の検査・適用、tenant identity／revision、tenant project、workspace connection／revision、credential reference、provisioning idempotency ledger、service actor／capability registry、標準JWKS readback、redacted receiptである。

Graphは既存canonical projectのread-only解決だけを担当する。service actorやcapabilityをGraphの `person` として作成・更新する処理は持たない。契約revisionの業務項目は既存 `tenant_contract_revisions` の正本を使用するが、manifestからの契約内容を保存する専用書込みは次の実装レーンで追加するまで、schema prerequisiteとして扱い、未指定の契約を推測しない。

## 1. 入力manifest

CLIは秘密本文を含まない、次のようなフラットmanifestを受け取る。

```json
{
  "tenant_key": "unson-business",
  "tenant_id": "ten_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "display_name": "Unson Business",
  "project_code": "mana",
  "workspace_connection": {
    "provider": "slack",
    "workspace_id": "TXXXXXXXX",
    "app_id": "AXXXXXXXX",
    "installation_id": "install_2026_08_19",
    "connection_id": "wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "credential_ref": "credref://unson-business/slack/primary",
    "credential_mode": "customer_oauth",
    "scopes": ["app_mentions:read", "chat:write"]
  },
  "service_actor": {
    "actor_id": "svc_mana_runtime",
    "canonical_project_id": "project_mana",
    "capabilities": ["send_message", "read_graph"]
  }
}
```

`tenant_id`とconnection IDは現在の正本と一致することを検証する。新規ID生成を行う運用では、manifestを先に確定させ、生成結果を別の承認済みmanifestへ固定する。`credential_ref`はopaque referenceの形式とtenant／provider／workspace／appの所有関係だけを確認し、秘密brokerの値は取得・出力・保存しない。

必須キー以外、秘密らしいキー／値、重複するscope／capability、未知のtenant、曖昧なprojectは `MANIFEST_INVALID` または upstream固有のfail-closedエラーとして拒否する。fingerprintは正規化manifestのcanonical JSONをSHA-256した値である。

## 2. schema blocker と migration

migration IDは `tenant-production-provisioning.v1`。既存 `multitenant-platform.v1` が作成した次の表を先にreadbackする。

- `brainbase_schema_migrations`
- `brainbase_tenants`
- `tenant_projects`
- `workspace_connections`
- `workspace_connection_revisions`
- `credential_broker_refs`
- `tenant_contract_revisions`

不足があればDDLを開始せず `SCHEMA_PREREQUISITE_FAILED` とする。

### 2.1 tenant identity と履歴

1. `brainbase_tenants.tenant_key TEXT` を追加する。
2. null行が一件でもあれば、operatorによるbackfillを要求して例外終了する。自動推測・名前検索はしない。
3. `brainbase_tenants(tenant_key)` の一意indexを作る。
4. `brainbase_tenant_revisions(tenant_id, tenant_revision)` を作成し、現在行を一度だけbackfillする。
5. tenant-owned tableの `(tenant_id, tenant_revision_at_write)` 外部キーを履歴表へ付け替える。

履歴backfillは `ON CONFLICT DO NOTHING` とし、適用を繰り返して過去のsnapshotを更新しない。current rowは現在状態、revision tableは過去を含む不変のwrite boundaryである。

### 2.2 project、workspace、credential

canonical Graph projectを一意解決した後、PostgreSQLの `tenant_projects` へ `(project_id, tenant_id, tenant_revision_at_write, project_code)` をupsertする。既存project_idまたはproject_codeが別tenantに属する場合は `PROJECT_TENANT_CONFLICT` とし、tenantの有効化前にrollbackする。Graphへのproject作成は行わない。

workspaceの論理キーは `(tenant_id, provider, workspace_id, app_id)`。pending／activeにpartial unique indexを付ける。同じ論理接続の再インストールはconnection IDを再生成せず、`connection_revision + 1` とsnapshotを保存する。

`workspace_connection_revisions` には次の外部キーを持たせる。

```sql
FOREIGN KEY (tenant_id, connection_id, connection_revision)
REFERENCES workspace_connections (tenant_id, connection_id, connection_revision)
```

既存孤立revisionをreadbackし、一件でもあればconstraint適用を中止する。`credential_broker_refs` にはopaque `credential_ref`、tenant、connection、revision、modeだけを保存し、upsert時に既存tenantが一致しない場合は `CREDENTIAL_TENANT_MISMATCH` とする。

### 2.3 provisioning idempotency ledger

tenant作成前にもclaimできるようtenant FKを付けない。

```sql
CREATE TABLE tenant_provisioning_operations (
  operation_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  desired_state_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'applied', 'failed', 'conflict')),
  actor_principal_id TEXT NOT NULL,
  receipt_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_key, idempotency_key)
);
```

`BEGIN`後にtenant keyのtransaction advisory lockを取得し、既存ledgerを `FOR UPDATE` で読む。同じkeyかつ同じfingerprintでterminal receiptがあればrollbackして同じredacted receiptを返す。fingerprintが異なる場合、または別runがclaimed中の場合は副作用なしで拒否する。

### 2.4 service actor、capability、標準JWKS

service actorは `brainbase_service_actors`、capabilityは `brainbase_capabilities`、grantは `brainbase_service_actor_capabilities` へ保存する。actorのtenant ownershipが既存行と異なるupsertは拒否する。public verification keyだけを `brainbase_service_actor_keys.public_jwk` に保存し、`brainbase_service_actor_jwks` viewから `{"keys": [...]}` をtenant／actor境界付きでreadbackする。private key、OAuth token、Graph `person` はこの制御面へ入れない。

## 3. CLI contract

```text
node scripts/migrate-tenant-production-provisioning.js --check
node scripts/migrate-tenant-production-provisioning.js --dry-run
node scripts/migrate-tenant-production-provisioning.js --apply --approve-apply

node scripts/provision-tenant.js \
  --manifest ./manifests/unson-business.json \
  --idempotency-key ik_unson_business_20260819 \
  --check|--dry-run|--apply --approve-apply
```

- migration `--check` はcatalogとledgerを読むだけ、`--dry-run` はDDL・ledger・readbackを同一transactionでrollback、`--apply` だけがcommitする。
- provision `--check` はmanifestの正規化とredacted summaryだけ、`--dry-run` はprovisioning transactionをrollback、`--apply` は `--approve-apply` と `BRAINBASE_PROVISIONING_ACTOR` を必須とする。
- DB URLは `INFO_SSOT_DATABASE_URL` または `INFO_SSOT_DB_URL` からだけ読み、URLやdriver本文をoutputへ出さない。
- outputはoperation ID、tenant／revision、project、connection／revision、actor、capability、fingerprint、readbackのbooleanだけを返す。credential body、actor email、private keyは出さない。

## 4. transaction、rollback、readback

1. manifestをDB接続前に正規化し、canonical fingerprintを計算する。
2. schema prerequisiteとmigration hashをcheckする。
3. `BEGIN`、timeout、tenant advisory lock、idempotency ledger claimを行う。
4. Graphのcanonical projectをread-onlyで一意解決し、`tenant_projects`へ保存する。未登録・複数候補・別projectは停止する。
5. credential resolverへopaque referenceの所有関係だけを問い合わせる。
6. tenant current／revision、workspace connection／revision、credential broker ref、service actor／capabilityを同じtransactionへ保存する。
7. 全てのreadbackがtenant key、revision、project、connection、actor境界と一致した場合だけtenantをactiveへ遷移し、ledgerをappliedへ更新する。
8. `--dry-run` はここでrollback、`--apply` はcommit後にredacted receiptを返す。

DB、Graph resolver、credential boundaryのいずれかが利用不能または曖昧な場合、Graph writeや別tenant fallbackを行わずrollbackする。rollback後に成功と確定できない状態は `PROVISIONING_FAILED`／`READBACK_FAILED` として残し、同じoperationを黙って新規作成しない。

## 5. TDD traceability と残りの実装

実装済みのテストは次を検証する。

- manifestのunknown key、秘密値、opaque credential、fingerprint、capability allowlist
- tenant key／revision history／FK／backfill blocker、workspace logical unique、connection revision FK、ledger、service registry
- idempotency success replay、fingerprint conflict、Graph ambiguous／person writeなし、tenant project conflict境界、credential tenant mismatch、redacted readback、標準JWKS
- migration check／dry-run rollback／apply approval／actor／schema prerequisite／index readback

次の実装レーンで、既存 `tenant_contract_revisions` のmanifest payload（契約ID、plan、allowance、effective window）を同じtransactionへ追加し、contract readbackをreceiptへ含める。契約を推測して書き込むことはしない。Graph側で追加のproject／person／relation作成が必要な顧客運用は、このStoryのprovisionerでは行わず、別の承認済みGraph migrationとして切り出す。

本Storyでは本番DB apply、秘密値発行、Graph ontology変更、Cloudflare／mana-runtime deployを行わない。
