## 判断
- このPRで判断すること: Meeting Source MCP Sync Worker を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-meeting-source-mcp-sync-worker - Meeting Source MCP Sync Worker
- 正本: [docs/stories/story-meeting-source-mcp-sync-worker.md](docs/stories/story-meeting-source-mcp-sync-worker.md)
- 変更範囲: 15 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-meeting-source-mcp-sync-worker.md](docs/stories/story-meeting-source-mcp-sync-worker.md), [docs/architecture/meeting-source-mcp-sync-worker-architecture.md](docs/architecture/meeting-source-mcp-sync-worker-architecture.md), [docs/specs/story-meeting-source-mcp-sync-worker-spec.md](docs/specs/story-meeting-source-mcp-sync-worker-spec.md)
- 実装: public/modules/settings/settings-core.js, server/bootstrap/core-services.js, server/bootstrap/graceful-shutdown.js, ...and 4 more
- テスト: [tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts](tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts), [tests/server/meeting-source-mcp-adapters.test.js](tests/server/meeting-source-mcp-adapters.test.js), [tests/server/meeting-source-mcp-sync-worker.test.js](tests/server/meeting-source-mcp-sync-worker.test.js), ...and 1 more

## 経緯
- 要求: Meeting Source MCP Sync Worker
- 発生経緯: Meeting Packの一次入力はSlack投稿ではなく、TactiqまたはPlaudに蓄積された会議・電話・雑談のTranscript/Noteである。同期workerはcronで定期実行し、Calendarに予定が存在しない会話も漏らさないため、Calendar起点ではなくTactiq MCPとPlaud MCPを直接pollする。 オンライン会議はTactiqを優先し、オフライン会話、電話、Tactiqを使えないオンライン会議はPlaudを優先する。両方に同じ内容が存在する場合は、二重にMeeting Packを作らず、片方をprimary source、もう片方をsupporting sourceとして同一source c


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-meeting-source-mcp-sync-worker.md](docs/stories/story-meeting-source-mcp-sync-worker.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 8 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: public/modules/settings/settings-core.js, server/bootstrap/core-services.js, server/bootstrap/graceful-shutdown.js, server/bootstrap/register-api-routes.js, ...
- テスト差分: [tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts](tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts), [tests/server/meeting-source-mcp-adapters.test.js](tests/server/meeting-source-mcp-adapters.test.js), [tests/server/meeting-source-mcp-sync-worker.test.js](tests/server/meeting-source-mcp-sync-worker.test.js), [tests/server/routes/meeting-source-settings.test.js](tests/server/routes/meeting-source-settings.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/typecheck-after-review-fix.log
- [x] Unit Gate - Failure mode evidence: provider timeout/parse/schema-style failures stay isolated per provider, cursor advancement is guarded, settings validation rejects unsafe MCP configuration, and provider secret values are redacted.; evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/unit-after-review-fix.log / gate: passed / evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/unit-after-review-fix.log
- [x] Integration Gate - People SSOT owner resolution boundary evidence: Meeting Source MCP sync passes provider-derived project/person hints and source_event evidence only; canonical task-owner resolution remains downstream in Meeting Pack/Brainbase People SSOT and no provider-local people master is created.; evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/unit-after-review-fix.log / gate: passed / evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/unit-after-review-fix.log
- [x] E2E Gate - Current-head replay evidence: the same verified Playwright artifact covers flow_replay and artifact_replay for settings UI, manual resync, provider preview, source_event evidence, sync_policy, review surface preview, and shutdown cleanup.; evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/playwright-e2e-after-review-fix.clean.json / gate: passed / evidence: ../../../../../tmp/meeting-source-mcp-sync-vibepro/playwright-e2e-after-review-fix.clean.json
- 最終E2E: pass: Current-head replay evidence: the same verified Playwright artifact covers flow_replay and artifact_replay for settings UI, manual resync, provider preview, source_event evidence, sync_policy, review surface preview, and shutdown cleanup.（../../../../../tmp/meeting-source-mcp-sync-vibepro/playwright-e2e-after-review-fix.clean.json）

## 詳細
- 証跡: [.vibepro/pr/story-meeting-source-mcp-sync-worker/](.vibepro/pr/story-meeting-source-mcp-sync-worker/)
- PR準備: [.vibepro/pr/story-meeting-source-mcp-sync-worker/pr-prepare.json](.vibepro/pr/story-meeting-source-mcp-sync-worker/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-meeting-source-mcp-sync-worker/decision-index.json](.vibepro/pr/story-meeting-source-mcp-sync-worker/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 202599f7082d main dirty (story=story-meeting-source-mcp-sync-worker)
