---
story_id: story-rq-113-entity-full-index-oss
title: 索引ビルダ（entity index builder）を OSS @unson/brainbase-mcp に入れ、ソース非依存で再利用できる
status: draft
created_at: 2026-10-30
implementation_started: false
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on:
  - story-entity-index-cache-v1
---

# 索引ビルダ（entity index builder）を OSS @unson/brainbase-mcp に入れ、ソース非依存で再利用できる

ホスト（brainbase-unson の mcp/brainbase）は今、全エンティティを取得して `search` / `list_entities` / `get_entity` / `resolve_entity` が使う索引をホスト内（`indexer/`）で組み立てている。この索引の **組み立て部分（builder）** は、どの取得元（`EntitySource`）から来るかに依存しない再利用可能な部品であり、OSS パッケージ側に置ける。RQ-113 は、この builder を **brainbase main を土台に** OSS `@unson/brainbase-mcp` へ移し、ソース非依存の `EntitySource` インターフェースとともに npm 公開できる形にする（A案、Director/Worker リレー 2026-10-30 12:30 JST、Director 承認 18:06 JST「RQ-113 の npm 公開を進めて」）。

実モジュール `indexer/index.ts` は builder だけでなく legacy の解決・検索・文脈ロジック（`resolveEntities` / `searchEntities` / `getContextForTopic` ほか）を同居させている。本 Story は **builder とそれに必要なライフサイクル／別名ヘルパ・オントロジー登録表・エンティティ型のみ** を抽出し、legacy クエリ層は unson に残す。認証付きリモート Graph API クライアント `GraphAPISource`（host 認証 / `TokenProvider` 依存）も **unson に残す**。OSS 側は取得元を知らず `EntitySource` を注入される。

## 完成時の利用者成果

ホスト実装者が OSS の `./entity-indexer` を利用すると、自分の `EntitySource` 実装（ローカルでも、Unson の `GraphAPISource` のような認証付きでも）を注入するだけで、11 のコア収集と登録拡張を索引した `EntityIndex` を `buildIndex(source)` で得られる。再利用可能な取得元では RQ-024 の `createEntityIndexCache` に `build` として渡せる（二重キャッシュを作らない）。現ホストの Graph API は安価な collection revision を持たないため、既定は refresh ごとの直接 build、または reject する `revision()` による保存なしの再構築とする（Spec C-4）。索引は単一所有者のローカルな判断基盤に閉じ、組織・テナント・メンバー・ロール・承認・監査・プロバイダ設置の概念を持たない。OSS には Unson 固有の URL・テナント・秘密・host 認証・`GraphAPISource`・legacy クエリ層を一切持ち込まない。

ホスト（unson）側の依存版 bump と import 差し替え・ローカル実装の整理は **本 Story の範囲外**（別 PR の host コード変更）であり、ここでは説明のみ行う。npm 公開自体も本 Draft PR の確認後に Maintainer が別途行う。

## 受入条件

- [ ] AC-01: `buildIndex(source)` は注入された `EntitySource` だけから `source.initialize()` を 1 回呼び、11 のコア getter を並行に読んで全レコードを索引する。builder 側の件数打ち切りは無く（同一 type に 500 件超があっても全件保持）、network・認証・テナントを一切要求しない。
  - 証明: `tests/entity-indexer.test.ts` :: "initializes once and indexes all eleven core collections without truncation or network access"
- [ ] AC-02: builder は `EntitySource` が登録した拡張 type を索引し、source が登録を返さないときはオントロジーの既定拡張登録表（`getExtensionRegistrations()`）にフォールバックする。
  - 証明: `tests/entity-indexer.test.ts` :: "indexes registered extensions and falls back to default registrations when empty"
- [ ] AC-03: `source.initialize()` または任意のコア/拡張 getter が reject したとき、`buildIndex` は reject し、索引（部分索引を含む）を一切返さない。
  - 証明: `tests/entity-indexer.test.ts` :: "rejects initialization and getter failures without returning an index"
- [ ] AC-04: builder は fail-loud 最小検証を行う。getter が配列でない値を返す／コア・拡張エンティティの `id` が欠落・空／同一 type 内でアクティブ（非置換）レコードが同じ `id` に衝突、のいずれでも throw し、暗黙上書きや部分索引を公開しない。
  - 証明: `tests/entity-indexer.test.ts` :: "rejects non-array collections, empty ids, and duplicate ids within a type"
- [ ] AC-05: 置換レコード（superseded/merged/retired）はアクティブな canonical レコードを上書きせず、`replacedIdToCanonicalId` 経由で到達可能に保たれる。非アクティブな person は別名マップから除外される。
  - 証明: `tests/entity-indexer.test.ts` :: "preserves canonical replacement pointers and excludes inactive-person aliases"
- [ ] AC-06: `buildIndex` は無改変で `createEntityIndexCache({ build: () => buildIndex(source) })` の `build` として機能し、再構築ごとに `source.initialize()` が再実行される。builder 自身は第二のキャッシュ / TTL / 世代ロジックを持たない。
  - 証明: `tests/entity-indexer.test.ts` :: "drives createEntityIndexCache as its build without adding a second cache"
