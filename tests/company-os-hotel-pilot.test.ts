import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs } from '../src/ssot.js';
import type {
  ConstraintDefinition,
  FoundationAcl,
  FoundationPeriod,
  FoundationRevision,
  FoundationScope,
  ModelDefinition,
  ObjectiveDefinition,
  VariableDefinition,
} from '../src/ontology-foundation.js';
import { createWorldModelStore, type WorldModelObservationInput, type WorldModelValue } from '../src/world-model.js';
import {
  createCompanyOsEvaluationStore,
  createFoundationDefinitionLoadPort,
  type EvaluationMeasurementInput,
  type OutcomeCasePort,
  type OutcomeCaseRead,
} from '../src/company-os-evaluation.js';
import {
  createCompanyOsReceiptAdapter,
  createOutcomeCaseReceiptSourcePort,
  type ReceiptSourceConditions,
} from '../src/company-os-receipt-adapter.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  loadJudgmentProblemSnapshot,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
} from '../src/judgment-problem-snapshot.js';
import { createProblemCandidateStore } from '../src/problem-candidates.js';
import { createProblemSelection, createProblemSelectionRecordStore, evaluateProblemSelectionWithComposition } from '../src/problem-selection.js';
import type { JudgmentDAGCompositionDefinition, JudgmentDAGProblemSnapshotReference } from '../src/judgment-dag-composition.js';
import type { JudgmentDAGJSONValue } from '../src/judgment-dag-runner.js';
import { createResourceReservationExecutionPort, ExecutionAuthorityService, type ExecutionCheckRequest } from '../src/execution-authority.js';
import { createResourceReservationProblemSnapshotPort, ResourceReservationService } from '../src/resource-reservations.js';
import { DurableWaitStore } from '../src/durable-waits.js';
import {
  CompanyOsImpactReviewCoordinator,
  createCompanyOsImpactReviewDurableWaitPort,
  createCompanyOsImpactReviewNotificationStore,
  type ImpactReviewChange,
  type ImpactReviewPlan,
  type ImpactReviewReference,
} from '../src/company-os-impact-review.js';
import {
  createCompanyOsLearningAdoptionStore,
  createCompanyOsLearningEvaluationPort,
  createFoundationLearningTargetPort,
  digestEvaluationRecord,
  type LearningRunReceipt,
  type LearningRunReceiptPort,
  type LearningTargetReference,
} from '../src/company-os-learning-adoption.js';

const dataDirs: string[] = [];
const tenantId = 'tenant-hotel-pilot';
const ownerId = 'owner-1';
const hotelId = 'hotel-alpha';
const period: FoundationPeriod = {
  from: '2026-01-01T00:00:00.000Z',
  until: '2026-12-31T23:59:59.999Z',
};
const scope: FoundationScope = {
  subjectIds: [hotelId],
  validFrom: period.from,
  validUntil: period.until,
};
const acl: FoundationAcl = {
  ownerId,
  visibility: 'private',
  readerIds: [],
  writerIds: [ownerId],
};
const context = { principal: ownerId } as const;

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((dataDir) => rm(dataDir, { recursive: true, force: true })));
});

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function numberValue(value: WorldModelValue): number {
  if (typeof value !== 'number') throw new Error(`Expected numeric world-model value, received ${typeof value}`);
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function learningRunReceiptDigest(receipt: Omit<LearningRunReceipt, 'digest'>): `sha256:${string}` {
  return digest(canonicalize({ ...receipt, digest: '' })) as `sha256:${string}`;
}

function variable(id: string, meaning: string, aggregation: VariableDefinition['aggregation'] = 'sum'): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision: '1',
    meaning,
    epistemicState: 'supported',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'hotel-pilot-fixture', sourceKind: 'observation', evidenceIds: [`evidence-${id}`] }],
    scope,
    subject: 'hotel front desk',
    valueKind: 'number',
    unit: 'minutes',
    aggregation,
    granularity: 'week',
    measurementMethod: 'hotel pilot fixture support-log aggregation',
  };
}

function modelDefinition(inputRefs: readonly FoundationRevision[], outputRef: FoundationRevision): ModelDefinition {
  return {
    id: 'model-hotel-front-desk-load',
    type: 'model',
    revision: '1',
    meaning: 'Predict total front-desk load from direct handling, handoffs, and corrections.',
    epistemicState: 'supported',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'candidate-hotel-pilot-model', sourceKind: 'candidate', evidenceIds: ['evidence-hotel-pilot-model'] }],
    scope,
    inputVariableRefs: inputRefs,
    outputVariableRefs: [outputRef],
    applicability: scope,
    relationship: 'Lower direct handling should reduce total load, while handoffs and corrections add load.',
    uncertainty: 'Handoff and correction rates are fixture estimates until evaluated.',
    validationState: 'supported',
  };
}

function objectiveDefinition(totalRef: FoundationRevision, qualityRef: FoundationRevision, revision = '1'): ObjectiveDefinition {
  return {
    id: 'objective-hotel-front-desk-load',
    type: 'objective',
    revision,
    meaning: 'Reduce front-desk load while preserving answer quality.',
    epistemicState: 'supported',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'hotel-pilot-fixture', sourceKind: 'decision', evidenceIds: ['decision-hotel-pilot-objective'] }],
    scope,
    beneficiaryIds: [hotelId],
    desiredState: 'Total load is at most 100 minutes per week and quality is at least 0.90.',
    criteria: [
      { variableRef: totalRef, operator: 'at_most', target: 100 },
      { variableRef: qualityRef, operator: 'at_least', target: 0.9 },
    ],
    evaluationPeriod: { from: '2026-04-01T00:00:00.000Z', until: '2026-04-30T23:59:59.999Z' },
    accountableId: ownerId,
  };
}

function constraintDefinition(): ConstraintDefinition {
  return {
    id: 'constraint-hotel-no-double-entry',
    type: 'constraint',
    revision: '1',
    meaning: 'One pilot run must use one immutable problem snapshot and one owner.',
    epistemicState: 'supported',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'execution'],
    acl,
    storage: 'ontology',
    provenance: [{ sourceId: 'hotel-pilot-fixture', sourceKind: 'decision', evidenceIds: ['decision-hotel-pilot-constraint'] }],
    scope,
    condition: 'Do not double-enter or change run, snapshot, owner, or tenant during execution.',
    appliesTo: ['hotel-pilot'],
    exceptions: [],
    adoptionBasis: [{ id: 'decision-hotel-pilot-constraint', type: 'decision', revision: '1' }],
  };
}

