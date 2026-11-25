import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CompanyOsImpactReviewCoordinator,
  createCompanyOsImpactReviewDurableWaitPort,
  createCompanyOsImpactReviewNotificationStore,
  type ImpactReviewChange,
  type ImpactReviewPlan,
  type ImpactReviewReference,
} from '../src/company-os-impact-review.js';
import { DurableWaitStore } from '../src/durable-waits.js';
import { createEmptyFoundationCatalog, digestFoundationDefinition, foundationKey } from '../src/foundation-catalog.js';
import type { JudgmentProblemSnapshot } from '../src/judgment-problem-snapshot.js';
import type {
  ConstraintDefinition,
  FoundationAcl,
  FoundationDefinition,
  FoundationRelationReference,
  FoundationScope,
  ModelDefinition,
  ObjectiveDefinition,
  VariableDefinition,
} from '../src/ontology-foundation.js';
import type { FoundationCatalog } from '../src/types.js';
import {
  analyzeWorldModelImpact,
  compareRevisionStrings,
  createWorldModelImpactIndex,
  formatWorldModelDependencyPath,
  REDACTED_WORLD_MODEL_REF_LABEL,
  WORLD_MODEL_IMPACT_INDEX_VERSION,
} from '../src/world-model-impact-index.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const defaultScope: FoundationScope = {
  subjectIds: ['project-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z',
};

const defaultAcl: FoundationAcl = {
  ownerId: 'person-1',
  visibility: 'private',
  readerIds: ['person-2'],
  writerIds: [],
};

