# RQ-113 全件索引と GraphAPISource の @unson/brainbase-mcp 移設（調査・判断記録）

- 状態: **停止（develop では着手不可）**
- 台帳要件: RQ-113『全件索引と GraphAPISource を @unson/brainbase-mcp へ移す（RQ-024 の例外修正の片付け）』
- 対象ブランチ: `queue/dvco6IIo-r2`（起点 `origin/develop` = `e6ef499f`）
- 根拠: Director 2026-10-27 09:10 JST の依頼 / 佐藤さん 2026-10-26 19:14・2026-10-27 01:08 JST（Director 経由）。キュー投入の承認: 佐藤さん 2026-10-30 01:07/01:08 JST。
- 参照元（読み取り専用の写し。main 2fb56892 時点）: `brainbase-unson/mcp/brainbase/src`

## 1. 要件が求める移設対象

brainbase-unson 側の次を @unson/brainbase-mcp へ移す:

1. 全件索引（`indexer/index.ts` の `buildIndex` / `EntityIndex` と `indexer/types.ts` / `indexer/ontology.ts`、解決器 `resolveEntities` / `searchEntities` ほか）。
2. GraphAPISource（`sources/graphapi-source.ts`、1061 行。EntitySource 実装）と `sources/entity-source.ts`（EntitySource インターフェース）。
3. 索引の使い回し（`server.ts` の `refreshEntityIndex`。TTL・generation・single-flight による再利用）。

受入条件は「3 点が @unson/brainbase-mcp にあり、brainbase-unson は**新しい版を参照する設定の変更だけ**で済む」。

## 2. 依存関係の調査結果（develop 時点）

参照元の import を追うと、移設対象は次に依存する。

- `indexer/types.ts` → `../retrieval/evidence.js`（`RetrievalEvidence`）
- `indexer/index.ts` → `./types.js`・`./ontology.js`・`../sources/entity-source.js`
- `sources/graphapi-source.ts` → `../retrieval/evidence.js`（`extractEvidence`, `hasSubstantiveValue`）・`../host-auth/request-token-context.js`（`TokenProvider`）・`../host-auth/token-manager.js`（`TokenRequestOptions`）・`../indexer/index.js`（`isActiveLifecycle`）・`../indexer/types.js`
- `server.ts` の `refreshEntityIndex` → `buildIndex` と、RQ-024 相当の索引状態（TTL/generation/refreshPromise）

develop 側の実在を確認した結果:

| 必要なもの | develop(`e6ef499f`) での有無 |
| --- | --- |
| RQ-024 索引キャッシュ `src/entity-index-cache.ts`（PR #877 / `feat/rq-024-entity-index-cache`） | **無し**（`origin/main` にはあるが develop の先祖ではない） |
| `src/retrieval/`（`retrieval/evidence.ts`） | **無し** |
| `src/host-auth/`（`token-manager`, `request-token-context`） | **無し** |
| 既存の entity 解決器 `src/entity-resolution.ts` | 有り（ただし別モデル。§4 参照） |

`git merge-base --is-ancestor 0640e93e origin/develop` は偽（PR #877 は develop に未統合）。

## 3. 停止の理由（develop ではこのまま完了できない）

1. **前提 RQ-024 が develop に無い。** 「索引の使い回し」は RQ-024 の `createEntityIndexCache`（単発ビルド・TTL・invalidation・revision）に合わせる前提。だが PR #877 は `origin/main` のみで develop には入っていない。タスクの決まりは「重ねず、それを使う・合わせる」。develop では使えず、かつ重複追加は禁止のため、ここでは実装できない。
2. **依存モジュールが develop に無い。** `retrieval/evidence` と `host-auth/*` が develop に存在しない。これらを import する `graphapi-source.ts` / `indexer/*` をそのまま置くと型チェック・ビルドが即失敗する（前回の rc=1 の最有力原因、§6）。
3. **OSS 境界と認証制約に反する。** GraphAPISource は Graph SSOT API への**認証付きリモート HTTP クライアント**で、`host-auth` のトークン機構を伴う。これを local-first・単一所有者の OSS（`CLAUDE.md`: 「Do not require hosted services」）へ入れると製品境界に反する。タスクも鍵・資格情報・認証に触れないこと、必要になったら止めることを求めている。
4. **既存設計との衝突（§4）。** OSS には既に別モデルの解決器がある。旧 indexer を丸ごと持ち込むと二重化し、「RQ-024 に合わせる」どころか正本が分裂する。

これらは単独でも停止に当たり、タスクの停止条件「作業が仕様上ここでは完了できない（依存がまだ無い等）／認証・資格情報が要る」に該当する。

## 4. 既存 OSS 設計との不一致

develop の `src/entity-resolution.ts` は、呼び出し側が渡す `GraphFileV2` スナップショット（`source.authority = 'local_graph'`、ネットワーク非依存、`resolveText` + 検証可能レシート）を入力とする**新しい正本モデル**。一方 brainbase-unson の `indexer` は型別 `Map` の `EntityIndex` を HTTP 取得の `EntitySource`（= GraphAPISource）から構築する**旧モデル**。両者はデータ取得と境界が根本的に異なる。移設は単純コピーでは済まず、OSS 正本モデルへの対応付け（設計判断）が要る。

## 5. 先に進めるために必要なもの（未実施。人の判断が要る）

- A. RQ-024（PR #877）を develop に取り込む（または RQ-113 の base を main 系に変える）。索引の使い回しはこれが前提。
- B. `retrieval/evidence` を OSS へ移す/用意する（types と graphapi-source の共通依存）。
- C. GraphAPISource の扱いの決定: (a) OSS 境界を保つため認証リモート取得は brainbase-unson 側に残し、OSS へはソース非依存の全件索引コア（`EntitySource` インターフェース＋`buildIndex`＋types＋ontology）だけを出す、か、(b) `host-auth` も含め OSS へ移し OSS を認証リモート前提に広げるか。(b) は `CLAUDE.md` の local-first 境界と要調整。**佐藤さんの判断対象。**
- D. 旧 indexer モデルと既存 `entity-resolution.ts`（canonical graph モデル）の統合方針。二重の entity 正本を作らないこと。
- E. 上記確定後に、公開 API（`package.json` の `exports`・`src/index.ts`）への最小追加と、brainbase-unson 側で要る変更（理想は版の参照変更だけ。現状は import パス書き換えも要り「設定変更だけ」は満たせない）。

いずれも DB migration/schema/GRANT は不要。ただし C(b) を採ると認証・ホスト前提が OSS に入るため、別途承認が要る。

## 6. 前回失敗（rc=1）の推定原因

前回ログは別環境で読めない。推定: 移設ファイル（`graphapi-source.ts` か `indexer/*`）を develop に置いた／それを import するテストを足したところ、develop に無い `retrieval/evidence`・`host-auth/*`・RQ-024 キャッシュへの参照が解決できず、型チェックまたはテスト収集で失敗した可能性が高い。あるいは `npm ci` 実行や全体 `vitest run` で半端移設分が落ちた可能性。今回は依存不足を先に確認し、無理な移設を行わず停止した。
