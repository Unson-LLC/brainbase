# 開発判断: RQ-113 索引ビルダを OSS @unson/brainbase-mcp へ（builder-only 抽出）

- story_id: `story-rq-113-entity-full-index-oss`
- recorded_by: agent:claude-opus（OCO サンドイッチ step1 / scope revision）
- 日付: 2026-10-30（Codex クロスレビュー PASS_WITH_CHANGES 反映後）
- 根拠決定: A案（Director/Worker リレー 2026-10-30 12:30 JST「indexer を brainbase main を土台に OSS へ、GraphAPISource は unson に残す」）、佐藤さん承認 18:06 JST「RQ-113 の npm 公開を進めて」
- 参照元の正本: brainbase-unson `mcp/brainbase/src/`（読み取り専用コピーで実シンボルを確認済み。実名に合わせて本書を改訂した）

## この scope にした理由（Subtract before adding）

ホストが `search` / `list_entities` / `get_entity` / `resolve_entity` のために組み立てる索引の **組み立て部分（builder）** は取得元に依存しない。取得元を `EntitySource` インターフェースとして抽象化すれば、索引ビルダ本体 `buildIndex(source)` と、そのビルダが必要とするライフサイクル／別名ヘルパ、オントロジー登録表、エンティティ型だけを OSS に置ける。認証付きリモート Graph API クライアント `GraphAPISource`（host 認証 / `TokenProvider` / テナント）は Unson 固有なので unson に残す。再構築の再利用（TTL・無効化・リビジョン）は既に develop にある RQ-024 `createEntityIndexCache`（#877）に委ね、第二のキャッシュを作らない。

**重要な訂正（Codex 指摘を反映）**: 実モジュール `indexer/index.ts` は builder だけでなく legacy の解決・検索・文脈ロジック（`resolveEntities` / `searchEntities` / `getContextForTopic` ほか）を同居させている。本 Story は **builder とそれに必要なヘルパのみ** を抽出し、legacy クエリ層は unson に残す。したがって「ソース非依存の索引ビルダ＋ export 1 本」が最小の追加になる。

## Scope IN（OSS に追加する実シンボル）

`src/entity-indexer.ts`（新規・1 ファイルに同梱）に、brainbase-unson `mcp/brainbase/src/{indexer/index.ts, indexer/types.ts, indexer/ontology.ts, sources/entity-source.ts}` から **builder サブセットのみ** を抽出する。

- Runtime（値）:
  - `buildIndex(source: EntitySource): Promise<EntityIndex>`（実名。`buildEntityIndex` という名は実在しないため使わない）
  - `createEmptyIndex(): EntityIndex`
  - ライフサイクルヘルパ `isActiveLifecycle`、`isActiveCanonicalPerson`、`isReplacedLifecycle`（builder 内部の `populateCurrentEntities` / `buildPersonAliases` が使用し、`GraphAPISource` が `isActiveLifecycle` を import する）
  - オントロジー登録表 `CORE_ENTITY_TYPES`、`EXTENSION_ENTITY_TYPES`、`ENTITY_TYPE_REGISTRY`、`EXTENSION_ENTITY_TYPE_SET`、関数 `getStorageType`、`getPublicType`、`getExtensionRegistrations`、`getGraphFetchTypes`
- 型:
  - `EntitySource`（インターフェース）、`EntityIndex`、`Entity`、`EntityType`、`LifecycleRecord`
  - エンティティ型 `BaseEntity`、`Project`、`Person`、`Organization`、`Brand`、`RACI`、`App`、`Customer`、`Partner`、`Decision`、`GlossaryTerm`、`Document`、`ExtensionEntity` と補助型 `PositionEntry`、`DecisionEntry`、`AssignmentEntry`、`RACIEntry`、`AppRepositoryRef`、`AppEnvironmentEndpoints`、`AppEnvironmentProfile`、`AppOperationalProfileCoverage`
  - オントロジー型 `EntityTypeRegistration`、`EntityTypeCategory`、`CoreEntityType`、`ExtensionEntityType`
  - 構造型 `RetrievalEvidence`（下記「retrieval/evidence の扱い」。`BaseEntity.retrieval_evidence?` の宣言依存を解消するため OSS に **型だけ** を置く。関数は移さない）
