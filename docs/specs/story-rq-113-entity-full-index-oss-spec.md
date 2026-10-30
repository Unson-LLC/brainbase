# RQ-113 索引ビルダ（entity index builder）を OSS へ抽出する Spec

> story_id: `story-rq-113-entity-full-index-oss`
>
> このファイルは Spec の人が読む正本です。CLI 互換の入力は `.vibepro/spec/story-rq-113-entity-full-index-oss/draft.json` に併置しており、orchestrator が本修正後に `vibepro spec write --draft`（`draft.json` を入力）で書き込みます。VibePro CLI が使えないのは本サンドボックス内のみで、一般に利用不能という訳ではありません。開発判断の適用可否は既に VibePro CLI で記録済みです（`applicable: true`、`.vibepro/reviews/story-rq-113-entity-full-index-oss/development-judgment/applicability/current.json`）。
>
> 実シンボル名は brainbase-unson `mcp/brainbase/src/`（`indexer/index.ts`, `indexer/types.ts`, `indexer/ontology.ts`, `sources/entity-source.ts`, `retrieval/evidence.ts`, `server.ts`）で確認済み。

## Story

ホストがホスト内（`indexer/`）で組み立てている索引の **組み立て部分（builder）** を、取得元非依存の再利用部品として OSS `@unson/brainbase-mcp` に抽出し、`EntitySource` インターフェースとともに npm 公開できる形にする。実モジュールが同居させる legacy の解決・検索・文脈ロジック（`resolveEntities` / `searchEntities` / `getContextForTopic` ほか）と `GraphAPISource`（認証付きリモート Graph API クライアント）は Unson 固有のため unson に残す。

## Invariants（不変条件）

- INV-1: OSS は local-first で、hosted backend・Infisical・bb.unson.jp・Lightsail・Unson 内部データ・host 認証 / `TokenProvider`・テナント URL を要求しない。`buildIndex(source)` は注入された `EntitySource` だけで動き、`source.initialize()` を 1 回呼び、11 コア getter を並行に読み、全レコードを builder 側の件数打ち切り無しで索引する。
  - code_ref: `src/entity-indexer.ts` anchor `buildIndex`
  - test_ref: `tests/entity-indexer.test.ts` case "initializes once and indexes all eleven core collections without truncation or network access"
- INV-2: builder は `EntitySource` が登録した拡張 type を索引し、source が登録を返さないときはオントロジー既定拡張登録表にフォールバックする。
  - code_ref: `src/entity-indexer.ts` anchor `buildIndex` / `getExtensionRegistrations`
  - test_ref: `tests/entity-indexer.test.ts` case "indexes registered extensions and falls back to default registrations when empty"
- INV-3: `source.initialize()` または任意 getter の reject は伝播し、`buildIndex` は reject して索引（部分索引含む）を返さない（原子性）。
  - code_ref: `src/entity-indexer.ts` anchor `buildIndex`
  - test_ref: `tests/entity-indexer.test.ts` case "rejects initialization and getter failures without returning an index"
- INV-4: fail-loud 最小検証。getter が非配列を返す／`id` 欠落・空／同一 type 内のアクティブ重複 id のいずれでも throw し、暗黙上書き・部分索引を公開しない。深いフィールドスキーマ検証は加えない（Unson フィールド規約を持ち込まない）。
  - code_ref: `src/entity-indexer.ts` anchor `buildIndex` / `populateCurrentEntities`
  - test_ref: `tests/entity-indexer.test.ts` case "rejects non-array collections, empty ids, and duplicate ids within a type"
- INV-5: 置換レコード（superseded/merged/retired）はアクティブ canonical を上書きせず `replacedIdToCanonicalId` 経由で到達可能に保たれ、非アクティブ person は別名マップから除外される。
  - code_ref: `src/entity-indexer.ts` anchor `populateCurrentEntities` / `buildPersonAliases` / `isReplacedLifecycle` / `isActiveCanonicalPerson`
  - test_ref: `tests/entity-indexer.test.ts` case "preserves canonical replacement pointers and excludes inactive-person aliases"
