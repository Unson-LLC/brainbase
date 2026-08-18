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
- accepted-spec lineage: resolved — `.vibepro/spec/story-tenant-production-provisioning-control-plane/spec.json` @ `79b9934774d5460091ccc403d70cb747df41daa2` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - story: `docs/management/stories/active/story-tenant-production-provisioning-control-plane.md` @ `eeb41a1dd955cea76ccc0e74ecf8e72cf5c61ac8` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-001: AC-001: テナントに人間が読める `tenant_key` と不変のcanonical tenant IDを持たせ、同一keyの重複を拒否できる。
  - spec clauses: C-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `1f920f0b47b2c42d31fb337e1aef0fee317930f0` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-002: AC-002: テナントrevisionを履歴として保持し、tenant-owned recordは現在値だけでなく書込み時revisionへ参照整合する。revision更新で既存recordの外部キーを壊さない。
  - spec clauses: C-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `1f920f0b47b2c42d31fb337e1aef0fee317930f0` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-003: AC-003: 同じtenant・provider・workspace・appの有効接続は一つだけで、再インストールは既存connectionのrevision更新として表現できる。
  - spec clauses: C-002
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `enforces workspace logical uniqueness, provisioning idempotency, and service capabilities` @ `1f920f0b47b2c42d31fb337e1aef0fee317930f0` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-004: AC-004: `workspace_connection_revisions`を不変snapshotの正本とし、`workspace_connections`のcurrent pointerは既存snapshotだけを指す。credential・usage・receipt等のrevision参照は履歴へ向け、snapshot追加前にcurrent pointerを進めず、孤立snapshotや存在しないcurrent revisionを保存できない。
  - spec clauses: INV-001
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `defines tenant key, append-only revision history, and revision FKs` @ `1f920f0b47b2c42d31fb337e1aef0fee317930f0` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `passes the reserved canonical connection identity and next revision to the credential store on reinstall` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-005: AC-005: 同じidempotency keyと同じ宣言の再実行は、既存の成功結果を返して書込みを増やさない。keyと宣言の不一致はconflictとして拒否する。
  - spec clauses: C-003
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `replays the same operation without duplicate writes` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-006: AC-006: provisionerはschema確認、tenant、tenant revision、workspace connection、contract、service registry、canonical project検証を一つの明示的な段階として実行し、途中失敗時に有効化状態を残さない。contract revisionは契約本体payloadとruntime bindingを宣言から完全に検証・保存・readbackし、既存revisionとの不一致をconflictとして拒否する。
  - spec clauses: INV-005, S-002, C-005
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioning-resolvers.test.js` — `resolves one canonical project with a bounded, separate read client` @ `4c10c5fdfa6eb2dfe9d175b8215fab17e39dc91d` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed on ambiguous Graph project and never writes a Graph person` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `requires the canonical runtime contract binding fields` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed when a canonical contract revision already has a different payload` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-007: AC-007: service actorとcapabilityはBrainbaseのregistryで一意に管理し、既存Graphへ `person` として書き込まない。権限付与はactor、capability、tenant、project境界を検証してから行う。
  - spec clauses: C-004
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed on ambiguous Graph project and never writes a Graph person` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-008: AC-008: manifest、通常ログ、receipt、Graphにはtoken、secret、private key、OAuth本文を一切出さず、opaque credential referenceとpublic key metadataだけを扱う。
  - spec clauses: INV-003
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `rejects unknown tenant identity and secret material without echoing the value` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioning-schema.test.js` — `does not persist secret bodies or model service actors as Graph persons` @ `1f920f0b47b2c42d31fb337e1aef0fee317930f0` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-009: AC-009: CLIはデフォルトでread-onlyまたはdry-runであり、DB書込みには明示的なapply承認と実行actorを要求する。migration actorは `BRAINBASE_MIGRATION_ACTOR` から取得してDB ledgerの `applied_by` に記録し、本番適用は `--approve-apply` とrollout receiptで承認を固定する。出力は秘密値を含まないJSONで再読込できる。
  - spec clauses: C-007
  - test: `tests/server/scripts/provision-tenant.test.js` — `keeps check and dry-run safe and requires explicit approval for apply` @ `92b57b99d86de7b571788d56718baacd4f22f214` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/scripts/tenant-production-provisioning-migration.test.js` — `requires one mode and explicit approval plus actor for apply` @ `43795eb019401abc413a04a608cc6ba8f659ab62` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-010: AC-010: schema差分、provisioning結果、Graph検証結果、contract revision readbackを同一operation IDで追跡でき、未確認・障害・部分適用を成功や0件へ丸めない。
  - spec clauses: C-006, C-005
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/provisioning-manifest.test.js` — `requires the canonical runtime contract binding fields` @ `6d7ccb7bcca11ac0bb7cd6b88fdfa92d4f233054` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `returns a redacted readback receipt after an atomic apply` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `fails closed when a canonical contract revision already has a different payload` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-011: AC-011: provisionerは短いtransactionでoperation claimとattemptを永続化してcommit・lock解放した後だけ、`createPostgresGraphProjectResolver` によるread-onlyのcanonical projects lookupをbounded timeout付きで呼ぶ。適用はfresh transactionで同じclaimをfencing確認してから行い、失敗後の再試行で発行した新claimに対して旧実行が完了を書き込めない。
  - spec clauses: INV-005, S-001
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioning-resolvers.test.js` — `resolves one canonical project with a bounded, separate read client` @ `4c10c5fdfa6eb2dfe9d175b8215fab17e39dc91d` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `records a redacted failed operation after an apply rollback` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/tenant-provisioner.test.js` — `reclaims a failed operation with the same fingerprint and fences the old attempt` @ `70d800fb0e9d99ded357a5403e821472e2a09c4b` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
- [mapped] AC-012: AC-012: Slack OAuth callbackはintent、request digest、exchange claimを短いtransactionで永続化してから外部token exchangeを行う。登録はfresh transactionで同じclaimとtenant／workspace／app bindingを再検証し、connectionの不変snapshot追加、current pointer更新、opaque credential参照、intent消費、ledger完了を原子的に確定する。完了済みcallbackは保存結果を返し、同時callback、replay、workspace／app衝突、旧claimの完了はfail closedにする。
  - spec clauses: INV-004, S-003
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `claims before OAuth and suppresses a concurrent callback` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `writes and reads back the intent, connection revision, opaque credential and exchange ledger atomically` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `returns the completed ledger result before exchanging a replayed OAuth code` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.test.js` — `marks failed claims retryable and fences stale completion` @ `c640ec4a9fc64b795a2d58266336a0f1184a14e2` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)
  - test: `tests/server/services/multitenant/slack-installation-control-plane.integration.test.js` — `claims concurrent callbacks before OAuth so only one external exchange and registration occur` @ `ba44f74e9419e4b9ad77dca8623bf654640825e9` (HEAD `9cead354c8e6d462f786cacb697c4910feb00182`)

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
- [typecheck] pass — `npm run typecheck` (runtime `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [integration] pass — `npx vitest run tests/server/services/multitenant tests/server/scripts/tenant-production-provisioning-migration.test.js tests/server/scripts/tenant-production-provisioning-migration.integration.test.js --maxWorkers=1` (runtime `c785934050bf71cd6644d7c40477854fbab61a75a25fc7e2849fcd52aa1917d9`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 生成proposal: 2件 (todo=2); execution_policy=未指定; mutates_repository=未指定 — .vibepro/stories/story-tenant-production-provisioning-control-plane/tasks/tasks.md

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
- M	.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs
- M	.env.example
- A	.vibepro/spec/story-brainbase-multitenant-platform/spec.json
- A	.vibepro/spec/story-tenant-production-provisioning-control-plane/spec.json
- M	AGENTS.md
- M	CLAUDE.md
- M	config/com.brainbase.mcp-nocodb.plist
- M	config/com.brainbase.mcp-slack-salestailor.plist
- M	config/com.brainbase.mcp-slack-t0882t8n9uh-upload.plist
- M	config/com.brainbase.mcp-slack-t0882t8n9uh.plist
- M	config/com.brainbase.mcp-slack-techknight.plist
- M	config/com.brainbase.mcp-slack-unson.plist
- M	config/com.brainbase.sns-feedback-metrics-poller.plist
- M	config/com.brainbase.sns-scheduled-publisher.plist
- M	docs/architecture/ADR-011-sns-posting-ledger-boundary.md
- M	docs/architecture/ADR-017-agent-first-product-surface.md
- M	docs/architecture/sns-approval-schedules-posting-architecture.md
- A	docs/architecture/story-brainbase-multitenant-platform.md
- A	docs/architecture/story-tenant-production-provisioning-control-plane.md
- A	docs/contracts/intent-to-outcome-evidence-v1.md
- A	docs/decisions/2026-08-18_intent-to-outcome-north-star.md
- A	docs/management/stories/active/story-brainbase-multitenant-platform.md
- A	docs/management/stories/active/story-tenant-production-provisioning-control-plane.md
- A	docs/runbooks/cloudflare-tenant-runtime-bridge.md
- A	docs/runbooks/multitenant-platform-schema-migration.md
- M	docs/runbooks/sns-scheduled-publisher.md
- A	docs/specs/brainbase-multitenant-platform-spec.md
- M	docs/specs/sns-growth-cockpit-ui-transition-spec.md
- M	docs/specs/sns-scheduled-publisher-spec.md
- A	docs/specs/story-brainbase-multitenant-platform.vibepro.json
- A	docs/specs/story-tenant-production-provisioning-control-plane.md
- A	docs/specs/story-tenant-production-provisioning-control-plane.vibepro.json
- M	docs/stories/sns-scheduled-publisher-story.md
- M	mcp/brainbase/src/indexer/index.ts
- M	mcp/brainbase/src/server.ts
- A	mcp/brainbase/src/tools/tenant-boundary-tools.ts
- M	mcp/brainbase/tests/tools/entity-resolver.test.ts
- A	mcp/brainbase/tests/tools/tenant-boundary-tools.test.ts
- M	package-lock.json
- M	package.json
- A	packages/cloudflare-slack-installation-control-plane-bridge/package.json
- A	packages/cloudflare-slack-installation-control-plane-bridge/src/worker.js
- A	packages/cloudflare-slack-installation-control-plane-bridge/wrangler.jsonc
- A	packages/cloudflare-tenant-runtime-bridge/package.json
- A	packages/cloudflare-tenant-runtime-bridge/src/worker.js
- A	packages/cloudflare-tenant-runtime-bridge/wrangler.jsonc
- M	scripts/ai-session-adapter/codex-envelope-builder.mjs
- M	scripts/import-sns-review-pack-to-ledger.js
- A	scripts/migrate-multitenant-platform-schema.js
- A	scripts/migrate-tenant-production-provisioning.js
- M	scripts/poll-sns-feedback-metrics.js
- A	scripts/provision-tenant.js
- M	scripts/run-nocodb-mcp.sh
- M	scripts/run-sns-scheduled-posts.js
- M	server.js
- M	server/bootstrap/core-services.js
- M	server/bootstrap/graceful-shutdown.js
- M	server/bootstrap/register-api-routes.js
- A	server/bootstrap/slack-installation-control-plane.js
- A	server/bootstrap/tenant-runtime-internal-server.js
- M	server/middleware/csrf.js
- M	server/middleware/personal-knowledge-access.js
- A	server/middleware/tenant-entrypoint.js
- M	server/routes/info-ssot.js
- A	server/routes/slack-installation-control-plane.js
- M	server/routes/sns-growth.js
- A	server/routes/tenant-runtime.js
- M	server/services/auth-service.js
- M	server/services/meeting-minutes/context-receipt-service.js
- A	server/services/multitenant/canonical-json.js
- A	server/services/multitenant/canonical-wire-validator.js
- A	server/services/multitenant/contract-usage-ledger.js
- A	server/services/multitenant/credential-broker.js
- A	server/services/multitenant/errors.js
- A	server/services/multitenant/ids.js
- A	server/services/multitenant/migration-planner.js
- A	server/services/multitenant/postgres-contract-usage-ledger.js
- A	server/services/multitenant/postgres-migration-adapter.js
- A	server/services/multitenant/postgres-repository.js
- A	server/services/multitenant/protocol-contract.js
- A	server/services/multitenant/provisioning-manifest.js
- A	server/services/multitenant/service-auth.js
- A	server/services/multitenant/slack-installation-access.js
- A	server/services/multitenant/slack-installation-auth.js
- A	server/services/multitenant/slack-installation-control-plane.js
- A	server/services/multitenant/tenant-authority.js
- A	server/services/multitenant/tenant-boundary.js
- A	server/services/multitenant/tenant-context-producer.js
- A	server/services/multitenant/tenant-context.js
- A	server/services/multitenant/tenant-provisioner.js
- A	server/services/multitenant/tenant-provisioning-resolvers.js
- A	server/services/multitenant/tenant-runtime-services.js
- A	server/services/multitenant/trusted-provider-forwarder.js
- A	server/services/multitenant/workspace-connection-registry.js
- M	server/services/personal-knowledge/personal-knowledge-promotion-service.js
- M	server/services/sns/posting-ledger-repository.js
- M	server/services/sns/sns-ledger-publish-service.js
- M	server/services/sns/sns-scheduled-publisher.js
- A	server/sql/multitenant-platform-schema.sql
- A	server/sql/tenant-production-provisioning-schema.sql
- ... and 63 more

