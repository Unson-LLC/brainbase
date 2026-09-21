# Mana成果コンテキスト 保護済みorigin経路仕様

## 対象

Cloudflare tenant runtime bridgeが受ける成果コンテキスト発行要求を、既存のCloudflare Access保護対象であるBrainbase private runtime経路へ転送する。

## 契約

1. 外部Service Binding契約`POST /v1/outcome-service-context:issue`は変更しない。
2. bridgeはこの経路だけをoriginの`POST /api/v1/runtime/outcome-service-context:issue`へ写像する。他の許可済み経路はそのまま転送する。
3. `createTenantRuntimeInternalApp`は成果コンテキストrouterを`/api/v1/runtime`へ先にmountし、既存tenant runtime routerへ未一致要求を渡す。
4. 移行中の直接呼び出し互換性のため、private listenerの`/v1`経路も維持する。
5. 両方の成果発行経路は同じ`serviceAuth`と`outcomeServiceContextIssuer`を使用し、認証・発行処理を複製しない。

## 検証

- bridgeへ有効な署名付き要求を送ると、origin URLが保護済み経路になる。
- private listenerの保護済み経路へ有効なservice tokenで要求すると200になり、既存発行器が一度呼ばれる。
- 既存のbridge、private listener、成果コンテキストrouterの影響テストが通る。
- 本番の隔離テストで成果を読み戻し、外部副作用がないことを確認する。
