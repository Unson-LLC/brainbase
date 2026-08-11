## 判断
- このPRで判断すること: 判断委任KPIフェーズ1 サーバー側イベント受信・週次集計 を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-brainbase-decision-events-kpi-v1 - 判断委任KPIフェーズ1 サーバー側イベント受信・週次集計
- 正本: [docs/stories/story-brainbase-decision-events-kpi-v1.md](docs/stories/story-brainbase-decision-events-kpi-v1.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-brainbase-decision-events-kpi-v1.md](docs/stories/story-brainbase-decision-events-kpi-v1.md), [docs/architecture/decision-events-kpi-architecture.md](docs/architecture/decision-events-kpi-architecture.md)
- 実装: scripts/send-decision-kpi-to-slack.js, server/controllers/companion-controller.js, server/services/companion/decision-event-service.js
- テスト: [tests/e2e/story-brainbase-decision-events-kpi-v1-decision-events-api-contract.spec.ts](tests/e2e/story-brainbase-decision-events-kpi-v1-decision-events-api-contract.spec.ts), [tests/server/routes/companion-decision-events.test.js](tests/server/routes/companion-decision-events.test.js), [tests/server/scripts/send-decision-kpi-to-slack.test.js](tests/server/scripts/send-decision-kpi-to-slack.test.js), ...and 1 more

## 経緯
- 要求: 判断委任KPIフェーズ1 サーバー側イベント受信・週次集計
- 発生経緯: mac-companionがGmail/Slackの判断イベント（AI下書きの採用・修正・自力対応・エスカレーション・ルール作成など）をBrainbaseへPOSTし、Brainbaseが冪等に永続化する。週次でKPI（委任率・差戻し率・エスカレーション件数・境界拡張数）を集計してSlackへ投稿し、判断委任の進捗を定量的に追えるようにする。 これは `.vibepro/spec/story-brainbase-human-decision-queue-attention-edge-v0/` の未実装スタブ（参照ドキュメント不在）を置き換えるフェーズ1実装である。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-brainbase-decision-events-kpi-v1.md](docs/stories/story-brainbase-decision-events-kpi-v1.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/stories/story-brainbase-decision-events-kpi-v1.md](docs/stories/story-brainbase-decision-events-kpi-v1.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 9 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/send-decision-kpi-to-slack.js, server/controllers/companion-controller.js, server/services/companion/decision-event-service.js
- テスト差分: [tests/e2e/story-brainbase-decision-events-kpi-v1-decision-events-api-contract.spec.ts](tests/e2e/story-brainbase-decision-events-kpi-v1-decision-events-api-contract.spec.ts), [tests/server/routes/companion-decision-events.test.js](tests/server/routes/companion-decision-events.test.js), [tests/server/scripts/send-decision-kpi-to-slack.test.js](tests/server/scripts/send-decision-kpi-to-slack.test.js), [tests/server/services/companion/decision-event-service.test.js](tests/server/services/companion/decision-event-service.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json)
- [x] Unit Gate - Current-head ledger authority and global deduplication suite passed 42/42; evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json) / gate: passed / evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json)
- [x] Integration Gate - Current-head auth boundary, permission denial, boundary-condition, and negative-path regression suite passed 17/17; evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json) / gate: passed / evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json)
- [x] E2E Gate - Post-freeze exact current HEAD Playwright API suite passed 9/9; evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json) / gate: passed / evidence: [.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json)
- 最終E2E: pass: Post-freeze exact current HEAD Playwright API suite passed 9/9（[.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json](.vibepro/qa/decision-events-current-head-verification-20260724T073257Z.json)）

## 詳細
- 証跡: [.vibepro/pr/story-brainbase-decision-events-kpi-v1/](.vibepro/pr/story-brainbase-decision-events-kpi-v1/)
- PR準備: [.vibepro/pr/story-brainbase-decision-events-kpi-v1/pr-prepare.json](.vibepro/pr/story-brainbase-decision-events-kpi-v1/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-brainbase-decision-events-kpi-v1/decision-index.json](.vibepro/pr/story-brainbase-decision-events-kpi-v1/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 6b5af2c67a33 main dirty (story=story-brainbase-decision-events-kpi-v1)
