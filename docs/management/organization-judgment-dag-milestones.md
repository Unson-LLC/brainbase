---
title: Organization Judgment DAG Component Roadmap
status: active
date: 2026-08-20
scope: brainbase-unson / enterprise organization deployment
governed_by: docs/management/milestones/brainbase-program-master-roadmap.md
program_packages:
  - G0
  - C0
  - D0
  - V1
  - V2
  - R2
  - E0
---

# Organization Judgment DAG Component Roadmap

## 0. Program order

この文書はorganization / enterprise領域の詳細なcomponent roadmapである。cross-repositoryの依存順・並列実行条件・完成判定は、[`milestones/brainbase-program-master-roadmap.md`](./milestones/brainbase-program-master-roadmap.md)を正本とする。

旧`M0〜M8`は次へ読み替える。

| 旧ID | Program ID |
|---|---|
| M0 Shared-core alignment | R0 + C0 |
| M1 Brainbase Deployment DAG v0 | D0 |
| M2 Expert judgment capture | D0 |
| M3 Agent-assisted deployment | G0 + D0 |
| M4 Growin proof | V1 |
| M5 Second-company proof | V2 |
| M6 Enterprise Authority Graph | A0 + G0 |
| M7 Replay / organizational backtest | R1 + R2 |
| M8 Production enterprise operations | E0 |

## 1. Architecture invariant

`brainbase-unson`はorganization専用の別DAG schemaを定義しない。

```text
brainbase OSS
  ├─ shared ontology primitives
  ├─ Judgment DAG node / edge semantics
  ├─ local runtime and runner interfaces
  ├─ artifact / execution log
  ├─ versioning / replay / evaluation
  └─ personal / project / organization scope
          ↓ consume
brainbase-unson
  ├─ tenant identity
  ├─ Canonical Company Authority
  ├─ Authority Graph
  ├─ approval / escalation
  ├─ RBAC / clearance
  ├─ managed connectors
  ├─ audit / compliance
  ├─ hosted / multi-user runtime
  └─ organization operations
```

依存方向は`brainbase-unson -> brainbase`のみとし、organization版に同名の別semantic implementationを作らない。

## 2. Program dependency

```text
J0 + A0 + P0
  -> G0 Governed execution

J0 + G0
  -> C0 OSS / Organization conformance
  -> D0 Brainbase Deployment DAG

T0 + A0 + P0 + G0 + C0
  -> V0 Internal proof

D0 + C0 + V0
  -> V1 Growin

V1 + C0
  -> V2 Second company

R1 + V1
  -> R2 Organizational backtest

V2 + R2 + O0 + C0
  -> E0 Enterprise production
```

## 3. G0 — Governed organization execution

**目的**

OSSのrunner contractを、会社権限・承認・監査へ接続する。

**Deliverables**

- human / agent / external / committee runner
- pending human step
- approval queue
- accountable owner / approver / veto / escalation
- scoped / delegated / time-bounded authority
- threshold-based approval
- signed Canonical Execution Context binding
- immutable audit event
- retry / locking / idempotency
- low-confidence / authority-sensitive escalation

**Exit gate**

- same nodeをhumanとagentが同一input contractで実行できる。
- agent confidenceがauthorityを上書きしない。
- unauthorized approver、stale context、missing accountable ownerを拒否する。
- approval、execution artifact、authority receiptが結合される。
- Executionがupstream Judgmentをsilent rewriteしない。

## 4. C0 — OSS / Organization complete conformance

**目的**

organization版をOSSの完全上位互換にし、semantic forkと二重実装を排除する。

**Deliverables**

- OSS public surface inventory
- npm exports / CLI / MCP / module / persistence / config mapping
- version-pinned public contract
- organization adapter
- same-name semantic conformance
- organization-only extension inventory
- migration / compatibility / deprecation policy
- OSS contract suiteをorganization CIで実行

**Exit gate**

- OSS全公開contractがorganization CIでexact versionに対してpassする。
- authentication、tenant、authority、failure semanticsを含めて一致する。
- local-only機能はsafe adapterまたは明示的`non_applicable`になる。
- organization版に別のJudgment DAG coreが存在しない。
- 入口数だけで上位互換を宣言しない。

## 5. D0 — Brainbase Deployment DAG dogfood

### D0-A. Deployment DAG v0

