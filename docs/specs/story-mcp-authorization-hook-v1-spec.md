# MCPツール認可フック v1 仕様

## ストーリー

`docs/stories/story-mcp-authorization-hook-v1.md`

## 公開契約

```ts
type AuthorizeToolCall = (
  call: {
    name: string;
    arguments: Record<string, unknown>;
  },
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
) => ToolCallAuthorizationDecision | Promise<ToolCallAuthorizationDecision>;

type ToolCallAuthorizationRejectionCode =
  | "agent_credential_expired"
  | "agent_credential_revoked"
  | "agent_tenant_mismatch"
  | "agent_policy_stale"
  | "agent_scope_denied"
  | "tenant_mismatch"
  | "policy_stale"
  | "scope_denied";

type ToolCallAuthorizationDecision =
  | boolean
  | {
      authorized: boolean;
      code?: ToolCallAuthorizationRejectionCode;
      correlationId?: string;
    };

type CreateServerOptions = {
  authorizeToolCall?: AuthorizeToolCall;
};

createServer(options?: CreateServerOptions): Server;
```

`call.name` は MCP の `tools/call` リクエストからそのままコピーする。`call.arguments` は
リクエストの引数オブジェクトとし、MCP の任意フィールドがない場合は新しい空オブジェクトを
使う。`extra` はハンドラへ渡される SDK のリクエストコンテキストである。フックは
`requestId`、`sessionId`、`_meta`、`authInfo`、`signal` を参照できるが、OSS パッケージは
組織のアイデンティティを解釈しない。

フックはリクエストごとに1回実行し、メモ化しない。`tools/list` はフックを通過しない。
フックは `callBrainbaseTool` より前に呼び出すため、拒否や拒否例外がローカル SSOT を
読み込んだりツールを実行したりすることはない。

## 結果とエラーの契約

許可は `true` または `{ authorized: true }` とする。許可された呼び出しは、現在の
テキストのみの `CallToolResult` を維持する。

認可の拒否と失敗では、次の形式を返す。

```json
{
  "isError": true,
  "structuredContent": {
    "error": {
      "code": "tool_call_not_authorized",
      "message": "Tool call was not authorized."
    }
  },
  "content": [
    {
      "type": "text",
      "text": "{\"error\":{\"code\":\"tool_call_not_authorized\",\"message\":\"Tool call was not authorized.\"}}"
    }
  ]
}
```

拒否経路と callback 失敗経路では、意図的に同じ安定した公開メッセージを使う。構造化された
拒否または throw されたオブジェクトが拒否 `code` を保持できるのは、
`ToolCallAuthorizationRejectionCode` の値である場合だけとする。`correlationId` を保持できるのも、
`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` に一致する、長さを制限した表示可能なトークンの場合だけとする。
callback のメッセージ、throw された値、トークン、その他のフィールドをシリアライズ、ログ出力、
MCP クライアントへの返却に使わない。許可リストにある `error.code` を持つ callback の拒否例外は、
同じ許可済みコードと相関 ID の扱いとし、それ以外の失敗は `tool_call_not_authorized` を使う。

安全な拒否は、例えば次のように返せる。

```json
{
  "isError": true,
  "structuredContent": {
    "error": {
      "code": "scope_denied",
      "message": "Tool call was not authorized.",
      "correlationId": "corr-mcp-123"
    }
  }
}
```

## 不変条件

- callback がない場合は認可分岐を実行せず、現在のローカル動作を変更しない。
- 同じセッション内の呼び出しを含め、すべての呼び出しを独立して確認する。
- 認可はツール探索に影響しない。
- フックは組み込み境界だけを担う。組織認証、メンバーシップ、トークン、テナント、資格情報の
  ルールはこのリポジトリの外に置く。

## テストシナリオ

- callback が名前、引数、リクエスト ID、セッション ID、メタデータ、signal を受け取る。
- 非同期の許可でツールを実行でき、繰り返しリクエストでは callback を再度呼び出す。
- 拒否と拒否例外が `isError` の構造化エラーを返し、正本の fixture を読み込まない。
- 許可済みの構造化された拒否理由と throw された拒否理由では、コードと安全な相関 ID だけを保持する。
- 省略された引数が `{}` になる。
- `tools/list` がフックを呼び出さない。
- オプションなしのサーバーが既存の v1 ツールを引き続き一覧表示し、呼び出せる。
