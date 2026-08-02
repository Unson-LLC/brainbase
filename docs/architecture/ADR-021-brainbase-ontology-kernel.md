---
adr_id: ADR-021
title: Ontology Kernelの正本・検証境界・推論・version契約
status: accepted
date: 2026-08-02
related_stories:
  - story-brainbase-ontology-kernel
related_docs:
  - docs/architecture/ADR-007-type-taxonomy.md
  - docs/specs/brainbase-ontology-kernel-spec.md
supersedes: []
superseded_by: []
---

# ADR-021: Ontology Kernelの正本・検証境界・推論・version契約

## 文脈

BrainbaseはGraph SSOTに組織の事実を保存し、MCPの型レジストリがCore/Extension型を列挙している。一方、`rel_type`は自由文字列で、型の意味境界、edgeの接続条件、entity制約、Decisionの置き換え推論、Ontology自体の変更契約は共通の機械可読定義になっていない。

Ontology定義をGraphの通常entityとして保存すると、Graphの事実とその解釈規則が同じ更新境界に入り、壊れた規則が自身を正当化し得る。逆に文書だけでは、書き込み前検証と再現可能な推論に使えない。

## 決定

### 1. 正本

`config/ontology/releases/<semver>.json`を変更不能なOntology releaseの機械可読な正本とし、`config/ontology/index.json`をversion、`effective_at`、statusからreleaseを解決するindexとする。`config/ontology/brainbase-ontology.v1.json`はactive releaseへの互換viewであり、release本体ではない。manifestは次を一つのreleaseとして保持する。

- semantic version、前version、適用日時、互換性、migration、rollback
- 型の意味、identity境界、利用条件、例・反例、owner
- 関係の意味、始点型、終点型、向き、基数、逆関係、lifecycle
- 制約、推論規則、競合・変更規則

Graph SSOTは引き続き人、組織、project、Decision、RACIなどの事実の正本であり、Ontology manifestをGraph entityへ複製しない。Git commit・reviewは変更内容の証跡、Graph RACIは誰が提案・決裁・適用できるかの権限正本とする。releaseは`proposed -> approved -> active -> retired`を取り、提案者、決裁者、適用者のentity IDと根拠Decision IDを持つ。決裁者が対象scopeでAccountableでないrelease、または承認証跡のないreleaseをindexのactiveへ昇格できない。

`npm run ontology:publish -- --version <semver> --decision-id <id>`をcurrent indexを変更できる唯一のpublisherとする。publisherは対象HEAD、release bytesのSHA-256、version再利用、既公開releaseの削除・変更、Graph RACIのAccountable権限、根拠Decision、applier identityを検証してからindexを生成する。CIの`ontology:verify`はbase refのindex/releaseと比較し、publisher証跡のないcurrent変更、既公開versionのdigest変更・削除を拒否する。Graph未到達、権限不明、Decision不明はいずれもfail closedとし、既存active releaseは維持する。

ADR-007の型catalogは既存storage型の初期整理として残し、本ADRはpublic型とstorage型の対応を明確化する。manifestの型には`public_id`、`storage_type`、`visibility`、`aliases`を持たせ、MCPの`raci` -> DBの`raci_assignment`のようなprojectionを明示する。既存利用中の型・relationはinventoryで`canonical`、`compatibility`、`internal`、`rejected`に分類し、未分類値は強制開始前に監査対象とする。

### 2. 実行境界

`OntologyKernel`を副作用のない決定的serviceとして実装し、manifestの取得、entity/edge検証、Decision推論、変更impact評価を担当させる。

最初のreleaseでは以下を強制する。

- 新設する`POST /api/info/ontology/graph/commit`はentityと必須edgeを同一transactionのaggregateとして検証・保存し、ownerなしappやdecider/scopeなしactive Decisionをcanonical Graphへ残さない。
- 既存の分離された汎用Graph entity/edge APIはv1では登録型・relation・endpointだけを保存前検証し、必須relation制約はatomic commitまたはauditで評価する。既存clientの移行完了まではownerなしentity単体作成を直ちに破壊しない。
- dry-run APIはentity、edge、Graph snapshotを保存せず検証する。
- 既存の専用write pathは互換性維持のため直ちに全面遮断せず、既存relationをmanifestへ登録し、後続で同じguardへ収束させる。

既存Graph全件の自動修正・削除は行わない。`POST /api/info/ontology/audit`はaccess contextで許可されたprojectまたは明示entity ID集合をserver側でpaginationして読み、件数、cursor完走、取得失敗、scope、Ontology versionをcompleteness metadataとして返す。途中失敗、scope不明、DB接続失敗は違反0件ではなく`unverified`とする。caller提供snapshotのdry-runはcanonical Graph監査を名乗らない。

### 3. 推論

推論は問い合わせ時に計算し、Graphへ暗黙の事実として保存しない。`supersedes`が明示され、後継Decisionがactiveかつ`effective_at`を迎えたときだけ旧Decisionを現在判断から除外する。明示関係のない複数のactive Decisionは、新しさだけで順位を作らずconflictとして返す。

推論結果はrule ID、Ontology version、根拠entity/edge、導出時刻、説明を含む。導出時刻を除けば同じ入力と基準時刻から同じ結果を返す。

### 4. 変更と履歴

versionはSemVerとし、型・関係の削除、意味変更、許容endpointの縮小はmajor、後方互換な追加はminor、説明や非意味的修正はpatchとする。releaseには`effective_at`、`previous_version`、content digest、compatibility、migration、rollbackを必須とする。一度indexへ掲載されたversionはappend-onlyであり、同一versionのbytes変更、version再利用、過去release削除を禁止する。

名称変更は同じcanonical IDとalias/effective dateで扱う。統合・重複解消は旧IDを削除せずcanonical IDへの明示mappingを残す。異なる定義が同時に有効で優先根拠がなければ自動統合せずconflictとする。過去factは記録されたOntology version、未記録ならindexから当時有効だったimmutable releaseを解決して解釈する。versionも時刻も解決できなければ`unverified`とする。

### 5. readbackとaccess

既存Info SSOT access contextの検証を通したAPIから、current/as-of/version指定manifest、型・関係定義、dry-run検証、bounded Graph audit、Decision推論、impact reportをreadbackできるようにする。エラーはrule IDを持つ構造化結果として返し、保存APIでは400に変換する。

## 代替案

- **Graph内にOntologyを保存**: 事実と規則の循環依存が生じるため採用しない。
- **文書だけで管理**: write guardと推論を機械的に再現できないため採用しない。
- **OWL/RDF/SHACLを直ちに導入**: 現在必要な規則に対して運用・移行コストが大きく、標準選定を先行させるため採用しない。
- **LLMに意味判定を委ねる**: 同じ入力で同じ結果を保証できないため、候補提案に限定する。

## 結果

- Ontology変更はコードreview対象になり、version・適用日・rollbackが一体になる。
- 汎用Graph APIで意味違反を保存前に止められる。
- 既存専用write pathの完全移行とscopeなしの全DB監査は後続Taskとして明示的に残る。v1でも権限scopeを限定したDB-backed auditは提供する。
- MCPの既存Core/Extension表示契約は維持し、manifestとの不一致をcontract testで検出する。
