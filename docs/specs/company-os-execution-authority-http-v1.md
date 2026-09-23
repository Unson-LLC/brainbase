# Company OS execution authority canonical HTTP adapter v1

この仕様は [story-company-os-execution-authority-http-v1](../stories/story-company-os-execution-authority-http-v1.md) と [company-os-execution-authority-http](../architecture/company-os-execution-authority-http.md) を実装可能な契約へ落とす。既存の [company-os-execution-authority-v1](./company-os-execution-authority-v1.md) のservice契約を変更しない。

## 公開モジュールとhandler

公開サブパスは `@unson/brainbase-mcp/execution-authority-http` とする。OSSはlistenするserverを公開せず、既存のNode HTTP hostがhandlerを合成する。

```ts
type ExecutionAuthorityHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedExecutionAuthorityRequestContext | null,
) => Promise<boolean>;
```

`true`はhandlerが対象pathを処理したこと、`false`は別routeへ委譲できることを表す。contextはhostが認証・tenant解決後に生成する。

```ts
interface TrustedExecutionAuthorityRequestContext {
  tenantId: string;
  principal: string;
  scopeId: string;
  verifiedMutationOrigin?: string;
}

type ExecutionAuthorityServiceFactory = (
  context: TrustedExecutionAuthorityRequestContext,
) => ExecutionAuthorityService | Promise<ExecutionAuthorityService>;

interface ExecutionAuthorityHttpOptions {
  serviceFactory: ExecutionAuthorityServiceFactory;
  basePath?: string; // default: /execution-authority
  bodyLimitBytes?: number;
  verifyMutationRequest?: (input: {
    request: IncomingMessage;
    context: TrustedExecutionAuthorityRequestContext;
  }) => boolean | Promise<boolean>;
}
```

## ルート

| method | path | body | service operation |
|---|---|---|---|
| POST | `/execution-authority/start` | `ExecutionStartInput` | `start` |
| GET | `/execution-authority/intents/{operationId}` | なし | `readIntent` |

base配下の未知pathは404、対象pathの未対応methodは405と`Allow`を返す。`start_external`など外部作用を直接呼ぶrouteは公開しない。operationIdはpath segmentをdecodeしたbounded textとし、bodyやqueryの別主体を認証根拠にしない。

## 本文とtrusted context

start bodyはJSON objectで、次の既知フィールドだけを受け付ける。

`operationId`、`tenantId`、`principal`、`scopeId`、`runId`、`reservationId`、`approvalId`、`authorityRef`、`constraintRefs`、`problem`。`problem`は`problem_snapshot_id`、`problem_id`、`revision`を持ち、snapshot IDは`sha256:`形式である。

bodyの`tenantId`／`tenant_id`／`tenant`、`principal`／`actorId`／`actor_id`／`actor`、`scopeId`／`scope_id`はcontextと一致しなければ400。不一致をcontext値で黙って置換しない。一致した値はcontextへ束縛してserviceへ渡す。`authority`、`authorities`などの未契約権限表現と未知フィールドは400とする。`authorityRef`は実行入力の参照であり、HTTP bodyからauthorityの許可を与えるものではない。

mutationは`context.verifiedMutationOrigin`が非空、または注入された`verifyMutationRequest`がtrueを返した場合だけfactoryへ進む。両方がない、false、例外の場合は403で、factory・sidecar・作用portを呼ばない。GETはCSRF検証を要求しないが、serviceの現在read ACLを必ず通す。

## HTTP結果

成功はJSON objectで、`action`、`operationId`、`result`を含む。startの`result`は既存 `ExecutionStartResult`、readの`result`は`ExecutionIntentRecord`である。

| 状態 | 条件 |
|---:|---|
| 200 | start成功、started再送、read成功 |
| 400 | JSON／body／型／主体不一致／authority表現／service validation |
| 401 | trusted contextなし・不正 |
| 403 | 変更元未検証、read ACL拒否、authority・承認・制約・予約の失効、scope越境 |
| 404 | 未知path、対象intentなし |
| 405 | method不一致 |
| 409 | operation conflict、revision conflict、fencing不備、recovery/unknown状態 |
| 413 | body limit超過 |
| 500 | 未知エラー、ledger invalid |
| 503 | 現在providerのunknown、read providerのunknown |

エラーは`{ "error": { "code": string, "message": string } }`。認証情報やsidecar本文をエラーへコピーしない。

## 検証シナリオ

- 実Node HTTP serverへhandlerを合成し、実 `ExecutionAuthorityService` と実sidecarへstart→readを行う。
- tenant Aのintentをtenant Bのcontextから読めず、Bのcurrent read ACL拒否を成功へ変換しない。
- bodyのtenant／principal／scope不一致、authority、malformed JSON、未検証変更元ではfactoryとsidecarが変化しない。
- 同じoperationId・同じpayloadの再送は保存済み結果を返し、effectを二度呼ばない。
- 現在authorityがrevoked／unknownのとき、予約印・作用を開始せず拒否する。
