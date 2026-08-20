---
title: Brainbase Program Master Roadmap
status: active
date: 2026-08-20
scope:
  - Unson-LLC/brainbase
  - Unson-LLC/brainbase-unson
  - Unson-LLC/mana-runtime
  - Brainbase customer deployments
authority: cross-repository dependency order and completion gates
---

# Brainbase Program Master Roadmap

## 0. この文書の権威

この文書を、Brainbaseプログラム全体の**依存順・並列実行条件・完了条件の正本**とする。

既存のロードマップは削除しない。各領域の詳細なcomponent roadmapとして残す。

- `docs/management/milestones/M0-company-authority-and-personal-boundary.md`
- `docs/management/organization-judgment-dag-milestones.md`
- `Unson-LLC/brainbase/docs/management/judgment-dag-milestones.md`

競合した場合の優先順位は次の通り。

1. このMaster Roadmap: cross-repositoryの依存順、開始条件、完了条件
2. ADR / Contract / accepted Spec: semantic boundaryと実装契約
3. Component roadmap: 各work package内部の詳細
4. Story / Task: 個別変更単位

既存文書の`M0`、`M1`等はcomponent-local IDであり、プログラム全体の順序を意味しない。以後、全体管理には本書の`R0 / T0 / J0 / A0 ...`を使う。

## 1. 目標と責務境界

最終目標は、会社の判断を次の循環として外部化し、再実行・委譲・評価・改善できる状態を作ることである。

```text
Evidence / State
  -> Context
  -> Judgment
  -> Resource / Risk
  -> Execution
  -> Outcome
  -> Evaluation
  -> Judgment update
```

製品境界は次の通り。

```text
brainbase OSS
  = shared ontology / Judgment DAG semantics / local runtime /
    artifacts / versioning / replay / evaluation primitives

brainbase-unson
  = OSSの完全上位互換 +
    multi-tenant / company authority / approvals / audit /
    managed connectors / multi-user enterprise runtime

mana-runtime
  = goalとcadenceからDAGを起動し、優先順位付けし、
    人とagentを調整し、停滞を検知し、Shipまで追跡するoperator
```

`brainbase-unson`はOSSのsemantic modelをforkしない。`mana-runtime`は権限を推測・生成せず、Brainbaseが正本解決した署名済みauthorityだけをconsumeする。

## 2. 依存DAG

```text
R0 Program contract
├── T0 Multi-tenant production foundation
└── J0 Shared Judgment DAG kernel

T0 ────────────────> A0 Canonical Company Authority ──> P0 Personal boundary & promotion
J0 ────────────────> R1 Replay / evaluation primitives

J0 + A0 + P0 ─────> G0 Governed execution & approval runtime

J0 + G0 ──────────> C0 OSS / Organization complete conformance
J0 + G0 ──────────> D0 Brainbase Deployment DAG dogfood

T0 + A0 + P0 + G0 + C0 ──> V0 Internal multi-user proof
D0 + G0 ──────────────────> O0 Mana management execution loop

D0 + C0 + V0 ─────────────> V1 Growin design-partner proof
V1 + C0 ──────────────────> V2 Second-company portability proof
R1 + V1 ──────────────────> R2 Organizational replay / backtest

V2 + R2 + O0 + C0 ────────> E0 Enterprise production
```

これは完全な直列計画ではない。依存を満たすfrontierは同時に進める。

## 3. 実行wave

| Wave | 並列実行してよいwork package | 進入条件 |
|---|---|---|
| W0 | R0 | なし |
| W1 | T0、J0 | R0 |
| W2 | A0、R1 | T0またはJ0の必要contractがsource-lock済み |
| W3 | P0 | A0 identity/authority contractが固定 |
| W4 | G0 | J0、A0、P0のcontractとnegative fixtureが固定 |
| W5 | C0、D0 | G0 integration contractが固定 |
| W6 | V0、O0 | 各hard dependencyの実装・検証が完了 |
| W7 | V1 | D0、C0、V0 |
| W8 | V2、R2 | V1、および各固有dependency |
| W9 | E0 | V2、R2、O0、C0 |

下流の設計・fixture・mock実装は、上流が`contract_ready`になれば先行してよい。ただし、本番経路への統合、完成宣言、releaseはhard dependencyが`done`になるまで禁止する。

## 4. Work package一覧

