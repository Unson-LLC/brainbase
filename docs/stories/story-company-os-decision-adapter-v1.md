---
story_id: story-company-os-decision-adapter-v1
title: 既存のDecision作成から今回の判断条件を辿れる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: [{"story_id": "story-canonical-runtime-ownership", "source_repo": "brainbase", "relationship": "requires_owned_api_surface", "availability": "unverified_at_registration"}]
---

# 既存のDecision作成から今回の判断条件を辿れる

## 利用者成果

既存APIの利用者として、互換性を保ったままDecisionが参照した条件を確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: InfoSSOT Decision／AI decision adapter。旧入口の互換契約を対象とし、OSSに提供済みとは仮定しない

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

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: /api/info/decisions と /api/info/ai/decision-log にProblemと方法版への参照を接続する。
- [ ] AC-02: 新経路は必須条件を検証し、旧レコードは条件未記録として読む。Objective・権限を推測補完しない。
- [ ] AC-03: 既存レスポンスとID・Graphの正本を維持し、二重書込みの別正本を作らない。
- [ ] AC-04: 経路別の互換fixture比較と切戻しを検証し、新しい証跡を削除せず旧読取を維持する。

## 対象外

承認・学習・receipt系の同時移行。 社内配備・秘密・顧客データの移管、廃止経路の復活。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
