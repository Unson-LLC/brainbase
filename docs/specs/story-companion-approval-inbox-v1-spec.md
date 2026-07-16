---
spec_id: SPEC-companion-approval-inbox-v1
title: Brainbase Companion Approval Inbox API v1 Spec
status: active
date: 2026-06-28
story_id: story-companion-approval-inbox-v1
related_architecture:
  - docs/architecture/companion-approval-inbox-architecture.md
implementation_files:
  - server/routes/companion.js
  - server/controllers/companion-controller.js
  - server/services/workflow/workflow-service.js
test_files:
  - tests/server/routes/companion-approval-inbox.test.js
---

# Brainbase Companion Approval Inbox API v1 Spec

> Surface lifecycle: Workflow Web retirement完了により`web_url` / `web_route`とdeep-link testは削除済み。安定したrun identity、`api_path`、self-contained context/evidence、MCP handoffを正規経路とする。

## 不変条件

- **INV-1**: Approval Inbox は `workflow_runs` と `workflow_human_steps` を正本として投影する。
- **INV-2**: pending human step を持たない run は返さない。
- **INV-3**: 一覧は latest run に限定しない。
- **INV-4**: 各 item は Mac Companion が表示に必要な run、pending step、output、context snapshot、audit evidence を含む。
- **INV-5**: API は外部送信、Graph 昇格、Task 作成、Decision 作成を実行しない。
- **INV-6**: Auth と owner guard は既存 Companion API と同じ native/server-to-server 境界に従う。
- **INV-7**: 既存 reply context/draft endpoint は挙動を変えない。

## 成功レスポンス契約

`GET /api/companion/approval-inbox` は `items`, `count`, `has_more`, `omitted_count` を返す。各 item は `id`, `kind`, `title`, `summary`, `priority`, `owner_id`, `action_kind`, `workflow_id`, `workflow_name`, `run_id`, `api_path`, `project_id`, `status`, `action_required`, `pending_human_steps`, `outputs`, `context`, `audit_refs`, `evidence`, `source_url` を持つ。`owner_id` は pending human step の `requested_to` を最優先し、`action_kind` は real producer が作る output type からも決定できる。

## シナリオ

- **S1 pending run**: pending human step を持つ run が approval item として返る。`requested -> auth_checked -> workflow_runs_scanned -> pending_steps_projected -> outputs_attached -> context_attached -> evidence_attached`
- **S2 old pending run**: latest ではない pending run も返る。`requested -> workflow_runs_scanned_all -> old_pending_preserved`
- **S3 no pending**: resolved / cancelled / succeeded run は返らない。`requested -> workflow_runs_scanned -> non_pending_filtered`
- **S4 auth**: 未認証または owner ではない bearer は拒否される。`requested -> auth_rejected -> no_workflow_scan`
- **S5 compatibility**: reply-context / reply-draft は従来通り利用できる。`requested -> existing_reply_route -> compatibility_preserved`
- **S6 no mutation**: approval inbox は repository の読み取りだけを行い、human step resolve や output 書き換えを行わない。`requested -> read_only_projection -> no_resolve_no_writeback`
- **S7 companion-ui boundary**: Brainbase側はMac Companionの一覧・承認UIを作らない。API projectionは廃止済みWeb URLを返さず、`api_path`とself-containedな判断材料を返す。`requested -> api_projection -> self_contained_item -> companion_ui_story`
- **S8 visible truncation**: pending approval が `limit` を超える場合、返却しない全件数を `has_more` と `omitted_count` で明示する。`requested -> pending_steps_projected -> response_limited_with_omitted_count`
- **S9 self-contained judgment**: Mac Companion が Brainbase Web を開かずに判断できるよう、`context` と `evidence` は参照IDだけでなく表示可能な summary/payload を含む。`requested -> context_attached -> evidence_attached -> self_contained_item`

## Workflow State Machine

### Scenario Clauses

