## GET /api/info/graph/entities が4秒で500にならない

Story: `story-graph-entities-list-timeout`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.29`
- source: `npm_package` at `/home/ubuntu/.npm/_npx/e0f82dd780a6134d/node_modules/vibepro`
- entrypoint: `/home/ubuntu/.npm/_npx/e0f82dd780a6134d/node_modules/vibepro/bin/vibepro.js`
- source SHA: `02934659e8a91a23c2ee8dc0b57ad768ae7c4b45`
- identity digest: `b82a4aef0f26937f172bdfe72080ce43a30880d8066a32a999c206bc96a4b66a`

### Story document
- docs/stories/story-graph-entities-list-timeout.md — GET /api/info/graph/entities が4秒で500にならない

### Acceptance criteria
- accepted-spec lineage: invalid — `.vibepro/spec/story-graph-entities-list-timeout/spec.json` @ `8567865c472ed675468e90be097a7e6717860051` (HEAD `4346d5cb8aa8f96ac2e13bd35ba548d62b07cf9f`)
  - story: `docs/management/stories/active/story-graph-entities-list-timeout.md` @ `missing` (HEAD `4346d5cb8aa8f96ac2e13bd35ba548d62b07cf9f`)
  - reasons: story_not_in_head, unknown_story_ac
- no acceptance criteria found in the story document

### Spec
- accepted spec present (`story-graph-entities-list-timeout`, 6 clause(s))

### Semantic sufficiency
- answer resolution: `unresolved`
- automatic continuation: `false`
- counterexample status: `verified`
- warnings: none
- outcome coverage:
  - internal_output: `unknown` (declared=6, answer_resolved=5, verification=unknown)
  - downstream_outcome: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - canonical_readback: `unknown` (declared=0, answer_resolved=0, verification=unknown)

### Multi-tenant architecture
- status: needs_review
- activation: boundary_without_tenant_actor
- architecture views: none
- evidence coverage: inconclusive
- [review] applicability_ambiguous: story_context
- review/tenant_architecture [needs_review]: tenant identityは入口から全実行面と資源境界まで一意に伝播するか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context
- review/security_boundary [needs_review]: credential、secret、dataにcross-tenant fallbackまたは混線経路がないか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context
- review/operations_and_migration [needs_review]: 各配備形態で移行・rollback・削除・接続不能の意味が維持されるか
  - findings: none
  - unconfirmed: applicability_ambiguous@story_context

### Fix scope
- status: `partial_fix`
- original problem: GET /api/info/graph/entities が4秒で500にならない
- affected stages: internal_output
- confirmed boundaries: none
- unconfirmed boundaries: internal_output, downstream_outcome, canonical_readback
- completion claim: `implementation_verified_external_outcome_unknown`
- note: local verification does not establish a production-path match or terminal receiver readback

### Verification evidence
- [unit] pass — `npx vitest run tests/server/services/info-ssot-access-context.test.js tests/server/services/info-ssot-graph-page.test.js tests/server/sql/info-ssot-rls.test.js tests/server/sql/info-ssot-explain.test.js` (runtime `b82a4aef0f26937f172bdfe72080ce43a30880d8066a32a999c206bc96a4b66a`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 未検出
- 生成proposal: 3件 (todo=3); execution_policy=未指定; mutates_repository=未指定 — .vibepro/stories/story-graph-entities-list-timeout/tasks/tasks.md

### Development Judgment
- available: false
- status: not_recorded
- lifecycle: draft_prepared
- applicable: true
- input adopted: false
- actionable: false
- advisory: true
- blocking: false
- plan binding: none
- plan effect: no_effect
- disposition: none
- disposition effect: none
- pending disposition: false
- pending outcome: false
- next: Review and edit .vibepro/reviews/story-graph-entities-list-timeout/senior-judgment/input-draft.json
- next: vibepro judgment input adopt . --id story-graph-entities-list-timeout --input .vibepro/reviews/story-graph-entities-list-timeout/senior-judgment/input-draft.json --reviewed-by <actor> --authority <source> --summary <text>

### Review
- recorded: true
- complete: true
- status: pass
- reviewer: pass (current) — 一覧の jit 無効化、スカラーなロール判定、ポリシーだけの所属条件、キーセット50件を確認した。本番 EXPLAIN は未測定。
- blocking reasons: none

### Changed files
- M	.vibepro/config.json
- A	.vibepro/integrations/brainbase/story-graph-entities-list-timeout/context.json
- A	.vibepro/reviews/story-graph-entities-list-timeout/development-judgment/applicability/current.json
- A	.vibepro/reviews/story-graph-entities-list-timeout/senior-judgment/input-draft.json
- A	.vibepro/spec/story-graph-entities-list-timeout/pre-spec-readiness.json
- A	.vibepro/spec/story-graph-entities-list-timeout/spec.json
- A	docs/stories/story-graph-entities-list-timeout.md
- A	scripts/info-ssot-apply.sh
- A	server/controllers/info-ssot-controller.js
- A	server/services/info-ssot-service.js
- A	server/sql/info-ssot-graph-indexes.sql
- A	server/sql/info-ssot-rls.sql
- A	tests/server/services/info-ssot-access-context.test.js
- A	tests/server/services/info-ssot-graph-page.test.js
- A	tests/server/sql/info-ssot-explain.test.js
- A	tests/server/sql/info-ssot-rls.test.js

