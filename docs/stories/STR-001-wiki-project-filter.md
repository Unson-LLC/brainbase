---
story_id: STR-001
title: Wiki検索結果にページのproject_idフィルタを追加
source_requirement:
  nocodb_table: 要求管理
  requirement_id: BFD-001
  requirement_title: Wiki検索結果にページのproject_idフィルタを追加
architecture_docs: []
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: []
status: draft
created_at: 2026-03-22
updated_at: 2026-03-22
---

# STR-001: Wiki検索結果にページのproject_idフィルタを追加

## 背景

brainbaseのWiki（`wiki_pages`テーブル）には複数プロジェクトのナレッジが格納されている。現在の`search_wiki` MCPツールは全プロジェクト横断で検索するため、特定プロジェクトに関連するページだけを探したいときにノイズが多くなる。

## 現状

- `search_wiki`は`query`パラメータのみを受け付ける
- 検索結果は全プロジェクトのページが混在して返される
- ユーザーは結果を目視で該当プロジェクトのものか判断している
- `wiki_pages`テーブルには`project_id`カラムが既に存在する

## 変更内容

### 誰が

- brainbaseを利用する開発者・AIエージェント

### 何を

- `search_wiki` MCPツールにオプショナルな`project_id`パラメータを追加
- `project_id`が指定された場合、そのプロジェクトに属するページのみに絞り込んで検索結果を返す
- `project_id`が未指定の場合、現状通り全プロジェクト横断で検索（後方互換性を維持）

### なぜ

- プロジェクト固有のナレッジを素早く見つけられることで、コンテキスト切り替えコストが削減される
- AIエージェントが適切なスコープで情報取得できるようになり、回答精度が向上する

## 受け入れ基準

- [ ] `search_wiki(query: "xxx", project_id: "brainbase")` で brainbase プロジェクトのページのみが返される
- [ ] `search_wiki(query: "xxx")` の既存動作が変わらない（後方互換）
- [ ] MCPツール定義にproject_idパラメータが追加されている
- [ ] 存在しないproject_idを指定した場合、空の結果が返される（エラーにならない）

## スコープ外

- project_idの一覧取得機能（既存の`list_entities`で対応可能）
- 複数project_idの同時指定（将来のストーリーで検討）
- UIからのプロジェクトフィルタ（今回はMCPツールのみ）

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・現状・変更内容・受け入れ基準のみ。
