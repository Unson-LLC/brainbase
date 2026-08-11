---
story_id: story-knowledge-source-resolution-refactor
title: ナレッジ正規ソース解決を安全に再利用可能にする
source_requirement:
  source: Codex conversation 2026-08-07
  approved_at: 2026-08-07
architecture_docs:
  - path: docs/architecture/story-knowledge-source-resolution-refactor.md
    status: accepted
status: active
created_at: 2026-08-07
updated_at: 2026-08-07
---

# ナレッジ正規ソース解決を安全に再利用可能にする

## 背景

ナレッジの正本候補を判定する `knowledge.resolve` は追加済みだが、公開入力に含まれる過去receiptの保存先をそのまま信頼しており、正本の所在を呼び出し側が偽装できる。またMCPの認証・project scope・HTTPエラー変換とtool dispatchが個別実装として増え、次のcapability追加で挙動が分岐しやすい。

## 変更内容

- 正本の保存先はサーバー管理の決定規則だけから返し、呼び出し側が渡したlocationを採用しない。
- audienceとcontent typeの不正な組み合わせをfail closedで拒否する。
- MCPの認証済みAPI呼び出しを共通境界へ集約する。
- MCP tool dispatcherを順序付きregistryにし、既存toolの挙動と優先順位を保つ。

## 受け入れ基準

- [x] `knowledge.resolve` の公開schemaに、呼び出し側がcanonical locationを注入できる入力がない。
- [x] 正常なteam document、canonical fact、source document、personal knowledge、operational stateが従来どおり決定的にrouteされる。
- [x] 不明な種別は「存在しない」ではなく未確認として返る。
- [x] audienceとcontent typeの矛盾は400相当で拒否される。
- [x] JWT不備、project scope逸脱、upstream失敗のMCPエラー契約を維持する。
- [x] dispatcherの順序とlegacy fallbackを維持し、既存MCPテストが通る。

## スコープ外

- receipt永続化基盤の新設
- 実際の文書本文の検索・取得・OCR
- UI変更
- Graph、Drive、repo間のコンテンツ移送
