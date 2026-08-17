import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { createFixturePersonalOs } from './fixtures.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-ontology-cli-'));
  dirs.push(dir);
  await createFixturePersonalOs(dir);
  return dir;
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

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ontology CLI', () => {
  it('O-1 ontology:show does not require a Personal OS directory', async () => {
    const output = capture();
    const code = await runCli(['ontology:show'], output.io);

    expect(code).toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({ version: '2.0.0' });
  });

  it('O-3 ontology:audit reports malformed canonical input as unverified, never zero', async () => {
    const dir = await fixtureDir();
    await writeFile(join(dir, 'decisions.jsonl'), '{not-json}\n');
    const output = capture();

    const code = await runCli(['ontology:audit', '--dir', dir], output.io);
    const result = JSON.parse(output.stdout());

    expect(code).toBe(1);
    expect(output.stderr()).toBe('');
    expect(result).toMatchObject({
      status: 'unverified',
      ontologyVersion: '2.0.0',
      violationCount: null,
      coverage: {
        complete: false,
        unavailableSources: ['decisions.jsonl']
      }
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      ruleId: 'ONT-AUDIT-SOURCE-UNAVAILABLE'
    }));
  });

  it('documents and accepts all supported ontology interpretation versions', async () => {
    const help = capture();
    expect(await runCli(['--help'], help.io)).toBe(0);
    expect(help.stdout()).toContain('--ontology-version 0.0.0|1.0.0|2.0.0');

    const dir = await fixtureDir();
    for (const ontologyVersion of ['0.0.0', '1.0.0', '2.0.0']) {
      const output = capture();
      expect(await runCli(['ontology:audit', '--dir', dir, '--ontology-version', ontologyVersion], output.io)).toBe(0);
      expect(JSON.parse(output.stdout())).toMatchObject({ ontologyVersion });
    }
  });

  it('uses the Graph v2 release binding when no CLI override is provided', async () => {
    const dir = await fixtureDir();
    const graphPath = join(dir, 'graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    graph.ontology.version = '1.0.0';
    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
    const output = capture();

    expect(await runCli(['ontology:audit', '--dir', dir], output.io)).toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({ ontologyVersion: '1.0.0' });
  });

  it('O-7 ontology:audit records the requested historical interpretation version', async () => {
    const dir = await fixtureDir();
    const output = capture();

    const code = await runCli([
      'ontology:audit', '--dir', dir, '--ontology-version', '0.0.0'
    ], output.io);

    expect(code).toBe(0);
    expect(JSON.parse(output.stdout())).toMatchObject({
      status: 'complete',
      ontologyVersion: '0.0.0'
    });
  });

  it('O-6 rejects an invalid proposed seed before the first canonical write', async () => {
    const dir = await fixtureDir();
    const duplicateDecisions = [
      { id: 'duplicate', title: 'A', decision: 'Use A' },
      { id: 'duplicate', title: 'B', decision: 'Use B' }
    ];
    await writeFile(join(dir, 'decisions.jsonl'), `${duplicateDecisions.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const graphBefore = await readFile(join(dir, 'graph.json'), 'utf8');
    const output = capture();

    const code = await runCli(['onboard:seed', '--dir', dir, '--name', 'Changed Owner'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('ONT-DECISION-ID-UNIQUE');
    await expect(readFile(join(dir, 'graph.json'), 'utf8')).resolves.toBe(graphBefore);
  });

  it('O-6 rejects an invalid project write without changing any canonical file', async () => {
    const dir = await fixtureDir();
    await writeDuplicateDecisions(dir);
    const before = await canonicalSnapshot(dir);
    const output = capture();

    const code = await runCli([
      'onboard:projects', '--dir', dir, '--name', 'Blocked project', '--write'
    ], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('ONT-DECISION-ID-UNIQUE');
    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
  });

  it('O-6 rejects an invalid candidate apply without changing any canonical file', async () => {
    const dir = await fixtureDir();
    await writeDuplicateDecisions(dir);
    const candidatePath = join(dir, 'candidate.json');
    await writeFile(candidatePath, JSON.stringify({
      candidates: [{
        id: 'person-new',
        kind: 'person',
        payload: { name: 'New person' },
        provenance: { count: 1, sources: ['test'] },
        source: 'source-extraction',
        promoted: false
      }]
    }));
    const before = await canonicalSnapshot(dir);
    const output = capture();

    const code = await runCli([
      'onboard:apply', '--dir', dir, '--from', candidatePath, '--all', '--write'
    ], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('ONT-DECISION-ID-UNIQUE');
    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
  });
});

async function writeDuplicateDecisions(dir: string): Promise<void> {
  const duplicateDecisions = [
    { id: 'duplicate', title: 'A', decision: 'Use A' },
    { id: 'duplicate', title: 'B', decision: 'Use B' }
  ];
  await writeFile(
    join(dir, 'decisions.jsonl'),
    `${duplicateDecisions.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
}

async function canonicalSnapshot(dir: string): Promise<Record<string, string>> {
  const files = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'];
  return Object.fromEntries(await Promise.all(
    files.map(async (file) => [file, await readFile(join(dir, file), 'utf8')] as const)
  ));
}
