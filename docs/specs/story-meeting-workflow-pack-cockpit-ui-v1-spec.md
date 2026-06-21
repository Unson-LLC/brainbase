---
story_id: story-meeting-workflow-pack-cockpit-ui-v1
title: Meeting Workflow Pack Cockpit UI v1 Spec
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
diagrams:
  - kind: flow
    path: docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md
    purpose: /workflowsからMeeting Workflow Pack Cockpit、Workflow Control API、local HITL state、未実行write-back境界までのflowを示す。
  - kind: state
    path: docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md
    purpose: loading、overview、review queue、review detail、approved/rejected local state、run trace、agent stubの状態遷移を示す。
---

# Meeting Workflow Pack Cockpit UI v1 Spec

## Invariants

- INV-001: Meeting Ops Agent は会議 output の正本ではなく、会議 workflow を選択・束ねる Role Agent として表示する。
- INV-002: Workflow Definitions は prompt template ではなく、input / trigger / human gate / write-back / audit evidence を持つ業務定義として表示する。
- INV-003: Human Gate の承認操作は v1 では画面内状態に閉じ、Task Store、Graph SSOT、外部チャネルには書き込まない。
- INV-004: Graph SSOT への Decision 昇格は `Candidate Store -> promotion` の候補として扱い、未承認の runner output を正本扱いしない。
- INV-005: zip prototype の主要 layout marker は HTML 上で E2E 検証可能な `data-*` selector を持つ。

## Scenarios

- S-001: Operator opens `/meeting-workflow-pack.html?project=salestailor` and sees the `AGENT LOOP CONTROL` shell with Meeting Ops Agent selected.
- S-002: Operator switches Instance between `unson` and `salestailor`, and the scope / tool policy panel changes without leaving the Cockpit.
- S-003: Operator opens Review Queue and sees pending `Tasks 作成`, `Decisions 昇格`, and `Follow-up 送信` gates.
- S-004: Operator opens `Decisions 昇格`, edits a candidate, checks high-risk confirmation, and approves it in local UI state.
- S-005: Operator rejects a Follow-up draft with a reason, and the queue keeps an audit-visible rejected state without sending externally.
- S-006: Operator opens a Run Trace and sees meeting source, note summary, write-back status, and audit evidence.
- S-007: Operator opens Sales / Back-office / Marketing Agent and sees a stub shell that communicates the agent is not built yet.
- S-008: Operator opens `/workflows` and can navigate to the dedicated Cockpit from the Meeting Workflow Pack panel.

## UI Contract

`public/meeting-workflow-pack.html` must include these selectors.

| Selector | Meaning |
|---|---|
| `[data-agent-loop-control]` | Cockpit root |
| `[data-agent-header]` | black Agent Loop Control header |
| `[data-instance-switcher]` | Instance switcher |
| `[data-agent-switcher]` | Role Agent switcher |
| `[data-left-rail]` | left rail |
| `[data-review-queue]` | human approval queue |
| `[data-review-card]` | one approval item |
| `[data-review-detail]` | selected review detail |
| `[data-run-trace]` | run trace view |
| `[data-definition-card]` | workflow definition card |
| `[data-agent-stub]` | non-Meeting Ops placeholder |

## Data Contract

The page reads Workflow Control resources with `project_id` query.

```text
GET /api/workflows/control/role-agents
GET /api/workflows/control/templates
GET /api/workflows/control/bindings
GET /api/workflows/control/triggers
GET /api/workflows/control/loop-intents
```

The page must accept both existing API response envelopes and empty arrays.

```text
role_agent_instances[]
workflow_templates[]
workflow_bindings[]
workflow_triggers[]
loop_intents[]
```

## Diagrams

- kind: flow
  path: `docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md`
  purpose: `/workflows` から Meeting Workflow Pack Cockpit、Workflow Control API、local HITL state、未実行 write-back 境界までの flow を示す。
- kind: state
  path: `docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md`
  purpose: loading、overview、review queue、review detail、approved/rejected local state、run trace、agent stub の状態遷移を示す。

## Acceptance Tests

- `tests/e2e/story-meeting-workflow-pack-cockpit-ui-v1-cockpit.spec.ts` validates Story/Architecture/Spec trace text.
- The same E2E test mocks Workflow Control APIs and validates:
  - `AGENT LOOP CONTROL` header.
  - three trigger lanes.
  - five meeting workflow definitions.
  - Review Queue cards.
  - Review Detail editing and high-risk approval.
  - Agent stub switching.
  - `/workflows` link to Cockpit.

## Anti-Patterns

- AP-001: Rendering only a small Meeting Pack panel inside `/workflows` and claiming zip prototype reproduction.
- AP-002: Embedding the Decap prototype runtime as production UI.
- AP-003: Treating local approve state as actual Graph / Task / external write-back.
- AP-004: Hiding schedule / event / human trigger separation.
- AP-005: Removing existing Workflow Mission Control behavior from `/workflows`.
