---
design_id: brainbase-workflow-project-first-ux
story_id: story-brainbase-workflow-mission-control
title: Brainbase Workflow Project-first UX
status: proposed
created_at: 2026-06-01
updated_at: 2026-06-01
---

# Brainbase Workflow Project-first UX

## Intent

Workflow Mission Control is a Project-first operational surface. The user starts from a Workspace, opens a Project, sees that Project's documents/context and workflows together, then drills into a Workflow and Run trace.

## Workspace Home

Workspace Home shows Project cards first. It also keeps an Operational Inbox for cross-project action required, human waiting, failed, stale, and recent workflows.

## Project Detail

Project Detail is the natural workflow browsing and creation entry.

- Workflows for the selected Project
- Documents / Context for that Project
- Project-fixed Add Workflow form
- Context bindings and latest operational status

## Workflow Detail

Workflow Detail appears before a full canvas editor.

- Project breadcrumb
- Owner / risk / HITL policy
- Builder / Canvas preview
- Context sources
- Runs / Trace
- Manual run action

## Run Detail / Trace

Run Detail is the evidence surface.

- Run status, trigger, env
- Step timeline
- Resolved context
- Outputs
- Human / Audit
- Rerun action
- Pending human-step Approve / Reject actions

## Global `/workflows`

`/workflows` is not only a workflow list. It is a Mission Control inbox that keeps urgent operational states visible while preserving the Project-first browsing path.
