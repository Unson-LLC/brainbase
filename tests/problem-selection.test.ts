import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoundationScope, ObjectiveDefinition } from '../src/ontology-foundation.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs } from '../src/ssot.js';
import type {
  ProblemCandidateRecord,
  ProblemCandidateStore,
  ProblemCandidateStoreContext
} from '../src/problem-candidates.js';
import {
  createProblemSelection,
  createProblemSelectionRecordStore,
  evaluateProblemSelectionWithComposition,
  type JudgmentDAGCompositionRunHistoryProducer,
  type ProblemSelectionCandidateAssessment,
  type ProblemSelectionEvaluationResult,
  type ProblemSelectionFixedConditions,
  type ProblemSelectionObjectiveConflict,
  type ProblemSelectionRequest,
  type ProblemSelectionCandidateReference,
  type ProblemSelectionFoundationReference
} from '../src/problem-selection.js';
import type {
  JudgmentDAGCompositionDefinition,
  JudgmentDAGCompositionRunRequest,
  JudgmentDAGProblemSnapshotReference,
  JudgmentDAGSubDAGResult
} from '../src/judgment-dag-composition.js';
import { executeJudgmentDAGComposition } from '../src/judgment-dag-composition.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scope: FoundationScope = {
  subjectIds: ['hotel-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
};

const otherHotelScope: FoundationScope = {
  subjectIds: ['hotel-2'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
};

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const objectiveRef: ProblemSelectionFoundationReference = {
  id: 'objective-reduce-front-load',
  type: 'objective',
  revision: '1',
  digest: digest('a')
};

const constraintRef: ProblemSelectionFoundationReference = {
  id: 'constraint-no-double-entry',
  type: 'constraint',
  revision: '1',
  digest: digest('b')
};

const selectionProblem: JudgmentDAGProblemSnapshotReference = {
  snapshot_id: digest('c') as `sha256:${string}`,
  problem_id: 'problem-selection-meta-1',
  revision: '1'
};

const selectionComposition: JudgmentDAGCompositionDefinition = {
  composition_id: 'problem-selection-comparison',
  composition_version: '1.0.0',
  scope: { type: 'project', id: 'hotel-project' },
  parent_dag: { id: 'problem-selection-parent', version: '1.0.0' },
  children: [{
    invocation_id: 'compare',
    dag: { id: 'problem-selection-compare', version: '1.0.0' },
    question: 'Which candidate should be selected?',
    input_contract: 'problem-selection.v1',
    output_contract: 'problem-selection.result.v1',
    required_capabilities: [],
    depends_on: []
  }]
};

const fixedConditions: ProblemSelectionFixedConditions = {
  objectiveRefs: [objectiveRef],
  constraintRefs: [constraintRef],
  conditionalPreferences: [{ id: 'preference-quality', condition: 'quality would fall', preference: 'hold for review' }],
  delegatedJudgments: [{ id: 'delegate-1', question: 'Can the operator support the change?', ownerId: 'person-1' }],
  costs: {
    switching: { status: 'known', value: 2 },
    opportunity: { status: 'known', value: 3 },
    exploration: { status: 'known', value: 1 }
  },
  explorationLimit: { maxCandidates: 2, maxExplorationCost: { status: 'known', value: 10 } },
  evaluatedAt: '2026-06-20T00:00:00.000Z'
};

function candidateRecord(id: string, payloadCharacter: string): ProblemCandidateRecord {
  return {
    contractVersion: 'problem-candidates.v1',
    id,
    kind: 'gap',
    statement: `private candidate statement for ${id}`,
    objectiveRefs: [objectiveRef],
    event: {
      id: `event-${id}`,
      occurredAt: '2026-06-10T01:00:00.000Z',
      recordedAt: '2026-06-11T01:00:00.000Z',
      sourceRefs: [{ id: `observation-${id}`, kind: 'observation', digest: digest('d') }]
    },
    observedGap: { status: 'known', value: 'Handoff work is not yet measured.' },
    opportunity: { status: 'unknown', reason: 'No validated intervention yet.' },
    threat: { status: 'unknown', reason: 'Quality impact is not yet measured.' },
    uncertainty: { status: 'known', value: 'The sample is incomplete.' },
    deadline: { status: 'unknown', reason: 'No deadline has been agreed.' },
    expectedEffect: { status: 'known', value: 'A focused review may reduce avoidable work.' },
    requiredResources: { status: 'unknown', reason: 'Resource estimate is not available.' },
    responsibleId: { status: 'known', value: 'person-1' },
    ownerScope: scope,
    acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
    status: 'candidate',
    mergedFrom: [],
    createdAt: '2026-06-11T01:00:00.000Z',
    updatedAt: '2026-06-11T01:00:00.000Z',
    provenance: {
      eventIds: [`event-${id}`],
      sourceRefs: [{ id: `observation-${id}`, kind: 'observation', digest: digest('d') }],
      candidateIds: []
    },
    payloadDigest: digest(payloadCharacter)
  };
}

function candidateReference(record: ProblemCandidateRecord): ProblemSelectionCandidateReference {
  return { candidateId: record.id, payloadDigest: record.payloadDigest, ownerScope: record.ownerScope };
}

function inMemoryCandidateStore(records: readonly ProblemCandidateRecord[]): ProblemCandidateStore {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    readCandidate: vi.fn(async (id: string, _context: ProblemCandidateStoreContext) => byId.get(id) ?? null),
    saveCandidate: vi.fn(),
    saveProblemCandidate: vi.fn(),
    mergeCandidates: vi.fn(),
    listCandidates: vi.fn()
  } as unknown as ProblemCandidateStore;
}

