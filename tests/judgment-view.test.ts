import { describe, expect, it, vi } from 'vitest';
import {
  createJudgmentViewService,
  type JudgmentViewReadPort,
} from '../src/judgment-view.js';

const access = { tenantId: 'tenant-a', principal: 'principal-a', scopeId: 'project-a' };
const runId = 'composition-run-1';
const problemRef = {
  snapshot_id: `sha256:${'b'.repeat(64)}` as `sha256:${string}`,
  problem_id: 'problem-1',
  revision: '3',
};
const objectiveRef = {
  id: 'objective-1',
  type: 'objective' as const,
  revision: '2',
  digest: `sha256:${'o'.repeat(64)}`,
};
const variableRef = {
  id: 'variable-load',
  type: 'variable' as const,
  revision: '4',
  digest: `sha256:${'v'.repeat(64)}`,
};

function snapshot() {
  return {
    snapshot_version: 'judgment-problem-snapshot.v1' as const,
    problem_id: problemRef.problem_id,
    revision: problemRef.revision,
    question: 'どの導入方式を採用するか',
    owner_scope: { type: 'project' as const, id: access.scopeId },
    references: [
      { kind: 'objective', id: objectiveRef.id, revision: objectiveRef.revision, digest: objectiveRef.digest, scope: { type: 'project' as const, id: access.scopeId }, valid_from: '2026-01-01T00:00:00.000Z' },
      { kind: 'variable', id: variableRef.id, revision: variableRef.revision, digest: variableRef.digest, scope: { type: 'project' as const, id: access.scopeId }, valid_from: '2026-01-01T00:00:00.000Z' },
    ],
    read_policy: { ownerId: access.principal, visibility: 'project' as const, readerIds: [], writerIds: [access.principal] },
    execution_permission: 'none' as const,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function compositionRun() {
  const child = (invocationId: string, status: 'completed' | 'held') => ({
    invocation_id: invocationId,
    dag: { id: `${invocationId}-dag`, version: '1.0.0' },
    question: `${invocationId}を検証する`,
    input_contract: 'problem.v1',
    output_contract: `${invocationId}.result.v1`,
    input: { question: 'q' },
    problem_snapshot: problemRef,
    fixed_conditions: { no_double_entry: true },
    delegation: { scope: { type: 'project', id: access.scopeId }, capabilities: [] },
    dependency_invocation_ids: [],
    dependency_results: [],
    result: {
      status,
      input_contract: 'problem.v1',
      output_contract: `${invocationId}.result.v1`,
      run_reference: status === 'completed' ? { run_id: `${invocationId}-run`, dag: { id: `${invocationId}-dag`, version: '1.0.0' } } : null,
      conclusion: status === 'completed' ? { answer: '成立' } : { answer: '保留' },
      evidence: [{ kind: 'observation', id: `${invocationId}-evidence`, revision: '1' }],
      applicability: { scope: access.scopeId },
      uncertainty: status === 'completed' ? { level: 'low' } : { level: 'high' },
      ...(status === 'held' ? { reason: '追加確認が必要' } : {}),
    },
  });
  return {
    run_id: runId,
    composition: { id: 'hotel-introduction', version: '2.0.0' },
    parent_dag: { id: 'parent-choice', version: '1.4.0' },
    question: 'どの導入方式を採用するか',
    input: { objective: objectiveRef.id },
    problem_snapshot: problemRef,
    fixed_conditions: { no_double_entry: true },
    delegation: { scope: { type: 'project', id: access.scopeId }, capabilities: ['read:metrics'] },
    execution_order: ['technical', 'operations'],
    status: 'completed' as const,
    children: [child('technical', 'completed'), child('operations', 'held')],
  };
}

function objectiveRecord() {
  return {
    digest: objectiveRef.digest,
    definition: {
      id: objectiveRef.id,
      type: 'objective' as const,
      revision: objectiveRef.revision,
      meaning: '顧客対応品質を維持しながら、フロント総対応負荷を減らす',
      desiredState: '総対応負荷が週120分以下になる',
      beneficiaryIds: ['front-desk'],
      criteria: [{ variableRef: { id: variableRef.id, type: 'variable' as const, revision: variableRef.revision }, operator: 'at_most' as const, target: 120 }],
      evaluationPeriod: { from: '2026-01-01', until: '2026-03-31' },
      adoptionState: 'approved' as const,
      epistemicState: 'supported' as const,
      authorizedUses: ['judgment', 'evaluation'] as const,
      acl: { ownerId: access.principal, visibility: 'project' as const, readerIds: [], writerIds: [access.principal] },
      storage: 'ontology' as const,
      provenance: [],
      scope: { subjectIds: [access.scopeId], validFrom: '2026-01-01' },
    },
  };
}

function variableRecord() {
  return {
    digest: variableRef.digest,
    definition: {
      id: variableRef.id,
      type: 'variable' as const,
      revision: variableRef.revision,
      meaning: 'フロントの総対応時間',
      subject: 'front-desk',
      valueKind: 'number' as const,
      unit: '分',
      aggregation: 'sum' as const,
      granularity: 'week',
      measurementMethod: '対応ログの直接対応・引継ぎ・修正を合算',
      adoptionState: 'approved' as const,
      authorizedUses: ['judgment', 'evaluation'] as const,
      acl: { ownerId: access.principal, visibility: 'project' as const, readerIds: [], writerIds: [access.principal] },
      storage: 'ontology' as const,
      provenance: [],
      scope: { subjectIds: [access.scopeId], validFrom: '2026-01-01' },
    },
  };
}

function artifact() {
  return {
    run_id: runId,
    dag: { id: 'parent-choice', version: '1.4.0' },
    input: { objective: objectiveRef.id },
    execution_order: ['answer'],
    runner_versions: [],
    nodes: [{
      node_id: 'answer', runner_type: 'deterministic', runner_version: '1',
      input_contract: 'parent.input.v1', output_contract: 'parent.output.v1',
      input: {}, dependency_outputs: [], output: { choice: 'pilot' },
    }],
  };
}

function evaluation() {
  return {
    version: 1 as const,
    id: 'evaluation-1',
    snapshot: { snapshotId: problemRef.snapshot_id, problemId: problemRef.problem_id, revision: problemRef.revision, digest: `sha256:${'s'.repeat(64)}` },
    objectiveRef,
    outcomeCaseRef: { id: 'outcome-1', revision: '1', digest: `sha256:${'e'.repeat(64)}` },
    predictions: [],
    actuals: [],
    criteria: [{ criterionIndex: 0, variableRef, operator: 'at_most' as const, target: 120, status: 'achieved' as const, reason: '観測値は閾値内' }],
    predictionComparisons: [{ criterionIndex: 0, variableRef, status: 'matched' as const, reason: '予測と一致' }],
    achievement: 'achieved' as const,
    judgmentAtTimeValidity: { status: 'indeterminate' as const, basis: '実証期間が短く妥当性を確定できない', evidenceRefs: ['technical-evidence'] },
    evaluatedAt: '2026-03-31T00:00:00.000Z',
  };
}

function port(overrides: Partial<JudgmentViewReadPort> = {}) {
  const requests: unknown[] = [];
  const source = {
    readCompositionRun: vi.fn(() => ({ status: 'resolved' as const, value: compositionRun() })),
    readProblemSnapshot: vi.fn((request) => {
      requests.push(request);
      return { status: 'resolved' as const, value: snapshot() };
    }),
    readFoundationReference: vi.fn((request) => {
      requests.push(request);
      if (request.reference.type === 'objective') return { status: 'resolved' as const, value: objectiveRecord() };
      return { status: 'resolved' as const, value: variableRecord() };
    }),
    readRunArtifact: vi.fn((request) => {
      requests.push(request);
      return { status: 'resolved' as const, value: artifact() };
    }),
    readEvaluation: vi.fn((request) => {
      requests.push(request);
      return { status: 'resolved' as const, value: evaluation() };
    }),
    ...overrides,
  } satisfies JudgmentViewReadPort;
  return { source, requests };
}

describe('historical judgment view', () => {
  it('traces a conclusion to the exact Problem, Objective, variable, child runs, and separate evaluations', async () => {
    const { source, requests } = port();
    const document = await createJudgmentViewService(source).read({ runId, access });

    expect(document.status).toBe('resolved');
    expect(document.mode).toBe('historical');
    expect(document.conclusion.value?.value).toEqual({ choice: 'pilot' });
    expect(document.problem.value?.revision).toBe('3');
    expect(document.objective.value?.ref).toEqual(objectiveRef);
    expect(document.objective.value?.criteria.items?.[0]?.variableRef).toEqual(variableRef);
    expect(document.childRuns.items).toHaveLength(2);
    expect(document.childRuns.items?.[1]?.status).toBe('held');
    expect(document.resultEvaluation.value?.achievement).toBe('achieved');
    expect(document.judgmentValidity.value?.status).toBe('indeterminate');
    expect(document.resultEvaluation.value?.achievement).not.toBe(document.judgmentValidity.value?.status);
    expect(requests.every((request) => (request as { resolution?: string }).resolution === 'historical')).toBe(true);
  });

  it('preserves permission failure and does not fall back to a latest Problem or Objective', async () => {
    const { source } = port({
      readProblemSnapshot: vi.fn(() => ({ status: 'permission_denied' as const, reason: 'scope is not readable' })),
    });
    const document = await createJudgmentViewService(source).read({ runId, access });

    expect(document.status).toBe('permission_denied');
    expect(document.problem.status).toBe('permission_denied');
    expect(document.objective.status).toBe('unknown');
    expect(document.objective.value).toBeUndefined();
  });

  it('rejects a readback whose artifact identity differs from the historical run', async () => {
    const { source } = port({
      readRunArtifact: vi.fn(() => ({ status: 'resolved' as const, value: { ...artifact(), dag: { id: 'different-dag', version: '9.0.0' } } })),
    });
    const document = await createJudgmentViewService(source).read({ runId, access });

    expect(document.conclusion.status).toBe('invalid');
    expect(document.status).toBe('invalid');
  });

  it('keeps an evaluation failure explicit instead of treating it as an unmeasured success', async () => {
    const { source } = port({
      readEvaluation: vi.fn(() => ({ status: 'undecidable' as const, reason: 'actual measurement is missing' })),
    });
    const document = await createJudgmentViewService(source).read({ runId, access });

    expect(document.resultEvaluation.status).toBe('undecidable');
    expect(document.judgmentValidity.status).toBe('undecidable');
    expect(document.resultEvaluation.value).toBeUndefined();
  });

  it('does not choose arbitrarily when a historical Problem pins multiple Objectives', async () => {
    const historicalSnapshot = snapshot();
    const secondObjective = {
      ...historicalSnapshot.references.find((reference) => reference.kind === 'objective')!,
      id: 'objective-2',
    };
    const { source } = port({
      readProblemSnapshot: vi.fn(() => ({
        status: 'resolved' as const,
        value: { ...historicalSnapshot, references: [...historicalSnapshot.references, secondObjective] },
      })),
    });

    const document = await createJudgmentViewService(source).read({ runId, access });

    expect(document.objective.status).toBe('invalid');
    expect(document.objective.value).toBeUndefined();
    expect(document.reason).toContain('exactly one objective reference');
    expect(document.status).toBe('invalid');
  });
});
