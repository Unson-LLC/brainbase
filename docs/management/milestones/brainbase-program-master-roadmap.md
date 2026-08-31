---
title: Brainbase Program Master Roadmap
status: active
date: 2026-08-20
updated_at: 2026-08-25
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
- J0: deterministic runnerとrun recordに加え、exact local HEAD `684f8c45c7c99d720c4acd7eca90dcda151c6196`でcontent-addressed save、検証付きreload、fresh-process package consumerまで検証済み。組織版exact/pinned consumerは`not_collected`のため、statusは`implementing`のまま。
- A0: company authority runtimeの実装は存在するが、cross-repo fresh E2Eと全consumer cutoverを完了条件とする。
- P0: owner no-fallbackとowner/org review分離は進行済み。normalized payload、Graph publication、scope promotionの完走は未完。
- C0: OSS superset inventoryとCLI/MCP compatibilityのstackが存在するが、完全上位互換の完成宣言は禁止。
- D0以降: 上流contractを使った実運用証拠を作る段階。

### 9.1 J0 exact local execution evidence — 2026-08-31

`story-j0-durable-run-artifact-contract`を`upstream/develop@76021adcf22c92833136b5481bf3a72b736bdb4b`起点のbranch `codex/j0/durable-run-artifact-contract-reconcile`で実装し、HEAD `684f8c45c7c99d720c4acd7eca90dcda151c6196`へ固定した。VibeProは`0.2.0-beta.17`を使用し、切替・downgrade・installは行っていない。

- content-addressed saveと検証付きreloadは、focused 3 files / 35 tests、typecheck、build、full 47 files / 469 tests、E2E 2 files / 2 testsでpassした。
- fresh package consumerはsaver process終了後に別loader processが同一artifactを再読込し、runner再実行0回を確認した。
- 独立差分reviewは4指摘をclosedとし、AC-001〜AC-005に追加blocking findingなしと判定した。
- ADR-022が要求する組織版のexact/pinned package consumer smokeは`not_collected`である。類似実装やローカルtarball consumerを代替証拠にしない。
- このHEADはローカルcommitであり、merge・公開・deploy・本番変更の証拠ではない。J0は`implementing`を維持し、work packageを`done`へ昇格しない。

## 10. Live external delivery reconciliation — 2026-08-25

この節は、外部リポジトリで発生したマージ・リリースと、P0 source-lockが参照するA0 producer lineageのprovenanceだけを記録する。取得時刻は`2026-08-25T14:10:02Z`で、GitHubのPRメタデータ、GitHubのrelease/tag、npm packageメタデータをreadbackした。A0識別子とP0 source-lock lineageの再照合は`2026-08-25T14:36:32Z`にGitHub PRメタデータとancestor関係を再取得した。

このreconciliationの契約は専用Story [`story-program-external-delivery-reconciliation-v1`](../stories/active/story-program-external-delivery-reconciliation-v1.md) → [Architecture](../../architecture/story-program-external-delivery-reconciliation-v1.md) → [Spec](../../specs/program-external-delivery-reconciliation-v1.md) → [Task](../tasks/program-external-delivery-reconciliation-v1.json) → [契約テスト](../../../tests/contracts/program-external-delivery-reconciliation.test.js) に分離する。P0 Storyのpurpose/ACやP0 Gateへ、roadmap照合の責務を追加しない。

このreconciliationのfreshness scopeは`A0 producer #1302 -> P0 #1304 source-lock lineage and external delivery identity`に限定し、scope-specificな再照合時刻は`2026-08-25T14:36:32Z`である。PRのrepo、番号、role、state、title、base/head、merge SHA/時刻は、機械正本とこのMarkdownの同一行を契約テストで照合する。

`MERGED`、`published`、npmへの公開は外部deliveryの事実であり、Master Roadmapのwork packageを`verified`、`production_proven`、`done`へ昇格する証拠ではない。この節では独立reviewの判定結果を自己記録しない。特に、外部マージはT0、A0、G0、Gate、productionの完了を満たさない。

