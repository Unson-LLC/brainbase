import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { deliveryIdentity, selectCanonicalDelivery } from '../../scripts/program/reconcile-external-delivery.mjs';

const roadmapPath = 'docs/management/milestones/brainbase-program-master-roadmap.json';
const roadmapMarkdownPath = 'docs/management/milestones/brainbase-program-master-roadmap.md';
const orchestratorPath = 'docs/management/prompts/codex-brainbase-program-orchestrator.md';
const storyPath = 'docs/management/stories/active/story-program-external-delivery-reconciliation-v1.md';
const architecturePath = 'docs/architecture/story-program-external-delivery-reconciliation-v1.md';
const specPath = 'docs/specs/program-external-delivery-reconciliation-v1.md';
const taskPath = 'docs/management/tasks/program-external-delivery-reconciliation-v1.json';
const acceptedSpecInputPath = 'docs/specs/program-external-delivery-reconciliation-v1.json';
const acceptedTaskInputPath = 'docs/management/tasks/program-external-delivery-reconciliation-v1.vibepro.json';
const sourceLockPath = 'contracts/p0-negative-boundary-contract-v1/source-lock.json';
const companionLockPath = 'docs/management/evidence/program-external-delivery-reconciliation-lock-v1.json';
const crossRepoFixturePath = 'tests/fixtures/program-external-delivery-reconciliation/same-pr-number-different-repo.json';
const invalidMergeStateFixturePath = 'tests/fixtures/program-external-delivery-reconciliation/invalid-canonical-merge-state.json';
const generatedFixtureRoot = 'tests/fixtures/program-external-delivery-reconciliation/generated-surfaces';
const preFixGeneratorBindingPath = `${generatedFixtureRoot}/pre-fix-generator-binding.json`;
const canonicalBaseRef = 'origin/develop';
const execFileAsync = promisify(execFile);
const canonicalRole = 'producer_contract_delivery';
const canonicalReviewRoles = {
  planning_spec: ['architecture_boundary', 'product_requirement', 'spec_consistency'],
  gate: ['gate_evidence', 'pr_split_scope', 'release_risk'],
};
const expectedStatuses = [
  'planned',
  'contract_ready',
  'implementing',
  'verified',
  'production_proven',
  'done',
];

async function roadmap() {
  return readJson(roadmapPath);
}

