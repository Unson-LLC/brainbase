---
story_id: story-meeting-task-owner-ssot-resolution
title: Meeting Task Owner SSOT Resolution Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
diagrams:
  - kind: flow
    path: docs/architecture/meeting-task-owner-ssot-resolution-architecture.md
    purpose: Review Package ingest時にTask候補のowner_hintをpeople SSOTへ照合するflowを示す。
  - kind: state
    path: docs/architecture/meeting-task-owner-ssot-resolution-architecture.md
    purpose: Task候補の担当者解決状態がunresolved/resolved/ambiguous/ignoredに遷移するstateを示す。
  - kind: threat_model
    path: docs/architecture/meeting-task-owner-ssot-resolution-architecture.md
    purpose: AI抽出ヒント、Graph people SSOT、workflow output、人間承認のtrust boundaryを示す。
    mermaid: |
      flowchart LR
        AI["AI owner_hint"] --> Resolver["WorkflowService owner resolver"]
        Resolver --> SSOT["Brainbase Graph people SSOT"]
        Resolver --> Output["workflow_outputs payload"]
        Output --> Gate["Human review gate"]
        Gate --> Task["Task Store"]
        Resolver -. "no automatic person creation" .-> Unknown["unresolved/ambiguous/ignored"]
---

# Meeting Task Owner SSOT Resolution Spec

## Contract

`POST /api/workflows/control/meeting-pack/review-ingest` は、`review_package.task_candidates[]` がobjectで `owner_hint` / `ownerHint` / `assignee_hint` / `assigneeHint` / `owner` / `assignee` を持つ場合、Graph SSOT personを検索してoutput payloadへ解決結果を付与する。

解決成功時のTask候補payload:

```json
{
  "title": "Googleビジネスプロフィールの管理権限をジョーさんに付与する。",
  "owner_hint": "@矢島様",
  "selected_owner_id": "person_yajima_tsuyoshi",
  "selected_owner": "矢島剛",
  "owner_candidates": [
    {
      "person_id": "person_yajima_tsuyoshi",
      "entity_id": "person_yajima_tsuyoshi",
      "display_name": "矢島剛",
      "aliases": ["矢島様", "矢島さん"],
      "source": "graph_ssot",
      "match": "exact_name_or_alias",
      "context_match": true,
      "score": 155
    }
  ],
  "owner_resolution": {
    "source": "graph_ssot",
    "status": "resolved",
    "confidence": 1,
    "reason": "unique_exact_name_or_alias"
  }
}
```

未解決時のTask候補payload:

```json
{
  "title": "口コミ投稿QRと質問項目を確定する。",
  "owner_hint": "@未登録さん",
  "owner_candidates": [],
  "owner_resolution": {
    "source": "graph_ssot",
    "status": "unresolved",
    "reason": "no_people_ssot_candidate"
  }
}
```

## Rules

- `owner_hint` の先頭 `@` と余分な空白は検索用にだけ正規化する。保存する `owner_hint` は入力値を維持する。
- 検索時は `@`、敬称、空白を外したqueryも投げ、alias完全一致だけでなく姓名の部分一致候補も `owner_candidates[]` に残す。
- personの `name` / `display_name` / `aliases[]` のいずれかに完全一致する候補が1件だけなら `selected_owner_id` を付与する。部分一致でも、重複行を畳んだ後の候補が1件だけなら `selected_owner_id` を付与する。
- person候補は `person_id` だけでなく、`display_name` / `name` / `aliases[]` の正規化キーでも重複排除する。
- project scoped lookupでは `tech-knight` / `techknight` / `tech_knight` のようなproject code variantを試し、さらにglobal People SSOT検索結果を常にmergeする。
- 複数候補がある場合でも、project contextに一致する候補がscore差を持って第一候補になる場合は `selected_owner_id` を付与し、`owner_resolution.reason=context_ranked_owner_hint` とする。
- 候補が0件なら `unresolved`、複数候補で第一候補を決めきれない場合は `ambiguous` として扱う。
- 既に `selected_owner_id` があるTask候補は、同じperson idがpeople SSOTに存在する場合だけ `already_selected` として維持する。people SSOTで検証できないIDは未解決として人間レビューに戻す。
- `Speaker 1` / `話者1` 形式はSSOT検索対象にせず `ignored` とする。
- `担当者` / `担当` / `未定` / `TBD` などの汎用語はSSOT検索対象にせず、`generic_owner_hint_requires_human_selection` として未解決にする。
- `infoSSOTService.listGraphEntities` がない、または失敗した場合はReview Package ingestを止めない。

## Diagrams

- kind: flow
  path: `docs/architecture/meeting-task-owner-ssot-resolution-architecture.md`
  purpose: Review Package ingest時にTask候補の `owner_hint` をpeople SSOTへ照合し、Task candidate outputへ保存するflowを示す。
- kind: state
  path: `docs/architecture/meeting-task-owner-ssot-resolution-architecture.md`
  purpose: `HintCaptured` / `LookupSSOT` / `Resolved` / `Ambiguous` / `Unresolved` / `Ignored` / `HumanGatePending` / `Persisted` の状態遷移を示す。
