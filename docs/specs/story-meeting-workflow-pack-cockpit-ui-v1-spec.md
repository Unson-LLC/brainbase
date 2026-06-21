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

- INV-001: 会議業務エージェントは会議 output の正本ではなく、会議 workflow を選択・束ねる Role Agent として表示する。
- INV-002: ワークフロー定義は prompt template ではなく、入力 / trigger / 人間確認 / 書き戻し / 監査証跡を持つ業務定義として表示する。
- INV-003: Human Gate の承認操作は v1 では画面内状態に閉じ、Task Store、Graph SSOT、外部チャネルには書き込まない。
- INV-004: Graph SSOT への Decision 昇格は `Candidate Store -> promotion` の候補として扱い、未承認の runner output を正本扱いしない。
- INV-005: `public/meeting-workflow-pack.html` は zip prototype の layout / interaction / marker を継承しつつ、画面表示は日本語で理解できる状態にする。
- INV-006: `public/support.js` is byte-for-byte aligned with `docs/design/prototypes/meeting-workflow-pack/support.js` so the DC prototype renders the same in the app route.

## Scenarios

- S-001: Operator opens `/meeting-workflow-pack.html?project=salestailor` and sees the `業務ループ制御` shell with `会議業務エージェント` selected.
- S-002: Operator switches Instance between `unson` and `salestailor`, and the scope / tool policy panel changes without leaving the Cockpit.
- S-003: Operator opens Review Queue and sees pending `タスク作成`, `決定事項の昇格`, and `フォローアップ送信` gates.
- S-004: Operator opens `Decisions 昇格`, edits a candidate, checks high-risk confirmation, and approves it in local UI state.
- S-005: Operator rejects a follow-up draft with a reason, and the queue keeps an audit-visible rejected state without sending externally.
- S-006: Operator opens a Run Trace and sees meeting source, note summary, write-back status, and audit evidence.
- S-007: Operator opens 営業 / バックオフィス / マーケティング Agent and sees a stub shell that communicates the agent is not built yet.
- S-008: Operator opens `/workflows` and can navigate to the dedicated Cockpit from the Meeting Workflow Pack panel.

## UI Contract

`public/meeting-workflow-pack.html` is the promoted zip prototype surface. The interactive contract is inherited from `docs/design/prototypes/meeting-workflow-pack/meeting-workflow-pack.dc.html`; visible labels are localized to Japanese for actual use.

| Marker | Meaning |
|---|---|
| `業務ループ制御` | black header label |
| `button[data-menu="instance"]` | Instance menu |
| `button[data-menu="agent"]` | Role Agent menu |
| `button[data-nav="review"]` | review queue navigation |
| `button[data-rk]` | selected human gate review |
| `button[data-run]` | selected run trace |
| `button[data-wf]` | workflow definition |
| `button[data-agent]` | role agent switching |

## Data Contract

This Story does not require Workflow Control API reads. It preserves the zip prototype's deterministic local state so the user can verify the screen and interaction model.

The next Story may replace prototype local state with Workflow Control API data, but must preserve the same visible structure unless VibePro records a design change.

## Diagrams

- kind: flow
  path: `docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md`
  purpose: `/workflows` から Meeting Workflow Pack Cockpit、Workflow Control API、local HITL state、未実行 write-back 境界までの flow を示す。
- kind: state
  path: `docs/architecture/meeting-workflow-pack-cockpit-ui-architecture.md`
  purpose: loading、overview、review queue、review detail、approved/rejected local state、run trace、agent stub の状態遷移を示す。

## Acceptance Tests

- `tests/e2e/story-meeting-workflow-pack-cockpit-ui-v1-cockpit.spec.ts` validates Story/Architecture/Spec trace text.
- The same E2E test renders the promoted prototype-derived UI and validates:
  - `業務ループ制御` header.
  - three Japanese trigger lanes.
  - five meeting workflow definitions.
  - Review Queue cards.
  - Review Detail editing and high-risk approval.
  - Agent stub switching.
  - `/workflows` link to Cockpit.
  - The same E2E test proves public `support.js` remains byte-for-byte equal to the promoted zip prototype runtime.

## Anti-Patterns

- AP-001: Rendering only a small Meeting Pack panel inside `/workflows` and claiming zip prototype reproduction.
- AP-002: Reimplementing the zip screen with a visually different custom surface and claiming prototype reproduction.
- AP-003: Treating local approve state as actual Graph / Task / external write-back.
- AP-004: Hiding schedule / event / human trigger separation.
- AP-005: Removing existing Workflow Mission Control behavior from `/workflows`.
