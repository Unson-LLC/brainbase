## 判断
- このPRで判断すること: Eve dispatch handoffにtranscript本文と書き戻し契約を含める を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-eve-dispatch-handoff-transcript-context - Eve dispatch handoffにtranscript本文と書き戻し契約を含める
- 正本: [docs/stories/story-eve-dispatch-handoff-transcript-context.md](docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- 変更範囲: 10 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/stories/story-eve-dispatch-handoff-transcript-context.md](docs/stories/story-eve-dispatch-handoff-transcript-context.md)
- 実装: server/services/workflow/workflow-service.js
- テスト: [tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts](tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts), [tests/server/routes/workflows.test.js](tests/server/routes/workflows.test.js), [tests/server/services/workflow-org-agent-control.test.js](tests/server/services/workflow-org-agent-control.test.js)

## 経緯
- 要求: Eve dispatch handoffにtranscript本文と書き戻し契約を含める
- 発生経緯: story-meeting-note-generation-dag-wiring（PR #1018/#1019）でReview Package ingest後に `transcript_to_meeting_note` loop intentをEve sessionへ自動dispatchする配線ができ、PR #1020で認証経路（Basic認証 + Vercel protection bypass）が開通した。しかし実dispatch検証（Eveセッション `wrun_01KX79SVFECJ1CN0VTP1TSTKRY`）で、Eve agentは「transcript・run識別子・書き戻し設定が欠落している」としてfailedエンベロープを返した。 原因は handoff.context の構成にある。`buildEveSessionContext` はloop intent / role agent / template / binding / triggerの制御メタデータのみを渡しており、生成対象の一次資料（正規化transcript）と、生成結果をどこへどう書き戻すかの契約（`POST /api/workflows/control/meeting-pack/note-generation`、`source_text_hash` 一致必須）が含まれていない。loop intentはorg/project/定義ごとの固定ID（複数のmeeting...


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/stories/story-eve-dispatch-handoff-transcript-context.md](docs/stories/story-eve-dispatch-handoff-transcript-context.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 17 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: server/services/workflow/workflow-service.js
- ...and 1 more
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - pass; evidence: var/story-evidence/vitest-eve-handoff.json / gate: passed / evidence: var/story-evidence/vitest-eve-handoff.json
- [x] Integration Gate - pass; evidence: var/story-evidence/vitest-eve-handoff.json / gate: passed / evidence: var/story-evidence/vitest-eve-handoff.json
- [x] E2E Gate - pass; evidence: var/story-evidence/playwright-eve-handoff.json / gate: passed / evidence: var/story-evidence/playwright-eve-handoff.json
- 最終E2E: pass: pass（var/story-evidence/playwright-eve-handoff.json）

## 詳細
- 証跡: [.vibepro/pr/story-eve-dispatch-handoff-transcript-context/](.vibepro/pr/story-eve-dispatch-handoff-transcript-context/)
- PR準備: [.vibepro/pr/story-eve-dispatch-handoff-transcript-context/pr-prepare.json](.vibepro/pr/story-eve-dispatch-handoff-transcript-context/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-eve-dispatch-handoff-transcript-context/decision-index.json](.vibepro/pr/story-eve-dispatch-handoff-transcript-context/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 670f7b40a64a detached/package dirty (story=story-eve-dispatch-handoff-transcript-context)
