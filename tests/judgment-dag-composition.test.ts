import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as publicJudgmentDAG from '../src/judgment-dag.js';
import {
  JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
  loadJudgmentProblemSnapshot,
  type ProblemRef,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot
} from '../src/judgment-problem-snapshot.js';
import {
  JudgmentDAGCompositionError,
  createJudgmentDAGCompositionDefinition,
  executeJudgmentDAGComposition,
  validateJudgmentDAGComposition,
  type JudgmentDAGCompositionDefinition,
  type JudgmentDAGCompositionRunRequest,
  type JudgmentDAGJSONValue,
  type JudgmentDAGProblemSnapshotReader,
  type JudgmentDAGSubDAGDefinition,
  type JudgmentDAGSubDAGEvaluationPort,
  type JudgmentDAGSubDAGResult,
  type JudgmentDAGSubDAGStatus
} from '../src/judgment-dag-composition.js';

const snapshotRoots: string[] = [];

afterEach(async () => {
  await Promise.all(snapshotRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function composition(
  overrides: Partial<JudgmentDAGCompositionDefinition> = {}
): JudgmentDAGCompositionDefinition {
  return {
    composition_id: 'hotel-choice',
    composition_version: '1.0.0',
    scope: { type: 'project', id: 'project-subdag' },
    parent_dag: { id: 'parent-dag', version: '1.2.0' },
    children: [
      {
        invocation_id: 'technical',
        dag: { id: 'technical-dag', version: '2.0.0' },
        question: 'Can it work technically?',
        input_contract: 'problem.v1',
        output_contract: 'technical.result.v1',
        required_capabilities: ['read:system'],
        depends_on: []
      },
      {
        invocation_id: 'operational',
        dag: { id: 'operational-dag', version: '1.0.0' },
        question: 'Can the team operate it?',
        input_contract: 'problem.v1',
        output_contract: 'operational.result.v1',
        required_capabilities: [],
        depends_on: []
      },
      {
        invocation_id: 'choice',
        dag: { id: 'choice-dag', version: '1.0.0' },
        question: 'Which option should be selected?',
        input_contract: 'problem.v1',
        output_contract: 'choice.result.v1',
        required_capabilities: [],
        depends_on: ['technical', 'operational']
      }
    ],
    ...overrides
  };
}

function childFor(
  definition: JudgmentDAGCompositionDefinition,
  invocationId: string
): JudgmentDAGSubDAGDefinition {
  const child = definition.children.find((entry) => entry.invocation_id === invocationId);
  if (child === undefined) {
    throw new Error(`missing child ${invocationId}`);
  }
  return child;
}

function resultFor(
  definition: JudgmentDAGCompositionDefinition,
  invocationId: string,
  status: JudgmentDAGSubDAGStatus = 'completed'
): JudgmentDAGSubDAGResult {
  const child = childFor(definition, invocationId);
  return {
    status,
    input_contract: child.input_contract,
    output_contract: child.output_contract,
    run_reference: status === 'completed'
      ? {
          run_id: `run-${invocationId}`,
          dag: child.dag,
          artifact_id: `sha256:${'a'.repeat(64)}`
        }
      : null,
    conclusion: { answer: invocationId },
    evidence: [{ kind: 'source', id: `evidence-${invocationId}`, revision: '1' }],
    applicability: { scope: 'project' },
    uncertainty: { level: 'low' }
  };
}

function request(
  definition: JudgmentDAGCompositionDefinition,
  port: JudgmentDAGSubDAGEvaluationPort,
  input: Record<string, unknown> = { objective: 'reduce-load' },
  overrides: Partial<JudgmentDAGCompositionRunRequest> = {}
) {
  const problemSnapshot = {
    snapshot_id: `sha256:${'b'.repeat(64)}` as `sha256:${string}`,
    problem_id: 'hotel-choice-problem',
    revision: '1'
  };
  const snapshotReader = {
    read: vi.fn(async ({ reference }: { reference: typeof problemSnapshot }) => ({
      status: 'resolved' as const,
      reference_resolution: 'current' as const,
      reference,
      snapshot: {
        snapshot_version: 'judgment-problem-snapshot.v1',
        problem_id: reference.problem_id,
        revision: reference.revision
      }
    }))
  };
  const dagResolver = {
    resolve: vi.fn(async ({ dag }: { dag: { id: string; version: string } }) => {
      const child = definition.children.find((entry) => entry.dag.id === dag.id);
      return {
        dag,
        input_contract: child?.input_contract ?? 'problem.v1',
        output_contract: child?.output_contract ?? 'parent.result.v1'
      };
    })
  };
  const contractValidator = {
    validate: vi.fn(async () => undefined)
  };
  const artifactReader = {
    read: vi.fn(async ({
      expected_run_id,
      expected_dag
    }: {
      expected_run_id: string;
      expected_dag: { id: string; version: string };
    }) => ({
      run_id: expected_run_id,
      dag: expected_dag
    }))
  };
  return {
    run_id: 'composition-run-1',
    composition: definition,
    question: 'Which introduction path should be selected?',
    input,
    problem_snapshot: problemSnapshot,
    fixed_conditions: { no_double_entry: true },
    delegation: {
      scope: definition.scope,
      capabilities: ['read:system', 'read:metrics']
    },
    snapshot_reader: snapshotReader,
    dag_resolver: dagResolver,
    contract_validator: contractValidator,
    artifact_reader: artifactReader,
    port,
    ...overrides
  };
}

function persistedProblemSnapshot(): JudgmentProblemSnapshot {
  const kinds: readonly ProblemRef['kind'][] = [
    'objective',
    'criterion',
    'observation',
    'model',
    'constraint',
    'authority',
    'resource',
    'deadline'
  ];
  return {
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    problem_id: 'hotel-choice-problem',
    revision: '1',
    question: 'Which introduction path should be selected?',
    owner_scope: { type: 'project', id: 'project-subdag' },
    references: kinds.map((kind, index) => ({
      kind,
      id: `${kind}-1`,
      revision: '1',
      digest: `sha256:${index.toString(16).padStart(2, '0').repeat(32)}`,
      scope: { type: 'project', id: 'project-subdag' },
      valid_from: '2026-01-01T00:00:00.000Z'
    })),
    read_policy: {
      ownerId: 'alice',
      visibility: 'private',
      readerIds: [],
      writerIds: ['alice']
    },
    execution_permission: 'none',
    created_at: '2026-01-01T00:00:00.000Z'
  };
}

const resolvedReferenceProvider: JudgmentProblemReferenceProvider = {
  resolve: ({ reference }) => ({ status: 'resolved', digest: reference.digest })
};

const rejectedCurrentReferenceProvider: JudgmentProblemReferenceProvider = {
  resolve: ({ reference, phase }) => phase === 'read'
    ? { status: 'missing', message: `canonical ${reference.kind} is no longer readable` }
    : { status: 'resolved', digest: reference.digest }
};

describe('Judgment DAG composition contract', () => {
  it('is available from the side-effect-free public DAG entrypoint', () => {
    expect(publicJudgmentDAG.executeJudgmentDAGComposition)
      .toBe(executeJudgmentDAGComposition);
    expect(publicJudgmentDAG.createJudgmentDAGCompositionDefinition)
      .toBe(createJudgmentDAGCompositionDefinition);
  });

  it('executes children in deterministic order and records frozen parent/child references', async () => {
    const definition = composition();
    const calls: string[] = [];
    let choiceDependencyResults: readonly unknown[] = [];
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => {
        calls.push(childRequest.invocation_id);
        expect(childRequest.mode).toBe('evaluation');
        expect(Object.isFrozen(childRequest)).toBe(true);
        expect(Object.isFrozen(childRequest.input)).toBe(true);
        expect(Object.isFrozen(childRequest.problem_snapshot)).toBe(true);
        expect(childRequest.problem_snapshot).toEqual({
          snapshot_id: `sha256:${'b'.repeat(64)}`,
          problem_id: 'hotel-choice-problem',
          revision: '1'
        });
        if (childRequest.invocation_id === 'choice') {
          choiceDependencyResults = childRequest.dependency_results;
          expect(childRequest.delegation.capabilities).toEqual([]);
        }
        return resultFor(definition, childRequest.invocation_id);
      })
    };
    const input = { objective: { id: 'reduce-load' } };
    const runRequest = request(definition, port, input);

    const record = await executeJudgmentDAGComposition(runRequest);

    expect(calls).toEqual(['operational', 'technical', 'choice']);
    expect(record.execution_order).toEqual(['operational', 'technical', 'choice']);
    expect(record.status).toBe('completed');
    expect(choiceDependencyResults).toMatchObject([
      { invocation_id: 'operational' },
      { invocation_id: 'technical' }
    ]);
    expect(record.children[2]?.result.run_reference).toMatchObject({
      run_id: 'run-choice',
      dag: { id: 'choice-dag', version: '1.0.0' }
    });
    expect(record.problem_snapshot).toEqual(runRequest.problem_snapshot);
    expect(record.children[0]?.problem_snapshot).toEqual(runRequest.problem_snapshot);
    expect(runRequest.snapshot_reader.read).toHaveBeenCalledWith({
      mode: 'read',
      reference_resolution: 'current',
      reference: runRequest.problem_snapshot
    });
    expect(runRequest.dag_resolver.resolve).toHaveBeenCalledTimes(4);
    expect(runRequest.contract_validator.validate).toHaveBeenCalledTimes(3);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.children[0])).toBe(true);

    input.objective.id = 'mutated-after-run';
    expect(record.input).toEqual({ objective: { id: 'reduce-load' } });
  });

  it('rejects duplicate, missing, and cyclic composition dependencies', () => {
    const duplicate = composition({
      children: [
        ...composition().children,
        { ...composition().children[0] }
      ]
    });
    expect(() => validateJudgmentDAGComposition(duplicate)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({ code: 'duplicate_invocation' })
    );

    const missing = composition({
      children: composition().children.map((child) => child.invocation_id === 'choice'
        ? { ...child, depends_on: ['missing'] }
        : child)
    });
    expect(() => validateJudgmentDAGComposition(missing)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({ code: 'missing_dependency' })
    );

    const cyclic = composition({
      children: composition().children.map((child) => child.invocation_id === 'choice'
        ? { ...child, depends_on: ['technical'] }
        : child.invocation_id === 'technical'
          ? { ...child, depends_on: ['choice'] }
          : child)
    });
    expect(() => validateJudgmentDAGComposition(cyclic)).toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({ code: 'cycle' })
    );
  });

  it('preflights every capability before calling the evaluation port', async () => {
    const definition = composition({
      children: composition().children.map((child) => child.invocation_id === 'choice'
        ? { ...child, required_capabilities: ['write:external'] }
        : child)
    });
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };

    await expect(executeJudgmentDAGComposition(request(definition, port))).rejects.toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({
        code: 'capability_violation',
        invocation_id: 'choice'
      })
    );
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('requires a currently readable matching problem snapshot before calling the port', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const runRequest = request(definition, port, undefined, {
      snapshot_reader: {
        read: vi.fn(async () => {
          throw new Error('snapshot access denied');
        })
      }
    });

    await expect(executeJudgmentDAGComposition(runRequest)).rejects.toMatchObject({
      code: 'snapshot_unavailable'
    });
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('adapts the persisted Story05 snapshot loader to the composition reader port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-subdag-snapshot-'));
    snapshotRoots.push(root);
    const saved = await saveJudgmentProblemSnapshot({
      root,
      snapshot: persistedProblemSnapshot(),
      access: { principal: 'alice' },
      referenceProvider: resolvedReferenceProvider
    });
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const snapshotReader: JudgmentDAGProblemSnapshotReader = {
      read: async ({ reference }) => {
        const snapshot = await loadJudgmentProblemSnapshot({
          root,
          snapshot_id: reference.snapshot_id,
          access: { principal: 'alice' },
          reference_resolution: 'current',
          referenceProvider: resolvedReferenceProvider
        });
        return {
          status: 'resolved',
          reference_resolution: 'current',
          reference,
          snapshot: snapshot as unknown as JudgmentDAGJSONValue
        };
      }
    };
    const runRequest = request(definition, port, undefined, {
      problem_snapshot: {
        snapshot_id: saved.snapshot_id,
        problem_id: saved.problem_id,
        revision: saved.revision
      },
      snapshot_reader: snapshotReader
    });

    const record = await executeJudgmentDAGComposition(runRequest);

    expect(record.status).toBe('completed');
    expect(record.problem_snapshot).toEqual({
      snapshot_id: saved.snapshot_id,
      problem_id: saved.problem_id,
      revision: saved.revision
    });
    expect(port.execute).toHaveBeenCalledTimes(3);
  });

  it('fails closed when current canonical reference resolution is rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-subdag-snapshot-'));
    snapshotRoots.push(root);
    const saved = await saveJudgmentProblemSnapshot({
      root,
      snapshot: persistedProblemSnapshot(),
      access: { principal: 'alice' },
      referenceProvider: resolvedReferenceProvider
    });
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const snapshotReader: JudgmentDAGProblemSnapshotReader = {
      read: async ({ reference }) => {
        const snapshot = await loadJudgmentProblemSnapshot({
          root,
          snapshot_id: reference.snapshot_id,
          access: { principal: 'alice' },
          reference_resolution: 'current',
          referenceProvider: rejectedCurrentReferenceProvider
        });
        return {
          status: 'resolved',
          reference_resolution: 'current',
          reference,
          snapshot: snapshot as unknown as JudgmentDAGJSONValue
        };
      }
    };
    const runRequest = request(definition, port, undefined, {
      problem_snapshot: {
        snapshot_id: saved.snapshot_id,
        problem_id: saved.problem_id,
        revision: saved.revision
      },
      snapshot_reader: snapshotReader
    });

    await expect(executeJudgmentDAGComposition(runRequest)).rejects.toMatchObject({
      code: 'snapshot_unavailable'
    });
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('rejects a historical snapshot reader result for a new composition run', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const runRequest = request(definition, port);
    const historicalReader = {
      read: vi.fn(async () => ({
        status: 'resolved',
        reference_resolution: 'historical',
        reference: runRequest.problem_snapshot,
        snapshot: {
          snapshot_version: 'judgment-problem-snapshot.v1',
          problem_id: runRequest.problem_snapshot.problem_id,
          revision: runRequest.problem_snapshot.revision
        }
      }))
    } as unknown as JudgmentDAGProblemSnapshotReader;

    await expect(
      executeJudgmentDAGComposition({ ...runRequest, snapshot_reader: historicalReader })
    ).rejects.toMatchObject({ code: 'snapshot_unavailable' });
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('resolves exact DAG versions and rejects a resolver mismatch before evaluation', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const runRequest = request(definition, port, undefined, {
      dag_resolver: {
        resolve: vi.fn(async ({ dag }: { dag: { id: string; version: string } }) => ({
          dag: { id: dag.id, version: 'unexpected-version' },
          input_contract: 'problem.v1',
          output_contract: 'parent.result.v1'
        }))
      }
    });

    await expect(executeJudgmentDAGComposition(runRequest)).rejects.toMatchObject({
      code: 'dag_mismatch'
    });
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('requires the resolved child contracts to pass the validator before evaluation', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const runRequest = request(definition, port, undefined, {
      contract_validator: {
        validate: vi.fn(async () => {
          throw new Error('contract rejected');
        })
      }
    });

    await expect(executeJudgmentDAGComposition(runRequest)).rejects.toMatchObject({
      code: 'contract_mismatch',
      invocation_id: 'choice'
    });
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('requires artifact readback to match the child run and DAG identity', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };
    const runRequest = request(definition, port, undefined, {
      artifact_reader: {
        read: vi.fn(async () => ({
          run_id: 'different-run',
          dag: { id: 'operational-dag', version: '1.0.0' }
        }))
      }
    });

    await expect(executeJudgmentDAGComposition(runRequest)).rejects.toMatchObject({
      code: 'artifact_readback_failed',
      invocation_id: 'operational'
    });
    expect(port.execute).toHaveBeenCalledTimes(1);
  });

  it('requires the delegation scope to match the composition scope', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => resultFor(definition, childRequest.invocation_id))
    };

    await expect(executeJudgmentDAGComposition({
      ...request(definition, port),
      delegation: { scope: { type: 'project', id: 'other-project' }, capabilities: [] }
    })).rejects.toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({ code: 'scope_mismatch' })
    );
    expect(port.execute).not.toHaveBeenCalled();
  });

  it('does not adopt a child with a mismatched output contract', async () => {
    const definition = composition();
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => ({
        ...resultFor(definition, childRequest.invocation_id),
        output_contract: 'unexpected.v9'
      }))
    };

    await expect(executeJudgmentDAGComposition(request(definition, port))).rejects.toThrowError(
      expect.objectContaining<Partial<JudgmentDAGCompositionError>>({ code: 'contract_mismatch' })
    );
  });

  it.each([
    ['failed', 'failed'],
    ['held', 'held']
  ] as const)('propagates a child %s without rounding the parent to success', async (childStatus, parentStatus) => {
    const definition = composition();
    const calls: string[] = [];
    const port: JudgmentDAGSubDAGEvaluationPort = {
      execute: vi.fn(async (childRequest) => {
        calls.push(childRequest.invocation_id);
        return childRequest.invocation_id === 'technical'
          ? resultFor(definition, 'technical', childStatus)
          : resultFor(definition, childRequest.invocation_id);
      })
    };

    const record = await executeJudgmentDAGComposition(request(definition, port));

    expect(calls).toEqual(['operational', 'technical']);
    expect(record.status).toBe(parentStatus);
    expect(record.children.find((child) => child.invocation_id === 'choice')?.result.status)
      .toBe('held');
    expect(record.children.find((child) => child.invocation_id === 'choice')?.dependency_results)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          invocation_id: 'technical',
          result: expect.objectContaining({ status: childStatus })
        })
      ]));
  });
});
