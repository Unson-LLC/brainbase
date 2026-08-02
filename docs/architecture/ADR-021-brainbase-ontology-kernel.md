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

`config/ontology/brainbase-ontology.v1.json`をOntology releaseの機械可読な正本とする。manifestは次を一つのreleaseとして保持する。

- semantic version、前version、適用日時、互換性、migration、rollback
- 型の意味、identity境界、利用条件、例・反例、owner
- 関係の意味、始点型、終点型、向き、基数、逆関係、lifecycle
- 制約、推論規則、競合・変更規則

Graph SSOTは引き続き人、組織、project、Decision、RACIなどの事実の正本であり、Ontology manifestをGraph entityへ複製しない。Git commit・review・releaseがOntology変更の承認履歴になる。

### 2. 実行境界

`OntologyKernel`を副作用のない決定的serviceとして実装し、manifestの取得、entity/edge検証、Decision推論、変更impact評価を担当させる。

最初のreleaseでは以下を強制する。

- 汎用Graph entity APIは未登録型を保存前に拒否する。
- 汎用Graph edge APIは未登録関係と許可されない型組み合わせを保存前に拒否する。
- dry-run APIはentity、edge、Graph snapshotを保存せず検証する。
- 既存の専用write pathは互換性維持のため直ちに全面遮断せず、既存relationをmanifestへ登録し、後続で同じguardへ収束させる。

既存Graph全件の自動修正・削除は行わない。監査入力を渡せない場合やDB接続に失敗した場合は違反0件ではなく`unverified`として返す。

### 3. 推論

推論は問い合わせ時に計算し、Graphへ暗黙の事実として保存しない。`supersedes`が明示され、後継Decisionがactiveかつ`effective_at`を迎えたときだけ旧Decisionを現在判断から除外する。明示関係のない複数のactive Decisionは、新しさだけで順位を作らずconflictとして返す。

推論結果はrule ID、Ontology version、根拠entity/edge、導出時刻、説明を含む。導出時刻を除けば同じ入力と基準時刻から同じ結果を返す。

### 4. 変更と履歴

versionはSemVerとし、型・関係の削除、意味変更、許容endpointの縮小はmajor、後方互換な追加はminor、説明や非意味的修正はpatchとする。releaseには`effective_at`、`previous_version`、compatibility、migration、rollbackを必須とする。

名称変更は同じcanonical IDとalias/effective dateで扱う。統合・重複解消は旧IDを削除せずcanonical IDへの明示mappingを残す。異なる定義が同時に有効で優先根拠がなければ自動統合せずconflictとする。過去factは記録されたOntology version、未記録なら当時有効だったreleaseで解釈する。

### 5. readbackとaccess

既存Info SSOT access contextの検証を通したAPIから、current manifest、型・関係定義、dry-run検証、Decision推論、impact reportをreadbackできるようにする。エラーはrule IDを持つ構造化結果として返し、保存APIでは400に変換する。

## 代替案

- **Graph内にOntologyを保存**: 事実と規則の循環依存が生じるため採用しない。
- **文書だけで管理**: write guardと推論を機械的に再現できないため採用しない。
- **OWL/RDF/SHACLを直ちに導入**: 現在必要な規則に対して運用・移行コストが大きく、標準選定を先行させるため採用しない。
- **LLMに意味判定を委ねる**: 同じ入力で同じ結果を保証できないため、候補提案に限定する。

## 結果

- Ontology変更はコードreview対象になり、version・適用日・rollbackが一体になる。
- 汎用Graph APIで意味違反を保存前に止められる。
- 既存専用write pathの完全移行とDB全件監査は後続Taskとして明示的に残る。
- MCPの既存Core/Extension表示契約は維持し、manifestとの不一致をcontract testで検出する。

