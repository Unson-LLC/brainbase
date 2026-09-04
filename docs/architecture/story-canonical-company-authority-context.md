# Canonical Company Authority Context 実装設計

## 対象

本設計は、外部runtimeが送る観測済みidentityと要求から、Brainbaseがtenant、connection、person、membership、organization、project、resource、RACI、policyを一意に解決し、MANA向けの署名済み`CanonicalExecutionContextV1`を返すproducer境界を定義する。

この変更だけではT0/A0を完了扱いにしない。本番schema適用、Mana consumer cutover、2 tenant × 2 personのnegative E2E、Usage・Receipt・外部readbackは別の本番証跡として必要である。

## 信頼境界

入力として許可するのは`provider_identity`、`requested_action`、任意の`delivery`、`correlation_id`だけである。canonical person、organization、project、owner、RACI、approver、decision、credentialを含む入力は、DB参照より前に拒否する。`delivery`省略はauthority未解決診断をfail closedで返す場合だけ許容し、署名contextを発行する経路ではSlackの`event_id`と`channel_id`を必須にする。

tenantとworkspace connectionは、`SECURITY DEFINER`の限定関数`resolve_company_authority_route`で一意に解決する。この関数は固定6引数、固定6列、active record、任意のworkspace/app/enterprise/project hintだけを扱い、最大2件を返す。0件と複数件を区別してfail closedにする。一般的なSQL実行やtable RLSの解除には使わない。

解決後のtenant内identityとauthorityは既存RLS付きrepositoryで取得する。署名秘密鍵はBrainbase内に保持し、consumerへ渡さない。

## 発行経路

1. 外側wire validatorが入力のexact shapeと自己申告authority不在を検証する。
2. global route resolverがtenantとconnectionを一意に決める。
3. 既存`TenantContextProducer`がtenant revision、connection revision、canonical identity、company authorityを解決する。authority取得トランザクションではmembership rowを再度lockし、active状態とidentity解決時のmembership revisionが一致する場合だけauthorityを返す。
4. nested TenantContextへ要求capabilityと`company_authority_v1` markerを分離して格納し、署名する。
5. actor、scope、authority、receiptを外側contextへ構成し、同じ鍵でdetached JWS署名する。
6. producer自身がaudience、deployment、TTL、request bindingを再検証してから応答する。

`operation_id`は同じ`correlation_id`から決定的な正規`op_` ULIDとして生成し、再配送時のidempotency bindingを変えない。

## エラー契約

unknown person、ambiguous person、inactive membership、cross-organization、scope/effect mismatch、stale revision、authority unavailable、Personal owner mismatchをcanonical errorへ写像する。error応答は`business_effect=false`を必須とし、上流停止だけをretryableにする。

入力schema違反はHTTP契約違反として例外にし、authority resolution errorへ丸めない。DB障害はperson不在と誤認せず`AUTHORITY_UNAVAILABLE`にする。

## 配置

Brainbase Node runtimeに`POST /api/v1/runtime/company-authority:resolve`を追加し、既存service authを通す。Cloudflare bridgeはこの固定POST pathだけをorigin allowlistへ追加する。汎用proxyにはしない。

## Migration

`company-authority-schema.v2`は既存のtenant production provisioning schemaを前提とし、`workspace_connections.enterprise_id`とmigration実行roleのRLS bypassを適用前に確認する。migrationはtransaction、advisory lock、RLS/force RLS、policy、route resolver functionの`SECURITY DEFINER`・固定設定・所有者RLS bypass・PUBLIC拒否・`brainbase_app`による実呼出し、ledger hashをreadbackする。`--dry-run`はrollbackし、`--apply`は明示actorを要求する。

## 検証境界

ローカルでは次を証明する。

- nested/outer両署名とrequest binding
- authority自己申告のDB参照前拒否
- unknown/ambiguous/unavailable/personal mismatchのcanonical error
- route resolverのexact parameter bindingと0/複数拒否
- service-auth付きHTTP routeとCloudflare allowlist
- 既存tenant runtime回帰

本番では別途、exact merged SHAとschema hashに対して2 tenant × 2 person、cross-tenant、cross-person、stale revision、duplicate delivery、credential broker、Usage、Receipt、外部readbackを同一correlation IDで確認する。未取得は`not_collected`のまま保持する。
