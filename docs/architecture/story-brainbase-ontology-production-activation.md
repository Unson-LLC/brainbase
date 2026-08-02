---
story_id: story-brainbase-ontology-production-activation
status: accepted
date: 2026-08-03
---

# Ontology 1.0.0 Production Activation Architecture

## 境界

release bytesとpublication実装はGit、人物・Decision・RACIはGraph SSOT、秘密鍵はInfisical production、実効状態は署名receiptと`config/ontology/index.json`を正本とする。これらを別の正本へ複製しない。

## 公開シーケンス

1. 本番Graphをtransaction内で修復し、完全snapshotの0 violationを確認する。
2. governance IDを含むrelease source commitを固定する。
3. source commitとrelease digestに完全結合したDecision/RACIをGraphへtransactionalに登録する。
4. production signing keyをInfisicalからruntimeへ投影し、認証済みpublication endpointがEd25519 receiptを発行する。
5. publisherがreceipt、current index、compatibility viewだけを生成し、source commitの直接の子としてcommitする。
6. 独立checkoutでpublication commitをrevertし、直前状態である`current: null`へ戻せることを検証する。
7. VibePro GateとCIを通してmergeし、本番deploy後にcurrent、署名、監査をreadbackする。

初回releaseには以前のactive versionがないため、rollbackの`target_version: null`は「未公開状態へ復旧」を意味する。復旧はpublication commitのrevertと直前artifactの再deployで行い、Graph修復やauthority factは削除しない。

## Fail closed

release digest不一致、source commit不一致、認証actor不一致、RACI不足、Decision binding不足、署名検証失敗、Graph violation、partial snapshotではreceiptを作らずcurrentを変更しない。
