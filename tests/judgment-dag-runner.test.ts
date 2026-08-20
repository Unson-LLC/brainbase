import { describe, expect, it, vi } from 'vitest';
import {
  executeJudgmentDAG,
  JudgmentDAGExecutionError,
  type JudgmentDAGRunRequest,
  type JudgmentDAGRunnerInput
} from '../src/judgment-dag-runner.js';
import * as publicJudgmentDAG from '../src/judgment-dag.js';
import type { JudgmentDAG, JudgmentDAGNode } from '../src/judgment-dag-core.js';

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