| ID | Work package | 正本repo | Hard dependencies | 完了時の利用者成果 |
|---|---|---|---|---|
| R0 | Program contract and dependency lock | `brainbase-unson` | なし | 全repoが同じ依存DAGと完了語彙を使う |
| T0 | Multi-tenant production foundation | `brainbase-unson` / `mana-runtime` | R0 | 複数tenantが混線せず、本番導入・移行・課金証跡まで追える |
| J0 | Shared Judgment DAG kernel | `brainbase` | R0 | FX/keiba型の判断DAGを共通semantic/runtimeとして実行できる |
| A0 | Canonical Company Authority | `brainbase-unson`; consumer=`mana-runtime` | T0 | 人物・所属・RACI・policyをBrainbaseが解決し署名する |
| R1 | Replay / evaluation primitives | `brainbase` | J0 | 過去runを不変snapshotから再実行・比較できる |
| P0 | Personal boundary and scope promotion | `brainbase-unson` / `brainbase` | A0 | 個人知識が漏れず、本人同意と組織採用を経て昇格する |
| G0 | Governed execution and approval runtime | `brainbase` / `brainbase-unson` | J0、A0、P0 | human/agent/committee実行が同一DAG上で権限付きに動く |
| C0 | OSS / Organization complete conformance | `brainbase-unson` consuming `brainbase` | J0、G0 | 組織版がOSS全公開契約を安全に包含する |
| D0 | Brainbase Deployment DAG dogfood | `brainbase-unson` | J0、G0 | 導入判断がend-to-endで明示され、圭吾依存を計測できる |
| V0 | Internal multi-user proof | `brainbase-unson` | T0、A0、P0、G0、C0 | 梅田さん・TechKnightが本人権限で実務Shipを閉じる |
| O0 | Mana management execution loop | `mana-runtime` | D0、G0 | 停滞検知から権限内実行・人間判断・Shipまで追跡する |
| V1 | Growin design-partner proof | `brainbase-unson` | D0、C0、V0 | 実会社でevidence→outcomeの判断chainが稼働する |
| V2 | Second-company portability proof | `brainbase-unson` | V1、C0 | schema forkなしで第二社へ再利用できる |
| R2 | Organizational replay / backtest | `brainbase` / `brainbase-unson` | R1、V1 | 実組織の過去判断をversion間比較できる |
| E0 | Enterprise production | `brainbase-unson` / `mana-runtime` | V2、R2、O0、C0 | Company Brainを安全・継続的に本番運用できる |

## 5. Work package詳細

### R0 — Program contract and dependency lock

**目的**

- cross-repositoryの依存順を一つにする。
- 同名`M0`の衝突を解消する。
- Codexが機械的にready frontierを計算できるようにする。

**Deliverables**

- このMaster Roadmap
- `brainbase-program-master-roadmap.json`
- component roadmapとのcrosswalk
- 共通status vocabulary
- Codex orchestrator prompt

**Exit gate**

- 全component roadmapが本書へ従属すると明記される。
- hard dependencyを無視した完成宣言を禁止する。
- docs mergeを実装完了と扱わない。

### T0 — Multi-tenant production foundation

**目的**

tenant、identity provider connection、contract、usage、receipt、credential、runtimeを一貫したtenant境界へ載せる。

**Deliverables**

- canonical immutable `tenant_id`と人間可読`tenant_key`
- tenant / connection revision history
- tenant-owned tablesのRLS・FK・transaction boundary
- workspace connection / reinstall / revoke
- credential brokerとsecret本文非保存
- contract / quota / usage / pricing / Operation Receipt
- idempotent provisioning、migration、rollback、quarantine
- Cloud / compatible OSS protocol negotiation
- fault-domain分類
- production deployment runbookとreadback

**Exit gate**

- 実PostgreSQL、実runtime、実identityでcross-tenant negative E2Eが通る。
- production schema、bridge、secret、OAuth、readbackが実施済み。
- retry・再配送でも外部副作用がexactly onceまたは明示的at-least-once制御になる。
- `not_collected`をpassまたは0へ丸めない。

### J0 — Shared Judgment DAG kernel

**目的**

FX / keibaで確立したDAG設計原則を、個人・project・organizationで共通の判断基盤へする。

**必須継承原則**

1. layer ownershipを明示し、下流が上流判断を再実装しない。
2. 入出力はtyped contractだけで渡し、hidden state side channelを禁止する。
3. dependencyとlayer directionを実行前に検証する。
4. 全runでartifactとexecution logを残す。
5. DAG versionをfirst-classに扱い、silent mutationを禁止する。
6. EvaluationをExecutionから分離する。

**Deliverables**

