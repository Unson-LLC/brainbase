## A0 canonical company authority producer contract v1

Story: `story-canonical-company-authority-producer-contract-v1`
SSOT: local

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.10`
- source: `npm_package` at `/Users/ksato/.local/share/vibepro-runtime/0.2.0-beta.10/node_modules/vibepro`
- entrypoint: `/Users/ksato/.local/share/vibepro-runtime/0.2.0-beta.10/node_modules/vibepro/bin/vibepro.js`
- source SHA: `92c1f79df53605eca6f262351c48df3531518b4a`
- identity digest: `e5f5c80086d0e2af4b13877aa96b9f1b50655f2849392cbce16c7839d46f38c7`

### Story document
- docs/management/stories/active/story-canonical-company-authority-producer-contract-v1.md — A0: Brainbase company authority producer contract v1を固定する

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-canonical-company-authority-producer-contract-v1/spec.json` @ `db78d8632cd321369c38b9b166914881a5fa6b50` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - story: `docs/management/stories/active/story-canonical-company-authority-producer-contract-v1.md` @ `c3845e2d18e93aa000346a7bd27316a568c90c44` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-001: AC-001: 観測要求の入力境界を機械検証できる
  - spec clauses: C-001
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `rejects every resolved authority field injected into ObservedExecutionRequestV1 at both boundaries` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-002: AC-002: CanonicalExecutionContextV1のschemaとwireを固定する
  - spec clauses: C-002
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `fixes the request/context wire path and company_authority_v1 capability path` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-003: AC-003: canonical JSONと署名 profileを固定する
  - spec clauses: C-003
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `keeps canonical JSON stable for signature input and rejects tampering` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-004: AC-004: decision modeを固定する
  - spec clauses: C-004
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `validates deterministic synthetic positive payloads and all four decisions` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `fixes human_action as pending completion and deny as zero-effect machine outcomes` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-005: AC-005: canonical errorとfail-closed negative matrixを固定する
  - spec clauses: C-005
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `records the expected negative matrix categories and exact error vocabulary` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `rejects every resolved authority field injected into ObservedExecutionRequestV1 at both boundaries` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-006: AC-006: synthetic fixtureとmanifest digestを固定する
  - spec clauses: C-006
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `validates cases through the manifest-referenced fixture schema and exact manifest coverage` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `binds all four tenant/person matrix entries to concrete positive fixtures` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `pins a manifest digest without producer commit self-reference` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
- [mapped] AC-007: AC-007: 合成契約限定のTDD conformanceを実行できる（Graph実データ・live runtime・deploymentは未検証）
  - spec clauses: C-007
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `pins the contract-only trust boundary and non-authoritative reference validator` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)
  - test: `tests/conformance/brainbase-company-authority-producer-contract.test.js` — `pins a manifest digest without producer commit self-reference` @ `4a5b03ddc88863aebc378588f7c350b737133223` (HEAD `8cd67b5a4a351113c94a50a42a79472973f3e4cd`)

### Spec
- accepted spec present (`story-canonical-company-authority-producer-contract-v1`, 7 clause(s))

### Multi-tenant architecture
- status: ready
- activation: explicit_applicability
- architecture views: system_context, tenant_resolution, trust_data_boundary, runtime_execution, deployment_variants, migration_rollback
- evidence coverage: verified
- scanners: tenant_boundary=pass, tenant_key_propagation=pass, cross_tenant_authorization=pass, state_partitioning=pass, sandbox_isolation=pass, connection_routing=pass, secret_scope=pass, canonical_data_owner=pass, deployment_topology=pass, cross_tenant_negative_evidence=pass
- review/tenant_architecture [ready]: tenant identityは入口から全実行面と資源境界まで一意に伝播するか
  - findings: none
  - unconfirmed: none
- review/security_boundary [ready]: credential、secret、dataにcross-tenant fallbackまたは混線経路がないか
  - findings: none
  - unconfirmed: none
