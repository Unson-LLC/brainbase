import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const successorStoryId = 'story-program-external-delivery-selector-runtime-integration-v1';
const predecessorStoryId = 'story-program-external-delivery-reconciliation-v1';
const successorStoryPath = 'docs/management/stories/active/story-program-external-delivery-selector-runtime-integration-v1.md';
const successorArchitecturePath = 'docs/architecture/story-program-external-delivery-selector-runtime-integration-v1.md';
const successorSpecMarkdownPath = 'docs/specs/program-external-delivery-selector-runtime-integration-v1.md';
const successorSpecJsonPath = 'docs/specs/program-external-delivery-selector-runtime-integration-v1.json';
const successorTaskPath = 'docs/management/tasks/program-external-delivery-selector-runtime-integration-v1.json';
const successorAcceptedTaskPath = 'docs/management/tasks/program-external-delivery-selector-runtime-integration-v1.vibepro.json';
const predecessorStoryPath = 'docs/management/stories/active/story-program-external-delivery-reconciliation-v1.md';
const predecessorSpecMarkdownPath = 'docs/specs/program-external-delivery-reconciliation-v1.md';
const predecessorSpecJsonPath = 'docs/specs/program-external-delivery-reconciliation-v1.json';
const predecessorTaskPath = 'docs/management/tasks/program-external-delivery-reconciliation-v1.json';
const predecessorTraceabilityPath = 'tests/fixtures/program-external-delivery-reconciliation/generated-surfaces/current/traceability.json';
const expectedSequence = [
  'actual_external_delivery_readback',
  'selector',
  'before_program_status_evaluation',
];
const expectedBlockedReason = 'predecessor remains contract-only; runtime owner, implementation Task and independent Gate are not assigned';

