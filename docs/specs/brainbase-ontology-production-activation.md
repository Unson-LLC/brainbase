---
spec_id: SPEC-BRAINBASE-ONTOLOGY-PRODUCTION-ACTIVATION
story_id: story-brainbase-ontology-production-activation
status: accepted
version: 1.0.0
date: 2026-08-03
---

# Brainbase Ontology Production Activation Spec

## A-001 Graph remediation

実行器は既知の61 violationだけをexact preconditionとし、差異があれば停止する。全変更を1 transactionに含め、削除せず、事前backupとpersist後の0 violationを必須とする。再実行は0 violationならno-op成功とする。

## A-002 Publication authority

Decision IDは`dec_ontology_1_0_0_activation_20260803`、scopeはBrainbase project、proposer / decider / applierは佐藤圭吾とする。Decision payloadはversion、digest、source commit、impact scope、scope、proposer、deciderを完全に保持する。RACIはlaneごとに独立entityとし、Responsible 1件、Accountable 2件を同一scopeへ結ぶ。

## A-003 Signing and publication

Ed25519 keypairはproduction用に生成し、秘密鍵・公開鍵・key IDをInfisical productionからruntimeへ投影する。publication endpointは認証actor、Graph authority、release bindingを確認して署名receiptを返す。publisher以外のcurrent変更は禁止する。

## A-004 Rollback

publication commitの親がsource commitで、変更pathがreceipt、index、compatibility viewだけであることを検証する。独立checkoutでpublication commitをrevertし、`current: null`かつ`ontology:verify`合格を確認する。演習は本番runtimeやcanonical checkoutを変更しない。

## A-005 Production completion

merge後の本番runtimeでversion指定とcurrent指定のdigestが一致し、署名receiptが検証可能で、DB-backed auditがcompleteかつ0 violationである場合のみ有効化完了とする。