- `package.json` `exports` に `./entity-indexer` を 1 本追加（`version` 不変）。
- `tests/entity-indexer.test.ts`（新規）、`tests/stage3-oss-package-exports.test.ts`（`./entity-indexer` の宣言クロージャ検査を追加）。
- Story / Spec / 本判断文書・`draft.json`。

## Scope OUT（移さない / 変えない。実シンボル）

- `GraphAPISource`（unson 残置。host 認証 / `TokenProvider` / テナント URL 依存）。
- legacy クエリ層（unson 残置。OSS へ移さない）: `resolveEntities`、`searchEntities`、`getContextForTopic`、`resolvePersonId`、`resolveOrgId`、`resolveBrandId`、`getEntity`、`getEntitiesByType`、`getExtensionEntitiesByType`、`getExtensionTypeRegistrations`、`tokenizeEntityQuery`、`containsFirstPersonReference`、`resolveCanonicalActivePerson`、`contactDetails`、定数 `TERM_EQUIVALENTS`（個人名の表記ゆれ等価語）、`EntityResolver*` 型。
- `retrieval/evidence.ts` の関数 `extractEvidence` / `hasSubstantiveValue` / `bodyEvidenceFields` と定数 `BODY_EVIDENCE_FIELDS`（unson 残置。OSS は構造型 `RetrievalEvidence` だけ持つ）。
- host 認証 / `TokenProvider`。
- 既存 `src/entity-index-cache.ts`（RQ-024・再利用するが無変更）、`src/entity-resolution.ts`（`resolveText`）、`src/graph-retrieval.ts`、`src/server.ts`。
- `version` bump、`package-lock.json`、`tsconfig.json`、workflows。
- ホスト unson 側の import 差し替え / ローカル実装の整理（別 PR・**host コード変更**。config のみではない。下記「unson が後で行う変更」）。
- npm 公開そのもの（本 Draft PR 確認後に Maintainer が別途実施）。

## Cross-model scope review (Codex) disposition

Codex は REAL unson source に対して本 scope を静的レビューし PASS_WITH_CHANGES を返した。各所見の採否:

