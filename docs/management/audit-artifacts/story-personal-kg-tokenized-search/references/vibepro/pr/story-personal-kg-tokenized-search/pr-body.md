## このPRで決めたいこと
- このPRで閉じる問い: Personal KG search supports compound keyword queries を満たす変更として、Runtime / Contract Docs / Tests の差分をこのPRで受け入れてよいか。
- Story: story-personal-kg-tokenized-search - Personal KG search supports compound keyword queries
- Engineering Judgment: agent_workflow / dag=agent_workflow_dag / confidence=82% / axes=public_contract / suppressed=execution_topology[insufficient_signal]
- PR Route: runtime_change / body=runtime_contract_review / confidence=70% / required=decision_question, story_or_source_of_truth, gate_status, verification_or_waiver
- 判断: VibePro Gate上はPR作成可能。人間レビューでは設計判断・スコープ・運用影響を確認する。
- レビュー入口: Runtime / Contract Docs / Tests
- Gate状況: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細は監査ログの Gate DAG / Gate Enforcement を確認してください。
- 管理worktree: needs_review
- Scope判断: reviewable: current branchのままPR化可能 / split=keep_current_pr
- 変更規模: 7 files

### Engineering Judgment の判断過程
このPRは、単なる差分量ではなく「何を壊してはいけない変更か」で読みます。入力と差分シグナルから `agent_workflow` として読み、Senior first scanで必要な判断axisを複数active化しました。

#### 判断した入力
- 目的: Personal KG search supports compound keyword queries
- 正本: [docs/stories/story-personal-kg-tokenized-search.md](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/docs/stories/story-personal-kg-tokenized-search.md)
- 差分面: runtime 1件 / contract docs 3件 / tests 3件を変更
- PR Route: runtime_change / body=runtime_contract_review / confidence=70% / required=decision_question, story_or_source_of_truth, gate_status, verification_or_waiver

#### 判断シグナル
- `surface:agent_or_gate_workflow`: agent/gate/review/DAGの判断面に触れるため、tool boundaryと証跡ライフサイクルを確認する。
- `risk_profile:api_contract`: risk profileは api_contract。証跡量とAgent Review要求の強さを決める入力にする。

#### 共通spineの確認
- intent: passed / surface=story / required=story_intent / evidence=docs/stories/story-personal-kg-tokenized-search.md / matched=story_intent:docs/stories/story-personal-kg-tokenized-search.md / 6 acceptance criterion/criteria or Story intent text found
- current_reality: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / matched=flow_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, artifact_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scenario_clause_e2e:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json / workflow current reality is backed by flow_replay
- invariants: passed / surface=workflow / required=spec_clause|architecture_doc|test_contract / evidence=explicit spec/architecture docs / matched=architecture_doc:explicit spec/architecture docs / supporting / architecture/spec docs bound the invariant surface, test_contract:test files in diff / supporting / changed tests indicate intended contract coverage but are not focused proof by themselves / High-risk changes need Spec, Architecture, or test evidence for invariants
- boundaries: passed / surface=workflow / required=architecture_doc|decision_record|current_verification / evidence=explicit spec/architecture docs / matched=architecture_doc:explicit spec/architecture docs / supporting / architecture/spec docs describe the relevant boundary, decision_record:decision-1782178067948-279d4476 / supporting / accepted decision records the boundary rationale, current_verification:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current verification is tied to a durable artifact for the boundary path / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json / Boundary-sensitive changes need architecture/spec, decision, or current verification evidence
- failure_modes: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / matched=flow_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, artifact_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scenario_clause_e2e:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json / workflow changes need failure-mode evidence matching flow_replay|artifact_replay|scenario_clause_e2e
- done_evidence: passed / surface=workflow / required=flow_replay|artifact_replay|scenario_clause_e2e / evidence=BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / matched=flow_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, artifact_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scenario_clause_e2e:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json / workflow changes need done evidence matching flow_replay|artifact_replay|scenario_clause_e2e