| 対象 | 外部deliveryのprovenance | Program上の扱い |
|---|---|---|
| A0 producer contract delivery / `Unson-LLC/brainbase-unson#1302` | `role=producer_contract_delivery`; `state=MERGED_EXTERNALLY`; `title=Canonical Company Authority Producer Contract v1 (completed)`; `base develop@0ed0cc9828018a893bb4bbc426b5d0639f68e732` → `head codex/a0/company-authority-producer-contract-v1-r2@7bc849da01dedabfced2eeca8943534cf3dee78e`、merge `ad908bce7b90678f9ed7f1c570f808bdf1a500ad`、`mergedAt 2026-08-21T19:09:27Z`。post-merge transient snapshotは`pre_merge_health: mergeable=UNKNOWN, merge_state_status=UNKNOWN`であり、immutableなmerge provenanceの判定には使わない。 [PR #1302](https://github.com/Unson-LLC/brainbase-unson/pull/1302) | source-lockが固定するA0の**契約delivery**のみ。A0 work-package、consumer、独立review、Gate、productionの完了へ昇格しない。 |
| P0 / `Unson-LLC/brainbase-unson#1304` | `role=negative_boundary_contract_delivery`; `state=MERGED_EXTERNALLY`; `title=story-p0-negative-boundary-contract-v1`; `base develop@3ff5b0766d3414051b4fd15da7617896ea534eed` → `head codex/p0-negative-boundary-contract-v1@3f9e06373831485fa48175487515fd746c69a590`、merge `27b37cdaac50967edff095b696c540322feb75c2`、`mergedAt 2026-08-25T12:29:25Z`。 [PR #1304](https://github.com/Unson-LLC/brainbase-unson/pull/1304) | 外部マージのみ。A0/T0のexit evidence、Gate、productionを満たさず、P0のstatusは昇格しない。 |
| J0 / `Unson-LLC/brainbase#479` | `role=judgment_contract_delivery`; `state=MERGED_EXTERNALLY`; `title=J0 typed DAG contract and preflight validation`; `base develop@7e5d5693f988f4ba84072c5910ef32f0e70871e1` → `head codex/j0/judgment-dag-core-contract@44a0e53f0b664c1a647fac1fd7eaeea700315ca4`、merge `0ee5db39ac8f91a484628cc07a2df21cdfb149b7`、`mergedAt 2026-08-20T22:44:52Z`。 [PR #479](https://github.com/Unson-LLC/brainbase/pull/479) | commit lineageの事実のみ。J0の`verified`/`done`、R1、Gate、productionの完了は推論しない。独立review判定はここへ記録しない。 |
| J0 / `Unson-LLC/brainbase#481` | `role=judgment_runner_delivery`; `state=MERGED_EXTERNALLY`; `title=J0 ローカル決定論的ランナーと不変run記録`; `base develop@3db3218107845cac051d7a433ad5e0c8a398ea16` → `head codex/j0/local-deterministic-runner@3fd71a1da59a85cb7cdc8cce8b17f22e3b767bde`、merge `f8e7ac61349b326863feae5d7d3d8ae68e2b9d10`、`mergedAt 2026-08-21T19:08:44Z`。 [PR #481](https://github.com/Unson-LLC/brainbase/pull/481) | commit lineageの事実のみ。J0のexit gateと下流R1の完了は、現在のexact HEADと別途取得した証拠で判定する。 |
| VibePro外部delivery / `Unson-LLC/vibepro#493` | `role=release_dependency_delivery`; `state=MERGED_EXTERNALLY`; `title=chore: prepare 0.2.0-beta.16 release`; `base main@3db04f430fe017aef42a456ef6c18434ad8b4407` → `head codex/vibepro-beta16-release@5dc2c8e0964167a79fe08fac97d6c8c800580d4e`、merge `8b9fd24b6614f8d55b4e6c42d1179a68e6f92f85`、`mergedAt 2026-08-25T12:43:06Z`。 [PR #493](https://github.com/Unson-LLC/vibepro/pull/493) | 外部マージのみ。VibeProのGate、R1、T0、A0、G0、productionの完了へ変換しない。 |
| VibePro `v0.2.0-beta.16` | tag `v0.2.0-beta.16`はmerge `8b9fd24b6614f8d55b4e6c42d1179a68e6f92f85`を指し、`publishedAt 2026-08-25T12:44:26Z`。npm `vibepro@0.2.0-beta.16`は`latest`/`beta`へ公開済み。 [release](https://github.com/Unson-LLC/vibepro/releases/tag/v0.2.0-beta.16) | package/releaseの外部事実のみ。ProgramのGateやproduction evidenceの代替にしない。 |

### 10.0.1 P0 source-lock lineage

P0のmachine source-lock [`contracts/p0-negative-boundary-contract-v1/source-lock.json`](../../../contracts/p0-negative-boundary-contract-v1/source-lock.json) は、upstream repositoryとmerged SHAを固定する。Program-owned companion lock [`docs/management/evidence/program-external-delivery-reconciliation-lock-v1.json`](../evidence/program-external-delivery-reconciliation-lock-v1.json) は、その実値を直接照合したうえで、live readback由来のPR `1302`とcanonical role `producer_contract_delivery`を結合する。このSHAはP0 #1304のmerge SHA `27b37cdaac50967edff095b696c540322feb75c2`の祖先であることを`git merge-base --is-ancestor`で確認した。これは契約の入力系譜であり、A0 work-packageのexit、consumer conformance、独立review、Gate、production evidenceを表さない。

| lineage項目 | 固定値 |
|---|---|
| source-lock | `contracts/p0-negative-boundary-contract-v1/source-lock.json` |
| upstream | `Unson-LLC/brainbase-unson#1302`, role=`producer_contract_delivery`, state=`MERGED` |
| Program companion lock | `docs/management/evidence/program-external-delivery-reconciliation-lock-v1.json` |
| upstream merge | `ad908bce7b90678f9ed7f1c570f808bdf1a500ad` at `2026-08-21T19:09:27Z` |
| downstream | `Unson-LLC/brainbase-unson#1304`, role=`P0 contract`, state=`MERGED` |
| downstream merge | `27b37cdaac50967edff095b696c540322feb75c2` at `2026-08-25T12:29:25Z` |
| ancestor check | `ad908bce...` is an ancestor of `27b37cda...`: confirmed |

このlineageは、契約deliveryとProgram exitを分離するための監査情報である。P0 Storyのpurpose/ACやGateの合否をこのreconciliationへ追加しない。

### 10.1 依存 debt と順序違反

- Master Roadmapのhard dependencyは`T0 → A0 → P0`である。A0のsource-lock契約deliveryは#1302で`MERGED`だが、A0 work-package、consumer、独立review、Gate、productionのexit evidenceとT0のproduction exit evidenceはこのProgram記録上確定していない。その状態でP0 #1304が2026-08-25に外部マージされたため、P0を完了扱いにせず、契約delivery後もexit順を満たさない外部deliveryとしてdebtに残す。
- J0 #479/#481とVibePro #493/beta16は、各リポジトリの外部deliveryを証明するだけである。J0/R1やVibePro Gateの独立review、T0/A0/G0、production readbackを代替しない。
- `docs/session: archive gog`の`Unson-LLC/brainbase-unson#338`は、handoffでA0のopen PRとされた識別子と一致しない。GitHub上の#338は別件として`MERGED`（merge `8274ec7be148ca545669f4e9f2a54cce5818ad82`、`mergedAt 2026-04-25T11:07:50Z`）である。タイトル上A0候補の#1283は`OPEN`かつ`CONFLICTING`/`DIRTY`（`base develop@135dd778eb2c94b29ccbe9be364548a53d428464`、`head codex/a0/company-authority-producer-contract-v1@fb98642b0f2268369ad61224124794cabbd29a04`）の古い候補であり、source-lockのcanonical producerではない。#1302を上書きするsupersession evidenceは未収集である。
- 監査で参照された`Unson-LLC/mana-runtime#338`（[PR #338](https://github.com/Unson-LLC/mana-runtime/pull/338)）は、`MANAがBrainbase署名済み会社権限だけを実行する`というconsumer側の`OPEN` PRである。`base main@da9a1d1ecfd67d34113ab3894d1a77c18460fe81` → `head codex/a0-company-authority-consumer@487371328b70b466e0f6bec9a7dc54c475a029d1`、merge SHA/timeはGitHub metadata上`null`（未マージ）である。RoadmapはA0の正本repoを`brainbase-unson`、`mana-runtime`をconsumerと定義しているため、この#338はA0 producerの識別子ではなく、merged #1302の契約deliveryやA0 exitを置き換えない。

このreconciliationは外部事実と依存debtを正本へ反映したもので、独立reviewの判定、Gateの合否、production成功を自己記録していない。

## 11. Program metrics

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
