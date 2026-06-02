---
spec_id: story-workflow-ai-draft-builder-spec
story_id: story-workflow-ai-draft-builder
title: AI Workflow Draft Builder Spec
related_story: docs/stories/story-workflow-ai-draft-builder.md
related_architecture: docs/architecture/workflow-ai-draft-builder-architecture.md
status: proposed
created_at: 2026-06-02
updated_at: 2026-06-02
---

# AI Workflow Draft Builder Spec

## 1. Scope

The first slice adds a chat-like draft generation loop inside Workflow Mission Control. It does not add a scheduler, full canvas editor, or real external side-effect workflow implementation.

## 2. Invariants

### INV-001: Draft before persistence

AI generation returns a draft object. A generated draft is not persisted as a workflow until the user publishes it.

### INV-002: Schema before trust

Generated output is normalized into a strict schema. Free-form model text is never treated as trusted workflow state.

### INV-003: Project-bound generation

Every draft has `project_id`, and protected APIs apply the same project grant rules as Workflow Mission Control.

### INV-004: Test is dry-run

Draft test validates the generated plan and returns preview evidence. It must not create `workflow_runs`, `workflow_outputs`, `human_steps`, or external side effects.

### INV-005: Publish joins existing workflow path

Publishing a draft creates a normal workflow through the existing create workflow service. Real execution after publish uses `runWorkflow()`.

## 3. API Contract

### `POST /api/workflows/draft`

Request:

```json
{
  "project_id": "general",
  "prompt": "毎朝、予定と未完了タスクをまとめたい"
}
```

Response:

```json
{
  "draft": {
    "draft_id": "draft_xxx",
    "project_id": "general",
    "name": "Morning Briefing",
    "description": "...",
    "risk_level": "low",
    "hitl_policy": "none",
    "implementation_key": "manual-placeholder",
    "workflow": {
      "id": "wf_xxx",
      "project_id": "general",
      "implementation_key": "manual-placeholder",
      "context_sources": []
    },
    "context_sources": [],
    "steps": [],
    "builder_preview": {}
  }
}
```

### `POST /api/workflows/draft/test`

Request contains the draft returned by generation.

Response:

```json
{
  "test_result": {
    "status": "passed",
    "dry_run": true,
    "message": "Draft is ready to publish",
    "step_results": []
  }
}
```

## 4. UI Contract

- Project detail exposes a Workflow Draft Builder panel.
- The panel includes prompt input, Generate Draft, Test Draft, and Publish buttons.
- Builder preview renders draft steps before publish.
- Publish creates a workflow and navigates to Workflow detail.
- Buttons show visible pending/error/success state.
- Embedded shell mode keeps the user inside Brainbase and preserves in-content back controls.

## 5. Required Scenarios

### S-001: Generate draft from prompt

Given a project is open.
When the user enters a workflow request and clicks Generate Draft.
Then the UI shows a structured draft and builder preview without persisting a workflow.

### S-002: Test draft

Given a draft is ready.
When the user clicks Test Draft.
Then the API returns `dry_run=true` and the UI shows passed/failed without creating a real run.

### S-003: Publish draft

Given a tested draft.
When the user clicks Publish.
Then the draft becomes a normal workflow and the UI navigates to Workflow detail.

### S-004: Error visibility

Given draft generation, test, or publish fails.
When the API returns an error.
Then the UI shows an inline error and keeps the draft prompt/edit path available.

## 6. State Machine

```text
empty
  -> draft_generated
  -> draft_tested_passed | draft_tested_failed
  -> published_workflow
```

- `draft_generated` is not persisted as workflow state.
- `draft_tested_passed` and `draft_tested_failed` return dry-run evidence only.
- Draft test must not create `workflow_runs`, `workflow_outputs`, `human_steps`, or external side effects.
- `published_workflow` is created only through the existing `POST /api/workflows` path.
- Real execution after publish must use `POST /api/workflows/:id/run` and `runWorkflow()`.

## 7. PR2 Verification Contract

- Route tests must cover draft generation without persistence.
- Route tests must cover dry-run without `workflow_runs`, `workflow_outputs`, or `human_steps`.
- Route tests must reject malformed drafts and mismatched `draft.context_sources` / `workflow.context_sources`.
- Route tests must publish a generated draft and then run it through the normal `runWorkflow()` path.
- E2E must cover Add Workflow focus, generate, preview, test, publish, readable inline API errors, and retryable publish failure.

## 8. Out of Scope

- Real LLM provider as the only generation path.
- Full canvas editing and persisted node positions.
- Scheduler connector.
- External side-effect execution during draft test.
