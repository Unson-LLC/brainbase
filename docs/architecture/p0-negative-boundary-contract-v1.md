# P0 negative boundary contract v1 Architecture

## 判断

契約を `source-lock → JSON Schema → synthetic fixture inventory → reference validator → focused test` の一方向にする。validatorはmanifest記載ファイルのbytesを相対pathとNULで束縛してSHA-256を再計算し、live A0 source-lockとも照合する。missing、unknown、partial、not_collectedのcontract evidenceはpassにしない。

## 信頼境界

```text
Personal body（非公開）
  └─ normalized payload + irreversible evidence digest
       ├─ owner consent authority (personal_read/read/personal://...)
       └─ distinct organization acceptance authority（将来必要、A0正本mapping未収集）
            └─ future organization write（このsliceでは実行しない）
```

両stageは別actor、別signed contextで、同じpayload hashとcorrelation/operation/idempotencyを束縛する。A0のcapability/effect/resource、decision actor、revision、expiry、integrity、Slack provider、`mana-runtime` audience、全cross-layer bindingのいずれか一項でも不一致なら、8 effect counterを0のままdenyする。

A0 semantic bindingはproducerのobserved request schema、canonical context schema、fixture bytes、producer contractへdigestを固定する。A0正本の`company_read/read/company://tenant-a/project-a/read`はP0 ingressの観測文脈だけである。一方、A0正本の汎用`company_write/write/company://tenant-b/project-b/write` authorityはfixtureとproducerのsame-request bindingへexactにcatalogする。ただし汎用company writeだけではowner consentとorganization acceptanceからなるP0 dual-authority promotionのpositive組を証明しない。P0固有のexact promotion binding/sourceが未収集であるgapだけを`contract_gap`・`not_collected`・`deny_all_effects`へ固定し、自動昇格や架空authorityを拒否する。12 field mappingはID、A0 schema/path、A0 fixture path、type、relation、P0 path/value、A0 valueをvalidator内のauthoritative catalogと完全一致させる。12 cross-layer bindingもIDとP0/A0の左右path tupleを完全一致させ、同値な別pathへの左右同時差替えを拒否する。metadataや現在値同士だけの自己整合では通さない。

## 証拠境界

fixtureはsynthetic dataのみ。schema/fixture/source-lockの検証はcontract evidenceであり、runtimeまたはproduction proofではない。statusは`contract_ready`を上限とする。

locked runnerはVibePro verification入力 `P0_LOCK_INSTALL_ROOT` を唯一のinstall-root authorityとする。`locked-runner.json`がpackage lock、Vitest/AJVのversion・integrity・content digest、network acquisition禁止、content binding対象を固定し、`run-locked-vitest.mjs`がrealpathとcache/temp外を検証してAJV一時linkを作成・通常終了またはsignal終了前に削除する。`locked-runner.test.mjs`は公開VibePro専用経路、metadata、content binding、cleanupをouter testとして検証する。入力欠落・lock不一致・realpath逸脱・cleanup不成立は成功へ丸めない。

## マルチテナント境界

- tenant identity: `request.source_tenant`をcanonical keyとし、署名済みSlack→mana-runtime contextからvalidator前に解決する。
- isolation: request、authority、receipt、privacy surfaceは同じtenant境界へ束縛し、cross-tenant候補やfallbackを許さない。
- fail closed: missing、unknown、ambiguous、source/target不一致はdenyし、DB・organization event・Graph・search・LLM・credential・external・deployを0にする。
- test strategy: synthetic tenant A/B × person A/Bでcross-personとcross-organizationを双方向に検査する。runtime scanner、deployment、production isolationは未収集である。
- membership inventory: tenant A/Bの双方にperson A/Bを明示assignし、same-tenant baselineと4つの既存deny caseをvalidatorで完全一致させる。
