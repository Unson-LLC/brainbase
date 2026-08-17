import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixturePersonalOs } from './fixtures.js';
import { auditPersonalOsDirectory } from '../src/ontology-ssot.js';
import { callBrainbaseTool } from '../src/server.js';
import { initializePersonalOs, loadPersonalOs, mutatePersonalOs } from '../src/ssot.js';

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

    await expect(loadPersonalOs(dir)).rejects.toThrow(/GRAPH-ONTOLOGY-REQUIRED/);
  });

  it.each([
    ['personal-kg.jsonl', '{"id":"","type":"self","text":"missing id"}\n', /Invalid personal-kg\.jsonl line 1/],
    ['relationships.json', '{"version":1,"relationships":[{"id":"r1","person":"","context":"missing person"}]}', /String must contain at least 1 character|expected string to have >=1 characters/],
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
    expect(personalKgSchema.properties.id.minLength).toBe(1);
    expect(personalKgSchema.properties.text.minLength).toBe(1);
    expect(decisionSchema.required).toEqual(['id', 'title', 'decision']);
    expect(decisionSchema.properties.title.minLength).toBe(1);
    expect(decisionSchema.properties.topic).toEqual({ type: 'string', minLength: 1 });
    expect(decisionSchema.properties.supersedes).toEqual({
      type: 'array',
      items: { type: 'string', minLength: 1 }
    });
    expect(decisionSchema.properties.effectiveAt).toEqual({ type: 'string', format: 'date-time' });
  });

  it('INV-2 AP-2 loads canonical Personal KG even when raw sources disagree', async () => {
    const dir = await tempDir();
    await createFixturePersonalOs(dir);
    const os = await loadPersonalOs(dir);

    expect(os.sourceCount).toBe(1);
    expect(os.personalKg.map((entry) => entry.text).join('\n')).toContain('canonical Personal KG wins');
    expect(os.personalKg.map((entry) => entry.text).join('\n')).not.toContain('Remote hosted server should be preferred');
  });

  it('accepts RFC 3339 offsets in canonical decision effectiveAt values', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await writeFile(join(dir, 'decisions.jsonl'), `${JSON.stringify({
      id: 'decision-offset',
      title: 'Offset timestamp',
      decision: 'Accept RFC 3339 offsets',
      effectiveAt: '2026-08-03T09:00:00+09:00'
    })}\n`);

    await expect(loadPersonalOs(dir)).resolves.toMatchObject({
      decisions: [expect.objectContaining({ effectiveAt: '2026-08-03T09:00:00+09:00' })]
    });
  });

  it('commits all four canonical areas through one aggregate mutation', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await mutatePersonalOs(dir, (current) => ({
      ...current,
      graph: { ...current.graph, owner: { name: 'Atomic owner' } },
      relationships: { version: 1, relationships: [{ id: 'r-atomic', person: 'Owner', context: 'Atomic context' }] },
      personalKg: [{ id: 'kg-atomic', type: 'value', text: 'Atomic value' }],
      decisions: [{ id: 'd-atomic', title: 'Atomic decision', decision: 'Commit together' }]
    }));

    await expect(loadPersonalOs(dir)).resolves.toMatchObject({
      graph: { owner: { name: 'Atomic owner' } },
      relationships: { relationships: [{ id: 'r-atomic' }] },
      personalKg: [{ id: 'kg-atomic' }],
      decisions: [{ id: 'd-atomic' }]
    });
  });

  it('serializes real concurrent writer processes without losing either update', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const helper = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'ssot-writer.ts');

    await Promise.all([
      runProcess([process.execPath, '--import', 'tsx', helper, dir, 'writer-a', '80']),
      runProcess([process.execPath, '--import', 'tsx', helper, dir, 'writer-b', '0'])
    ]);

    const os = await loadPersonalOs(dir);
    expect(os.personalKg.map((entry) => entry.id).sort()).toEqual(['writer-a', 'writer-b']);
  });

  it('rolls a failed normal mutation back to the complete previous aggregate', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const before = await loadPersonalOs(dir);
    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '2';
    try {
      await expect(mutatePersonalOs(dir, (current) => ({
        ...current,
        personalKg: [{ id: 'should-rollback', type: 'value', text: 'not committed' }]
      }))).rejects.toThrow(/Injected SSOT publish failure/);
    } finally {
      delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
    }
    const after = await loadPersonalOs(dir);
    expect(after.graph).toEqual(before.graph);
    expect(after.relationships).toEqual(before.relationships);
    expect(after.personalKg).toEqual(before.personalKg);
    expect(after.decisions).toEqual(before.decisions);
  });

  it('rolls a registered initialization residue forward from retained next', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const transaction = join(dir, '.brainbase-transaction-init-residue');
    const next = join(transaction, 'next');
    await mkdir(next, { recursive: true });
    for (const fileName of ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl']) {
      await copyFile(join(dir, fileName), join(next, fileName));
    }
    await writeFile(join(next, 'graph.json'), `${JSON.stringify({ version: 1, owner: { name: 'Recovered init' }, entities: [] })}\n`);
    await writeFile(join(transaction, 'transaction.json'), '{"version":1,"mode":"initialization"}\n');
    await writeFile(join(transaction, 'PREPARED'), '');
    await writeFile(join(dir, 'graph.json'), '{"version":1,"entities":[]}]');

    const os = await loadPersonalOs(dir);
    expect(os.graph.owner?.name).toBe('Recovered init');
    await expect(readFile(join(transaction, 'PREPARED'), 'utf8')).rejects.toThrow();
  });

  it('fails loudly on a partial canonical set during initialization', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'graph.json'), '{"version":1,"entities":[]}\n');
    await expect(initializePersonalOs(dir)).rejects.toThrow(/Partial canonical SSOT set/);
  });

  it('does not steal a foreign-host lock but quarantines a dead same-host lock', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const lock = join(dir, '.brainbase-ssot.lock');
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ token: 'foreign', pid: 999999, hostname: 'another-host' }));
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '40';
    process.env.BRAINBASE_SSOT_LOCK_RETRY_MS = '5';
    try {
      await expect(loadPersonalOs(dir)).rejects.toThrow(/Timed out waiting/);
    } finally {
      delete process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS;
      delete process.env.BRAINBASE_SSOT_LOCK_RETRY_MS;
    }

    await rm(lock, { recursive: true, force: true });
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ token: 'dead', pid: 999999, hostname: hostname() }));
    await expect(loadPersonalOs(dir)).resolves.toMatchObject({ graph: { version: 1 } });
  });

  it('propagates lock failure to normal MCP reads while ontology audit reports unverified', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await mkdir(join(dir, '.brainbase-ssot.lock'));
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '40';
    process.env.BRAINBASE_SSOT_LOCK_RETRY_MS = '5';
    try {
      await expect(callBrainbaseTool('get_context', { dataDir: dir })).rejects.toThrow(/Timed out waiting/);
      await expect(auditPersonalOsDirectory(dir)).resolves.toMatchObject({
        status: 'unverified',
        violationCount: null,
        coverage: { complete: false }
      });
    } finally {
      delete process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS;
      delete process.env.BRAINBASE_SSOT_LOCK_RETRY_MS;
    }
  });

  it('rejects ontology-invalid aggregates before replacing canonical files', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await expect(mutatePersonalOs(dir, (current) => ({
      ...current,
      graph: {
        ...current.graph,
        entities: [
          { id: 'duplicate', type: 'person', name: 'First' },
          { id: 'duplicate', type: 'project', name: 'Second' }
        ]
      }
    }))).rejects.toThrow(/Ontology validation failed/);
    await expect(loadPersonalOs(dir)).resolves.toMatchObject({ graph: { entities: [] } });
  });
});

async function runProcess(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}: ${stderr}`)));
  });
}