function request(
  records: readonly ProblemCandidateRecord[],
  evaluation: ProblemSelectionEvaluationResult,
  overrides: Partial<ProblemSelectionRequest> = {}
): ProblemSelectionRequest {
  const store = inMemoryCandidateStore(records);
  return {
    selectionId: 'selection-1',
    selectionProblem,
    selectionComposition,
    ownerScope: scope,
    readPolicy: { ownerId: 'org-1', visibility: 'private', readerIds: ['reviewer-1'], writerIds: ['org-1'] },
    fixedConditions,
    candidateRefs: records.map(candidateReference),
    candidateStore: store,
    candidateContext: { principal: 'org-1' },
    evaluator: { evaluate: vi.fn(async () => evaluation) },
    createdAt: '2026-06-20T01:00:00.000Z',
    ...overrides
  };
}

const selected = (action: 'start' | 'continue' | 'observe' | 'hold' | 'stop'): ProblemSelectionEvaluationResult => ({
  status: 'selected',
  selectedCandidateId: 'candidate-1',
  action,
  reason: `selected for ${action}`,
  ...(action === 'hold' ? { reviewAt: '2026-07-01T00:00:00.000Z' } : {})
});

function assessmentFor(
  record: ProblemCandidateRecord,
  overrides: Partial<Omit<ProblemSelectionCandidateAssessment, 'reference'>> = {}
): ProblemSelectionCandidateAssessment {
  return {
    reference: candidateReference(record),
    status: 'eligible',
    rationale: 'candidate is comparable',
    conditions: [],
    costs: fixedConditions.costs,
    unknowns: [],
    objectiveConflicts: [],
    ...overrides
  };
}

const policyConflict: ProblemSelectionObjectiveConflict = {
  objectiveIds: [objectiveRef.id, 'objective-quality'],
  reason: 'quality and load cannot be compared under the fixed criteria'
};

function compositionRunRequestForHistory(
  port: JudgmentDAGCompositionRunRequest['port'],
  overrides: Partial<JudgmentDAGCompositionRunRequest> = {}
): JudgmentDAGCompositionRunRequest {
  const child = selectionComposition.children[0];
  if (child === undefined) throw new Error('history test composition child is missing');
  const request: JudgmentDAGCompositionRunRequest = {
    run_id: 'composition-history-test-run',
    composition: selectionComposition,
    question: 'Which candidate should be selected?',
    input: { candidate_count: 1 },
    problem_snapshot: selectionProblem,
    fixed_conditions: { objective: objectiveRef.id, constraint: constraintRef.id },
    delegation: { scope: selectionComposition.scope, capabilities: [] },
    snapshot_reader: {
      read: async ({ reference }) => ({
        status: 'resolved' as const,
        reference_resolution: 'current' as const,
        reference,
        snapshot: {
          snapshot_version: 'judgment-problem-snapshot.v1',
          problem_id: reference.problem_id,
          revision: reference.revision
        }
      })
    },
    dag_resolver: {
      resolve: ({ invocation_id, dag }) => {
        const resolvedChild = invocation_id === undefined
          ? undefined
          : selectionComposition.children.find((entry) => entry.invocation_id === invocation_id);
        return {
          dag,
          input_contract: resolvedChild?.input_contract ?? 'problem-selection-parent-input.v1',
          output_contract: resolvedChild?.output_contract ?? 'problem-selection-parent-output.v1'
        };
      }
    },
    contract_validator: { validate: () => undefined },
    port,
    ...overrides
  };
  return request;
}

function compositionResultForHistory(status: 'completed' | 'failed' | 'held' = 'completed'): JudgmentDAGSubDAGResult {
  const child = selectionComposition.children[0];
  if (child === undefined) throw new Error('history test composition child is missing');
  return {
    status,
    input_contract: child.input_contract,
    output_contract: child.output_contract,
    run_reference: status === 'completed'
      ? { run_id: 'child-composition-run', dag: child.dag }
      : null,
    conclusion: status === 'completed' ? selected('start') : { unavailable: true },
    evidence: [],
    applicability: {},
    uncertainty: {},
    ...(status === 'completed' ? {} : { reason: status === 'failed' ? 'child evaluation failed' : 'child evaluation held' })
  };
}

