---
story_id: story-company-os-problem-selection-v1
title: 新規着手と継続・保留を目的と資源の条件で比較できる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-candidates-v1", "story-company-os-problem-snapshot-v1", "story-company-os-subdag-v1"]
external_dependencies: []
---

# 新規着手と継続・保留を目的と資源の条件で比較できる

## 利用者成果

責任者として、見つかった問題のうち今何を進め、何を見送るかを説明可能に決めたい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 共通判断方法ライブラリ／問題選択DAG

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

- `brainbase / story-company-os-problem-candidates-v1`
- `brainbase / story-company-os-problem-snapshot-v1`
- `brainbase / story-company-os-subdag-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 共通判断DAGで新規・継続・何もしない・追加観測を比較し、切替・機会・探索費用と探索上限を固定する。
- [x] AC-02: 制約・条件付き選好・委譲外の判断を区別し、比較不能な目的の衝突は理由付きで責任者へ返す。
- [x] AC-03: 着手／継続／観測／保留／中止、理由・担当・条件・見直し時期を残し、採択対象をProblemに接続する。
- [x] AC-04: 選択結果だけでは資源確約・権限拡大・Objective変更をせず、異なる所有範囲の資源を合算しない。

## 対象外

単一万能スコア、別の経営用推論エンジン、資源台帳。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

実装済み。`src/problem-selection.ts` に選択用meta Problem、候補のcurrent ACL／digest
検証、比較結果、後続Problem作成要求、immutable SelectionRecord storeを実装し、
`tests/problem-selection.test.ts` で各アクション、unknown、目的衝突、候補境界、
実storeの読戻しと改ざん検知を検証する。focused TypeScript検査も通過している。
全体buildは既存のworktree依存・`src/server.ts` 型エラーのためローカルでは完了していない。[PR #537](https://github.com/Unson-LLC/brainbase/pull/537) はmerge [`02cfcebecda461b38d347a7eeaeff703fa04a746`](https://github.com/Unson-LLC/brainbase/commit/02cfcebecda461b38d347a7eeaeff703fa04a746)、[CI 35858558216](https://github.com/Unson-LLC/brainbase/actions/runs/35858558216) pass、scope/persistence policy review passである。
