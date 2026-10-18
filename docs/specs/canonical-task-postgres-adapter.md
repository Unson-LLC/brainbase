# Spec: OSS Canonical Task PostgreSQL adapter

親Story: [OSS Canonical Task PostgreSQL adapter](../stories/story-canonical-task-postgres-adapter.md)

## Ownership and boundary

ADR-003 D1に従い、会社に依存しないTask契約とPostgreSQL persistence kernelはOSS Brainbaseが所有する。
principalの認証、組織・tenantのauthority、Graph照会、workflow固有の監査はadapterが解決せず、
`CanonicalTaskService`へ注入する。`CanonicalTaskAuditRepository`はサービス境界の監査契約を保持し、
adapterはhostが渡した監査/authorityの意味を捏造しない。

## Store identity and IDs

- `createCanonicalTaskStoreConfig`はコミット済みmanifestを読み、必須値・固定identity・禁止された
  environment overrideを検証する。
- readinessの`manifest_hash`はmanifestとbackend identityの証跡に使う。
- 公開IDは`ct1.<payload>.<hmac>`で、payloadにはschema versionと`postgres` store discriminatorを
  含める。
- 移行期間だけ、hostが指定した旧store identityの`legacy_nocodb_id`を同じHMAC境界でreadbackできる。
  identity不一致、署名不一致、schema version不一致はすべて`task_not_found`になる。

## Persistence contract

`CanonicalTaskPostgresRepository`は次を実装する。

- list: status、priority、project、assignee、due date、host visibility predicate、exact count、offset cursor
- search: title token、status、priority、project、assignee、host visibility predicate、bounded keyset cursor
- get/find: opaque IDまたはidempotency keyのreadback
- create: `ON CONFLICT (idempotency_key) DO NOTHING`による同一入力の再実行
- update: signed Postgres IDでは次versionから期待する旧versionを算出し、Postgres CASで一度だけ更新
- delete: 指定versionのCAS delete。stale rowは`version_conflict`として現在Taskを返す

DB query/connection failureは`task_store_unavailable`へ正規化する。`task_not_found`、validation、version
conflict、hostから明示的にpassthroughしたauthority errorは意味を保つ。

## Authority and audit

list/searchのvisibilityはhostの`scopeCondition`だけをSQLへ追加し、adapterはscopeの意味を判定しない。
completion contract変更とcompleted遷移はrow lockを保持したtransaction内で`mutationGuard`へ委譲するため、
agent delegationなどのtyped childが同じ行を検査できる。guardのauthority errorはそのままcallerへ返す。

監査entryのactor、auth source、action、target、changes、source refsはserviceの
`CanonicalTaskAuditRepository`が保存する。operation schemaのreadiness auditはwriter/readiness lifecycleの
証跡であり、会社固有のworkflow ledgerをOSSへ移さない。

## Operation and readiness

`canonical_task_writer`はwriter tokenとprocess identityを一つに束縛する。operation keyとfingerprintは
`canonical_task_operations`に保存し、同一入力のretryは結果をreplayし、異なる入力は409で止める。
readinessはwriter、manifest hash、schema version、source head、evidence hashが一致したときだけmutationを
開く。source-head rebindはguarded pathとlockfile packageの差分が空であることを確認してから行う。

## Storage scope and migration boundary

現行SQLは一つの`canonical_tasks` storeであり、policy `storageScope`を保存するpartition列を持たない。
そのためadapterはscope付きCRUD/recoveryを`task_storage_scope_unsupported`（503）で拒否し、複数tenantの行を
混在させない。hostが物理partition predicateとcreate/update/deleteの結び付きを追加するまで、この拒否を
解除しない。scopeなしの既存kernel consumerは従来の引数形で利用できる。

## SQL and verification

- `contracts/canonical-task/store-schema.sql`: Task rows、version、idempotency、completion contract、検索index
- `contracts/canonical-task/operation-schema.sql`: writer、readiness、readiness audit、operation ledger
- `contracts/canonical-task/search-indexes.sql`: trigram、keyset、source refs index（`CONCURRENTLY`のためmigration
  runnerはtransaction境界を分ける）
- `tests/canonical-task-postgres.test.ts`: ID、visibility、pagination/search、CAS、authority、scope fail-closed
- `tests/canonical-task-operations.test.ts`: writer/readiness/source-head guard
- `tests/canonical-task-store-config.test.ts`: manifest identity/backend fail-closed

このStageの完了証跡はlocal unit test、TypeScript build、diff check、draft PRまでとし、実DBschema apply、
production same-ID readback、consumer切替は未確認として扱う。