describe('Program external delivery reconciliation contract', () => {
  it('keeps the Program status vocabulary exact and the reconciliation contract incomplete', async () => {
    const value = await roadmap();
    assert.deepEqual(value.status_vocabulary, expectedStatuses);
    assertPartial(value.live_reconciliation.reconciliation_contract, {
      story_id: 'story-program-external-delivery-reconciliation-v1',
      status: 'contract_ready',
      production_evidence: 'not_collected',
    });
    assert.equal(value.rules.docs_only_completion, false);
  });

  it('identifies the canonical A0 producer by repository, PR, role and merge SHA', async () => {
    const value = await roadmap();
    const producer = value.live_reconciliation.artifacts.find(
      (artifact) => artifact.repository === 'Unson-LLC/brainbase-unson'
        && artifact.pull_request === 1302,
    );
    assertPartial(producer, {
      program_id: 'A0',
      role: canonicalRole,
      state: 'MERGED_EXTERNALLY',
      mergeable: 'MERGEABLE',
      merge_state_status: 'CLEAN',
      program_effect: 'contract_delivery_only',
      merge: { sha: 'ad908bce7b90678f9ed7f1c570f808bdf1a500ad' },
      exit_evidence: {
        work_package: 'not_established',
        consumer: 'not_established',
        independent_review: 'not_recorded_here',
        gate: 'not_established',
        production: 'not_collected',
      },
    });
  });

  it('does not promote the stale title-matched open PR to canonical A0 producer', async () => {
    const value = await roadmap();
    const stale = value.live_reconciliation.identity_discrepancies.find(
      (candidate) => candidate.repository === 'Unson-LLC/brainbase-unson'
        && candidate.pull_request === 1283,
    );
    assertPartial(stale, {
      state: 'OPEN',
      role: 'stale_title_matched_candidate',
      supersession_evidence: 'not_collected',
    });
    assert.equal(value.live_reconciliation.artifacts.some(
      (artifact) => artifact.repository === stale.repository
        && artifact.pull_request === stale.pull_request,
    ), false);
  });

  it('binds P0 lineage to the repo-qualified A0 producer without status promotion', async () => {
    const value = await roadmap();
    const sourceLock = await readJson(sourceLockPath);
    const companion = await readJson(companionLockPath);
    const producer = value.live_reconciliation.artifacts.find(
      (artifact) => artifact.repository === companion.external_delivery.repository
        && artifact.pull_request === companion.external_delivery.pull_request
        && artifact.role === companion.external_delivery.role,
    );
    const p0 = value.live_reconciliation.artifacts.find(
      (artifact) => artifact.repository === 'Unson-LLC/brainbase-unson'
        && artifact.pull_request === 1304,
    );
    assert.ok(producer);
    assert.equal(p0.program_effect, 'no_status_promotion');
    assertPartial(companion, {
      authority: 'program_owned_reconciliation_companion',
      canonical_role: canonicalRole,
      source_lock: {
        path: sourceLockPath,
        upstream_repository: sourceLock.upstream.repository,
        upstream_merged_sha: sourceLock.upstream.merged_sha,
      },
      external_delivery: {
        repository: producer.repository,
        pull_request: producer.pull_request,
        role: producer.role,
        merged_sha: producer.merge.sha,
      },
      binding: { program_status_effect: 'none' },
    });
    assertPartial(p0.source_lock_lineage, {
      source_lock_path: sourceLockPath,
      upstream_repository: companion.external_delivery.repository,
      upstream_pull_request: companion.external_delivery.pull_request,
      upstream_role: canonicalRole,
      upstream_merged_sha: companion.external_delivery.merged_sha,
      ancestor_verified: true,
    });
    assert.equal(p0.dependency_debt.includes(
      'A0 contract delivery #1302 does not satisfy A0 work-package, consumer, independent review, Gate or production completion',
    ), true);
  });

  it('rejects the same PR number and role from a different repository', async () => {
    const value = await roadmap();
    const fixture = await readJson(crossRepoFixturePath);
    const companion = await readJson(companionLockPath);
    const expectedIdentity = deliveryIdentity(companion.external_delivery);
    const selected = selectCanonicalDelivery(
      [fixture, ...value.live_reconciliation.artifacts],
      expectedIdentity,
    );
    assert.deepEqual(deliveryIdentity(selected), expectedIdentity);
    assert.notEqual(selected.repository, fixture.repository);
  });

  it('requires all four nonempty identity keys before selecting a canonical delivery', async () => {
    const value = await roadmap();
    const companion = await readJson(companionLockPath);
    const expectedIdentity = deliveryIdentity(companion.external_delivery);
    for (const key of ['repository', 'pull_request', 'role', 'merged_sha']) {
      const partialIdentity = { ...expectedIdentity };
      delete partialIdentity[key];
      assert.throws(
        () => selectCanonicalDelivery(value.live_reconciliation.artifacts, partialIdentity),
        new RegExp(`identity requires nonempty .*invalid: ${key}`),
      );
    }
    for (const [key, valueToReject] of [['repository', ' '], ['role', ''], ['merged_sha', null]]) {
      assert.throws(
        () => selectCanonicalDelivery(
          value.live_reconciliation.artifacts,
          { ...expectedIdentity, [key]: valueToReject },
        ),
        new RegExp(`identity requires nonempty .*invalid: ${key}`),
      );
    }
    for (const pullRequest of [0, -1, 1.5, Number.NaN, '1302', {}, null]) {
      assert.throws(
        () => selectCanonicalDelivery(
          value.live_reconciliation.artifacts,
          { ...expectedIdentity, pull_request: pullRequest },
        ),
        /invalid: pull_request/,
      );
    }
    for (const [key, valueToReject] of [
      ['repository', 1302], ['repository', {}], ['role', 1], ['merged_sha', []],
    ]) {
      assert.throws(
        () => selectCanonicalDelivery(
          value.live_reconciliation.artifacts,
          { ...expectedIdentity, [key]: valueToReject },
        ),
        new RegExp(`invalid: ${key}`),
      );
    }
    for (const malformed of [null, [], 'candidate']) {
      assert.throws(
        () => selectCanonicalDelivery([malformed], expectedIdentity),
        /canonical external delivery candidate\[0\] must be an object/,
      );
    }
    assert.throws(
      () => selectCanonicalDelivery([{ ...expectedIdentity, pull_request: 0 }], expectedIdentity),
      /candidate\[0\] has invalid identity fields: pull_request/,
    );
  });

  it('rejects canonical identity matches without verified merged state and provenance', async () => {
    const fixture = await readJson(invalidMergeStateFixturePath);
    assert.equal(fixture.prior_head, 'fc821b58ed1e4bb6d276ec3ab2cf0ce0861a2764');
    assert.equal(fixture.missing_mergeability_prior_head, 'eb18ed63a0f37e2d554372f85a62b1346d18db0c');
    assert.match(fixture.missing_mergeability_prior_behavior, /accepted canonical identity/);
    assert.deepEqual(deliveryIdentity(fixture.verified_delivery), fixture.expected_identity);
    assert.deepEqual(
      deliveryIdentity(selectCanonicalDelivery([fixture.verified_delivery], fixture.expected_identity)),
      fixture.expected_identity,
    );
    for (const negative of fixture.negative_patches) {
      const candidate = {
        ...fixture.verified_delivery,
        ...negative.patch,
        merge: {
          ...fixture.verified_delivery.merge,
          ...(negative.patch.merge ?? {}),
        },
      };
      for (const key of negative.omit ?? []) delete candidate[key];
      assert.throws(
        () => selectCanonicalDelivery([candidate], fixture.expected_identity),
        new RegExp(`candidate\\[0\\] is not verified merged delivery; invalid: .*${negative.invalid}`),
        negative.id,
      );
    }
  });

  it('keeps Markdown, orchestrator, Story, Architecture, Spec and Task aligned', async () => {
    const [value, companion, markdown, orchestrator, story, architecture, spec, task] = await Promise.all([
      roadmap(),
      readJson(companionLockPath),
      readFile(roadmapMarkdownPath, 'utf8'),
      readFile(orchestratorPath, 'utf8'),
      readFile(storyPath, 'utf8'),
      readFile(architecturePath, 'utf8'),
      readFile(specPath, 'utf8'),
      readJson(taskPath),
    ]);
    const companionPath = value.live_reconciliation.reconciliation_contract.companion_lock_path;
    assert.equal(companionPath, companionLockPath);
    const identity = companion.external_delivery;
    const identityTokens = [
      identity.repository,
      String(identity.pull_request),
      identity.role,
      identity.merged_sha,
    ];
    for (const surface of [markdown, orchestrator, story, architecture, spec]) {
      for (const token of identityTokens) assert.match(surface, new RegExp(token));
    }
    assert.match(markdown, /外部deliveryの事実.*昇格する証拠ではない/);
    assert.match(orchestrator, /外部merge.*Program status判定と分離/);
    assert.match(orchestrator, /docs merge.*昇格させない/);
    assert.match(story, /production_evidence: not_collected/);
    assert.match(story, /done: false/);
    assert.match(architecture, /`mergeable=MERGEABLE`.*`merge_state_status=CLEAN`/);
    assert.match(spec, /`mergeable=MERGEABLE`.*`merge_state_status=CLEAN`/);
    assert.equal(task.status, 'contract_ready');
    assert.equal(task.production_evidence, 'not_collected');
    assert.equal(task.done, false);
    assert.deepEqual(task.canonical_identity, deliveryIdentity(identity));
    assert.equal(task.scope.allowed.includes(companionLockPath), true);
    assert.equal(task.scope.allowed.includes('tests/fixtures/program-external-delivery-reconciliation/**'), true);
    assert.equal(task.scope.allowed.includes('docs/specs/program-external-delivery-reconciliation-v1.json'), true);
    assert.equal(task.scope.allowed.includes('docs/management/tasks/program-external-delivery-reconciliation-v1.vibepro.json'), true);
  });

  it('binds accepted Spec and Task inputs to every Story acceptance criterion', async () => {
    const [acceptedSpec, acceptedTasks, task] = await Promise.all([
      readJson(acceptedSpecInputPath),
      readJson(acceptedTaskInputPath),
      readJson(taskPath),
    ]);
    assert.equal(acceptedSpec.story_id, 'story-program-external-delivery-reconciliation-v1');
    assert.deepEqual(
      acceptedSpec.clauses.flatMap((clause) => clause.origin.story_refs.map((ref) => ref.ac_id)),
      ['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005', 'AC-006', 'AC-007', 'AC-008'],
    );
    for (const clause of acceptedSpec.clauses) {
      assert.ok(clause.origin.code_refs.length > 0);
      assert.ok(clause.origin.test_refs.length > 0);
    }
    assert.equal(acceptedTasks.story_id, acceptedSpec.story_id);
    assert.deepEqual(
      acceptedTasks.tasks[0].acceptance_criteria,
      ['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005', 'AC-006', 'AC-007', 'AC-008'],
    );
    const expandedLifecycleAllowed = task.scope.allowed.flatMap((path) => (
      path === '.vibepro/** story-scoped artifacts'
        ? [
            '.vibepro/pr/story-program-external-delivery-reconciliation-v1/**',
            '.vibepro/spec/story-program-external-delivery-reconciliation-v1/**',
            '.vibepro/stories/story-program-external-delivery-reconciliation-v1/tasks/**',
          ]
        : [path]
    ));
    assert.deepEqual(
      [...expandedLifecycleAllowed].sort(),
      [...acceptedTasks.tasks[0].allowed_paths].sort(),
    );
  });

  it('rejects contradictory generated PR, traceability, summary and gate surfaces', async () => {
    const [acceptedSpec, acceptedTasks, lifecycle, preFix, current] = await Promise.all([
      readJson(acceptedSpecInputPath),
      readJson(acceptedTaskInputPath),
      readJson(taskPath),
      readGeneratedSurfaces('pre-fix'),
      readGeneratedSurfaces('current'),
    ]);

    assert.throws(
      () => assertGeneratedAuthoritySurfaces(preFix, { acceptedSpec, acceptedTasks, lifecycle }),
      /accepted spec|accepted task|AC-001|PR body|summary/,
    );
    assert.doesNotThrow(
      () => assertGeneratedAuthoritySurfaces(current, { acceptedSpec, acceptedTasks, lifecycle }),
    );

    const contradictoryReview = structuredClone(current);
    contradictoryReview.planningReview.status = 'done';
    assert.throws(
      () => assertGeneratedAuthoritySurfaces(
        contradictoryReview,
        { acceptedSpec, acceptedTasks, lifecycle },
      ),
      /planning review synthesis differs/,
    );

    const contradictoryGate = structuredClone(current);
    contradictoryGate.gateReview.roles = [];
    assert.throws(
      () => assertGeneratedAuthoritySurfaces(
        contradictoryGate,
        { acceptedSpec, acceptedTasks, lifecycle },
      ),
      /gate review roles differ/,
    );

    const incompletePlanningReview = structuredClone(current);
    incompletePlanningReview.planningReview.roles = incompletePlanningReview.planningReview.roles.filter(
      (role) => role.role === 'architecture_boundary',
    );
    assert.throws(
      () => assertGeneratedAuthoritySurfaces(
        incompletePlanningReview,
        { acceptedSpec, acceptedTasks, lifecycle },
      ),
      /planning review roles differ/,
    );
  });

  it('records the pre-fix stale-base generator failure against the prior HEAD', async () => {
    const proof = await readJson(preFixGeneratorBindingPath);
    assert.deepEqual(proof, {
      prior_head_sha: '825563fccaa113798274c092da6e90d1a9b59b5c',
      stale_base_ref: 'develop',
      canonical_base_ref: canonicalBaseRef,
      generated_changed_files: 427,
      canonical_changed_files: 25,
      unrelated_changed_files: 402,
      prior_standard_regression: 'skipped_without_VIBEPRO_LIVE_SURFACE_ROOT',
    });
  });

  it('executes and binds live VibePro generator artifacts to the canonical remote projection', async () => {
    for (const [stage, roles] of Object.entries(canonicalReviewRoles)) {
      await execFileAsync('vibepro', [
        'review', 'prepare', '.', '--id', 'story-program-external-delivery-reconciliation-v1',
        '--stage', stage, ...roles.flatMap((role) => ['--role', role]), '--json',
      ], { env: childProcessEnv(), maxBuffer: 16 * 1024 * 1024 });
    }
    await execFileAsync('vibepro', [
      'pr', 'prepare', '.', '--story-id', 'story-program-external-delivery-reconciliation-v1',
      '--base', canonicalBaseRef, '--head', 'HEAD', '--json',
    ], { env: childProcessEnv(), maxBuffer: 16 * 1024 * 1024 });
    const [acceptedSpec, acceptedTasks, lifecycle, live] = await Promise.all([
      readJson(acceptedSpecInputPath),
      readJson(acceptedTaskInputPath),
      readJson(taskPath),
      readLiveGeneratedSurfaces('.'),
    ]);
    assert.doesNotThrow(
      () => assertGeneratedAuthoritySurfaces(live, { acceptedSpec, acceptedTasks, lifecycle }),
    );
    await assertCanonicalGitProjection(live.preparation);
  });
});