- INV-6: 再利用は RQ-024 `createEntityIndexCache` に委ね、第二のキャッシュを足さない。`buildIndex` は無改変で cache の `build` として機能し、再構築ごとに `source.initialize()` が再実行される。cache の既存挙動（revision 読取失敗時の再構築、in-flight invalidate / revision 変化時の再試行）には依存も干渉もしない。
  - code_ref: `src/entity-indexer.ts` anchor `buildIndex`、`src/entity-index-cache.ts` anchor `createEntityIndexCache`（既存・無変更）
  - test_ref: `tests/entity-indexer.test.ts` case "drives createEntityIndexCache as its build without adding a second cache"
- INV-7: OSS 境界。`./entity-indexer` は OSS `entity-resolution`（`resolveText`）を import せず、legacy クエリ関数（`resolveEntities` / `searchEntities` / `getContextForTopic` / `tokenizeEntityQuery` / `containsFirstPersonReference` / `resolveCanonicalActivePerson`）・個人名等価語（`TERM_EQUIVALENTS`）・`GraphAPISource`・host 認証を含まない。`BaseEntity` に `organization_id` / `tenant_id` は無い。構造型 `RetrievalEvidence` は公開する。
  - code_ref: `src/entity-indexer.ts`（legacy クエリ・`entity-resolution` を import しない）、`src/entity-resolution.ts` anchor `resolveText`（無変更）
  - test_ref: `tests/entity-indexer.test.ts` case "exports only the builder surface and omits legacy resolver, search, context, and tenant metadata"（静的 import/シンボル検査＋レビュー併用）

## Contracts（公開契約）

- C-1: 新しい公開 subpath は `./entity-indexer` の 1 本のみ。`exports["./entity-indexer"] = { types: "./dist/entity-indexer.d.ts", import: "./dist/entity-indexer.js" }`。`./entity-indexer` は runtime 値 `buildIndex`・`createEmptyIndex`・`isActiveLifecycle`・`isActiveCanonicalPerson`・`isReplacedLifecycle`・オントロジー定数（`CORE_ENTITY_TYPES` / `EXTENSION_ENTITY_TYPES` / `ENTITY_TYPE_REGISTRY` / `EXTENSION_ENTITY_TYPE_SET` / `getStorageType` / `getPublicType` / `getExtensionRegistrations` / `getGraphFetchTypes`）を公開し、型として `EntitySource`・`EntityIndex`・`Entity`・`EntityType`・各エンティティ型・`RetrievalEvidence` を公開する。
  - test_ref: `tests/stage3-oss-package-exports.test.ts` case "publishes the entity indexer as an independent subpath with a self-contained declaration closure"
- C-2: `version` は本 PR で変更しない（現 `0.48.4` のまま。公開版は Maintainer が公開時に設定）。packed tarball に `dist/entity-indexer.*` を含み、宣言クロージャは stub `EntitySource` で閉じ、`retrieval/evidence.js`・host 認証・`src/`・`tests/`・参照コピー path を含まない。
  - test_ref: `tests/stage3-oss-package-exports.test.ts` case "publishes the entity indexer as an independent subpath with a self-contained declaration closure"、`npm pack --dry-run`
- C-3: 既存の公開/Graph 検索コア契約は不変のまま緑（回帰ゲート）。
  - test_ref: `tests/npm-release.test.ts`、`tests/graph-core-package-exports.test.ts`、`npm run build`、`npx tsc --noEmit`、`npm run docs:check`

## Scenarios

- S-1: ローカルのメモリ内 `EntitySource`（network 無し、11 コア＋拡張を返す）を注入 → `buildIndex` が 11 コア収集と登録拡張を索引した `EntityIndex` を返し、`initialize` は 1 回だけ呼ばれる。
- S-2: `buildIndex` を `createEntityIndexCache({ build: () => buildIndex(source), ttlMs })` の `build` に渡す → cache が初回構築し、TTL 内はヒット、`invalidate()` / `revision` 変化で再構築する。builder は追加の状態を持たない。
- S-3: 不正な `EntitySource`（getter が非配列 / id 欠落 / 同一 type 内重複 id / getter reject）→ `buildIndex` は throw し、索引を返さない。
- S-4: superseded な person 行と active canonical 行が同じ表示 id を共有 → active が勝ち、superseded の legacy id は `replacedIdToCanonicalId` 経由で canonical に解決、inactive person は別名マップに入らない。
- S-5: `npm run build` → `dist/entity-indexer.js` / `.d.ts` 生成 → 隔離 tree で `./entity-indexer` を import し `buildIndex` が function、宣言が stub `EntitySource` で閉じる。
- S-6: `npm pack --dry-run` → tarball に `dist/entity-indexer.*` を含み、`src/`・`tests/`・参照コピー path を含まない。

