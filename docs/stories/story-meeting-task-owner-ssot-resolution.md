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
Meeting Review Package ingest時にBrainbase Graph SSOTのpersonを検索し、候補は `owner_candidates[]` に保持する。そのうえで、一意完全一致またはproject context付き高信頼候補として解決できた場合だけ `selected_owner_id` と `selected_owner` を付与する。

これにより、Mac CompanionのTaskレビューでは最初からSSOT由来の担当者候補を見られる一方で、未登録者・曖昧な名前・`Speaker 1` のような話者ラベルは担当者未設定のまま人間が確認できる。

## Invariants

- INV-owner-ssot-1: `owner_hint` はAI抽出文字列として保存し、正本担当者として上書きしない。
- INV-owner-ssot-2: `selected_owner_id` はGraph SSOTのpersonエンティティから一意完全一致、またはproject context付き高信頼候補として解決できた場合だけ付与する。
- INV-owner-ssot-3: `Speaker 1` などの話者ラベルは担当者personとして扱わない。
- INV-owner-ssot-4: SSOT候補がない、または複数候補で第一候補を決めきれない場合は `selected_owner_id` を付与しない。
- INV-owner-ssot-5: Review Package ingestはTask作成の外部副作用を実行せず、承認待ちoutput payloadだけを更新する。
- INV-owner-ssot-6: people SSOTが利用できない場合でもReview Package ingestは失敗させず、担当者は未解決として扱う。
- INV-owner-ssot-7: `担当者` / `担当` / `未定` などの汎用語は候補検索にも正本担当者設定にも使わない。
- INV-owner-ssot-8: people SSOTに同一人物の重複行がある場合、`display_name` / `name` / `aliases[]` の正規化キーで畳んでから一意性を判定する。
- INV-owner-ssot-9: project codeの表記ゆれはPeople SSOT検索条件だけでなく、Graph access scopeにも反映してから候補検索する。

## Scenarios

- S-001: `owner_hint=@矢島様` がSSOT aliasに一意一致し、`selected_owner_id=person_yajima_tsuyoshi` がTask候補payloadに入る。
- S-002: `owner_hint=@未登録さん` がSSOTに存在しない場合、`owner_resolution.status=unresolved` となり正本担当者は空のまま残る。
- S-003: `owner_hint=@Speaker 1` は `ignored` として扱い、担当者候補検索にも正本担当者設定にも使わない。
- S-004: `owner_hint=@佐藤さん` が複数personに当たり得る場合でも、Brainbase/SalesTailor文脈ではproject SSOTに紐づく `佐藤 圭吾` を第一候補として `owner_candidates[]` に残し、高信頼なら `selected_owner_id` を付与する。
- S-005: `owner_hint=@汐里さん` がalias完全一致しない場合でも、姓名の部分一致で `堀 汐里` を `owner_candidates[]` に残す。
- S-005b: `owner_hint=@汐里さん` がpeople SSOTの重複した `堀 汐里` 行へ当たっても、同一人物として畳んだ結果が一意なら `selected_owner_id` を付与する。
- S-005c: `owner_hint=@King氏` は `tech-knight` / `techknight` のproject code表記ゆれを検索条件とGraph access scopeの両方で越えて `佐藤 圭吾 aliases=["King","キング"]` に一意完全一致する。
- S-005d: `owner_hint=@担当者` は汎用語として扱い、people SSOT検索も `selected_owner_id` 付与も行わない。
- S-006: 同一Review Packageの再取り込みは既存run/outputを返し、重複解決や重複書き込みを行わない。
- S-007: people SSOT取得が失敗してもReview Package ingestは承認待ちrun/outputを作成し、担当者だけを未解決として人間レビューに渡す。
- S-008: Task候補に `selected_owner_id` が既にある場合、people SSOTに存在するIDだけ `already_selected` として維持し、存在しないIDは未解決として人間レビューに戻す。
- S-009: 議事録レビューのhuman gateは維持され、担当者が解決済みでもTask Store作成は承認後にだけ進む。
- S-010: `HintCaptured` / `AlreadySelected` / `Ignored` / `LookupSSOT` / `Resolved` / `Unresolved` / `Ambiguous` / `HumanGatePending` / `Persisted` の状態遷移を通り、保存前に担当者解決結果がpayloadへ入る。
- S-011: `people_ssot_unavailable` / `no_people_ssot_candidate` / `ambiguous_people_ssot_candidate` / `speaker_label_is_not_people_ssot` のfailure modeはingest失敗ではなく `owner_resolution` へ保存される。

## Acceptance Criteria

