---
architecture_id: arch-canonical-task-bounded-search
story_id: story-canonical-task-bounded-search
title: Canonical Task境界付き検索アーキテクチャ
status: accepted
date: 2026-08-12
---

# Canonical Task境界付き検索アーキテクチャ

## 決定

一覧の全ページ走査ではなく、PostgreSQL正本に専用の読み取り専用検索経路を追加する。`query` はNFKC正規化後に空白トークンへ分け、各トークンをエスケープした `title ILIKE` 条件をAND結合する。status、priority、project code、assigneeを同じWHERE句へ入れ、絞り込み後の最大20件だけを返す。

## API契約

```text
GET /api/companion/tasks/search?query=...&status=...&project_code=...&cursor=...&limit=20
```

応答は `items`、`next_cursor`、`has_more`、`count_status: not_requested`、`total_count: null`、`read_status: complete` を返す。0件は「指定した検索条件をデータベースで評価した結果」であり、一覧の先頭ページ0件とは区別される。

## ページング

`ORDER BY created_at DESC, id DESC` で `limit + 1` 件を読み、余分な1件の有無で `has_more` を決める。カーソルは版、最後の `created_at`、`id` をbase64url JSONで符号化し、次回は `(created_at, id) < (...)` を追加する。OFFSETやCOUNTは使わない。

## 索引

スキーマへ `pg_trgm` 拡張と `title gin_trgm_ops` のGINインデックスを追加する。検索索引は各文を独立して `CREATE INDEX CONCURRENTLY` で作成し、稼働中テーブルへの長時間の書き込みロックを避ける。既存のproject_codes GIN、status/priority、assignee/due索引は維持する。スキーマ検査は索引名だけでなく `pg_index.indisvalid` と `indisready` を検査し、並行作成の失敗で名前だけ残った索引を成功扱いしない。

## 失敗境界

入力とカーソルはserviceで検証する。PostgreSQL query失敗は既存の `task_store_unavailable` へ正規化する。検索メソッドを持たない旧バックエンドでは全件取得へフォールバックせず、`task_search_unavailable` を503で返す。

## リリース順序

アプリケーションより先にCanonical Taskスキーマ移行を実行する。workflowのdry-run/checkは既存の基礎スキーマを検査し、applyで拡張と検索索引を追加、final-checkで新しい完全スキーマを検査する。これにより旧本番スキーマでもapply前の検査で停止しない。`pg_trgm` 作成権限または索引作成に失敗した場合は新検索経路を有効にせず、一覧の全ページ走査へはフォールバックしない。final-checkが無効または未readyの索引を検出した場合は、DB運用者が当該索引を明示的に削除してからworkflow全体を再実行する。`IF NOT EXISTS` による再実行だけで回復したと見なさない。

## 変更しないもの

Canonical Taskの正本、opaque task ID、owner認証、mutation、既存 `/tasks` の契約は変更しない。