## Anti-patterns

- AP-1: `GraphAPISource`・host 認証・`TokenProvider`・テナント URL・秘密・組織/テナント/承認/監査概念（`BaseEntity.organization_id` / `tenant_id` 含む）を OSS へ持ち込まない。
- AP-2: `entity-index-cache`（RQ-024）があるのに indexer 内に第二のキャッシュ / TTL / 世代ロジックを実装しない。
- AP-3: legacy クエリ層（`resolveEntities` / `searchEntities` / `getContextForTopic` / `tokenizeEntityQuery` / `containsFirstPersonReference` / accessor 群 / `TERM_EQUIVALENTS`）を OSS に抽出しない。OSS `entity-resolution`（`resolveText`）を import・再実装しない。
- AP-4: builder 側に `limit=500` などホスト取得ポリシーを持ち込まない（取得件数は `EntitySource` 実装が決め、builder は打ち切らない）。
- AP-5: `version`・`package-lock.json`・`tsconfig.json` を公開のためだけに変更しない（build / install が実際に失敗する場合のみ scoped に対応）。
- AP-6: 架空名（`buildEntityIndex` / `ENTITY_INDEX_ENTITY_TYPES`）を使わない。実名 `buildIndex` ほかを使う。
- AP-7: fail-loud 最小検証を超える深いフィールドスキーマ検証を加えない。
- AP-8: evidence の **関数**移動の特定案に実装を固定しない（型 `RetrievalEvidence` のみ OSS、`buildIndex` は evidence 非依存）。

## code_refs（新規・変更）

- 新規: `src/entity-indexer.ts`（brainbase-unson `mcp/brainbase/src/{indexer/index.ts, indexer/types.ts, indexer/ontology.ts, sources/entity-source.ts}` の builder サブセット抽出）
- 変更: `package.json`（`exports` に `./entity-indexer` を追加のみ、`version` 不変）
- 新規: `tests/entity-indexer.test.ts`
- 変更: `tests/stage3-oss-package-exports.test.ts`（`./entity-indexer` の宣言クロージャ検査を追加）
- 無変更（関係明示のみ）: `src/entity-index-cache.ts`, `src/entity-resolution.ts`, `src/graph-retrieval.ts`, `src/server.ts`

## test_refs（本 Spec を証明するテスト）

- 新規: `tests/entity-indexer.test.ts`
  - "initializes once and indexes all eleven core collections without truncation or network access"（INV-1 / AC-01）
  - "indexes registered extensions and falls back to default registrations when empty"（INV-2 / AC-02）
  - "rejects initialization and getter failures without returning an index"（INV-3 / AC-03）
  - "rejects non-array collections, empty ids, and duplicate ids within a type"（INV-4 / AC-04）
  - "preserves canonical replacement pointers and excludes inactive-person aliases"（INV-5 / AC-05）
  - "drives createEntityIndexCache as its build without adding a second cache"（INV-6 / AC-06、実物の `createEntityIndexCache` を使用）
  - "exports only the builder surface and omits legacy resolver, search, context, and tenant metadata"（INV-7 / AC-07、静的 import/シンボル検査）
- 変更: `tests/stage3-oss-package-exports.test.ts`
  - "publishes the entity indexer as an independent subpath with a self-contained declaration closure"（C-1 / C-2 / AC-08）
- 既存・無変更で緑を維持（回帰ゲート C-3）: `tests/npm-release.test.ts`, `tests/graph-core-package-exports.test.ts`, `tests/entity-resolution.test.ts`
