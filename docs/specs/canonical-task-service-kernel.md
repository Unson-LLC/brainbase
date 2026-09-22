# Spec: Canonical Task service kernel

親Story: [Canonical Taskの公開サービスカーネル](../stories/story-canonical-task-service-kernel.md)

## 目的

Canonical TaskのHTTP/MCP/DB実装に共通する正規化、状態遷移、冪等性、楽観ロック、監査のサービス境界を公開する。カーネル自身はrepository、policy、audit、operation、clock、base URLを依存性注入で受け取り、特定の保存先や組織モデルを知らない。

## 公開契約

- `CanonicalTaskService`: `listTasks`, `searchTasks`, `getTask`, `createTask`, `updateTask`, `transitionTask`, `deleteTask`
- `CanonicalTaskRepository`: list/search/get/idempotency lookup/create/update/delete
- `CanonicalTaskAuditRepository`: `upsertAuditLog`
- `CanonicalTaskPolicy`: context normalization、action authorization、list/search scope
- `CanonicalTaskOperationRepository`: operation keyとfingerprintを使う実行調整
- `CanonicalTaskClock`: deterministicな時刻供給
- `CanonicalTaskBaseUrl`: HTTP(S) base URLまたはprovider
- `CanonicalTaskError`: 安定した`code`/`status`/`details`/`currentTask` envelope

## 不変条件

1. contextのprincipalは既存の`canonical-task-principal`で正規化する。owner alias、Graph resolver、clearance、特定projectの既定値はカーネルで解決しない。
2. create/deleteはidempotency keyを要求し、同じkeyと異なるpayloadは409にする。
3. update/transition/deleteはexpected versionを検証し、状態遷移は既存contractの遷移表に従う。
4. audit entryはprincipal、auth source、action、target、変更、source refsだけを含み、secret値やprivate pathを含めない。
5. repositoryの例外は`task_store_unavailable`、監査の例外は`task_audit_unavailable`へ正規化する。
6. web URLは保存されたHTTP(S) URLを優先し、なければ注入されたbase URLから生成する。base URLがない場合は`null`とする。

## 検証

- `tests/canonical-task-service.test.ts`: DI、CRUD、search/readback、idempotency、version conflict、transition、policy委譲、store error。
- `tests/fixtures/canonical-task-service.ts`: 顧客固有の実装を含まないconsumer fixture。
- `scripts/npm-consumer-smoke.mjs`: 公開tarballを新規consumerからsubpath importし、create/listを実行する。
- `npm run build`、focused Vitest、consumer smokeをPRで実行する。

## 非対象

Postgres adapter、Graph/組織認証、特定のowner/project/tenant、資格情報、secret、deployment設定、顧客データの移行。
