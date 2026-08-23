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

- [x] AC-001: A0のexact SHA、contract id/version、fixture digestをlive source-lockから固定する。
- [x] AC-002: canonical baselineとmachine-readable membership inventoryにtenant identity/assignmentを固定し、各tenantの2 personとcross-person/cross-organizationを双方向にdenyする。
- [x] AC-003: owner consentとorganization acceptanceを別actor・別authorityへ束縛する。owner=reviewerはdenyする。
- [x] AC-004: A0正本schema/fixtureへ、12 field mappingのID・path・fixture path・type・relation・A0/P0 valueと、12 cross-layer bindingのID・P0/A0左右pathをexact tupleとして固定する。A0 read tupleはingress文脈に限定し、positive write authorityの正本欠落は`contract_gap`・`not_collected`・fail closedにする。
- [x] AC-005: unknown/missing/ambiguous/inactive/merged person、stale/expired/invalid/replayed authority、unsupported direct ingressをdenyする。
- [x] AC-006: organization reviewer、event、Graph、search、receipt、LLMからPersonal bodyを再構成できず、LLM repetitionだけでは昇格できない。
- [x] AC-007: 全negative fixtureの8 effect counterを0にし、validatorがbaseline、exact一項差分、invariant、surface、schema、digest、scope、inventory、unknown evidenceを決定論的に検証する。
- [x] AC-008: mutation path/before/after/invariantに加え、A0 source digest・fixture path・relation・A0/P0 value・cross-layer左右pathを壊すRED sensitivityとGREENをfocused testsで証明する。
- [x] AC-009: statusは最大`contract_ready`、production evidenceは`not_collected`、`done=false`とする。

## マルチテナント計画契約

canonical tenant keyは`request.source_tenant`で、Slackからmana-runtimeが渡す署名済みcontextからcontract validatorの前に一意解決する。missing・unknown・ambiguous tenant、source/target tenant不一致、別tenantへのfallbackはdenyし、全effectを0にする。synthetic test strategyはtenant A/Bそれぞれにperson A/Bを割り当て、cross-personとcross-organizationを両方向に検査する。これはplanning/contract evidenceであり、runtime isolationまたはproduction proofではない。

## 非目標

P0 runtime/Graph実装、production E2E、deploy、migration、customer data、secret、外部送信、mana-runtime変更、`Unson-LLC/brainbase` semantic/runtime変更、release/done宣言は対象外。
