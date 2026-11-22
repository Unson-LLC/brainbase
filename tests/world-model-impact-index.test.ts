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
  createWorldModelImpactIndex,
  formatWorldModelDependencyPath,
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

function makeVariable(id: string, revision = '1'): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision,
    meaning: `Variable ${id}`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: defaultAcl,
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
): ModelDefinition {
  return {
    id,
    type: 'model',
    revision,
    meaning: `Model ${id}`,
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: defaultAcl,
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
): JudgmentProblemSnapshot {
  return {
    snapshot_version: 'judgment-problem-snapshot.v1',
    problem_id: problemId,
    revision: '1',
    question: `Question for ${problemId}`,
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
): ImpactReviewPlan {
  return {
    plan_id: planId,
    owner_scope: { type: 'project', id: 'project-1' },
    read_policy: defaultAcl,
    problem_snapshot: {
      snapshot_id: sha256(`snapshot:${problemId}`),
      problem_id: problemId,
      revision: '1',
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
