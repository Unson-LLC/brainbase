---
story_id: story-company-os-evaluation-v1
title: 判断開始時の目的で成果と判断の妥当性を別々に評価できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: [{"story_id": "story-outcome-case-v1", "source_repo": "brainbase-unson", "relationship": "reuse_or_extract_contract", "availability": "unverified_at_registration"}]
---

# 判断開始時の目的で成果と判断の妥当性を別々に評価できる

## 利用者成果

目的の責任者として、出荷や処理成功と、期待した価値が生まれたことを分けて判断したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OutcomeCase／評価記録の差分

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- `brainbase-unson / story-outcome-case-v1`：reuse_or_extract_contract（提供版未確認）

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: 評価はProblemが固定したObjective・基準・測定定義版・評価期間を使い、当時の基準で読戻せる。
- [ ] AC-02: 定義版が異なる測定は明示変換なしに比較せず、証拠欠損・未到来期間は判定不能にする。
- [ ] AC-03: 予測と実績、結果の達成度、判断時点の妥当性を別々に記録し、外れだけで原因を断定しない。
- [ ] AC-04: ホテル例で直接対応が減っても引継ぎ・修正増加や品質悪化があれば自動的に成功としない。既存OutcomeCaseの閉鎖を置換しない。

## 対象外

学習候補の採用、OutcomeCase閉鎖を判断品質と同一視すること。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