- review/operations_and_migration [ready]: 各配備形態で移行・rollback・削除・接続不能の意味が維持されるか
  - findings: none
  - unconfirmed: none

### Bug diagnosis DAG
- not applicable (Story contract type is not bug_fix/regression_fix)

### Verification evidence
- [typecheck] pass — `npm run typecheck` (runtime `e5f5c80086d0e2af4b13877aa96b9f1b50655f2849392cbce16c7839d46f38c7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [integration] pass — `npx vitest run --config vitest.conformance.config.js tests/conformance/brainbase-company-authority-consumer-boundary.test.js --test-name-pattern "A0 consumer boundary|integration" --reporter=dot` (runtime `e5f5c80086d0e2af4b13877aa96b9f1b50655f2849392cbce16c7839d46f38c7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [unit] pass — `npx vitest run --config vitest.conformance.config.js tests/conformance/brainbase-company-authority-producer-contract.test.js --reporter=dot` (runtime `e5f5c80086d0e2af4b13877aa96b9f1b50655f2849392cbce16c7839d46f38c7`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 生成proposal: 未検出

### Review
- status: needs_review (pass=0, needs_review=7, block=0)
  - planning_spec: needs_review (product_requirement, architecture_boundary, spec_consistency)
  - requirement: needs_review (product_requirement, scope_risk, acceptance_e2e)
  - architecture_spec: needs_review (architecture_boundary, spec_consistency, regression_risk)
  - test_plan: needs_review (unit_integration, e2e_ux, gate_coverage)
  - implementation: needs_review (code_spec_alignment, runtime_contract, ux_completion)
  - gate: needs_review (gate_evidence, pr_split_scope, release_risk)
  - preview: needs_review (preview_smoke, network_runtime, human_usability)

### Changed files
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/history/review-result-architecture_boundary-2026-08-21T04-18-19.237Z.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/history/review-result-product_requirement-2026-08-21T04-18-18.533Z.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/history/review-result-spec_consistency-2026-08-21T04-18-19.951Z.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/review-result-architecture_boundary.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/review-result-product_requirement.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/review-result-spec_consistency.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/review-summary.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/review-summary.md
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/reviewer-transcript-architecture_boundary-pass-d5e052d4.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/reviewer-transcript-product_requirement-pass-d5e052d4.json
- A	.vibepro/reviews/story-canonical-company-authority-producer-contract-v1/planning_spec/reviewer-transcript-spec_consistency-pass-d5e052d4.json
- A	.vibepro/spec/story-canonical-company-authority-producer-contract-v1/spec.json
- A	contracts/mana-brainbase-company-authority/v1/fixtures/cases.json
- A	contracts/mana-brainbase-company-authority/v1/fixtures/fixture.schema.json
- A	contracts/mana-brainbase-company-authority/v1/fixtures/manifest.json
- A	contracts/mana-brainbase-company-authority/v1/fixtures/test-key.json
- A	contracts/mana-brainbase-company-authority/v1/producer.contract.json
- A	contracts/mana-brainbase-company-authority/v1/reference/wire.mjs
- A	contracts/mana-brainbase-company-authority/v1/schema/canonical-execution-context.schema.json
- A	contracts/mana-brainbase-company-authority/v1/schema/company-authority-resolution-response.schema.json
- A	contracts/mana-brainbase-company-authority/v1/schema/observed-execution-request.schema.json
- A	contracts/mana-brainbase-company-authority/v1/source-lock.json
- A	docs/architecture/canonical-company-authority-producer-contract-v1.md
- A	docs/management/stories/active/story-canonical-company-authority-producer-contract-v1.md
- A	docs/management/tasks/canonical-company-authority-producer-contract-v1.json
- A	docs/specs/canonical-company-authority-producer-contract-v1.md
- A	tests/conformance/brainbase-company-authority-consumer-boundary.test.js
- A	tests/conformance/brainbase-company-authority-producer-contract.test.js

