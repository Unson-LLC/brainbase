# Mana成果コンテキスト private runtime 接続仕様

## 対象

Cloudflare tenant runtime bridgeが転送する`POST /v1/outcome-service-context:issue`を、loopback限定のBrainbase tenant runtime listenerで処理する。

## 契約

1. `createTenantRuntimeInternalApp`は既存のtenant runtime routerに加え、`/v1`配下へ成果コンテキストrouterをmountする。
2. production compositionは既存の`serviceAuth`と`outcomeServiceContextIssuer`を同じprivate listenerへ渡す。発行処理を複製しない。
3. 認証前に発行処理を呼ばない。発行器未構成時はfail closedする。
4. `POST /api/v1/runtime/negotiate`を含む既存契約を維持する。

## 検証

- private listenerへ有効なservice tokenで発行要求すると200になり、既存発行器が一度呼ばれる。
- service tokenが不正なら401になり、発行器は呼ばれない。
- 既存tenant runtime internal server testsがすべて通る。
