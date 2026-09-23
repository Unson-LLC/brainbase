---
story_id: story-company-os-constraints-v1
title: 判断に適用する制約とその採用根拠を確認できる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-ontology-v1", "story-company-os-objectives-v1", "story-company-os-sidecar-v1"]
external_dependencies: []
---

# 判断に適用する制約とその採用根拠を確認できる

## 利用者成果

判断者として、今回守る条件の範囲・期間・例外を同じ定義から確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 制約解決／既存権限resolverの再利用

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

- `brainbase / story-company-os-ontology-v1`
- `brainbase / story-company-os-objectives-v1`
- `brainbase / story-company-os-sidecar-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: Constraintを条件・対象範囲・有効期間・版とともに保存し、採用したDecisionの版へ接続する。
- [x] AC-02: 状態情報や予測を禁止方針と混同せず、指定した所有範囲・対象・時点に適用する制約だけを解決する。
- [x] AC-03: 例外は承認者・範囲・期限・根拠付きで扱い、ObjectiveやConstraintの登録から実行権限を発生させない。
- [x] AC-04: 競合・不明な適用範囲は理由付きで未解決にし、許可とせず、越境参照と無権限の緩和を拒否する。

## 対象外

全社ポリシー自動制定、既存RACIの置換。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

共有Ontology契約とObjective StoryのFoundationRevisionStore、SSOT sidecarへ接続するSpec・adapter・テストを整備し、Constraintの版更新・Decision版参照・対象／期間解決、評価providerのunknown／conflict、例外の永続readback、actorとownerの認可境界、実行権限を発生させないことを確認済み。PR #527（[merge faaa517](https://github.com/Unson-LLC/brainbase/commit/faaa517822c8ed4006a93449ea329962550798d1)）、[CI 35838360642](https://github.com/Unson-LLC/brainbase/actions/runs/35838360642) pass、focused 20 testsとreview pass。

今回の検証証跡:

- `npm run build`：成功。
- `npx vitest run tests/constraint-resolution.test.ts tests/foundation-constraint-store.test.ts tests/constraint-exception-store.test.ts tests/ssot-atomic.test.ts tests/ontology-foundation.test.ts`：5 files / 53 tests 成功。
- Graphify lookup：対象6ファイルは `freshness: unknown` / `impact: unknown` / `status: unmatched`。依存影響は未確認のため、影響なしとは扱わない。
