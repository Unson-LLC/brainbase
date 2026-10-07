# MCPツール認可フック

## ストーリー

ローカル Brainbase MCP サーバーを組み込むアプリケーションとして、呼び出しごとに
任意の認可フックを設定したい。ホストが各ツール呼び出しの実行可否を判断でき、既定の
local-first サーバー動作を維持するためである。

## スコープ

本ストーリーでは、サーバーファクトリに依存性注入する
`authorizeToolCall` callback を追加する。callback は、要求されたツール名と引数をそのまま、
リクエスト ID、セッションメタデータ、キャンセル情報を含む MCP SDK のリクエストコンテキストと
ともに受け取る。callback はすべての `tools/call` リクエストで、ローカル SSOT の読み込みや
ツール実行より前に await する。既存の boolean callback も利用でき、組み込み側パッケージは
許可済みの理由コードと相関 ID を含む構造化された拒否を返せる。

本ストーリーでは、OSS パッケージに組織メンバー、トークン、テナント、ホスト型認証、資格情報の
発行を追加しない。これらは組織側の組み込みパッケージが担い、callback を提供できる。

## 受け入れ条件

- オプションなしの `createServer()` は、既存の local-first 動作を維持する。
- `createServer({ authorizeToolCall })` は、同じセッションからの繰り返し呼び出しを含め、
  すべての `tools/call` で callback を1回ずつ呼び出す。
- callback は、MCP ツール名、引数オブジェクト（引数が省略された場合は `{}`）、
  `requestId`、任意の `sessionId`、`_meta`、`signal` を含む SDK の `RequestHandlerExtra`
  コンテキストをそのまま受け取る。
- callback はツールへの影響が発生する前に await する。`false` の判定ではローカル SSOT を
  読み込まず、`isError: true` の MCP `CallToolResult` を返す。
- 構造化された拒否や callback の拒否も、ローカル SSOT の読み込みを止める。レスポンスに
  保持できるのは、許可済みの拒否コード（`agent_credential_expired`、
  `agent_credential_revoked`、`agent_tenant_mismatch`、`agent_policy_stale`、
  `agent_scope_denied`、`tenant_mismatch`、`policy_stale`、`scope_denied`）のいずれか1つと、
  長さを制限した安全な相関 ID だけとする。
- 不明な拒否値や callback の失敗は、callback のメッセージ、トークン、その他の拒否値を
  外部へ出さず、汎用の安全なエラー形式を返す。
- `tools/list` は認可 callback を呼び出さず、許可を意味しない。
- 認可判定をセッション単位またはツール名単位でキャッシュしない。
- 実装とテストは UI なし、local-first とし、ホスト型の組織認証概念を含めない。

## 検証

- `npm run build`
- `npm test -- --run tests/mcp-authorization-hook.test.ts tests/mcp-contract.test.ts`
- `git diff --check`
