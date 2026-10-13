---
story_id: story-graph-entities-list-timeout
title: GET /api/info/graph/entities が4秒で500にならない
status: active
period: 2026-10
contract_type: bug_fix
requirement_record: 8b43e8b4-7cd7-4c77-94bb-9cf6336c1391
business_metric: /api/info/graph/entities のHTTP 500を止め、一覧が既定50件のキーセットで返る
created_at: 2026-10-13
updated_at: 2026-10-13
---

# GET /api/info/graph/entities が4秒で500にならない

## 背景

bb.unson.jp の `GET /api/info/graph/entities` はゲートウェイの4秒でHTTP 500になる。計測済みのクエリは約2.5秒で、そのうち約1.2秒がJITである。EXPLAIN ANALYZE では RLS 関数 `app_foundation_row_visible` が `SET search_path` のためインライン化されず、行見積もりが52、実測が6,702だった。

## 誰が・何を・なぜ

Graphを開く利用者は、見えるエンティティの最初のページをタイムアウトせず受け取りたい。権限の見えない行は引き続き返さない。

## 受け入れ基準

- [ ] アクセスコンテキストはトランザクション内で `set_config('jit','off',true)` を設定する。
- [ ] `public.app_foundation_row_visible` は `SET search_path` を持たず、本体内の名前は `public.` で修飾する。`LEAKPROOF` は使わない。
- [ ] RLS関数に `COST 1` を付ける。集合を返さない関数では行数ヒントを付けない。
- [ ] 可視条件は RLS ポリシー `info_graph_entities_select` の一箇所に置く。アプリSQLは繰り返さない。`public.app_foundation_row_visible` はロールとクリアランスのスカラー判定だけを持ち、サブクエリを含まない。
- [ ] 一覧は `updated_at DESC, id DESC` のキーセットで、既定件数は50、応答に次カーソルを含む。
- [ ] `graph_entities (updated_at DESC)` と `member_of` / `active` に限定した `graph_edges (from_id)` の索引は `CONCURRENTLY` で、トランザクション外のマイグレーションとして作る。
- [ ] デプロイ手順は `ANALYZE public.graph_entities` と `ANALYZE public.graph_edges` を実行する。
- [ ] ページングとアクセスコンテキストのテストがある。

## スコープ外

- brainbase-unson の変更、本番への適用、マージ。
- `LEAKPROOF` によるインライン化。
- VibePro の `reconcile`。
