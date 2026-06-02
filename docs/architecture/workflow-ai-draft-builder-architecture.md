---
architecture_id: workflow-ai-draft-builder-architecture
title: AI Workflow Draft Builder Architecture
related_stories:
  - docs/stories/story-workflow-ai-draft-builder.md
status: proposed
created_at: 2026-06-02
updated_at: 2026-06-02
---

# AI Workflow Draft Builder Architecture

## 1. Intent

AI Workflow Draft Builder adds a creation loop on top of Workflow Mission Control. It is not a new runner. It produces a draft, validates the draft, previews the draft, and publishes the draft into the existing workflow repository. Real execution still goes through `runWorkflow()`.

```text
Prompt
  -> Draft Generator
  -> Draft Schema Validator
  -> Builder Preview
  -> Draft Test / Dry-run
  -> Publish Workflow
  -> runWorkflow() for real runs
```

## 2. Boundaries

### Draft is not workflow state

A draft is temporary and reviewable. It can be generated and tested without adding `workflow_runs`. It becomes a workflow only through publish.

### Publish uses existing workflow repository

Publishing maps the draft to `POST /api/workflows`, preserving `workspace_id`, `project_id`, `owner_id`, `context_sources`, `risk_level`, and `hitl_policy`.

### Test does not execute external side effects

Draft test validates project access, required context shape, steps, HITL policy, and preview output. It must not send mail, post to SNS, update production data, or create a real run.

## 3. Components

```text
public/workflows.html
  Project Detail Draft Panel
    prompt
    Generate Draft
    Test Draft
    Publish
    Builder Preview

server/routes/workflows.js
  POST /api/workflows/draft
  POST /api/workflows/draft/test

server/services/workflow/workflow-draft-generator.js
  generateWorkflowDraft()
  testWorkflowDraft()
  normalizeWorkflowDraft()

server/services/workflow/workflow-service.js
  publish path remains createWorkflow()
```

The first generator may be deterministic and local. The provider boundary should allow a future LLM implementation without changing UI or publish semantics.

## 4. Data Shape

```ts
type WorkflowDraft = {
  draft_id: string
  project_id: string
  name: string
  description: string
  risk_level: "low" | "medium" | "high"
  hitl_policy: "none" | "human_review" | "approval_required"
  implementation_key: "manual-placeholder"
  workflow: Workflow
  context_sources: WorkflowContextSource[]
  steps: WorkflowDraftStep[]
  builder_preview: BuilderPreview
}
```

`implementation_key` stays `manual-placeholder` in the first implementation. A later provider can suggest specialized implementation keys only when matching handlers exist.

## 5. UI State

```text
empty prompt
  -> generating
  -> draft_ready
  -> testing
  -> test_passed | test_failed
  -> publishing
  -> published
```

Errors are visible inline and must not leave the user in a dead end.

## 6. Verification

- Unit tests cover draft generation and dry-run validation.
- Route tests cover authorization, schema, draft test, and publish compatibility.
- E2E covers Project detail prompt -> generate -> preview -> test -> publish -> workflow detail.

## 7. PR2 Implementation Closure

The implementation slice keeps the builder inside the existing Workflow Mission Control architecture.

```text
server/routes/workflows.js
  POST /api/workflows/draft
  POST /api/workflows/draft/test

server/services/workflow/workflow-draft-generator.js
  generateWorkflowDraft()
  testWorkflowDraft()

server/services/workflow/workflow-service.js
  generateDraft()
  testDraft()
  createWorkflow() remains the publish path

public/workflows.html
  Workflow Draft Builder panel
```

The final PR2 state machine is:

```text
empty
  -> draft_generated
  -> draft_tested_passed | draft_tested_failed
  -> published_workflow
  -> runWorkflow()
```

This PR intentionally does not introduce a new runner, scheduler, local agent polling, full node editor persistence, external LLM provider, DB migration, or external side-effect execution during draft test.
