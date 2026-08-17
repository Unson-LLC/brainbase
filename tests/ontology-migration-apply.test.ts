import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { migrateCanonicalGraph } from '../src/ssot.js';

const canonicalFiles = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'] as const;
const dirs: string[] = [];

afterEach(async () => {
  delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('canonical Graph migration apply', () => {
  it('previews migration_required without changing any canonical byte', async () => {
    const dir = await fixture();
    const before = await snapshot(dir);

    const result = await migrateCanonicalGraph(dir);

    expect(result.status).toBe('migration_required');
    expect(result.written).toBe(false);
    await expect(snapshot(dir)).resolves.toEqual(before);
  });

  it('requires explicit --write, commits all canonical files atomically, and reruns as a no-op', async () => {
    const dir = await fixture();
    const nonGraphBefore = await snapshot(dir);
    const previewOutput = capture();

    expect(await runCli(['ontology:migrate', '--dir', dir], previewOutput.io)).toBe(0);
    expect(JSON.parse(previewOutput.stdout()).status).toBe('migration_required');
    const expectedInputDigest = JSON.parse(previewOutput.stdout()).expectedInputDigest as string;
    expect(expectedInputDigest).toBe(JSON.parse(previewOutput.stdout()).inputDigest);
    await expect(snapshot(dir)).resolves.toEqual(nonGraphBefore);

    const writeOutput = capture();
    expect(await runCli([
      'ontology:migrate', '--dir', dir, '--write', '--expected-input-digest', expectedInputDigest
    ], writeOutput.io)).toBe(0);
    expect(JSON.parse(writeOutput.stdout())).toMatchObject({ status: 'migration_required', written: true });
    expect(JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8')).version).toBe(2);
    const afterWrite = await snapshot(dir);
    expect(afterWrite['relationships.json']).toBe(nonGraphBefore['relationships.json']);
    expect(afterWrite['personal-kg.jsonl']).toBe(nonGraphBefore['personal-kg.jsonl']);
    expect(afterWrite['decisions.jsonl']).toBe(nonGraphBefore['decisions.jsonl']);

    const secondPreview = await migrateCanonicalGraph(dir);
    const second = await migrateCanonicalGraph(dir, { write: true, expectedInputDigest: secondPreview.inputDigest });
    expect(second).toMatchObject({ status: 'up_to_date', written: false });
    await expect(snapshot(dir)).resolves.toEqual(afterWrite);
  });

  it('requires the preview digest and blocks a stale concurrent writer after replanning under the SSOT lock', async () => {
    const dir = await fixture();
    const preview = await migrateCanonicalGraph(dir);

    const results = await Promise.all([
      migrateCanonicalGraph(dir, { write: true, expectedInputDigest: preview.inputDigest }),
      migrateCanonicalGraph(dir, { write: true, expectedInputDigest: preview.inputDigest })
    ]);

    expect(results.filter((result) => result.written)).toHaveLength(1);
    expect(results.map((result) => result.status).sort()).toEqual(['blocked', 'migration_required']);
    expect(results.find((result) => result.status === 'blocked')?.issues).toContainEqual(expect.objectContaining({
      code: 'input_digest_mismatch'
    }));
    expect(JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8')).version).toBe(2);
  });

  it('does not write without the exact input digest returned by preview', async () => {
    const dir = await fixture();
    const before = await snapshot(dir);

    const missing = await migrateCanonicalGraph(dir, { write: true });
    const stale = await migrateCanonicalGraph(dir, { write: true, expectedInputDigest: '0'.repeat(64) });

    expect(missing).toMatchObject({ status: 'blocked', written: false });
    expect(missing.issues).toContainEqual(expect.objectContaining({ code: 'expected_input_digest_required' }));
    expect(stale).toMatchObject({ status: 'blocked', written: false });
    expect(stale.issues).toContainEqual(expect.objectContaining({ code: 'input_digest_mismatch' }));
    await expect(snapshot(dir)).resolves.toEqual(before);
  });

  it('exposes the preview digest as a required CLI write argument', async () => {
    const dir = await fixture();
    const before = await snapshot(dir);
    const output = capture();

    expect(await runCli(['ontology:migrate', '--dir', dir, '--write'], output.io)).toBe(1);
    expect(JSON.parse(output.stdout())).toMatchObject({ status: 'blocked', written: false });
    await expect(snapshot(dir)).resolves.toEqual(before);
  });

  it('does not write a blocked plan and returns a failing CLI status', async () => {
    const dir = await fixture({ blocked: true });
    const before = await snapshot(dir);
    const output = capture();

    const preview = await migrateCanonicalGraph(dir);
    const code = await runCli([
      'ontology:migrate', '--dir', dir, '--write', '--expected-input-digest', preview.inputDigest
    ], output.io);

    expect(code).toBe(1);
    expect(JSON.parse(output.stdout())).toMatchObject({ status: 'blocked', written: false });
    await expect(snapshot(dir)).resolves.toEqual(before);
  });

  it('rolls back the complete four-file aggregate when publication fails', async () => {
    const dir = await fixture();
    const before = await snapshot(dir);
    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '2';

    const preview = await migrateCanonicalGraph(dir);
    await expect(migrateCanonicalGraph(dir, {
      write: true,
      expectedInputDigest: preview.inputDigest
    })).rejects.toThrow(/Injected SSOT publish failure/);

    delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
    await migrateCanonicalGraph(dir);
    await expect(snapshot(dir)).resolves.toEqual(before);
  });
});

async function fixture(options: { blocked?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-migration-apply-'));
  dirs.push(dir);
  await writeFile(join(dir, 'graph.json'), `${JSON.stringify({
    version: 1,
    owner: { name: '佐藤' },
    entities: [
      { id: 'project-atlas', type: 'project', name: 'Atlas' },
      { id: 'person-sato', type: 'person', name: '佐藤', metadata: { projectId: options.blocked ? 'project-missing' : 'project-atlas' } }
    ]
  }, null, 2)}\n`);
  await writeFile(join(dir, 'relationships.json'), '{\n  "version": 1,\n  "relationships": []\n}\n');
  await writeFile(join(dir, 'personal-kg.jsonl'), '');
  await writeFile(join(dir, 'decisions.jsonl'), '');
  return dir;
}

async function snapshot(dir: string): Promise<Record<typeof canonicalFiles[number], string>> {
  return Object.fromEntries(await Promise.all(canonicalFiles.map(async (file) => [file, await readFile(join(dir, file), 'utf8')]))) as Record<typeof canonicalFiles[number], string>;
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}