function assertGeneratedAuthoritySurfaces({
  preparation,
  traceability,
  prBody,
  planningReview,
  gateReview,
}, authorities) {
  const failures = [];
  const expectedIds = authorities.acceptedSpec.clauses.flatMap(
    (clause) => clause.origin.story_refs.map((ref) => ref.ac_id),
  );
  const traceabilityById = new Map(
    traceability.acceptance_criteria.map((criterion) => [criterion.id, criterion]),
  );
  const expectedSummary = {
    clause_count: authorities.acceptedSpec.clauses.length,
    acceptance_criteria_count: expectedIds.length,
    mapped_count: expectedIds.length,
    weakly_mapped_count: 0,
    unmapped_count: 0,
  };

  if (!preparation.spec?.present) failures.push('accepted spec missing');
  if (!preparation.task_authorities?.accepted?.present) failures.push('accepted task missing');
  if (preparation.spec?.clause_count !== authorities.acceptedSpec.clauses.length) {
    failures.push('accepted spec clause count differs from source');
  }
  if (preparation.task_authorities?.accepted?.task_count !== authorities.acceptedTasks.tasks.length) {
    failures.push('accepted task count differs from source');
  }
  for (const id of expectedIds) {
    const clause = traceabilityById.get(id);
    if (clause?.status !== 'mapped') failures.push(`${id} is not mapped`);
    if (clause?.mapping_source !== 'accepted_spec' || clause?.lineage_status !== 'resolved') {
      failures.push(`${id} accepted Spec lineage is unresolved`);
    }
    if (!prBody.includes(`[mapped] ${id}:`)) failures.push(`PR body omits mapped ${id}`);
  }
  for (const [key, expected] of Object.entries(expectedSummary)) {
    if (traceability.coverage_summary?.[key] !== expected) failures.push(`traceability summary ${key} differs`);
    if (preparation.traceability?.summary?.[key] !== expected) failures.push(`PR summary ${key} differs`);
  }
  if (traceability.accepted_spec_lineage?.status !== 'resolved') failures.push('accepted spec lineage unresolved');
  if (preparation.traceability?.accepted_spec_lineage?.status !== 'resolved') failures.push('PR accepted spec lineage unresolved');
  if (/no accepted spec found/i.test(prBody)) failures.push('PR body rejects accepted spec');
  if (!/accepted spec present .*8 clause/i.test(prBody)) failures.push('PR body omits accepted spec authority');
  if (!/受理済みauthority: 1件 \(accepted=1\)/.test(prBody)) failures.push('PR body omits accepted task authority');
  if ((preparation.blocking_reasons ?? []).some((reason) => /accepted_spec|accepted_task|traceability/i.test(reason))) {
    failures.push('gate contradicts accepted authority');
  }
  if (preparation.review?.status !== preparation.gate_status || preparation.gate_status !== 'needs_review') {
    failures.push('review and gate synthesis differ');
  }
  const storyId = authorities.acceptedSpec.story_id;
  if (planningReview.story_id !== storyId
    || planningReview.stage !== 'planning_spec'
    || !['pass', 'needs_review', 'needs_changes', 'block'].includes(planningReview.status)) {
    failures.push('planning review synthesis differs');
  }
  if (gateReview.story_id !== storyId
    || gateReview.stage !== 'gate'
    || !['pass', 'needs_review', 'needs_changes', 'block'].includes(gateReview.status)) {
    failures.push('gate review synthesis differs');
  }
  assertExactRoleSet(
    planningReview.roles,
    canonicalReviewRoles.planning_spec,
    'planning review roles differ',
    failures,
  );
  assertReviewSynthesis(preparation, planningReview, failures);
  assertReviewSynthesis(preparation, gateReview, failures);
  assertExactRoleSet(
    gateReview.roles,
    canonicalReviewRoles.gate,
    'gate review roles differ',
    failures,
  );
  assertPartial(authorities.lifecycle, {
    status: 'contract_ready',
    production_evidence: 'not_collected',
    done: false,
  });
  if (/\b(?:program )?status:\s*(?:verified|production_proven|done)\b|\bdone:\s*true\b|production_evidence:\s*(?!not_collected)\S+/i.test(prBody)) {
    failures.push('PR body promotes lifecycle');
  }
  assert.deepEqual(failures, []);
}