#### Senior first scan axes
- public_contract: active_passed / confidence=80% / question=この変更は外部利用者、CLI/API、設定、出力形式、またはPR本文契約を壊さないか。 / required=story_spec_traceability|contract_doc|compat_or_output_test|current_verification / candidates=pr_route:runtime_change, file_group:contract_docs, text:public_contract / active_signals=pr_route:runtime_change, file_group:contract_docs, text:public_contract / precision=active:public_contract activated from 2 non-text corroborating signal(s) / matched=story_spec_traceability:story/spec docs in diff / supporting / story/spec docs exist in the diff and provide traceability, contract_doc:architecture/policy docs in diff / supporting / architecture/policy docs are present for the changed contract surface, topology_diagram:architecture docs in diff / supporting / architecture docs describe topology but are not replay proof, compat_or_output_test:test files in diff / supporting / changed tests signal intent but do not prove focused runtime coverage alone, semantic_invariant_test:test files in diff / supporting / changed tests indicate semantic coverage intent but remain indirect, focused_test:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, focused_test:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, runtime_path_evidence:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, runtime_path_evidence:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, e2e_runtime_path:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, e2e_runtime_path:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, flow_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, flow_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, artifact_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, artifact_replay:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scenario_clause_e2e:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scenario_clause_e2e:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, focused_test:npm run test:run -- tests/server/routes/companion-reply-draft.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json, focused_test:npm run test:run -- tests/server/routes/companion-reply-draft.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json, integration_runtime_path:npm run test:run -- tests/server/routes/companion-reply-draft.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json, integration_runtime_path:npm run test:run -- tests/server/routes/companion-reply-draft.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json, focused_test:npm run test:run -- tests/server/services/learning-service.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/unit-learning-service-fa2905633.status.json, focused_test:npm run test:run -- tests/server/services/learning-service.test.js / strong / current-bound focused evidence includes recorded observation plus durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/unit-learning-service-fa2905633.status.json, current_verification:BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts / strong / current verification includes a durable artifact / artifact=.vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json, scope_reviewed:scope.status=reviewable / supporting / scope classification says the current diff is reviewable, decision_record:decision-1782178067948-279d4476 / supporting / accepted decision provides explicit follow-up rationale / artifact=docs/architecture/personal-kg-tokenized-search-architecture.md
- suppressed_candidates: execution_topology[insufficient_signal]:execution_topology has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists

#### 選んだDAGが要求した確認
- Context Acquisition Gate: agentが読むべきrepo/docs/log/graph/current stateを先に集める
- Tool Boundary Gate: どのtool/agentがどの副作用を持つかを分離する
- Delegation Policy Gate: どの段階でどのレビュー/サブエージェントを呼ぶかをDAGに置く
- Evidence Lifecycle Gate: agent/gate/DAG変更では、レビュー証跡が現在の差分に結びつき、missing/stale/timed-out/blockが残っていないことを確認する。
- Human Decision Contract Gate: 最後に人間が判断する問いと根拠をPRに出す

#### 証跡とマージ境界
- 要求証跡: Engineering Judgment Route Gate=passed / Common Judgment Spine Gate=passed / Managed Worktree Gate=needs_review / Requirement Gate=passed / Unit Gate=passed / Integration Gate=passed / E2E Gate=passed / Agent Review Gate=passed / Network Contract Gate=passed / DAG Connectivity Gate=passed / Judgment Axis: public_contract=passed / Evidence Lifecycle Gate=passed
- 判断境界: 必須Gateは閉じています。ただしリリース判断Warningがあります（Managed Worktree Gate）。Gate DAG / Gate Enforcementで理由と対応を確認します。

