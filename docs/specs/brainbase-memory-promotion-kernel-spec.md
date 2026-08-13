# Brainbase Memory Promotion Kernel Spec

## 入力と初期値

Candidate Storeは旧契約をcanonical契約へ正規化する。

- `subject_type` -> `recommended_subject_type`
- `subject_id` -> `recommended_subject_id`
- `memory.body` / `memory.text` -> `body`
- 処理段階の初期値: `received`
- 意味状態の初期値: `active`
- 保存先の初期値: `ledger`

## 検証

- 保存先は`ledger / episode / personal_kg / graph / skill_candidate`のみ。
- `graph`の場合は`recommended_subject_id`が必須。候補IDで補完しない。
- 処理段階は定義順でのみ進められる。同一段階の再送は冪等に扱う。
- 意味状態は処理段階と独立して更新する。

## LearningService互換窓口

`createMemoryCandidate`、`getMemoryCandidate`、`listMemoryCandidates`は注入された`candidateRepository`を使う。返値は従来の`subject_type` / `subject_id` / `memory`形状を維持する。本番bootstrapはPostgres Candidate Repositoryを必ず注入する。

## Graph昇格

- 主体ID: `recommended_subject_id`
- 必須provenance: `derived_from_candidate_id`
- 昇格後の候補: `promoted_graph_entity_id`へ実際のGraph IDを保存
- 安定ID欠落: Graph書込み前に拒否または隔離

## 互換マイグレーション

`candidate-store-schema.sql`が旧列と新列の追加、値の補完、制約を担う。`learning-schema.sql`は`memory_candidates`に対する`CREATE`、`ALTER`、`UPDATE`、`DELETE`を行わない。

## 試験

- schema所有権の静的検査
- In-memoryとPostgresの初期値同値性
- 状態軸の独立性と逆行拒否
- LearningService委譲と直接SQL不使用
- Graph IDとprovenanceの分離
