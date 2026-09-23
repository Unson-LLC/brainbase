---
story_id: story-company-os-objectives-v1
title: 目的と評価基準を版付きで保存し判断から参照できる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-ontology-v1"]
external_dependencies: []
---

# 目的と評価基準を版付きで保存し判断から参照できる

## 利用者成果

目的の責任者として、Storyの文章から独立した目的と達成基準を登録し、後から同じ版を読めるようにしたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: Graph正本API／Objective・Variableの最小保存経路

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。 Variable定義の保存もこの経路へまとめ、world-modelは同じ定義を参照する。

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

- [x] AC-01: Objectiveの対象者・望ましい状態・責任者・期間と、Variable定義・達成閾値を含む評価基準を保存／読戻しできる。
- [x] AC-02: 不完全な草案を保存できるが、基準未確定のまま達成判定に使えない。欠損と0を区別する。
- [x] AC-03: StoryとObjectiveの多対多参照、目的への貢献、実行依存、時間条件を区別する。
- [x] AC-04: 更新は新版とし旧版を保持する。越境read/write・未許可変更を拒否し、同時改訂の競合を検出する。

## 対象外

全社目標の自動生成、Story完了による自動達成。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

共有Ontology契約と、AC-03の貢献・実行依存・時間条件の関係種別を実装し、受入条件を確認済み。PR #522（[merge 0cdf0da](https://github.com/Unson-LLC/brainbase/commit/0cdf0da31ce422f34b48cbfebf08971c8625770d)）、[CI 35834690071](https://github.com/Unson-LLC/brainbase/actions/runs/35834690071) pass、focused 17 testsとreview pass。
