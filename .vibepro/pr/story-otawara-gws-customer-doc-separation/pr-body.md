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
- accepted-spec lineage: invalid — `.vibepro/spec/story-otawara-gws-customer-doc-separation/spec.json` @ `missing` (HEAD `eaa5d0926dd55f24bd8f1eb1f73389775bbf21c2`)
  - story: `docs/management/stories/active/story-otawara-gws-customer-doc-separation.md` @ `missing` (HEAD `eaa5d0926dd55f24bd8f1eb1f73389775bbf21c2`)
  - reasons: accepted_spec_not_in_head, story_not_in_head, unknown_story_ac, test_file_missing, test_pattern_failed, story_ref_missing
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
- [unit] pass — `npm test -- --maxWorkers=4` (runtime `13174d744da538e35f5e5a6b33ec46e8b8a24c3cd0e43423129d279267505f64`)
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
- reviewer: pass (current) — 顧客固有の otawara-gws-local-onboarding Story/Spec/Architecture 本文は共有repoに無く、台帳が cursorvers/brainbase-instance-cursorvers を正本として指す。境界テストは当該文書の復帰で失敗する。共有の google-workspace-local-onboarding 設計と他の顧客文書は変更していない。診断の既存finding（VP-NET-001 など）はこの差分の対象外。
- blocking reasons: none

### Changed files
- (no diff against base)

