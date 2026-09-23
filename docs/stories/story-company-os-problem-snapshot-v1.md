---
story_id: story-company-os-problem-snapshot-v1
title: 判断時の目的・前提・権限を固定して再確認できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-objectives-v1", "story-company-os-world-model-v1", "story-company-os-constraints-v1"]
external_dependencies: []
---

# 判断時の目的・前提・権限を固定して再確認できる

## 利用者成果

判断者として、現在のデータが変わっても、当時何をどんな条件で解いたか確かめたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 版付き参照／判断ケース永続化

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

- `brainbase / story-company-os-objectives-v1`
- `brainbase / story-company-os-world-model-v1`
- `brainbase / story-company-os-constraints-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: 問い・所有範囲・範囲・目的と基準・観測・モデル・制約・権限・資源・期限の参照版をJudgmentProblemに束ねて読戻せる。
- [ ] AC-02: 可変証拠は使用内容または不変参照とhashを保持し、保存にも読取にも元のアクセス境界を維持する。
- [ ] AC-03: 欠落参照・適用外モデル・未解決の必須条件は判断利用不可として具体的に返す。
- [ ] AC-04: 元データ変更後も旧Problemは不変で、新条件は同じ案件の新改訂になる。スナップショット自体は実行許可にならない。

## 対象外

新しい目的正本、外部実行、全APIへの一括接続。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
