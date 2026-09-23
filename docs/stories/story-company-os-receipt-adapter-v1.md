---
story_id: story-company-os-receipt-adapter-v1
title: 既存の実行記録と成果記録を判断へ接続して区別できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-evaluation-v1", "story-company-os-decision-adapter-v1"]
external_dependencies: [{"story_id": "story-canonical-runtime-ownership", "source_repo": "brainbase", "relationship": "requires_owned_api_surface", "availability": "unverified_at_registration"}]
---

# 既存の実行記録と成果記録を判断へ接続して区別できる

## 利用者成果

監査する人として、観測ログ・文脈取得・実行成功・成果判定を混同せず同じ判断へ辿りたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 実行／成果／補助証跡adapter。旧入口の互換契約を対象とし、OSSに提供済みとは仮定しない

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。 列挙する旧API／型がOSSに存在するとは仮定しない。canonical-runtime-ownershipの提供契約を確認し、未移管なら着手を保留する。旧社内runtimeをOSSから直接呼ばず、互換契約の範囲だけを移す。廃止経路は復活させない。

- `brainbase / story-canonical-runtime-ownership`：requires_owned_api_surface（提供版未確認）

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-evaluation-v1`
- `brainbase / story-company-os-decision-adapter-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: RunReceipt・OutcomeCase・meeting context receipt・Companion decision eventへ共通判断参照を接続する。
- [ ] AC-02: telemetryやcontext receiptを判断そのものへ変換せず、元の記録種別・ID・hash・状態を保持する。
- [ ] AC-03: 実行成功やOutcomeCase閉鎖を目的達成／判断品質へ自動変換しない。旧記録の未記録条件を表示する。
- [ ] AC-04: 対象入口ごとの読戻し・旧client互換・権限境界・切戻しを検証する。

## 対象外

廃止済みCompanionの復活、新しいreceipt正本。 社内配備・秘密・顧客データの移管、廃止経路の復活。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
