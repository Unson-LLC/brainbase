# Company OS reservation canonical HTTP adapter v1

この仕様は [story-company-os-reservation-api-v1](../stories/story-company-os-reservation-api-v1.md) と [company-os-reservation-api](../architecture/company-os-reservation-api.md) を実装可能な契約へ落とす。

## 公開モジュールとhandler

公開サブパスは `@unson/brainbase-mcp/resource-reservation-http` とする。OSSはlistenするサーバーを公開せず、既存のNode HTTPホストが次のhandlerを合成する。

```ts
type ResourceReservationHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedResourceReservationRequestContext | null,
) => Promise<boolean>;
```

`true`はhandlerが対象パスを処理したこと、`false`は別routeへ委譲できることを表す。対象パスでcontextがない場合は401を返して`true`とする。contextはホストが認証・テナント解決後に生成し、本文から生成してはならない。

```ts
interface TrustedResourceReservationRequestContext {
  tenantId: string;
  principal: string;
  scopeId: string;
  verifiedMutationOrigin?: string;
}

type ResourceReservationServiceFactory = (
  context: TrustedResourceReservationRequestContext,
) => ResourceReservationService | Promise<ResourceReservationService>;

interface ResourceReservationHttpOptions {
  serviceFactory: ResourceReservationServiceFactory;
  basePath?: string; // default: /resource-reservations
  bodyLimitBytes?: number;
  verifyMutationRequest?: (input: {
    request: IncomingMessage;
    context: TrustedResourceReservationRequestContext;
  }) => boolean | Promise<boolean>;
}
```

変更要求は`context.verifiedMutationOrigin`が非空、または`verifyMutationRequest`がtrueを返す場合だけ進める。両方がない、またはproviderがfalse／例外の場合は403とし、factoryを呼ばない。

## ルート

既定のbase pathは`/resource-reservations`。query stringはpath判定から除く。

| method | path | body | service operation |
|---|---|---|---|
| GET | `/resource-reservations` | なし | `readLedger({tenantId, principal, scopeId})` |
| POST | `/resource-reservations/estimate` | request | `estimate` |
| POST | `/resource-reservations/approve` | request | `approve` |
| POST | `/resource-reservations/reserve` | request + `approvalId` | `reserve` |
| POST | `/resource-reservations/release` | mutation input | `release` |
| POST | `/resource-reservations/cancel` | mutation input | `cancel` |
| POST | `/resource-reservations/consume` | mutation input | `consume` |

`start_external`と未知のoperationは公開しない。base配下の未知pathは404、対象pathの未対応methodは405と`Allow`を返す。

## 本文と信頼済み文脈

request bodyはJSON objectでなければならない。予約requestは既存の`ResourceReservationRequest`、reserveは`approvalId`を追加した形、mutationは`operationId`と`reservationId`を持つ。必要な値、正の有限`amount`、期間、Problem snapshot参照の詳細な検証はserviceへ委譲するが、JSON、object、既知フィールド、型の検証はservice factory前に行う。

bodyに`tenantId`、`tenant_id`、`tenant`、`principal`、`actorId`、`actor_id`、`scopeId`が指定された場合はcontextと一致しなければ400。不一致をcontext値で黙って置き換えない。一致した値はcontext値へ束縛してserviceへ渡す。bodyに`authority`または`authorities`が存在する場合は、値にかかわらず400。未契約の追加フィールドも400とする。

GETはbodyを受け取らず、serviceの`readLedger`が現在ACLを検証する。adapterは別のread権限判定やsidecar読取を追加しない。

## HTTP結果

成功はJSON objectで、`action`と`result`を含む。mutationとestimateにはrequestの`operationId`も含める。readは`result`へ`ResourceReservationLedgerSnapshot`を入れる。

| 状態 | 条件 |
|---:|---|
| 200 | 成功、read、estimate、または状態遷移 |
| 400 | JSON／body／型／本文の主体不一致／authority／service validation |
| 401 | contextなし |
| 403 | CSRF未検証、認可拒否、scope越境 |
| 404 | 未知path、予約未検出 |
| 405 | method不一致 |
| 409 | operation conflict、approval/state conflict、capacity exceeded |
| 413 | body limit超過 |
| 500 | 未知エラー、ledger invalid |
| 503 | capacity unknown |

エラーは`{ "error": { "code": string, "message": string } }`。例外内容を認証情報やsidecar本文として返さない。

## 検証シナリオ

- 実Node HTTP serverへhandlerを合成し、実`ResourceReservationService`と同一sidecarへapprove→reserve→readを行う。
- tenant Aのcontextで作ったreservationをtenant Bのbody／reservationIdで読書きできない。
- 本文のtenant／actor不一致とauthority、CSRF未検証、malformed JSONではfactoryとsidecarが変化しない。
- 同一operationIdの再送は既存サービスの冪等結果を返し、異なるpayloadは409になる。
- 別のHTTP requestから同じサービスを同時にreserveしても、既存サービスのlockとcapacity境界を超えない。
