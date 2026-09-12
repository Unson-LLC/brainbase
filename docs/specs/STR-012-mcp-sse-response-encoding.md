---
spec_id: SPEC-STR-012-mcp-sse-response-encoding
title: MCPイベントストリーム応答の転送仕様
status: active
date: 2026-09-09
story_id: STR-012
implementation_files:
  - server/services/multitenant/trusted-provider-forwarder.js
test_files:
  - tests/server/services/multitenant/trusted-provider-forwarder.test.js
---

# Spec: STR-012 MCPイベントストリーム応答の転送

Story: STR-012 / イベントストリーム応答をマナへ返すための最小契約。

## 対象

`brainbase.mcp.post` の許可済み操作における上流HTTP応答の読み取りと、転送結果の `status`、`response_encoding`、`content_type`、`body`。

## 契約（Spec Clauses）

- **SPEC-1 (ac:1)**: `text/event-stream` の上流応答はUTF-8本文として読み取り、イベント区切り・`data:` 行・非ASCII文字を含む本文全体を変更せず `body` に返す。
- **SPEC-2 (ac:2)**: SPEC-1の応答はJSON応答として解釈せず、転送結果の `response_encoding` は `utf8`、`content_type` は上流のContent-Type、`status` は上流のHTTPステータスを保持する。
- **SPEC-3 (ac:3)**: `brainbase.mcp.post` の上流リクエストには `Accept: application/json, text/event-stream` を付け、イベントストリーム応答を受け付ける。
- **SPEC-4 (ac:4)**: `response_encoding: json` を使う既存のJSON応答は、従来どおりJSON値として返す。
- **SPEC-5 (ac:5)**: 応答本文と転送結果にサービス認証情報を含めない既存の秘匿境界を維持する。

## 入力と期待結果

| 上流Content-Type | 操作設定 | 期待する読み取り | 期待する結果 |
|---|---|---|---|
| `text/event-stream` | `response_encoding: utf8` | `response.text()` | SSE本文全体を文字列で返す |
| `application/json` | `response_encoding: json` | `response.json()` | JSON値を返す |

## 非目標

- SSEイベントの内容の検証、再構成、JSON-RPC単位への分割。
- 上流MCPサーバー、認証、テナント認可、テンプレート設定の変更。

## 検証

`tests/server/services/multitenant/trusted-provider-forwarder.test.js` のSSE回帰テストで、JSONパーサーが呼ばれないこと、本文・Content-Type・ステータス・Acceptが契約どおりであることを確認する。
