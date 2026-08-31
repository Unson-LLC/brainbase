---
story_id: story-brainbase-knowledge-event-mcp-csrf
title: Brainbase Knowledge Event MCP の CSRF 境界
status: active
reason: "既存の認証・組織・プロジェクト境界を維持したまま、MCPの機械間POSTだけをCSRFの正確な許可リストへ追加する局所修正。"
spec_docs:
  - docs/specs/story-brainbase-knowledge-event-mcp-csrf-spec.md
created_at: 2026-08-31
updated_at: 2026-08-31
---

# Brainbase Knowledge Event MCP の CSRF 境界

## User Story

VibeProのMCPクライアントとして、検証済みの学習候補をBrainbaseのKnowledge Eventへ記録したい。そうすれば、ブラウザCSRFセッションを持たない機械間呼出しでも、既存の認証・組織・プロジェクト境界を通過して候補記録を完了できる。

## 背景

`POST /api/knowledge/events` はBearer認証とscope検証を持つ機械間エンドポイントだが、グローバルCSRFミドルウェアに正確な例外がなく、認証・scope検証へ到達する前に本番403となっていた。

## Delivery Boundary

CSRFミドルウェアで、`POST`かつ完全一致する`/api/knowledge/events`かつ空でないBearer値だけを許可する。ルートの認証、organization、project検証、Knowledge Event契約、昇格ポリシーは変更しない。

## 受け入れ基準

- [ ] AC-001: 完全一致する`POST /api/knowledge/events`は、空でないBearer値でCSRFミドルウェアを通過する。
- [ ] AC-002: Authorization欠落、空値、Bearerトークン欠落、形式不正の値はCSRFで保護される。
- [ ] AC-003: 隣接するメソッド・パスはBearer値があってもCSRFで保護される。
- [ ] AC-004: Knowledge Eventのルート・MCPツール契約テストとCSRF境界テストが通り、差分に空白エラーがない。

## 非目標

認証・organization/project scope、イベントschema、永続化、idempotency、Graph昇格、外部実行権限、デプロイは変更しない。
