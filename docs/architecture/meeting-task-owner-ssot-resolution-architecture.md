# Meeting Task Owner SSOT Resolution Architecture

## Flow

```mermaid
flowchart TB
  pkg["Review Package task_candidates[]"] --> hint["owner_hint / assignee hint"]
  hint --> normalize["検索用に @ と空白を正規化"]
  normalize --> speaker{"Speaker label?"}
  speaker -->|yes| ignored["owner_resolution.status=ignored"]
  speaker -->|no| ssot["InfoSSOTService.listGraphEntities(entityType=person)"]
  ssot --> match{"single SSOT result and exact name/alias?"}
  match -->|yes| resolved["selected_owner_id + selected_owner"]
  match -->|no candidates| unresolved["owner_resolution.status=unresolved"]
  match -->|multiple/ambiguous| ambiguous["owner_resolution.status=ambiguous"]
  resolved --> output["workflow_outputs.type=task_candidates payload"]
  unresolved --> output
  ambiguous --> output
  ignored --> output
```

## State

```mermaid
stateDiagram-v2
  [*] --> HintCaptured: task candidate has owner_hint
  HintCaptured --> AlreadySelected: selected_owner_id exists
  AlreadySelected --> Persisted: preserve existing owner
  HintCaptured --> Ignored: Speaker label
  HintCaptured --> LookupSSOT: normalized hint is searchable
  LookupSSOT --> Resolved: the only SSOT result is an exact person match
  LookupSSOT --> Unresolved: no match or SSOT unavailable
  LookupSSOT --> Ambiguous: multiple SSOT candidates, even if one is exact
  Resolved --> HumanGatePending: payload has selected_owner_id
  Unresolved --> HumanGatePending: payload has no selected_owner_id
  Ambiguous --> HumanGatePending: payload has candidates only
  Ignored --> HumanGatePending: payload has no selected_owner_id
  HumanGatePending --> Persisted: workflow output stored
  Persisted --> [*]
```

## Boundaries

- 正本: Brainbase Graph SSOTの `person` エンティティ。
- 入力ヒント: Review Package内の `owner_hint`。これは正本ではなく検索語としてだけ使う。
- 書き込み先: `workflow_outputs.type=task_candidates` のpayload。Task Store作成は承認後の別境界。
- 利用者画面: Mac Companionはpayloadの `selected_owner_id` を初期選択として扱い、変更時は既存のpeople SSOT APIで候補を取得する。

## Threat Model

```mermaid
flowchart LR
  ai["AI extracted owner_hint<br/>untrusted hint"] --> resolver["WorkflowService owner resolver<br/>normalizes and exact-matches only"]
  resolver --> ssot["Brainbase Graph people SSOT<br/>canonical person master"]
  resolver --> output["workflow_outputs payload<br/>additive review metadata"]
  output --> gate["Human review gate<br/>required_before_task_create"]
  gate --> task["Task Store creation<br/>post-approval boundary"]
  resolver -. "no automatic person creation" .-> blocked["Unknown or ambiguous person<br/>unresolved for human review"]
  resolver -. "does not mutate" .-> ssot
```

- Threat: AIが `@矢島様` や `Speaker 1` を担当者らしく出しても、それ自体は正本ではない。
- Control: Graph people検索結果の総数が1件で、かつその1件が `person.name` / `display_name` / `aliases[]` に完全一致するときだけ `selected_owner_id` を付与する。完全一致が1件あっても、同じ検索で部分一致候補が他に返る場合はambiguousとして人間確認に残す。
- Control: unknown、ambiguous、speaker label、SSOT unavailableは `owner_resolution` に理由を残し、Task Store作成やpeople SSOT登録を自動実行しない。
- Residual risk: people SSOT側のaliasが不足している場合は未解決になる。これはMac Companionの担当者選択・SSOT登録導線で人間が補正する。

## Responsibility Authority

| Responsibility | Authority | Implementation |
| --- | --- | --- |
| Canonical person identity | Brainbase Graph SSOT people | `InfoSSOTService.listGraphEntities` |
| AI extracted hint | Meeting Review Package payload | `owner_hint` remains unchanged |
| Task candidate storage | Workflow output payload | `WorkflowService.ingestMeetingReviewPackage` |
| Human approval | Existing Review Package human gate | `required_before_task_create` remains pending |
| Task Store creation | Existing post-approval workflow | Not changed by this story |

## Failure Behavior

- SSOTが利用できない場合、Review Package ingest自体は継続し、該当Task候補に `owner_resolution.status=unresolved` を付ける。
- 未登録者はローカルに仮作成しない。Mac Companion側の登録UIでGraph SSOTへ登録してから再選択する。
- 話者ラベルは担当者候補に昇格しない。

## Release Operations

- Release path: 通常のBrainbase server deployまたは再起動で有効化する。`core-services` が `WorkflowService` へ `InfoSSOTService` を注入するため、追加のoperator設定は不要。
- Rollback path: PR revertで `resolveMeetingReviewTaskOwnersFromSSOT` の呼び出しとservice injectionを外す。payloadの追加フィールドは後方互換の付加情報であり、既存Review Packageの承認状態を変更しない。
- Observability path: operatorは `workflow_outputs` の `task_candidates` payloadで `owner_resolution.status`、`reason`、`selected_owner_id`、`owner_candidates` を確認する。人間承認が必要な状態は既存のhuman gateに残る。
- Support path: `unresolved` / `ambiguous` / `ignored` はMac Companionの担当者選択UIで人間が補正する。Graph SSOT登録が必要な人物はpeople SSOTの登録導線で作成し、ingestは自動登録しない。

## Replay Evidence

- `tests/server/services/workflow-org-agent-control.test.js` replays resolved, unresolved, and speaker-label candidates through `ingestMeetingReviewPackage` and asserts the stored `workflow_outputs.payload`.
- `tests/e2e/story-meeting-review-package-ingest-v1-contract.spec.ts` replays the broader Meeting Review Package ingest contract, including output creation, human steps, idempotency, reject behavior, and Mission Control review visibility.
