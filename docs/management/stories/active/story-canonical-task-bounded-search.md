---
story_id: story-canonical-task-bounded-search
title: Canonical Taskの境界付き検索API
status: active
created_at: 2026-08-12
updated_at: 2026-08-12
architecture_docs:
  - path: docs/architecture/story-canonical-task-bounded-search.md
    status: accepted
---

# Canonical Taskの境界付き検索API

## 背景

Canonical Taskの一覧APIは最大50件のページを返すが、会話側が後続カーソルを扱えない場合、部分結果を全件確認済みとして不在を断定できる。全ページ取得は件数に比例して遅くなるため、検索目的の恒久対応にはしない。

## User story

Canonical Taskを利用するクライアントとして、タイトルと業務スコープを指定した一回の検索で、データベースが評価した境界付き候補を受け取りたい。これにより、全ページを取得せずに対象タスクを発見でき、結果が続く場合だけカーソルで継続できる。

## 受け入れ基準

- [x] `GET /api/companion/tasks/search` は必須の `query` と、status、priority、project_code、assignee_person_id、cursor、limitを受け付ける。
- [x] `query` はNFKC正規化して空白で分割し、タイトルが全トークンを含むタスクだけをサーバー側で検索する。
- [x] limitは既定20件・最大20件とし、全ページ取得や正確な全件数の計算を行わない。
- [x] 並び順は `created_at DESC, id DESC`、継続は不透明なキーセットカーソルで行う。
- [x] タイトル検索は `pg_trgm` のGINインデックスを利用でき、プロジェクト・担当者・状態などの既存絞り込みを同じSQLへ適用する。
- [x] 応答は `next_cursor` と `has_more` を返し、`total_count` は未計算であることを明示する。
- [x] query欠落、上限超過、不正カーソルは422、検索非対応またはストア障害は503として失敗を隠さない。
- [x] 既存の認証、Canonical Task正本、owner境界、一覧・作成・更新APIの互換性を維持する。
- [x] repository、service、route、schema migration contractのテストが通る。

## スコープ外

- 全タスクの一括取得
- ベクトル検索、曖昧ランキング、説明本文の検索
- 既存一覧APIのページング方式変更
- NocoDB旧バックエンドでの検索最適化