### 判断グラフ
- 目的: Personal KG search supports compound keyword queries
- Engineering Judgment: agent_workflow / dag=agent_workflow_dag
- Suppressed Axis Candidates: execution_topology[insufficient_signal]
- PR Route: runtime_change / body=runtime_contract_review
- 正本: [docs/stories/story-personal-kg-tokenized-search.md](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/docs/stories/story-personal-kg-tokenized-search.md)
- 差分: runtime 1件 / contract docs 3件 / tests 3件を変更（Runtime: [server/services/learning-service.js](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/server/services/learning-service.js) / Contract Docs: [docs/stories/story-personal-kg-tokenized-search.md](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/docs/stories/story-personal-kg-tokenized-search.md), [docs/architecture/personal-kg-tokenized-search-architecture.md](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/docs/architecture/personal-kg-tokenized-search-architecture.md), [docs/specs/story-personal-kg-tokenized-search-spec.md](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/docs/specs/story-personal-kg-tokenized-search-spec.md) / Tests: [tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts), [tests/server/routes/learning.test.js](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/tests/server/routes/learning.test.js), [tests/server/services/learning-service.test.js](https://github.com/Unson-LLC/brainbase-unson/blob/codex/personal-kg-tokenized-search/tests/server/services/learning-service.test.js)）
- 証跡: Engineering Judgment passed / Story Source passed / Judgment Spine passed / PR Route passed / PR Body passed / Managed Worktree needs_review / Requirement passed / Unit passed / Integration passed / E2E passed / Agent Review passed / Network Contract passed / DAG Connectivity passed
- 分割判断: single_pr_ok / keep_current_pr

## 変更内容
- Story文書を更新: docs/stories/story-personal-kg-tokenized-search.md
- アーキテクチャ判断を追加: docs/architecture/personal-kg-tokenized-search-architecture.md
- 仕様文書を更新: docs/specs/story-personal-kg-tokenized-search-spec.md
- 実装を変更: server/services/learning-service.js
- テストを追加・更新: tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts, tests/server/routes/learning.test.js, tests/server/services/learning-service.test.js

## なぜこの変更か
- 要求: Personal KG search supports compound keyword queries
- 背景: `search_personal_kg` is the owner-visible retrieval surface for 佐藤圭吾's cognitive memory. It is used when an agent needs judgment axes, values, SNS philosophy, or decision principles beyond the session preamble. Before this Story, the backing API searched `memory_candidates.body` with one continuous `ILIKE '%query%'` ph



## レビューしてほしい観点
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: server/services/learning-service.js
- テスト差分: tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts, tests/server/routes/learning.test.js, tests/server/services/learning-service.test.js

## 検証
- [ ] `npm test -- tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts tests/server/routes/learning.test.js tests/server/services/learning-service.test.js` - 変更に対応する対象テスト / gate: passed via `npm run test:run -- tests/server/services/learning-service.test.js`
- [ ] `npm run typecheck` - package.json の typecheck scriptでTypeScript/型境界を確認する / gate: passed via `npm run test:run -- tests/server/routes/companion-reply-draft.test.js`
- [x] `npm run test:run -- tests/server/services/learning-service.test.js` - LearningService Personal KG exact phrase and all-token fallback SQL passes; evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/unit-learning-service-fa2905633.status.json / gate: passed / evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/unit-learning-service-fa2905633.status.json
- [x] `npm run test:run -- tests/server/routes/companion-reply-draft.test.js` - Companion route Personal KG integration remains compatible; evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json / gate: passed / evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/integration-companion-reply-draft-fa2905633.status.json
- [x] `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts` - Flow replay and artifact replay prove Personal KG compound query retrieval, failure modes, and direct route contract; evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json / gate: passed / evidence: .vibepro/artifacts/story-personal-kg-tokenized-search/e2e-personal-kg-tokenized-search-fa2905633.status.json

## リスク・確認事項
- 特記事項なし

## 明示的にやらないこと
- 変更ファイル外の既存挙動は、このPRの完了保証対象外
- Gate / Agent Review の詳細証跡は監査ログとして残すが、本文上部のレビュー範囲を広げるものではない
- Browser UI の表示・操作体験変更はスコープ外

## レビュアー向け差分分類
- Runtime: 1 files - 実装・実行時挙動の変更: server/services/learning-service.js
- Contract Docs: 3 files - Story / Spec / Architecture / 方針の変更: docs/stories/story-personal-kg-tokenized-search.md, docs/architecture/personal-kg-tokenized-search-architecture.md, docs/specs/story-personal-kg-tokenized-search-spec.md
- Tests: 3 files - 自動テスト・E2E・検証コード: tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts, tests/server/routes/learning.test.js, tests/server/services/learning-service.test.js

## 監査ログ
- ここから下は VibePro の機械証跡です。レビュー・マージ判断は上部の判断、変更内容、レビュー観点、検証、リスクを先に確認してください。
- Gate / Agent Review / split plan / 実行メタデータは詳細確認と再現性のために残します。
- 管理worktree: needs_review

## 概要
- Story: story-personal-kg-tokenized-search - Personal KG search supports compound keyword queries
- VibePro scope: reviewable
- PR strategy: current_branch_pr
- 変更ファイル: 7 files

## 背景・要求
- 正本: docs/stories/story-personal-kg-tokenized-search.md
- 要求: Personal KG search supports compound keyword queries


- 背景: `search_personal_kg` is the owner-visible retrieval surface for 佐藤圭吾's cognitive memory. It is used when an agent needs judgment axes, values, SNS philosophy, or decision principles beyond the session preamble. Before this Story, the backing API searched `memory_candidates.body` with one continuous `ILIKE '%query%'` ph

## 実装判断
- ADR: ADRあり (docs/architecture/personal-kg-tokenized-search-architecture.md)
- Scope: reviewable
- Scope理由: current branchのままPR化可能

## Task / Handoff
- Task指定なし

## 受け入れ基準
- Exact phrase search remains supported and ranks before fallback matches.
- Compound queries are tokenized and can match entries that contain all tokens with different separators.
- Single-term queries do not add unnecessary token fallback SQL.
- `cognitive_type` filtering and bounded `limit` behavior remain intact.
- Owner-only, non-redacted, non-rejected filters remain intact.
- Direct `GET /api/learning/memory-candidates/search` callers keep the same `{ candidates }` response contract while benefiting from the fallback.

## 差分分類
- story_docs: 1
- architecture_docs: 1
- specifications: 1
- source: 1
- tests: 3

## 要件整合性
- Requirement Gate: pass - 4 invariants, 0 scenario gaps, 0 contradictions
- 補足: Story/Spec/Architectureと既知の実装分岐に明確な矛盾はありません。
- Requirement Sources: 2
- Spec Sources: 1
- Architecture Sources: 1
- Policy Sources: 0
- Requirement Source: spec:docs/specs/story-personal-kg-tokenized-search-spec.md - SPEC-personal-kg-tokenized-search
- Requirement Source: architecture:docs/architecture/personal-kg-tokenized-search-architecture.md - Personal KG Tokenized Search Architecture
- Invariant: Direct GET /api/learning/memory-candidates/search callers keep the same { candidates } response contract while benefiting from the fallback. (story:docs/stories/story-personal-kg-tokenized-search.md)
- Invariant: INV-001: Personal KG search remains read-only and must not mutate memory_candidates. (spec:docs/specs/story-personal-kg-tokenized-search-spec.md)
- Invariant: INV-003: Exact phrase matches must remain valid and rank before token fallback matches. (spec:docs/specs/story-personal-kg-tokenized-search-spec.md)
- Invariant: C-004: cognitiveTypes and limit must continue to bind after the generated token parameters without placeholder drift. (spec:docs/specs/story-personal-kg-tokenized-search-spec.md)

## AC/Scenario Traceability
- clause_count: 6
- mapped: 5
- weakly_mapped: 1
- unmapped: 0

### Weak/Unmapped Examples
- AC-5: weakly_mapped (verification or PR evidence exists, but no AC/scenario-specific binding was found)

## Network Contract
- status: pass
- API client calls: 0
- introduced API client calls: 0
- missing routes: 0
- dynamic routes: 0
- server function replacements: 0
- 問題なし

## Journey Map
- Status: missing
- Action: Journey Map is not generated. Run `vibepro journey derive <repo>` to surface latest user Journey context.

## Agent Review
- status: pass
- required reviews: 1
- unmet required reviews: 0
- checkpoint required reviews: 0
- unmet checkpoint reviews: 0
- parallel dispatch: 1 gate (complete) - vibepro review prepare . --id story-personal-kg-tokenized-search --stage gate --role gate_evidence -> .vibepro/reviews/story-personal-kg-tokenized-search/gate/parallel-dispatch.md
- PR-final roles passed or not required
- checkpoint roles passed or not required
### Stage Summary
- gate: pass / stale=0 / block=0
### Review Binding
- gate:gate_evidence binding=current / reason=review is bound to the current git state
### Review Artifacts
- gate:gate_evidence (pass) artifact: .vibepro/reviews/story-personal-kg-tokenized-search/gate/review-result-gate_evidence.json / history: .vibepro/reviews/story-personal-kg-tokenized-search/gate/history/review-result-gate_evidence-2026-06-23T01-18-16.026Z.json, .vibepro/reviews/story-personal-kg-tokenized-search/gate/history/review-result-gate_evidence-2026-06-23T01-24-02.392Z.json, .vibepro/reviews/story-personal-kg-tokenized-search/gate/history/review-result-gate_evidence-2026-06-23T01-32-06.033Z.json

## Explore Evidence
- Explore evidence未生成

## Gate DAG
- overall: ready_for_review
- acceptance criteria: 6
- suppressed axis candidates: execution_topology[insufficient_signal]:execution_topology has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists
- story-personal-kg-tokenized-search - Personal KG search supports compound keyword queries: present (required) - Story source is present
- Architecture Gate: satisfied (required) - ADRあり (docs/architecture/personal-kg-tokenized-search-architecture.md)
- Spec Gate: present (required) - explicit Spec docs are present (docs/specs/story-personal-kg-tokenized-search-spec.md)
- PR Route Classification Gate: passed (required) - PR route selected: runtime_change; body template: runtime_contract_review
- PR Body Contract Gate: passed (required) - PR body must use runtime_contract_review and expose the route-specific decision contract sections=decision_question,story_or_source_of_truth,gate_status,verification_or_waiver
- Requirement Gate: passed (required) - Story不変条件と変更コードの既知分岐に明確な矛盾は検出されていない
- Agent Review Gate: passed (required) - Required staged agent reviews passed for the current git state
- Network Contract Gate: passed (required) - No broken API client route contracts detected
- Unit Gate: passed (required) - `npm run test:run -- tests/server/services/learning-service.test.js`
- Integration Gate: passed (required) - `npm run test:run -- tests/server/routes/companion-reply-draft.test.js`
- E2E Gate: passed (required) - `BRAINBASE_E2E_REUSE_SERVER=true npx playwright test tests/e2e/story-personal-kg-tokenized-search-contract.spec.ts`

## Gate Enforcement
- status: ready_for_review
- completion: Gate証跡が揃っているため、VibePro上は完了扱い可能
- release decision warnings: Managed Worktree Gate:needs_review
- warning detail: Managed Worktree Gate: VibePro managed worktree execution state is missing

## Execution Gate
- status: ready
- pr_create_allowed: true
- blocking_gate_count: 0
- required: none

## AI Agent Handoff
- 目的: Story / Spec / Gate DAG に沿って実装し、未解決Gateを解消する
- 最初に見る: このPR本文、review-cockpit.html、gate-dag.html、split-plan.html
- 未解決Gate: none
- リリース判断Warning: Managed Worktree Gate:needs_review
- PR分割方針: keep_current_pr
- 注意: scope.status=reviewable は完了承認ではありません。Execution Gateがreadyになるまで証跡を追加してください。

## Flow Verification Evidence
- 未実行: `vibepro verify flow . --base-url <url>` で動線証跡を作成する

## Visual QA Evidence
- 未検出: `.vibepro/qa/<qa-id>/residual-analysis.md` または `*residual*.json` がある場合はPR判断に接続されます

## Completion Quality
- status: ready_for_human_acceptance
- e2e_experience_reach_rate: 1
- final_20_auto_closure_rate: 1
- visual_qa_pass_rate: not_measured
- human_usable_quality_rate: 1
- required: none

## Performance Evidence
- status: not_configured
- reason: このStoryには performanceMetrics が定義されていません

## VibePro refactoring delta
- 前回の同一Story診断runがないため、差分は未算出

## 分割計画
- status: single_pr_ok
- strategy: keep_current_pr
- graphify: .vibepro/graphify/graph.json が見つからない
- stacked gates: cumulative=0, final validation required=false
- requirements-ssot: Story / Spec / Architecture / Policy SSOT
  - recommendation: same_pr_allowed
  - files: 3
- runtime-behavior: Runtime behavior and unit coverage
  - recommendation: primary_pr
  - files: 4

## VibePro
- latest story run: -
- gate: -
- Engineering Judgment: agent_workflow (agent_workflow_dag)
- PR route: runtime_change (runtime_contract_review)
- PR strategy: current_branch_pr
- runtime: vibepro@0.1.0-beta.0 c1ff12f870f8 main clean (story=story-personal-kg-tokenized-search)
