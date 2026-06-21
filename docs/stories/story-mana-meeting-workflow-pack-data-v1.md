---
story_id: story-mana-meeting-workflow-pack-data-v1
title: Mana Meeting Workflow Pack Data Connection v1
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
architecture_docs:
  - docs/architecture/mana-meeting-workflow-pack-data-architecture.md
spec_docs:
  - docs/specs/story-mana-meeting-workflow-pack-data-v1-spec.md
related_stories:
  - story-mana-meeting-workflow-pack-v0
  - story-org-agent-loop-control-v0
  - story-brainbase-workflow-mission-control
---

# Mana Meeting Workflow Pack Data Connection v1

## Background

`story-mana-meeting-workflow-pack-v0` added the Meeting Workflow Pack projection to `/workflows`, but the pack was still mostly static UI. The next phase is to connect the pack to Brainbase Workflow Control records so Mana meeting operations become actual Role Agent, Workflow Definition, Binding, Trigger, and Loop Intent data.

This Story does not execute Eve or Mana. It defines and bootstraps the Brainbase-side control-plane records that Eve or Mana will later consume.

## User Story

As a Brainbase operator preparing Mana meeting loops, I want to bootstrap the Meeting Workflow Pack into existing Workflow Control data in one action, so that Meeting Ops Agent, five meeting Workflow Definitions, trigger entries, approval-bound bindings, and initial Loop Intent candidates are persisted and visible in the Agent Loop Control UI.

## Acceptance Criteria

- [ ] ac:1 Brainbase exposes a Meeting Workflow Pack bootstrap endpoint under the Workflow Control namespace.
- [ ] ac:2 Bootstrap creates or updates one `Meeting Ops Agent` Role Agent instance scoped by `org_id` and `project_id`.
- [ ] ac:3 Bootstrap creates or updates exactly five meeting `workflow_templates` for `pre-meeting-briefing`, `transcript-to-meeting-note`, `meeting-note-to-tasks`, `meeting-note-to-decisions`, and `post-meeting-follow-up-message`.
- [ ] ac:4 Each meeting Workflow Definition carries trigger types, judgment DAG id, output contract, human gate, write-back target, risk level, and `meeting-workflow-pack` tags.
- [ ] ac:5 Bootstrap creates approval-required bindings from Meeting Ops Agent to each meeting Workflow Definition.
- [ ] ac:6 Bootstrap creates schedule/event/human `workflow_triggers` according to each definition's trigger contract.
- [ ] ac:7 Bootstrap can create deterministic initial `loop_intents` without duplicating them on repeated calls.
- [ ] ac:8 Bootstrap records an audit log entry with the created or updated record ids.
- [ ] ac:9 `/workflows` displays whether each meeting Workflow Definition is configured from real Workflow Control data.
- [ ] ac:10 `/workflows` can call bootstrap and refresh the Meeting Workflow Pack panel without requiring hand entry in the generic forms.
- [ ] ac:11 Existing individual Workflow Control APIs continue to work.

## State Transitions

- `missing`: `/workflows` has no matching meeting Workflow Definition records for the selected project.
- `bootstrap_requested`: the operator calls `POST /api/workflows/control/meeting-pack/bootstrap` for an allowed `org_id` and `project_id`.
- `records_persisted`: Workflow Control persists Role Agent, Templates, Bindings, Triggers, Loop Intent candidates, and audit log in one transaction.
- `data_connected`: `/workflows` refreshes Workflow Control data and derives all five meeting definitions as configured.
- `blocked_auth_denied`: the actor cannot access the project, so no records are written.
- `blocked_persistence_failure`: repository persistence fails, the transaction rolls back, and no partial meeting pack records remain.

## Non-goals

- Do not run Eve or Mana execution.
- Do not create `workflow_runs`, `workflow_outputs`, or `workflow_human_steps` from bootstrap alone.
- Do not write task, Decision, or external message targets.
- Do not introduce a second meeting database.
