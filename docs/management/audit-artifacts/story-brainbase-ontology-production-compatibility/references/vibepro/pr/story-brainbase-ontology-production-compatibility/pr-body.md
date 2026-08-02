## 判断
- このPRで判断すること: 本番GraphとOntology 1.0.0の互換性を確立する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-brainbase-ontology-production-compatibility - 本番GraphとOntology 1.0.0の互換性を確立する
- 正本: [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- 変更範囲: 21 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md), [docs/architecture/ADR-021-brainbase-ontology-kernel.md](docs/architecture/ADR-021-brainbase-ontology-kernel.md), [docs/architecture/story-brainbase-ontology-production-compatibility.md](docs/architecture/story-brainbase-ontology-production-compatibility.md), ...and 3 more
- 実装: scripts/ontology-shadow-audit.js, server/services/ontology-kernel.js
- テスト: [tests/e2e/story-brainbase-ontology-kernel-contract.spec.ts](tests/e2e/story-brainbase-ontology-kernel-contract.spec.ts), [tests/e2e/story-brainbase-ontology-production-compatibility-contract.spec.ts](tests/e2e/story-brainbase-ontology-production-compatibility-contract.spec.ts), [tests/server/services/ontology-api.test.js](tests/server/services/ontology-api.test.js), ...and 1 more

## 経緯
- 要求: 本番GraphとOntology 1.0.0の互換性を確立する
- 発生経緯: 2026-08-03の本番read-only監査では、7,403 entities / 6,680 edgesに対して6,156件の違反を検出した。主因は、稼働中の`belongs_to_project`始点型、storage型、legacy relation、Decisionのedge表現がOntology 1.0.0候補に未登録だったことである。一方、31件の孤児edge、org ownerを確認できない26 app、Decision authority/scopeの欠損は事実を推測せず残す必要がある。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-brainbase-ontology-production-compatibility
- Task ID: なし
- 対象受入基準: 6件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 4 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/ontology-shadow-audit.js, server/services/ontology-kernel.js
- テスト差分: [tests/e2e/story-brainbase-ontology-kernel-contract.spec.ts](tests/e2e/story-brainbase-ontology-kernel-contract.spec.ts), [tests/e2e/story-brainbase-ontology-production-compatibility-contract.spec.ts](tests/e2e/story-brainbase-ontology-production-compatibility-contract.spec.ts), [tests/server/services/ontology-api.test.js](tests/server/services/ontology-api.test.js), [tests/server/services/ontology-kernel.test.js](tests/server/services/ontology-kernel.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/typecheck.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/typecheck.json)
- [x] Unit Gate - Current-HEAD ontology publication authorization denial security regression passed with preserved runner artifact; evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/publication-security.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/publication-security.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/publication-security.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/publication-security.json)
- [x] Integration Gate - Imported CI evidence for Verify VibePro Graph SSOT (SUCCESS) at HEAD 560f7212e2b0; evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/ci-evidence/Verify_VibePro_Graph_SSOT.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/ci-evidence/Verify_VibePro_Graph_SSOT.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/ci-evidence/Verify_VibePro_Graph_SSOT.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/ci-evidence/Verify_VibePro_Graph_SSOT.json)
- [x] E2E Gate - vibepro verify run executed the e2e command: exit_code=0, duration_ms=2089, status=pass computed from the exit code | agent summary: Current-HEAD expensive ontology contract verification; evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, duration_ms=2089, status=pass computed from the exit code | agent summary: Current-HEAD expensive ontology contract verification（[.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-brainbase-ontology-production-compatibility/](.vibepro/pr/story-brainbase-ontology-production-compatibility/)
- PR準備: [.vibepro/pr/story-brainbase-ontology-production-compatibility/pr-prepare.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.summary.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 37418424323e detached/package dirty (story=story-brainbase-ontology-production-compatibility)