- **SC-001 workflow state transition matrix**: Workflow approval inbox process は `requested -> auth_checked -> workflow_runs_scanned -> pending_steps_projected -> approval_item_ready -> response_serialized` の状態遷移を持つ。
- **SC-002 workflow auth rejection transition**: Workflow approval inbox process は missing auth / owner denied の場合、`requested -> auth_rejected` または `auth_checked -> project_grant_denied` へ遷移し、workflow scan を実行しない。
- **SC-003 workflow no-pending transition**: Workflow approval inbox process は pending human step がない run を `workflow_runs_scanned -> non_pending_filtered` として item から除外する。
- **SC-004 workflow read-only transition**: Workflow approval inbox process は `approval_item_ready -> response_serialized` までで停止し、human step resolve / writeback / external send へ遷移しない。

| State | Transition | Output |
|---|---|---|
| `requested` | missing auth | `401 Authorization token required` |
| `requested` | valid companion auth | `auth_checked` |
| `auth_checked` | project grant denied | `403` |
| `auth_checked` | project grant allowed | `workflow_runs_scanned` |
| `workflow_runs_scanned` | pending human steps found | `pending_steps_projected` |
| `workflow_runs_scanned` | no pending human steps | item omitted |
| `workflow_runs_scanned` | success/cancelled/resolved/closed run | item omitted |
| `pending_steps_projected` | outputs/context/evidence loaded | `approval_item_ready` |
| `approval_item_ready` | item count exceeds limit | `has_more: true`, `omitted_count > 0` |
| `approval_item_ready` | response serialized | `items[]` |

## Production Path Matrix

| Path | Input | Boundary | Evidence |
|---|---|---|---|
| native companion read | bearer/service/internal request | `/api/companion/approval-inbox` + companion guard | `tests/server/routes/companion-approval-inbox.test.js` |
| missing auth | no token | `requireAuth` before workflow scan | `tests/server/routes/companion-approval-inbox.test.js` |
| all-runs projection | older pending + newer success | repository `listRuns({ limit: null })` then response limit | `tests/server/routes/companion-approval-inbox.test.js` |
| terminal run exclusion | success/cancelled/closed run with stale pending step | run state gate before pending projection | `tests/server/routes/companion-approval-inbox.test.js` |
| self-contained judgment | context snapshots and audit evidence | `context[]` / `evidence[]` projection | `tests/server/routes/companion-approval-inbox.test.js` |
| visible truncation | pending approvals beyond response limit | `has_more` / `omitted_count` | `tests/server/routes/companion-approval-inbox.test.js` |
| retired Web link | approval item | `web_url` / `web_route`を返さず`api_path`を返す | `tests/server/routes/companion-approval-inbox.test.js` |
| existing reply context | Mac reply context POST | existing route compatibility | `tests/server/routes/companion-reply-draft.test.js` |

## Path / Surface Coverage

| 経路 | 期待 | 証跡 |
|---|---|---|
| `GET /api/companion/approval-inbox` | pending human step と outputs/context/evidence を返す | `tests/server/routes/companion-approval-inbox.test.js` |
| 古い pending run | latest run でなくても返す | `tests/server/routes/companion-approval-inbox.test.js` |
| pending なし | success/resolved run は返さない | `tests/server/routes/companion-approval-inbox.test.js` |
| limit超過 | `has_more` と `omitted_count` で未表示の全件数を返す | `tests/server/routes/companion-approval-inbox.test.js` |
| Web retirement | `web_url` / `web_route`を返さず、Run参照は`api_path`で渡す | `tests/server/routes/companion-approval-inbox.test.js` |
| 未認証 | `401` | `tests/server/routes/companion-approval-inbox.test.js` |
| 既存 reply context/draft | route 互換を維持 | `tests/server/routes/companion-reply-draft.test.js` |
| Mac Companion UI/preview | Brainbase repo では非該当。Mac Companion repo の approval focus queue story が担当 | `story-mac-companion-approval-focus-queue-v1` |

## 検証

- `npm run test:run -- tests/server/routes/companion-approval-inbox.test.js`
- `npm run test:run -- tests/server/routes/companion-reply-draft.test.js`
- `vibepro pr prepare . --base origin/develop --story-id story-companion-approval-inbox-v1`
