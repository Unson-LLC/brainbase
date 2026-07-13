## 判断
- このPRで判断すること: meeting packのtask/decision/follow-up候補をEve(LLM)由来にする（pull型reconciler相乗り） を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-eve-meeting-candidates-pull-reconciler - meeting packのtask/decision/follow-up候補をEve(LLM)由来にする（pull型reconciler相乗り）
- 正本: [docs/stories/story-eve-meeting-candidates-pull-reconciler.md](docs/stories/story-eve-meeting-candidates-pull-reconciler.md)
- 変更範囲: 18 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/stories/story-eve-meeting-candidates-pull-reconciler.md](docs/stories/story-eve-meeting-candidates-pull-reconciler.md), [docs/stories/story-eve-meeting-note-pull-reconciler.md](docs/stories/story-eve-meeting-note-pull-reconciler.md), [docs/architecture/story-eve-meeting-candidates-pull-reconciler.md](docs/architecture/story-eve-meeting-candidates-pull-reconciler.md)
- 実装: server/services/external-runner/eve-meeting-note-reconciler.js, server/services/meeting-source/meeting-source-mcp-sync-service.js, server/services/workflow/workflow-service.js
- テスト: [tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts](tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts), [tests/e2e/story-eve-meeting-candidates-pull-reconciler-owner-ssot.spec.ts](tests/e2e/story-eve-meeting-candidates-pull-reconciler-owner-ssot.spec.ts), [tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts](tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts), ...and 5 more

## 経緯
- 要求: meeting packのtask/decision/follow-up候補をEve(LLM)由来にする（pull型reconciler相乗り）
- 発生経緯: meeting pack の task候補・decision候補・follow-up候補は現在、ingest時に決定的関数だけで生成されている（`server/services/meeting-source/meeting-source-mcp-sync-service.js` の `buildTaskCandidatesFromTranscript` / `buildDecisionCandidatesFromTranscript` / `buildFollowUpDraft`）。中身は `sentenceCandidatesFromTranscript` = `。！？`改行で文分割し cue語（対応/確認/決定…）を含む文を最大5個拾う正規表現抽出で、誰が/何を/期限の合成・重複排除・文脈理解ができない。 構造化JSON形式のtranscript会議（`msrc_4f7c995f`「07-11 New PMS/STAYE」）では、決定的splitterがJSONを文分割できず候補titleに生JSONが露出している。平文transcriptの他会議も「キーワードを含む文」を拾っているだけで実タスクとしては低品質。 議事録本文は既に、`story-eve-meeting-note-pull-reconciler` で敷いた...


## 原因
- 最新診断gateが needs_review

## 解決
- - Given: Eve task候補のowner_hintがPeople SSOT上の人物に一意に一致する - When: Brainbaseが候補を正規化する - Then: 一致した人物をselected_ownerとowner_candidatesの第1候補に設定する

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 37 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: server/services/external-runner/eve-meeting-note-reconciler.js, server/services/meeting-source/meeting-source-mcp-sync-service.js, server/services/workflow/workflow-service.js
- テスト差分: [tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts](tests/e2e/story-eve-dispatch-handoff-transcript-context-contract.spec.ts), [tests/e2e/story-eve-meeting-candidates-pull-reconciler-owner-ssot.spec.ts](tests/e2e/story-eve-meeting-candidates-pull-reconciler-owner-ssot.spec.ts), [tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts](tests/e2e/story-meeting-source-mcp-sync-worker-contract.spec.ts), [tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts](tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 62/62 pass on HEAD d647d6666; evidence: [.vibepro/qa/meeting-candidates/vitest-unit-d647d6666.json](.vibepro/qa/meeting-candidates/vitest-unit-d647d6666.json) / gate: passed / evidence: [.vibepro/qa/meeting-candidates/vitest-unit-d647d6666.json](.vibepro/qa/meeting-candidates/vitest-unit-d647d6666.json)
- [x] Integration Gate - Exact-run rollout, rollback, and observability contract pass on HEAD d647d6666; evidence: [.vibepro/qa/meeting-candidates/release-contract-d647d6666.json](.vibepro/qa/meeting-candidates/release-contract-d647d6666.json) / gate: passed / evidence: [.vibepro/qa/meeting-candidates/release-contract-d647d6666.json](.vibepro/qa/meeting-candidates/release-contract-d647d6666.json)
- [x] E2E Gate - 28/28 pass on exact HEAD d647d6666; real HTTP ingest/readback, Eve reconciliation, owner SSOT selection, missing note, invalid payload, and operator labels covered.; evidence: [.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json](.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json) / gate: passed / evidence: [.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json](.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json)
- 最終E2E: pass: 28/28 pass on exact HEAD d647d6666; real HTTP ingest/readback, Eve reconciliation, owner SSOT selection, missing note, invalid payload, and operator labels covered.（[.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json](.vibepro/qa/meeting-candidates/playwright-surface-d647d6666.json)）

## 詳細
- 証跡: [.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/](.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/)
- PR準備: [.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/pr-prepare.json](.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/decision-index.json](.vibepro/pr/story-eve-meeting-candidates-pull-reconciler/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 670f7b40a64a detached/package dirty (story=story-eve-meeting-candidates-pull-reconciler)
