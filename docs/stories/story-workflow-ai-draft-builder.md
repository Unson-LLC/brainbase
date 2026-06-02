---
story_id: story-workflow-ai-draft-builder
title: AI Workflow Draft Builder
source_requirement:
  type: user_reported_gap
  description: Workflow creation should start from a chat-like prompt where AI proposes a workflow draft, shows it on a builder canvas, lets the user test it, and publishes it only after review.
architecture_docs:
  - path: docs/architecture/workflow-ai-draft-builder-architecture.md
    status: proposed
spec_docs:
  - path: docs/specs/story-workflow-ai-draft-builder-spec.md
    status: proposed
related_stories:
  - story-brainbase-workflow-mission-control
status: draft
created_at: 2026-06-02
updated_at: 2026-06-02
---

# AI Workflow Draft Builder

## Background

Workflow Mission Control can already register workflows, run them through `runWorkflow()`, and display project/context/run evidence. The missing product experience is the creation loop: the user wants to describe the routine in natural language, have Brainbase draft the workflow, inspect it visually, test it, then publish it.

The first version must not pretend to be a full workflow engine or canvas editor. It should create a reviewable draft from a prompt, make the draft structure visible, validate/test the draft, and only then persist a real workflow.

## User Story

As a Brainbase user turning repeated work into workflows, I want to describe the desired workflow in chat, receive an AI-generated workflow draft with project/context/steps/HITL policy, see the draft in a builder preview, test the draft before saving, and publish it into Workflow Mission Control when it looks correct.

## Acceptance Criteria

- [ ] Project detail has a chat-like Workflow Draft input for natural language creation.
- [ ] Draft generation returns structured `workflow`, `steps`, `context_sources`, and `builder_preview` data before persistence.
- [ ] Draft generation is deterministic and schema-validated even when the first implementation uses a local heuristic generator instead of an external LLM.
- [ ] A draft can be tested/dry-run without creating a `workflow_runs` ledger entry.
- [ ] Published drafts become normal workflows and then use the existing `runWorkflow()` path for real runs.
- [ ] The builder preview shows start, context, steps, HITL/output, and clearly distinguishes draft preview from persisted workflow state.
- [ ] API errors, validation failures, missing project, and unauthorized project access are visible in the UI.
- [ ] The implementation keeps scheduler, local agent polling, and full node editor persistence out of scope.

## Story Slices

1. `story-workflow-ai-draft-contract`: define draft schema, generation API, dry-run API, and publish boundary.
2. `story-workflow-ai-draft-ui`: connect Project detail chat input to draft generation, preview, test, and publish actions.
3. `story-workflow-ai-draft-ai-provider`: replace or augment the deterministic local draft generator with a real model provider behind the same schema contract.

## Non-goals

- Full visual node editor.
- Persisting arbitrary canvas layout as the workflow source of truth.
- Scheduler connector implementation.
- External side-effect execution during draft test.
- Using LLM free text as trusted workflow data without schema validation.
