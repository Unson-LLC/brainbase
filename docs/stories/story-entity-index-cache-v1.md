---
story_id: story-entity-index-cache-v1
title: エンティティ索引を呼び出しごとに作り直さず、TTL・無効化・リビジョンで再利用できる
status: in_progress
created_at: 2026-10-26
implementation_started: true
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: []
---

# エンティティ索引を呼び出しごとに作り直さず、TTL・無効化・リビジョンで再利用できる

ホストは今、`search` / `list_entities` / `get_entity` / `resolve_entity` の呼び出しのたびに全 type を limit=500 で一括取得し、エンティティ索引をその場で作り直している。これをやめ、OSS パッケージ側に再利用可能でホスト非依存な索引キャッシュを用意する（RQ-024）。

## 完成時の利用者成果

ホスト実装者が `createEntityIndexCache` を利用すると、索引の再構築は「初回」「TTL 経過後」「明示的な無効化後」「リビジョン変更後」に限られる。TTL 内の呼び出しは同じ索引を返し、書き込み直後にも古い索引が返らない。キャッシュは単一所有者のローカルな判断基盤に閉じており、組織・テナント・メンバー・ロール・承認・監査の概念を持たない。ホストの差し替えは別 PR で行い、本 Story では OSS 側の部品のみを提供する。

## 受入条件

- [ ] AC-01: `createEntityIndexCache({ build, ttlMs })` は `get` / `invalidate` / `peek` / `stats` を返す。`build` は必須関数、`ttlMs` は正の有限数で、不正値は生成時に throw する。
- [ ] AC-02: 初回 `get` は `build` をちょうど1回呼ぶ。同時に来た複数の `get` は同じ `Promise` を共有し、`build` は1回だけ呼ばれる。
- [ ] AC-03: TTL 内の `get` は `build` を呼ばず同じ索引を返し、`hits` を数える。TTL を過ぎた後の `get` は取り直し、古い値を返さない（stale-while-revalidate はしない）。
- [ ] AC-04: `invalidate()` 後の `get` は必ず取り直す。`build` 実行中に `invalidate` された場合、その結果は「invalidate 前に始まった」ため公開せず、`get` は改めて `build` した結果を返す（世代番号で判定）。
- [ ] AC-05: `revision` を渡すと、値が前回 build 時と変わったら取り直し、同じなら取り直さない。`revision` 自体が失敗したら古い索引を返さず取り直しを試みる（fail closed）。
- [ ] AC-06: `build` が失敗したら失敗を `get` の呼び出し側へ投げ、キャッシュは更新せず、前の値も無効扱いにして次の `get` で再試行する。部分的な索引を公開しない。
- [ ] AC-07: `package.json` の `exports` に `./entity-index-cache` が存在し、`dist/entity-index-cache.d.ts` / `dist/entity-index-cache.js` を指す。`dist` 全体は `files` に含まれており、`version` は変更しない。
- [ ] AC-08: `tests/entity-index-cache.test.ts` と `tests/stage3-oss-package-exports.test.ts` が `npx tsc --noEmit -p tsconfig.json` および `npx vitest run` を通過する。

## 範囲と境界

対象は OSS パッケージに追加する `src/entity-index-cache.ts`、その export 宣言、テスト、Story 文書のみ。キャッシュは「索引を丸ごと作る `build`」と「変更を検知する任意の `revision`」を呼び出し側が注入するため、具体的な type 一覧・limit=500 の取得・保存先・認可範囲は知らない。

組織、テナント、メンバー、ロール、承認者、監査、プロバイダの概念をコードや文面に追加しない。ホスト（brainbase-unson の mcp/brainbase）側で `search` / `list_entities` / `get_entity` / `resolve_entity` をこのキャッシュへ差し替える作業は本 Story の範囲外とし、別 PR で行う。

## 実装・検証方針

`createEntityIndexCache` は単一のメモリ上のエントリ（`value` / `builtAt` / `revision`）を持つ。`get` は「エントリなし・TTL 経過・リビジョン不一致・無効化済み」のいずれかで `build` を取り直すループにし、`build` の単一飛行（single-flight）と世代番号で「invalidate 前に始まった build」の結果を破棄する。`revision` の失敗は fail closed として扱い、`build` の失敗は前の値を消して再試行に委ねる。検証は vitest と `tsc --noEmit` で行い、`dist` を読む export テストの前に `npm run build` を実行する。

## タスク

- [x] `src/entity-index-cache.ts` を追加（`createEntityIndexCache`、single-flight、世代番号による invalidate 判定、revision の fail closed、build 失敗時の前値破棄）。
- [x] `package.json` の `exports` に `./entity-index-cache` を追加（version は変更しない）。
- [x] `tests/entity-index-cache.test.ts` を追加（AC-01..AC-06 の必須ケース）。
- [x] `tests/stage3-oss-package-exports.test.ts` に `./entity-index-cache` の export 検査を追加。
- [x] `docs/stories/story-entity-index-cache-v1.md` を追加（本 Story）。
- [ ] `npx tsc --noEmit -p tsconfig.json` を通過させる。
- [ ] `npx vitest run tests/entity-index-cache.test.ts tests/stage3-oss-package-exports.test.ts` を通過させる（先に `npm run build`）。
- [ ] ホスト側（brainbase-unson の mcp/brainbase）で `search` / `list_entities` / `get_entity` / `resolve_entity` を本キャッシュへ差し替える（別 PR、未完）。
