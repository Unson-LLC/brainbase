import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompanyOsEvaluationRecord, EvaluationAccessContext } from '../src/company-os-evaluation.js';
import {
  COMPANY_OS_LEARNING_ADOPTION_SIDECAR,
  COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA,
  CompanyOsLearningAdoptionError,
  createCompanyOsLearningAdoptionStore,
  createFoundationLearningTargetPort,
  createLearningAdoptionLocator,
  createLearningAdoptionLocatorReadPort,
  digestEvaluationRecord,
  type LearningEvaluationPort,
  type LearningRunReceipt,
  type LearningRunReceiptPort,
  type LearningTargetReference
} from '../src/company-os-learning-adoption.js';
import {
  createKnowledgeConditionAdapter,
  type KnowledgeAdoptionReadPort
} from '../src/knowledge-adapter.js';
import { createFoundationRevisionStore, type FoundationRevisionStore } from '../src/foundation-store.js';
import type { DecisionAdapterConditions } from '../src/decision-adapter.js';
import { initializePersonalOs } from '../src/ssot.js';
import type { FoundationAcl, FoundationScope, ModelDefinition, VariableDefinition } from '../src/ontology-foundation.js';
import type { FoundationRef } from '../src/foundation-catalog.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const scope: FoundationScope = {
  subjectIds: ['hotel-alpha'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
};

function acl(): FoundationAcl {
  return {
    ownerId: 'owner-1',
    visibility: 'private',
    readerIds: ['reader-1'],
    writerIds: []
  };
}

function variableDefinition(id: string): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision: '1',
    meaning: `${id} definition`,
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-learning-adoption-v1', sourceKind: 'document', evidenceIds: [] }],
    scope,
    subject: 'hotel-alpha/front-desk',
    valueKind: 'number',
    unit: 'minutes',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'weekly operational aggregation'
  };
}

function modelDefinition(input: FoundationRef, output: FoundationRef, relationship = 'automation reduces direct handling time'): ModelDefinition {
  return {
    id: 'model-front-desk-load',
    type: 'model',
    revision: '1',
    meaning: 'Predicts how automation changes total front-desk handling load.',
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation', 'execution'],
    acl: acl(),
    storage: 'ontology',
    provenance: [{ sourceId: 'story-company-os-learning-adoption-v1', sourceKind: 'document', evidenceIds: [] }],
    scope,
    inputVariableRefs: [{ id: input.id, type: 'variable', revision: input.revision }],
    outputVariableRefs: [{ id: output.id, type: 'variable', revision: output.revision }],
    applicability: scope,
    relationship,
    uncertainty: 'Handoff and correction work may offset the direct reduction.',
    validationState: 'unverified'
  };
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function adapterConditions(): DecisionAdapterConditions {
  return {
    problem_snapshot: {
      snapshot_id: digest(['snapshot-knowledge-adapter']),
      problem_id: 'problem-knowledge-adapter',
      revision: '1'
    },
    method: { id: 'method-knowledge-adapter', version: '1' },
    objective_refs: [{ id: 'objective-knowledge-adapter', type: 'objective', revision: '1' }]
  };
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
  return digest(canonicalize({ ...receipt, digest: '' }));
}

function evaluationRecord(objectiveRef: FoundationRef): CompanyOsEvaluationRecord {
  return {
    version: 1,
    id: 'evaluation-front-desk-load-1',
    snapshot: {
      snapshotId: 'snapshot-front-desk-1',
      problemId: 'problem-front-desk-automation',
      revision: '1',
      digest: digest(['snapshot-front-desk-1'])
    },
    objectiveRef,
    outcomeCaseRef: {
      id: 'outcome-front-desk-1',
      revision: '1',
      digest: digest(['outcome-front-desk-1'])
    },
    predictions: [],
    actuals: [],
    criteria: [],
    predictionComparisons: [],
    achievement: 'indeterminate',
    judgmentAtTimeValidity: { status: 'valid', basis: 'Pinned evaluation inputs were readable.' },
    evaluatedAt: '2026-04-01T00:00:00.000Z'
  };
}

function makeEvaluationPort(record: CompanyOsEvaluationRecord): LearningEvaluationPort {
  return {
    async read(id: string, access: EvaluationAccessContext) {
      if (id !== record.id) return null;
      if (!['owner-1', 'reader-1'].includes(access.principal)) {
        throw new CompanyOsLearningAdoptionError('authorization_denied', 'Evaluation current ACL denied the read');
      }
      return { ...record, snapshot: { ...record.snapshot }, objectiveRef: { ...record.objectiveRef }, outcomeCaseRef: { ...record.outcomeCaseRef }, predictions: [], actuals: [], criteria: [], predictionComparisons: [] };
    }
  };
}

async function makeHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-company-os-learning-adoption-'));
  dataDirs.push(dataDir);
  await initializePersonalOs(dataDir);
  const foundationStore = createFoundationRevisionStore({ dataDir });
  const inputRef = await foundationStore.create(variableDefinition('variable-front-desk-input'), { principal: 'owner-1' });
  const outputRef = await foundationStore.create(variableDefinition('variable-front-desk-output'), { principal: 'owner-1' });
  const initialModel = modelDefinition(inputRef, outputRef);
  const modelRef = await foundationStore.create(initialModel, { principal: 'owner-1' });
  const evaluation = evaluationRecord(modelRef);
  const evaluationPort = makeEvaluationPort(evaluation);
  const target = createFoundationLearningTargetPort({ foundationStore });
  const receipts = new Map<string, LearningRunReceipt>();
  const runReceipt: LearningRunReceiptPort = {
    async read(reference, access) {
      if (access.principal !== 'owner-1') {
        throw new CompanyOsLearningAdoptionError('authorization_denied', 'Run receipt current ACL denied the read');
      }
      const receipt = receipts.get(reference.id);
      return receipt ? JSON.parse(JSON.stringify(receipt)) as LearningRunReceipt : null;
    }
  };
  const store = createCompanyOsLearningAdoptionStore({
    dataDir,
    evaluation: evaluationPort,
    target,
    runReceipt,
    now: () => '2026-04-02T00:00:00.000Z'
  });
  const targetRef: LearningTargetReference = {
    kind: 'world_model',
    id: modelRef.id,
    revision: modelRef.revision,
    digest: modelRef.digest,
    foundationType: 'model'
  };
  const access = { principal: 'owner-1', scope } as const;
  return { dataDir, foundationStore, modelRef, initialModel, evaluation, store, targetRef, access, receipts };
}