- Context / Judgment / Resource-Risk / Execution / Evaluationの5 layer
- node / edge contract
- `depends_on` / `supports` / `contradicts` / `gates` / `supersedes`
- deterministic runner
- runner interface: human / agent / external / committee
- artifact store、execution log、version identifier
- personal / project / organization scope primitive
- local-first runtimeとGraph/Decision互換

**Exit gate**

- Context→Judgment→Resource→Execution→Evaluationが決定論的に完走する。
- dependency欠落、循環、逆layer依存を実行前に拒否する。
- run input、output、artifact、versionが再読込できる。
- organization版がsemantic forkなしでconsumeできる。

### A0 — Canonical Company Authority

**目的**

Brainbaseを会社権限の唯一の正本解決者にし、MANAをauthority consumerへ限定する。

**Deliverables**

- external subject→canonical person
- active membership→organization / project / resource
- owner、RACI、delegation、policy、capability、stop condition
- `auto / approval / human_action / deny`
- Signed Canonical Execution Context
- identity / membership / resource / RACI / policy revision
- authority resolution receipt
- MANA ingress / Queue / Worker / Container / MCPでの再検証

**Exit gate**

- 2 tenant × 2 person × read/write/approval/denyのfresh negative E2E。
- unknown、ambiguous、inactive、scope外、stale revisionを処理前に拒否する。
- MANAがperson、organization、project、owner、approverを補完しない。
- actor、scope、authority、execution、Usage、Receiptが同一correlation IDで追える。

### R1 — Replay / evaluation primitives

**目的**

判断品質を印象ではなく履歴と明示的評価関数で比較できるようにする。

**Deliverables**

- immutable run snapshot
- historical context replay
- outcome attachment
- explicit goal / metric / scoring contract
- DAG version comparison
- node-level calibration
- evaluation event-set immutability

**Exit gate**

- 過去versionを当時のcontextで再実行できる。
- 新旧versionを履歴改変なしで比較できる。
- Evaluationが評価対象のevent setを変更できない。

### P0 — Personal boundary and scope promotion

**目的**

Personal KGの所有・閲覧・昇格をcanonical personと明示的同意へ拘束する。

**Deliverables**

- default owner / implicit fallbackの完全廃止
- authenticated personまたはdelegation receiptからownerを導出
- access-scoped transaction
- owner personal approval
- owner consent for organization review
- distinct organization reviewer
- normalized payloadとevidence pointer
- Personal→Project→Organizationの同一schema promotion
- supersessionとhistorical query

**Exit gate**

- 佐藤→梅田、梅田→佐藤の相互非漏洩。
- owner承認だけではGraph write 0件。
- 組織reviewerはPersonal本文を閲覧しない。
- GraphからPersonal本文を復元できない。
- LLM反復だけを根拠に自動昇格しない。

### G0 — Governed execution and approval runtime

**目的**

J0のrunnerをA0のauthorityで拘束し、人間・agent・committeeが同じDAG contractを安全に実行できるようにする。

**Deliverables**

- pending human step
- approval queue
- accountable owner / approver / veto / escalation
- threshold-based approval
- scoped・delegated・time-bounded authority
- runner input/output exact binding
- low confidence / authority-sensitive escalation
- immutable audit event
- retry / locking / idempotency
- promotion hooks

**Exit gate**

- 同じnodeをhumanとagentで実行し、同一input contractで比較できる。
- agent confidenceがauthorityを上書きしない。
- unauthorized approver、stale context、missing accountable ownerを拒否する。
- approval後の実行artifactとauthority receiptが結合される。

### C0 — OSS / Organization complete conformance

**目的**

組織版を、OSSのsemantic model・安全契約・公開面を包含する完全上位互換にする。

**依存方向**

```text
brainbase-unson -> version-pinned brainbase public contract / package
brainbase       -X-> brainbase-unson
```

**Deliverables**

- npm exports / CLI / MCP / module / persistence / config inventory
- public contract source-lock
- OSS CLI / MCP全入口の組織版binding
- 同名入口のsemantic conformance
- organization-only extension inventory
- duplicate implementation削減
- compatibility / migration / deprecation policy
- organization CIでOSS contract suiteを実行

**Exit gate**

- OSS全公開contractが組織版CIでexact versionに対してpassする。
- 23/23等の入口数だけでなく、認証・tenant・authority・failure semanticsも一致する。
- local-only機能は安全なadapterまたは明示的`non_applicable`になる。
- organization版に別のJudgment DAG semantic implementationが存在しない。

### D0 — Brainbase Deployment DAG dogfood

**目的**

Brainbase導入を、圭吾の暗黙判断ではなく再利用可能なOrganization Judgment DAGへ変える。