function historyProducerOptions(producer: JudgmentDAGCompositionRunHistoryProducer) {
  return {
    producer,
    binding: {
      organization_id: 'organization-1',
      tenant_id: 'tenant-1',
      owner_person_id: 'person-1',
      project_code: 'hotel-project',
      turn_ref: 'turn-1'
    },
    source: { producer: 'company_os' as const, producer_revision: 'company-os-test' },
    references: { problem_snapshot: selectionProblem, foundation: [], evidence: [] },
    started: {
      lifecycle_event_id: 'history-event-started',
      recorded_at: '2026-10-08T00:00:00.000Z'
    },
    terminal: {
      lifecycle_event_id: 'history-event-terminal',
      recorded_at: '2026-10-08T00:00:01.000Z'
    }
  };
}

async function expectSelectedPolicyMutationRejected(
  records: readonly ProblemCandidateRecord[],
  mutate: (record: Record<string, unknown>) => void,
  reason: string
): Promise<void> {
  const record = await createProblemSelection(request(records, selected('start')));
  const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-policy-'));
  temporaryRoots.push(root);
  const store = createProblemSelectionRecordStore({ root });
  const malformed = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  mutate(malformed);

  await expect(store.save(malformed as typeof record, { principal: 'org-1' }))
    .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining(reason) });

  const receipt = await store.save(record, { principal: 'org-1' });
  const [filename] = await readdir(join(root, 'problem-selections'));
  if (filename === undefined) throw new Error('selection record was not written');
  const recordPath = join(root, 'problem-selections', filename);
  const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as { record: Record<string, unknown> };
  mutate(envelope.record);
  await writeFile(recordPath, `${JSON.stringify(envelope)}\n`, 'utf8');

  await expect(store.read(receipt.recordId, { principal: 'org-1' }))
    .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining(reason) });
}

