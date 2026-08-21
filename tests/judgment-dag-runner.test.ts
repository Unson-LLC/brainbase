import { describe, expect, it, vi } from 'vitest';
import {
  executeJudgmentDAG,
  JudgmentDAGExecutionError,
  type JudgmentDAGRunRequest,
  type JudgmentDAGRunnerInput
} from '../src/judgment-dag-runner.js';
import * as publicJudgmentDAG from '../src/judgment-dag.js';
import {
  JudgmentDAGValidationError,
  type JudgmentDAG,
  type JudgmentDAGNode
} from '../src/judgment-dag-core.js';

function node(
  id: string,
  nodeType: JudgmentDAGNode['node_type'],
  layer: JudgmentDAGNode['layer'],
  dependsOn: readonly string[]
): JudgmentDAGNode {
  return {
    id,
    node_type: nodeType,
    layer,
    scope: { type: 'project', id: 'j0-runner-test' },
    version: '1.0.0',
    description: `${id} runner test node`,
    depends_on: dependsOn,
    input_contract: 'j0.runner.input.v1',
    output_contract: 'j0.runner.output.v1',
    runner_type: 'deterministic'
  };
}

function dag(): JudgmentDAG {
  const nodes = [
    node('__proto__', 'observation', 'context', []),
    node('alpha', 'observation', 'context', []),
    node('judgment', 'judgment', 'judgment', ['__proto__', 'alpha']),
    node('result', 'execution', 'execution', ['judgment'])
  ];
  return {
    id: 'j0-runner-test',
    version: '2026-08-21.1',
    nodes,
    edges: [
      { from: '__proto__', to: 'judgment', relation: 'depends_on' },
      { from: 'alpha', to: 'judgment', relation: 'depends_on' },
      { from: 'judgment', to: 'result', relation: 'depends_on' }
    ]
  };
}

function request(
  ...args: [
    input?: unknown,
    run?: (context: JudgmentDAGRunnerInput) => unknown
  ]
): JudgmentDAGRunRequest {
  const input = args.length === 0 ? { value: 1 } : args[0];
  const run = args[1] ?? (({ node: currentNode }: JudgmentDAGRunnerInput) => ({
    node_id: currentNode.id,
    ok: true
  }));
  return {
    run_id: 'run-j0-test',
    dag: dag(),
    input: input as JudgmentDAGRunRequest['input'],
    runners: {
      deterministic: {
        version: 'runner-1.0.0',
        run
      }
    }
  };
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}

