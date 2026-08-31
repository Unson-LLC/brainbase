import { access, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
  JudgmentDAGArtifactError,
  executeJudgmentDAG,
  loadJudgmentDAGRunArtifact,
  saveJudgmentDAGRunArtifact,
  type JudgmentDAG,
  type JudgmentDAGRunRecord
} from '../src/judgment-dag.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'brainbase-j0-artifact-'));
  roots.push(root);
  return root;
}

function dag(): JudgmentDAG {
  return {
    id: 'j0-artifact-test',
    version: '2026-08-31.1',
    nodes: [
      {
        id: 'context.input',
        node_type: 'observation',
        layer: 'context',
        scope: { type: 'project', id: 'j0-artifact-test' },
        version: '1.0.0',
        description: 'capture input',
        depends_on: [],
        input_contract: 'j0.artifact.input.v1',
        output_contract: 'j0.artifact.context.v1',
        runner_type: 'deterministic'
      },
      {
        id: 'judgment.answer',
        node_type: 'judgment',
        layer: 'judgment',
        scope: { type: 'project', id: 'j0-artifact-test' },
        version: '1.0.0',
        description: 'produce judgment',
        depends_on: ['context.input'],
        input_contract: 'j0.artifact.input.v1',
        output_contract: 'j0.artifact.judgment.v1',
        runner_type: 'deterministic'
      }
    ],
    edges: [{ from: 'context.input', to: 'judgment.answer', relation: 'depends_on' }]
  };
}

async function record(input: Record<string, unknown> = { prompt: '保存して再読込する' }): Promise<JudgmentDAGRunRecord> {
  return executeJudgmentDAG({
    run_id: 'run-j0-artifact-test',
    dag: dag(),
    input,
    runners: {
      deterministic: {
        version: 'artifact-runner-v1',
        run: ({ node, input, dependency_outputs }) => ({
          node_id: node.id,
          input,
          dependency_outputs
        })
      }
    }
  });
}

function artifactPath(root: string, artifactId: string): string {
  return path.join(root, 'artifacts', `${artifactId.slice('sha256:'.length)}.json`);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) expectDeeplyFrozen(child);
}

