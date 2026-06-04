import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('S-1 C-5 creates the minimum canonical local files', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const os = await loadPersonalOs(dir);

    expect(os.graph.version).toBe(1);
    expect(os.personalKg).toEqual([]);
    expect(os.relationships.relationships).toEqual([]);
    expect(os.decisions).toEqual([]);
  });

  it('INV-3 fails loudly when a canonical file is malformed', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await writeFile(join(dir, 'graph.json'), '{"version":2,"entities":[]}');

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Failed to read canonical SSOT file|Invalid literal value/);
  });

  it.each([
    ['personal-kg.jsonl', '{"id":"","type":"self","text":"missing id"}\n', /Invalid personal-kg\.jsonl line 1/],
    ['relationships.json', '{"version":1,"relationships":[{"id":"r1","person":"","context":"missing person"}]}', /String must contain at least 1 character/],
    ['decisions.jsonl', '{"id":"d1","title":"","decision":"missing title"}\n', /Invalid decisions\.jsonl line 1/]
  ])('INV-3 fails loudly when %s violates the runtime schema', async (fileName, content, errorPattern) => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await writeFile(join(dir, fileName), content);

    await expect(loadPersonalOs(dir)).rejects.toThrow(errorPattern);
  });

  it('C-5 generated schema references include the runtime-required fields', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);

    const graphSchema = JSON.parse(await readFile(join(dir, 'schemas', 'graph.schema.json'), 'utf8'));
    const relationshipSchema = JSON.parse(await readFile(join(dir, 'schemas', 'relationships.schema.json'), 'utf8'));
    const personalKgSchema = JSON.parse(await readFile(join(dir, 'schemas', 'personal-kg.schema.json'), 'utf8'));
    const decisionSchema = JSON.parse(await readFile(join(dir, 'schemas', 'decisions.schema.json'), 'utf8'));

    expect(graphSchema.properties.entities.items.required).toEqual(['id', 'type', 'name']);
    expect(relationshipSchema.properties.relationships.items.required).toEqual(['id', 'person', 'context']);
    expect(personalKgSchema.required).toEqual(['id', 'type', 'text']);
    expect(personalKgSchema.properties.text.minLength).toBe(1);
    expect(decisionSchema.required).toEqual(['id', 'title', 'decision']);
    expect(decisionSchema.properties.title.minLength).toBe(1);
  });

  it('INV-2 AP-2 loads canonical Personal KG even when raw sources disagree', async () => {
    const dir = await tempDir();
    await createFixturePersonalOs(dir);
    const os = await loadPersonalOs(dir);

    expect(os.sourceCount).toBe(1);
    expect(os.personalKg.map((entry) => entry.text).join('\n')).toContain('canonical Personal KG wins');
    expect(os.personalKg.map((entry) => entry.text).join('\n')).not.toContain('Remote hosted server should be preferred');
  });
});
