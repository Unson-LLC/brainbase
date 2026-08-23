---
story_id: story-p0-negative-boundary-contract-v1
title: P0 negative boundary contract v1
status: contract_ready
program_id: brainbase-program-master-roadmap-v1
work_package: P0
production_evidence: not_collected
done: false
---

# P0 negative boundary contract v1

## 利用者成果

Personal KGの本人は、Personal本文を組織reviewerへ見せずに正規化payloadだけへ同意できる。別人のorganization reviewerが別authorityで同じpayloadを受け入れた場合だけ、将来の組織昇格実装へ進める。owner approvalだけではGraph writeを含む全effectを0に保つ。

## 現在の境界

- primary repository: `Unson-LLC/brainbase-unson`
- hard dependency: A0。merged producer SHA `ad908bce7b90678f9ed7f1c570f808bdf1a500ad`をsource-lockするが、A0は最大`contract_ready`である。
- contract dependency: J0。DAG runtime実装をこのStoryへ混ぜない。
- provider/audience: Slack → `mana-runtime`のみ。direct Brainbase ingressはfallbackなしでdenyする。
- fixture: syntheticのみ。runtime、Graph、DB、search、LLM、credential、external、deployの実処理は行わない。

## 受け入れ条件

1. A0のexact SHA、contract id/version、fixture digestをlive source-lockから固定する。
2. 2 tenant × 2 personのcross-person/cross-organizationを双方向にdenyする。
3. owner consentとorganization acceptanceを別actor・別authorityへ束縛する。owner=reviewerはdenyする。
4. capability/effect/resource/decision/actor/revision/expiry/integrity、provider/audience、correlation/operation/idempotency、12個のcross-layer bindingを一項ずつfail closedにする。
5. unknown/missing/ambiguous/inactive/merged person、stale/expired/invalid/replayed authority、unsupported direct ingressをdenyする。
6. organization reviewer、event、Graph、search、receipt、LLMからPersonal bodyを再構成できず、LLM repetitionだけでは昇格できない。
7. 全negative fixtureの8 effect counterを0にし、validatorがschema、digest、scope、inventory、unknown evidenceをdeterministically検証する。
8. RED sensitivityとGREENをfocused testsで証明する。
9. statusは最大`contract_ready`、production evidenceは`not_collected`、`done=false`とする。

## 非目標

P0 runtime/Graph実装、production E2E、deploy、migration、customer data、secret、外部送信、mana-runtime変更、`Unson-LLC/brainbase` semantic/runtime変更、release/done宣言は対象外。
