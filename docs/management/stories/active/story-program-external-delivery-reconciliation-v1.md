---
story_id: story-program-external-delivery-reconciliation-v1
title: Program external delivery reconciliation v1
status: contract_ready
program_id: brainbase-program-master-roadmap-v1
production_evidence: not_collected
done: false
---

# Program external delivery reconciliation v1

## 利用者成果

Program orchestratorは、外部repositoryで発生したmerge/releaseの事実を取り込みつつ、work packageの進捗を根拠なく昇格させない。repo、PR、canonical role `producer_contract_delivery`、source-lock SHAを一組として照合し、同名の古いopen PRをcanonical producerへ誤採用しない。machine source-lockに存在しないPR/roleはProgram-owned companion lockで出典を分けて結合する。

canonical identity: repository=`Unson-LLC/brainbase-unson`、pull_request=`1302`、role=`producer_contract_delivery`、merged_sha=`ad908bce7b90678f9ed7f1c570f808bdf1a500ad`。

## 受け入れ条件

- [x] AC-001: provenance identityを`repository + pull_request + role + merge SHA`で固定する。
- [x] AC-002: A0 producer contract deliveryは`Unson-LLC/brainbase-unson#1302`であり、同名のopen #1283をcanonical producerにしない。
- [x] AC-003: P0 source-lockのrepository/SHAとcompanion lockのPR/roleを直接読み、A0 producer deliveryの`repository + pull_request + producer_contract_delivery + merge SHA`へ一致させる。
- [x] AC-004: external delivery stateとProgram statusを別field・別判定として保持する。
- [x] AC-005: Program status語彙を`planned / contract_ready / implementing / verified / production_proven / done`だけに限定する。
- [x] AC-006: merge、release、docs、open PRだけでは`verified`、`production_proven`、`done`へ昇格しない。
- [x] AC-007: P0 Story、AC、Gateへreconciliation責務を混ぜず、専用Story/Architecture/Spec/Task/testへ閉じる。
- [x] AC-008: production evidenceは`not_collected`、doneはfalseのままにする。

## 非目標

外部PRの変更・close・merge、release、deploy、A0/P0 runtime変更、独立review判定の自己記録、Program statusの自動昇格は対象外。
