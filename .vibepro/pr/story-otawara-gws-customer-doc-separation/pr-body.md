## 顧客固有の大田原オンボーディング文書を共通repoから分離する

Story: `story-otawara-gws-customer-doc-separation`
SSOT: local

### 成果ケース連携
- 状態: `none`
- 理由コード: `not_linked`

### VibePro runtime identity
- package: `vibepro@0.2.0-beta.32`
- source: `npm_package` at `/home/ubuntu/.npm-global/lib/node_modules/vibepro`
- entrypoint: `/home/ubuntu/.npm-global/lib/node_modules/vibepro/bin/vibepro.js`
- source SHA: `3cf69f0473db2a5dfe397a496a81a1574e160e0b`
- identity digest: `13174d744da538e35f5e5a6b33ec46e8b8a24c3cd0e43423129d279267505f64`

### Story document
- no story document found (informational only; does not block PR creation)

### Acceptance criteria
- accepted-spec lineage: invalid — `.vibepro/spec/story-otawara-gws-customer-doc-separation/spec.json` @ `9382d7f508f31f4cefa2ef2ee2b2b794fd774245` (HEAD `5e8565145c6c991dc3b1ee02b4e92e6c8aba3efa`)
  - story: `docs/management/stories/active/story-otawara-gws-customer-doc-separation.md` @ `missing` (HEAD `5e8565145c6c991dc3b1ee02b4e92e6c8aba3efa`)
  - reasons: story_not_in_head, unknown_story_ac, story_ref_missing
- no acceptance criteria found in the story document

### Spec
- accepted spec present (`story-otawara-gws-customer-doc-separation`, 4 clause(s))

### Semantic sufficiency
- answer resolution: `unavailable`
- automatic continuation: `false`
- counterexample status: `unavailable`
- warnings: semantic_contract_missing
- outcome coverage:
  - internal_output: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - downstream_outcome: `unknown` (declared=0, answer_resolved=0, verification=unknown)
  - canonical_readback: `unknown` (declared=0, answer_resolved=0, verification=unknown)

### Multi-tenant architecture
- status: not_applicable

### Verification evidence
- [unit] fail — `npm test -- --maxWorkers=4` (runtime `13174d744da538e35f5e5a6b33ec46e8b8a24c3cd0e43423129d279267505f64`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [build] pass — `npm run build` (runtime `13174d744da538e35f5e5a6b33ec46e8b8a24c3cd0e43423129d279267505f64`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません
- [typecheck] pass — `npx tsc -p tsconfig.json --noEmit` (runtime `13174d744da538e35f5e5a6b33ec46e8b8a24c3cd0e43423129d279267505f64`)
  - 自由記述summaryは参考情報であり、計算済み件数の権威ではありません

### タスク権限
- 人間作成タスク: 未検出
- 受理済みauthority: 未検出
- 生成proposal: 3件 (todo=3); execution_policy=未指定; mutates_repository=未指定 — .vibepro/stories/story-otawara-gws-customer-doc-separation/tasks/tasks.md

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
- next: vibepro judgment applicability record . --id story-otawara-gws-customer-doc-separation --applicable yes|no --reason <text>

### Review
- recorded: true
- complete: true
- status: pass
- reviewer: pass (current) — judgment-dag digestを再生成しREADME契約と整合。テストフィクスチャとforbidden_termsを補強。
- blocking reasons: none

### Changed files
- M	.vibepro/config.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/pr-body.md
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/pr-prepare.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/traceability.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-evidence.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/build.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/build.log
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/typecheck.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/typecheck.log
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/unit.json
- A	.vibepro/pr/story-otawara-gws-customer-doc-separation/verification-runs/unit.log
- A	.vibepro/reviews/story-otawara-gws-customer-doc-separation/lightweight/plan.json
- A	.vibepro/reviews/story-otawara-gws-customer-doc-separation/lightweight/review-reviewer.json
- A	.vibepro/spec/story-otawara-gws-customer-doc-separation/draft.json
- A	.vibepro/spec/story-otawara-gws-customer-doc-separation/pre-spec-readiness.json
- A	.vibepro/spec/story-otawara-gws-customer-doc-separation/spec.history/spec-2026-10-17T05-52-52-816Z.json
- A	.vibepro/spec/story-otawara-gws-customer-doc-separation/spec.json
- A	.vibepro/stories/story-otawara-gws-customer-doc-separation/index.html
- A	.vibepro/stories/story-otawara-gws-customer-doc-separation/story-report.md
- A	.vibepro/stories/story-otawara-gws-customer-doc-separation/tasks/tasks.json
- A	.vibepro/stories/story-otawara-gws-customer-doc-separation/tasks/tasks.md
- M	README.md
- M	contracts/judgment-dag/digest.json
- M	docs/architecture/google-workspace-local-onboarding.md
- A	docs/management/customer-doc-ledger.json
- M	docs/specs/google-workspace-local-onboarding-spec.md
- M	docs/stories/google-workspace-local-onboarding.md
- M	docs/stories/onboarding-source-import-extract.md
- M	tests/cli.test.ts
- A	tests/customer-doc-boundary.test.ts
- M	tests/e2e/brainbase-mcp-only-acceptance.spec.ts
- M	tests/e2e/google-workspace-local-onboarding-acceptance.spec.ts
- M	tests/e2e/onboarding-project-registration-acceptance.spec.ts
- M	tests/e2e/onboarding-routine-registration-acceptance.spec.ts
- M	tests/e2e/onboarding-source-import-extract-acceptance.spec.ts
- M	tests/e2e/source-diagnosis-candidates-onboarding-acceptance.spec.ts
- M	tests/fixtures.ts
- M	tests/import-extract.test.ts
- M	tests/mcp-contract.test.ts
- M	tests/projects.test.ts
- M	tests/routines.test.ts
- M	tests/tools.test.ts

