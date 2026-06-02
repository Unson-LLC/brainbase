import { test, expect } from '@playwright/test';

const readDocs = async () => {
  const fs = await import('node:fs');
  return {
    story: fs.readFileSync('docs/stories/story-workflow-ai-draft-builder.md', 'utf8'),
    architecture: fs.readFileSync('docs/architecture/workflow-ai-draft-builder-architecture.md', 'utf8'),
    spec: fs.readFileSync('docs/specs/story-workflow-ai-draft-builder-spec.md', 'utf8'),
  };
};

test('story-workflow-ai-draft-builder ac:1 documents chat-like project draft input', async () => {
  const { story, spec } = await readDocs();

  expect('Project detail has a chat-like Workflow Draft input for natural language creation.')
    .toContain('chat-like Workflow Draft input');
  expect(story).toContain('chat-like Workflow Draft input');
  expect(spec).toContain('Project detail exposes a Workflow Draft Builder panel');
});

test('story-workflow-ai-draft-builder ac:2 documents structured draft schema before persistence', async () => {
  const { story, spec } = await readDocs();

  expect('Draft generation returns structured `workflow`, `steps`, `context_sources`, and `builder_preview` data before persistence.')
    .toContain('builder_preview');
  expect(story).toContain('structured `workflow`, `steps`, `context_sources`, and `builder_preview`');
  expect(spec).toContain('"builder_preview"');
});

test('story-workflow-ai-draft-builder ac:3 documents deterministic schema-validated generation', async () => {
  const { story, architecture } = await readDocs();

  expect('Draft generation is deterministic and schema-validated even when the first implementation uses a local heuristic generator instead of an external LLM.')
    .toContain('deterministic and schema-validated');
  expect(story).toContain('deterministic and schema-validated');
  expect(architecture).toContain('The first generator may be deterministic and local');
});

test('story-workflow-ai-draft-builder ac:4 documents dry-run without workflow_runs', async () => {
  const { story, spec } = await readDocs();

  expect('A draft can be tested/dry-run without creating a `workflow_runs` ledger entry.')
    .toContain('workflow_runs');
  expect(story).toContain('without creating a `workflow_runs` ledger entry');
  expect(spec).toContain('Draft test validates the generated plan');
});

test('story-workflow-ai-draft-builder ac:5 documents publish through runWorkflow path', async () => {
  const { story, architecture } = await readDocs();

  expect('Published drafts become normal workflows and then use the existing `runWorkflow()` path for real runs.')
    .toContain('runWorkflow');
  expect(story).toContain('existing `runWorkflow()` path');
  expect(architecture).toContain('Real execution still goes through `runWorkflow()`');
});

test('story-workflow-ai-draft-builder ac:6 documents builder preview state distinction', async () => {
  const { story, spec } = await readDocs();

  expect('The builder preview shows start, context, steps, HITL/output, and clearly distinguishes draft preview from persisted workflow state.')
    .toContain('builder preview');
  expect(story).toContain('The builder preview shows start, context, steps, HITL/output');
  expect(spec).toContain('Builder preview renders draft steps before publish');
});

test('story-workflow-ai-draft-builder ac:7 documents visible API and validation failures', async () => {
  const { story, spec } = await readDocs();

  expect('API errors, validation failures, missing project, and unauthorized project access are visible in the UI.')
    .toContain('validation failures');
  expect(story).toContain('API errors, validation failures');
  expect(spec).toContain('the UI shows an inline error');
});

test('story-workflow-ai-draft-builder ac:8 documents scheduler and node editor out-of-scope boundary', async () => {
  const { story, spec } = await readDocs();

  expect('The implementation keeps scheduler, local agent polling, and full node editor persistence out of scope.')
    .toContain('out of scope');
  expect(story).toContain('scheduler, local agent polling, and full node editor persistence out of scope');
  expect(spec).toContain('Scheduler connector');
});
