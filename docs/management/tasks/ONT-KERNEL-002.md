---
task_id: ONT-KERNEL-002
story_id: story-brainbase-ontology-kernel
status: pending
priority: high
depends_on:
  - ONT-KERNEL-001
created_at: 2026-08-02
---

# Ontology Kernel 1.0.0をactive化する

## 成果

実在するGraph authorityに基づいてOntology `1.0.0`をactive化し、canonical保存前guardを有効にする。

## 開始条件

- 対象version、release digest、source commitを明記した承認DecisionがGraph SSOTに存在する。
- 対象scopeに提案者Responsible、決裁者Accountable、適用者AccountableのRACIが存在する。
- Ed25519署名鍵がproduction secret境界に配備され、公開鍵でreceiptを検証できる。
- active化後のsigned rollbackまたはprevious-current復元手順が独立Gateで承認される。

## 実行と検証

1. `index.current`が`null`、`1.0.0`が`proposed`のままであることを確認する。
2. authority endpointがDecision、RACI、scope、impact、applierを照合して署名receiptを返すことを確認する。
3. publisherでreceipt、current index、compatibility viewを一操作で生成する。
4. publication commitをsource commitの直接の子として作成し、full-history verify Gateを通す。
5. merge後のcanonical runtimeで`1.0.0`がactive currentとなり、generic write guardが有効であることを確認する。

## 停止条件

Decision、RACI、署名鍵、rollback承認、またはruntime検証のいずれかが未確認ならpublishしない。証跡を推測または代替してactive化しない。
