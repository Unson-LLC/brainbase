---
title: Company Authority and Personal Boundary Component Roadmap
status: active
date: 2026-08-20
scope:
  - Unson-LLC/brainbase-unson
  - Unson-LLC/mana-runtime
governed_by: docs/management/milestones/brainbase-program-master-roadmap.md
program_packages:
  - T0
  - A0
  - P0
  - V0
  - O0
  - C0
---

# Company Authority and Personal Boundary Component Roadmap

## 0. Program order

この文書はCompany Authority / Personal Boundary領域の詳細なcomponent roadmapである。cross-repositoryの依存順と完成判定は、[`brainbase-program-master-roadmap.md`](./brainbase-program-master-roadmap.md)を正本とする。

旧`M0〜M5`は次へ読み替える。

| 旧ID | Program ID |
|---|---|
| M0 Company Authority | T0 + A0 |
| M1 Personal Identity & Promotion | P0 |
| M2 Umeda Organization E2E | V0-U |
| M3 TechKnight Shared Cloud | V0-T |
| M4 Management Execution Loop | O0 |
| M5 OSS / Organization Superset | C0 |

## 1. Dependency boundary

```text
T0 Multi-tenant foundation
  -> A0 Canonical Company Authority
  -> P0 Personal boundary & promotion

J0 + A0 + P0
  -> G0 Governed execution

T0 + A0 + P0 + G0 + C0
  -> V0-U Umeda
  -> V0-T TechKnight

D0 + G0
  -> O0 Mana management execution loop
```

T0のinfra作業とJ0のOSS Judgment DAG kernelは並列に進めてよい。会社データread/write、複数人Personal KG、RACI承認、MANA外部side effectはA0/P0/G0のgateを通るまで完成扱いにしない。

## 2. T0 integration requirements

このcomponentからT0へ要求する前提は次である。

- canonical tenant ID / tenant key
- tenant / connection revision
- organization、membership、project、resourceのtenant帰属
- workspace connection / revoke / reinstall
- credential brokerとsecret本文非保存
- contract / Usage / pricing / Operation Receipt
- idempotent provisioning、migration、rollback、quarantine
- production runtime、fault domain、readback
- cross-tenant negative E2E

T0のcode mergeだけではA0をproduction-readyとしない。実PostgreSQL、実identity、実runtimeのreadbackを必須とする。

## 3. A0 — Canonical Company Authority

### A0-A. Canonical identity resolution

**目的**

外部subjectをGraph上のcanonical personへ一意に解決する。

**Deliverables**

- Slack、Codex、Claude Code、service identityのmapping正本
- merged / inactive personの除外
- active membershipとorganizationの同一transaction readback
- person / membership revision
- unknown / ambiguous / inactiveの非開示fail-closed

**Gate**

- external subjectから別personを自己指定できない。
- alias、同名、merged person、別organizationのnegative fixtureが通る。
- default personへfallbackしない。

### A0-B. Canonical organization / project / resource scope

**目的**

organization、project、resourceをworkspace hintやrequest bodyではなく正本から解決する。

**Deliverables**

- organization / project membership
- tenant ownershipとresource ownershipの同時検証
- owner person解決
- resource revision
- scope conflict classification

**Gate**

- project code、organization名、workspace IDをauthorityとして使わない。
- scope外projectとcross-organization resourceを業務処理前に拒否する。
- hint不一致を暗黙補正しない。

### A0-C. RACI / policy authority resolver

**目的**

requested actionを決定論的に`auto / approval / human_action / deny`へ分類する。

**Deliverables**

- Responsible / Accountable / Approver / veto / escalation
- delegation
- placement policy
- capability / desired effect
- stop condition
- policy / RACI / delegation revision
- authority resolution receipt

**Gate**

- LLM confidenceで権限を決めない。
- stale revision、複数Accountable、承認者不在、policy不明を拒否する。
- `approval`と`human_action`を区別する。

### A0-D. Signed Canonical Execution Context

**目的**

tenant安全性と会社権限を一つの署名済みcontextへ統合する。

**Deliverables**

- `CanonicalExecutionContextV1`
- `company_authority_v1` capability
- canonical JSON / signature / source-lock
- issuer / audience / TTL / deployment
- identity / membership / resource / RACI / policy revision
- cross-repo positive / negative fixtures

**Gate**

- runtime自己申告のactor / authorizationを拒否する。
- context欠落、改ざん、期限切れ、stale revisionで業務operationへ到達しない。
- BrainbaseとManaが同一fixtureを通す。

### A0-E. Mana consumer cutover

**目的**

Manaをauthority authorからauthority consumerへ変更する。

**Deliverables**

- ingressはprovider identityとrequested actionだけを送る。
- Worker、Queue、Durable Object、Container、MCP、proxy、deliveryでcontextを再検証する。
- `auto / approval / human_action / deny`へ従う。
- workspace hintを非権威cacheへ降格する。
- Usage / Receiptへauthority receiptを結合する。

**Gate**

- Manaがorganization、project、owner、RACI、approver、policyを補完しない。
- Brainbase unavailable時にdefault placement / credentialへfallbackしない。
- retryでもauthority contextを再検証する。