describe('problem selection contract', () => {
  it.each(['start', 'continue', 'observe', 'hold', 'stop'] as const)(
    'records the explicit %s action without issuing authority',
    async (action) => {
      const record = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected(action)));

      expect(record.status).toBe('selected');
      expect(record.decision.action).toBe(action);
      expect(record.executionPermission).toBe('none');
      expect(record.resourceAuthority).toBe('none');
      expect(record.objectiveChange).toBe('none');
      if (action === 'start' || action === 'continue') {
        expect(record.problemCreationRequest).toMatchObject({
          status: 'required',
          action,
          completeSnapshotRequired: true
        });
      } else {
        expect(record.problemCreationRequest).toBeUndefined();
      }
    }
  );

  it('compares candidate references without requiring a complete Problem for every candidate', async () => {
    const records = [candidateRecord('candidate-1', 'e'), candidateRecord('candidate-2', 'f')];
    const evaluator = vi.fn(async (input: { candidates: readonly { record: ProblemCandidateRecord }[] }) => {
      expect(input.candidates).toHaveLength(2);
      expect(input.candidates.map((item) => item.record.statement)).toEqual([
        'private candidate statement for candidate-1',
        'private candidate statement for candidate-2'
      ]);
      return selected('start');
    });
    const result = await createProblemSelection(request(records, selected('start'), { evaluator: { evaluate: evaluator } }));

    expect(result.problemCreationRequest?.candidate.candidateId).toBe('candidate-1');
    expect(result.problemCreationRequest?.completeSnapshotRequired).toBe(true);
    expect(result).not.toHaveProperty('problem');
    expect(result).not.toHaveProperty('candidate-1.statement');
    expect(JSON.stringify(result)).not.toContain('private candidate statement');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('routes a candidate outside the selection scope to human review and rejects selected scope crossings', async () => {
    const outsideCandidate = { ...candidateRecord('candidate-1', 'e'), ownerScope: otherHotelScope };
    const evaluator = vi.fn(async () => selected('start'));
    const review = await createProblemSelection(request([outsideCandidate], selected('start'), {
      evaluator: { evaluate: evaluator }
    }));

    expect(review.status).toBe('human_review_required');
    expect(review.assessments[0]?.status).toBe('unavailable');
    expect(review.assessments[0]?.rationale).toContain('outside selection owner scope');
    expect(evaluator).not.toHaveBeenCalled();

    const reviewRoot = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-scope-review-'));
    temporaryRoots.push(reviewRoot);
    const reviewStore = createProblemSelectionRecordStore({ root: reviewRoot });
    await expect(reviewStore.save(review, { principal: 'org-1' })).resolves.toMatchObject({ status: 'created' });

    const selectedRecord = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('start')));
    const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-scope-boundary-'));
    temporaryRoots.push(root);
    const store = createProblemSelectionRecordStore({ root });

    const moveCandidateScopeOutside = (record: Record<string, unknown>): void => {
      const candidateRefs = record.candidateRefs as Array<Record<string, unknown>>;
      const reference = candidateRefs[0];
      if (reference === undefined) throw new Error('selection candidate reference was not written');
      const outsideReference = { ...reference, ownerScope: otherHotelScope };
      candidateRefs[0] = outsideReference;
      const assessments = record.assessments as Array<Record<string, unknown>>;
      const assessment = assessments[0];
      if (assessment === undefined) throw new Error('selection assessment was not written');
      assessment.reference = outsideReference;
      const decision = record.decision as Record<string, unknown>;
      decision.candidate = outsideReference;
      const problemCreationRequest = record.problemCreationRequest as Record<string, unknown> | undefined;
      if (problemCreationRequest !== undefined) problemCreationRequest.candidate = outsideReference;
    };

    const malformed = JSON.parse(JSON.stringify(selectedRecord)) as Record<string, unknown>;
    moveCandidateScopeOutside(malformed);
    await expect(store.save(malformed as typeof selectedRecord, { principal: 'org-1' }))
      .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining('outside selection owner scope') });

    const receipt = await store.save(selectedRecord, { principal: 'org-1' });
    const [filename] = await readdir(join(root, 'problem-selections'));
    if (filename === undefined) throw new Error('selection record was not written');
    const recordPath = join(root, 'problem-selections', filename);
    const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as { record: Record<string, unknown> };
    moveCandidateScopeOutside(envelope.record);
    await writeFile(recordPath, `${JSON.stringify(envelope)}\n`, 'utf8');
    await expect(store.read(receipt.recordId, { principal: 'org-1' }))
      .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining('outside selection owner scope') });
  });

  it('keeps unresolved cost unknown and routes ordinary actions to human review', async () => {
    const unknownConditions: ProblemSelectionFixedConditions = {
      ...fixedConditions,
      costs: { ...fixedConditions.costs, switching: { status: 'unknown', reason: 'switching cost not measured' } }
    };
    const result = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('start'), {
      fixedConditions: unknownConditions
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.problemCreationRequest).toBeUndefined();
    expect(result.unknowns).toContainEqual({ status: 'unknown', reason: 'switching cost not measured' });
    expect(result.fixedConditions.costs.switching).toEqual({ status: 'unknown', reason: 'switching cost not measured' });
  });

  it('permits observe as an explicit next action while preserving unknowns', async () => {
    const unknownConditions: ProblemSelectionFixedConditions = {
      ...fixedConditions,
      costs: { ...fixedConditions.costs, exploration: { status: 'unknown', reason: 'exploration cost not estimated' } }
    };
    const result = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('observe'), {
      fixedConditions: unknownConditions
    }));

    expect(result.status).toBe('selected');
    expect(result.decision.action).toBe('observe');
    expect(result.unknowns).toContainEqual({ status: 'unknown', reason: 'exploration cost not estimated' });
    expect(result.problemCreationRequest).toBeUndefined();
  });

  it('retains objective conflicts and returns human review', async () => {
    const result = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], {
      ...selected('start'),
      objectiveConflicts: [{ objectiveIds: [objectiveRef.id, 'objective-quality'], reason: 'quality and load cannot be compared under the fixed criteria' }]
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.objectiveConflicts).toEqual([{
      objectiveIds: [objectiveRef.id, 'objective-quality'],
      reason: 'quality and load cannot be compared under the fixed criteria'
    }]);
    expect(result.decision.reason).toContain('objective criteria are incomparable');
  });

  it('returns human review when the selected candidate exceeds the fixed exploration cost limit', async () => {
    const record = candidateRecord('candidate-1', 'e');
    const result = await createProblemSelection(request([record], {
      ...selected('start'),
      assessments: [{
        reference: candidateReference(record),
        status: 'eligible',
        rationale: 'candidate is comparable',
        conditions: [],
        costs: { ...fixedConditions.costs, exploration: { status: 'known', value: 11 } },
        unknowns: [],
        objectiveConflicts: []
      }]
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.problemCreationRequest).toBeUndefined();
    expect(result.decision.reason).toContain('exploration cost 11 exceeds the fixed exploration limit 10');
  });

  it('promotes an unknown assessment status into the record unknown set', async () => {
    const record = candidateRecord('candidate-1', 'e');
    const result = await createProblemSelection(request([record], {
      ...selected('start'),
      assessments: [{
        reference: candidateReference(record),
        status: 'unknown',
        rationale: 'candidate fit could not be established',
        conditions: [],
        costs: fixedConditions.costs,
        unknowns: [],
        objectiveConflicts: []
      }]
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.problemCreationRequest).toBeUndefined();
    expect(result.unknowns).toContainEqual({ status: 'unknown', reason: 'candidate fit could not be established' });
  });

  it('promotes unknown typed assessment costs into the record unknown set', async () => {
    const record = candidateRecord('candidate-1', 'e');
    const result = await createProblemSelection(request([record], {
      ...selected('start'),
      assessments: [{
        reference: candidateReference(record),
        status: 'eligible',
        rationale: 'candidate is otherwise comparable',
        conditions: [],
        costs: { ...fixedConditions.costs, exploration: { status: 'unknown', reason: 'candidate exploration cost is not measured' } },
        unknowns: [],
        objectiveConflicts: []
      }]
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.problemCreationRequest).toBeUndefined();
    expect(result.unknowns).toContainEqual({ status: 'unknown', reason: 'candidate exploration cost is not measured' });
  });

  it('does not accept an incomplete selected evaluation', async () => {
    const result = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], {
      status: 'selected',
      reason: 'the evaluator omitted the selected candidate and action'
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.problemCreationRequest).toBeUndefined();
    expect(result.decision.reason).toContain('selected evaluation must include selectedCandidateId and action');
  });

  it('does not compare a candidate whose current digest or ACL cannot be verified', async () => {
    const record = candidateRecord('candidate-1', 'e');
    const staleReference = { ...candidateReference(record), payloadDigest: digest('f') };
    const evaluator = vi.fn(async () => selected('start'));
    const result = await createProblemSelection(request([record], selected('start'), {
      candidateRefs: [staleReference],
      evaluator: { evaluate: evaluator }
    }));

    expect(result.status).toBe('human_review_required');
    expect(result.assessments[0]?.status).toBe('unavailable');
    expect(evaluator).not.toHaveBeenCalled();

    const inaccessibleStore: ProblemCandidateStore = {
      ...inMemoryCandidateStore([record]),
      readCandidate: vi.fn(async () => { throw new Error('current candidate ACL denied'); })
    } as ProblemCandidateStore;
    const denied = await createProblemSelection(request([record], selected('start'), {
      candidateStore: inaccessibleStore
    }));
    expect(denied.status).toBe('human_review_required');
    expect(denied.assessments[0]?.rationale).toContain('ACL denied');
  });
});

describe('problem selection record store', () => {
  it('round-trips an immutable content-addressed record and rejects ACL or tampering', async () => {
    const record = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('start')));
    const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-'));
    temporaryRoots.push(root);
    const store = createProblemSelectionRecordStore({ root });

    const receipt = await store.save(record, { principal: 'org-1' });
    expect(receipt.status).toBe('created');
    await expect(store.save(record, { principal: 'org-1' })).resolves.toMatchObject({ status: 'existing', recordId: receipt.recordId });
    await expect(store.read(receipt.recordId, { principal: 'reviewer-1' })).resolves.toEqual(record);
    await expect(store.read(receipt.recordId, { principal: 'intruder' })).rejects.toMatchObject({ code: 'access_denied' });

    const [filename] = await readdir(join(root, 'problem-selections'));
    if (filename === undefined) throw new Error('selection record was not written');
    const recordPath = join(root, 'problem-selections', filename);
    const bytes = await readFile(recordPath, 'utf8');
    await writeFile(recordPath, bytes.replace('selected for start', 'tampered selection reason'), 'utf8');
    await expect(store.read(receipt.recordId, { principal: 'reviewer-1' })).rejects.toMatchObject({ code: 'integrity_mismatch' });
  });

  it.each([
    ['decision candidate', (record: Record<string, unknown>) => {
      const decision = record.decision as Record<string, unknown>;
      delete decision.candidate;
    }],
    ['decision action', (record: Record<string, unknown>) => {
      const decision = record.decision as Record<string, unknown>;
      delete decision.action;
    }],
    ['problem creation request', (record: Record<string, unknown>) => {
      delete record.problemCreationRequest;
    }]
  ] as const)('rejects a selected record missing %s at the save boundary', async (_label, mutate) => {
    const record = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('start')));
    const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-invalid-'));
    temporaryRoots.push(root);
    const malformed = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    mutate(malformed);

    await expect(createProblemSelectionRecordStore({ root }).save(malformed as typeof record, { principal: 'org-1' }))
      .rejects.toMatchObject({ code: 'invalid_record' });
  });

  it('rejects a selected record missing a required field at the load boundary', async () => {
    const record = await createProblemSelection(request([candidateRecord('candidate-1', 'e')], selected('start')));
    const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-invalid-load-'));
    temporaryRoots.push(root);
    const store = createProblemSelectionRecordStore({ root });
    const receipt = await store.save(record, { principal: 'org-1' });
    const [filename] = await readdir(join(root, 'problem-selections'));
    if (filename === undefined) throw new Error('selection record was not written');
    const recordPath = join(root, 'problem-selections', filename);
    const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as { record: { decision: Record<string, unknown> } };
    delete envelope.record.decision.candidate;
    await writeFile(recordPath, `${JSON.stringify(envelope)}\n`, 'utf8');

    await expect(store.read(receipt.recordId, { principal: 'org-1' })).rejects.toMatchObject({ code: 'invalid_record' });
  });

  it('revalidates the candidate count policy at save and load boundaries', async () => {
    const records = [candidateRecord('candidate-1', 'e'), candidateRecord('candidate-2', 'f')];
    await expectSelectedPolicyMutationRejected(records, (record) => {
      const fixed = record.fixedConditions as Record<string, unknown>;
      const explorationLimit = fixed.explorationLimit as Record<string, unknown>;
      explorationLimit.maxCandidates = 1;
    }, 'candidate count 2 exceeds the fixed exploration limit 1');
  });

  it('revalidates assessment unknowns at save and load boundaries', async () => {
    await expectSelectedPolicyMutationRejected([candidateRecord('candidate-1', 'e')], (record) => {
      const assessments = record.assessments as Array<Record<string, unknown>>;
      const assessment = assessments[0];
      if (assessment === undefined) throw new Error('selection assessment was not written');
      assessment.status = 'unknown';
    }, 'unresolved unknowns remain');
  });

  it('revalidates typed exploration cost limits at save and load boundaries', async () => {
    await expectSelectedPolicyMutationRejected([candidateRecord('candidate-1', 'e')], (record) => {
      const assessments = record.assessments as Array<Record<string, unknown>>;
      const assessment = assessments[0];
      if (assessment === undefined) throw new Error('selection assessment was not written');
      const costs = assessment.costs as Record<string, unknown>;
      costs.exploration = { status: 'known', value: 11 };
    }, 'selected candidate exploration cost 11 exceeds the fixed exploration limit 10');
  });

  it.each([
    {
      name: 'record-level objective conflict',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: { ...selected('start'), objectiveConflicts: [policyConflict] },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => { record.objectiveConflicts = [policyConflict]; },
      reason: 'objective criteria are incomparable'
    },
    {
      name: 'assessment-level objective conflict',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), { objectiveConflicts: [policyConflict] })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        assessment.objectiveConflicts = [policyConflict];
      },
      reason: 'objective criteria are incomparable'
    },
    {
      name: 'assessment incomparable status',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), { status: 'incomparable' })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        assessment.status = 'incomparable';
      },
      reason: 'comparison is not fully available'
    },
    {
      name: 'assessment unavailable status',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), { status: 'unavailable' })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        assessment.status = 'unavailable';
      },
      reason: 'comparison is not fully available'
    },
    {
      name: 'assessment unknown status',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), { status: 'unknown', rationale: 'candidate fit is not established' })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        assessment.status = 'unknown';
      },
      reason: 'unresolved unknowns remain'
    },
    {
      name: 'typed unknown exploration cost',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), {
          costs: { ...fixedConditions.costs, exploration: { status: 'unknown', reason: 'candidate exploration cost is not measured' } }
        })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        const costs = assessment.costs as Record<string, unknown>;
        costs.exploration = { status: 'unknown', reason: 'candidate exploration cost is not measured' };
      },
      reason: 'unresolved unknowns remain'
    },
    {
      name: 'typed exploration cost over limit',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('start'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), {
          costs: { ...fixedConditions.costs, exploration: { status: 'known', value: 11 } }
        })]
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const assessments = record.assessments as Array<Record<string, unknown>>;
        const assessment = assessments[0];
        if (assessment === undefined) throw new Error('selection assessment was not written');
        const costs = assessment.costs as Record<string, unknown>;
        costs.exploration = { status: 'known', value: 11 };
      },
      reason: 'selected candidate exploration cost 11 exceeds the fixed exploration limit 10'
    },
    {
      name: 'candidate count over limit',
      records: [candidateRecord('candidate-1', 'e'), candidateRecord('candidate-2', 'f')],
      evaluation: selected('start'),
      requestOverrides: {
        fixedConditions: { ...fixedConditions, explorationLimit: { ...fixedConditions.explorationLimit, maxCandidates: 1 } }
      },
      expectedGenerationStatus: 'human_review_required' as const,
      expectedPersistence: 'reject' as const,
      mutate: (record: Record<string, unknown>) => {
        const fixed = record.fixedConditions as Record<string, unknown>;
        const explorationLimit = fixed.explorationLimit as Record<string, unknown>;
        explorationLimit.maxCandidates = 1;
      },
      reason: 'candidate count 2 exceeds the fixed exploration limit 1'
    },
    {
      name: 'observe preserves unknowns',
      records: [candidateRecord('candidate-1', 'e')],
      evaluation: {
        ...selected('observe'),
        assessments: [assessmentFor(candidateRecord('candidate-1', 'e'), { status: 'unknown', rationale: 'candidate fit is not established' })]
      },
      expectedGenerationStatus: 'selected' as const,
      expectedPersistence: 'accept' as const,
      mutate: undefined,
      reason: ''
    }
  ])('keeps generation and persistence policy aligned: $name', async ({
    records,
    evaluation,
    requestOverrides,
    expectedGenerationStatus,
    expectedPersistence,
    mutate,
    reason
  }) => {
    const generated = await createProblemSelection(request(records, evaluation, requestOverrides ?? {}));
    expect(generated.status).toBe(expectedGenerationStatus);
    const root = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-policy-table-'));
    temporaryRoots.push(root);
    const store = createProblemSelectionRecordStore({ root });

    if (expectedPersistence === 'accept') {
      const receipt = await store.save(generated, { principal: 'org-1' });
      expect(receipt.status).toBe('created');
      await expect(store.read(receipt.recordId, { principal: 'org-1' })).resolves.toEqual(generated);
      return;
    }

    if (mutate === undefined) throw new Error('rejected policy case must provide a record mutation');
    const baseline = await createProblemSelection(request(records, selected('start')));
    const malformed = JSON.parse(JSON.stringify(baseline)) as Record<string, unknown>;
    mutate(malformed);
    await expect(store.save(malformed as typeof baseline, { principal: 'org-1' }))
      .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining(reason) });

    const receipt = await store.save(baseline, { principal: 'org-1' });
    const [filename] = await readdir(join(root, 'problem-selections'));
    if (filename === undefined) throw new Error('selection record was not written');
    const recordPath = join(root, 'problem-selections', filename);
    const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as { record: Record<string, unknown> };
    mutate(envelope.record);
    await writeFile(recordPath, `${JSON.stringify(envelope)}\n`, 'utf8');
    await expect(store.read(receipt.recordId, { principal: 'org-1' }))
      .rejects.toMatchObject({ code: 'invalid_record', message: expect.stringContaining(reason) });
  });
});

