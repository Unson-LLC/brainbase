---
story_id: story-company-os-ontology-v1
title: 目的・状態・仮説・制約を混同せず契約検証できる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: []
external_dependencies: [{"story_id": "story-brainbase-ontology-kernel", "source_repo": "brainbase-unson", "relationship": "reuse_or_extract_contract", "availability": "unverified_at_registration"}]
---

# 目的・状態・仮説・制約を混同せず契約検証できる

## 利用者成果

Graphを利用する開発者として、目的と手段、観測と仮説、採用と真偽を同じ契約で区別したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 共通オントロジー／既存 story-brainbase-ontology-kernel の差分

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。 既存Ontology Kernelの会社OS差分（ONT-002A〜ONT-005A）を対象とし、Kernel全体を再実装しない。参照元の改訂Specはbrainbase-unsonに残っているため、共通契約の正本への引継ぎと採用版をSpecで明示する。

- `brainbase-unson / story-brainbase-ontology-kernel`：reuse_or_extract_contract（提供版未確認）

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- なし

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: objective / variable / model / constraint と関係の意味・接続型・版を登録し、旧版の解釈を保持する。
- [ ] AC-02: 草案保存と判断利用・評価利用の検証条件を分け、単位・集計範囲・期間・定義版の不整合を具体的な理由で返す。
- [ ] AC-03: 貢献から達成、モデル入出力から因果証明、採用承認から真実を推論しない。世界の循環関係をDAG循環として拒否しない。
- [ ] AC-04: 認識状態・採用範囲・ACL・保存先を独立して検証し、新旧fixtureの互換性と禁止推論の反例をテストする。

## 対象外

Graphの本番型有効化、4型のCRUD、既存Kernelの再実装。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
