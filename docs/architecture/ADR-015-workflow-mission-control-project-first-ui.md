---
adr_id: ADR-015
title: Workflow Mission Control Project-first UI
status: accepted
date: 2026-06-01
related_stories:
  - story-brainbase-workflow-mission-control
related_docs:
  - docs/stories/story-brainbase-workflow-mission-control.md
  - docs/architecture/brainbase-workflow-mission-control-architecture.md
  - docs/specs/story-brainbase-workflow-mission-control-spec.md
  - docs/design/brainbase-workflow-project-first-ux.md
supersedes: []
superseded_by: []
---

# ADR-015: Workflow Mission Control Project-first UI

## Context

Brainbase Workflow Mission Control needs to make routine work visible as an owned operational unit, not only as an execution log. The user-facing workflow creation path starts from a Project, then binds context, then records runs and human decisions.

## Decision

Workflow Mission Control uses a Project-first UI model.

- `/workflows` remains the global operational inbox for cross-project action required, human waiting, failed, stale, and recent workflow states.
- Workspace Home shows Project cards first, so the user can enter workflow work through the same Project concept used by Session creation.
- Project Detail owns workflow browsing and workflow creation for that Project.
- Workflow Detail appears before a full canvas editor and shows project, owner, risk, HITL policy, context sources, latest runs, and run actions.
- Run Detail is the evidence surface for resolved context, step timeline, outputs, human decisions, audit, rerun, and human-step resolution.
- The activity bar exposes `/workflows` as a first-class Brainbase surface.

Human-in-the-loop operations are not treated as untracked modal confirmations. Pending human steps must be represented in Run Detail and resolved through the run-scoped API path.

## Boundaries

In scope: static `/workflows` UI composition, activity bar entry, Project-first browsing, planned/resolved context visibility, Run detail human-step controls, and visible network failure states.

Out of scope: new persistence model, new scheduler connector, local agent polling, external integration boundaries, full canvas persistence, and changes to `runWorkflow()` execution semantics.

## Consequences

Users can understand which Project a workflow belongs to before editing or running it. Context binding is visible before execution and resolved context is visible after execution. Human decisions become part of the workflow run trace and audit path.