**Initial chain**

```text
Customer Context
  -> Maturity Judgment
  -> Problem Structure Judgment
  -> Deployment Pattern
  -> Scope / Resource Decision
  -> Proposal
  -> Implementation
  -> Outcome Evaluation
```

**Deliverables**

- real deployment 1件のend-to-end run
- expert-only nodeの明示
- escalation eventとrationale/evidence
- H0〜H4 delegation maturity
- reusable pattern candidate
- customer-specific scopeとshared Deployment scopeの分離

**Exit gate**

- 全Keigo-only判断がhuman-run nodeとして可視化される。
- expert escalation数 / deploymentを計測できる。
- 少なくとも1つの反復判断がreusable nodeへ昇格する。
- chat内の暗黙判断を完了証拠にしない。

### V0 — Internal multi-user proof

**目的**

架空fixtureではなく、雲孫とTechKnightの実利用で安全性と価値を同時に証明する。

**Lane V0-U: Umeda**

- 本人identity / JWT
- Personal KG collection / review / reuse
- 雲孫バックオフィス実務
- approvalまたはhuman action
- useful評価付きShip

**Lane V0-T: TechKnight**

- 2つ以上の実tenant
- company data read / write canary
- tenant別workspace / credential / receipt
- safety gateとvalue gate
- cross-tenant negative evidence

**Exit gate**

- 各laneで実務Shipが1件以上閉じる。
- 本人・tenant・project・authority・artifact・readbackが追跡できる。
- 境界事故0件。
- 「動いた」だけでなく利用者価値を記録する。

### O0 — Mana management execution loop

**目的**

Manaを、判断DAGを継続的に起動し、会社のゴールへ向けてShipを前進させるoperatorにする。

**Deliverables**

- goal / KGI / KPI / milestone / sprint / task / shipの状態監視
- priority selection
- DAG trigger policy
- stagnation detection
- auto / approval / human_action / deny routing
- reminder / escalation / follow-through
- outcome readbackとnext judgment update
- routine integration: ohayo / oyasumi / retro

**Exit gate**

- 同じgoverned contractを梅田業務とTechKnightで再利用する。
- Mana自身が実行可能なものはShipまで閉じる。
- 人間判断は指定owner/approverへ送られ、放置を検知する。
- Manaがauthorityやupstream judgmentを自己生成しない。

### V1 — Growin design-partner proof

**目的**

Company Brainを実会社の判断chainで証明し、コンサル成果とproduct capabilityを分離する。

**Exit gate**

- evidence→judgment→decision→resource→action→outcomeが1 chain以上稼働する。
- current policy、根拠、変更権限、downstream impactを回答できる。
- invalid / superseded judgmentをcurrentとして返さない。
- Growin固有要件とreusable coreを分離する。
- deployment expert escalationがV0/D0 baselineから計測される。

### V2 — Second-company portability proof

**目的**

Growin固有の成功を、再利用可能なproduct capabilityへ昇格させる。

**Target**

Kartz Media Worksまたは別の第二design partner。

**Exit gate**

- 同じDAG semanticsをschema forkなしで利用する。
- reusable nodeはそのまま再利用または明示的versioningされる。
- customer adapterはshared coreへ混入しない。
- comparable phaseでKeigo escalationが第一社より減る。

### R2 — Organizational replay / backtest

**目的**

実組織の判断履歴を使い、DAG versionの改善を検証する。

**Deliverables**

- V1のrecorded context / outcome dataset
- organization DAG version comparison
- counterfactual / sensitivity analysisの明示的限界
- bad outcomeとbad judgmentの区別
- calibration report

**Exit gate**

- 過去判断をrecorded contextから再生できる。
- proposed versionとの比較が履歴を変更しない。
- causal evidence不足を断定へ丸めない。
- 評価結果がpromotion / supersession candidateへ接続される。

### E0 — Enterprise production

**目的**

Company Brainを複数組織で継続運用できるenterprise productにする。

**Deliverables**

- SSO / SCIM / directory integration
- RBAC / clearance / data classification
- managed connector / secret lifecycle
- approval queue operations
- immutable audit retention
- concurrency / locking / retry / recovery
- HA / backup / disaster recovery
- observability / SLO / cost attribution
- retention / deletion / export
- tenant onboarding / offboarding

**Exit gate**

- enterprise controlsがshared DAG modelを包み、second semantic implementationを作らない。
- customerがexplicit authorityとaudit trail付きで本番運用できる。
- failure drill、restore、credential rotation、tenant deletionをreadbackできる。
- V2、R2、O0の成果がproduction pathで維持される。

