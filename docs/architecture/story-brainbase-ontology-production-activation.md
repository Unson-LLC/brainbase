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

## 運用責任と観測面

佐藤圭吾がdeploy、readback、support、rollbackのownerを兼ねる。project memberの追加操作は不要である。観測面は次の5点を正本とする。

1. 本番checkoutの稼働commitとmerge済みcommitの一致
2. `brainbase-ssot.service`のactive状態とhealth応答
3. version指定/current指定APIのversion・digest一致
4. production public keyによるreceipt検証とDB-backed audit 0件
5. restart後journalのRegistry、署名、DB接続エラー不存在

本番切替後にいずれかが崩れた場合、直前の未公開artifactを再deployしてserviceを再起動する。初回releaseのためrollback後の`current`は`null`となる。Graph remediationとDecision/RACIは監査履歴として保持し、削除や逆変換を行わない。