function sha256(seed: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(seed, 'utf8').digest('hex')}`;
}

function makeVariable(id: string, revision = '1', acl: FoundationAcl = defaultAcl): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision,
    meaning: `Variable ${id}`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'test-src', sourceKind: 'document', evidenceIds: [] }],
    scope: defaultScope,
    subject: 'project-1/ops',
    valueKind: 'number',
    unit: 'count',
    aggregation: 'sum',
    granularity: 'day',
    measurementMethod: 'daily aggregation',
  };
}

function makeModel(
  id: string,
  inputs: readonly string[],
  outputs: readonly string[],
  revision = '1',
  acl: FoundationAcl = defaultAcl,
): ModelDefinition {
  return {
    id,
    type: 'model',
    revision,
    meaning: `Model ${id}`,
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'test-src', sourceKind: 'document', evidenceIds: [] }],
    scope: defaultScope,
    inputVariableRefs: inputs.map((varId) => ({ id: varId, type: 'variable', revision: '1' })),
    outputVariableRefs: outputs.map((varId) => ({ id: varId, type: 'variable', revision: '1' })),
    applicability: defaultScope,
    relationship: `${inputs.join(', ')} -> ${outputs.join(', ')}`,
    uncertainty: 'Needs empirical confirmation',
    validationState: 'unverified',
  };
}

function makeObjective(id: string, variableIds: readonly string[], revision = '1'): ObjectiveDefinition {
  return {
    id,
    type: 'objective',
    revision,
    meaning: `Objective ${id}`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: defaultAcl,
    storage: 'ontology',
    provenance: [{ sourceId: 'test-src', sourceKind: 'document', evidenceIds: [] }],
    scope: defaultScope,
    beneficiaryIds: ['project-1'],
    desiredState: `Keep ${id} on target`,
    criteria: variableIds.map((varId) => ({
      variableRef: { id: varId, type: 'variable', revision: '1' },
      operator: 'at_most',
      target: 100,
    })),
    evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-12-31T23:59:59.000Z' },
  };
}

function makeConstraint(id: string, appliesTo: readonly string[], revision = '1'): ConstraintDefinition {
  return {
    id,
    type: 'constraint',
    revision,
    meaning: `Constraint ${id}`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: defaultAcl,
    storage: 'ontology',
    provenance: [{ sourceId: 'test-src', sourceKind: 'document', evidenceIds: [] }],
    scope: defaultScope,
    condition: 'Must remain within SLA budget',
    appliesTo,
    exceptions: [],
    adoptionBasis: [{ id: 'decision-1', type: 'decision', revision: '1' }],
  };
}

function makeCatalog(
  definitions: readonly FoundationDefinition[],
  relations: readonly FoundationRelationReference[] = [],
): FoundationCatalog {
  const catalog = createEmptyFoundationCatalog();
  for (const definition of definitions) {
    const digest = digestFoundationDefinition(definition);
    catalog.records.push({ definition, digest });
    catalog.latest[foundationKey(definition)] = {
      id: definition.id,
      type: definition.type,
      revision: definition.revision,
    };
  }
  catalog.relations.push(...relations);
  return catalog;
}

function makeSnapshot(
  problemId: string,
  refs: readonly { kind: 'model' | 'variable' | 'objective' | 'constraint'; id: string; revision?: string }[],
  acl: FoundationAcl = defaultAcl,
  revision = '1',
): JudgmentProblemSnapshot {
  return {
    snapshot_version: 'judgment-problem-snapshot.v1',
    problem_id: problemId,
    revision,
    question: `Question for ${problemId}@${revision}`,
    owner_scope: { type: 'project', id: 'project-1' },
    references: refs.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      revision: ref.revision ?? '1',
      digest: sha256(`${ref.kind}:${ref.id}:${ref.revision ?? '1'}`),
      scope: { type: 'project', id: 'project-1' },
      valid_from: '2026-01-01T00:00:00.000Z',
    })),
    read_policy: acl,
    execution_permission: 'none',
    created_at: '2026-06-01T00:00:00.000Z',
  };
}

function makePlan(
  planId: string,
  problemId: string,
  overrides: Partial<ImpactReviewPlan> = {},
  snapshotRevision = '1',
): ImpactReviewPlan {
  return {
    plan_id: planId,
    owner_scope: { type: 'project', id: 'project-1' },
    read_policy: defaultAcl,
    problem_snapshot: {
      snapshot_id: sha256(`snapshot:${problemId}:${snapshotRevision}`),
      problem_id: problemId,
      revision: snapshotRevision,
    },
    run_id: `run-${planId}`,
    execution_state: 'planned',
    authority_state: 'valid',
    constraint_state: 'valid',
    responsible: { principal: 'person-2', scope: 'project-1' },
    due_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('analyzeWorldModelImpact', () => {
  it('traces direct and multi-hop world-model dependencies deterministically across variables, models, objectives, snapshots, and plans', () => {
    const varIn = makeVariable('var-demand');
    const varMid = makeVariable('var-handling-time');
    const varOut = makeVariable('var-sla-breach');
    const modelUpstream = makeModel('model-automation', ['var-demand'], ['var-handling-time']);
    const modelDownstream = makeModel('model-staffing', ['var-handling-time'], ['var-sla-breach']);
    const objectiveSla = makeObjective('objective-sla', ['var-sla-breach']);
    const snapshot = makeSnapshot('problem-q3-staffing', [{ kind: 'objective', id: 'objective-sla' }]);
    const activePlan = makePlan('plan-q3-staffing', 'problem-q3-staffing');
    const catalog = makeCatalog([varIn, varMid, varOut, modelUpstream, modelDownstream, objectiveSla]);

    const analysis = analyzeWorldModelImpact({
      catalog,
      snapshots: [snapshot],
      plans: [activePlan],
      changedRefs: [{ kind: 'variable', id: 'var-demand', revision: '2' }],
    });

    expect(analysis.version).toBe(WORLD_MODEL_IMPACT_INDEX_VERSION);
    expect(analysis.cyclesDetected).toBe(0);
    expect(analysis.affectedModels.map((item) => item.affectedRef.id)).toEqual([
      'model-automation',
      'model-staffing',
    ]);
    expect(analysis.affectedObjectives.map((item) => item.affectedRef.id)).toEqual(['objective-sla']);
    expect(analysis.affectedSnapshots.map((item) => item.affectedRef.id)).toEqual(['problem-q3-staffing']);
    expect(analysis.affectedPlans).toHaveLength(1);

    const planItem = analysis.affectedPlans[0]!;
    expect(planItem.status).toBe('needs_review');
    expect(planItem.affectedRef).toEqual({ kind: 'plan', id: 'plan-q3-staffing' });
    expect(planItem.depth).toBe(7);
    expect(planItem.dependencyPath.map((step) => step.relation)).toEqual([
      'uses_as_input',
      'predicts',
      'uses_as_input',
      'predicts',
      'evaluated_by',
      'snapshot_reference',
      'plan_reference',
    ]);
    expect(planItem.reason).toContain('needs_review:');
    expect(formatWorldModelDependencyPath(planItem.dependencyPath)).toContain('model/model-staffing@1');

    // Deterministic output regardless of input ordering.
    const reversedCatalog = makeCatalog([objectiveSla, modelDownstream, modelUpstream, varOut, varMid, varIn]);
    const reversedAnalysis = analyzeWorldModelImpact({
      catalog: reversedCatalog,
      snapshots: [snapshot],
      plans: [activePlan],
      changedRefs: [{ kind: 'variable', id: 'var-demand', revision: '2' }],
    });
    expect(reversedAnalysis).toEqual(analysis);
  });

  it('prevents infinite loops on cyclic world-model feedback graphs while enumerating reachable dependents', () => {
    const varA = makeVariable('var-a');
    const varB = makeVariable('var-b');
    const varC = makeVariable('var-c');
    // Feedback cycle: model-1 -> var-a -> model-2 -> var-b -> model-1, plus branch var-b -> model-3 -> var-c
    const model1 = makeModel('model-1', ['var-b'], ['var-a']);
    const model2 = makeModel('model-2', ['var-a'], ['var-b']);
    const model3 = makeModel('model-3', ['var-b'], ['var-c']);
    const catalog = makeCatalog([varA, varB, varC, model1, model2, model3]);

    const analysis = analyzeWorldModelImpact({
      catalog,
      changedRefs: [{ kind: 'model', id: 'model-1', revision: '2' }],
    });

    expect(analysis.cyclesDetected).toBeGreaterThanOrEqual(1);
    expect(analysis.affectedModels.map((item) => item.affectedRef.id)).toEqual(['model-2', 'model-3']);
    expect(analysis.affectedItems.some((item) => item.affectedRef.id === 'model-1')).toBe(false);
    expect(analysis.affectedModels.find((item) => item.affectedRef.id === 'model-2')?.depth).toBe(2);
    expect(analysis.affectedModels.find((item) => item.affectedRef.id === 'model-3')?.depth).toBe(4);
  });

  it('does not misclassify a diamond DAG as a cycle', () => {
    const varRoot = makeVariable('var-root');
    const varShared = makeVariable('var-shared');
    const modelLeft = makeModel('model-left', ['var-root'], ['var-shared']);
    const modelRight = makeModel('model-right', ['var-root'], ['var-shared']);
    const catalog = makeCatalog([varRoot, varShared, modelLeft, modelRight]);

    const analysis = analyzeWorldModelImpact({
      catalog,
      changedRefs: [{ kind: 'variable', id: 'var-root', revision: '2' }],
    });

    expect(analysis.cyclesDetected).toBe(0);
    expect(analysis.affectedModels.map((item) => item.affectedRef.id)).toEqual(['model-left', 'model-right']);
    expect(analysis.affectedItems.filter((item) => item.affectedRef.id === 'var-shared')).toHaveLength(1);
  });

  it('traverses explicit foundation.relations including used_as_basis and applies_to', () => {
    const varCost = makeVariable('var-cost');
    const modelCost = makeModel('model-cost', [], []);
    const constraintCap = makeConstraint('constraint-cap', ['model-cost']);
    const relations: FoundationRelationReference[] = [
      {
        relation: 'predicts',
        source: { id: 'model-cost', type: 'model', revision: '1' },
        target: { id: 'var-cost', type: 'variable', revision: '1' },
      },
      {
        relation: 'used_as_basis',
        source: { id: 'problem-budget', type: 'judgment_problem', revision: '1' },
        target: { id: 'var-cost', type: 'variable', revision: '1' },
      },
    ];
    const catalog = makeCatalog([varCost, modelCost, constraintCap], relations);
    const planBudget = makePlan('plan-budget', 'problem-budget');

    const analysis = analyzeWorldModelImpact({
      catalog,
      plans: [planBudget],
      changedRefs: [{ kind: 'constraint', id: 'constraint-cap', revision: '2' }],
    });

    expect(analysis.affectedModels.map((item) => item.affectedRef.id)).toEqual(['model-cost']);
    expect(analysis.affectedPlans.map((item) => item.affectedRef.id)).toEqual(['plan-budget']);
    expect(analysis.affectedPlans[0]?.dependencyPath.map((step) => step.relation)).toEqual([
      'applies_to',
      'predicts',
      'used_as_basis',
      'plan_reference',
    ]);
  });

  it('uses catalog.latest pointer as authoritative and compares r9 vs r10 numerically in fallback', () => {
    expect(compareRevisionStrings('r9', 'r10')).toBeLessThan(0);
    expect(compareRevisionStrings('9', '10')).toBeLessThan(0);

    // Fallback when catalog.latest has no pointer: r10 must beat r9 (unlike lexicographic localeCompare).
    const varA = makeVariable('var-a');
    const varB = makeVariable('var-b');
    const varOut = makeVariable('var-out');
    const modelR9 = makeModel('model-ver', ['var-a'], ['var-out'], 'r9');
    const modelR10 = makeModel('model-ver', ['var-b'], ['var-out'], 'r10');
    const catalogNoLatest: FoundationCatalog = {
      version: 1,
      records: [
        { definition: varA, digest: digestFoundationDefinition(varA) },
        { definition: varB, digest: digestFoundationDefinition(varB) },
        { definition: varOut, digest: digestFoundationDefinition(varOut) },
        { definition: modelR9, digest: digestFoundationDefinition(modelR9) },
        { definition: modelR10, digest: digestFoundationDefinition(modelR10) },
      ],
      latest: {},
      relations: [],
    };

    const fromVarB = analyzeWorldModelImpact({
      catalog: catalogNoLatest,
      changedRefs: [{ kind: 'variable', id: 'var-b', revision: '1' }],
    });
    expect(fromVarB.affectedModels.map((item) => [item.affectedRef.id, item.affectedRef.revision])).toEqual([
      ['model-ver', 'r10'],
    ]);
    const fromVarA = analyzeWorldModelImpact({
      catalog: catalogNoLatest,
      changedRefs: [{ kind: 'variable', id: 'var-a', revision: '1' }],
    });
    expect(fromVarA.affectedModels).toEqual([]);

    // Authoritative catalog.latest rollback: when latest points back to revision 1 even though revision 2 exists.
    const modelRev1 = makeModel('model-rolled-back', ['var-a'], ['var-out'], '1');
    const modelRev2 = makeModel('model-rolled-back', ['var-b'], ['var-out'], '2');
    const rolledBackCatalog: FoundationCatalog = {
      version: 1,
      records: [
        { definition: varA, digest: digestFoundationDefinition(varA) },
        { definition: varB, digest: digestFoundationDefinition(varB) },
        { definition: varOut, digest: digestFoundationDefinition(varOut) },
        { definition: modelRev1, digest: digestFoundationDefinition(modelRev1) },
        { definition: modelRev2, digest: digestFoundationDefinition(modelRev2) },
      ],
      latest: {
        [foundationKey(varA)]: { id: varA.id, type: 'variable', revision: '1' },
        [foundationKey(varB)]: { id: varB.id, type: 'variable', revision: '1' },
        [foundationKey(varOut)]: { id: varOut.id, type: 'variable', revision: '1' },
        [foundationKey(modelRev1)]: { id: modelRev1.id, type: 'model', revision: '1' },
      },
      relations: [],
    };

    const rolledBackFromA = analyzeWorldModelImpact({
      catalog: rolledBackCatalog,
      changedRefs: [{ kind: 'variable', id: 'var-a', revision: '1' }],
    });
    expect(rolledBackFromA.affectedModels.map((item) => [item.affectedRef.id, item.affectedRef.revision])).toEqual([
      ['model-rolled-back', '1'],
    ]);
    const rolledBackFromB = analyzeWorldModelImpact({
      catalog: rolledBackCatalog,
      changedRefs: [{ kind: 'variable', id: 'var-b', revision: '1' }],
    });
    expect(rolledBackFromB.affectedModels).toEqual([]);
  });

  it('keeps distinct revisions of the same problem_id isolated during snapshot traversal', () => {
    const var1 = makeVariable('var-1');
    const var2 = makeVariable('var-2');
    const modelOld = makeModel('model-old', ['var-1'], ['var-2']);
    const modelNew = makeModel('model-new', ['var-1'], ['var-2']);
    const catalog = makeCatalog([var1, var2, modelOld, modelNew]);

    const snapshotRev1 = makeSnapshot('problem-shared', [{ kind: 'model', id: 'model-old' }], defaultAcl, '1');
    const snapshotRev2 = makeSnapshot('problem-shared', [{ kind: 'model', id: 'model-new' }], defaultAcl, '2');
    const planRev1 = makePlan('plan-rev1', 'problem-shared', {}, '1');
    const planRev2 = makePlan('plan-rev2', 'problem-shared', {}, '2');

    const impactOld = analyzeWorldModelImpact({
      catalog,
      snapshots: [snapshotRev1, snapshotRev2],
      plans: [planRev1, planRev2],
      changedRefs: [{ kind: 'model', id: 'model-old', revision: '2' }],
    });
    expect(impactOld.affectedSnapshots.map((item) => `${item.affectedRef.id}@${item.affectedRef.revision}`)).toEqual([
      'problem-shared@1',
    ]);
    expect(impactOld.affectedPlans.map((item) => item.affectedRef.id)).toEqual(['plan-rev1']);

    const impactNew = analyzeWorldModelImpact({
      catalog,
      snapshots: [snapshotRev1, snapshotRev2],
      plans: [planRev1, planRev2],
      changedRefs: [{ kind: 'model', id: 'model-new', revision: '2' }],
    });
    expect(impactNew.affectedSnapshots.map((item) => `${item.affectedRef.id}@${item.affectedRef.revision}`)).toEqual([
      'problem-shared@2',
    ]);
    expect(impactNew.affectedPlans.map((item) => item.affectedRef.id)).toEqual(['plan-rev2']);
  });

  it('resolves constraint appliesTo strictly by kind and skips ambiguous bare IDs across kinds', () => {
    const varShared = makeVariable('shared-target');
    const modelShared = makeModel('shared-target', [], []);
    const constraintAmbiguous = makeConstraint('constraint-ambiguous', ['shared-target']);
    const constraintTyped = makeConstraint('constraint-typed', ['model/shared-target', 'judgment_problem/problem-x@1']);
    const snapshotRev1 = makeSnapshot('problem-x', [], defaultAcl, '1');
    const snapshotRev2 = makeSnapshot('problem-x', [], defaultAcl, '2');
    const catalog = makeCatalog([varShared, modelShared, constraintAmbiguous, constraintTyped]);

    const ambiguousImpact = analyzeWorldModelImpact({
      catalog,
      snapshots: [snapshotRev1, snapshotRev2],
      changedRefs: [{ kind: 'constraint', id: 'constraint-ambiguous', revision: '2' }],
    });
    expect(ambiguousImpact.affectedItems).toEqual([]);

    const typedImpact = analyzeWorldModelImpact({
      catalog,
      snapshots: [snapshotRev1, snapshotRev2],
      changedRefs: [{ kind: 'constraint', id: 'constraint-typed', revision: '2' }],
    });
    expect(typedImpact.affectedItems.map((item) => `${item.affectedRef.kind}/${item.affectedRef.id}@${item.affectedRef.revision}`)).toEqual([
      'judgment_problem/problem-x@1',
      'model/shared-target@1',
    ]);
  });
});

describe('WorldModelImpactIndex with CompanyOsImpactReviewCoordinator', () => {
  it('plugs directly into CompanyOsImpactReviewCoordinator to hold affected plans and enforce plan ACLs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-world-model-impact-'));
    dataDirs.push(dataDir);

    const varInput = makeVariable('var-checkins');
    const varMid = makeVariable('var-load');
    const varOutput = makeVariable('var-wait-minutes');
    const model1 = makeModel('model-checkin-load', ['var-checkins'], ['var-load']);
    const model2 = makeModel('model-queue-wait', ['var-load'], ['var-wait-minutes']);
    const catalog = makeCatalog([varInput, varMid, varOutput, model1, model2]);

    const snapshotActive = makeSnapshot('problem-active', [{ kind: 'model', id: 'model-queue-wait' }]);
    const snapshotCompleted = makeSnapshot('problem-completed', [{ kind: 'model', id: 'model-queue-wait' }]);
    const snapshotPrivate = makeSnapshot(
      'problem-private',
      [{ kind: 'model', id: 'model-queue-wait' }],
      { ownerId: 'other-owner', visibility: 'private', readerIds: [], writerIds: [] },
    );
    const snapshotUnrelated = makeSnapshot('problem-unrelated', [{ kind: 'variable', id: 'var-other' }]);

    const planActive = makePlan('plan-active', 'problem-active');
    const planCompleted = makePlan('plan-completed', 'problem-completed', { execution_state: 'completed' });
    const planPrivate = makePlan('plan-private', 'problem-private', {
      read_policy: { ownerId: 'other-owner', visibility: 'private', readerIds: [], writerIds: [] },
    });
    const planUnrelated = makePlan('plan-unrelated', 'problem-unrelated');

    const index = createWorldModelImpactIndex({
      source: {
        catalog,
        snapshots: [snapshotActive, snapshotCompleted, snapshotPrivate, snapshotUnrelated],
        plans: [planActive, planCompleted, planPrivate, planUnrelated],
      },
    });

    const waitStore = new DurableWaitStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
      problemSnapshot: {
        verify: async ({ reference }) => reference.snapshot_id === planActive.problem_snapshot.snapshot_id,
      },
    });
    const notifications = createCompanyOsImpactReviewNotificationStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
    });
    const currentModelRef: ImpactReviewReference = {
      kind: 'model',
      id: 'model-checkin-load',
      revision: '2',
      digest: sha256('model-checkin-load@2'),
      scope: { type: 'project', id: 'project-1' },
    };
    const change: ImpactReviewChange = {
      change_id: 'change-refutation-1',
      source: 'world_model',
      previous: { ...currentModelRef, revision: '1', digest: sha256('model-checkin-load@1') },
      current: currentModelRef,
      significance: 'premise_refuted',
      reason: 'Observed front-desk handoff spikes refuted model-checkin-load@1.',
    };

    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: async () => currentModelRef },
      index,
      notifications,
      waits: createCompanyOsImpactReviewDurableWaitPort(waitStore),
    });

    const review = await coordinator.review({
      access: { principal: 'person-1', scope: { type: 'project', id: 'project-1' } },
      changes: [change],
    });

    expect(review.outcome).toBe('affected');
    expect(review.decisions.map((decision) => [decision.plan.plan_id, decision.disposition])).toEqual([
      ['plan-active', 'hold'],
      ['plan-completed', 'continue'],
    ]);

    const activeDecision = review.decisions[0]!;
    expect(activeDecision.wait_id).toMatch(/^impact-review-/u);
    expect(activeDecision.matches).toHaveLength(1);
    expect(activeDecision.matches[0]).toMatchObject({
      change_id: 'change-refutation-1',
      domain: 'world_model',
      relation: 'predicts',
    });
    expect(activeDecision.matches[0]?.evidence).toContain('model/model-checkin-load@2');
    expect(activeDecision.matches[0]?.evidence).toContain('model/model-queue-wait@1');
    expect(activeDecision.matches[0]?.evidence).toContain('plan/plan-active');

    const storedWait = await waitStore.get({ wait_id: activeDecision.wait_id!, principal: 'person-1' });
    expect(storedWait.state).toBe('waiting');
    expect(await notifications.list()).toHaveLength(2);
  });

  it('redacts unauthorized private intermediate Foundation nodes in findAffectedPlans evidence without missing affected plans', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-world-model-acl-'));
    dataDirs.push(dataDir);

    const sharedAcl: FoundationAcl = {
      ownerId: 'person-1',
      visibility: 'private',
      readerIds: ['person-2'],
      writerIds: ['person-2'],
    };
    const secretAcl: FoundationAcl = {
      ownerId: 'other-owner',
      visibility: 'private',
      readerIds: [],
      writerIds: [],
    };

    const varIn = makeVariable('var-in', '1', sharedAcl);
    const varSecretMid = makeVariable('secret-margin-var', '3', secretAcl);
    const varOut = makeVariable('var-out', '1', sharedAcl);
    const modelEntry = makeModel('model-public-entry', [], ['var-in'], '1', sharedAcl);
    const modelSecret1 = makeModel('secret-pricing-model', ['var-in'], ['secret-margin-var'], '7', secretAcl);
    const modelSecret2 = makeModel('secret-rebate-model', ['secret-margin-var'], ['var-out'], '4', secretAcl);
    const catalog = makeCatalog([varIn, varSecretMid, varOut, modelEntry, modelSecret1, modelSecret2]);

    const snapshotA = makeSnapshot('problem-a', [{ kind: 'variable', id: 'var-out' }], sharedAcl, '1');
    const planA = makePlan('plan-a', 'problem-a', { read_policy: sharedAcl }, '1');

    const index = createWorldModelImpactIndex({
      source: {
        catalog,
        snapshots: [snapshotA],
        plans: [planA],
      },
    });

    const changeRef: ImpactReviewReference = {
      kind: 'model',
      id: 'model-public-entry',
      revision: '2',
      digest: sha256('model-public-entry@2'),
      scope: { type: 'project', id: 'project-1' },
    };
    const change: ImpactReviewChange = {
      change_id: 'change-public-entry',
      source: 'world_model',
      current: changeRef,
      significance: 'material',
      reason: 'Public entry model revised.',
    };

    const affected = await index.findAffectedPlans({
      changes: [change],
      current_references: [changeRef],
      access: { principal: 'person-2', scope: { type: 'project', id: 'project-1' } },
    });

    // (a) plan-a must still be detected for re-review so impact is never silently dropped.
    expect(affected).toHaveLength(1);
    expect(affected[0]?.plan.plan_id).toBe('plan-a');

    // (b) Unauthorized private intermediate nodes (IDs, revisions, kinds, and private hop count) must not leak.
    const serialized = JSON.stringify(affected[0]?.matches);
    expect(serialized).not.toContain('secret-pricing-model');
    expect(serialized).not.toContain('secret-margin-var');
    expect(serialized).not.toContain('secret-rebate-model');
    expect(serialized).not.toContain('@7');
    expect(serialized).not.toContain('@4');
    expect(affected[0]?.matches[0]?.evidence).toContain(REDACTED_WORLD_MODEL_REF_LABEL);
    // Consecutive private nodes collapse into one `<redacted>` segment.
    expect(affected[0]?.matches[0]?.evidence).toBe(
      'model/model-public-entry@2 --[predicts]--> variable/var-in@1 --[redacted]--> <redacted> --[redacted]--> variable/var-out@1 --[snapshot_reference]--> judgment_problem/problem-a@1 --[plan_reference]--> plan/plan-a',
    );

    // Also verify end-to-end inside CompanyOsImpactReviewCoordinator.
    const waitStore = new DurableWaitStore({
      dataDir,
      clock: () => new Date('2026-09-23T00:00:00.000Z'),
      problemSnapshot: {
        verify: async ({ reference }) => reference.snapshot_id === planA.problem_snapshot.snapshot_id,
      },
    });
    const coordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: async () => changeRef },
      index,
      notifications: createCompanyOsImpactReviewNotificationStore({ dataDir }),
      waits: createCompanyOsImpactReviewDurableWaitPort(waitStore),
    });
    const review = await coordinator.review({
      access: { principal: 'person-2', scope: { type: 'project', id: 'project-1' } },
      changes: [change],
    });
    expect(review.outcome).toBe('affected');
    expect(review.decisions[0]?.disposition).toBe('hold');
    expect(JSON.stringify(review)).not.toContain('secret-pricing-model');
    expect(JSON.stringify(review)).not.toContain('secret-margin-var');
  });

  it('redacts unauthorized endpoints traversed through catalog.relations', async () => {
    const sharedAcl: FoundationAcl = {
      ownerId: 'person-1',
      visibility: 'private',
      readerIds: ['person-2'],
      writerIds: ['person-2'],
    };
    const secretAcl: FoundationAcl = {
      ownerId: 'other-owner',
      visibility: 'private',
      readerIds: [],
      writerIds: [],
    };

    const modelPublic = makeModel('model-public', [], [], '1', sharedAcl);
    const secretRelVar = makeVariable('secret-relation-variable', '9', secretAcl);
    const relations: FoundationRelationReference[] = [
      {
        relation: 'predicts',
        source: { id: 'model-public', type: 'model', revision: '1' },
        target: { id: 'secret-relation-variable', type: 'variable', revision: '9' },
      },
      {
        relation: 'used_as_basis',
        source: { id: 'problem-rel', type: 'judgment_problem', revision: '1' },
        target: { id: 'secret-relation-variable', type: 'variable', revision: '9' },
      },
    ];
    const catalog = makeCatalog([modelPublic, secretRelVar], relations);
    const planRel = makePlan('plan-rel', 'problem-rel', { read_policy: sharedAcl }, '1');

    const index = createWorldModelImpactIndex({
      source: {
        catalog,
        plans: [planRel],
      },
    });

    const changeRef: ImpactReviewReference = {
      kind: 'model',
      id: 'model-public',
      revision: '2',
      digest: sha256('model-public@2'),
      scope: { type: 'project', id: 'project-1' },
    };
    const affected = await index.findAffectedPlans({
      changes: [{
        change_id: 'change-rel-1',
        source: 'world_model',
        current: changeRef,
        significance: 'material',
        reason: 'Public model updated.',
      }],
      current_references: [changeRef],
      access: { principal: 'person-2', scope: { type: 'project', id: 'project-1' } },
    });

    expect(affected).toHaveLength(1);
    expect(affected[0]?.plan.plan_id).toBe('plan-rel');
    const match = affected[0]?.matches[0];
    expect(match?.relation).toBe('adopted');
    expect(match?.domain).toBe('world_model');
    expect(match?.evidence).toBe(
      'model/model-public@2 --[redacted]--> <redacted> --[redacted]--> judgment_problem/problem-rel@1 --[plan_reference]--> plan/plan-rel',
    );
    expect(JSON.stringify(affected)).not.toContain('secret-relation-variable');
    expect(JSON.stringify(affected)).not.toContain('@9');
  });

  it('publishes ./world-model-impact-index as a package subpath export', async () => {
    const repoRoot = resolve(import.meta.dirname, '..');
    const manifest = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(manifest.exports['./world-model-impact-index']).toEqual({
      types: './dist/world-model-impact-index.d.ts',
      import: './dist/world-model-impact-index.js',
    });
    const distUrl = pathToFileURL(join(repoRoot, manifest.exports['./world-model-impact-index'].import)).href;
    const loaded = await import(distUrl);
    expect(typeof loaded.analyzeWorldModelImpact).toBe('function');
    expect(typeof loaded.createWorldModelImpactIndex).toBe('function');
    expect(typeof loaded.WorldModelImpactIndex).toBe('function');
  });
});