describe('problem selection with the canonical candidate store', () => {
  it('uses the current Objective and candidate ACL boundary before evaluation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-problem-selection-candidate-'));
    temporaryRoots.push(dataDir);
    await initializePersonalOs(dataDir);
    const foundationStore = createFoundationRevisionStore({ dataDir });
    const objective: ObjectiveDefinition = {
      id: objectiveRef.id,
      type: 'objective',
      revision: '1',
      meaning: 'Reduce total front-desk response load.',
      epistemicState: 'supported',
      adoptionState: 'approved',
      authorizedUses: ['draft', 'judgment', 'evaluation'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
      storage: 'ontology',
      provenance: [{ sourceId: 'decision-1', sourceKind: 'decision', evidenceIds: ['evidence-1'] }],
      scope,
      beneficiaryIds: ['org-1'],
      desiredState: 'Front-desk response load is lower.',
      criteria: [],
      evaluationPeriod: { from: scope.validFrom, until: scope.validUntil as string }
    };
    const objectiveRevision = await foundationStore.create(objective, { principal: 'org-1' });
    const candidateStoreModule = await import('../src/problem-candidates.js');
    const candidateStore = candidateStoreModule.createProblemCandidateStore({
      dataDir,
      foundationStore,
      evidenceAccessProvider: { authorize: () => true }
    });
    const input = {
      id: 'candidate-1',
      kind: 'gap' as const,
      statement: 'A candidate gap is visible to the owner.',
      objectiveRefs: [{ ...objectiveRevision, type: 'objective' as const }],
      event: {
        id: 'event-candidate-1',
        occurredAt: '2026-06-10T01:00:00.000Z',
        recordedAt: '2026-06-11T01:00:00.000Z',
        sourceRefs: [{ id: 'observation-candidate-1', kind: 'observation' as const }]
      },
      observedGap: { status: 'known' as const, value: 'The handoff rate is not measured.' },
      opportunity: { status: 'unknown' as const, reason: 'No intervention is validated.' },
      threat: { status: 'unknown' as const, reason: 'Quality impact is not measured.' },
      uncertainty: { status: 'known' as const, value: 'The sample is incomplete.' },
      deadline: { status: 'unknown' as const, reason: 'No deadline.' },
      expectedEffect: { status: 'known' as const, value: 'A review may reduce load.' },
      requiredResources: { status: 'unknown' as const, reason: 'No estimate.' },
      responsibleId: { status: 'known' as const, value: 'person-1' },
      ownerScope: scope,
      acl: { ownerId: 'org-1', visibility: 'organization' as const, readerIds: ['person-1'], writerIds: ['org-1'] }
    };
    const saved = await candidateStore.saveCandidate(input, { principal: 'org-1' });
    const result = await createProblemSelection(request([saved], selected('start'), {
      fixedConditions: { ...fixedConditions, objectiveRefs: [{ ...objectiveRevision, type: 'objective' as const }] },
      candidateStore,
      candidateContext: { principal: 'person-1' }
    }));

    expect(result.status).toBe('selected');
    expect(result.problemCreationRequest?.candidate.payloadDigest).toBe(saved.payloadDigest);
    expect(JSON.stringify(result)).not.toContain(input.statement);
  });
});

