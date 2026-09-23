---
story_id: story-company-os-impact-review-v1
title: 前提の変更で影響する計画だけを再判断に戻せる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-learning-adoption-v1", "story-company-os-durable-waits-v1", "story-company-os-execution-authority-v1"]
external_dependencies: []
---

# 前提の変更で影響する計画だけを再判断に戻せる

## 利用者成果

責任者として、モデル反証や制約変更が今の計画へ与える影響を見落としたくない。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 参照逆引き／再評価責任

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

- `brainbase / story-company-os-learning-adoption-v1`
- `brainbase / story-company-os-durable-waits-v1`
- `brainbase / story-company-os-execution-authority-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: 採用されたモデル・目的・制約・方法の新旧版と参照関係から対象計画を抽出し、無関係な計画は変更しない。
- [ ] AC-02: 再評価要否と実行許可を分離し、権限失効・制約違反は停止、主要前提反証は未実行行為を保留する。
- [ ] AC-03: 軽微な更新は理由付き続行、未判定は担当・期限付きとし、重要な可能性のある作用は判定まで保留する。
- [ ] AC-04: 再判断は同案件の新Problem/runとなり、過去の外部作用を取り消したと記録しない。

## 対象外

すべての変更の全計画再実行、無権限の補償操作。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
