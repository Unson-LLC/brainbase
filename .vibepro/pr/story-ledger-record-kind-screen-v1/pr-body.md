## 要件台帳 Spec 1: record_kind（kernel 側）

Story: `story-ledger-record-kind-screen-v1`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.34`
- source: `npm_package` at `/home/box/.local/lib/node_modules/vibepro`
- entrypoint: `/home/box/.local/lib/node_modules/vibepro/bin/vibepro.js`
- source SHA: `6f87c7f1829c2ee98d0ae8bd52738303d5e5aa0d`
- identity digest: `b44cefd5f8c3cc7e5283c6aeb1499732b647653b36c3bf98664a2c0f2926a484`

### Story document
- no story document found (informational only; does not block PR creation)

### Acceptance criteria
- no acceptance criteria found in the story document

### Spec
- no accepted spec found for this story

### Semantic sufficiency
- answer resolution: `unavailable`
- automatic continuation: `false`
- counterexample status: `unavailable`
- warnings: none
- outcome coverage:
  - internal_output: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - downstream_outcome: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - canonical_readback: `unknown` (declared=0, answer_resolved=0, verification=unknown)

### Multi-tenant architecture
- status: not_applicable

### Verification evidence
- [integration] pass — `npx vitest run tests/canonical-task-postgres-service.integration.test.ts` (runtime `b44cefd5f8c3cc7e5283c6aeb1499732b647653b36c3bf98664a2c0f2926a484`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [unit] pass — `npx vitest run tests/canonical-task-service.test.ts tests/canonical-task-postgres.test.ts` (runtime `b44cefd5f8c3cc7e5283c6aeb1499732b647653b36c3bf98664a2c0f2926a484`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [build] pass — `npm run build` (runtime `b44cefd5f8c3cc7e5283c6aeb1499732b647653b36c3bf98664a2c0f2926a484`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 未検出
- 生成proposal: 未検出

### Development Judgment
- available: false
- status: not_recorded
- lifecycle: not_started
- applicable: not_recorded
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
- next: vibepro judgment applicability record . --id story-ledger-record-kind-screen-v1 --applicable yes|no --reason <text>

### Review
- recorded: false
- complete: false
- status: not_recorded
- blocking reasons: none

### Changed files
- M	.vibepro/config.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/pr-body.md
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/pr-prepare.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/traceability.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-evidence.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/build.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/build.log
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/integration.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/integration.log
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/unit.json
- A	.vibepro/pr/story-ledger-record-kind-screen-v1/verification-runs/unit.log
- M	contracts/canonical-task/store-schema.sql
- A	docs/releases/unreleased-record-kind.md
- M	src/canonical-task-postgres.ts
- M	src/canonical-task-service.ts
- M	tests/canonical-task-postgres-service.integration.test.ts
- M	tests/canonical-task-postgres.test.ts
- M	tests/canonical-task-service.test.ts

