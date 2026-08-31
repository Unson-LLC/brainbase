# Brainbase Platform Architecture

> **As of:** 2026-08-31  
> **Scope:** `Unson-LLC/brainbase` OSS版 + `Unson-LLC/brainbase-unson` 組織版  
> **Visual source of truth:** `docs/architecture/diagrams/*.archify.json`

Brainbase全体を最短で把握する入口です。詳細設計は各RepositoryのADR・Story・Specが正本であり、このページとArchify図はそれらを横断して読める投影です。

## Start here

| View | 何が分かるか | Interactive HTML | Static SVG | Editable source |
|---|---|---|---|---|
| **PLATFORM OVERVIEW** | OSS版と組織版の共有Kernel、包含関係、Mana、Domain Judgment Pack、完成度の境界 | [platform-overview.html](docs/architecture/diagrams/generated/platform-overview.html) | [platform-overview.svg](docs/architecture/diagrams/generated/platform-overview.svg) | [platform-overview.archify.json](docs/architecture/diagrams/platform-overview.archify.json) |
| **CURRENT** | 2026-08-31時点の組織版Brainbaseの主要構成、正本、信頼境界 | [current.html](docs/architecture/diagrams/generated/current.html) | [current.svg](docs/architecture/diagrams/generated/current.svg) | [current.archify.json](docs/architecture/diagrams/current.archify.json) |
| **NORTH STAR** | Brainbaseを会社横断のOrganizational Intelligence Planeへ進化させる到達像 | [north-star.html](docs/architecture/diagrams/generated/north-star.html) | [north-star.svg](docs/architecture/diagrams/generated/north-star.svg) | [north-star.archify.json](docs/architecture/diagrams/north-star.archify.json) |
| **DATA FLOW** | 組織シグナルが判断・実行・学習へ変わる一連の流れ | [data-flow.html](docs/architecture/diagrams/generated/data-flow.html) | [data-flow.svg](docs/architecture/diagrams/generated/data-flow.svg) | [data-flow.archify.json](docs/architecture/diagrams/data-flow.archify.json) |

### PLATFORM OVERVIEW

![Brainbase OSS and organization platform overview](docs/architecture/diagrams/generated/platform-overview.svg)

### CURRENT

![Brainbase CURRENT architecture](docs/architecture/diagrams/generated/current.svg)

### NORTH STAR

![Brainbase NORTH STAR architecture](docs/architecture/diagrams/generated/north-star.svg)

### DATA FLOW

![Brainbase organization data flow](docs/architecture/diagrams/generated/data-flow.svg)

## 一文で言うと

**Brainbaseは、個人・チーム・会社の正しい文脈と判断基準を解決し、AIがどこまで実行できるかを決め、結果を次の判断能力へ戻すJudgment Infrastructure / Organizational Intelligence Planeである。**

人間は、誰のために、何を実現し、何を優先し、何を守るかを定める。AIは、その基準の中で探索・反証・実行し、結果と証跡を返す。

## OSS版と組織版の関係

| Product boundary | 責務 |
|---|---|
| **Shared OSS Judgment Kernel** | Ontology、Graph、Judgment DAG、事前検証、決定論的runner、artifact、replay primitiveを提供する共通Kernel |
| **OSS Local-first Profile** | CLI、stdio MCP、agent-assisted onboarding、4つのローカル正本ファイルで個人・小規模利用を成立させる |
| **brainbase-unson Organization Runtime** | OSS Kernelを固定commitで取り込み、Express、Web UI、MCP、組織サービス、組織正本を追加する |
| **Organization Governance** | tenant、Company Authority、RACI、policy、approval、Personal→Organization昇格、監査境界を追加する |
| **Mana Runtime** | Brainbaseが解決した権限を消費し、cadence、priority、stagnation detection、follow-throughを担うoperator |
| **Domain Judgment Packs** | VibePro、Zeims、営業、マーケティング等の業務固有DAG・証拠契約・評価契約を提供する |

OSS版と組織版は左右対称の別製品ではありません。**組織版は同じOSS Judgment Kernelを包含し、その外側へ組織統制とmanaged operationを追加する構造**です。

## 中核の責務分担