1. **宣言境界（indexer の型が `retrieval/evidence` に依存）— ACCEPT。** `indexer/types.ts:9` の `BaseEntity.retrieval_evidence?: RetrievalEvidence` は型依存なので、OSS に構造型 `RetrievalEvidence` を export して宣言クロージャを閉じる（evidence 関数は移さない）。
2. **builder の実 API は `buildIndex(source)`、AC-02 の記述が誤り — ACCEPT。** 架空名 `buildEntityIndex` / `ENTITY_INDEX_ENTITY_TYPES` を廃し実名に統一。builder は全 type を汎用列挙せず、固定 11 コア getter ＋ 拡張登録を読む。`EntitySource` に `limit` は渡らない（`limit=500` は `GraphAPISource.initialize` 内のみ）。AC-02 を「11 コア収集＋登録拡張、builder 側の打ち切り無し」に訂正。remote 完全性／ページングは本 PR 外。
3. **AC-03 は新規検証を要する（単純抽出ではない）— ACCEPT（最小で）。** 下記「runtime 検証の範囲」で最小限を定義（非配列・空 id・同一 type 内重複 id の fail-loud）。過剰検証は却下。
4. **cache 再利用は可だが "のみ" は過剰 — ACCEPT。** cache の既存挙動（revision 読み取り失敗時の再構築、構築中 revision 変化・in-flight invalidate 時の再試行）を排除する網羅的 "のみ" 文言を AC から削除。AC は「`buildIndex` が cache の `build` として無改変で機能し、再構築ごとに `source.initialize()` が再実行される。builder は第二のキャッシュ/TTL/世代ロジックを持たない」に限定。
5. **完全モジュールに対し "重複なし" は誤り — ACCEPT。** `resolveEntities` / `searchEntities` / `getContextForTopic` 等は OSS `resolveText` と機能的に重なるため **抽出せず unson に残す**。AC-05 は「builder ＋ ライフサイクル/別名ヘルパのみ抽出、legacy クエリ関数は含めない・OSS `entity-resolution` を import しない」に限定。静的 import/シンボル検査＋レビューで担保（自動テスト単独で意味的非重複は証明できない点も明記）。
6. **unson 側の削除/import 計画が不完全 — ACCEPT。** これは **host コード変更**（config のみではない）。実 consumer を全列挙し、`tools/graph-retrieval.ts`（`getStorageType`）と `tools/knowledge-resolution-tools.ts`（`getPublicType`）を追記。`indexer/index.ts` は legacy クエリ層が残るため **削除しない**（builder 等を package import に差し替え、クエリ層はローカル保持）。下記で全面改訂。
7. **evidence は案b が最も近いが共有構造型が要る — ACCEPT。** 推奨を案b＋構造型 export に更新。関数 `extractEvidence` / `hasSubstantiveValue` / `bodyEvidenceFields` は unson 残置。構造型 `RetrievalEvidence` のみ OSS。retrieval の意味論は `retrieval/engine.ts` 経由でより広くテストされる点も記録。
8. **packaging AC は可だがテスト target が弱い — ACCEPT。** `tests/npm-release.test.ts` は temp fixture ベースで本チェックアウトの宣言クロージャ/tarball 内容を単独では担保しない。packed 内容検査＋隔離 consumer の宣言クロージャ検査（stub `EntitySource`、宣言に `retrieval/evidence.js` / host 認証 / 参照コピー path を含まない）を AC-08 のテストに追加。「does not re-implement …」名のテストは意味的非重複を自動証明できないため、依存/シンボル検査＋レビュー併用とする。

## 実装レビュー（Claude Opus）

Codex の実装（`src/entity-indexer.ts`、`tests/entity-indexer.test.ts`、`package.json` の `exports`、`tests/stage3-oss-package-exports.test.ts` の AC-08）を本 scope に照らしてレビューした。

**verdict: PASS。修正不要。** builder サブセットの抽出・fail-loud 最小検証・`./entity-indexer` の宣言クロージャ・回帰ゲートはいずれも本判断文書と Spec の意図どおり。

修正は求めないが、後続で確認すべき issue-only の注記:

- (a) fail-loud 検証（非配列 / 空 id / 同一 type 内アクティブ重複 id で throw）は unson の寛容な builder からの **意図的な乖離** である。import 差し替え前に、unson host PR 側で `GraphAPISource` の出力がこの検証を満たすことを確認する必要がある（満たさないと切替時に実データで throw する）。likelihood 4 × impact 5。
- (b) AC-01 の fetch-spy ガードは **ネットワーク非依存の回帰トリップワイヤ** であって、ネットワーク非依存そのものの証明ではない（`fetch` 以外の経路は検知しない）。回帰検知としては有効。likelihood 2 × impact 1。

## indexer（builder）と entity-resolution の関係（複製しない、を正確に）

- `entity-resolution.ts`（既存 OSS、`resolveText`）は **読み込み済みの** `GraphFileV2`（ローカル正規グラフ）に対し text の mention を候補エンティティへ解決し解決レシートを返す（消費側）。
- `buildIndex`（新規・抽出）は `EntitySource` から 11 コア収集＋拡張を取得し、ライフサイクル（置換ポインタ）と別名マップを張った `EntityIndex`（corpus）を組み立てる（供給側）。
- 両者は層が異なり重ならない。`entity-indexer` は `entity-resolution` を import も再実装もしない（AC-07）。unson 内の legacy `resolveEntities` 等とも別物（あちらは unson に残置）。
- 再利用: `createEntityIndexCache({ build: () => buildIndex(source), ttlMs, revision })`。builder は `build` を供給、cache が初回・TTL・invalidate・revision を制御する（第二キャッシュ禁止、AC-06）。