function observation(
  id: string,
  variableRef: FoundationRevision,
  value: number,
  sourceId: string,
  occurredAt = '2026-04-10T01:00:00.000Z',
): WorldModelObservationInput {
  return {
    id,
    variableRef,
    subjectId: hotelId,
    value,
    occurredAt,
    period: { from: '2026-04-06T00:00:00.000Z', until: '2026-04-12T23:59:59.999Z' },
    recordedAt: '2026-04-11T01:00:00.000Z',
    sourceRef: { sourceId, sourceKind: 'observation', evidenceIds: [`evidence-${id}`] },
  };
}

function snapshotReference(
  kind: JudgmentProblemReference['kind'],
  ref: FoundationRevision & { readonly digest: string },
): JudgmentProblemReference {
  return {
    kind,
    id: ref.id,
    revision: ref.revision,
    digest: ref.digest as `sha256:${string}`,
    scope: { type: 'project', id: hotelId },
    valid_from: period.from,
    valid_to: period.until,
  };
}

function evidenceReference(kind: JudgmentProblemReference['kind'], id: string, value: unknown): JudgmentProblemReference {
  return {
    kind,
    id,
    revision: '1',
    digest: digest(value) as `sha256:${string}`,
    scope: { type: 'project', id: hotelId },
    valid_from: period.from,
    valid_to: period.until,
  };
}

function measurement(
  ref: FoundationRevision & { readonly digest: string },
  definition: VariableDefinition,
  value: number,
): EvaluationMeasurementInput {
  return {
    variableRef: ref,
    descriptor: {
      unit: definition.unit,
      aggregation: definition.aggregation,
      granularity: definition.granularity,
      scope,
      period: { from: '2026-04-01T00:00:00.000Z', until: '2026-04-30T23:59:59.999Z' },
    },
    status: 'observed',
    value,
    recordedAt: '2026-05-01T01:00:00.000Z',
  };
}

function createPilotOutcomeCase(sourceConditions: ReceiptSourceConditions): OutcomeCasePort {
  const canonical = {
    id: 'outcome-hotel-ai-phone-pilot',
    revision: '1',
    digest: digest(['outcome-hotel-ai-phone-pilot']),
  } as const;
  return {
    async read(reference, actor): Promise<OutcomeCaseRead> {
      if (reference.id !== canonical.id || (reference.revision !== undefined && reference.revision !== canonical.revision)) {
        throw new Error('OutcomeCase was not found');
      }
      if (reference.digest !== undefined && reference.digest !== canonical.digest) {
        throw new Error('OutcomeCase digest does not match');
      }
      if (actor.principal !== ownerId) throw new Error('OutcomeCase ACL denied the read');
      return {
        reference: canonical,
        source: {
          state: 'closed',
          owner_refs: [{ status: 'typed', ref: { id: 'project-hotel', type: 'project', revision: '3' } }],
          conditions: sourceConditions,
        },
        acl,
        scope,
      };
    },
  };
}

function pilotSnapshot(input: {
  objective: FoundationRevision & { readonly digest: string };
  variables: readonly (FoundationRevision & { readonly digest: string })[];
  model: FoundationRevision & { readonly digest: string };
  constraint: FoundationRevision & { readonly digest: string };
  observationReferences: readonly JudgmentProblemReference[];
  hostReferences: readonly JudgmentProblemReference[];
  revision?: string;
  problemId?: string;
}): JudgmentProblemSnapshot {
  const revision = input.revision ?? '1';
  const refs: JudgmentProblemReference[] = [
    snapshotReference('objective', input.objective),
    ...input.variables.map((ref) => snapshotReference('variable', ref)),
    snapshotReference('model', input.model),
    snapshotReference('constraint', input.constraint),
    ...input.observationReferences,
    ...input.hostReferences,
  ];
  return {
    snapshot_version: 'judgment-problem-snapshot.v1',
    problem_id: input.problemId ?? 'problem-hotel-pilot-v1',
    revision,
    question: 'Can the hotel phone pilot reduce front-desk load while preserving answer quality?',
    owner_scope: { type: 'project', id: hotelId },
    references: refs,
    read_policy: acl,
    execution_permission: 'none',
    created_at: '2026-04-01T00:00:00.000Z',
  };
}