| Layer | Brainbaseが持つもの | Brainbaseが奪わないもの |
|---|---|---|
| **Context Plane** | tenant・人物・organization・project・正本・version・provenance・access scopeの解決 | GitHub、Drive、CRM、会計台帳等の全データ |
| **Judgment Plane** | 適用DAG、policy、RACI、delegation、risk、continue／escalate、autonomy boundary | 各業務ドメイン固有の意味と最終専門判断 |
| **Learning Plane** | candidate、評価、昇格、再利用範囲、policy／DAG／practiceへの反映 | raw AI outputや個人原文の無審査な正本化 |
| **Execution Governance** | signed context、Human Gate、quota、Usage、Operation Receipt、readback | 外部System of Recordの最終状態 |
| **Domain Judgment Packs** | registry、選択、接続、version、cross-domain conflict | VibePro・Zeims等のdomain vocabularyと証拠契約 |

## 正本の境界

- **OSS Local Personal OS SSOT**: `graph.json`、`relationships.json`、`personal-kg.jsonl`、`decisions.jsonl`。
- **Organization Graph SSOT**: 現在有効な組織事実、Decision、RACI、関係。
- **PostgreSQL + RLS**: canonical tenant、organization、project、Task、Knowledge Event、Usage、Receipt、権限台帳。
- **Git**: immutable Ontology release、設計文書、仕様、Skill、runbook。
- **External Systems of Record**: code、契約、会計、CRM、provider上の最終状態、Secret値。
- **Personal Vault**: owner-scopedな個人イベント。組織Graphとは同一視しない。

UI、runtime cache、Slack workspace名、project code、deployment名、agentの自己申告は正本ではありません。

## 破ってはいけない設計原則

1. **外部AIは権限を自己申告して確定しない。** Brainbaseがcanonical person、membership、organization、project、resource、RACI、policyを解決する。
2. **曖昧さをdefaultで埋めない。** unresolved、ambiguous、revoked、scope mismatch、stale revision、upstream unavailableはfail closedにする。
3. **個人原文を組織知識へ自動コピーしない。** owner consentとorganization reviewを分け、正規化済み蒸留物だけを昇格する。
4. **証跡を成果と取り違えない。** Receiptは判断と外部結果を結び、次の判断を改善するためのもの。
5. **Brainbaseを万能SoRやSecret Vaultにしない。** 正本を発見・解釈・統治するが、外部正本を黙って置換しない。
6. **組織全体を一つの巨大DAGへ潰さない。** 共通runtimeの上で、開発・税務・営業等のDomain Judgment Packを選択・合成する。

## Statusの読み方

- **CURRENT**: 実装・検証済みの主要境界。
- **FRONTIER**: 設計または一部実装は存在するが、該当MilestoneのExit Gateやproduction readbackが未成立。
- **NORTH STAR**: 到達像。図にあること自体を本番稼働済みと解釈しない。
- code、contract、provisioning、deployment、fresh E2E、production readbackは別々に判定する。
- 詳細な状態・受入条件・移行順序はADR・Story・Milestoneを優先する。

## Canonical architecture decisions

- [Brainbaseマルチテナント基盤](docs/architecture/story-brainbase-multitenant-platform.md)
- [Brainbase-owned Company Authority](docs/architecture/ADR-023-brainbase-owned-company-authority.md)
- [Ontology Kernel](docs/architecture/ADR-021-brainbase-ontology-kernel.md)
- [Personal Vault / Organization Memory Boundary](docs/architecture/adr-personal-organization-memory-boundary.md)
- [Brainbase Surface Responsibility Matrix](docs/architecture/brainbase-surface-responsibility-matrix.md)
- [Domain Judgment DAG Platform Vision](docs/architecture/domain-judgment-dag-platform-vision.md)
- [Cloudflare Private Ingress](docs/architecture/story-brainbase-cloudflare-private-ingress.md)
- [Architecture catalog](docs/architecture/README.md)

## Diagram maintenance

Archify JSONが編集正本です。生成HTML・SVG・validation／delivery／visual-check receiptはGitHub Actionsが再生成します。

```bash
# CIと同じpin
ARCHIFY_COMMIT=5de7275fe87a66a19d52a4d9b0b3a4f2a5a90115

node /path/to/archify/archify/bin/archify.mjs validate architecture \
  docs/architecture/diagrams/platform-overview.archify.json --quality showcase

node /path/to/archify/archify/bin/archify.mjs deliver architecture \
  docs/architecture/diagrams/platform-overview.archify.json \
  docs/architecture/diagrams/generated/platform-overview.html --quality showcase
```

更新ルールは[diagrams README](docs/architecture/diagrams/README.md)を参照してください。