## runtime 検証の範囲（意図的に最小化）

実 `buildIndex` は `await source.initialize()` → 11 コア getter ＋ `getExtensionTypeRegistrations()` を `Promise.all` → `populateCurrentEntities` で Map に格納、の順。原子性（initialize/getter の reject が伝播し、索引は完成時のみ返る）は既に成立。欠けているのは malformed レコードの系統的検証（id 無しは `undefined` キーで衝突、重複 id は暗黙上書き＝暗黙のデータ欠落）。

「fail-loud・部分索引を公開しない」を真にする **最小限のみ** を追加する:

- MUST reject（throw、索引を返さない）:
  - getter が配列でない値を返した（honest な空コレクションと区別できないため）。
  - コア/拡張エンティティの `id` が欠落または空文字。
  - 同一 type 内で **アクティブ（非置換）レコードが同じ `id`** に衝突（暗黙上書き＝暗黙欠落の防止）。
- 既存どおり維持（原子性）: `source.initialize()` または任意 getter の reject は伝播し、`buildIndex` は throw、部分索引は返らない。
- 追加しない（過剰として却下）: フィールド単位のスキーマ検証、discriminator 一致、別名フィールド形状、登録の深い妥当性、extension type 整合。これらは不変条件に不要で、Unson 固有のフィールド規約を OSS に持ち込むため。
- duplicate-id ポリシー: 置換（superseded/merged/retired）レコードが複数の legacy id を 1 canonical に向ける `replacedIdToCanonicalId` は正当であり重複ではない（除外しない）。person の負のエビデンス再追加は `if (!target.has(entity.id))` でガード済み。拒否対象は **アクティブ同士の id 衝突** のみ。

## BaseEntity の `organization_id` / `tenant_id` の扱い（決定）

**OSS の `BaseEntity` からは `organization_id` と `tenant_id` を除外する（host-extended 型に委ねる）。**

- 理由: CLAUDE.md のとおり OSS は organization/tenant/member/role 概念を持ち込まない。実 `indexer/types.ts:23-25` はこれらを「authenticated Graph row のテナントメタデータ」として持つが、これは host 固有の概念であり single-owner の判断基盤に属さない。
- 影響なし: builder はこれらを読まない。両フィールドは認証 Graph row でのみ埋まる任意項目なので、OSS 基底から外しても local-first 経路は壊れない。
- host 側: `GraphAPISource`（unson 残置）は必要なら `interface HostGraphEntity extends BaseEntity { organization_id?: string; tenant_id?: string }` のように host-extended 型を宣言して保持する。
- 検証: AC-07 のテストが OSS `BaseEntity` にこれらが無いことを型/宣言レベルで確認する。

## retrieval/evidence の扱い（型は IN・関数は Proposal / Director 決定事項）

settled: 構造型 `RetrievalEvidence` は OSS に置く（`BaseEntity.retrieval_evidence?` の宣言依存を閉じるため必須。Scope IN）。実体は `Partial<Record<content|statement|decision|rationale|body|markdown|body_summary|summary|description|notes|source_pointer|provenance, unknown>>` で、フィールド名は汎用的な content/provenance 語であり Unson 固有ではない（Codex 所見7）。

open（**関数** `extractEvidence` / `hasSubstantiveValue` / `bodyEvidenceFields` / 定数 `BODY_EVIDENCE_FIELDS` をどうするか）:

- 案a: 小ヘルパも OSS へ移す。利点: evidence 抽出が必要なら自己完結。欠点: 不要な関数移動。`GraphAPISource`（unson）が実際の呼び出し元で、builder は呼ばない。
- 案b（**推奨**）: 関数は unson に残し source 層（`GraphAPISource`）と `server.ts` に閉じる。OSS は構造型のみ。利点: ランタイム境界が正しい（抽出は `GraphAPISource`、整形は server）、OSS 最小。実 `buildIndex` は evidence 抽出を呼ばない（確認済み）ので成立する。
- 案c: OSS が `EvidenceExtractor` コールバック port を定義し unson が実装注入。欠点: builder は使わないため不要な間接。現設計（source が抽出済み evidence を返す）に対し冗長。