## 6. Component roadmap crosswalk

### 6.1 旧Company Authority roadmap

| 旧ID | 本書ID |
|---|---|
| M0 Company Authority | T0 + A0 |
| M1 Personal Identity & Promotion | P0 |
| M2 Umeda Organization E2E | V0-U |
| M3 TechKnight Shared Cloud | V0-T |
| M4 Management Execution Loop | O0 |
| M5 OSS / Organization Superset | C0 |

### 6.2 OSS Judgment DAG roadmap

| 旧ID | 本書ID |
|---|---|
| M0 Architecture lock | R0 + J0 contract |
| M1 Local DAG kernel | J0 |
| M2 Human + Agent runners | G0 |
| M3 Replay and evaluation | R1 |
| M4 Brainbase Deployment dogfood | D0 |
| M5 Scope promotion | P0 |
| M6 Organization-ready primitives | G0 + C0 |

### 6.3 Organization Judgment DAG roadmap

| 旧ID | 本書ID |
|---|---|
| M0 Shared-core alignment | R0 + C0 |
| M1 Deployment DAG v0 | D0 |
| M2 Expert judgment capture | D0 |
| M3 Agent-assisted deployment | G0 + D0 |
| M4 Growin proof | V1 |
| M5 Second-company proof | V2 |
| M6 Enterprise Authority Graph | A0 + G0 |
| M7 Replay / backtest | R1 + R2 |
| M8 Production enterprise operations | E0 |

## 7. Status vocabulary

| Status | 意味 |
|---|---|
| `planned` | 依存・contractが未確定 |
| `contract_ready` | interface、fixture、acceptance criteriaが固定。下流の設計着手可 |
| `implementing` | 独立branch/worktreeで実装中 |
| `verified` | exact HEADでunit/integration/E2Eとreview gateを通過 |
| `production_proven` | stagingまたは本番で外部readbackとnegative evidence取得済み |
| `done` | hard dependencyと利用者成果を含むExit gateをすべて満たした |

禁止事項:

- docs mergeを`done`にしない。
- mock E2Eだけで`production_proven`にしない。
- test未実行を0件またはpassへ丸めない。
- 子packageを親packageより先に`done`にしない。
- open PRの存在を実装完了と扱わない。

## 8. 並列開発ルール

1. ready frontier上の独立work packageだけを並列化する。
2. 1 Story = 1 branch = 1 worktree = 1 primary ownerとする。
3. 同一file、schema、public contractを触るStoryは同時にmergeしない。
4. shared semantic changeは必ず`brainbase`を先に変更し、`brainbase-unson`はversion-pinned consumerとして追従する。
5. tenant / authority / credential / public side effectはnegative E2Eなしでmergeしない。
6. dependencyが`contract_ready`なら下流のSpec・fixtureを開始できるが、releaseはdependency `done`まで禁止する。
7. PRは依存順にmergeし、downstream branchはmerge済みSHAへrebaseする。
8. exact HEADのCI、review、VibePro evidenceを使い、古い証跡を再利用しない。
9. production未実施は`not_collected`のまま残す。
10. orchestratorは進捗量ではなく、blocked dependency、critical path、利用者成果を最適化する。

## 9. Current baseline snapshot — 2026-08-20

このsnapshotは開始時の参考であり、各orchestrator runでGitHubから再判定する。

- T0: 基盤実装とproduction provisioning codeは存在するが、本番schema / bridge / OAuth / exact E2Eのreadbackが完了条件。
- J0: architectureとroadmapはaccepted。runtime kernelは未完。
- A0: company authority runtimeの実装は存在するが、cross-repo fresh E2Eと全consumer cutoverを完了条件とする。
- P0: owner no-fallbackとowner/org review分離は進行済み。normalized payload、Graph publication、scope promotionの完走は未完。
- C0: OSS superset inventoryとCLI/MCP compatibilityのstackが存在するが、完全上位互換の完成宣言は禁止。
- D0以降: 上流contractを使った実運用証拠を作る段階。

## 10. Program metrics

優先順位は次の通り。

1. **Expert escalation count / deployment**
2. **Keigo hours / deployment**
3. **Delegation maturity: material nodeのH3/H4比率**
4. **Replay coverage**
5. **Authority resolution coverage**
6. **Outcome calibration by DAG version**
7. **Second-company reuse ratio**
8. **Gross profit / Keigo hour**
9. **Boundary incident count**
10. **Time from judgment request to Ship**

node数、document数、ontology type数、PR数は成果指標ではない。
