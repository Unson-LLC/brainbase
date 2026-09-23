---
story_id: story-company-os-world-model-v1
title: 観測と仮説を区別した世界モデルを判断に使える
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-ontology-v1"]
external_dependencies: []
---

# 観測と仮説を区別した世界モデルを判断に使える

## 利用者成果

判断者として、どの観測と仮説に基づく予測か、適用範囲と不確実性を確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: Graph／candidate-store／証拠参照

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- なし。既存実装との重複は着手時に確認する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-ontology-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: Variableは定義、観測は対象・時点・期間・出典付きの値として分離し、同一定義版で読戻せる。
- [ ] AC-02: Modelの入出力・適用条件・定性的関係または式・不確実性・根拠・検証状態を版付きで保存できる。
- [ ] AC-03: candidateから正式モデルへ採用しても元仮説・証拠・ACL・未検証状態を残し、用途への採用を検証済みと表示しない。
- [ ] AC-04: 発生／有効時点と記録時点を区別し、後日訂正された観測でも過去判断が参照した内容を復元できる。

## 対象外

会社全体のシミュレーター、時系列基盤の全面置換、仮説の自動真実化。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
