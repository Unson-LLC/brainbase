---
story_id: story-company-os-world-model-persistence-adoption-v1
title: world-modelのdigest永続化とapproved adoptionの証跡参照を一致させる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-world-model-v1", "story-company-os-objectives-v1", "story-company-os-constraints-v1"]
external_dependencies: []
---

# world-modelのdigest永続化とapproved adoptionの証跡参照を一致させる

## 利用者成果

保存された世界モデルが何に基づく版かを再確認でき、承認済みの採用だけを対応する承認記録へ辿れる。

## 対象

- digestの計算対象、保存先、再読込時の検証、公開説明を同じ契約へ揃える。
- adoption stateがapprovedの場合に `approvalRef` を必須化し、保存・再読込・監査表示で同じ参照を保持する。
- approvedを名乗るだけで参照が欠落・不一致になる経路を拒否する。

## 受入条件

- [ ] 実装、契約artifact、README／Storyのdigest説明が、対象bytes・アルゴリズム・永続化単位について一致する。
- [ ] approved adoptionは有効な `approvalRef` なしに保存できず、再読込結果から同じ承認記録へ辿れる。
- [ ] digestまたはapprovalRefの不一致はfail-closedで返し、既存の採用記録を上書きしない。

## 検証と完了

レビュー追補の登録のみ。新Spec、実装、テスト、review、PR、CI、mergeは未着手である。
