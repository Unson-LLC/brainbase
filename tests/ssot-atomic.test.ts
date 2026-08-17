import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { initializePersonalOs, loadPersonalOs, mutatePersonalOs, mutatePersonalOsWithSidecar } from '../src/ssot.js';

const canonicalFiles = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'];
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-atomic-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.BRAINBASE_SSOT_FAIL_COMMITTED_CLEANUP;
  delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
  delete process.env.BRAINBASE_SSOT_FAIL_RECOVERY;
  delete process.env.BRAINBASE_SSOT_PAUSE_AFTER_PUBLISH_MS;
  delete process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS;
  delete process.env.BRAINBASE_SSOT_LOCK_RETRY_MS;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local SSOT atomic recovery', () => {
  it('rejects sidecars that collide with canonical or transaction-managed paths', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const before = await canonicalSnapshot(dir);

    for (const sidecar of [
      'graph.json', 'Graph.json', 'RELATIONSHIPS.JSON', '.BRAINBASE-SSOT.LOCK/owner.json',
      '.brainbase-ssot.lock/owner.json', '.brainbase-staging-forged/value.json', '.brainbase-transaction-forged/value.json',
      '.BRAINBASE-STAGING-forged/value.json', '.BRAINBASE-TRANSACTION-forged/value.json',
      '..\\graph.json', 'C:\\tmp\\graph.json', '\\\\server\\share\\graph.json', '.brainbase-ssot.lock\\owner.json',
      '.brainbase-staging-forged\\value.json', '.brainbase-transaction-forged\\value.json'
    ]) {
      await expect(mutatePersonalOsWithSidecar(dir, sidecar, (current) => ({
        next: current,
        sidecarContent: '{"corrupt":true}',
        result: true
      }))).rejects.toThrow(/Unsafe SSOT transaction sidecar path/);
    }
    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
  });

  it('leaves the legacy four-file shape and no runtime residue after a normal mutation', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [...current.personalKg, { id: 'clean', type: 'value', text: 'No residue' }]
    }));

    const entries = await readdir(dir);
    expect(canonicalFiles.every((fileName) => entries.includes(fileName))).toBe(true);
    expect(entries.filter((entry) => entry.startsWith('.brainbase-staging-'))).toEqual([]);
    expect(entries.filter((entry) => entry.startsWith('.brainbase-transaction-'))).toEqual([]);
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('discards an unregistered staging residue without changing canonical state', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const before = await canonicalSnapshot(dir);
    const staging = join(dir, '.brainbase-staging-incomplete-copy');
    await mkdir(join(staging, 'previous'), { recursive: true });
    await writeFile(join(staging, 'previous', 'graph.json'), '{"partial":true}');

    await loadPersonalOs(dir);

    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
    await expect(readFile(join(staging, 'previous', 'graph.json'), 'utf8')).rejects.toThrow();
  });

  it('rolls a registered unfinished mutation back to its complete previous snapshot', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [{ id: 'before', type: 'value', text: 'Retain this aggregate' }]
    }));
    const before = await canonicalSnapshot(dir);
    const transaction = join(dir, '.brainbase-transaction-unfinished-mutation');
    const previous = join(transaction, 'previous');
    await mkdir(previous, { recursive: true });
    await copyCanonical(dir, previous);
    await writeFile(join(transaction, 'transaction.json'), '{"version":1,"mode":"mutation"}\n');
    await writeFile(join(transaction, 'PREPARED'), '');
    await writeFile(join(dir, 'graph.json'), '{"version":1,"owner":{"name":"partial-new"},"entities":[]}\n');

    const recovered = await loadPersonalOs(dir);

    expect(recovered.personalKg).toEqual([{ id: 'before', type: 'value', text: 'Retain this aggregate' }]);
    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
  });

  it('adopts a COMMITTED aggregate and removes only its transaction residue', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    await mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [{ id: 'committed', type: 'value', text: 'Keep committed state' }]
    }));
    const transaction = join(dir, '.brainbase-transaction-committed-residue');
    await mkdir(transaction);
    await writeFile(join(transaction, 'COMMITTED'), '');

    const recovered = await loadPersonalOs(dir);

    expect(recovered.personalKg.map((entry) => entry.id)).toEqual(['committed']);
    await expect(readFile(join(transaction, 'COMMITTED'), 'utf8')).rejects.toThrow();
  });

  it('fails loud for a registered transaction without PREPARED', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const transaction = join(dir, '.brainbase-transaction-missing-prepared');
    await mkdir(transaction);
    await writeFile(join(transaction, 'transaction.json'), '{"version":1,"mode":"mutation"}\n');

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Incomplete registered SSOT transaction/);
    await expect(access(transaction)).resolves.toBeUndefined();
  });

  it('fails loud for invalid registered transaction metadata', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const transaction = join(dir, '.brainbase-transaction-invalid-metadata');
    await mkdir(transaction);
    await writeFile(join(transaction, 'PREPARED'), '');
    await writeFile(join(transaction, 'transaction.json'), '{"version":2,"mode":"mutation"}\n');

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Invalid registered SSOT transaction metadata/);
    await expect(access(transaction)).resolves.toBeUndefined();
  });

  it('fails loud when a registered transaction snapshot is incomplete', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const transaction = join(dir, '.brainbase-transaction-incomplete-snapshot');
    const previous = join(transaction, 'previous');
    await mkdir(previous, { recursive: true });
    await copyFile(join(dir, 'graph.json'), join(previous, 'graph.json'));
    await writeFile(join(transaction, 'PREPARED'), '');
    await writeFile(join(transaction, 'transaction.json'), '{"version":1,"mode":"mutation"}\n');

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Partial canonical SSOT set/);
    await expect(access(transaction)).resolves.toBeUndefined();
  });

  it('retains a failed rollback transaction and retries recovery on the next access', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const before = await canonicalSnapshot(dir);
    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '1';
    process.env.BRAINBASE_SSOT_FAIL_RECOVERY = '1';

    await expect(mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [{ id: 'uncommitted', type: 'value', text: 'Must roll back' }]
    }))).rejects.toThrow(/Injected SSOT publish failure/);

    expect((await readdir(dir)).some((entry) => entry.startsWith('.brainbase-transaction-'))).toBe(true);
    delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
    delete process.env.BRAINBASE_SSOT_FAIL_RECOVERY;
    await loadPersonalOs(dir);

    await expect(canonicalSnapshot(dir)).resolves.toEqual(before);
    expect((await readdir(dir)).some((entry) => entry.startsWith('.brainbase-transaction-'))).toBe(false);
  });

  it('returns success after COMMITTED even when post-commit cleanup fails, then cleans on read', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    process.env.BRAINBASE_SSOT_FAIL_COMMITTED_CLEANUP = '1';

    const committed = await mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [{ id: 'success', type: 'value', text: 'Commit is the success boundary' }]
    }));

    expect(committed.personalKg.map((entry) => entry.id)).toEqual(['success']);
    expect((await readdir(dir)).some((entry) => entry.startsWith('.brainbase-transaction-'))).toBe(true);
    delete process.env.BRAINBASE_SSOT_FAIL_COMMITTED_CLEANUP;
    await expect(loadPersonalOs(dir)).resolves.toMatchObject({ personalKg: [{ id: 'success' }] });
    expect((await readdir(dir)).some((entry) => entry.startsWith('.brainbase-transaction-'))).toBe(false);
  });

  it('serializes concurrent initialization and returns one complete aggregate', async () => {
    const dir = await tempDir();

    await Promise.all([initializePersonalOs(dir), initializePersonalOs(dir), initializePersonalOs(dir)]);

    await expect(loadPersonalOs(dir)).resolves.toMatchObject({
      graph: { version: 2 },
      relationships: { version: 1 },
      personalKg: [],
      decisions: []
    });
    const entries = await readdir(dir);
    expect(canonicalFiles.every((fileName) => entries.includes(fileName))).toBe(true);
  });

  it('keeps readers and writers behind the lock during first initialization publication', async () => {
    const dir = await tempDir();
    process.env.BRAINBASE_SSOT_PAUSE_AFTER_PUBLISH_MS = '30';
    const initialization = initializePersonalOs(dir);
    await waitForFile(join(dir, 'graph.json'));

    const reader = loadPersonalOs(dir);
    const writer = mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [...current.personalKg, { id: 'first-writer', type: 'value', text: 'Writer waited for initialization' }]
    }));
    const [readState, writtenState] = await Promise.all([reader, writer, initialization]);

    expect(readState).toMatchObject({
      graph: { version: 2 },
      relationships: { version: 1 },
      decisions: []
    });
    expect(writtenState.personalKg.map((entry) => entry.id)).toContain('first-writer');
    await expect(loadPersonalOs(dir)).resolves.toMatchObject({ personalKg: [expect.objectContaining({ id: 'first-writer' })] });
  });

  it('preserves a legacy four-file aggregate through its first atomic mutation', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'graph.json'), `${JSON.stringify({ version: 1, owner: { name: 'Legacy owner' }, entities: [{ id: 'legacy-project', type: 'project', name: 'Legacy project' }] }, null, 2)}\n`);
    await writeFile(join(dir, 'relationships.json'), `${JSON.stringify({ version: 1, relationships: [{ id: 'legacy-relation', person: 'Legacy owner', context: 'Legacy context' }] }, null, 2)}\n`);
    await writeFile(join(dir, 'personal-kg.jsonl'), `${JSON.stringify({ id: 'legacy-value', type: 'value', text: 'Legacy value' })}\n`);
    await writeFile(join(dir, 'decisions.jsonl'), `${JSON.stringify({ id: 'legacy-decision', title: 'Legacy decision', decision: 'Retain legacy data' })}\n`);

    await mutatePersonalOs(dir, (current) => ({
      ...current,
      personalKg: [...current.personalKg, { id: 'atomic-value', type: 'value', text: 'First atomic mutation' }]
    }));

    const loaded = await loadPersonalOs(dir);
    expect(loaded.graph).toMatchObject({ owner: { name: 'Legacy owner' }, entities: [{ id: 'legacy-project' }] });
    expect(loaded.relationships.relationships).toEqual([expect.objectContaining({ id: 'legacy-relation' })]);
    expect(loaded.personalKg.map((entry) => entry.id)).toEqual(['legacy-value', 'atomic-value']);
    expect(loaded.decisions).toEqual([expect.objectContaining({ id: 'legacy-decision' })]);
    expect((await readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(2);
    expect((await readFile(join(dir, 'decisions.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
    expect((await readdir(dir)).filter((entry) => canonicalFiles.includes(entry)).sort()).toEqual([...canonicalFiles].sort());
  });

  it.each([
    ['live same-host owner', JSON.stringify({ token: 'live', pid: process.pid, hostname: hostname() })],
    ['incomplete owner metadata', '{"token":"incomplete"}']
  ])('does not steal a %s lock', async (_label, ownerJson) => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const lock = join(dir, '.brainbase-ssot.lock');
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), ownerJson);
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '40';
    process.env.BRAINBASE_SSOT_LOCK_RETRY_MS = '5';

    await expect(loadPersonalOs(dir)).rejects.toThrow(/Timed out waiting/);
    await expect(readFile(join(lock, 'owner.json'), 'utf8')).resolves.toBe(ownerJson);
  });
});

