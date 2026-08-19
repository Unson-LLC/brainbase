---
title: Brainbase commercial / tenant boundary
status: accepted
date: 2026-08-19
scope: brainbase-unson
---

# Brainbase commercial / tenant boundary

## 決定

`brainbase-unson` を長期的な「有償マルチテナント版Brainbaseそのもの」の正本にはしない。

このリポジトリは現在、Brainbaseのホスト型バックエンド、UI、社内運用、雲孫固有データ・設定を同居させている。これは単一組織の高速開発には有効だったが、複数顧客へ販売する製品境界としては弱い。

長期の目標構成は次とする。

```text
brainbase                public / OSS
  = local-first core + personal Memory Loop + portable contracts

brainbase-cloud          private / commercial
  = multi-tenant organization control plane
  = auth / tenancy / org Graph / policy / audit / hosted API / billing integration

brainbase-unson          private / tenant overlay
  = Unson固有の設定、運用、データ、connector、deployment
  = product logicを持たない方向へ縮退

mana-runtime             commercial agent runtime
  = Brainbaseを使って理解・判断・実行するOperating Loop
```

`brainbase-cloud` は現時点で未作成でもよい。まず境界を固定し、新しい商用共通機能を `brainbase-unson` に増やし続けないことを優先する。

## 各製品の責務

### Brainbase OSS

- ローカル優先SSOT
- Ontology / Graph / Personal KG
- Episode / Knowledge Event / Judgment memory
- MCP / portable API contracts
- 個人向け Memory Loop (`ohayo` / `oyasumi` / `retro`)
- Host adapterを生成できるが特定schedulerへ依存しない

### Brainbase Cloud / multi-tenant

組織利用で必要になる共有・統制を所有する。

- tenant isolation
- organization identity / membership
- RACI / role / authority
- organization Graph SSOT
- shared project / milestone / sprint / task / ship state
- approval / promotion gate
- audit trail
- hosted ingestion / retrieval APIs
- organization-level routine state / Run Receipt / liveness
- managed connectors
- availability / backup / observability
- commercial entitlements

Brainbase Cloud自身は「会社を代わりに経営するAgent」にはならない。

### brainbase-unson

雲孫という1 tenantの実運用を表す。

保持してよいもの:

- Unson固有のorganization config
- Unson固有のrole mapping / connector mapping
- deployment configuration
- internal operating docs
- Unsonだけに必要なintegration glue
- tenant固有のdata migration

長期的に持たないもの:

- すべての組織顧客で使う認証・tenant機構
- 汎用Organization Graph engine
- 汎用RACI engine
- 汎用multi-tenant API
- 汎用billing / entitlement
- Manaの判断ロジック
- Brainbase OSSと同一のcore implementationのfork

## Memory Loop と Operating Loop

Brainbase側の3ルーティンはMemory Loopとして扱う。

```text
Brainbase ohayo   = 組織として今参照すべき状態・記憶を確認する
Brainbase oyasumi = 組織の記憶・未処理・矛盾を安全に閉じる
Brainbase retro   = 組織Memory Systemの品質と登録候補を見直す
```

Mana導入時は、この上にOperating Loopが載る。

```text
Mana ohayo   = 今日、誰が何を進めるべきか。Mana自身は何をShipするか
Mana oyasumi = 今日の成果は目的に対して十分か。何をcarry over / escalateするか
Mana retro   = 来週、事業・プロセス・役割・仕組みの何を変えるべきか
```

Brainbase Cloudは必要な事実・権限・状態を返し、Manaはその状態から判断する。

## 実行アーキテクチャ

Routineの期待実行契約とexecution hostを分離する。

悪い結合:

```text
routine == codex_automations
```

目標:

```text
RoutineExpectation
  routine
  scope
  tenant_id
  schedule
  owner
  required_artifacts

RoutineRun
  trigger_type
  executor_type
  executor_identity
  run_id
  status
  coverage
  evidence
```

`executor_type` は `codex_automation | mana | cron | eventbridge | manual | other` 等を取り得る。

これにより、現在のCodex Automationを維持したまま、将来Mana常駐runtimeやmanaged schedulerへ移行できる。

## なぜ brainbase-unson をそのまま商用製品にしないか

### 1. tenant固有要求がproduct architectureを汚染する

社内だけで必要な機能が、全顧客向けの標準機能に見え始める。

### 2. OSSとの同期がfork管理になる

共通coreの修正が `brainbase` と `brainbase-unson` に二重実装されると、OSSが下流版、社内版が真の正本という構造になりやすい。

### 3. 営業上の製品境界が曖昧になる

「Brainbase Cloud」と「Unsonの社内Brainbase」は別物であるべき。顧客へ売る共通SaaSを特定tenant名のrepoで育てると、権限・data model・deploymentの判断が不透明になる。

## Repository topology の移行

### Phase 1: 今すぐ

- `brainbase` = OSS core正本を維持
- `brainbase-unson` = 現行運用を継続するが、新規共通機能には `commercial-common` / `tenant-specific` の分類を設計時に必須化
- `mana-runtime` = Agent RuntimeとしてBrainbaseとは独立

### Phase 2: 商用版の2社目が見える前

`brainbase-cloud` を作成し、次を移す。

- multi-tenancy
- organization auth / policy
- shared graph / project control plane
- hosted APIs
- managed routine liveness
- commercial-only operational infrastructure

### Phase 3

`brainbase-unson` は `brainbase-cloud` の最初のtenant overlay / deployment repositoryへ縮退させる。

理想的には、Unson固有コードがほぼconfigとconnector adapterだけになる。

## 商用上の製品階段

```text
Brainbase OSS
  無償: 個人の第二の記憶
      |
      v
Brainbase Cloud
  有償: 組織の共有記憶・権限・監査・運用
      |
      v
Mana Personal / Organization
  有償: 状況を理解し、判断し、実際に動くAgent
```

課金境界は「無料版では重要機能を隠す」ではなく、責任範囲で分ける。

```text
Brainbase knows.
Mana acts.
```

## 実装ルール

今後 `brainbase-unson` へ機能を追加する際、PR / Storyで次を答える。

1. これはUnson固有か、全組織共通か。
2. OSS coreに属するprimitiveではないか。
3. 商用multi-tenant共通なら将来 `brainbase-cloud` へ移せる境界になっているか。
4. Manaが持つべき判断・実行ロジックではないか。
5. tenant data / product code / agent behavior を同じモジュールに混ぜていないか。