Initial chain:

```text
Customer Context
  -> Customer Maturity Judgment
  -> Problem Structure Judgment
  -> Deployment Pattern Selection
  -> Scope / Resource Decision
  -> Proposal
  -> Implementation
  -> Outcome Evaluation
```

**Exit gate**

- real deployment 1件をend-to-endでtraverseできる。
- customer-specific artifactをcustomer scopeへ保持する。
- all Keigo-only decisionをhuman-run nodeとして表示する。
- input / output / dependency / artifactが閲覧できる。

### D0-B. Expert judgment capture

**Deliverables**

- escalation event
- rationale / evidence
- missing context / missing judgment node classification
- H0〜H4 delegation maturity
- reusable-pattern promotion candidate

Maturity:

```text
H0 expert-only implicit
H1 expert-only explicit contract
H2 agent drafts, expert approves
H3 agent executes, expert audits
H4 delegated, exception-only escalation
```

**Exit gate**

- expert escalation count / deploymentを計測できる。
- repeated escalationをmissing nodeまたはmissing contextへclusterできる。
- 少なくとも1つの反復判断をreusable node / policyへ昇格する。

### D0-C. Agent-assisted deployment

**Deliverables**

- explicit context contractを使うagent runner
- human approval
- authority check
- expert decisionとのcomparison
- low confidence escalation

**Exit gate**

- material judgment node 2件以上がH2以上へ移る。
- exact inputに対してagent outputをauditできる。
- authority-sensitive caseをauto-commitしない。

## 6. V1 — Growin design-partner proof

**目的**

synthetic ontologyではなく実会社でCompany Brainを証明する。

**Exit gate**

- evidence→judgment→decision→resource→action→outcomeのlive chainが1件以上ある。
- current policy、根拠、変更権限、downstream impactを回答できる。
- invalid / superseded judgmentをcurrentとして返さない。
- Growin固有要件とreusable Brainbase coreを分離する。
- D0のexpert escalation baselineと比較できる。

## 7. V2 — Second-company portability proof

**Target**

Kartz Media Worksまたは別の第二design partner。

**Exit gate**

- same DAG semanticsをschema forkなしで使う。
- reusable Deployment nodeを再利用または明示的versioningする。
- customer-specific adapterをshared core外へ保つ。
- comparable phaseのKeigo escalationが第一社より減る。
- Growin固有consultingとproduct capabilityを区別できる。

## 8. R2 — Organizational replay / backtest

**目的**

実組織のrecorded contextとoutcomeを使い、判断構造のversion改善を検証する。

**Deliverables**

- immutable organization run snapshot
- recorded context replay
- DAG version comparison
- outcome attachment
- explicit goal / evaluation function
- node-level calibration
- causal evidence limitation
- promotion / supersession candidate

**Exit gate**

- prior organization decisionをrecorded contextから再生できる。
- proposed versionとの比較がhistoryを変更しない。
- bad outcomeとbad judgmentを証拠なしに同一視しない。
- causal evidence不足を断定へ丸めない。

## 9. E0 — Production enterprise operations

**目的**

shared Judgment DAGを複数組織で安全・継続的に運用する。

**Deliverables**

- RBAC / clearance / data classification
- SSO / SCIM / directory integration
- approval queue operations
- immutable audit retention
- managed connector / secret lifecycle
- concurrency / locking
- retry / failure recovery
- HA / backup / disaster recovery
- observability / SLO / cost attribution
- retention / deletion / export
- onboarding / offboarding

**Exit gate**

- enterprise controlがshared DAG modelを包み、second semantic implementationを作らない。
- customerがexplicit authorityとaudit trail付きで本番運用できる。
- failure drill、restore、credential rotation、tenant deletionをreadbackできる。
- V2、R2、O0の成果がproduction pathで維持される。

## 10. KPI hierarchy

Primary:

- expert escalations requiring Keigo / deployment

Secondary:

- Keigo hours / deployment
- gross profit / Keigo hour
- material nodeのH3/H4比率
- reusable judgment node ratio
- deployment cycle time
- replay coverage
- authority resolution coverage
- outcome calibration by DAG version
- second-company reuse ratio
- boundary incident count

document数、ontology type数、agent数は完了指標ではない。real judgmentがobservable input、authority、output、outcome、evaluationを通過して初めて進捗とする。