describe('J0 durable run artifact contract', () => {
  it('saves and reloads the complete run record from the public subpath', async () => {
    const root = await temporaryRoot();
    const original = await record({ prompt: '保存して再読込する', zeta: 1, alpha: { b: 2, a: 1 } });

    const receipt = await saveJudgmentDAGRunArtifact({ root, record: original });
    const loaded = await loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id });

    expect(receipt).toEqual({
      artifact_id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      artifact_version: JUDGMENT_DAG_RUN_ARTIFACT_VERSION,
      run_id: original.run_id,
      status: 'created'
    });
    expect(loaded).toEqual(original);
    expectDeeplyFrozen(loaded);
  });

  it('uses canonical object ordering and converges repeated saves', async () => {
    const root = await temporaryRoot();
    const left = await record({ '\u{10000}': 4, '\uE000': 3, zeta: 1, alpha: { b: 2, a: 1 } });
    const right = await record({ alpha: { a: 1, b: 2 }, zeta: 1, '\uE000': 3, '\u{10000}': 4 });

    const first = await saveJudgmentDAGRunArtifact({ root, record: left });
    const second = await saveJudgmentDAGRunArtifact({ root, record: right });

    expect(second.artifact_id).toBe(first.artifact_id);
    expect(second.status).toBe('existing');
    const bytes = await readFile(artifactPath(root, first.artifact_id), 'utf8');
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes.indexOf('"\uE000"')).toBeLessThan(bytes.indexOf('"\u{10000}"'));
  });

  it('rejects tampered and truncated stored bytes without returning a record', async () => {
    for (const mutate of [
      (bytes: string) => bytes.replace('run-j0-artifact-test', 'run-j0-artifact-evil'),
      (bytes: string) => bytes.slice(0, Math.floor(bytes.length / 2))
    ]) {
      const root = await temporaryRoot();
      const receipt = await saveJudgmentDAGRunArtifact({ root, record: await record() });
      const file = artifactPath(root, receipt.artifact_id);
      await writeFile(file, mutate(await readFile(file, 'utf8')));

      await expect(loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id }))
        .rejects.toBeInstanceOf(JudgmentDAGArtifactError);
      await expect(loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id }))
        .rejects.toMatchObject({ code: 'integrity_mismatch' });
    }
  });

  it('rejects an invalid expected ID and a file published under the wrong ID', async () => {
    const root = await temporaryRoot();
    const receipt = await saveJudgmentDAGRunArtifact({ root, record: await record() });
    await expect(loadJudgmentDAGRunArtifact({ root, artifact_id: '../escape' }))
      .rejects.toMatchObject({ code: 'invalid_artifact_id' });
    await expect(loadJudgmentDAGRunArtifact({
      root,
      artifact_id: Symbol('invalid') as unknown as string
    })).rejects.toMatchObject({ code: 'invalid_artifact_id' });

    const wrongId = `sha256:${'0'.repeat(64)}`;
    await rename(artifactPath(root, receipt.artifact_id), artifactPath(root, wrongId));
    await expect(loadJudgmentDAGRunArtifact({ root, artifact_id: wrongId }))
      .rejects.toMatchObject({ code: 'integrity_mismatch' });
  });

  it('rejects malformed records before filesystem publication', async () => {
    const root = await temporaryRoot();
    const malformed = structuredClone(await record()) as unknown as {
      execution_order: string[];
    };
    malformed.execution_order.reverse();

    await expect(saveJudgmentDAGRunArtifact({
      root,
      record: malformed as unknown as JudgmentDAGRunRecord
    })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects unknown artifact versions and extra envelope fields', async () => {
    for (const mutate of [
      (envelope: Record<string, unknown>) => ({ ...envelope, artifact_version: 'judgment-dag-run-artifact.v999' }),
      (envelope: Record<string, unknown>) => ({ ...envelope, unexpected: true })
    ]) {
      const root = await temporaryRoot();
      const receipt = await saveJudgmentDAGRunArtifact({ root, record: await record() });
      const file = artifactPath(root, receipt.artifact_id);
      const envelope = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      await writeFile(file, `${JSON.stringify(mutate(envelope))}\n`);

      await expect(loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id }))
        .rejects.toMatchObject({ code: 'invalid_artifact' });
    }
  });

  it('rejects symlink artifacts and reload snapshots remain storage-isolated', async () => {
    const root = await temporaryRoot();
    const original = structuredClone(await record()) as JudgmentDAGRunRecord;
    const receipt = await saveJudgmentDAGRunArtifact({ root, record: original });
    (original.input as { prompt: string }).prompt = 'caller mutation';
    const loaded = await loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id });
    expect(() => {
      (loaded.input as { prompt: string }).prompt = 'mutated';
    }).toThrow();
    expect((await loadJudgmentDAGRunArtifact({ root, artifact_id: receipt.artifact_id })).input)
      .toEqual({ prompt: '保存して再読込する' });

    const linkedRoot = await temporaryRoot();
    const linkedFile = artifactPath(linkedRoot, receipt.artifact_id);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(linkedFile), { recursive: true }));
    await symlink(artifactPath(root, receipt.artifact_id), linkedFile);
    await expect(loadJudgmentDAGRunArtifact({ root: linkedRoot, artifact_id: receipt.artifact_id }))
      .rejects.toMatchObject({ code: 'invalid_artifact' });
  });

  it('rejects a dangling artifact-directory symlink before creating its target', async () => {
    const root = await temporaryRoot();
    const danglingTarget = `${root}-outside`;
    roots.push(danglingTarget);
    await symlink(danglingTarget, path.join(root, 'artifacts'));

    await expect(saveJudgmentDAGRunArtifact({ root, record: await record() }))
      .rejects.toMatchObject({ code: 'invalid_artifact' });
    await expect(access(danglingTarget)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
