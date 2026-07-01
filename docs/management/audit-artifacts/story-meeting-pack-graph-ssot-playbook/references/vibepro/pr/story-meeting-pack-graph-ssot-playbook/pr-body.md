## 判断
- このPRで判断すること: Meeting Pack Graph SSOT Playbook を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-meeting-pack-graph-ssot-playbook - Meeting Pack Graph SSOT Playbook
- 正本: [docs/stories/story-meeting-pack-graph-ssot-playbook.md](docs/stories/story-meeting-pack-graph-ssot-playbook.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-meeting-pack-graph-ssot-playbook.md](docs/stories/story-meeting-pack-graph-ssot-playbook.md), [docs/architecture/story-meeting-pack-graph-ssot-playbook.md](docs/architecture/story-meeting-pack-graph-ssot-playbook.md), [docs/specs/story-meeting-pack-graph-ssot-playbook-spec.md](docs/specs/story-meeting-pack-graph-ssot-playbook-spec.md)
- 実装: server/services/workflow/workflow-service.js
- テスト: [tests/e2e/story-companion-approval-inbox-v1-contract.spec.ts](tests/e2e/story-companion-approval-inbox-v1-contract.spec.ts), [tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts](tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts), [tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts](tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts), ...and 2 more

## 経緯
- 要求: Meeting Pack Graph SSOT Playbook
- 発生経緯: Meeting Packで議事録、Task、Decision、Graph昇格候補を作る時は、最初に「どのプロジェクトの会議か」を確定する。その後でだけ、Brainbase Graph SSOTからそのprojectに属する人物、組織、既存Decision、RACI、KPI、initiative、用語集を引く。 Graph SSOTは会議内容の事実ソースではない。TranscriptとSlack添付が発言・合意・宿題の事実ソースであり、Graph SSOTは固有名詞、人物同一性、関係、用語、既存プロジェクト文脈を誤らないための補助文脈である。 このStoryでは、その処理順序をDAG PlaybookとしてReview Package


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-meeting-pack-graph-ssot-playbook.md](docs/stories/story-meeting-pack-graph-ssot-playbook.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 4 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: server/services/workflow/workflow-service.js
- テスト差分: [tests/e2e/story-companion-approval-inbox-v1-contract.spec.ts](tests/e2e/story-companion-approval-inbox-v1-contract.spec.ts), [tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts](tests/e2e/story-meeting-pack-graph-ssot-playbook-contract.spec.ts), [tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts](tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts), [tests/server/routes/companion-approval-inbox.test.js](tests/server/routes/companion-approval-inbox.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 75 route/unit tests passed on current HEAD; workflow review-ingest pairs decision_candidates output with graph_ssot_decision human approval metadata, and companion inbox treats it as actionable rather than output_only.; evidence: ../../../../../tmp/meeting-pack-decision-human-step/vitest-routes.json / gate: passed / evidence: ../../../../../tmp/meeting-pack-decision-human-step/vitest-routes.json
- [x] Integration Gate - Current HEAD and PR #1003 CI verify release_ops evidence for the decision approval pairing change.; evidence: [.vibepro/pr/story-meeting-pack-graph-ssot-playbook/verification-evidence.json](.vibepro/pr/story-meeting-pack-graph-ssot-playbook/verification-evidence.json) / gate: passed / evidence: [.vibepro/pr/story-meeting-pack-graph-ssot-playbook/verification-evidence.json](.vibepro/pr/story-meeting-pack-graph-ssot-playbook/verification-evidence.json)
- [x] E2E Gate - 39 Playwright E2E tests passed and 1 skipped on current HEAD; flow replay and artifact replay cover Meeting Pack decision approval pairing from review ingest to Mac Companion inbox.; evidence: ../../../../../tmp/meeting-pack-decision-human-step/playwright-meeting-pack.json / gate: passed / evidence: ../../../../../tmp/meeting-pack-decision-human-step/playwright-meeting-pack.json
- 最終E2E: pass: 39 Playwright E2E tests passed and 1 skipped on current HEAD; flow replay and artifact replay cover Meeting Pack decision approval pairing from review ingest to Mac Companion inbox.（../../../../../tmp/meeting-pack-decision-human-step/playwright-meeting-pack.json）

## 詳細
- 証跡: [.vibepro/pr/story-meeting-pack-graph-ssot-playbook/](.vibepro/pr/story-meeting-pack-graph-ssot-playbook/)
- PR準備: [.vibepro/pr/story-meeting-pack-graph-ssot-playbook/pr-prepare.json](.vibepro/pr/story-meeting-pack-graph-ssot-playbook/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-meeting-pack-graph-ssot-playbook/decision-index.json](.vibepro/pr/story-meeting-pack-graph-ssot-playbook/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 202599f7082d main dirty (story=story-meeting-pack-graph-ssot-playbook)
