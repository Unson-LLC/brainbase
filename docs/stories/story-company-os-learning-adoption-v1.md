---
story_id: story-company-os-learning-adoption-v1
title: 結果から作った改訂候補を権限と根拠付きで次回へ採用できる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-evaluation-v1"]
external_dependencies: [{"story_id": "story-brainbase-knowledge-event-cycle", "source_repo": "brainbase-unson", "relationship": "reference_only", "availability": "contract_reference_f8f777f2"}, {"story_id": "story-brainbase-memory-promotion-kernel", "source_repo": "brainbase-unson", "relationship": "reference_only", "availability": "contract_reference_44368a2d"}, {"story_id": "story-meeting-judgment-learning", "source_repo": "brainbase-unson", "relationship": "reference_only", "availability": "contract_reference_c320cdc0"}]
---

# 結果から作った改訂候補を権限と根拠付きで次回へ採用できる

## 利用者成果

モデルと目的の責任者として、結果を理由に何を変えたかを残し、次の判断に限定適用したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: Knowledge候補・採用経路の拡張

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- `brainbase-unson / story-brainbase-knowledge-event-cycle`：reuse_or_extract_contract（提供版未確認）
- `brainbase-unson / story-brainbase-memory-promotion-kernel`：reuse_or_extract_contract（提供版未確認）
- `brainbase-unson / story-meeting-judgment-learning`：reuse_or_extract_contract（提供版未確認）

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-evaluation-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 更新先を世界モデル・判断方法・実行方法・Objectiveに分け、根拠・反例・不確実性・適用範囲付き候補を残す。
- [x] AC-02: 測定誤差・実行差・外部変化を検討可能にし、予測との差だけでモデルの誤りを確定しない。
- [x] AC-03: 検証結果と採用権限を確認して新版を作り、Objective変更は対応する権限へ戻す。旧版・旧runは不変。
- [x] AC-04: 採用記録と次回runの実利用記録を分け、未検証モデルの限定採用を検証済みへ格上げしない。

## 対象外

無承認の自己改変、進行runへの新版自動注入。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

## 実装状況

- 最小Specは [`docs/specs/company-os-learning-adoption-v1.md`](../specs/company-os-learning-adoption-v1.md) に固定した。
- `src/company-os-learning-adoption.ts` に、候補・検証・採用・planned選択・actual receipt-backed実利用を分離する公開store、評価／対象／承認／host-owned run receipt port、Foundation Graph v2 adapterを実装した。候補・検証・採用・run利用は `evidence/company-os-learning-adoption.json` にdigest付きで保存し、採用時だけFoundation新版をcanonical Graphへatomic commitする。actual run-useはplanned記録だけでは成立せず、receiptの現在ACL／scope・run ID・採用版exact targetをreadbackで確認する。
- Story07評価の提供版は `7e6359681af6606e14cba8ca8116ca559504e900`。組織側のKnowledge Event Cycle、Memory Promotion Kernel、Meeting Judgment Learningは契約参照に限定し、組織データ・API・権限をOSSへコピーしない。
- `tests/company-os-learning-adoption.test.ts` は実際のGraph／Foundation storeとsidecarを使い、ホテルの外部変化、予測差だけの反証拒否、reader採用拒否、対象revision競合、sidecar破損、planned run-use冪等性、actual receipt-backed exact-version利用、receipt改ざん拒否、candidate target ACL失効を検証する。
- `npm run build` と `npx vitest run tests/company-os-learning-adoption.test.ts --reporter verbose` は成功済み。[PR #538](https://github.com/Unson-LLC/brainbase/pull/538) はmerge [`03a8d05d260bfdcb242e89bd781965ba93edb7da`](https://github.com/Unson-LLC/brainbase/commit/03a8d05d260bfdcb242e89bd781965ba93edb7da)、[CI 35857192193](https://github.com/Unson-LLC/brainbase/actions/runs/35857192193) success、actual-use・current ACL・read cross-reference修正後にreview passである。組織側のKnowledge Event Cycle、Memory Promotion Kernel、Meeting Judgment Learningは契約参照に限定し、組織データ・API・権限をOSSへコピーしない。VibeProの `active` は登録状態を示す既存値として維持する。
