# テナント本番プロビジョニング制御面 Spec

## 目的と実装境界

`unson-business` を本番のBrainbase制御面へ登録するための宣言的な入口を定義する。現在の実装対象は、既存の `multitenant-platform.v1` を前提にした schema blocker の検査・適用、tenant identity／revision、tenant project、workspace connection／revision、credential reference、provisioning idempotency ledger、service actor／capability registry、契約本体payload／runtime binding、標準JWKS readback、redacted receiptである。

Graphは既存canonical projectのread-only解決だけを担当する。service actorやcapabilityをGraphの `person` として作成・更新する処理は持たない。契約revisionはmanifestで契約本体payloadとruntime bindingの全必須項目を宣言し、前者を `tenant_contract_revisions`、後者を `tenant_contract_revision_runtime_bindings` へ同じfresh transactionで保存する。既存の同一tenant／revisionは全項目一致の場合だけ再利用し、不一致は `CONTRACT_REVISION_CONFLICT` で拒否する。未指定の契約を推測せず、部分更新も行わない。

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
  },
  "contract_revision": {
    "contract_id": "ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "revision": "1",
    "status": "active",
    "effective_from": "2026-08-18T00:00:00Z",
    "effective_until": null,
    "plan_code": "mana-standard",
    "allowances": { "tool_calls": 1000 },
    "thresholds_basis_points": [5000, 8000, 10000],
    "overage_policy": "deny",
    "hard_stop_basis_points": 10000,
    "rate_card_revision": 8,
    "fx_table_revision": 5,
    "sales_price_revision": 3,
    "capabilities": [
      "signed_tenant_context",
      "connection_revision_recheck",
      "tenant_scoped_authorization",
      "credential_broker_v1",
      "usage_receipt_v1",
      "idempotent_effects_v1",
      "container_sanitization_v1"
    ],
    "audience": ["mana-runtime"],
    "deployment_id": "dep_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "profile": "shared_cloud"
  }
}
```

`tenant_id`とconnection IDは現在の正本と一致することを検証する。新規ID生成を行う運用では、manifestを先に確定させ、生成結果を別の承認済みmanifestへ固定する。`credential_ref`はopaque referenceの形式とtenant／provider／workspace／appの所有関係を確認し、秘密brokerの値は取得・出力・保存しない。初回接続の未登録refはDB上の未所有だけでは有効とせず、canonical credential boundaryがrefの存在と完全なtenant bindingをread-onlyで証明できない限りfail closedにする。

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

`workspace_connection_revisions`を不変snapshotの正本とし、`workspace_connections`をcurrent pointerとして扱う。credential・usage・receipt等のrevision consumerには次の外部キーを持たせ、可変current rowではなく保存時snapshotへ参照整合させる。

```sql
-- credential_broker_refs等のrevision consumer
FOREIGN KEY (tenant_id, connection_id, connection_revision)
REFERENCES workspace_connection_revisions (tenant_id, connection_id, connection_revision)
```

履歴snapshotから可変current rowを親参照する旧方向のFKは持たない。新revisionではsnapshotを先に追加し、同じfresh transactionでcurrent pointerを進める。既存の孤立current pointerまたは孤立snapshotをreadbackし、一件でもあればconstraint適用を中止する。`credential_broker_refs`、usage、receipt等のrevision参照はhistoryを親とする。`credential_broker_refs` にはopaque `credential_ref`、tenant、connection、revision、modeだけを保存し、upsert時に既存tenantが一致しない場合は `CREDENTIAL_TENANT_MISMATCH` とする。

current pointerには `(tenant_id, connection_id, connection_revision)` からrevision snapshotへのFKを持たせる。snapshot側は旧方向FKを持たず、deferred constraint triggerでcommit時に同じrevisionがcurrent pointerとして選択済みであることを検証する。これによりtransaction内のsnapshot-first順序を保ちながら、孤立snapshotのcommitを拒否する。

### 2.3 provisioning idempotency ledger

tenant作成前にもclaimできるようtenant FKを付けない。

```sql
CREATE TABLE tenant_provisioning_operations (
  operation_id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  desired_state_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'applied', 'failed', 'conflict')),
  claim_token_sha256 TEXT,
  claimed_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 0,
  actor_principal_id TEXT NOT NULL,
  receipt_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (tenant_key, idempotency_key)
);
```

短いtransactionでtenant keyのtransaction advisory lockを取得し、既存ledgerを `FOR UPDATE` で読む。同じkeyかつ同じfingerprintでterminal receiptがあればrollbackして同じredacted receiptを返す。fingerprintが異なる場合、または別runが有効なclaimを所有中の場合は副作用なしで拒否する。新しいattemptではclaim tokenのhashだけを保存してcommitし、advisory lockを解放する。外部resolverはこの後にだけ呼ぶ。

`failed`は同じkey・同じfingerprintに限り新しいclaim tokenとattemptで再claimできる。外部検証後の適用はfresh transactionで同じclaim token hashが現在の所有者であることを確認してから行う。旧attemptの遅延完了、失敗更新、readback確定はfencingで拒否する。

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

- migration `--check` はcatalogとledgerを読むだけ、`--dry-run` はDDL・ledger・readbackを同一transactionでrollback、`--apply --approve-apply` だけがcommitする。migration actorは `BRAINBASE_MIGRATION_ACTOR` から取得してDB ledgerの `brainbase_schema_migrations.applied_by` に保存し、本番適用の承認とreadbackをrollout receiptへ固定する。
- provision `--check` はmanifestの正規化とredacted summaryだけ、`--dry-run` はprovisioning transactionをrollback、`--apply` は `--approve-apply` と `BRAINBASE_PROVISIONING_ACTOR` を必須とする。
- DB URLは `INFO_SSOT_DATABASE_URL` または `INFO_SSOT_DB_URL` からだけ読み、URLやdriver本文をoutputへ出さない。
- outputはoperation ID、tenant／revision、project、connection／revision、actor、capability、fingerprint、readbackのbooleanだけを返す。credential body、actor email、private keyは出さない。

## 4. transaction、rollback、readback

1. manifestをDB接続前に正規化し、canonical fingerprintを計算する。
2. schema prerequisiteとmigration hashをcheckする。
3. 短いtransactionでtenant advisory lockを取り、idempotency ledgerのclaim token hashとattemptを保存してcommitし、lockを解放する。
4. DB transactionとlockを保持しない状態で、`createPostgresGraphProjectResolver` が専用read clientを使ってcanonical projectsをbounded timeout付き・read-onlyで一意解決する。未登録・複数候補・別projectは停止する。
5. 同じくtransaction外でcredential resolverへopaque referenceの所有関係だけをbounded timeout付きで問い合わせる。未登録ref、別tenant、別connection metadata、revokedをfail closedにする。初回接続で `allow_unregistered` を使う場合も、DB上の既存所有者が0件であることと、canonical credential boundaryがrefの存在およびtenant ID／tenant key／provider／workspace／app bindingを証明することを必須とする。boundary未設定・unavailable・no data・不一致では `CREDENTIAL_BOUNDARY_REQUIRED` または不一致分類で停止し、`first_install` を返さない。
6. fresh transactionとtenant advisory lockを取得し、同じclaim token hashが現在の所有者であることをfencing確認する。
7. tenant current／revision、契約本体payload／runtime binding、workspace connectionの不変snapshot／current pointer、credential broker ref、service actor／capabilityを保存する。契約本体は `tenant_contract_revisions`、capabilities／audience／deployment／profileは `tenant_contract_revision_runtime_bindings` へ分離し、同一tenant／revisionの既存値と完全一致しない場合は `CONTRACT_REVISION_CONFLICT` で停止する。connection snapshotをcurrent pointerより先に追加する。
8. 全てのreadbackがtenant key、revision、project、contract本体、runtime binding、connection、actor境界と一致した場合だけtenantをactiveへ遷移し、同じclaimでledgerをappliedへ更新する。redacted receiptには契約ID、revision、status、有効期間、plan、allowances、閾値、超過方針、価格revision群、capabilities、audience、deployment ID、profileのreadbackを含める。
9. `--dry-run` は適用transactionをrollbackし、`--apply` はcommit後にredacted receiptを返す。

DB、Graph resolver、credential boundaryのいずれかが利用不能または曖昧な場合、Graph writeや別tenant fallbackを行わない。外部検証失敗では業務行の適用を開始せず、短いtransactionで現在claimだけをfailedへ遷移する。適用失敗ではfresh transactionをrollbackしてから同じfenced failure更新を行う。同じkey・fingerprintの再試行は外部呼出し前に新claimを永続化し、旧claimによる遅延完了を拒否する。成功と確定できない状態は `PROVISIONING_FAILED`／`READBACK_FAILED` として残し、同じoperationを黙って新規作成しない。

### 4.1 Slack OAuth installation exchange

Slack OAuth callbackは外部token exchangeの前に、単回intentのtenant／workspace／app binding、request digest、exchange claim hash、attemptを短いtransactionで永続化する。認証済みtenant adminまたは事前登録connectionに結びつかないintent、期限切れ、消費済み、別request digest、既存のworkspace／app衝突はfail closedにする。

claim transactionをcommitしてlockを解放した後だけSlack OAuth token exchangeを呼ぶ。完了済みledgerのreplayは外部exchangeを行わず保存結果を返し、処理中の同時callbackは外部exchange前に抑止する。exchange後はfresh transactionで同じclaim、request digest、intent、tenant、workspace、appをfencing確認し、不変connection snapshotの追加、current pointer更新、opaque credential参照、intent消費、ledger完了を原子的に確定する。

exchange失敗は現在claimに対応するfailed状態として記録する。同じbindingとrequest digestだけを新claimで再試行でき、旧claimの遅延完了は `INSTALLATION_CLAIM_STALE` として拒否する。

## 5. TDD traceability と配備残件

実装済みのテストは次を検証する。

- manifestのunknown key、秘密値、opaque credential、fingerprint、capability allowlist
- tenant key／revision history／FK／backfill blocker、workspace logical unique、不変connection snapshotとcurrent pointer、history revision FK、ledger、service registry
- idempotency success replay、fingerprint conflict、claim transaction解放後のbounded resolver、失敗再claim、旧attempt fencing、Graph ambiguous／person writeなし、tenant project conflict境界、credential tenant mismatch、redacted readback、標準JWKS
- Slack OAuthの外部exchange前claim、同時callback抑止、完了replay、失敗再claim、旧callback fencing、workspace／app衝突、snapshot追加後のcurrent pointer更新
- migration check／dry-run rollback／apply approval／actor／schema prerequisite／index readback
- contract revisionの必須payload、canonical protocol capabilities、effective window、契約本体／runtime binding分離、同一revision conflict、redacted receipt readback

契約payload境界は実装済みであり、契約を推測して書き込まず、manifestの宣言と既存revisionが一致する場合だけ適用する。Graph側で追加のproject／person／relation作成が必要な顧客運用は、このStoryのprovisionerでは行わず、別の承認済みGraph migrationとして切り出す。

本Storyでは本番DB apply、秘密値発行、Graph ontology変更、Cloudflare／mana-runtime deployを行わない。
