---
story_id: story-company-os-problem-selection-v1
title: 新規着手と継続・保留を目的と資源の条件で比較できる
status: planned
created_at: 2026-09-23
implementation_started: false
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

- [ ] AC-01: 共通判断DAGで新規・継続・何もしない・追加観測を比較し、切替・機会・探索費用と探索上限を固定する。
- [ ] AC-02: 制約・条件付き選好・委譲外の判断を区別し、比較不能な目的の衝突は理由付きで責任者へ返す。
- [ ] AC-03: 着手／継続／観測／保留／中止、理由・担当・条件・見直し時期を残し、採択対象をProblemに接続する。
- [ ] AC-04: 選択結果だけでは資源確約・権限拡大・Objective変更をせず、異なる所有範囲の資源を合算しない。

## 対象外

単一万能スコア、別の経営用推論エンジン、資源台帳。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
