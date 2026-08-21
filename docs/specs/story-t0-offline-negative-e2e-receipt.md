---
story_id: story-t0-offline-negative-e2e-receipt
spec_status: accepted
---

# T0オフライン負系Receipt仕様

## 実行契約

```text
node scripts/run-t0-offline-negative-e2e.js --json --base-sha <40 hex> --head-sha <40 hex>
```

`--base-sha`と`--head-sha`は省略不可とし、40桁のlowercase SHA-1として検証する。さらに`--base-sha`は固定T0 base `e44843bd1bfc995c760dd6ec7e2916d62685a514`と一致し、`--head-sha`はスクリプトが実行されるworktreeの`git rev-parse HEAD`と一致しなければならない。構文上有効でも別のbase/headは拒否する。出力はstdoutに1つのJSON objectだけを出し、ログや外部接続を行わない。`--json`を省略した場合、または`--json`以外の未知optionを渡した場合は終了コード1とする。

## Receipt schema

```json
{
  "schema_version": "t0.offline_negative_e2e_receipt.v1",
  "run_id": "t0-offline-negative-e2e",
  "mode": "fixture-only",
  "base_sha": "<40 hex>",
  "head_sha": "<40 hex>",
  "fixture_hash": "sha256:<64 hex>",
  "fixture_harness_status": "success",
  "production_executed": false,
  "deploy_allowed": false,
  "cases": {
    "same_event_redelivery": {
      "status": "passed",
      "counters": {"provider": 1, "delivery": 1, "accounting": 1}
    },
    "cross_tenant_rejected": {
      "status": "blocked",
      "rejected_before": "resolver",
      "counters": {"resolver": 0, "provider": 0, "accounting": 0}
    },
    "upstream_unavailable": {
      "status": "blocked",
      "failure_code": "UPSTREAM_UNAVAILABLE",
      "external_readback": {"state": "not_collected", "quantities": null}
    }
  },
  "external_adapter_calls": 0
}
```

`fixture_hash`はケースfixtureのcanonical JSON（キー昇順、空白なし）に対するSHA-256である。Receiptの`base_sha`、`head_sha`は厳密なGit bindingを通過した値だけを保存する。トップレベルの`fixture_harness_status=success`はfixture harness自身の完了だけを表し、各ケースの`status`とは別の意味である。unknown quantityを表す値は必ず`null`とし、0へ丸めない。これはdeterministic contract fixtureのReceiptであり、production E2EやT0 exit gateの完了証明ではない。

## マルチテナント契約境界

machine Specの`multi_tenancy`は、fixture eventの`tenant_id`をcanonical identityとして、fixture event → resolver → provider/delivery/accounting → adapter boundaryへ必須伝播させる契約を宣言する。欠落・曖昧なtenantはdeny、cross-tenant候補は副作用なしでdenyする。fixture-only sliceではcredential lookupを行わず、raw secretとcross-tenant fallbackを禁止する。実際のdeployment、Graph、production scanner/readbackはこのsliceでは適用・収集せず、`deployment_verification=not_applicable`およびT0 partialの境界を保持する。

## Fixture-only adapter layer

tenant境界、resolver、provider、delivery、accountingの各ケース処理は、メモリ内のfixture-only adapter layerを通る。標準factoryが発行したモジュール内identityを持つ外部boundaryと注入adapterだけを受理し、`mode`等の構造を偽装したboundary／injectionはlayer生成前・注入呼び出し前に拒否する。各操作の前に禁止外部adapter境界を検査し、production形状のadapter注入は実行開始時に拒否する。正常fixture処理経路へ禁止adapterを注入した場合はadapter call時に例外となる。禁止stubのメソッド呼び出しは例外となり、正常runの`external_adapter_calls`は0でなければならない。

provider、delivery、accountingはそれぞれevent ID単位のidempotency guardを持つ。同じeventをpipelineで再配送した場合も、各layerを直接2回呼び出した場合も、各counterは1である。

upstream unavailableはresolver結果の`available=false`を必須条件とする。provider/delivery/accountingは0で、`external_readback.state`は`not_collected`、未知数量は`null`である。`available=true`や不正なresolutionはfail-loudとする。

Vitest testはrepo正本`vitest.config.js`の既存includeである`tests/integration/**/*.test.js`配下に置き、`npm run test:run -- tests/integration/t0-offline-negative-e2e-receipt.test.js`で発見できる。

## TDD traceability

- `keeps the fixture-only boundary and records the three negative cases`: Receipt境界、cross-tenantのresolver/provider/delivery/accounting 0件、upstream `available=false`・blocked・provider/delivery/accounting 0件・`not_collected`・quantity `null`を固定する。
- `fails closed if upstream fixture reports available=true`: upstreamが利用可能と報告する不正fixtureをfail-loudで拒否する。
- `guards provider, delivery, and accounting on direct redelivery`: provider、delivery、accountingそれぞれのevent ID idempotency guardを直接2回呼び、各counterを1件に固定する。
- `rejects a structurally forged fixture-only adapter before injection calls`: `mode`等を偽装したadapterを、実働adapterの呼び出し前にidentity不一致として拒否する。
- `rejects a forged low-level external boundary before provider calls`: factory外で構成したexternal boundaryを低層adapter layerの生成前に拒否し、偽装providerを呼び出さない。
- `rejects a forged low-level injection before provider calls`: factory外で構成したinjected adapterを低層adapter layerの生成前に拒否し、偽装providerを呼び出さない。
- `fails closed when a forbidden adapter is injected into normal fixture processing`: 正常fixture処理経路への禁止adapter注入をadapter call時に失敗させる。
- `fails closed if a fixture attempts any external adapter call`: 禁止外部adapterの各メソッド呼び出しを失敗させ、正常dry runの呼び出し件数0を確認する。
- `keeps fixture results deterministic for the exact git binding`: 同一の厳密Git bindingでfixture hashとケース結果が一致することを独立に確認する。
- `prints one machine-readable Receipt in fixture-only CLI mode`: canonical CLI経路が1行の機械可読Receiptを出し、`fixture_harness_status`と本番未実行フラグを保持する。
- `fails with exit 1 for an unknown CLI option`: 未知optionを受けたCLIがstdoutへReceiptを出さず、stderrのエラーとexit 1で終了することを固定する。
- `fails with exit 1 when --json is omitted`: `--json`を省略したCLIがstdoutへReceiptを出さず、stderrのエラーとexit 1で終了することを固定する。