describe('problem selection CompositionRun history producer boundary', () => {
  it('appends started and the exact terminal run before deriving the selection', async () => {
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
      })
    };
    const compositionRequest = compositionRunRequestForHistory({
      execute: async () => compositionResultForHistory()
    });
    const expectedRun = await executeJudgmentDAGComposition(compositionRequest);

    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest,
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result).toEqual(selected('start'));
    expect(producer.append).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      run_id: compositionRequest.run_id,
      lifecycle: {
        state: 'started',
        lifecycle_event_id: 'history-event-started',
        recorded_at: '2026-10-08T00:00:00.000Z',
        failure: null
      },
      composition_run: null
    });
    expect(events[1]).toMatchObject({
      run_id: compositionRequest.run_id,
      lifecycle: {
        state: 'completed',
        lifecycle_event_id: 'history-event-terminal',
        recorded_at: '2026-10-08T00:00:01.000Z',
        failure: null
      },
      composition_run: {
        run_id: compositionRequest.run_id,
        status: 'completed',
        problem_snapshot: compositionRequest.problem_snapshot
      }
    });
    expect((events[1] as { composition_run: unknown }).composition_run).toEqual(expectedRun);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen((events[0] as { binding: unknown }).binding)).toBe(true);
  });

  it('persists a returned failed run without converting it to a successful selection', async () => {
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
      })
    };
    const compositionRequest = compositionRunRequestForHistory({
      execute: async () => compositionResultForHistory('failed')
    });

    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest,
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result.status).toBe('human_review_required');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      lifecycle: { state: 'failed', failure: null },
      composition_run: { run_id: compositionRequest.run_id, status: 'failed' }
    });
  });

  it('persists a returned held run without converting it to a successful selection', async () => {
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
      })
    };
    const compositionRequest = compositionRunRequestForHistory({
      execute: async () => compositionResultForHistory('held')
    });

    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest,
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result.status).toBe('human_review_required');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      lifecycle: { state: 'held', failure: null },
      composition_run: { run_id: compositionRequest.run_id, status: 'held' }
    });
  });

  it('saves a safe failure envelope for executor failure without exposing the thrown message', async () => {
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
      })
    };
    const compositionRequest = compositionRunRequestForHistory(
      { execute: async () => compositionResultForHistory() },
      {
        dag_resolver: {
          resolve: () => {
            throw new Error('credential-secret-from-resolver');
          }
        }
      }
    );

    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest,
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result.status).toBe('human_review_required');
    expect(JSON.stringify(result)).not.toContain('credential-secret-from-resolver');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      lifecycle: {
        state: 'failed',
        failure: {
          code: 'dag_unavailable',
          message: 'DAG composition failed before a run record was returned'
        }
      },
      composition_run: null
    });
  });

  it('does not execute when the started event cannot be saved and does not expose the save error', async () => {
    const execute = vi.fn(async () => compositionResultForHistory());
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async () => {
        throw new Error('database-credential-secret');
      })
    };
    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest: compositionRunRequestForHistory({ execute }),
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result).toMatchObject({
      status: 'human_review_required',
      reason: 'selection composition history unavailable: DAG composition history could not be saved'
    });
    expect(JSON.stringify(result)).not.toContain('database-credential-secret');
    expect(execute).not.toHaveBeenCalled();
    expect(producer.append).toHaveBeenCalledTimes(1);
  });

  it('does not return a selected result when terminal history cannot be saved', async () => {
    const events: unknown[] = [];
    const execute = vi.fn(async () => compositionResultForHistory());
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        if (events.length === 1) throw new Error('terminal-database-secret');
        events.push(event);
      })
    };
    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest: compositionRunRequestForHistory({ execute }),
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result).toMatchObject({
      status: 'human_review_required',
      reason: 'selection composition history unavailable: DAG composition history could not be saved'
    });
    expect(JSON.stringify(result)).not.toContain('terminal-database-secret');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(producer.append).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
  });

  it('rejects a returned run whose scope changed while the started event was being saved', async () => {
    let compositionRequest!: JudgmentDAGCompositionRunRequest;
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
        if (event.lifecycle.state === 'started') {
          const mutableRequest = compositionRequest as unknown as {
            delegation: { scope: { id: string } };
          };
          mutableRequest.delegation.scope.id = 'mutated-project';
          const mutableComposition = compositionRequest as unknown as {
            composition: { scope: { id: string } };
          };
          mutableComposition.composition.scope.id = 'mutated-project';
        }
      })
    };
    compositionRequest = compositionRunRequestForHistory({
      execute: async () => compositionResultForHistory()
    });
    const isolatedScope = { ...selectionComposition.scope };
    (compositionRequest as unknown as { composition: JudgmentDAGCompositionDefinition }).composition = {
      ...compositionRequest.composition,
      scope: isolatedScope
    };
    (compositionRequest as unknown as { delegation: JudgmentDAGCompositionRunRequest['delegation'] }).delegation = {
      scope: isolatedScope,
      capabilities: []
    };

    const result = await evaluateProblemSelectionWithComposition({
      compositionRequest,
      compositionRunHistory: historyProducerOptions(producer)
    });

    expect(result).toMatchObject({
      status: 'human_review_required',
      reason: 'selection composition result could not be read'
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      lifecycle: { state: 'unknown', failure: { code: 'unknown' } },
      composition_run: null
    });
  });

  it('keeps the terminal run when result extraction throws after persistence', async () => {
    const events: unknown[] = [];
    const producer: JudgmentDAGCompositionRunHistoryProducer = {
      append: vi.fn(async (event) => {
        events.push(event);
      })
    };
    const request = {
      compositionRequest: compositionRunRequestForHistory({
        execute: async () => compositionResultForHistory()
      }),
      compositionRunHistory: historyProducerOptions(producer)
    } as Parameters<typeof evaluateProblemSelectionWithComposition>[0];
    Object.defineProperty(request, 'resultInvocationId', {
      get: () => {
        throw new Error('result-extraction-secret');
      }
    });

    const result = await evaluateProblemSelectionWithComposition(request);

    expect(result).toMatchObject({
      status: 'human_review_required',
      reason: 'selection composition result could not be read'
    });
    expect(JSON.stringify(result)).not.toContain('result-extraction-secret');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ lifecycle: { state: 'completed' }, composition_run: { status: 'completed' } });
  });
});