function assertReviewSynthesis(preparation, summary, failures) {
  if (!preparation.git) return;
  const expectedHead = preparation.git?.head_sha;
  if (!expectedHead || summary.current_git_context?.head_sha !== expectedHead) {
    failures.push(`${summary.stage} review summary is not bound to current HEAD`);
  }
  const preparedStage = preparation.review?.stages?.find((stage) => stage.stage === summary.stage);
  if (!preparedStage || preparedStage.status !== summary.status) {
    failures.push(`${summary.stage} review status differs from PR prepare`);
    return;
  }
  const detailsByRole = new Map((preparedStage.role_details ?? []).map((role) => [role.role, role]));
  for (const role of summary.roles ?? []) {
    const expectedEffective = role.stale ? 'stale' : role.status;
    if (role.effective_status !== expectedEffective) {
      failures.push(`${summary.stage}/${role.role} effective status is inconsistent`);
    }
    if ((role.content_binding?.missing_files ?? []).length > 0 && !role.stale) {
      failures.push(`${summary.stage}/${role.role} missing content is not stale`);
    }
    const preparedRole = detailsByRole.get(role.role);
    if (!preparedRole
      || preparedRole.effective_status !== role.effective_status
      || (preparedRole.binding_status ?? null) !== (role.binding_status ?? null)) {
      failures.push(`${summary.stage}/${role.role} differs from PR prepare`);
    }
  }
  const requiresReview = (summary.roles ?? []).some(
    (role) => role.effective_status !== 'pass',
  );
  if (summary.status !== (requiresReview ? 'needs_review' : 'pass')) {
    failures.push(`${summary.stage} review aggregate status is inconsistent`);
  }
}

