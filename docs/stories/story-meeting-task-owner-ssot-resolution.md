---
story_id: story-meeting-task-owner-ssot-resolution
title: Meeting Task Owners Resolve from people SSOT
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# Meeting Task Owners Resolve from people SSOT

## Story

議事録から作られるTask候補の担当者は、AIが抽出した `owner_hint` をそのまま正本にしない。
Meeting Review Package ingest時にBrainbase Graph SSOTのpersonを検索し、一意に解決できた場合だけ `selected_owner_id` と `selected_owner` を付与する。

これにより、Mac CompanionのTaskレビューでは最初からSSOT由来の担当者候補を見られる一方で、未登録者・曖昧な名前・`Speaker 1` のような話者ラベルは担当者未設定のまま人間が確認できる。

## Invariants

- INV-owner-ssot-1: `owner_hint` はAI抽出文字列として保存し、正本担当者として上書きしない。
- INV-owner-ssot-2: `selected_owner_id` はGraph SSOTのpersonエンティティから一意に解決できた場合だけ付与する。
- INV-owner-ssot-3: `Speaker 1` などの話者ラベルは担当者personとして扱わない。
- INV-owner-ssot-4: SSOT候補がない、または複数候補で曖昧な場合は `selected_owner_id` を付与しない。
- INV-owner-ssot-5: Review Package ingestはTask作成の外部副作用を実行せず、承認待ちoutput payloadだけを更新する。
- INV-owner-ssot-6: people SSOTが利用できない場合でもReview Package ingestは失敗させず、担当者は未解決として扱う。

## Scenarios

- S-001: `owner_hint=@矢島様` がSSOT aliasに一意一致し、`selected_owner_id=person_yajima_tsuyoshi` がTask候補payloadに入る。
- S-002: `owner_hint=@未登録さん` がSSOTに存在しない場合、`owner_resolution.status=unresolved` となり正本担当者は空のまま残る。
- S-003: `owner_hint=@Speaker 1` は `ignored` として扱い、担当者候補検索にも正本担当者設定にも使わない。
- S-004: 同一Review Packageの再取り込みは既存run/outputを返し、重複解決や重複書き込みを行わない。
- S-005: people SSOT取得が失敗してもReview Package ingestは承認待ちrun/outputを作成し、担当者だけを未解決として人間レビューに渡す。
- S-006: Task候補に `selected_owner_id` が既にある場合、AI再解釈やSSOT検索で上書きしない。
- S-007: 議事録レビューのhuman gateは維持され、担当者が解決済みでもTask Store作成は承認後にだけ進む。
- S-008: `HintCaptured` / `AlreadySelected` / `Ignored` / `LookupSSOT` / `Resolved` / `Unresolved` / `Ambiguous` / `HumanGatePending` / `Persisted` の状態遷移を通り、保存前に担当者解決結果がpayloadへ入る。
- S-009: `people_ssot_unavailable` / `no_people_ssot_candidate` / `ambiguous_people_ssot_candidate` / `speaker_label_is_not_people_ssot` のfailure modeはingest失敗ではなく `owner_resolution` へ保存される。

## Release / Rollback / Observability

- Release note: Meeting Review Package ingestでTask候補の担当者ヒントをBrainbase Graph people SSOTに照合し、一意一致時だけ `selected_owner_id` / `selected_owner` / `owner_resolution` をoutput payloadへ追加する。
- Operator action: DB migrationや手動データ修正は不要。サーバー再起動または通常デプロイで `WorkflowService` への `InfoSSOTService` 注入が有効になる。
- Rollback instruction: このPRをrevertすると、Task候補は従来の `owner_hint` のみの状態に戻る。追加済みの `selected_owner_id` はpayload上の付加情報なので、Mac Companion側は未対応でも無視できる。
- Observability evidence: `workflow_outputs.type=task_candidates` のpayloadで `owner_hint` / `selected_owner_id` / `selected_owner` / `owner_candidates` / `owner_resolution.status` / `owner_resolution.reason` を確認する。
- Support path: `owner_resolution.status=unresolved|ambiguous|ignored` の場合はMac Companionでpeople SSOT候補を検索し、必要に応じてpeople SSOTを更新してから手動選択する。ingestは未登録者を自動作成しない。

## Verification

- Unit: `npm run test:run -- tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js`
- Lint: `npx eslint public/workflows.html server/services/workflow/workflow-service.js server/services/info-ssot-service.js server/bootstrap/core-services.js tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- Doc trace: `npm run vibepro:doc-trace -- --base origin/develop`
- Story E2E: `BRAINBASE_E2E_PORT=31015 npm run test:e2e -- tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- E2E: `BRAINBASE_E2E_REUSE_SERVER=true npm run test:e2e -- tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
