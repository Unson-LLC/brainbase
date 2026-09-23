---
story_id: story-company-os-hotel-pilot-v1
title: 匿名ホテル例で判断・評価・学習の共通契約を一周できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-impact-review-v1", "story-company-os-problem-selection-v1", "story-company-os-knowledge-adapter-v1", "story-company-os-receipt-adapter-v1"]
external_dependencies: []
---

# 匿名ホテル例で判断・評価・学習の共通契約を一周できる

## 利用者成果

導入判断の責任者として、総対応負荷と品質を基準に導入方式を判断し、結果を次回へ反映できることを確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OSSローカル参照シナリオ／副作用のないAction・権限provider fixture

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

- `brainbase / story-company-os-impact-review-v1`
- `brainbase / story-company-os-problem-selection-v1`
- `brainbase / story-company-os-knowledge-adapter-v1`
- `brainbase / story-company-os-receipt-adapter-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: 匿名のホテルfixture一件をOSS単独で動かし、目的・モデル・制約→問題選択→下位DAG→副作用のない試験adapter→観測・評価を接続する。
- [ ] AC-02: 引継ぎ・修正負荷と品質を含めた結果から改訂候補を作り、採用した新版を次回runが参照したことをreadbackする。
- [ ] AC-03: 証拠待ち・前提反証・再起動を一つずつ含め、停止／保留／新Problemでの再判断と旧run不変を確認する。
- [ ] AC-04: 経路一覧の未移行／条件未記録を明示し、fixture成功を顧客の価値実証や本番完了と表示しない。

## 対象外

顧客への展開、実送信・支出・本番migration、ホテル製品の実装。 Mana・組織UIを含む横断E2E（projectの統合マイルストーンで扱う）。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
