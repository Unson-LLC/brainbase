---
story_id: story-company-os-objective-editor-v1
title: 共通画面で目的と評価基準を編集し保存結果を確認できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-objectives-v1", "story-company-os-constraints-v1"]
external_dependencies: []
---

# 共通画面で目的と評価基準を編集し保存結果を確認できる

## 利用者成果

目的の責任者として、単独所有者の共通画面から目的・基準・制約参照を編集して、採用する版を確認したい。

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

- `brainbase / story-company-os-objectives-v1`
- `brainbase / story-company-os-constraints-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: 正本APIから目的・基準・状態・制約参照を取得し、草案と判断利用可能を区別して表示する。
- [ ] AC-02: 権限内の作成・改訂後は同じIDと新版を読戻して保存成功を示し、競合時は上書きしない。
- [ ] AC-03: StoryからObjectiveを参照し、目標本文の別正本やBFFからのDB直接書込みを作らない。
- [ ] AC-04: 組織サービスなしでローカル起動し、権限不足・API未提供・欠損・保存結果を実画面で区別する。組織拡張用の接続境界を提供する。

## 対象外

全世界モデルの図形エディタ、独自の権限判定。 組織選択・メンバー・役割・組織承認画面。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
