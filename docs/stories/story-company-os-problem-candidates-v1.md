---
story_id: story-company-os-problem-candidates-v1
title: 観測された差や機会を次に解く問題候補として残せる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-objectives-v1", "story-company-os-world-model-v1"]
external_dependencies: []
---

# 観測された差や機会を次に解く問題候補として残せる

## 利用者成果

運営担当者として、どの仕事にも紐づかない出来事からも、検討すべき問いを残したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: イベント／問題候補の記録

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

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: Objectiveと観測差・機会・脅威・不確実性・期限・期待効果・必要資源を参照する候補を保存できる。
- [ ] AC-02: 完成したProblemやStoryを候補作成の前提にせず、不明な値を確定値にしない。
- [ ] AC-03: 同じ発生イベントの重複取込を抑止し、更新・統合しても元の根拠を辿れる。
- [ ] AC-04: 候補を所有範囲・責任者・状態で読戻しでき、権限外の証拠を要約経由でも漏らさない。

## 対象外

着手許可、候補の自動採択。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
