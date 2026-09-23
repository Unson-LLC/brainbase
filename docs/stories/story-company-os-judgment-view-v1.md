---
story_id: story-company-os-judgment-view-v1
title: 共通画面で判断の目的・根拠・結果を版ごとに追える
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-subdag-v1", "story-company-os-evaluation-v1"]
external_dependencies: []
---

# 共通画面で判断の目的・根拠・結果を版ごとに追える

## 利用者成果

判断を確認する人として、結論から当時の目的・証拠・下位判断・評価へ辿りたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OSS単独で利用できる共通Web UI／組織版から合成できる公開境界

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

- `brainbase / story-company-os-subdag-v1`
- `brainbase / story-company-os-evaluation-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: Problem・定義版・構成版・run・親子runを正本APIから読取り、現在版と当時版を区別する。
- [ ] AC-02: 仮説の検証状態と採用状態、出荷・利用・価値、結果評価と判断妥当性を別表示する。
- [ ] AC-03: 参照未解決・権限不足・判定不能を空や成功にせず、表示経由で許可外の情報を漏らさない。
- [ ] AC-04: 結論から根拠へ辿る実画面のreadbackを検証し、内部思考全文の保存・表示を要求しない。

## 対象外

全運用指標ダッシュボード、判断方法の編集。 組織選択・メンバー・役割・組織承認画面。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