function candidateRequest(harness: Awaited<ReturnType<typeof makeHarness>>, id = 'candidate-1') {
  return {
    id,
    sourceEvaluationRef: { id: harness.evaluation.id, digest: digestEvaluationRecord(harness.evaluation) },
    target: harness.targetRef,
    proposedChange: {
      definition: {
        ...harness.initialModel,
        relationship: 'Automation reduces direct handling time after accounting for handoff corrections.'
      }
    },
    grounds: ['Observed direct handling reduction in the pilot.'],
    counterexamples: ['Handoff corrections may increase total load.'],
    uncertainty: ['The pilot period is short.'],
    applicability: scope,
    createdAt: '2026-04-02T00:00:00.000Z',
    access: harness.access
  };
}

describe('company OS learning adoption', () => {
  it('keeps candidate, validation, adoption, planned selection, and actual receipt-backed use separate', async () => {
    const harness = await makeHarness();
    const candidate = await harness.store.createCandidate(candidateRequest(harness));
    expect(candidate.target.kind).toBe('world_model');
    expect(candidate.grounds).toHaveLength(1);
    expect(candidate.counterexamples).toHaveLength(1);
    expect(candidate.uncertainty).toHaveLength(1);

    const validation = await harness.store.createValidation({
      id: 'validation-1',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      findings: [{ kind: 'external_change', description: 'The pilot included a seasonal demand spike.', evidenceRefs: ['observation-seasonality-1'] }],
      conclusion: 'partially_supported',
      modelDisposition: 'revise',
      basis: 'The prediction gap is attributable to an external change, so the model remains a hypothesis.',
      validatedAt: '2026-04-02T01:00:00.000Z',
      access: harness.access
    });
    const adoption = await harness.store.adopt({
      id: 'adoption-1',
      idempotencyKey: 'adoption-key-1',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      validationRef: { id: validation.id, digest: validation.digest },
      access: harness.access
    });

    expect(adoption.previousTarget.revision).toBe('1');
    expect(adoption.adoptedTarget.revision).toBe('2');
    expect(adoption.targetValidationState).toBe('unverified');
    expect((await harness.store.readCandidate(candidate.id, harness.access))?.digest).toBe(candidate.digest);
    expect((await harness.store.readValidation(validation.id, harness.access))?.digest).toBe(validation.digest);
    expect((await harness.foundationStore.read(harness.modelRef, harness.access))?.digest).toBe(harness.modelRef.digest);

    const runUse = await harness.store.recordRunUse({
      id: 'run-use-1',
      runId: 'judgment-run-1',
      adoptionId: adoption.id,
      runPhase: 'planned',
      access: harness.access
    });
    expect(runUse.adoptedTarget).toEqual(adoption.adoptedTarget);
    expect(await harness.store.recordRunUse({
      id: 'run-use-1',
      runId: 'judgment-run-1',
      adoptionId: adoption.id,
      runPhase: 'planned',
      access: harness.access
    })).toEqual(runUse);
    await expect(harness.store.recordRunUse({
      id: 'run-use-1',
      runId: 'another-run',
      adoptionId: adoption.id,
      runPhase: 'planned',
      access: harness.access
    })).rejects.toMatchObject({ code: 'revision_conflict' });

    const receiptWithoutDigest: Omit<LearningRunReceipt, 'digest'> = {
      id: 'run-receipt-1',
      runId: 'judgment-run-actual',
      runPhase: 'actual',
      adoptedTarget: adoption.adoptedTarget
    };
    const receipt: LearningRunReceipt = {
      ...receiptWithoutDigest,
      digest: learningRunReceiptDigest(receiptWithoutDigest)
    };
    harness.receipts.set(receipt.id, receipt);
    const actualRunUse = await harness.store.recordRunUse({
      id: 'run-use-actual',
      runId: receipt.runId,
      adoptionId: adoption.id,
      runPhase: 'actual',
      receiptRef: { id: receipt.id, digest: receipt.digest },
      access: harness.access
    });
    expect(actualRunUse.runPhase).toBe('actual');
    expect(actualRunUse.receiptRef).toEqual({ id: receipt.id, digest: receipt.digest });
    expect(actualRunUse.adoptedTarget).toEqual(adoption.adoptedTarget);
    expect(await harness.store.readRunUse(actualRunUse.id, harness.access)).toEqual(actualRunUse);

    harness.receipts.set(receipt.id, { ...receipt, adoptedTarget: adoption.previousTarget });
    await expect(harness.store.readRunUse(actualRunUse.id, harness.access)).rejects.toMatchObject({ code: 'readback_mismatch' });
  }, 15000);

  it('rejects refutation based only on a prediction gap and denies adoption to a reader', async () => {
    const harness = await makeHarness();
    const candidate = await harness.store.createCandidate(candidateRequest(harness));
    await expect(harness.store.createValidation({
      id: 'validation-gap-only',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      findings: [{ kind: 'other', description: 'The observed value missed the prediction.', evidenceRefs: [] }],
      conclusion: 'rejected',
      modelDisposition: 'refuted',
      basis: 'Only the prediction gap is known.',
      validatedAt: '2026-04-02T01:00:00.000Z',
      access: harness.access
    })).rejects.toMatchObject({ code: 'invalid_validation' });

    const validation = await harness.store.createValidation({
      id: 'validation-2',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      findings: [{ kind: 'measurement_error', description: 'The source measurement omitted corrections.', evidenceRefs: ['measurement-1'] }],
      conclusion: 'indeterminate',
      modelDisposition: 'indeterminate',
      basis: 'The measurement needs correction before the model can be assessed.',
      validatedAt: '2026-04-02T01:00:00.000Z',
      access: harness.access
    });
    await harness.foundationStore.update({
      reference: harness.modelRef,
      next: { ...harness.initialModel, relationship: 'ACL was revoked after the candidate was created.', acl: { ...harness.initialModel.acl, readerIds: [] } }
    }, harness.access);
    await expect(harness.store.readCandidate(candidate.id, { principal: 'reader-1', scope })).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(harness.store.adopt({
      id: 'adoption-reader',
      idempotencyKey: 'adoption-reader-key',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      validationRef: { id: validation.id, digest: validation.digest },
      access: { principal: 'reader-1', scope }
    })).rejects.toMatchObject({ code: 'authorization_denied' });
  }, 15000);

  it('fails closed when the exact target revision has moved and when the ledger is corrupted', async () => {
    const harness = await makeHarness();
    const candidate = await harness.store.createCandidate(candidateRequest(harness));
    const validation = await harness.store.createValidation({
      id: 'validation-drift',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      findings: [{ kind: 'execution_difference', description: 'The pilot execution differed from the planned flow.', evidenceRefs: ['execution-1'] }],
      conclusion: 'indeterminate',
      modelDisposition: 'indeterminate',
      basis: 'The run must be repeated before changing the model.',
      validatedAt: '2026-04-02T01:00:00.000Z',
      access: harness.access
    });
    await harness.foundationStore.update({
      reference: harness.modelRef,
      next: { ...harness.initialModel, relationship: 'An independent update changed the model before adoption.' }
    }, harness.access);
    await expect(harness.store.adopt({
      id: 'adoption-drift',
      idempotencyKey: 'adoption-drift-key',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      validationRef: { id: validation.id, digest: validation.digest },
      access: harness.access
    })).rejects.toMatchObject({ code: 'revision_conflict' });

    const sidecarPath = join(harness.dataDir, COMPANY_OS_LEARNING_ADOPTION_SIDECAR);
    const sidecar = await readFile(sidecarPath, 'utf8');
    await writeFile(sidecarPath, `${sidecar}corrupt`, 'utf8');
    await expect(harness.store.readCandidate(candidate.id, harness.access)).rejects.toMatchObject({ code: 'corrupt_record' });
  }, 15000);

  it('exposes an exact learning adoption locator through the real store and rechecks ACL/target readback', async () => {
    const harness = await makeHarness();
    const candidate = await harness.store.createCandidate(candidateRequest(harness, 'candidate-knowledge-adapter'));
    const validation = await harness.store.createValidation({
      id: 'validation-knowledge-adapter',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      findings: [{
        kind: 'execution_difference',
        description: 'The pilot execution differed from the planned flow.',
        evidenceRefs: ['execution-knowledge-adapter-1']
      }],
      conclusion: 'indeterminate',
      modelDisposition: 'indeterminate',
      basis: 'The host must expose an exact promotion locator before it can be referenced by knowledge records.',
      validatedAt: '2026-04-02T01:00:00.000Z',
      access: harness.access
    });
    const adoption = await harness.store.adopt({
      id: 'adoption-knowledge-adapter',
      idempotencyKey: 'adoption-knowledge-adapter-key',
      candidateRef: { id: candidate.id, digest: candidate.digest },
      validationRef: { id: validation.id, digest: validation.digest },
      access: harness.access
    });

    // The host fixture identifies a candidate-promotion source by the real
    // adoption id. Its numeric revision belongs to that legacy source
    // record; it is not used as the adoption locator revision.
    const source = {
      kind: 'candidate_promotion' as const,
      id: adoption.id,
      revision: '1',
      digest: adoption.digest
    };
    const adoptionReads: string[] = [];
    const adoptionLocator = createLearningAdoptionLocator(adoption);
    expect(adoptionLocator).toEqual({
      id: adoption.id,
      schema: COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA,
      contentDigest: adoption.digest
    });
    const locatorReadPort = createLearningAdoptionLocatorReadPort(harness.store);
    await expect(locatorReadPort.read({ locator: adoptionLocator, access: harness.access })).resolves.toEqual(adoptionLocator);

    const adoptionPort: KnowledgeAdoptionReadPort = {
      async read({ source: requested, context }) {
        adoptionReads.push(requested.id);
        if (!requested.digest) return { status: 'unavailable' };
        const current = await locatorReadPort.read({
          locator: {
            id: requested.id,
            schema: COMPANY_OS_LEARNING_ADOPTION_LOCATOR_SCHEMA,
            contentDigest: requested.digest
          },
          access: { principal: context.principal, scope }
        });
        return current ? { status: 'recorded', adoption: current } : { status: 'unrecorded' };
      }
    };
    const adapter = createKnowledgeConditionAdapter({
      dataDir: harness.dataDir,
      recordPort: {
        async read({ source: requested }) {
          const current = await harness.store.readAdoption(requested.id, harness.access);
          if (!current) return { source_status: 'not_found' as const, acl_status: 'allowed' as const };
          return {
            source_status: 'present' as const,
            acl_status: 'allowed' as const,
            source: requested,
            provenance: [{
              kind: 'learning_validation',
              id: current.validationRef.id,
              digest: current.validationRef.digest
            }]
          };
        }
      },
      adoptionPort
    });

    const attached = await adapter.attach(source, adapterConditions(), { principal: harness.access.principal });
    expect(attached).toMatchObject({
      source_status: 'present',
      condition_status: 'recorded',
      adoption_status: 'recorded',
      adoption: adoptionLocator
    });
    await expect(adapter.read(source, { principal: harness.access.principal })).resolves.toMatchObject({
      condition_status: 'recorded',
      adoption_status: 'recorded',
      adoption: adoptionLocator
    });
    expect(adoptionReads).toEqual([adoption.id, adoption.id]);

    await expect(harness.store.readAdoptionByLocator({
      ...adoptionLocator,
      contentDigest: `sha256:${'0'.repeat(64)}`
    }, harness.access)).rejects.toMatchObject({ code: 'integrity_mismatch' });

    await harness.foundationStore.update({
      reference: {
        id: adoption.adoptedTarget.id,
        type: 'model',
        revision: adoption.adoptedTarget.revision,
        digest: adoption.adoptedTarget.digest
      },
      next: {
        ...harness.initialModel,
        revision: adoption.adoptedTarget.revision,
        relationship: 'Current ACL changed after adoption.',
        acl: { ...harness.initialModel.acl, readerIds: [] }
      }
    }, harness.access);
    await expect(locatorReadPort.read({
      locator: adoptionLocator,
      access: { principal: 'reader-1', scope }
    })).rejects.toMatchObject({ code: 'authorization_denied' });
  }, 15000);
});
