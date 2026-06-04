import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixturePersonalOs } from './fixtures.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local SSOT loader', () => {
  it('creates the minimum canonical local files', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const os = await loadPersonalOs(dir);

    expect(os.graph.version).toBe(1);
    expect(os.personalKg).toEqual([]);
    expect(os.relationships.relationships).toEqual([]);
    expect(os.decisions).toEqual([]);
  });

  it('fails loudly when a canonical file is malformed', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await writeFile(join(dir, 'graph.json'), '{"version":2,"entities":[]}');

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Failed to read canonical SSOT file|Invalid literal value/);
  });

  it('loads canonical Personal KG even when raw sources disagree', async () => {
    const dir = await tempDir();
    await createFixturePersonalOs(dir);
    const os = await loadPersonalOs(dir);

    expect(os.sourceCount).toBe(1);
    expect(os.personalKg.map((entry) => entry.text).join('\n')).toContain('canonical Personal KG wins');
    expect(os.personalKg.map((entry) => entry.text).join('\n')).not.toContain('Remote hosted server should be preferred');
  });
});
