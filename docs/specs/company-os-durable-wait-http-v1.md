# Company OS durable wait canonical HTTP adapter v1

対象Story: [`story-company-os-durable-wait-http-v1`](../stories/story-company-os-durable-wait-http-v1.md)

このSpecは、既存の [`company-os-durable-waits-v1`](./company-os-durable-waits-v1.md) のstore契約を変更せず、Node HTTP hostからMana Workerへ公開する最小のtransport契約を定める。OSSは認証・組織providerを実装せず、handlerと、呼出元が認証済みcontext resolverを注入してlistenできるhost合成関数を提供する。

## 公開モジュールとhandler

公開subpathは `@unson/brainbase-mcp/durable-wait-http` とする。

```ts
type DurableWaitHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedDurableWaitRequestContext | null,
) => Promise<boolean>;

interface TrustedDurableWaitRequestContext {
  readonly tenantId: string;
  readonly principal: string;
  readonly scopeId: string;
  readonly verifiedMutationOrigin?: string;
}

interface DurableWaitHttpOptions {
  readonly storeFactory: (
    context: TrustedDurableWaitRequestContext,
  ) => DurableWaitStore | Promise<DurableWaitStore>;
  readonly basePath?: string; // default: /api/v1/durable-waits
  readonly bodyLimitBytes?: number;
  readonly verifyMutationRequest?: (input: {
    request: IncomingMessage;
    context: TrustedDurableWaitRequestContext;
  }) => boolean | Promise<boolean>;
}

interface DurableWaitHttpHostOptions extends DurableWaitHttpOptions {
  readonly resolveContext: (
    request: IncomingMessage,
  ) => TrustedDurableWaitRequestContext | null | Promise<TrustedDurableWaitRequestContext | null>;
}
```

`true`は対象pathを処理したこと、`false`は別routeへ委譲できることを表す。contextがない、または不正なcontextは401で停止する。handlerはlistenせず、hostが認証済みcontext、store factory、必要ならmutation-origin検証関数を注入する。`createDurableWaitHttpHost` はこのhandlerをNode `Server`へ合成し、callerが `server.listen()` を行う。resolverが例外を投げた場合もcontextなしとして401へ閉じる。

## Canonical routeと入力

既定のbase pathは `/api/v1/durable-waits`。対象pathの未知routeは404、未対応methodは405、本文超過は413とする。

| method | path | store operation |
| --- | --- | --- |
| POST | `/create` | `DurableWaitStore.create` |
| GET | `/:waitId` | `DurableWaitStore.read` |
| POST | `/claim` | `DurableWaitStore.claim` |
| POST | `/resume` | `DurableWaitStore.resume` |
| POST | `/handoff` | `DurableWaitStore.handoff` |
| POST | `/premise-changed` | `DurableWaitStore.markPremiseChanged` |
| POST | `/effect-unknown` | `DurableWaitStore.markEffectUnknown` |

mutation bodyはJSON objectで、操作ごとの既存store inputに加えてtrusted identityを受ける。`tenantId`／`tenant_id`／`tenant`、`principal`／`actorId`／`actor_id`／`actor`、`scopeId`／`scope_id`がbodyにあればcontextと一致しなければ400とし、一致した値だけをcontextへ束縛する。`authority`／`authorities`などの未契約権限表現は受け付けない。createの `owner_scope.id` もcontextの `scopeId` と一致しなければ拒否する。

HTTP handlerは作成、claim、resume、handoff、前提変更、外部作用不明の各mutationで、`verifiedMutationOrigin` または `verifyMutationRequest` が成功するまでstore factoryを呼ばない。readはmutation-origin検証を要求しないが、storeの現在read ACLを通す。storeが現在ACL、Problem snapshot、sidecar transaction、idempotencyを検証・保存する責務を持つ。

## 応答envelopeと失敗

成功は次のJSON objectを返す。`store_version` は `durable-wait.v1`、HTTP protocolは `durable-wait-http.v1` に固定する。

```json
{
  "protocol_version": "durable-wait-http.v1",
  "store_version": "durable-wait.v1",
  "tenant_id": "tenant-a",
  "scope_id": "org-1",
  "action": "claim",
  "result": {}
}
```

エラーは `{ "protocol_version": "durable-wait-http.v1", "error": { "code": string, "message": string } }` とし、認証情報、sidecar本文、restricted evidenceをmessageへコピーしない。401はtrusted context不在、403は現在ACL・scope・mutation origin拒否、400は本文／型／主体不一致、404は対象なし、409はcondition・lease・state・reconciliation conflict、413は本文超過、500は未知エラーとする。

Mana側はHTTP応答のprotocol／store version、tenant、scope、wait ID、Problem snapshotを検証し、未知版・別scope・壊れた参照を成功へ変換しない。restartはManaの公開triggerとして受けても、wire上は既存storeの `manual` triggerへ変換する。

## 所有境界と非目標

- `brainbase` はhandler、schemas、route mapping、trusted contextへの束縛、既存 `DurableWaitStore` への委譲を所有する。
- HTTP hostは認証、tenant／principal／scope解決、current ACL／Problem snapshot provider、listener／route登録を所有する。OSSのhost合成関数はresolverとstoreFactoryを受け、Node serverを返すだけで、本番認証やdeployを代行しない。
- `mana-runtime` はWorker-safe `fetch` client／coordinatorとevent・timer・restart adapterを所有する。Node/fsのstore、待機Ledger、Problem snapshot、receiptを複製しない。
- queue／scheduledからMana coordinatorを呼ぶruntime接続はmana-runtime側の責務であり、このOSS adapterはそれを完了扱いにしない。Mana側は実queue／scheduled／restart入口を別テストで確認する。

## 検証

OSS側の対象テストは、実Node HTTP server、実 `DurableWaitStore`、実sidecarを使って次を確認する。

- create→read→claim→重複claim→resume→resume再送→新しいstore instanceからreadする永続readback
- `effect-unknown` 後にclaimが `reconciliation_required` となること
- body identity不一致、current scope不一致、current ACL拒否、未検証mutation originのfail-closed
- host resolverの不在・例外が401となり、認証されていないrequestがstoreへ到達しないこと

実行コマンド:

```bash
npm run build
npx vitest run tests/durable-wait-http.test.ts tests/durable-waits.test.ts
```

このfocused adapterテストは既存Story13の26件の計数へ加えない。Manaとのrepo横断transport readbackはMana Story18側または一時fixtureで別に記録し、OSS側のowner boundaryとテスト件数を変えない。CIはfull suiteを実行し、今回のsupport Storyはqueue／scheduled本番接続や認証providerの提供済みを主張しない。
