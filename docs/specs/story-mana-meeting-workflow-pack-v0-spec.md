# Mana Meeting Workflow Pack v0 Spec

## Contract

Meeting Workflow Pack v0 adds a UI projection for meeting Workflow Definitions inside Workflow Mission Control. It must preserve the existing Loop Control backend model while presenting meeting workflows as Workflow Definitions rather than prompt templates.

## Invariants

- INV-001: `Meeting Ops Agent` is displayed as a Role Agent selector, not as the source of truth for task, Decision, or message outputs.
- INV-002: The UI must use the wording `Workflow Definition` for the meeting pack projection.
- INV-003: The five required definitions are visible: `pre-meeting-briefing`, `transcript-to-meeting-note`, `meeting-note-to-tasks`, `meeting-note-to-decisions`, `post-meeting-follow-up-message`.
- INV-004: Definitions are grouped by trigger class: `schedule`, `event`, `human`.
- INV-005: Task creation, Decision promotion, and external message send are shown as Human Gate protected side effects.
- INV-006: Decision outputs are shown as candidates until Graph SSOT promotion approval passes.
- INV-007: External message outputs are shown as drafts until approval passes.
- INV-008: UI must not introduce a second meeting database or new source of truth.

## UI Clauses

- UI-001: Project detail renders a Meeting Workflow Pack panel inside Agent Loop Control.
- UI-002: The panel shows pack-level counts for definitions, trigger classes, and human gates.
- UI-003: The panel shows a lifecycle map from pre-meeting to post-meeting follow-up.
- UI-004: The panel shows guardrails for Graph SSOT promotion, external send, event retry, and privacy scope leak.
- UI-005: The panel shows a Human Gate queue projection for task, Decision, and message approval.
- UI-006: The panel links the imported prototype and screenshots as design evidence.
- UI-007: The panel must be useful even before real Mana/Eve events exist.

## Data Mapping

| UI term | Existing backend surface |
|---|---|
| Workflow Definition | `workflow_templates` projection |
| Meeting Ops Agent | `role_agent_instances` projection |
| Trigger lane | `workflow_triggers.trigger_type` |
| Human Gate | `workflow_human_steps` / approval-required Loop Intent |
| Meeting source | `loop_intents.input_payload` or Run metadata |
| Write-back target | Workflow Output metadata / Audit after-state |
| Graph promotion | Human Step approval before Decision write-back |

## Scenarios

- S-001: A user opens a project in `/workflows` and sees `Meeting Workflow Pack` under Agent Loop Control.
- S-002: The same screen shows all five Workflow Definitions with trigger class and Human Gate status.
- S-003: The Human Gate queue shows task creation, Decision promotion, and follow-up send as approval items.
- S-004: The UI warns that Graph SSOT promotion and external sending require approval.
- S-005: The UI states that runner output is not SSOT until Brainbase validation and approval.
- S-006: Existing Role Agent / Binding / Trigger / Loop Intent forms continue to render and submit.

## Anti-patterns

- AP-001: Calling the meeting workflows templates in user-facing copy.
- AP-002: Showing generated Decisions as already written to Graph SSOT.
- AP-003: Showing follow-up messages as already sent.
- AP-004: Hiding `schedule`, `event`, and `human` trigger distinctions.
- AP-005: Replacing existing Workflow Mission Control UI with a standalone DC runtime.

## Verification

- `npm run test:e2e -- tests/e2e/story-mana-meeting-workflow-pack-v0-ui.spec.ts --project=chromium`
- `npm run test:run -- tests/server/routes/workflows.test.js tests/server/services/workflow-org-agent-control.test.js`
- `npm run typecheck`
- `git diff --check`
