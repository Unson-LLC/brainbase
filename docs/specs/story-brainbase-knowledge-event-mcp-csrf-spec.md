# Brainbase Knowledge Event MCP CSRF 境界仕様

## 対象

グローバルCSRFミドルウェアの`POST /api/knowledge/events`への機械間呼出し許可を定義する。対象はVibePro MCPが生成した`knowledge_event.v1`をBrainbaseへ記録する入口だけである。

## 契約

次のすべてを満たす要求だけ、CSRF検証をスキップして後続の認証・認可へ進める。

- HTTPメソッドが`POST`
- `req.path`が`/api/knowledge/events`と完全一致する
- `Authorization`が文字列で、`^Bearer \S+$`に一致する

Authorizationが欠落、空、`Bearer`だけ、Bearer後が空白、Bearer以外、または空白を含む形式不正の場合は通過させない。別メソッド、別パス、近似パスも通過させない。

## 後続境界

CSRF例外は認証を代替しない。Knowledge Eventルートは従来どおりBearer認証、organization境界、`project_code`のproject scopeを検証する。イベントのidempotency、audit、outbox/retry、候補からGraphへの昇格条件も変更しない。

## 検証

- `tests/unit/csrf-knowledge-event-ingest-exempt.test.js`で許可条件と負の境界を検証する。
- `tests/server/routes/knowledge-event-routes.test.js`で既存のルート認証・organization・project契約を検証する。
- `mcp/brainbase/tests/tools/knowledge-event-tools.test.ts`でMCPツールの認証済みproject scope契約を検証する。