- kind: threat_model
  path: `docs/architecture/meeting-task-owner-ssot-resolution-architecture.md`
  purpose: AI抽出ヒント、Graph people SSOT、workflow output、人間承認、Task Storeのtrust boundaryを示す。

## Workflow State Clauses

- WSC-001: Review Package ingestは、Task候補を保存する前に担当者解決を行い、`workflow_outputs.type=task_candidates` のpayloadへ解決結果を永続化する。
- WSC-002: `unresolved` / `ambiguous` / `ignored` のTask候補は承認待ち状態のまま残し、Task Storeへの作成やpeople SSOTへの自動登録を実行しない。
- WSC-003: `selected_owner_id` が付与されたTask候補も、Meeting Review Packageのhuman gateを bypass せず、既存の `required_before_task_create` 承認ステップに従う。
- WSC-004: 同一 `package_id + org_id + project_id` の再取り込みは既存run/outputを返すため、担当者解決を重複実行して既存payloadを書き換えない。
- WSC-005: `HintCaptured` / `AlreadySelected` / `Ignored` / `LookupSSOT` / `Resolved` / `Unresolved` / `Ambiguous` / `HumanGatePending` / `Persisted` の各状態は、保存済みTask候補payloadの `owner_resolution` とpeople SSOT検証済み `selected_owner_id` の有無で再現できる。
- WSC-006: `people_ssot_unavailable` / `no_people_ssot_candidate` / `ambiguous_people_ssot_candidate` / `speaker_label_is_not_people_ssot` はingest失敗ではなく `owner_resolution.reason` として保存する。
- WSC-007: `unique_partial_name_or_alias` / `generic_owner_hint_requires_human_selection` は保存済みTask候補payloadの `owner_resolution.reason` として再現できる。

## Failure Modes

- FM-001: people SSOTが一時的に利用できない場合は `owner_resolution.reason=people_ssot_unavailable` として保存し、ingest全体は失敗させない。
- FM-002: AIが `Speaker 1` などの話者ラベルを担当者として出しても、Graph personへ昇格せず `ignored` として保存する。
- FM-003: `矢島様` のような敬称付きヒントは敬称なしqueryでも検索し、alias完全一致またはproject context付き高信頼候補でのみ `selected_owner_id` を付与する。
- FM-004: 複数personが同じヒントへ一致し、project contextでも第一候補を決めきれない場合は `ambiguous` とし、人間がMac Companion上で正本担当者を選ぶ。
- FM-005: `佐藤さん` のような姓のみのヒントは複数person候補を返し得るため、project contextで第一候補を選べる場合を除いて `selected_owner_id` を付与しない。
- FM-006: `汐里さん` のようにSSOT aliasが不足している名のヒントでも、名の部分一致候補は `owner_candidates[]` に残す。
- FM-007: people SSOTに同一人物の重複行がある場合は、正規化キーで重複排除してから一意性を判定する。
- FM-008: project codeが `tech-knight` と `techknight` で揺れる場合はvariant lookupとglobal mergeによりalias候補を失わない。
- FM-009: `担当者` のような汎用語は人名として扱わず、候補検索・自動選択を行わない。

## Production Path Matrix

| Surface | Path | Evidence |
| --- | --- | --- |
| API ingress | `POST /api/workflows/control/meeting-pack/review-ingest` | `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts` |
| Service resolution | `WorkflowService.ingestMeetingReviewPackage` -> `resolveMeetingReviewTaskOwnersFromSSOT` | `tests/server/services/workflow-org-agent-control.test.js` |
| SSOT authority | `InfoSSOTService.listGraphEntities(entityType=person)` | `server/bootstrap/core-services.js` injection plus unit fake |
| Persistence | `workflow_outputs.payload.task_candidates[]` | unit assertion on stored task candidate payload |
| Review surface | Workflow Mission Control renders owner resolution before human approval | `tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts` UI replay |

## Release Operations

- Release note: Meeting Review Package ingestがGraph people SSOTを読み、Task候補payloadへ担当者解決結果を付加する。APIの入力契約とDB schemaは変更しない。
- Operator action: 通常デプロイまたはサーバー再起動のみ。手動migration、既存workflow_outputの書き換え、people SSOTの一括補正は不要。
- Rollback instruction: PR revertで `WorkflowService` のpeople SSOT参照とpayload付加を外せる。既存payload上の追加フィールドは後方互換の付加情報として残ってもReview Package承認フローを壊さない。
- Observability evidence: `workflow_outputs.type=task_candidates` のpayloadに `owner_resolution.source=graph_ssot`、`status=resolved|unresolved|ambiguous|ignored`、`reason`、`selected_owner_id` の有無が残る。
- Support path: 未解決候補はMac Companionでpeople SSOT検索・登録・手動選択する。ingest時点では未登録者をGraphへ自動追加しない。

## Clause Evidence