describe('company OS hotel pilot', () => {
  // This fixture persists and reloads several real stores; under full-suite
  // concurrency it can exceed Vitest's 5s default, so bound only this test.
  it('starts from an isolated local fixture', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-company-os-hotel-pilot-'));
    dataDirs.push(dataDir);
    await initializePersonalOs(dataDir);
    const foundationStore = createFoundationRevisionStore({ dataDir });
    const total = await foundationStore.create(variable('variable-total-load', 'Total front-desk handling load.'), context);
    const quality = await foundationStore.create(variable('variable-answer-quality', 'Answer quality ratio.', 'average'), context);
    const direct = await foundationStore.create(variable('variable-direct-load', 'Direct handling load.'), context);
    const handoff = await foundationStore.create(variable('variable-handoff-load', 'Handoff load.'), context);
    const correction = await foundationStore.create(variable('variable-correction-load', 'Correction load.'), context);
    const objective = await foundationStore.create(objectiveDefinition(total, quality), context);
    const constraint = await foundationStore.create(constraintDefinition(), context);
    const model = await foundationStore.create(modelDefinition([direct, handoff, correction], total), context);
    const worldModel = createWorldModelStore({ dataDir, foundationStore });
    const baselineTotal = await worldModel.saveObservation(observation('observation-baseline-total', total, 140, 'baseline-support-log'), context);
    const baselineQuality = await worldModel.saveObservation(observation('observation-baseline-quality', quality, 0.94, 'baseline-quality-review'), context);
    const actualDirect = await worldModel.saveObservation(observation('observation-actual-direct', direct, 80, 'pilot-support-log'), context);
    const actualHandoff = await worldModel.saveObservation(observation('observation-actual-handoff', handoff, 15, 'pilot-handoff-log'), context);
    const actualCorrection = await worldModel.saveObservation(observation('observation-actual-correction', correction, 12, 'pilot-correction-log'), context);
    const actualQuality = await worldModel.saveObservation(observation('observation-actual-quality', quality, 0.82, 'pilot-quality-review'), context);
    const actualDirectValue = numberValue(actualDirect.value);
    const actualHandoffValue = numberValue(actualHandoff.value);
    const actualCorrectionValue = numberValue(actualCorrection.value);
    const actualQualityValue = numberValue(actualQuality.value);
    const actualTotal = actualDirectValue + actualHandoffValue + actualCorrectionValue;
    const observationRecords = [baselineTotal, baselineQuality, actualDirect, actualHandoff, actualCorrection, actualQuality] as const;
    const observationReferences = observationRecords.map((record) => ({
      ...evidenceReference('observation', record.id, record),
      valid_from: record.period.from,
      valid_to: record.period.until,
    }));
    const hostReferenceDefinitions = [
      { kind: 'criterion' as const, id: 'criterion-hotel-load', value: { load: 100 } },
      { kind: 'criterion' as const, id: 'criterion-hotel-quality', value: { quality: 0.9 } },
      { kind: 'authority' as const, id: 'authority-hotel-pilot', value: { ownerId, scopeId: hotelId, permission: 'fixture-only' } },
      { kind: 'resource' as const, id: 'resource-hotel-pilot-fixture', value: { sideEffect: 'fixture-only', scopeId: hotelId } },
      { kind: 'deadline' as const, id: 'deadline-hotel-pilot', value: { at: '2026-04-30T23:59:59.999Z' } },
      { kind: 'dag' as const, id: 'dag-hotel-pilot', value: { version: '1', ownerId } },
    ] as const;
    const hostReferenceRecords = new Map(hostReferenceDefinitions.map((entry) => [
      `${entry.kind}/${entry.id}`,
      {
        revision: '1',
        digest: digest(entry.value) as `sha256:${string}`,
        scope: { type: 'project' as const, id: hotelId },
        valid_from: period.from,
        valid_to: period.until,
      },
    ]));
    const hostReferences = hostReferenceDefinitions.map((entry) => {
      const record = hostReferenceRecords.get(`${entry.kind}/${entry.id}`)!;
      return {
        kind: entry.kind,
        id: entry.id,
        revision: record.revision,
        digest: record.digest,
        scope: record.scope,
        valid_from: record.valid_from,
        valid_to: record.valid_to,
      } satisfies JudgmentProblemReference;
    });
    const foundationProvider = createJudgmentProblemFoundationReferenceProvider({ store: foundationStore });
    const referenceProvider: JudgmentProblemReferenceProvider = {
      async resolve(input) {
        if (['objective', 'variable', 'model', 'constraint'].includes(input.reference.kind)) {
          return foundationProvider.resolve(input);
        }
        if (input.reference.kind === 'observation') {
          if (input.context.principal !== ownerId
            || input.reference.scope.type !== 'project'
            || input.reference.scope.id !== hotelId
            || input.reference.revision !== '1') {
            return { status: 'unauthorized', message: 'Observation reference is outside the fixture ACL or revision.' };
          }
          try {
            const record = await worldModel.readObservation(input.reference.id, { principal: input.context.principal });
            if (!record) return { status: 'missing', message: 'Observation was not found in the world-model store.' };
            if (record.subjectId !== hotelId
              || record.period.from !== input.reference.valid_from
              || record.period.until !== input.reference.valid_to) {
              return { status: 'unresolved', message: 'Observation scope or validity does not match the snapshot reference.' };
            }
            const resolvedDigest = digest(record) as `sha256:${string}`;
            if (resolvedDigest !== input.reference.digest) {
              return { status: 'unresolved', message: 'Observation digest changed.' };
            }
            return { status: 'resolved', digest: resolvedDigest };
          } catch {
            return { status: 'unauthorized', message: 'Observation ACL denied the read.' };
          }
        }
        const hostRecord = hostReferenceRecords.get(`${input.reference.kind}/${input.reference.id}`);
        if (!hostRecord) return { status: 'missing', message: 'Host-owned fixture reference was not found.' };
        if (input.context.principal !== ownerId
          || input.reference.scope.type !== hostRecord.scope.type
          || input.reference.scope.id !== hostRecord.scope.id
          || input.reference.revision !== hostRecord.revision
          || input.reference.valid_from !== hostRecord.valid_from
          || input.reference.valid_to !== hostRecord.valid_to) {
          return { status: 'unauthorized', message: 'Host-owned fixture reference is outside the fixture ACL or revision.' };
        }
        if (input.reference.digest !== hostRecord.digest) {
          return { status: 'unresolved', message: 'Host-owned fixture reference digest changed.' };
        }
        return { status: 'resolved', digest: hostRecord.digest };
      },
    };
    const unknownReference = { ...hostReferences[0]!, id: 'criterion-unknown' };
    expect(await referenceProvider.resolve({ reference: unknownReference, phase: 'read', context })).toMatchObject({ status: 'missing' });
    expect(await referenceProvider.resolve({ reference: { ...observationReferences[0]!, digest: digest({ tampered: true }) as `sha256:${string}` }, phase: 'read', context })).toMatchObject({ status: 'unresolved' });
    const snapshot = pilotSnapshot({
      objective,
      variables: [total, quality, direct, handoff, correction],
      model,
      constraint,
      observationReferences,
      hostReferences,
    });
    const receipt = await saveJudgmentProblemSnapshot({
      root: dataDir,
      snapshot,
      access: context,
      referenceProvider,
    });
    const outcomeConditions = {
      production_status: 'production_unproven',
      external_send: 'unrecorded',
      fixture: 'sideeffect_free',
    } as const;
    const outcomeCase = createPilotOutcomeCase(outcomeConditions);
    const evaluation = createCompanyOsEvaluationStore({
      dataDir,
      foundation: createFoundationDefinitionLoadPort(foundationStore),
      outcomeCase,
      snapshotReferenceProvider: referenceProvider,
    });
    const evaluationRecord = await evaluation.evaluate({
      id: 'evaluation-hotel-pilot-v1',
      snapshot: { root: dataDir, snapshotId: receipt.snapshot_id, referenceProvider },
      access: { principal: ownerId, scope },
      outcomeCase: { id: 'outcome-hotel-ai-phone-pilot' },
      predictions: [measurement(total, variable('variable-total-load', 'Total front-desk handling load.'), 80), measurement(quality, variable('variable-answer-quality', 'Answer quality ratio.', 'average'), 0.95)],
      actuals: [measurement(total, variable('variable-total-load', 'Total front-desk handling load.'), actualTotal), measurement(quality, variable('variable-answer-quality', 'Answer quality ratio.', 'average'), actualQualityValue)],
      judgmentAtTimeValidity: {
        status: 'valid',
        basis: 'The pilot used the approved objective, model, and constraints available at the time.',
        evidenceRefs: ['evidence/hotel-pilot-judgment-at-time'],
      },
      evaluatedAt: '2026-05-02T00:00:00.000Z',
    });
    const evaluationDigest = digestEvaluationRecord(evaluationRecord);
    const receipts = createCompanyOsReceiptAdapter({
      dataDir,
      sourcePorts: { outcome_case: createOutcomeCaseReceiptSourcePort(outcomeCase) },
    });
    const outcomeReceipt = await receipts.link({
      id: 'receipt-hotel-pilot-v1',
      source: {
        kind: 'outcome_case',
        id: 'outcome-hotel-ai-phone-pilot',
        revision: '1',
        hash: digest(['outcome-hotel-ai-phone-pilot']),
        state: 'closed',
        owner_refs: [{ status: 'typed', ref: { id: 'project-hotel', type: 'project', revision: '3' } }],
        conditions: outcomeConditions,
      },
      judgment_refs: [
        { kind: 'problem', id: receipt.problem_id, revision: receipt.revision, digest: receipt.snapshot_id },
        { kind: 'objective', id: objective.id, revision: objective.revision, digest: objective.digest },
        { kind: 'model', id: model.id, revision: model.revision, digest: model.digest },
        { kind: 'constraint', id: constraint.id, revision: constraint.revision, digest: constraint.digest },
        { kind: 'evaluation', id: evaluationRecord.id, revision: '1', digest: evaluationDigest },
      ],
      recorded_at: '2026-05-02T00:00:00.000Z',
      access: { principal: ownerId, scope },
    });

    expect({ tenantId, ownerId, hotelId }).toEqual({
      tenantId: 'tenant-hotel-pilot',
      ownerId: 'owner-1',
      hotelId: 'hotel-alpha',
    });
    expect({ total: baselineTotal.value, quality: baselineQuality.value }).toEqual({ total: 140, quality: 0.94 });
    expect({ direct: actualDirectValue, handoff: actualHandoffValue, correction: actualCorrectionValue, quality: actualQualityValue }).toEqual({
      direct: 80,
      handoff: 15,
      correction: 12,
      quality: 0.82,
    });
    expect([objective, constraint, model].map((ref) => ref.digest)).toHaveLength(3);
    expect(digest({ baseline: 140, quality: 0.94 })).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.problem_id).toBe('problem-hotel-pilot-v1');
    expect(receipt.revision).toBe('1');
    expect(evaluationRecord.achievement).toBe('not_achieved');
    expect(evaluationRecord.criteria.map((criterion) => criterion.status)).toEqual(['not_achieved', 'not_achieved']);
    expect(evaluationRecord.predictionComparisons.map((comparison) => comparison.status)).toEqual(['missed', 'missed']);
    expect(evaluationRecord.outcomeCaseRef).toMatchObject({ id: 'outcome-hotel-ai-phone-pilot', revision: '1' });
    expect(outcomeReceipt.link.objective_status).toBe('unrecorded');
    expect(outcomeReceipt.link.judgment_quality_status).toBe('unrecorded');
    expect(outcomeReceipt.source_read.reference).toMatchObject({
      id: 'outcome-hotel-ai-phone-pilot',
      state: 'closed',
      conditions: outcomeConditions,
    });

    const candidateStore = createProblemCandidateStore({
      dataDir,
      foundationStore,
      evidenceAccessProvider: { authorize: () => true },
    });
    const candidate = await candidateStore.saveCandidate({
      id: 'candidate-hotel-pilot-gap',
      kind: 'gap',
      statement: 'The pilot reduced direct handling but total load and answer quality missed the approved objective.',
      objectiveRefs: [{ ...objective, type: 'objective' as const }],
      event: {
        id: 'event-hotel-pilot-evaluation-gap',
        occurredAt: '2026-05-02T00:00:00.000Z',
        recordedAt: '2026-05-02T00:00:00.000Z',
        sourceRefs: [
          { id: evaluationRecord.id, kind: 'evidence', digest: evaluationDigest },
          { id: outcomeReceipt.link.id, kind: 'evidence', digest: outcomeReceipt.link.source_digest },
        ],
      },
      observedGap: { status: 'known', value: 'Actual total load was 107 minutes and answer quality was 0.82.' },
      opportunity: { status: 'known', value: 'Revise the model to account for handoff and correction work before the next run.' },
      threat: { status: 'known', value: 'Optimizing direct calls alone can hide downstream correction work.' },
      uncertainty: { status: 'known', value: 'Handoff and correction estimates are fixture observations pending another run.' },
      deadline: { status: 'known', value: { dueAt: '2026-05-15T00:00:00.000Z', evaluationAt: '2026-05-16T00:00:00.000Z' } },
      expectedEffect: { status: 'known', value: 'A revised model should preserve quality while reducing the complete load.' },
      requiredResources: { status: 'known', value: [{ id: 'resource-hotel-pilot-fixture', kind: 'sideeffect_free_fixture', quantity: 1, unit: 'run' }] },
      responsibleId: { status: 'known', value: ownerId },
      ownerScope: scope,
      acl,
      createdAt: '2026-05-02T00:00:00.000Z',
    }, context);
    const selectionProblem: JudgmentDAGProblemSnapshotReference = {
      snapshot_id: receipt.snapshot_id,
      problem_id: snapshot.problem_id,
      revision: snapshot.revision,
    };
    const selectionComposition: JudgmentDAGCompositionDefinition = {
      composition_id: 'composition-hotel-pilot-selection',
      composition_version: '1',
      scope: { type: 'project', id: hotelId },
      parent_dag: { id: 'dag-hotel-pilot-selection', version: '1' },
      children: [
        {
          invocation_id: 'measure-pilot-gap',
          dag: { id: 'dag-hotel-pilot-measure', version: '1' },
          question: 'Measure complete pilot load and answer quality.',
          input_contract: 'hotel-pilot-measure-input.v1',
          output_contract: 'hotel-pilot-measure-output.v1',
          required_capabilities: ['world_model.read'],
          depends_on: [],
        },
        {
          invocation_id: 'select-revised-model',
          dag: { id: 'dag-hotel-pilot-method', version: '1' },
          question: 'Select a model revision candidate for the next run.',
          input_contract: 'hotel-pilot-method-input.v1',
          output_contract: 'hotel-pilot-method-output.v1',
          required_capabilities: ['world_model.read'],
          depends_on: ['measure-pilot-gap'],
        },
      ],
    };
    const fixedConditions = {
      objectiveRefs: [objective],
      constraintRefs: [constraint],
      conditionalPreferences: [{ id: 'preference-quality-first', condition: 'quality would otherwise fall below 0.90', preference: 'hold' }],
      delegatedJudgments: [{ id: 'judgment-owner-review', question: 'Approve the next model revision candidate.', ownerId }],
      costs: {
        switching: { status: 'known' as const, value: 1 },
        opportunity: { status: 'known' as const, value: 2 },
        exploration: { status: 'known' as const, value: 1 },
      },
      explorationLimit: { maxCandidates: 3, maxExplorationCost: { status: 'known' as const, value: 5 } },
      evaluatedAt: '2026-05-02T00:00:00.000Z',
    };
    const candidateRef = { candidateId: candidate.id, payloadDigest: candidate.payloadDigest, ownerScope: scope };
    const selection = await createProblemSelection({
      selectionId: 'selection-hotel-pilot-v1',
      selectionProblem,
      selectionComposition,
      ownerScope: scope,
      readPolicy: acl,
      fixedConditions,
      candidateRefs: [candidateRef],
      candidateStore,
      candidateContext: context,
      evaluator: {
        evaluate: () => evaluateProblemSelectionWithComposition({
          compositionRequest: {
            run_id: 'run-hotel-pilot-selection-v1',
            composition: selectionComposition,
            question: 'Select the next hotel pilot model revision.',
            input: { actualTotal, actualQuality: actualQualityValue },
            problem_snapshot: selectionProblem,
            fixed_conditions: { objective: objective.id, constraint: constraint.id },
            delegation: { scope: { type: 'project', id: hotelId }, capabilities: ['world_model.read'] },
            snapshot_reader: {
              read: async (request) => {
                const loaded = await loadJudgmentProblemSnapshot({
                  root: dataDir,
                  snapshot_id: request.reference.snapshot_id,
                  access: context,
                  reference_resolution: 'current',
                  referenceProvider,
                });
                return {
                  status: 'resolved' as const,
                  reference_resolution: 'current' as const,
                  reference: request.reference,
                  snapshot: loaded as unknown as JudgmentDAGJSONValue,
                };
              },
            },
            dag_resolver: {
              resolve: ({ role, invocation_id, dag }) => {
                if (role === 'child' && invocation_id !== undefined) {
                  const child = selectionComposition.children.find((entry) => entry.invocation_id === invocation_id);
                  if (child !== undefined) return { dag, input_contract: child.input_contract, output_contract: child.output_contract };
                }
                return { dag, input_contract: 'hotel-pilot-parent-input.v1', output_contract: 'hotel-pilot-parent-output.v1' };
              },
            },
            contract_validator: { validate: () => undefined },
            port: {
              execute: async (request) => ({
                status: 'completed' as const,
                input_contract: request.invocation_id === 'measure-pilot-gap' ? 'hotel-pilot-measure-input.v1' : 'hotel-pilot-method-input.v1',
                output_contract: request.invocation_id === 'measure-pilot-gap' ? 'hotel-pilot-measure-output.v1' : 'hotel-pilot-method-output.v1',
                run_reference: { run_id: `run-hotel-pilot-selection-${request.invocation_id}`, dag: request.dag, artifact_id: undefined },
                conclusion: (request.invocation_id === 'measure-pilot-gap'
                  ? { actualTotal, actualQuality: actualQualityValue, qualityTarget: 0.9 }
                  : {
                      status: 'selected',
                      selectedCandidateId: candidate.id,
                      action: 'start',
                      ownerId,
                      reason: 'The gap is measurable and the next model revision is bounded to this fixture.',
                      conditions: ['complete a new immutable problem snapshot before execution'],
                    }) as unknown as JudgmentDAGJSONValue,
                evidence: [{ kind: 'evaluation', id: evaluationRecord.id, revision: '1' }],
                applicability: { scope: hotelId } as unknown as JudgmentDAGJSONValue,
                uncertainty: { status: 'fixture_only' } as unknown as JudgmentDAGJSONValue,
                reason: undefined,
              }),
            },
          },
          resultInvocationId: 'select-revised-model',
        }),
      },
      createdAt: '2026-05-02T00:00:00.000Z',
    });
    const selectionStore = createProblemSelectionRecordStore({ root: dataDir });
    const selectionReceipt = await selectionStore.save(selection, { principal: ownerId, scope });
    const selectionReadback = await selectionStore.read(selectionReceipt.recordId, { principal: ownerId, scope });
    expect(candidate.status).toBe('candidate');
    expect(selectionReadback.status).toBe('selected');
    expect(selectionReadback.decision.action).toBe('start');
    expect(selectionReadback.problemCreationRequest?.completeSnapshotRequired).toBe(true);
    expect(selectionReadback.executionPermission).toBe('none');

    const modelRecord = await foundationStore.read(model, context);
    expect(modelRecord).not.toBeNull();
    const learningTarget = createFoundationLearningTargetPort({ foundationStore });
    const learningReceipts = new Map<string, LearningRunReceipt>();
    const learningRunReceipt: LearningRunReceiptPort = {
      async read(reference, access) {
        if (access.principal !== ownerId) throw new Error('Learning run receipt ACL denied the read');
        const found = learningReceipts.get(reference.id);
        return found ? JSON.parse(JSON.stringify(found)) as LearningRunReceipt : null;
      },
    };
    const learning = createCompanyOsLearningAdoptionStore({
      dataDir,
      evaluation: createCompanyOsLearningEvaluationPort(evaluation),
      target: learningTarget,
      runReceipt: learningRunReceipt,
      now: () => '2026-05-03T00:00:00.000Z',
    });
    const modelTarget: LearningTargetReference = {
      kind: 'world_model',
      id: model.id,
      revision: model.revision,
      digest: model.digest,
      foundationType: 'model',
    };
    const learningCandidate = await learning.createCandidate({
      id: 'candidate-hotel-pilot-model-v2',
      sourceEvaluationRef: { id: evaluationRecord.id, digest: digestEvaluationRecord(evaluationRecord) },
      target: modelTarget,
      proposedChange: {
        definition: {
          ...modelRecord!.definition,
          relationship: 'Use complete load, including handoffs and corrections, before optimizing direct handling.',
        },
      },
      grounds: ['The pilot measured direct handling, handoffs, and corrections separately.'],
      counterexamples: ['Direct handling fell while complete load still missed the objective.'],
      uncertainty: ['The next run remains a side-effect-free fixture until production evidence is recorded.'],
      applicability: scope,
      createdAt: '2026-05-02T00:00:00.000Z',
      access: context,
    });
    const learningValidation = await learning.createValidation({
      id: 'validation-hotel-pilot-model-v2',
      candidateRef: { id: learningCandidate.id, digest: learningCandidate.digest },
      findings: [{
        kind: 'execution_difference',
        description: 'Complete load includes handoff and correction work that was absent from the direct-only prediction.',
        evidenceRefs: [evaluationRecord.id, actualHandoff.id, actualCorrection.id],
      }],
      conclusion: 'partially_supported',
      modelDisposition: 'revise',
      basis: 'The prediction gap is evidence for revising the model, while the quality miss prevents treating the pilot as achieved.',
      validatedAt: '2026-05-02T01:00:00.000Z',
      access: context,
    });
    const adoption = await learning.adopt({
      id: 'adoption-hotel-pilot-model-v2',
      idempotencyKey: 'adoption-key-hotel-pilot-model-v2',
      candidateRef: { id: learningCandidate.id, digest: learningCandidate.digest },
      validationRef: { id: learningValidation.id, digest: learningValidation.digest },
      access: context,
    });
    expect(adoption.previousTarget).toEqual(modelTarget);
    expect(adoption.adoptedTarget.revision).toBe('2');
    expect(adoption.targetValidationState).toBe('supported');

    const plannedRunUse = await learning.recordRunUse({
      id: 'run-use-hotel-pilot-v2-planned',
      runId: 'run-hotel-pilot-v2',
      adoptionId: adoption.id,
      runPhase: 'planned',
      access: context,
    });
    expect(plannedRunUse.adoptedTarget).toEqual(adoption.adoptedTarget);
    const runReceiptWithoutDigest: Omit<LearningRunReceipt, 'digest'> = {
      id: 'run-receipt-hotel-pilot-v2',
      runId: 'run-hotel-pilot-v2',
      runPhase: 'actual',
      adoptedTarget: adoption.adoptedTarget,
    };
    const runReceipt: LearningRunReceipt = {
      ...runReceiptWithoutDigest,
      digest: learningRunReceiptDigest(runReceiptWithoutDigest),
    };
    learningReceipts.set(runReceipt.id, runReceipt);
    const actualRunUse = await learning.recordRunUse({
      id: 'run-use-hotel-pilot-v2-actual',
      runId: runReceipt.runId,
      adoptionId: adoption.id,
      runPhase: 'actual',
      receiptRef: { id: runReceipt.id, digest: runReceipt.digest },
      access: context,
    });
    expect(actualRunUse.runPhase).toBe('actual');
    expect(actualRunUse.adoptedTarget).toEqual(adoption.adoptedTarget);

    const objectiveRecord = await foundationStore.read(objective, context);
    expect(objectiveRecord).not.toBeNull();
    const objectiveV2 = await foundationStore.update({
      reference: objective,
      next: {
        ...objectiveRecord!.definition,
        meaning: 'Reduce complete front-desk load while preserving answer quality in the next pilot revision.',
      },
    }, context);
    const modelV2Record = await foundationStore.read({
      id: adoption.adoptedTarget.id,
      type: 'model',
      revision: adoption.adoptedTarget.revision,
    }, context);
    expect(modelV2Record).not.toBeNull();
    const modelV2 = { ...modelV2Record!.definition, digest: modelV2Record!.digest } as FoundationRevision & { readonly digest: string };
    const snapshotV2 = pilotSnapshot({
      objective: objectiveV2,
      variables: [total, quality, direct, handoff, correction],
      model: modelV2,
      constraint,
      observationReferences,
      hostReferences,
      problemId: 'problem-hotel-pilot-v2',
    });
    const receiptV2 = await saveJudgmentProblemSnapshot({
      root: dataDir,
      snapshot: snapshotV2,
      access: context,
      referenceProvider,
    });
    const evaluationRecordV2 = await evaluation.evaluate({
      id: 'evaluation-hotel-pilot-v2',
      snapshot: { root: dataDir, snapshotId: receiptV2.snapshot_id, referenceProvider },
      access: { principal: ownerId, scope },
      outcomeCase: { id: 'outcome-hotel-ai-phone-pilot' },
      predictions: [measurement(total, variable('variable-total-load', 'Total front-desk handling load.'), 80), measurement(quality, variable('variable-answer-quality', 'Answer quality ratio.', 'average'), 0.95)],
      actuals: [measurement(total, variable('variable-total-load', 'Total front-desk handling load.'), actualTotal), measurement(quality, variable('variable-answer-quality', 'Answer quality ratio.', 'average'), actualQualityValue)],
      judgmentAtTimeValidity: {
        status: 'valid',
        basis: 'The v2 run selected the adopted model revision and a new immutable problem snapshot.',
        evidenceRefs: [adoption.id, actualRunUse.id],
      },
      evaluatedAt: '2026-05-03T00:00:00.000Z',
    });
    const snapshotV2Read = await loadJudgmentProblemSnapshot({
      root: dataDir,
      snapshot_id: receiptV2.snapshot_id,
      access: context,
      reference_resolution: 'current',
      referenceProvider,
    });
    const modelV2Reference = snapshotV2Read.references.find((reference) => reference.kind === 'model');
    expect(modelV2Reference).toMatchObject({ id: model.id, revision: '2', digest: modelV2Record!.digest });
    expect(evaluationRecordV2.snapshot.snapshotId).toBe(receiptV2.snapshot_id);
    expect(evaluationRecordV2.snapshot.snapshotId).not.toBe(evaluationRecord.snapshot.snapshotId);
    expect(digestEvaluationRecord((await evaluation.read(evaluationRecord.id, { principal: ownerId, scope }))!)).toBe(evaluationDigest);

    const impactAccess = { principal: ownerId, scope: { type: 'project' as const, id: hotelId } };
    const impactCurrentReference: ImpactReviewReference = {
      kind: 'model',
      id: model.id,
      revision: modelV2Record!.definition.revision,
      digest: modelV2Record!.digest,
      scope: impactAccess.scope,
    };
    const impactChange: ImpactReviewChange = {
      change_id: 'change-hotel-pilot-premise-refuted',
      source: 'world_model',
      current: impactCurrentReference,
      significance: 'premise_refuted',
      reason: 'The adopted direct-load premise was refuted by complete-load observations.',
    };
    const oldProblem = {
      snapshot_id: receipt.snapshot_id,
      problem_id: snapshot.problem_id,
      revision: snapshot.revision,
    };
    const newProblem = {
      snapshot_id: receiptV2.snapshot_id,
      problem_id: snapshotV2.problem_id,
      revision: snapshotV2.revision,
    };
    const impactSnapshotPort = {
      verify: async ({ principal, reference }: { principal: string; reference: { snapshot_id: string; problem_id: string; revision: string } }) => {
        const snapshotIds: readonly string[] = [oldProblem.snapshot_id, newProblem.snapshot_id];
        if (principal !== ownerId || !snapshotIds.includes(reference.snapshot_id)) return false;
        try {
          const loaded = await loadJudgmentProblemSnapshot({
            root: dataDir,
            snapshot_id: reference.snapshot_id,
            access: context,
            reference_resolution: 'current',
            referenceProvider,
          });
          return loaded.problem_id === reference.problem_id && loaded.revision === reference.revision;
        } catch {
          return false;
        }
      },
    };
    const impactPlan: ImpactReviewPlan = {
      plan_id: 'plan-hotel-pilot-v1',
      owner_scope: impactAccess.scope,
      read_policy: acl,
      problem_snapshot: oldProblem,
      run_id: 'run-hotel-pilot-v1',
      execution_state: 'planned',
      authority_state: 'valid',
      constraint_state: 'valid',
      responsible: { principal: ownerId, scope: hotelId },
    };
    const impactWaitStore1 = new DurableWaitStore({
      dataDir,
      clock: () => new Date('2026-05-04T00:00:00.000Z'),
      problemSnapshot: impactSnapshotPort,
    });
    const impactWaits = createCompanyOsImpactReviewDurableWaitPort(impactWaitStore1);
    const impactNotifications = createCompanyOsImpactReviewNotificationStore({
      dataDir,
      clock: () => new Date('2026-05-04T00:00:00.000Z'),
    });
    const impactCoordinator = new CompanyOsImpactReviewCoordinator({
      currentReferences: { readCurrent: async () => impactCurrentReference },
      index: {
        findAffectedPlans: async ({ changes }) => [{
          plan: impactPlan,
          matches: [{ change_id: changes[0]!.change_id, relation: 'predicts', domain: 'world_model', evidence: 'model-hotel-front-desk-load predicts complete load' }],
        }],
      },
      notifications: impactNotifications,
      waits: impactWaits,
      rejudgment: {
        createNewProblemAndRun: async () => ({ problem: newProblem, run_id: 'run-hotel-pilot-v2' }),
      },
    });
    const reservationProblem = {
      problem_snapshot_id: receipt.snapshot_id,
      problem_id: snapshot.problem_id,
      revision: snapshot.revision,
    };
    let reservationProblemV2: typeof reservationProblem | undefined;
    let impactWaitStoreForExecution: DurableWaitStore | undefined;
    let currentImpactWaitId: string | undefined;
    const storedSnapshotReferences = new Map<string, JudgmentProblemReference>();
    const reservationReferenceProvider: JudgmentProblemReferenceProvider = {
      resolve: async ({ reference, context: referenceContext }) => {
        if (referenceContext.principal !== ownerId) return { status: 'unauthorized' as const };
        const stored = storedSnapshotReferences.get(`${reference.kind}/${reference.id}/${reference.revision}`);
        if (stored === undefined) return { status: 'missing' as const };
        if (
          stored.digest !== reference.digest
          || stored.scope.type !== reference.scope.type
          || stored.scope.id !== reference.scope.id
          || stored.valid_from !== reference.valid_from
          || stored.valid_to !== reference.valid_to
        ) return { status: 'unresolved' as const };
        return { status: 'resolved' as const, digest: stored.digest };
      },
    };
    // Reservation mutations already hold the SSOT lock. Read and validate the
    // canonical snapshot before entering that transaction, then expose the
    // immutable record through the lock-safe verifier port.
    const reservationSnapshotPort = createResourceReservationProblemSnapshotPort({
      root: dataDir,
      load: async ({ root, snapshot_id, access, reference_resolution }) => {
        const loaded = await loadJudgmentProblemSnapshot({
          root,
          snapshot_id,
          access,
          reference_resolution,
          referenceProvider: reservationReferenceProvider,
        });
        return {
          snapshot_version: loaded.snapshot_version,
          problem_id: loaded.problem_id,
          revision: loaded.revision,
          owner_scope: loaded.owner_scope,
          execution_permission: loaded.execution_permission,
        };
      },
    });
    const reservation = new ResourceReservationService({
      dataDir,
      authorization: {
        authorize: (request) => ({
          status: 'approved' as const,
          approvalId: request.runId === 'run-hotel-pilot-v2' ? 'approval-hotel-pilot-v2' : 'approval-hotel-pilot-v1',
          expiresAt: '2026-05-04T00:00:00.000Z',
          evidence: { source: 'hotel-pilot-sideeffect-free-fixture' },
        }),
      },
      problemSnapshot: reservationSnapshotPort,
      capacity: { read: () => 2 },
      clock: () => new Date('2026-05-02T02:00:00.000Z'),
    });
    await reservation.initialize();
    const reservationRequest = {
      operationId: 'operation-hotel-pilot-v1',
      tenantId,
      principal: ownerId,
      scopeId: hotelId,
      resourceId: 'resource-hotel-pilot-fixture',
      period: { startsAt: '2026-05-02T03:00:00.000Z', endsAt: '2026-05-02T04:00:00.000Z' },
      amount: 1,
      unit: 'run',
      runId: 'run-hotel-pilot-v1',
      problem: reservationProblem,
    };
    const reservationSnapshotRead = await loadJudgmentProblemSnapshot({
      root: dataDir,
      snapshot_id: receipt.snapshot_id,
      access: context,
      reference_resolution: 'current',
      referenceProvider,
    });
    expect(reservationSnapshotRead.problem_id).toBe(snapshot.problem_id);
    for (const reference of reservationSnapshotRead.references) {
      storedSnapshotReferences.set(`${reference.kind}/${reference.id}/${reference.revision}`, reference);
    }
    expect(await reservationSnapshotPort.verify({ tenantId, principal: ownerId, scopeId: hotelId, reference: reservationProblem })).toBe(true);
    const approvedReservation = await reservation.approve(reservationRequest);
    const reservedReservation = await reservation.reserve({
      ...reservationRequest,
      operationId: 'operation-hotel-pilot-v1-reserve',
      approvalId: approvedReservation.reservation.approval.approvalId,
    });
    let fixtureEffectCalls = 0;
    const authorityFixture = {
      id: 'authority-hotel-pilot',
      ownerId,
      scopeId: hotelId,
      permission: 'fixture-only',
      constraintRefs: [constraint.id],
    } as const;
    const check = async (input: ExecutionCheckRequest) => {
      const currentWait = currentImpactWaitId === undefined || impactWaitStoreForExecution === undefined
        ? undefined
        : await impactWaitStoreForExecution.get({ wait_id: currentImpactWaitId, principal: ownerId });
      const expectedProblem = input.runId === 'run-hotel-pilot-v1'
        ? reservationProblem
        : input.runId === 'run-hotel-pilot-v2'
          ? reservationProblemV2
          : undefined;
      const fixtureScopeValid = input.tenantId === tenantId
        && input.principal === authorityFixture.ownerId
        && input.scopeId === authorityFixture.scopeId
        && input.authorityRef === authorityFixture.id
        && input.constraintRefs.length === authorityFixture.constraintRefs.length
        && input.constraintRefs.every((ref) => authorityFixture.constraintRefs.includes(ref))
        && expectedProblem !== undefined
        && input.problem.problem_snapshot_id === expectedProblem.problem_snapshot_id
        && input.problem.problem_id === expectedProblem.problem_id
        && input.problem.revision === expectedProblem.revision;
      if (!fixtureScopeValid) return { status: 'revoked' as const, revision: `${input.check}-fixture-denied` };
      if (currentWait?.state === 'handoff_required' && input.runId === 'run-hotel-pilot-v1') {
        return { status: 'revoked' as const, revision: `${input.check}-handoff-required` };
      }
      const revision = `${input.check}-1`;
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
        return { status: 'revoked' as const, revision };
      }
      return {
        status: 'approved' as const,
        revision,
        fencingToken: `${input.check}-token`,
        expiresAt: '2026-05-04T00:00:00.000Z',
        evidence: { source: 'hotel-pilot-sideeffect-free-fixture', permission: authorityFixture.permission },
      };
    };
    const authority = new ExecutionAuthorityService({
      dataDir,
      authority: { verify: check },
      approval: { verify: check },
      constraint: { verify: check },
      reservation: createResourceReservationExecutionPort({ service: reservation }),
      readAccess: {
        verify: ({ tenantId: currentTenantId, principal, scopeId }) => currentTenantId === tenantId
          && principal === ownerId
          && scopeId === hotelId
          ? { status: 'approved' as const, revision: 'read-1' }
          : { status: 'revoked' as const, revision: 'read-fixture-denied' },
      },
      effect: {
        start: () => {
          fixtureEffectCalls += 1;
          return { status: 'started' as const };
        },
      },
      clock: () => new Date('2026-05-02T02:00:00.000Z'),
    });
    const execution = await authority.start({
      operationId: 'execution-hotel-pilot-v1',
      tenantId,
      principal: ownerId,
      scopeId: hotelId,
      runId: 'run-hotel-pilot-v1',
      reservationId: reservedReservation.reservation.reservationId,
      approvalId: reservedReservation.reservation.approval.approvalId,
      authorityRef: 'authority-hotel-pilot',
      constraintRefs: [constraint.id],
      problem: reservationProblem,
    });
    const reservationLedger = await reservation.readLedger({ tenantId, principal: ownerId, scopeId: hotelId });
    expect(reservationLedger.reservations[0]?.state).toBe('reserved');
    expect(execution.effect.status).toBe('started');
    expect(execution.intent.problem).toEqual(reservationProblem);
    expect(fixtureEffectCalls).toBe(1);

    const impactResult = await impactCoordinator.review({ access: impactAccess, changes: [impactChange] });
    expect(impactResult.decisions[0]?.disposition).toBe('hold');
    const waitId = impactResult.decisions[0]?.wait_id;
    expect(waitId).toMatch(/^impact-review-/u);
    const persistedWait = await impactWaitStore1.get({ wait_id: waitId!, principal: ownerId });
    expect(persistedWait).toMatchObject({
      state: 'waiting',
      problem_snapshot: oldProblem,
      run_ref: { run_id: 'run-hotel-pilot-v1' },
    });
    const impactWaitStore2 = new DurableWaitStore({
      dataDir,
      clock: () => new Date('2026-05-04T00:00:00.000Z'),
      problemSnapshot: impactSnapshotPort,
    });
    const claim = await impactWaitStore2.claim({
      wait_id: waitId!,
      principal: ownerId,
      request_id: 'claim-hotel-pilot-v1',
      trigger: 'event',
      event_type: 'impact_review',
      event_id: waitId!,
      occurred_at: '2026-05-04T00:00:00.000Z',
    });
    expect(claim.claimed_by_this_request).toBe(true);
    impactWaitStoreForExecution = new DurableWaitStore({
      dataDir,
      clock: () => new Date('2026-05-04T00:00:00.000Z'),
      problemSnapshot: impactSnapshotPort,
    });
    currentImpactWaitId = waitId;
    const restartedWait = await impactWaitStoreForExecution.get({ wait_id: waitId!, principal: ownerId });
    expect(restartedWait).toMatchObject({
      state: 'claimed',
      problem_snapshot: oldProblem,
      run_ref: { run_id: 'run-hotel-pilot-v1' },
      claim: { request_id: 'claim-hotel-pilot-v1', claim_id: claim.claim.claim_id },
    });
    const reassessed = await impactCoordinator.reassess({
      access: impactAccess,
      plan: impactPlan,
      changes: [impactChange],
      reason: impactChange.reason,
      wait_id: waitId,
    });
    expect(reassessed).toEqual({ problem: newProblem, run_id: 'run-hotel-pilot-v2', wait_id: waitId });
    const handoffWait = await impactWaitStoreForExecution.get({ wait_id: waitId!, principal: ownerId });
    expect(handoffWait).toMatchObject({
      state: 'handoff_required',
      problem_snapshot: oldProblem,
      next_problem: newProblem,
      run_ref: { run_id: 'run-hotel-pilot-v1' },
    });

    await expect(authority.start({
      operationId: 'execution-hotel-pilot-v1-after-handoff',
      tenantId,
      principal: ownerId,
      scopeId: hotelId,
      runId: 'run-hotel-pilot-v1',
      reservationId: reservedReservation.reservation.reservationId,
      approvalId: reservedReservation.reservation.approval.approvalId,
      authorityRef: authorityFixture.id,
      constraintRefs: [constraint.id],
      problem: reservationProblem,
    })).rejects.toMatchObject({ code: 'authority_revoked' });
    expect(fixtureEffectCalls).toBe(1);

    reservationProblemV2 = {
      problem_snapshot_id: receiptV2.snapshot_id,
      problem_id: snapshotV2.problem_id,
      revision: snapshotV2.revision,
    };
    const reservationSnapshotV2Read = await loadJudgmentProblemSnapshot({
      root: dataDir,
      snapshot_id: receiptV2.snapshot_id,
      access: context,
      reference_resolution: 'current',
      referenceProvider,
    });
    for (const reference of reservationSnapshotV2Read.references) {
      storedSnapshotReferences.set(`${reference.kind}/${reference.id}/${reference.revision}`, reference);
    }
    expect(await reservationSnapshotPort.verify({ tenantId, principal: ownerId, scopeId: hotelId, reference: reservationProblemV2 })).toBe(true);
    const reservationRequestV2 = {
      operationId: 'operation-hotel-pilot-v2',
      tenantId,
      principal: ownerId,
      scopeId: hotelId,
      resourceId: 'resource-hotel-pilot-fixture',
      period: { startsAt: '2026-05-03T03:00:00.000Z', endsAt: '2026-05-03T04:00:00.000Z' },
      amount: 1,
      unit: 'run',
      runId: 'run-hotel-pilot-v2',
      problem: reservationProblemV2,
    };
    const approvedReservationV2 = await reservation.approve(reservationRequestV2);
    const reservedReservationV2 = await reservation.reserve({
      ...reservationRequestV2,
      operationId: 'operation-hotel-pilot-v2-reserve',
      approvalId: approvedReservationV2.reservation.approval.approvalId,
    });
    const executionV2 = await authority.start({
      operationId: 'execution-hotel-pilot-v2',
      tenantId,
      principal: ownerId,
      scopeId: hotelId,
      runId: 'run-hotel-pilot-v2',
      reservationId: reservedReservationV2.reservation.reservationId,
      approvalId: reservedReservationV2.reservation.approval.approvalId,
      authorityRef: authorityFixture.id,
      constraintRefs: [constraint.id],
      problem: reservationProblemV2,
    });
    expect(executionV2.effect.status).toBe('started');
    expect(executionV2.intent.problem).toEqual(reservationProblemV2);
    expect(fixtureEffectCalls).toBe(2);
  }, 30_000);
});
