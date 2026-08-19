## テナント本番プロビジョニング制御面

Story: `story-tenant-production-provisioning-control-plane`
SSOT: local

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.10`
- source: `npm_package` at `/Volumes/UNSON-DRIVE/codex-runtime-staging/node-caches/npm-cache/_npx/6767a188bf873282/node_modules/vibepro`
- entrypoint: `/Volumes/UNSON-DRIVE/codex-runtime-staging/node-caches/npm-cache/_npx/6767a188bf873282/node_modules/vibepro/bin/vibepro.js`
- source SHA: `92c1f79df53605eca6f262351c48df3531518b4a`
- identity digest: `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`

### Story document
- docs/management/stories/active/story-tenant-production-provisioning-control-plane.md — テナント本番プロビジョニング制御面

### Acceptance criteria
- accepted-spec lineage: resolved — `.vibepro/spec/story-tenant-production-provisioning-control-plane/spec.json` @ `79b9934774d5460091ccc403d70cb747df41daa2` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - story: `docs/management/stories/active/story-tenant-production-provisioning-control-plane.md` @ `eeb41a1dd955cea76ccc0e74ecf8e72cf5c61ac8` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-001: AC-001: テナントに人間が読める `tenant_key` と不変のcanonical tenant IDを持たせ、同一keyの重複を拒否できる。
  - spec clauses: C-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `b8753436c257fa72bf59b8f5fbc3a22eff16d5fc` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-002: AC-002: テナントrevisionを履歴として保持し、tenant-owned recordは現在値だけでなく書込み時revisionへ参照整合する。revision更新で既存recordの外部キーを壊さない。
  - spec clauses: C-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `b8753436c257fa72bf59b8f5fbc3a22eff16d5fc` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-003: AC-003: 同じtenant・provider・workspace・appの有効接続は一つだけで、再インストールは既存connectionのrevision更新として表現できる。
  - spec clauses: C-002
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `enforces workspace logical uniqueness, provisioning idempotency, and service capabilities` @ `b8753436c257fa72bf59b8f5fbc3a22eff16d5fc` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-004: AC-004: `workspace_connection_revisions`を不変snapshotの正本とし、`workspace_connections`のcurrent pointerは既存snapshotだけを指す。credential・usage・receipt等のrevision参照は履歴へ向け、snapshot追加前にcurrent pointerを進めず、孤立snapshotや存在しないcurrent revisionを保存できない。
  - spec clauses: INV-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `b8753436c257fa72bf59b8f5fbc3a22eff16d5fc` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `passes the reserved canonical connection identity and next revision to the credential store on reinstall` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-005: AC-005: 同じidempotency keyと同じ宣言の再実行は、既存の成功結果を返して書込みを増やさない。keyと宣言の不一致はconflictとして拒否する。
  - spec clauses: C-003
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `replays the same operation without duplicate writes` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-006: AC-006: provisionerはschema確認、tenant、tenant revision、workspace connection、contract、service registry、canonical project検証を一つの明示的な段階として実行し、途中失敗時に有効化状態を残さない。contract revisionは契約本体payloadとruntime bindingを宣言から完全に検証・保存・readbackし、既存revisionとの不一致をconflictとして拒否する。
  - spec clauses: INV-005, S-002, C-005
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioning-resolvers.test.js` — `resolves one canonical project with a bounded, separate read client` @ `4c10c5fdfa6eb2dfe9d175b8215fab17e39dc91d` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed on ambiguous Graph project and never writes a Graph person` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `requires the canonical runtime contract binding fields` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed when a canonical contract revision already has a different payload` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-007: AC-007: service actorとcapabilityはBrainbaseのregistryで一意に管理し、既存Graphへ `person` として書き込まない。権限付与はactor、capability、tenant、project境界を検証してから行う。
  - spec clauses: C-004
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed on ambiguous Graph project and never writes a Graph person` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-008: AC-008: manifest、通常ログ、receipt、Graphにはtoken、secret、private key、OAuth本文を一切出さず、opaque credential referenceとpublic key metadataだけを扱う。
  - spec clauses: INV-003
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `rejects unknown tenant identity and secret material without echoing the value` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `does not persist secret bodies or model service actors as Graph persons` @ `b8753436c257fa72bf59b8f5fbc3a22eff16d5fc` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-009: AC-009: CLIはデフォルトでread-onlyまたはdry-runであり、DB書込みには明示的なapply承認と実行actorを要求する。migration actorは `BRAINBASE_MIGRATION_ACTOR` から取得してDB ledgerの `applied_by` に記録し、本番適用は `--approve-apply` とrollout receiptで承認を固定する。出力は秘密値を含まないJSONで再読込できる。
  - spec clauses: C-007
  - test: `tests/server/scripts/provision-tenant.test.js` — `keeps check and dry-run safe and requires explicit approval for apply` @ `92b57b99d86de7b571788d56718baacd4f22f214` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/scripts/tenant-production-provisioning-migration.test.js` — `requires one mode and explicit approval plus actor for apply` @ `46e2a5dee50686d31cb3d603dd724503be24a3ea` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-010: AC-010: schema差分、provisioning結果、Graph検証結果、contract revision readbackを同一operation IDで追跡でき、未確認・障害・部分適用を成功や0件へ丸めない。
  - spec clauses: C-006, C-005
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `requires the canonical runtime contract binding fields` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed when a canonical contract revision already has a different payload` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-011: AC-011: provisionerは短いtransactionでoperation claimとattemptを永続化してcommit・lock解放した後だけ、`createPostgresGraphProjectResolver` によるread-onlyのcanonical projects lookupをbounded timeout付きで呼ぶ。適用はfresh transactionで同じclaimをfencing確認してから行い、失敗後の再試行で発行した新claimに対して旧実行が完了を書き込めない。
  - spec clauses: INV-005, S-001
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioning-resolvers.test.js` — `resolves one canonical project with a bounded, separate read client` @ `4c10c5fdfa6eb2dfe9d175b8215fab17e39dc91d` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `records a redacted failed operation after an apply rollback` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `b69ff4f76157d2aa31190527ed97b72eae235499` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
- [mapped] AC-012: AC-012: Slack OAuth callbackはintent、request digest、exchange claimを短いtransactionで永続化してから外部token exchangeを行う。登録はfresh transactionで同じclaimとtenant／workspace／app bindingを再検証し、connectionの不変snapshot追加、current pointer更新、opaque credential参照、intent消費、ledger完了を原子的に確定する。完了済みcallbackは保存結果を返し、同時callback、replay、workspace／app衝突、旧claimの完了はfail closedにする。
  - spec clauses: INV-004, S-003
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `claims before OAuth and suppresses a concurrent callback` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `writes and reads back the intent, connection revision, opaque credential and exchange ledger atomically` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `returns the completed ledger result before exchanging a replayed OAuth code` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `marks failed claims retryable and fences stale completion` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `claims concurrent callbacks before OAuth so only one external exchange and registration occur` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `e162c3bd26f64a12e84319f4fd9f2bc250fe6886`)

