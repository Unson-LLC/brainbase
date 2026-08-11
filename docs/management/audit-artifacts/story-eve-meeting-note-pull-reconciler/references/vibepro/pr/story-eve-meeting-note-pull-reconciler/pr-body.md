## 判断
- このPRで判断すること: Eve議事録のpull型reconciler（セッションstream監視→ローカル書き戻し） を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-eve-meeting-note-pull-reconciler - Eve議事録のpull型reconciler（セッションstream監視→ローカル書き戻し）
- 正本: [docs/stories/story-eve-meeting-note-pull-reconciler.md](docs/stories/story-eve-meeting-note-pull-reconciler.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-eve-meeting-note-pull-reconciler.md](docs/stories/story-eve-meeting-note-pull-reconciler.md)
- 実装: server/bootstrap/core-services.js, server/bootstrap/graceful-shutdown.js, server/bootstrap/register-api-routes.js, ...and 2 more
- テスト: [tests/e2e/story-eve-meeting-note-pull-reconciler-contract.spec.ts](tests/e2e/story-eve-meeting-note-pull-reconciler-contract.spec.ts), [tests/server/services/eve-meeting-note-reconciler.test.js](tests/server/services/eve-meeting-note-reconciler.test.js)

## 経緯
- 要求: Eve議事録のpull型reconciler（セッションstream監視→ローカル書き戻し）
- 発生経緯: story-eve-dispatch-handoff-transcript-context（PR #1022/#1023）でtranscript同梱handoffがEve agentへ到達し、議事録生成までは成功するようになった。しかしEve→Brainbaseのpush型書き戻しは構造的に不可能であることがe2e検証で確定した: Eve（Vercel `unson/brainbase-meeting-agent`）の書き戻し先 `https://bb.unson.jp` はLightsail上の別brainbaseインスタンスであり、meeting-packの台帳はMacローカル（`localhost:31013`）にのみ存在してVercelから到達不能。`record_meeting_note_generation` の外部POSTはHTTP 403で失敗する。 一方、実セッション（`wrun_01KX82TDZTW4X1A2RVCA51RCRE`）のstream検証で、`record_meeting_note_generation` tool-callの `actions.requested` イベントには生成済み議事録の全文（`org_id` / `project_id` / `run_id` / `package_id` / `source_text_hash` / `note.title` /...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/stories/story-eve-meeting-note-pull-reconciler.md](docs/stories/story-eve-meeting-note-pull-reconciler.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 9 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: server/bootstrap/core-services.js, server/bootstrap/graceful-shutdown.js, server/bootstrap/register-api-routes.js, server/routes/workflows.js, ...
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - unit 157/157 pass。監視の権威signal sourceはworkflow ledger audit（note_generation.reconciled/recorded/reconcile_blocked）とrunOnce summaryカウンタに一元化されmonitoring assertionで検証済み; evidence: var/story-evidence/vitest-eve-note-reconciler.json / gate: passed / evidence: var/story-evidence/vitest-eve-note-reconciler.json
- [x] Integration Gate - supertest統合157/157 pass。契約文書（story/spec/runbook）とserver実装の一致、migration不要・rollback手順・冪等性・ledger query semanticsを統合証跡として記録; evidence: var/story-evidence/vitest-eve-note-reconciler.json / gate: passed / evidence: var/story-evidence/vitest-eve-note-reconciler.json
- 最終E2E: pass: pass（var/story-evidence/playwright-eve-note-reconciler.json）

## 詳細
- 証跡: [.vibepro/pr/story-eve-meeting-note-pull-reconciler/](.vibepro/pr/story-eve-meeting-note-pull-reconciler/)
- PR準備: [.vibepro/pr/story-eve-meeting-note-pull-reconciler/pr-prepare.json](.vibepro/pr/story-eve-meeting-note-pull-reconciler/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-eve-meeting-note-pull-reconciler/decision-index.json](.vibepro/pr/story-eve-meeting-note-pull-reconciler/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 670f7b40a64a detached/package dirty (story=story-eve-meeting-note-pull-reconciler)
