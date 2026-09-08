import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const PUBLIC_COMMIT = 'd51550260407bff7782c1a621fa13b12ce9fbfa6';
const DEPENDENCY = `github:Unson-LLC/brainbase#${PUBLIC_COMMIT}`;
const RESOLVED_DEPENDENCY = `git+ssh://git@github.com/Unson-LLC/brainbase.git#${PUBLIC_COMMIT}`;
const roots = [];

const SAVE_PROCESS = String.raw`
  import {
    executeJudgmentDAG,
    saveJudgmentDAGRunArtifact
  } from '@unson/brainbase-mcp/judgment-dag';

  const dag = {
    id: 'organization-j0-consumer',
    version: '2026-08-31.1',
    nodes: [{
      id: 'judgment.answer',
      node_type: 'judgment',
      layer: 'judgment',
      scope: { type: 'project', id: 'brainbase-unson' },
      version: '1.0.0',
      description: 'produce a persisted judgment',
      depends_on: [],
      input_contract: 'organization.j0.input.v1',
      output_contract: 'organization.j0.output.v1',
      runner_type: 'deterministic'
    }],
    edges: []
  };
  let runnerInvocations = 0;
  const record = await executeJudgmentDAG({
    run_id: 'run-organization-j0-consumer',
    dag,
    input: { prompt: '固定commit consumerの永続化を証明する' },
    runners: {
      deterministic: {
        version: 'organization-consumer-runner-v1',
        run: ({ node, input }) => {
          runnerInvocations += 1;
          return { node_id: node.id, accepted: true, input };
        }
      }
    }
  });
  const receipt = await saveJudgmentDAGRunArtifact({ root: process.env.J0_ARTIFACT_ROOT, record });
  process.stdout.write(JSON.stringify({ receipt, record, runnerInvocations }));
`;

const LOAD_PROCESS = String.raw`
  import { loadJudgmentDAGRunArtifact } from '@unson/brainbase-mcp/judgment-dag';

  const record = await loadJudgmentDAGRunArtifact({
    root: process.env.J0_ARTIFACT_ROOT,
    artifact_id: process.env.J0_ARTIFACT_ID
  });
  const deeplyFrozen = (value) => {
    if (value === null || typeof value !== 'object') return true;
    return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
  };
  process.stdout.write(JSON.stringify({ record, deeplyFrozen: deeplyFrozen(record) }));
`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runProcess(source, environment) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: 'utf8'
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('J0 organization pinned artifact consumer', () => {
  it('pins the public package to the verified exact commit in manifest and lock', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));

    expect(manifest.dependencies['@unson/brainbase-mcp']).toBe(DEPENDENCY);
    expect(lock.packages[''].dependencies['@unson/brainbase-mcp']).toBe(DEPENDENCY);
    expect(lock.packages['node_modules/@unson/brainbase-mcp'].resolved).toBe(RESOLVED_DEPENDENCY);
  });

  it('saves in process A and reloads the complete immutable record in process B without a runner', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'brainbase-unson-j0-consumer-'));
    roots.push(root);

    const saved = runProcess(SAVE_PROCESS, { J0_ARTIFACT_ROOT: root });
    const loaded = runProcess(LOAD_PROCESS, {
      J0_ARTIFACT_ROOT: root,
      J0_ARTIFACT_ID: saved.receipt.artifact_id
    });

    expect(saved.runnerInvocations).toBe(1);
    expect(saved.receipt).toMatchObject({
      artifact_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      artifact_version: 'judgment-dag-run-artifact.v1',
      run_id: saved.record.run_id,
      status: 'created'
    });
    expect(loaded.record).toEqual(saved.record);
    expect(loaded.deeplyFrozen).toBe(true);
    expect(loaded.record).toMatchObject({
      run_id: 'run-organization-j0-consumer',
      dag: saved.record.dag,
      input: saved.record.input,
      execution_order: ['judgment.answer'],
      runner_versions: saved.record.runner_versions,
      nodes: saved.record.nodes
    });
  });
});