- [ ] AC-07: `./entity-indexer` は builder・ライフサイクルヘルパ・オントロジー登録表・`EntitySource`・エンティティ型・構造型 `RetrievalEvidence` を公開し、OSS `entity-resolution` を import せず、legacy クエリ（`resolveEntities` / `searchEntities` / `getContextForTopic` / `tokenizeEntityQuery` / `containsFirstPersonReference` / 個人名等価語）を含まない。`BaseEntity` に `organization_id` / `tenant_id` は無い。
  - 証明: `tests/entity-indexer.test.ts` :: "exports only the builder surface and omits legacy resolver, search, context, and tenant metadata"（静的 import/シンボル検査＋レビュー併用）
- [ ] AC-08: `exports["./entity-indexer"]` が `dist/entity-indexer.d.ts` / `.js` を指し `version` 不変。packed tarball / 隔離 consumer が stub `EntitySource` で宣言クロージャを満たし、宣言に `retrieval/evidence.js`・host 認証・`src/`・`tests/`・参照コピー path を含まない。
  - 証明: `tests/stage3-oss-package-exports.test.ts` :: "publishes the entity indexer as an independent subpath with a self-contained declaration closure"

回帰ゲート（新規 AC ではないが緑を維持）: `npm run build`、`npx tsc --noEmit -p tsconfig.json`、`tests/npm-release.test.ts`、`tests/graph-core-package-exports.test.ts`、`npm run docs:check`、`npm pack --dry-run`。

## 範囲と境界

対象は OSS に追加する `src/entity-indexer.ts`（builder `buildIndex`/`createEmptyIndex`＋ライフサイクル/別名ヘルパ＋オントロジー登録表＋`EntitySource`＋エンティティ型＋構造型 `RetrievalEvidence`）、その `exports` 宣言、テスト、本 Story・Spec・判断文書のみ。移さないもの: `GraphAPISource`、host 認証 / `TokenProvider`、legacy クエリ層（`resolveEntities` / `searchEntities` / `getContextForTopic` / accessor 群）、`retrieval/evidence.ts` の関数群（構造型のみ移す）。既存の `entity-resolution.ts` / `graph-retrieval.ts` / `entity-index-cache.ts` / `server.ts` は変更しない。

組織・テナント・メンバー・ロール・承認者・監査・プロバイダの概念をコードや文面に追加しない（`BaseEntity` の `organization_id`/`tenant_id` も OSS からは除外し host-extended 型へ）。Unson 固有の URL・秘密・テナント既定値を持ち込まない。ホスト（unson）側の依存版 bump と import 差し替え・ローカル実装の整理は本 Story の範囲外（別 PR の host コード変更）として説明のみ行う。

## retrieval/evidence の扱い（Director 決定・案b）

2026-10-30 22:02 JST の Director 判断（可逆）で案b を採用。構造型 `RetrievalEvidence` は OSS に置き、関数 `extractEvidence` / `hasSubstantiveValue` / `bodyEvidenceFields` と定数 `BODY_EVIDENCE_FIELDS` は brainbase-unson に残す。公開 subpath は `./entity-indexer` のみ、実装は 1 ファイル、`LocalEntitySource` は同梱しない。詳細は判断文書に記す。

Unson follow-up は別 PR。依存版 bump / import 差し替え前に staging の実 `GraphAPISource` 出力を fail-loud 検証に通し、拒否レコード件数を報告する（前提条件・本 PR では未実施）。revision 契約とキャッシュしない安全な既定は Spec C-4 に従う。

## 実装・検証方針

`src/entity-indexer.ts` は brainbase-unson `mcp/brainbase/src/{indexer/index.ts, indexer/types.ts, indexer/ontology.ts, sources/entity-source.ts}` から builder サブセットを 1 ファイルに抽出する。`populateCurrentEntities` / `buildPersonAliases` / `buildOrgAliases` / `buildBrandAliases` / `populateExtensionEntities` は module-private のまま。fail-loud 最小検証（非配列/空id/重複id）を加える。再利用は RQ-024 の `createEntityIndexCache` に委ね二重キャッシュを作らない。検証は vitest と `tsc --noEmit`、`dist` を読む export テストの前に `npm run build` を実行する。

## タスク

- [ ] `src/entity-indexer.ts` を追加（`buildIndex`、`createEmptyIndex`、`isActiveLifecycle` / `isActiveCanonicalPerson` / `isReplacedLifecycle`、オントロジー登録表、`EntitySource`、エンティティ型、構造型 `RetrievalEvidence`）。legacy クエリ層・`GraphAPISource`・host 認証・tenant フィールドを含めない。
- [ ] fail-loud 最小検証（非配列 collection / 空 id / 同一 type 内アクティブ重複 id）を `buildIndex` に加える。
- [ ] `package.json` の `exports` に `./entity-indexer` を追加（`version` は変更しない）。
- [ ] `tests/entity-indexer.test.ts` を追加（AC-01..AC-07）。
- [ ] `tests/stage3-oss-package-exports.test.ts` に `./entity-indexer` の宣言クロージャ検査を追加（AC-08）。
- [ ] `docs/stories/...` / Spec / 判断文書・`draft.json` を更新。
- [ ] `npm run build` → `npx tsc --noEmit -p tsconfig.json` → 回帰ゲート（`npm-release` / `stage3-oss-package-exports` / `graph-core-package-exports` / `docs:check` / `npm pack --dry-run`）を通過させる。
- [ ] （範囲外・別 PR の host コード変更）ホスト unson 側で依存版 bump と import 差し替え・ローカル実装の整理。