- AC-016 evidence: `graph_ssot` is the authoritative owner SSOT; Meeting Review Package ingest reads Brainbase Graph people records and writes only candidate resolution metadata.
- AC-017 evidence: Release requires only normal deploy or server restart; there is no migration, no manual rewrite of existing workflow outputs, and no bulk correction of people SSOT records.

## Acceptance Criteria

- AC-001 `owner_hint` はAI抽出文字列として保存し、検索用正規化で書き換えない。
- AC-002 people SSOTのpersonへ一意完全一致、またはproject context付き高信頼候補として解決できた場合だけ `selected_owner_id` を付与する。
- AC-003 `Speaker 1` / `話者1` 形式は担当者personとして扱わない。
- AC-004 複数person候補へ一致して第一候補を決めきれない場合は `ambiguous` とし、`selected_owner_id` を付与しない。
- AC-005 Review Package ingestは承認待ちoutput payloadだけを更新し、Task Store作成を自動実行しない。
- AC-006 people SSOTが利用できない場合でもReview Package ingest全体を失敗させない。
- AC-007 `@矢島様` のような敬称付きヒントはpeople SSOT alias完全一致で `矢島剛` に解決できる。
- AC-008 people SSOTに存在しないヒントは `owner_resolution.status=unresolved` として保存する。
- AC-009 Speaker表記は `speaker_label_is_not_people_ssot` として保存し、正本担当者設定に使わない。
- AC-010 同一Review Packageの再取り込みは既存run/outputを返し、担当者解決を重複実行しない。
- AC-011 people SSOT取得失敗時は担当者だけを未解決として人間レビューに渡す。
- AC-012 既存の `selected_owner_id` はpeople SSOTに存在する場合だけ上書きせず `already_selected` として可視化する。
- AC-013 担当者が解決済みでも `required_before_task_create` のhuman gateを維持する。
- AC-014 Resolved状態はoutput保存前に `selected_owner_id` とともにpayloadへ永続化する。
- AC-015 AlreadySelected状態はpeople SSOT検証済みの既存担当者と `owner_resolution` の両方で再現できる。
- AC-016 Release noteは `graph_ssot` を担当者正本として明示する。
- AC-017 Operator actionは通常デプロイまたは再起動だけで完了し、migrationを要求しない。
- AC-018 Rollback instructionはPR revertでpeople SSOT参照を外せること、追加payloadが後方互換であることを明示する。
- AC-019 Observability signalは `workflow_outputs.payload.task_candidates[].owner_resolution` を正とする。
- AC-020 未解決担当者はMac Companionでpeople SSOT検索・手動選択できる状態として残る。
- AC-021 `@佐藤さん` はproject contextに一致する `佐藤 圭吾` を第一候補として返し、他の佐藤候補も `owner_candidates[]` に残す。
- AC-022 `@汐里さん` はalias完全一致がなくても `堀 汐里` を部分一致候補として返す。
- AC-023 `@汐里さん` がpeople SSOTの重複した同一人物行へ当たる場合、正規化キーで畳んだうえで一意なら `selected_owner_id` を付与する。
- AC-024 `@King氏` / `@キング` は `佐藤 圭吾` のaliasとして解決し、`tech-knight` と `techknight` のproject code表記ゆれを越えて候補検索できる。
- AC-025 `@担当者` のような汎用語は `generic_owner_hint_requires_human_selection` として未解決にし、正本担当者を初期設定しない。

## Acceptance Tests

- `tests/server/services/workflow-org-agent-control.test.js`
  - `story-meeting-task-owner-ssot-resolution resolves task owner hints from people SSOT before output storage`
  - `story-meeting-task-owner-ssot-resolution keeps ambiguous people SSOT reason explicit`
  - `story-meeting-task-owner-ssot-resolution ranks partial owner hints by project context`
- `tests/server/services/info-ssot-service.test.js`
  - `listGraphEntities呼び出し時_queryをGraph検索へ渡す`
- `tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
  - S-001 / S-002 / S-003 / S-004 / S-005 / S-006 / S-007 / S-008 / S-009をflow replayする。
  - `people_ssot_unavailable`、`already_selected`、`ambiguous_people_ssot_candidate`、`speaker_label_is_not_people_ssot` を保存payloadで検証する。
  - Workflow Mission Control上にTask candidate owner summaryが表示され、resolved / unresolved / ignored / ambiguousの状態を承認前に読めることを検証する。
- `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
  - Review Package ingest API, output persistence, human gate state, idempotency, and Mission Control review contract remain green.

## Verification Commands

- `npm run test:run -- tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js`
- `npx eslint public/workflows.html server/services/workflow/workflow-service.js server/services/info-ssot-service.js server/bootstrap/core-services.js tests/server/services/info-ssot-service.test.js tests/server/services/workflow-org-agent-control.test.js tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- `npm run vibepro:doc-trace -- --base origin/develop`
- `BRAINBASE_E2E_PORT=31015 npm run test:e2e -- tests/e2e/story-meeting-task-owner-ssot-resolution-flow.spec.ts`
- `BRAINBASE_E2E_REUSE_SERVER=true npm run test:e2e -- tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts`