**推奨**: 案b（型だけ OSS、関数は unson）。`buildIndex` は evidence を呼ばないことを実コードで確認済み。最終決定は Director（Open Q1）。

## unson が後で行う変更（別 PR・**host コード変更**。config のみではない。ここでは説明のみ・本 PR で実施しない）

公開後に Maintainer が公開版へ unson（mcp/brainbase）側で行う host コード変更:

1. 依存版 bump: `@unson/brainbase-mcp` を公開版へ（Maintainer が公開時に決定）。
2. import 差し替え（ローカル `./indexer/*`・`./sources/entity-source` → package subpath `@unson/brainbase-mcp/entity-indexer`）。実 import 元:
   - `server.ts:18-33` が `./indexer/index.js` から取る runtime: `buildIndex`, `createEmptyIndex`, `getEntity`, `getEntitiesByType`, `getExtensionEntitiesByType`, `getExtensionTypeRegistrations`, `isReplacedLifecycle`, `resolveEntities`, `resolveCanonicalActivePerson`, `containsFirstPersonReference`, `searchEntities`, `tokenizeEntityQuery`。型 `EntityIndex`, `EntityType`。`server.ts:34` が `./indexer/ontology.js` から `CORE_ENTITY_TYPES`、`server.ts:48` が `./sources/entity-source.js` から型 `EntitySource`。
     → このうち **package から import に差し替えるのは移行済みシンボルのみ**（`buildIndex`, `createEmptyIndex`, `isReplacedLifecycle`, `CORE_ENTITY_TYPES`, `EntityIndex`, `EntityType`, `EntitySource`）。legacy クエリ（`resolveEntities`, `searchEntities`, `getContextForTopic`, `tokenizeEntityQuery`, `containsFirstPersonReference`, `resolveCanonicalActivePerson`）と accessor（`getEntity`, `getEntitiesByType`, `getExtensionEntitiesByType`, `getExtensionTypeRegistrations`）は **ローカル保持**（下記 4）。
   - `sources/graphapi-source.ts`: `../indexer/types.js`（全 projection 型 ＋ `AppEnvironment*`/`AppRepositoryRef` 等）、`../indexer/ontology.js`（`EXTENSION_ENTITY_TYPE_SET`, `getExtensionRegistrations`, `getGraphFetchTypes`, `getPublicType`, `getStorageType`, 型 `EntityTypeRegistration`）、`../indexer/index.js` の `isActiveLifecycle` を package import に差し替え。`GraphAPISource` 実装本体・`GraphEntity` 型・host-extended テナント型はローカル残置。`../retrieval/evidence.js` の `extractEvidence` / `hasSubstantiveValue` はローカル残置（案b）。
   - `tools/graph-retrieval.ts:1`: `getStorageType` を package import に差し替え。
   - `tools/knowledge-resolution-tools.ts:20`: `getPublicType` を package import に差し替え。
3. ローカルファイルの整理:
   - 完全移行につき削除可: `indexer/types.ts`、`indexer/ontology.ts`、`sources/entity-source.ts`。
   - **削除しない**: `indexer/index.ts`。builder/ライフサイクルは package から import に差し替えつつ、legacy クエリ層（`resolveEntities`/`searchEntities`/`getContextForTopic`/`tokenizeEntityQuery`/`containsFirstPersonReference`/`resolveCanonicalActivePerson`/`contactDetails`/`TERM_EQUIVALENTS`/`EntityResolver*`）と accessor（`getEntity`/`getEntitiesByType`/`getExtensionEntitiesByType`/`getExtensionTypeRegistrations`）はローカル保持（互換ファサード化）。
   - `sources/graphapi-source.ts` は残す。
