# Mana Meeting Workflow Pack Data v1 Spec

## Contract

Meeting Workflow Pack Data v1 adds a deterministic bootstrap path that writes meeting pack records into existing Workflow Control surfaces. It must not create a parallel meeting database or create workflow runs as a side effect.

## Invariants

- INV-001: Bootstrap writes to existing `role_agent_instances`, `workflow_templates`, `workflow_bindings`, `workflow_triggers`, `loop_intents`, and `audit_logs`.
- INV-002: Bootstrap is idempotent and uses stable ids for the same `org_id` and `project_id`.
- INV-003: Bootstrap creates one `Meeting Ops Agent` role agent for the org/project scope.
- INV-004: Bootstrap creates exactly five meeting Workflow Definitions.
- INV-005: All generated bindings use `autonomy_level=approval_required`.
- INV-006: Trigger records preserve each definition's schedule/event/human contract.
- INV-007: Initial Loop Intents are candidates with approval-required eligibility and null `meeting_identity`.
- INV-008: Bootstrap does not create `workflow_runs`, `workflow_outputs`, or `workflow_human_steps`.
- INV-009: UI configured state is derived from real `workflow_templates`, not static definition count.

## Scenarios

- S-001: Given the meeting workflow state is missing, when bootstrap is requested, then the workflow state transition persists Role Agent, five templates, approval-required bindings, triggers, Loop Intent candidates, and audit log.
- S-002: Given `auth_denied` access to the project, when the meeting workflow bootstrap is requested, then the workflow state transition goes to `blocked_auth_denied` and writes no records.
- S-003: A user opens `/workflows` before bootstrap and sees missing definition status plus a bootstrap action.
- S-004: After bootstrap, `/workflows` shows all five definitions as configured and disables bootstrap.
- S-005: Given the meeting workflow UI starts in missing state, when bootstrap succeeds after `records_persisted`, then the workflow state transition refreshes to `data_connected`.
- S-006: State transition `missing -> bootstrap_requested -> records_persisted -> data_connected` is replayed by the UI test.
- S-007: Given `persistence_failure` while writing `workflow_triggers`, when bootstrap is requested, then the workflow rollback transition removes Role Agent, templates, bindings, triggers, Loop Intents, and audit logs.
- S-008: Given bootstrap is requested, when the meeting workflow pack is built, then the workflow process invokes no Eve, Mana, LLM, mail, Slack, CRM, or Workflow Runner provider.
- S-009: A repeated bootstrap for the same org/project updates the same records and does not duplicate templates, bindings, triggers, or Loop Intents.
- S-010: Existing individual Workflow Control POST and GET paths still work.

## Failure Modes

- FM-001 `auth_denied`: project access denial must stop bootstrap before writes.
- FM-002 `persistence_failure`: repository failure during the transaction must roll back partial records and audit logs.
- FM-003 `provider_failure`: not applicable to bootstrap execution because this story does not call Eve, Mana, LLM, mail, Slack, CRM, or Workflow Runner providers; executable tests assert provider handlers are not invoked.

## Anti-patterns

- AP-001: Creating workflow runs during bootstrap.
- AP-002: Treating initial Loop Intent candidates as executed work.
- AP-003: Using random ids that duplicate records on repeated bootstrap.
- AP-004: Making the UI claim data is connected from static constants alone.
- AP-005: Calling external providers during bootstrap.

## Verification

- `npm run test:run -- tests/server/services/workflow-org-agent-control.test.js tests/server/routes/workflows.test.js`
- `npm run test:e2e -- tests/e2e/story-mana-meeting-workflow-pack-data-v1-ui.spec.ts --project=chromium`
- `npm run typecheck`
- `git diff --check`