describe('J0 local deterministic Judgment DAG runner', () => {
  it('exports the readonly runner contract from the side-effect-free public subpath', async () => {
    expect(publicJudgmentDAG.executeJudgmentDAG).toBe(executeJudgmentDAG);

    const record = await publicJudgmentDAG.executeJudgmentDAG(request());

    expect(record.run_id).toBe('run-j0-test');
    expect(record.dag.id).toBe('j0-runner-test');
    expect(record.dag.version).toBe('2026-08-21.1');
    expect(record.execution_order).toEqual(['__proto__', 'alpha', 'judgment', 'result']);
    expect(record.input).toEqual({ value: 1 });
  });

  it('fails closed for missing or invalid runners before any runner call', async () => {
    let calls = 0;
    const run = (context: JudgmentDAGRunnerInput) => {
      calls += 1;
      return { node_id: context.node.id };
    };

    await expect(executeJudgmentDAG({
      ...request(),
      runners: {}
    })).rejects.toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'missing_runner'
    });
    expect(calls).toBe(0);

    await expect(executeJudgmentDAG({
      ...request(),
      runners: {
        deterministic: {
          version: '',
          run
        }
      }
    })).rejects.toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'invalid_runner'
    });
    expect(calls).toBe(0);
  });

  it('fails closed for mixed runner types before invoking an earlier valid runner', async () => {
    const calls = { deterministic: 0, human: 0, agent: 0 };
    const deterministicRun = ({ node: currentNode }: JudgmentDAGRunnerInput) => {
      calls.deterministic += 1;
      return { node_id: currentNode.id };
    };
    const humanRun = ({ node: currentNode }: JudgmentDAGRunnerInput) => {
      calls.human += 1;
      return { node_id: currentNode.id };
    };
    const agentRun = ({ node: currentNode }: JudgmentDAGRunnerInput) => {
      calls.agent += 1;
      return { node_id: currentNode.id };
    };
    const mixedDag = (runnerType: 'human' | 'agent'): JudgmentDAG => ({
      ...dag(),
      nodes: dag().nodes.map((currentNode) => currentNode.id === 'alpha'
        ? { ...currentNode, runner_type: runnerType }
        : currentNode)
    });

    await expect(executeJudgmentDAG({
      ...request(),
      dag: mixedDag('human'),
      runners: {
        deterministic: { version: 'runner-1.0.0', run: deterministicRun },
        agent: { version: 'agent-1.0.0', run: agentRun }
      }
    })).rejects.toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'missing_runner',
      node_id: 'alpha',
      runner_type: 'human'
    });
    expect(calls).toEqual({ deterministic: 0, human: 0, agent: 0 });

    await expect(executeJudgmentDAG({
      ...request(),
      dag: mixedDag('agent'),
      runners: {
        deterministic: { version: 'runner-1.0.0', run: deterministicRun },
        human: { version: 'human-1.0.0', run: humanRun },
        agent: { version: '', run: agentRun }
      }
    })).rejects.toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'invalid_runner',
      node_id: 'alpha',
      runner_type: 'agent'
    });
    expect(calls).toEqual({ deterministic: 0, human: 0, agent: 0 });
  });

  it('preserves invalid DAG validator errors before any runner call or partial record', async () => {
    let calls = 0;
    let result: unknown;
    let failure: unknown;
    const run = ({ node: currentNode }: JudgmentDAGRunnerInput) => {
      calls += 1;
      return { node_id: currentNode.id };
    };
    const sparseDependencyDAG = {
      ...dag(),
      nodes: dag().nodes.map((currentNode) => currentNode.id === 'judgment'
        ? { ...currentNode, depends_on: ['__proto__', , 'alpha'] }
        : currentNode)
    } as unknown as JudgmentDAG;

    try {
      result = await executeJudgmentDAG({ ...request(), dag: sparseDependencyDAG, runners: {
        deterministic: { version: 'runner-1.0.0', run }
      } });
    } catch (error) {
      failure = error;
    }

    expect(result).toBeUndefined();
    expect(failure).toBeInstanceOf(JudgmentDAGValidationError);
    expect(failure).toMatchObject<Partial<JudgmentDAGValidationError>>({
      code: 'invalid_contract',
      message: 'nodes[2].depends_on[1] must be a non-empty string without control characters'
    });
    expect(calls).toBe(0);

    let missingDependencyFailure: unknown;
    const missingDependencyDAG = {
      ...dag(),
      nodes: dag().nodes.map((currentNode) => currentNode.id === 'judgment'
        ? { ...currentNode, depends_on: ['missing-node', '__proto__', 'alpha'] }
        : currentNode),
      edges: dag().edges.map((edge) => edge.from === '__proto__' && edge.to === 'judgment'
        ? { ...edge, from: 'missing-node' }
        : edge)
    } as unknown as JudgmentDAG;
    try {
      await executeJudgmentDAG({ ...request(), dag: missingDependencyDAG, runners: {
        deterministic: { version: 'runner-1.0.0', run }
      } });
    } catch (error) {
      missingDependencyFailure = error;
    }
    expect(missingDependencyFailure).toMatchObject<Partial<JudgmentDAGValidationError>>({
      code: 'missing_dependency',
      node_id: 'judgment',
      dependency_id: 'missing-node',
      message: 'Node judgment depends on missing node missing-node'
    });
    expect(calls).toBe(0);
  });

  it('distinguishes synchronous throws and asynchronous rejects as runner failures without a success record', async () => {
    const syncCause = new Error('sync runner failure');
    let syncRecord: unknown;
    let syncFailure: unknown;
    try {
      syncRecord = await executeJudgmentDAG(request({ value: 1 }, () => {
        throw syncCause;
      }));
    } catch (error) {
      syncFailure = error;
    }
    expect(syncRecord).toBeUndefined();
    expect(syncFailure).toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'runner_failed',
      node_id: '__proto__',
      runner_type: 'deterministic',
      failure_kind: 'sync_throw',
      cause: syncCause
    });

    const asyncCause = new Error('async runner failure');
    let asyncRecord: unknown;
    let asyncFailure: unknown;
    try {
      asyncRecord = await executeJudgmentDAG(request({ value: 1 }, async () => {
        throw asyncCause;
      }));
    } catch (error) {
      asyncFailure = error;
    }
    expect(asyncRecord).toBeUndefined();
    expect(asyncFailure).toMatchObject<Partial<JudgmentDAGExecutionError>>({
      code: 'runner_failed',
      node_id: '__proto__',
      runner_type: 'deterministic',
      failure_kind: 'async_reject',
      cause: asyncCause
    });
  });

  it('snapshots run_id before a runner can mutate the caller request', async () => {
    const observedRunIds: string[] = [];
    const mutableRequest = request() as unknown as JudgmentDAGRunRequest & { run_id: string };
    mutableRequest.runners.deterministic = {
      version: 'runner-1.0.0',
      run: ({ run_id, node: currentNode }: JudgmentDAGRunnerInput) => {
        observedRunIds.push(run_id);
        mutableRequest.run_id = 'caller-mutated-run-id';
        return { node_id: currentNode.id, run_id };
      }
    };

    const record = await executeJudgmentDAG(mutableRequest);

    expect(observedRunIds).toEqual([
      'run-j0-test',
      'run-j0-test',
      'run-j0-test',
      'run-j0-test'
    ]);
    expect(record.run_id).toBe('run-j0-test');
    expect(record.nodes.map((entry) => (entry.output as { run_id: string }).run_id)).toEqual([
      'run-j0-test',
      'run-j0-test',
      'run-j0-test',
      'run-j0-test'
    ]);
  });

  it('executes in stable order and exposes only ID-sorted direct dependency outputs', async () => {
    const calls: string[] = [];
    const record = await executeJudgmentDAG(request({ value: 7 }, ({ node: currentNode, dependency_outputs }) => {
      calls.push(currentNode.id);
      return {
        node_id: currentNode.id,
        dependency_ids: dependency_outputs.map((dependency) => dependency.node_id),
        value: 7
      };
    }));

    expect(calls).toEqual(['__proto__', 'alpha', 'judgment', 'result']);
    expect(record.execution_order).toEqual(calls);
    const judgmentRecord = record.nodes.find((entry) => entry.node_id === 'judgment');
    const resultRecord = record.nodes.find((entry) => entry.node_id === 'result');
    expect(judgmentRecord?.dependency_outputs.map((dependency) => dependency.node_id)).toEqual([
      '__proto__',
      'alpha'
    ]);
    expect(resultRecord?.dependency_outputs.map((dependency) => dependency.node_id)).toEqual([
      'judgment'
    ]);
    expect((judgmentRecord?.output as { dependency_ids: string[] }).dependency_ids).toEqual([
      '__proto__',
      'alpha'
    ]);
  });

  it('snapshots mutation boundaries and rejects non-JSON values, cycles, and non-plain objects', async () => {
    const sourceOutput = { nested: { value: 1 } };
    const record = await executeJudgmentDAG(request({ nested: { value: 1 } }, ({ node: currentNode }) => ({
      node_id: currentNode.id,
      ...sourceOutput
    })));
    sourceOutput.nested.value = 99;
    expect((record.nodes[0].output as { nested: { value: number } }).nested.value).toBe(1);

    const mutableRegistration = {
      version: 'runner-1.0.0',
      run: ({ node: currentNode }: JudgmentDAGRunnerInput) => {
        if (currentNode.id === '__proto__') mutableRegistration.version = 'runner-mutated';
        return { node_id: currentNode.id };
      }
    };
    const registrationRecord = await executeJudgmentDAG({
      ...request(),
      runners: { deterministic: mutableRegistration }
    });
    expect(registrationRecord.nodes.every((entry) => entry.runner_version === 'runner-1.0.0')).toBe(true);
    expect(registrationRecord.runner_versions).toEqual([
      { runner_type: 'deterministic', version: 'runner-1.0.0' }
    ]);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalidInputs: unknown[] = [
      undefined,
      { bad: undefined },
      { bad: () => 'function' },
      { bad: Symbol('symbol') },
      { bad: 1n },
      { bad: Number.NaN },
      { bad: Number.POSITIVE_INFINITY },
      cyclic,
      { bad: new Date('2026-08-21T00:00:00.000Z') }
    ];

    for (const invalidInput of invalidInputs) {
      await expect(executeJudgmentDAG(request(invalidInput))).rejects.toMatchObject<
        Partial<JudgmentDAGExecutionError>
      >({ code: 'invalid_json' });
    }

    await expect(executeJudgmentDAG(request({ value: 1 }, () => undefined))).rejects.toMatchObject<
      Partial<JudgmentDAGExecutionError>
    >({ code: 'invalid_json' });
  });

  it('returns a deeply frozen deterministic record without reading clock or randomness', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    try {
      const first = await executeJudgmentDAG(request({ stable: true }, ({ node: currentNode }) => ({
        node_id: currentNode.id,
        stable: true
      })));
      const second = await executeJudgmentDAG(request({ stable: true }, ({ node: currentNode }) => ({
        node_id: currentNode.id,
        stable: true
      })));

      expect(first).toEqual(second);
      expectDeeplyFrozen(first);
      expect(dateNow).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally {
      dateNow.mockRestore();
      random.mockRestore();
    }
  });
});
