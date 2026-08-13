# ADR: Candidate StoreをMemory Promotion Kernelの唯一の正本にする

- 日付: 2026-08-13
- 状態: 採用

## 決定

`server/sql/candidate-store-schema.sql`と`CandidateRepository`を`memory_candidates`の唯一の所有者にする。`LearningService`は公開APIの互換窓口として残し、記憶候補操作をCandidate Storeへ委譲する。

## 状態モデル

- 処理段階: `received -> queued -> extracted -> resolved -> indexed -> retrievable`
- 意味状態: `active / superseded / contradicted / quarantined / retracted / expired`
- 保存先: `ledger / episode / personal_kg / graph / skill_candidate`

これらは独立した軸とする。処理段階のみ単調に進行し、意味状態の訂正で段階を巻き戻さない。

## Graph昇格

Graphの主体IDに`mem_${candidate.id}`を使わない。候補の`recommended_subject_id`に人物、組織、プロジェクト、判断の安定IDを必須とし、`derived_from_candidate_id`を出典としてGraph payloadへ保持する。

## 互換性

旧`subject_type` / `subject_id` / `memory`はCandidate Store schema側で互換列として維持する。初期移行で既存データを削除しない。

## 非目標

- `knowledge_event.v1`入力APIと議事録自動昇格は後続ADRで扱う。
- `promotion_candidates`を記憶候補へ統合しない。文書とSkillの配布候補に限定する。
