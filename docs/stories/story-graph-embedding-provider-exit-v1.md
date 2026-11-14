---
story_id: story-graph-embedding-provider-exit-v1
title: Graphの埋め込みの生成（Gemini）をOSSの公開packageの出口に出す
status: in_progress
created_at: 2026-10-09
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# Graphの埋め込みの生成（Gemini）をOSSの公開packageの出口に出す

## 利用者成果

組織版にGraphの意味検索を移す開発者として、埋め込みの生成をunsonのファイルではなく、OSSのnpmの公開版から読みたい。組織版の移設計画は、意味検索を含む `organization-graph-store` を「埋め込みなどのOSSの部品がpackageに出てから移す」としており、この出口がないと移設を始められない。

## 背景

- 所有台帳（brainbase-unson `docs/contracts/repository-ownership.json`）の項目 `graph-embedding-provider` は、移設先がOSS（`brainbase`）で、`migration_pending` のまま。
- OSSの既存の出口 `./embedding-provider` は、OpenAI互換の `/embeddings` を呼ぶ汎用の部品で、問いと文書の区別（Geminiの `taskType`）や、長い文の分割と平均を持たない。本番の索引（`gemini-embedding-001:768:v2`）は、この区別と分割で作られている。
- 本番の索引を作り直さないため、unsonの部品を処理を変えずに移す。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/graph-embedding-provider` から `createGraphEmbeddingProvider`・`GraphEmbeddingProviderError`・`GRAPH_EMBEDDING_MODEL_ID`・`GRAPH_EMBEDDING_DIMENSIONS` を取り込める。
- [x] AC-02: モデルIDは `gemini-embedding-001:768:v2`、次元は768のまま。問いは `RETRIEVAL_QUERY`、文書は `RETRIEVAL_DOCUMENT` で頼み、文書は1,800バイトごとに分けて平均する。保存済みの索引と同じベクトルになる。
- [x] AC-03: unsonの部品のテスト10件（task type、16件ずつの束、UTF-8の分割と平均、入力の検査、HTTP・壊れた応答、ベクトルの正規化、問いの重複の合流とキャッシュ、同時2本と待ち行列の上限、時間切れ、APIキーの必須）を、同じ内容でOSSに置いて通す。
- [x] AC-04: APIキーを渡さない限り何も呼ばない（OSSの既定の動作は外部サービスを必要としない）。
- [ ] AC-05: npmの公開版に入り、unsonの `server/services/graph-embedding-provider.js` がこの出口の再exportになる（unson側の別PR。所有台帳の項目を `canonical` へ更新するのは、本番での読み戻しの後）。

## 範囲外

- 意味検索の本体（`graph-vector-search-service.js`・SQL）を組織版へ移すこと。移設計画の段4で、段1〜3の後に行う。
- 既存の出口 `./embedding-provider` の変更。

## 検証

- `npx vitest run tests/graph-embedding-provider.test.ts tests/graph-core-package-exports.test.ts tests/embedding-provider.test.ts`
- `npm run build`（strictの型検査）
