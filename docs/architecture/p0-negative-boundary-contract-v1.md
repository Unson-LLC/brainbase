# P0 negative boundary contract v1 Architecture

## 判断

契約を `source-lock → JSON Schema → synthetic fixture inventory → reference validator → focused test` の一方向にする。validatorはmanifest記載ファイルのbytesを相対pathとNULで束縛してSHA-256を再計算し、live A0 source-lockとも照合する。missing、unknown、partial、not_collectedのcontract evidenceはpassにしない。

## 信頼境界

```text
Personal body（非公開）
  └─ normalized payload + irreversible evidence digest
       ├─ owner consent authority (personal_read/read/personal://...)
       └─ distinct organization acceptance authority (company_write/write/company://...)
            └─ future organization write（このsliceでは実行しない）
```

両stageは別actor、別signed contextで、同じpayload hashとcorrelation/operation/idempotencyを束縛する。A0のcapability/effect/resource、decision actor、revision、expiry、integrity、Slack provider、`mana-runtime` audience、全cross-layer bindingのいずれか一項でも不一致なら、8 effect counterを0のままdenyする。

A0 semantic bindingはproducerのobserved request schema、canonical context schema、fixture bytesへdigestを固定し、P0 flat pathからA0 authoritative path/type/valueへの明示mappingを検証する。12 cross-layer bindingはP0の左右pathとA0 request/contextの左右pathを同時に検査し、metadataだけの自己整合では通さない。

## 証拠境界

fixtureはsynthetic dataのみ。schema/fixture/source-lockの検証はcontract evidenceであり、runtimeまたはproduction proofではない。statusは`contract_ready`を上限とする。

## マルチテナント境界

- tenant identity: `request.source_tenant`をcanonical keyとし、署名済みSlack→mana-runtime contextからvalidator前に解決する。
- isolation: request、authority、receipt、privacy surfaceは同じtenant境界へ束縛し、cross-tenant候補やfallbackを許さない。
- fail closed: missing、unknown、ambiguous、source/target不一致はdenyし、DB・organization event・Graph・search・LLM・credential・external・deployを0にする。
- test strategy: synthetic tenant A/B × person A/Bでcross-personとcross-organizationを双方向に検査する。runtime scanner、deployment、production isolationは未収集である。
- membership inventory: tenant A/Bの双方にperson A/Bを明示assignし、same-tenant baselineと4つの既存deny caseをvalidatorで完全一致させる。
