## 判断
- このPRで判断すること: Playwrightの探索対象をcanonical E2Eへ限定する を満たすための Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-playwright-worktree-discovery-boundary - Playwrightの探索対象をcanonical E2Eへ限定する
- 正本: [docs/stories/story-playwright-worktree-discovery-boundary.md](docs/stories/story-playwright-worktree-discovery-boundary.md)
- 変更範囲: 6 files / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/stories/story-playwright-worktree-discovery-boundary.md](docs/stories/story-playwright-worktree-discovery-boundary.md), [docs/architecture/playwright-worktree-discovery-boundary.md](docs/architecture/playwright-worktree-discovery-boundary.md), [docs/specs/story-playwright-worktree-discovery-boundary.md](docs/specs/story-playwright-worktree-discovery-boundary.md)
- テスト: [tests/e2e/story-playwright-worktree-discovery-boundary-collector.spec.ts](tests/e2e/story-playwright-worktree-discovery-boundary-collector.spec.ts), [tests/unit/playwright-config-boundary.test.js](tests/unit/playwright-config-boundary.test.js)

## 経緯
- 要求: Playwrightの探索対象をcanonical E2Eへ限定する
- 発生経緯: Brainbaseの正本checkout直下には、並行作業用の`.worktrees/`と`.codex-worktrees/`が存在する。現在のPlaywright設定は`testDir: '.'`から再帰探索するため、これら別checkoutのE2E、Vitest、`node_modules`まで読み込み、依存関係の二重ロードや不足を起こして正本テストを0件として終了する。


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/stories/story-playwright-worktree-discovery-boundary.md](docs/stories/story-playwright-worktree-discovery-boundary.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- テスト差分: [tests/e2e/story-playwright-worktree-discovery-boundary-collector.spec.ts](tests/e2e/story-playwright-worktree-discovery-boundary-collector.spec.ts), [tests/unit/playwright-config-boundary.test.js](tests/unit/playwright-config-boundary.test.js)
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Vitest executed all three focused configuration contract cases on current HEAD: 3 passed, 0 failed.; evidence: [.vibepro/qa/playwright-worktree-boundary/unit.json](.vibepro/qa/playwright-worktree-boundary/unit.json) / gate: passed / evidence: [.vibepro/qa/playwright-worktree-boundary/unit.json](.vibepro/qa/playwright-worktree-boundary/unit.json)
- [x] Integration Gate - Imported CI evidence for Require Graphify Impact Review (SUCCESS) at HEAD 336faa2cc7cc; evidence: [.vibepro/pr/story-playwright-worktree-discovery-boundary/ci-evidence/Require_Graphify_Impact_Review.json](.vibepro/pr/story-playwright-worktree-discovery-boundary/ci-evidence/Require_Graphify_Impact_Review.json) / gate: passed / evidence: [.vibepro/pr/story-playwright-worktree-discovery-boundary/ci-evidence/Require_Graphify_Impact_Review.json](.vibepro/pr/story-playwright-worktree-discovery-boundary/ci-evidence/Require_Graphify_Impact_Review.json)
- [x] E2E Gate - Behavioral collector E2E passed: 3 expected, 0 unexpected; excluded modules were not imported.; evidence: [.vibepro/qa/playwright-worktree-boundary/e2e.json](.vibepro/qa/playwright-worktree-boundary/e2e.json) / gate: passed / evidence: [.vibepro/qa/playwright-worktree-boundary/e2e.json](.vibepro/qa/playwright-worktree-boundary/e2e.json)
- 最終E2E: pass: Behavioral collector E2E passed: 3 expected, 0 unexpected; excluded modules were not imported.（[.vibepro/qa/playwright-worktree-boundary/e2e.json](.vibepro/qa/playwright-worktree-boundary/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-playwright-worktree-discovery-boundary/](.vibepro/pr/story-playwright-worktree-discovery-boundary/)
- PR準備: [.vibepro/pr/story-playwright-worktree-discovery-boundary/pr-prepare.json](.vibepro/pr/story-playwright-worktree-discovery-boundary/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-playwright-worktree-discovery-boundary/decision-index.json](.vibepro/pr/story-playwright-worktree-discovery-boundary/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 88dd9d39aee5 detached/package clean (story=story-playwright-worktree-discovery-boundary)
