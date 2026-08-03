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
    expect(JSON.parse(output.stdout())).toMatchObject({ version: '1.0.0' });
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
      ontologyVersion: '1.0.0',
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
});
