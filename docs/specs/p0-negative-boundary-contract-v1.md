# P0 negative boundary contract v1 Spec

## 正本

- source-lock: `contracts/p0-negative-boundary-contract-v1/source-lock.json`
- schema: `contracts/p0-negative-boundary-contract-v1/schema/negative-case.schema.json`
- fixture: `contracts/p0-negative-boundary-contract-v1/fixtures/cases.json`
- manifest: `contracts/p0-negative-boundary-contract-v1/manifest.json`
- validator: `contracts/p0-negative-boundary-contract-v1/reference/validate.mjs`
- A0 semantic binding: `contracts/p0-negative-boundary-contract-v1/a0-semantic-binding.json`
- tenant-person inventory: `contracts/p0-negative-boundary-contract-v1/tenant-person-inventory.json`

## 不変条件

1. A0 producerはSHA `ad908bce7b90678f9ed7f1c570f808bdf1a500ad`、contract `mana-brainbase-company-authority/v1@1.0.0`、fixture digest `1d7af5b850abeb10e07db281c17341636d80a74cb37679b2c2b6ab5ce9b0a6ea`に固定する。
2. negative caseは`decision=deny`かつdatabase、organization event、Graph、search、LLM、credential、external、deployをすべて0にする。
3. required case inventoryと実case集合は完全一致し、duplicateとundeclared caseを拒否する。
4. owner consentだけではorganization acceptanceにならない。ownerとreviewerは別人である。
5. Personal body、transcript、private note、preview、Personal内部ID、semantic canaryをorganization surfaceへ出さない。
6. production evidenceは`not_collected`のままにする。
7. `canonical_baseline`はauthority、Slack provider、mana-runtime audience、request、receipt、privacy、12 cross-layer bindingの正常値を固定する。
8. 各negative caseは`mutation.mode=single`、JSON Pointer `path`、baselineと一致する`before`、異なる`after`、期待する`violated_invariant`と`surface`を持つ。validatorのcase catalogと一致しない説明的mutationは拒否する。
9. canonical tenant keyは`request.source_tenant`である。missing/ambiguous/cross-tenantはfallbackせずdenyし、tenant A/B × person A/Bの双方向fixtureで隔離境界を検証する。
10. P0 flat fieldはA0 observed request/canonical contextへ、12件の`id + a0_path + a0_fixture_path + type + relation + a0_value + p0_value`を含むexact authoritative tuple catalogで対応付ける。12 cross-layer bindingも`id + p0_left + p0_right + a0_left + a0_right`のexact catalogへ固定し、同値な別pathへの左右同時差替えを拒否する。
11. `tenant-person-inventory.json`は2 tenantそれぞれへの2 person membership/assignment、same-tenant baseline、cross-person/cross-tenant双方向deny caseを固定する。49件のcase inventoryは変更しない。
12. RED sensitivityはA0 authoritative source digest、fixture path、relation、A0 value、P0 value、cross-layer exact tupleの各driftを対応する`a0-binding:*` errorで拒否する。
13. A0のread tupleは`observed_ingress_context_only`であり、organization acceptanceのpositive write authorityではない。A0 write正本は`contract_gap`・`not_collected`とし、authoritative source/mappingをnull、欠落時挙動を`deny_all_effects`へ固定する。

## ACトレーサビリティ

AC-001..AC-009は`.vibepro/spec/story-p0-negative-boundary-contract-v1/spec.json`の同一AC参照を正本とし、source pointerは本Spec/Architecture/Story、test pointerは`contract.test.js`または`planning-source-lock.test.js`、evidence pointerはmachine-readable test artifactへ接続する。fixture/test evidenceをproduction evidenceへ昇格しない。

## 検証

`npm run test:run -- tests/contracts/p0-negative-boundary-contract-v1/contract.test.js tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js`
