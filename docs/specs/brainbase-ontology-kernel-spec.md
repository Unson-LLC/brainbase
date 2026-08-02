---
spec_id: SPEC-BRAINBASE-ONTOLOGY-KERNEL
story_id: story-brainbase-ontology-kernel
architecture: docs/architecture/ADR-021-brainbase-ontology-kernel.md
status: accepted
version: 1.0.0
date: 2026-08-02
---

# Brainbase Ontology Kernel Spec

## 目的

Graph factの意味、検証、推論、変更解釈をversionedな決定的契約として提供する。v1は5領域すべての最小実行可能contractを実装し、既存Graphの自動修正は行わない。

## 要件

### ONT-001 Manifest readback

- current releaseは`ontology_version`、`schema_version`、`previous_version`、`effective_at`、compatibility、migration、rollbackを持つ。
- 型、関係、制約、推論規則、変更・競合規則をIDで取得できる。
- manifestは起動時にschema整合性を検証し、不正ならfail loudする。

### ONT-002 型と関係

- `app`、`product`、`brand`、`project`を含む登録型はdescription、identity、usage、examples、counter_examples、ownerを持つ。
- `owns`、`belongs_to`、`governs`、`supersedes`、`derived_from`、`accountable_for`と既存write pathのrelationを登録する。
- relationはfrom/to型、direction、cardinality、inverseまたはsymmetric、lifecycle、provenanceを持つ。
- 未登録型、未登録relation、許可外endpointはrule ID付きviolationになる。

### ONT-003 制約と監査

- `CON-APP-OWNER-001`: appは`owns`または`owned_by`でorg ownerを1つ以上持つ。
- `CON-DECISION-ACTIVE-001`: active Decisionはdecider personとscope project/org/app/productを持つ。
- entity、edge、snapshotのdry-runは永続化しない。
- snapshotが欠落・不完全なら`unverified`を返し、違反0件にしない。

### ONT-004 Decision推論

- `INF-DECISION-SUPERSESSION-001`: activeかつeffectiveな後継Decisionが明示的に旧Decisionを`supersedes`するとき、現在有効なDecisionを後継へ解決する。
- 明示的な`supersedes`がない複数active Decisionは`conflict`となる。
- 結果はrule ID、Ontology version、evidence、as-of、explanation、explicit/inferred区分を含む。

### ONT-005 変更、履歴、impact

- change classifierはbreaking/additive/patchをSemVer規則へ写像する。
- renameはcanonical IDを維持し、merge/dedupは旧IDとprovenanceを残す。
- 同時有効な競合定義を暗黙に統合しない。
- impact APIは変更対象の型・関係・ruleに一致するsnapshot件数、代表ID、影響API/agent、migration要否を返す。snapshotがない場合は`unverified`とする。

### ONT-006 API

- `GET /api/info/ontology` current manifest
- `GET /api/info/ontology/types/:id` 型定義
- `GET /api/info/ontology/relations/:id` relation定義
- `POST /api/info/ontology/validate` entity/edge/snapshot dry-run
- `POST /api/info/ontology/infer/decisions` Decision解決
- `POST /api/info/ontology/impact` 変更impact
- 全endpointは既存Info SSOT access contextを必須とする。

### ONT-007 互換性

- MCPのCore/Extension型とExtension既定非表示契約を維持する。
- 既存専用write pathのrelationはv1 manifestへ登録する。
- 汎用write APIの新規不正入力を拒否するが、既存Graphを自動変更しない。

## テスト計画

1. manifest contract: version情報と5領域の必須field、MCP型projectionとの一致。
2. validation contract: 正しい型・relationを許可し、未登録・endpoint違反を拒否する。
3. constraint contract: ownerなしapp、decider/scopeなしactive Decision、snapshot欠落を検出する。
4. inference contract: 明示supersedesとeffective dateで解決し、無関係なactive Decisionはconflictにする。
5. evolution contract: SemVer分類、rename/merge履歴、snapshotあり/なしのimpactを説明する。
6. API/service integration: readback、dry-run、保存前拒否、access contextを検証する。

## 完了境界

v1の完了は、上記contract test、対象service/route test、typecheck、VibePro Gateが通過した状態とする。実データ全件監査と全専用write pathのguard移行は結果を偽らず後続Taskとして残す。
