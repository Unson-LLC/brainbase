---
adr_id: ADR-001
title: Wiki検索のproject_idフィルタは既存アーキテクチャで対応可能
story_id: STR-001
status: proposed
created_at: 2026-03-22
updated_at: 2026-03-22
---

# ADR-001: Wiki検索のproject_idフィルタは既存アーキテクチャで対応可能

## ステータス

Proposed

## コンテキスト

STR-001「Wiki検索結果にページのproject_idフィルタを追加」を実現するにあたり、既存のアーキテクチャで対応可能か、新しいアーキテクチャパターンが必要かを判断する。

## 判定: 既存アーキテクチャで対応可能

新しいADRは不要。以下の理由により、既存のレイヤー構成・データフロー・SSOTをそのまま活用できる。

### 根拠

1. **DB層**: `wiki_pages`テーブルに`project_id`カラムが既に存在し、`projects(id)`への外部キーとインデックス(`idx_wiki_pages_project_id`)も設定済み

2. **API層**: `/api/wiki/pages`エンドポイントは既に`project_id`をレスポンスに含めて返却している

3. **MCP層**: `search_wiki`ハンドラーは全ページ取得後にクライアントサイドでフィルタリングしている。`project_id`パラメータの追加は、既存のフィルタロジックに1条件追加するだけ

4. **既存パターンとの整合**: Service Layer Pattern（§1.4）に沿ったデータフロー（MCP → API → DB）を変更する必要がない

### 変更箇所の特定

| レイヤー | ファイル | 変更内容 |
|---------|---------|---------|
| MCP定義 | `mcp/brainbase/src/server.ts` | `inputSchema`に`project_id`プロパティ追加 |
| MCPハンドラー | `mcp/brainbase/src/server.ts` | フィルタ条件に`project_id`一致チェック追加 |
| DB | なし | 変更不要（カラム・インデックス既存） |
| API | なし | 変更不要（レスポンスに`project_id`含む） |

### SSOTの所在

| データ | SSOT |
|--------|------|
| Wikiページ | PostgreSQL `wiki_pages`テーブル |
| プロジェクト定義 | PostgreSQL `projects`テーブル |
| MCP定義 | `mcp/brainbase/src/server.ts` |

## 影響範囲

- 既存の`search_wiki(query: "xxx")`呼び出しは一切影響を受けない（後方互換）
- 新しいパラメータはオプショナルのため、既存のクライアントコードの修正は不要

## 結論

MCPツール定義に1パラメータ追加 + ハンドラーに1フィルタ条件追加のみで実現可能。アーキテクチャパターンの変更・新規ライブラリ導入・インフラ変更は一切不要。

---

**ガードレール**: このファイルにはAPI仕様・DBスキーマ詳細・実装コードを書かない。レイヤー/境界/データ層/SSOTの所在のみ。