function childProcessEnv() {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...env } = process.env;
  return env;
}

async function assertCanonicalGitProjection(preparation) {
  assert.equal(preparation.git?.base_ref, canonicalBaseRef);
  assert.equal(preparation.git?.head_ref, 'HEAD');
  const { stdout } = await execFileAsync(
    'git', ['diff', '--name-status', `${canonicalBaseRef}...HEAD`],
  );
  const expected = stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [status, ...pathParts] = line.split('\t');
    return { status, path: pathParts.at(-1) };
  });
  assert.deepEqual(preparation.git.changed_files, expected);
}

async function readGeneratedSurfaces(name) {
  const root = `${generatedFixtureRoot}/${name}`;
  const [preparation, traceability, prBody, planningReview, gateReview] = await Promise.all([
    readJson(`${root}/pr-prepare.json`),
    readJson(`${root}/traceability.json`),
    readFile(`${root}/pr-body.md`, 'utf8'),
    readJson(`${root}/planning-review-summary.json`),
    readJson(`${root}/gate-review-summary.json`),
  ]);
  return { preparation, traceability, prBody, planningReview, gateReview };
}

async function readLiveGeneratedSurfaces(repoRoot) {
  const storyId = 'story-program-external-delivery-reconciliation-v1';
  const prRoot = `${repoRoot}/.vibepro/pr/${storyId}`;
  const reviewRoot = `${repoRoot}/.vibepro/reviews/${storyId}`;
  const [preparation, traceability, prBody, planningReview, gateReview] = await Promise.all([
    readJson(`${prRoot}/pr-prepare.json`),
    readJson(`${prRoot}/traceability.json`),
    readFile(`${prRoot}/pr-body.md`, 'utf8'),
    readJson(`${reviewRoot}/planning_spec/review-summary.json`),
    readJson(`${reviewRoot}/gate/review-summary.json`),
  ]);
  return { preparation, traceability, prBody, planningReview, gateReview };
}

function assertExactRoleSet(roles, expected, message, failures) {
  const actual = (roles ?? []).map((entry) => entry.role).sort();
  if (!Array.isArray(roles) || actual.length !== expected.length
    || actual.some((role, index) => role !== [...expected].sort()[index])) {
    failures.push(message);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertPartial(actual, expected) {
  assert.ok(actual && typeof actual === 'object');
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      assertPartial(actualValue, expectedValue);
    } else {
      assert.deepEqual(actualValue, expectedValue);
    }
  }
}