4. unson 側テストを差し替え後に通す: `sources/graphapi-source.test.ts`（lifecycle / canonical redirect / malformed response / incomplete snapshot / extension hydration）、`retrieval/engine.test.ts`（evidence status / unresolved external pointers）、`server-index-readiness.test.ts`（初期化 reject / 並行回復 / テナント分離 / TTL / invalidation / in-flight stale 拒否）、`sources/source-retirement.test.ts`。

これらは **本 PR では行わない**（OSS 側の追加のみ）。

## version bump の判断

**本 PR では bump しない（既定、現 `version` = `0.48.4` のまま）。** 理由: RQ-024（AC「version は変更しない」）と同じ方針で、subpath の追加は後方互換の加算であり PR 単体で version を上げない。公開版は Maintainer が公開時に設定する（佐藤さん承認の「npm 公開を進めて」は Maintainer の公開工程）。`package-lock.json` / `tsconfig.json` も公開のためだけに変更しない。

## 却下した選択肢（各 1 行理由）

- `GraphAPISource` も OSS へ移す → host 認証 / `TokenProvider` / テナント依存で OSS 境界違反。A案で unson 残置に決定済み。
- `indexer/index.ts` を丸ごと（`resolveEntities`/`searchEntities`/`getContextForTopic` 込み）移す → OSS `resolveText` と機能重複・個人名等価語など Unson 固有を持ち込む。builder サブセットのみ抽出。
- 索引用に新しいキャッシュ / TTL を indexer 内に実装 → RQ-024 `createEntityIndexCache` と二重化。再利用で足りる。
- builder の名前を `buildEntityIndex` にする → 実在せず rename は抽出外の変更。実名 `buildIndex` を使う（alias も不要）。
- フィールド単位スキーマ検証を足す → 不変条件に不要・Unson フィールド規約の持ち込み。最小検証（非配列/空id/重複id）に留める。
- `BaseEntity` に `organization_id`/`tenant_id` を残す → OSS に tenant 概念を持ち込む。host-extended 型へ。
- export subpath を 2 本（`./entity-indexer` と `./entity-source`）に分割 → 1 本で足りる（Director へ Q2）。
- この PR で `version` を bump → 公開版は Maintainer が公開時に設定。

## Open Questions（Director 向け）

- Q1: retrieval/evidence の **関数**は案a/b/c のどれか（型 `RetrievalEvidence` は IN で確定。推奨は案b）。
- Q2: export subpath は `./entity-indexer` 1 本でよいか（既定）、`./entity-source` を分けるか。
- Q3: `EntitySource`・索引 type・オントロジー・エンティティ型を 1 ファイルに同梱でよいか（既定）、分割するか。
- Q4: OSS に具体 `LocalEntitySource`（正規グラフ読み取り）も同梱するか（既定は不要、インターフェースのみ）。
- Q5: cache の `revision()` に何を渡すか（graph revision reader 等）は host 設定（OSS 範囲外、確認のみ）。

## CLI 記録状況と担当境界

- 開発判断の適用可否（development-judgment applicability）は VibePro CLI で記録済み（record_id `applicability-2026-10-30T12-28-22-850Z-9478d578`、file `.vibepro/reviews/story-rq-113-entity-full-index-oss/development-judgment/applicability/current.json`、`applicable: true`、`recorded_by: agent:claude-opus`）。これは orchestrator が CLI 経由で記録した。
- Spec は本修正後に orchestrator が `vibepro spec write --draft`（`draft.json` を入力）で書き込む。`docs/specs/...-spec.md` は人が読む正本として維持し、`draft.json` は CLI 互換の入力として併置する。
- VibePro CLI が使えないのは本サンドボックス内のみであり、一般に CLI が利用不能という訳ではない（記録・spec write はいずれも orchestrator が実環境で実行する）。
- 実シンボル名は brainbase-unson `mcp/brainbase/src/` の読み取り専用コピーで確認済み（`buildIndex` 他）。読み取り専用コピー path は committed docs から参照しない。公開 subpath 名 `./entity-indexer`・export/files 変更・テスト名は本書のとおり固定。