### Spec
- accepted spec present (`story-tenant-production-provisioning-control-plane`, 14 clause(s))
- drift: clean (0 item(s))

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
- [build] pass — `npx tsc --noEmit -p public/jsconfig.json` (runtime `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [typecheck] pass — `npm run typecheck` (runtime `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [integration] pass — `npx vitest run --maxWorkers=1 tests/server/bootstrap/tenant-runtime-internal-server.test.js tests/server/bootstrap/slack-installation-control-plane-auth-order.test.js tests/server/bootstrap/slack-installation-control-plane.test.js tests/server/cloudflare/tenant-runtime-bridge.test.js tests/server/cloudflare/slack-installation-control-plane-bridge.test.js tests/server/routes/tenant-runtime-bootstrap.test.js tests/server/routes/tenant-runtime-contract.test.js tests/server/routes/slack-installation-control-plane.test.js tests/server/scripts/multitenant-platform-schema-migration.test.js tests/server/scripts/provision-tenant.test.js tests/server/scripts/tenant-production-provisioning-migration.integration.test.js tests/server/scripts/tenant-production-provisioning-migration.test.js tests/server/services/multitenant` (runtime `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 生成proposal: 2件 (todo=2); execution_policy=未指定; mutates_repository=未指定 — .vibepro/stories/story-tenant-production-provisioning-control-plane/tasks/tasks.md

### Review
- status: needs_review (pass=1, needs_review=6, block=0)
  - planning_spec: pass (product_requirement, architecture_boundary, spec_consistency)
  - requirement: needs_review (product_requirement, scope_risk, acceptance_e2e)
  - architecture_spec: needs_review (architecture_boundary, spec_consistency, regression_risk)
  - test_plan: needs_review (unit_integration, e2e_ux, gate_coverage)
  - implementation: needs_review (code_spec_alignment, runtime_contract, ux_completion)
  - gate: needs_review (gate_evidence, pr_split_scope, release_risk)
  - preview: needs_review (preview_smoke, network_runtime, human_usability)

### Changed files
- M	.github/workflows/graph-writer-contract.yml
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/head-binding.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/pr-body.md
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/pr-prepare.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/traceability.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/verification-evidence.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/verification-runs/integration.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/verification-runs/integration.log
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/verification-runs/typecheck.json
- A	.vibepro/pr/story-tenant-production-provisioning-control-plane/verification-runs/typecheck.log
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/parallel-dispatch.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-plan.json
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-request-gate_evidence.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-request-pr_split_scope.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-request-release_risk.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-summary.json
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/gate/review-summary.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/parallel-dispatch.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-plan.json
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-request-architecture_boundary.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-request-product_requirement.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-request-spec_consistency.md
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-summary.json
- A	.vibepro/reviews/story-tenant-production-provisioning-control-plane/planning_spec/review-summary.md
- A	.vibepro/spec/story-tenant-production-provisioning-control-plane/drift.json
- A	.vibepro/spec/story-tenant-production-provisioning-control-plane/drift.md
- A	.vibepro/spec/story-tenant-production-provisioning-control-plane/pre-spec-readiness.json
- A	.vibepro/spec/story-tenant-production-provisioning-control-plane/spec.json
- M	docs/architecture/story-brainbase-multitenant-platform.md
- A	docs/architecture/story-tenant-production-provisioning-control-plane.md
- M	docs/management/stories/active/story-brainbase-multitenant-platform.md
- A	docs/management/stories/active/story-tenant-production-provisioning-control-plane.md
- M	docs/runbooks/multitenant-platform-schema-migration.md
- M	docs/specs/brainbase-multitenant-platform-spec.md
- A	docs/specs/story-tenant-production-provisioning-control-plane.md
- A	docs/specs/story-tenant-production-provisioning-control-plane.vibepro.json
- M	package.json
- A	packages/cloudflare-slack-installation-control-plane-bridge/package.json
- A	packages/cloudflare-slack-installation-control-plane-bridge/src/worker.js
- A	packages/cloudflare-slack-installation-control-plane-bridge/wrangler.jsonc
- M	scripts/migrate-multitenant-platform-schema.js
- A	scripts/migrate-tenant-production-provisioning.js
- A	scripts/provision-tenant.js
- M	server.js
- M	server/bootstrap/core-services.js
- M	server/bootstrap/register-api-routes.js
- A	server/bootstrap/slack-installation-control-plane.js
- M	server/middleware/csrf.js
- A	server/routes/slack-installation-control-plane.js
- M	server/routes/tenant-runtime.js
- M	server/services/multitenant/ids.js
- A	server/services/multitenant/migration-plan-attestor.js
- M	server/services/multitenant/migration-planner.js
- M	server/services/multitenant/postgres-migration-adapter.js
- M	server/services/multitenant/postgres-repository.js
- A	server/services/multitenant/provisioning-manifest.js
- A	server/services/multitenant/slack-installation-access.js
- A	server/services/multitenant/slack-installation-auth.js
- A	server/services/multitenant/slack-installation-control-plane.js
- A	server/services/multitenant/tenant-provisioner.js
- A	server/services/multitenant/tenant-provisioning-resolvers.js
- M	server/services/multitenant/tenant-runtime-services.js
- M	server/services/multitenant/workspace-connection-registry.js
- M	server/sql/multitenant-platform-schema.sql
- A	server/sql/tenant-production-provisioning-schema.sql
- A	tests/server/bootstrap/slack-installation-control-plane-auth-order.test.js
- A	tests/server/bootstrap/slack-installation-control-plane.test.js
- A	tests/server/cloudflare/slack-installation-control-plane-bridge.test.js
- A	tests/server/routes/slack-installation-control-plane.test.js
- M	tests/server/routes/tenant-runtime-bootstrap.test.js
- M	tests/server/scripts/multitenant-platform-schema-migration.test.js
- A	tests/server/scripts/provision-tenant.test.js
- A	tests/server/scripts/tenant-production-provisioning-migration.integration.test.js
- A	tests/server/scripts/tenant-production-provisioning-migration.test.js
- A	tests/server/services/multitenant/migration-plan-attestor.test.js
- M	tests/server/services/multitenant/migration-planner.test.js
- M	tests/server/services/multitenant/persistence-schema.test.js
- M	tests/server/services/multitenant/postgres-migration-adapter.integration.test.js
- M	tests/server/services/multitenant/postgres-repository.test.js
- A	tests/server/services/multitenant/provisioning-manifest.test.js
- A	tests/server/services/multitenant/slack-installation-access.test.js
- A	tests/server/services/multitenant/slack-installation-auth.test.js
- A	tests/server/services/multitenant/slack-installation-control-plane.integration.test.js
- A	tests/server/services/multitenant/slack-installation-control-plane.test.js
- A	tests/server/services/multitenant/tenant-provisioner.test.js
- A	tests/server/services/multitenant/tenant-provisioning-resolvers.test.js
- A	tests/server/services/multitenant/tenant-provisioning-schema.test.js
- M	tests/server/services/multitenant/workspace-connection.test.js