describe('external delivery selector runtime successor planning contract', () => {
  it('keeps Story, Architecture and Spec in planning-only blocked order', async () => {
    const [story, architecture, specMarkdown, spec] = await Promise.all([
      readText(successorStoryPath),
      readText(successorArchitecturePath),
      readText(successorSpecMarkdownPath),
      readJson(successorSpecJsonPath),
    ]);

    assert.match(story, new RegExp(`story_id: ${successorStoryId}`));
    assert.match(story, /status: planned/);
    assert.match(story, new RegExp(`predecessor: ${predecessorStoryId}`));
    assert.match(story, /planning_only: true/);
    assert.match(story, /blocked: true/);
    assert.match(story, /production_evidence: not_collected/);
    assert.match(story, /done: false/);
    assert.match(story, /actual external delivery readback[\s\S]*selector[\s\S]*Program status/);

    assert.match(architecture, /planning-only architecture/);
    assert.match(architecture, /actual external delivery readback[\s\S]*selector[\s\S]*before Program status evaluation/);
    assert.match(architecture, /fail-closed[\s\S]*`needs_review`/);
    assert.match(architecture, /no automatic promotion/);
    assert.match(architecture, /successor runtime owner: 未割当/);

    assert.match(specMarkdown, /lifecycle: `planning_only`/);
    assert.match(specMarkdown, /blocked: `true`/);
    assert.match(specMarkdown, /actual_readback -> selector -> before_program_status_evaluation/);
    assert.match(specMarkdown, /fail-closed.*`needs_review`/s);
    assert.match(specMarkdown, /production evidence: `not_collected`/);

    assert.equal(spec.story_id, successorStoryId);
    assert.equal(spec.predecessor_story_id, predecessorStoryId);
    assert.equal(spec.lifecycle, 'planning_only');
    assert.equal(spec.spec_status, 'planned');
    assert.equal(spec.implementation_status, 'blocked');
    assert.equal(spec.planning_only, true);
    assert.equal(spec.blocked, true);
    assert.deepEqual(spec.blocked_by, [predecessorStoryId]);
    assert.equal(spec.production_evidence, 'not_collected');
    assert.equal(spec.done, false);
    assert.deepEqual(spec.selector_contract.sequence, expectedSequence);
    assert.equal(spec.selector_contract.failure_surface, 'fail_closed_reconciliation_gate_needs_review');
    assert.equal(spec.selector_contract.automatic_promotion, false);
  });

  it('binds the planning Task to five clauses without admitting runtime paths', async () => {
    const [spec, task, acceptedTask] = await Promise.all([
      readJson(successorSpecJsonPath),
      readJson(successorTaskPath),
      readJson(successorAcceptedTaskPath),
    ]);
    const expectedAcceptanceCriteria = ['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005'];

    assert.equal(task.task_id, 'program-external-delivery-selector-runtime-integration-v1');
    assert.equal(task.story_id, successorStoryId);
    assert.equal(task.status, 'blocked');
    assert.equal(task.planning_only, true);
    assert.equal(task.blocked, true);
    assert.equal(task.done, false);
    assert.equal(task.runtime_evidence, 'not_collected');
    assert.equal(task.production_evidence, 'not_collected');
    assert.deepEqual(task.selector_contract.sequence, expectedSequence);
    assert.equal(task.selector_contract.automatic_promotion, false);
    assert.equal(task.blocked_by[0].story_id, predecessorStoryId);
    assert.equal(task.blocked_by[0].reason, expectedBlockedReason);
    assert.equal(task.scope.allowed.some((path) => path.includes('scripts/program/')), false);
    assert.equal(task.scope.forbidden.includes('selector runtime implementation'), true);
    assert.equal(task.scope.forbidden.includes('production readback or automatic Program status promotion'), true);

    assert.equal(acceptedTask.story_id, successorStoryId);
    assert.equal(acceptedTask.predecessor_story_id, predecessorStoryId);
    assert.equal(acceptedTask.planning_only, true);
    assert.equal(acceptedTask.blocked, true);
    assert.equal(acceptedTask.production_evidence, 'not_collected');
    assert.equal(acceptedTask.tasks.length, 1);
    assert.deepEqual(acceptedTask.tasks[0].acceptance_criteria, expectedAcceptanceCriteria);
    assert.equal(acceptedTask.tasks[0].execution_policy, 'planning_only');
    assert.equal(acceptedTask.tasks[0].mutates_repository, false);
    assert.equal(acceptedTask.tasks[0].status, 'blocked');

    assert.deepEqual(
      spec.clauses.flatMap((clause) => clause.origin.story_refs.map((ref) => ref.ac_id)),
      expectedAcceptanceCriteria,
    );
    for (const clause of spec.clauses) {
      assert.ok(Array.isArray(clause.origin.architecture_refs));
      assert.ok(Array.isArray(clause.origin.test_refs));
      assert.ok(clause.origin.test_refs.length > 0);
    }
  });

  it('records successor dependency, blocked state and production boundary on predecessor surfaces', async () => {
    const [predecessorStory, predecessorSpecMarkdown, predecessorSpec, predecessorTask, traceability] = await Promise.all([
      readText(predecessorStoryPath),
      readText(predecessorSpecMarkdownPath),
      readJson(predecessorSpecJsonPath),
      readJson(predecessorTaskPath),
      readJson(predecessorTraceabilityPath),
    ]);

    assert.equal(predecessorStory.includes(successorStoryId), false);
    assert.match(predecessorSpecMarkdown, new RegExp(successorStoryId));
    assert.match(predecessorSpecMarkdown, /successor status: `planned`/);
    assert.match(predecessorSpecMarkdown, /successor lifecycle: `planning_only`/);
    assert.match(predecessorSpecMarkdown, /successor blocked: `true`/);
    assert.match(predecessorSpecMarkdown, /production evidence.*`not_collected`/s);

    for (const surface of [predecessorSpec.successor_dependency, predecessorTask.successor_dependency, traceability.successor_dependency]) {
      assert.equal(surface.story_id, successorStoryId);
      assert.equal(surface.status, 'planned');
      assert.equal(surface.planning_only, true);
      assert.equal(surface.blocked, true);
      assert.equal(surface.production_evidence, 'not_collected');
      assert.equal(surface.done, false);
    }
    assert.equal(predecessorSpec.successor_dependency.predecessor_story_id, predecessorStoryId);
    assert.equal(predecessorTask.successor_dependency.predecessor_story_id, predecessorStoryId);
    assert.equal(traceability.successor_dependency.predecessor_story_id, predecessorStoryId);
    assert.equal(predecessorSpec.successor_dependency.blocked_by, expectedBlockedReason);
    assert.equal(predecessorTask.successor_dependency.blocked_by, expectedBlockedReason);
    assert.equal(traceability.successor_dependency.blocked_by, expectedBlockedReason);
    assert.equal(predecessorTask.status, 'contract_ready');
    assert.equal(predecessorTask.production_evidence, 'not_collected');
    assert.equal(predecessorTask.done, false);
  });
});

async function readText(path) {
  return readFile(path, 'utf8');
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}
