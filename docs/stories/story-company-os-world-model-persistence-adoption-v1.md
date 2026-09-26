---
story_id: story-company-os-world-model-persistence-adoption-v1
title: world-modelのdigest永続化とapproved adoptionの証跡参照を一致させる
status: implemented
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-world-model-v1", "story-company-os-objectives-v1", "story-company-os-constraints-v1"]
external_dependencies: []
---

# world-modelのdigest永続化とapproved adoptionの証跡参照を一致させる

## 利用者成果

保存された世界モデルが何に基づく版かを再確認でき、承認済みの採用だけを対応する承認記録へ辿れる。

## 対象

- digestの計算対象、保存先、再読込時の検証、公開説明を同じ契約へ揃える。Model定義のcanonical JSON bytes（再帰的にkeyを整列し、配列順は保持）をSHA-256化した`sha256:<64桁hex>`を`modelDigest`として各adoption recordへ保存し、同じModel revisionの正本digestと読戻し時に照合する。
- adoption stateがapprovedの場合に `approvalRef` を必須化し、保存・再読込・監査表示で同じ参照を保持する。
- approvedを名乗るだけで参照が欠落・不一致になる経路を拒否する。
- 承認参照の実在・承認状態・対象Modelへのbinding確認は、既存の`DecisionRevisionReader.exists()`を内部利用できるtyped approval readerへ委譲し、Reader不在・参照不在・binding不一致を成功扱いしない。
- Model adoption recordへ正本Modelのdigestを保存し、読戻し時に正本のdigestと一致しない記録を拒否する。

## 受入条件

- [x] 実装、契約artifact、README／Storyのdigest説明が、対象bytes・アルゴリズム・永続化単位について一致する。
- [x] approved adoptionは有効な `approvalRef` なしに保存できず、再読込結果から同じ承認記録へ辿れる。
- [x] digestまたはapprovalRefの不一致はfail-closedで返し、既存の採用記録を上書きしない。

## 最小Spec

- [company-os-world-model-persistence-adoption-v1](../specs/company-os-world-model-persistence-adoption-v1.md)
- Graphifyの影響結果は`freshness=unknown`、`impact=unknown`、`status=missing_graph`。利用可能なGraph証拠がないため、影響範囲は未確認として扱う。

## 検証と完了

受入条件を最小Specで固定し、`src/world-model.ts`と対象テストへ実装した。`npm test -- tests/world-model.test.ts`は17 tests pass、関連する`tests/company-os-hotel-pilot.test.ts`と合わせて18 tests pass。Graphifyは`freshness=unknown`、`impact=unknown`、`status=missing_graph`。`npm run build`は成功した。VibeProのretired gateは使用しない。
