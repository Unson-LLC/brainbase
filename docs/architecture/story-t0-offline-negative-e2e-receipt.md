---
story_id: story-t0-offline-negative-e2e-receipt
architecture_status: accepted
---

# T0オフライン負系Receiptの境界

## 境界

`scripts/run-t0-offline-negative-e2e.js`は、固定fixtureとメモリ内の効果台帳だけを使う検証ハーネスである。ネットワーク、PostgreSQL、Graph、credential、OAuth、Cloudflare、Slack、既存のproduction provisioning runtimeは呼び出さない。

外部adapterは明示的に禁止adapterとして扱う。tenant境界、resolver、provider、delivery、accountingの各fixture操作は、禁止外部adapter境界を依存として持つfixture-only adapter layerを必ず経由し、操作ごとに境界を検査する。境界と注入adapterはfactoryが発行したモジュール内WeakSet identityを持つものだけを受理し、構造を偽装したboundary／injectionはlayer生成前・呼び出し前に拒否する。ケース処理が禁止adapterへ到達した場合は例外にし、production形状のadapter注入も開始時に拒否する。正常fixture処理経路へ禁止adapterを注入した場合も、そのadapter call時点で例外にする。これにより、fixtureの成功を外部システムの成功へ拡張しない。

## ケース境界

1. 同一eventの再配信はprovider、delivery、accountingがそれぞれevent ID単位のidempotency guardを持ち、pipeline再配信と各layerのdirect redeliveryで一度だけ効果を適用する。
2. tenant境界はresolver/provider/accountingの前段で検査し、越境eventを拒否する。
3. upstream unavailableはresolverの`available=false`を検証して効果を適用せずblockedとし、provider/delivery/accountingを0、external readbackを`not_collected`、未知数量を`null`で返す。`available=true`はfail-loudとする。

## Receipt境界

Receiptは`schema_version`、厳密に検証済みのbase/head、fixture hash、ケース別の判定・counter・readback、実行禁止フラグを持つ。baseは固定T0 base、headは実行worktreeの`git rev-parse HEAD`に束縛する。ハーネス自身の検証完了はトップレベルの`fixture_harness_status=success`で表し、ケースの`status=blocked|failed`を成功へ正規化してはならない。`production_executed=false`と`deploy_allowed=false`は常に固定する。

このdeterministic contract fixtureのReceiptはT0 exit gateのproduction evidenceではない。real PostgreSQL/runtime cross-tenant E2E、production schema/bridge/secret/OAuth/readback、外部redelivery readbackが別途そろうまで、T0の状態はpartialである。
