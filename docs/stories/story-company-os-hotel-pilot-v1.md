---
story_id: story-company-os-hotel-pilot-v1
title: 匿名ホテル例で判断・評価・学習の共通契約を一周できる
status: done
created_at: 2026-09-23
implementation_started: true
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

- 既存のFoundation／World model／Problem selection／Problem snapshot／composition／reservation／authority／evaluation／learning adoption／Receipt adapter APIを再利用する。個別の正本実装は追加しない。

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

- [x] AC-01: 匿名のホテルfixture一件をOSS単独で動かし、目的・モデル・制約→問題選択→下位DAG→副作用のない試験adapter→観測・評価を接続する。
- [x] AC-02: 引継ぎ・修正負荷と品質を含めた結果から改訂候補を作り、採用した新版を次回runが参照したことをreadbackする。
- [x] AC-03: 証拠待ち・前提反証・再起動を一つずつ含め、`hold`から再評価を経て新Problem／新runで再判断し、旧run・旧評価を不変に保つことを確認する。
- [x] AC-04: 経路一覧の未移行／条件未記録を明示し、`production_unproven` と `external_send=unrecorded` を保持したまま、fixture成功を顧客の価値実証や本番完了と表示しない。

## 対象外

顧客への展開、実送信・支出・本番migration、ホテル製品の実装。 Mana・組織UIを含む横断E2E（projectの統合マイルストーンで扱う）。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。OutcomeCaseはfixtureのため、本番状態を `production_unproven`、外部送信を `unrecorded` として保存する。

## 実装状況

- 現行baseの正式なReceipt adapter APIを含め、Foundation／World Model／Problem selection／Problem snapshot／composition／reservation／authority／evaluation／learning adoptionを匿名ホテルfixtureで接続した。snapshot参照はWorldModel実体読取とhost-owned canonical fixture mapで照合し、予約ロック中は事前に読んだ保存済みsnapshotを再照合する。前提反証は`hold`として同じWait／claim／snapshotを保持し、再評価後に新Problem／新runへhandoffする。旧v1のsnapshot・selection・evaluationはv2から変更せず、handoff後の旧v1 authorityは拒否してeffectを増やさない。
- AC-01〜04は実装・review・CIで確認済み。[PR #548](https://github.com/Unson-LLC/brainbase/pull/548) はmerge [`3e63823e9e9597e9c16880426818a174bfa72955`](https://github.com/Unson-LLC/brainbase/commit/3e63823e9e9597e9c16880426818a174bfa72955)、head [`31bc902dbed555bbb5ac08dfb16484eb278b8694`](https://github.com/Unson-LLC/brainbase/commit/31bc902dbed555bbb5ac08dfb16484eb278b8694)、[CI 35873855880](https://github.com/Unson-LLC/brainbase/actions/runs/35873855880) success、review pass（旧run拒否・正本refs修正 [`6736b1cab423533dd97f37817edf077f472c98d9`](https://github.com/Unson-LLC/brainbase/commit/6736b1cab423533dd97f37817edf077f472c98d9)）、affected 8 files / 58 tests・strict TS、本番外fixtureである。OutcomeCaseは`production_unproven`、外部送信は`unrecorded`として保持する。
- 実storeを複数接続するpilot統合fixtureはfull-suite並列時にVitestの5秒既定値を超えるため、対象テストだけ30秒のローカルtimeoutを設定する。global timeoutは変更しない。timeout修正 [`63df2b5`](https://github.com/Unson-LLC/brainbase/commit/63df2b5bdae8c17fe924820ca7c3a5258ac2049b) は [CI 35876582564](https://github.com/Unson-LLC/brainbase/actions/runs/35876582564) successである。
- ローカルbuildはroot `node_modules` のSDK署名不一致で失敗し、baseでも同じエラーを確認した。locked dependency buildは成功しているため、これはCIの成功と分けて記録する。VibeProの `active` は登録状態を示し、完了状態とは別である。