- AC-001: `owner_hint` はAI抽出文字列として保存し、検索用正規化で書き換えない。
- AC-002: people SSOTのpersonへ一意完全一致、またはproject context付き高信頼候補として解決できた場合だけ `selected_owner_id` を付与する。
- AC-003: `Speaker 1` / `話者1` 形式は担当者personとして扱わない。
- AC-004: 複数person候補へ一致して第一候補を決めきれない場合は `ambiguous` とし、`selected_owner_id` を付与しない。
- AC-005: Review Package ingestは承認待ちoutput payloadだけを更新し、Task Store作成を自動実行しない。
- AC-006: people SSOTが利用できない場合でもReview Package ingest全体を失敗させない。
- AC-007: `@矢島様` のような敬称付きヒントはpeople SSOT alias完全一致で `矢島剛` に解決できる。
- AC-008: people SSOTに存在しないヒントは `owner_resolution.status=unresolved` として保存する。
- AC-009: Speaker表記は `speaker_label_is_not_people_ssot` として保存し、正本担当者設定に使わない。
- AC-010: 同一Review Packageの再取り込みは既存run/outputを返し、担当者解決を重複実行しない。
- AC-011: people SSOT取得失敗時は担当者だけを未解決として人間レビューに渡す。
- AC-012: 既存の `selected_owner_id` がpeople SSOTに存在する場合だけ上書きせず `already_selected` として可視化する。
- AC-013: 担当者が解決済みでも `required_before_task_create` のhuman gateを維持する。
- AC-014: Resolved状態はoutput保存前に `selected_owner_id` とともにpayloadへ永続化する。
- AC-015: AlreadySelected状態はpeople SSOT検証済みの既存担当者と `owner_resolution` の両方で再現できる。
- AC-016: Release noteは `graph_ssot` を担当者正本として明示する。
- AC-017: Operator actionは通常デプロイまたは再起動だけで完了し、migrationを要求しない。
- AC-018: Rollback instructionはPR revertでpeople SSOT参照を外せること、追加payloadが後方互換であることを明示する。
- AC-019: Observability evidenceは `workflow_outputs.payload.task_candidates[].owner_resolution` を正とする。
- AC-020: 未解決担当者はMac Companionでpeople SSOT検索・手動選択できる状態として残る。
- AC-021: `@佐藤さん` はproject contextに一致する `佐藤 圭吾` を第一候補として返し、他の佐藤候補も `owner_candidates[]` に残す。
- AC-022: `@汐里さん` はalias完全一致がなくても `堀 汐里` を部分一致候補として返す。
- AC-023: `@汐里さん` がpeople SSOTの重複した同一人物行へ当たる場合、正規化キーで畳んだうえで一意なら `selected_owner_id` を付与する。
- AC-024: `@King氏` / `@キング` は `佐藤 圭吾` のaliasとして解決し、`tech-knight` と `techknight` のproject code表記ゆれを検索projectCodeとGraph access scopeの両方で越えて候補検索できる。
- AC-025: `@担当者` のような汎用語は `generic_owner_hint_requires_human_selection` として未解決にし、正本担当者を初期設定しない。

## Release / Rollback / Observability

- Release note: Meeting Review Package ingestでTask候補の担当者ヒントをBrainbase Graph people SSOTに照合し、候補一覧と解決理由をpayloadへ追加する。一意完全一致またはproject context付き高信頼候補だけ `selected_owner_id` / `selected_owner` を付与する。
- Operator action: DB migrationや手動データ修正は不要。サーバー再起動または通常デプロイで `WorkflowService` への `InfoSSOTService` 注入が有効になる。
- Rollback instruction: このPRをrevertすると、Task候補は従来の `owner_hint` のみの状態に戻る。追加済みの `selected_owner_id` はpayload上の付加情報なので、Mac Companion側は未対応でも無視できる。
- Observability evidence: `workflow_outputs.type=task_candidates` のpayloadで `owner_hint` / `selected_owner_id` / `selected_owner` / `owner_candidates` / `owner_resolution.status` / `owner_resolution.reason` を確認する。
- Support path: `owner_resolution.status=unresolved|ambiguous|ignored` の場合はMac Companionでpeople SSOT候補を検索し、必要に応じてpeople SSOTを更新してから手動選択する。ingestは未登録者を自動作成しない。

## Clause Evidence

- AC-016 evidence: Release note explicitly states that `graph_ssot` / Brainbase Graph people SSOT is the authoritative owner SSOT for meeting Task owner resolution.
- AC-017 evidence: Operator action is normal deploy or server restart only; no DB migration, workflow_output rewrite, or people SSOT bulk correction is required.

## Verification

- Unit: `npm run test:run -- tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js`
- Lint: `npx eslint public/workflows.html server/services/workflow/workflow-service.js server/services/info-ssot-service.js server/bootstrap/core-services.js tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- Doc trace: `npm run vibepro:doc-trace -- --base origin/develop`
- Story E2E: `BRAINBASE_E2E_PORT=31015 npm run test:e2e -- tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- E2E: `BRAINBASE_E2E_REUSE_SERVER=true npm run test:e2e -- tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
