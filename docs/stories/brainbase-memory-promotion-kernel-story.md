---
story_id: story-brainbase-memory-promotion-kernel
title: Brainbase記憶候補の正本統合
status: ready_for_review
created_at: 2026-08-13
updated_at: 2026-08-13
architecture_docs:
  - docs/architecture/adr-memory-promotion-kernel.md
spec_docs:
  - docs/specs/brainbase-memory-promotion-kernel-spec.md
---

# Brainbase記憶候補の正本統合

## 背景

`memory_candidates`の定義と更新責務がCandidate Storeと`LearningService`に分散し、処理段階、意味状態、保存先の判定を一つの契約として追跡できない。またGraph昇格時に候補IDを主体IDへ使うため、組織の安定した現在状態にならない。

## User Story

Brainbase運用者として、記憶候補の作成、状態遷移、Graph昇格を一つのMemory Promotion Kernelから実行したい。なぜなら、互換APIの呼び出し元を壊さずに、重複書込みと候補ID由来のGraph主体を廃止したいから。

## Acceptance Criteria

- [x] `candidate-store-schema.sql`が`memory_candidates`を所有し、`learning-schema.sql`は作成・変更しない。
- [x] 既存行を削除せず、新契約へ互換移行できる。
- [x] 処理段階、意味状態、保存先を独立した列として持つ。
- [x] 処理段階は逆行できず、意味状態の変更は処理段階を変えない。
- [x] `LearningService`の既存APIはCandidate Storeへ委譲する。
- [x] Graph昇格は安定した主体IDを必須とし、候補IDは出典履歴にのみ残す。
- [x] `promotion_candidates`は文書とSkillの配布候補だけを受け付ける。

## 検証

- Candidate StoreとLearningServiceの対象試験: 44ファイル、132件成功
- 型検査: 成功
- 全体回帰: 469ファイル・3,324件成功、5ファイル・74件失敗。失敗は共有`node_modules`のNode ABI不一致、テスト環境の`localStorage`未提供、既存ontology投影差分、既存writer recovery引数契約であり、本Storyの対象試験では再現しない。
- 実データ移行と31013ランタイム確認: 後続のイベント駆動登録PRで実施