describe('atomic onboarding CLI writers', () => {
  it('preserves both concurrent onboard:seed updates', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);

    const codes = await Promise.all([
      runCli(['onboard:seed', '--dir', dir, '--value', 'Concurrent seed A'], capture().io),
      runCli(['onboard:seed', '--dir', dir, '--value', 'Concurrent seed B'], capture().io)
    ]);

    expect(codes).toEqual([0, 0]);
    const values = (await loadPersonalOs(dir)).personalKg.map((entry) => entry.text);
    expect(values).toEqual(expect.arrayContaining(['Concurrent seed A', 'Concurrent seed B']));
  });

  it('preserves both concurrent onboard:projects --write updates', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);

    const codes = await Promise.all([
      runCli(['onboard:projects', '--dir', dir, '--name', 'Concurrent project A', '--write'], capture().io),
      runCli(['onboard:projects', '--dir', dir, '--name', 'Concurrent project B', '--write'], capture().io)
    ]);

    expect(codes).toEqual([0, 0]);
    const projects = (await loadPersonalOs(dir)).graph.entities.filter((entity) => entity.type === 'project').map((entity) => entity.name);
    expect(projects).toEqual(expect.arrayContaining(['Concurrent project A', 'Concurrent project B']));
  });

  it('preserves both concurrent onboard:apply --write updates', async () => {
    const dir = await tempDir();
    await initializePersonalOs(dir);
    const candidateA = join(dir, 'candidate-a.json');
    const candidateB = join(dir, 'candidate-b.json');
    await writeFile(candidateA, JSON.stringify({ candidates: [{ id: 'person-a', kind: 'person', payload: { name: 'Concurrent person A' } }] }));
    await writeFile(candidateB, JSON.stringify({ candidates: [{ id: 'person-b', kind: 'person', payload: { name: 'Concurrent person B' } }] }));

    const codes = await Promise.all([
      runCli(['onboard:apply', '--dir', dir, '--from', candidateA, '--all', '--write'], capture().io),
      runCli(['onboard:apply', '--dir', dir, '--from', candidateB, '--all', '--write'], capture().io)
    ]);

    expect(codes).toEqual([0, 0]);
    const people = (await loadPersonalOs(dir)).graph.entities.filter((entity) => entity.type === 'person').map((entity) => entity.name);
    expect(people).toEqual(expect.arrayContaining(['Concurrent person A', 'Concurrent person B']));
  });
});

async function copyCanonical(sourceDir: string, targetDir: string): Promise<void> {
  await Promise.all(canonicalFiles.map((fileName) => copyFile(join(sourceDir, fileName), join(targetDir, fileName))));
}

async function canonicalSnapshot(dir: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(canonicalFiles.map(async (fileName) => [fileName, await readFile(join(dir, fileName), 'utf8')])));
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function capture() {
  return {
    io: {
      stdout: { write: (_chunk: string) => undefined },
      stderr: { write: (_chunk: string) => undefined }
    }
  };
}