### A0-F. Cross-repo negative E2E

最低matrix:

```text
Tenant A / Tenant B
Person A / Person B
Slack / Codex or Claude Code
read / write / approval / deny
fresh / stale revision
first delivery / retry / duplicate
```

必須ケース:

1. Tenant Aの正常実行
2. A→B、B→Aの越境拒否
3. Person A→B、B→AのPersonal相互非漏洩
4. unknown / ambiguous / inactive person拒否
5. scope外project / resource拒否
6. stale tenant / connection / RACI / policy revision拒否
7. approval指定者以外の承認拒否
8. Queue再配送時の副作用重複防止
9. external readback / Usage / Operation Receipt / authority receipt相関
10. `not_collected`非成功

## 4. P0 — Personal boundary and scope promotion

### P0-A. Personal owner no-fallback

- default ownerを完全廃止する。
- ownerは認証済みcanonical personまたは明示的delegation receiptからのみ導出する。
- service proxyのowner選択をdelegationへ拘束する。
- 全操作をaccess-scoped transactionへ統一する。

### P0-B. Owner and organization review separation

状態遷移:

```text
pending_owner_approval
  -> owner_rejected
  -> pending_org_review
       -> org_rejected
       -> org_accepted
```

- owner本人とorganization reviewerを別actorにする。
- reviewerはGM/CEO等の明示authorityを必要とする。
- owner approvalだけではGraph / organization Knowledge Eventへ書かない。
- decision actorをrequest bodyから採用しない。

### P0-C. Normalized promotion

- normalized fact / judgment / relationshipだけを対象にする。
- applicability scope、sensitivity、role minimumを持つ。
- evidence pointer / hashを持つ。
- owner consent receiptとorganization review receiptを持つ。
- Personal→Project→Organizationを同じschemaとversion historyで扱う。
- supersessionをsilent mutationにしない。

**P0 Gate**

- cross-person非漏洩。
- owner approval時Graph write 0件。
- organization reviewerがPersonal本文を閲覧しない。
- GraphからPersonal本文を復元できない。
- raw transcript、私的メモ、価値観原文をGraphへコピーしない。
- LLMの反復だけで昇格しない。

## 5. V0 internal proof

### V0-U Umeda

- 本人identity / JWT
- Personal KG collection / review / reuse
- 雲孫バックオフィス実務
- approvalまたはhuman action
- useful評価付きShip

### V0-T TechKnight

- 2つ以上の実tenant
- tenant別workspace / credential / receipt
- company data read / write canary
- Safety GateとValue Gate
- cross-tenant negative evidence

**V0 Gate**

- 各laneで実務Shipを1件以上閉じる。
- actor、tenant、project、authority、artifact、readbackを追跡できる。
- 境界事故0件。
- technical passだけでなくuser valueを記録する。

## 6. O0 Mana management execution loop

- goal / KGI / KPI / milestone / sprint / task / shipを監視する。
- readyなJudgment DAGを起動する。
- stagnationを検知する。
- Mana自身ができるものは権限内でShipする。
- 人間判断はcanonical owner / approverへ送る。
- 放置、期限、失敗をfollow-throughする。
- outcomeをBrainbaseへ返し、Evaluationと次の判断更新へ接続する。
- ohayo / oyasumi / retroへ同じcontractを適用する。

## 7. Blocked completion claims

次は必要なprogram dependencyを満たすまで完成扱いにしない。

- 組織版CLI / MCPの完全上位互換
- company dataを読む・書くruntime command
- 複数人Personal KG本番付与
- Personal→Organization本番昇格
- TechKnight company data canary
- Manaの自律的外部side effect
- RACIに基づく自動承認・エスカレーション

## 8. Release gates

| Gate | Program package | 条件 |
|---|---|---|
| G0 Contract | R0 / T0 / J0 | ADR、schema、fixture、source-lockが一致 |
| G1 Identity | A0 | external subject→person→membershipが正本解決 |
| G2 Authority | A0 | RACI / policyからdecisionとcanonical actorを解決 |
| G3 Personal | P0 | no-fallback、二段階review、normalized promotion |
| G4 Staging | A0 / P0 / G0 | 2 tenant × 2 person negative E2E |
| G5 Umeda | V0-U | 本人JWT、学習、review、実務Ship、useful評価 |
| G6 TechKnight | V0-T | 2実tenantのSafety / Value Gate |
| G7 Execution | O0 | stagnation検知から証拠付きShip |
| G8 Superset | C0 | 組織版CIでOSS public contract全通過 |

## 9. Completion definition

Company Authority / Personal Boundary領域は次がすべて揃うまで完了しない。

- Brainbaseが会社権限を正本解決する。
- Manaが権限情報を自己生成しない。
- 署名済みcontextが全runtime境界を通る。
- 2 tenant × 2 personの成功・拒否がfresh E2Eで証明される。
- actor、scope、authority、execution、readback、Usage、Receiptが同一correlation IDで追える。
- Personal owner fallbackが0件。
- owner approvalだけでのGraph writeが0件。
- 境界事故が0件。
