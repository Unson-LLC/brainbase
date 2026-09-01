import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PUBLIC_MESSAGE_PATH,
  PUBLIC_MESSAGE_SYNC_TARGETS,
  canonicalize,
  loadPublicMessage,
  sha256,
  syncPublicMessage,
  validatePublicMessage
} from '../scripts/lib/public-message.mjs';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const fixturePath = join(repoRoot, 'tests/fixtures/public-message-candidate.json');

async function createProjectionRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-public-message-'));
  tempRoots.push(root);
  const paths = [PUBLIC_MESSAGE_PATH, ...PUBLIC_MESSAGE_SYNC_TARGETS];
  for (const relativePath of paths) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repoRoot, relativePath), target);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

describe('public-message publication contract', () => {
  it('keeps every checked-in projection synchronized with the approved baseline', async () => {
    const result = await syncPublicMessage(repoRoot, { write: false });
    expect(result.changedFiles).toEqual([]);
    expect(result.message.copy.headline).toBe('AIとの仕事を、毎回ゼロから始めない。');
  });

  it('requires an exact Graph snapshot and explicit approval for promotion candidates', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    expect(validatePublicMessage(fixture, { requireGraphSource: true })).toEqual(fixture);
    expect(sha256(fixture)).toMatch(/^sha256:[0-9a-f]{64}$/);

    const baseline = await loadPublicMessage(repoRoot);
    expect(() => validatePublicMessage(baseline, { requireGraphSource: true }))
      .toThrow('promotion candidates must have source.type=brainbase_graph');

    const missingSnapshot = structuredClone(fixture);
    delete missingSnapshot.source.snapshot_hash;
    expect(() => validatePublicMessage(missingSnapshot, { requireGraphSource: true }))
      .toThrow('source.snapshot_hash must be a non-empty string');
  });

  it('plans without writes and applies only the approved projections plus create-once history', async () => {
    const root = await createProjectionRoot();
    const currentBefore = await readFile(join(root, PUBLIC_MESSAGE_PATH), 'utf8');

    const plan = await execFileAsync(process.execPath, [
      join(repoRoot, 'scripts/promote-public-message.mjs'),
      '--plan',
      '--candidate', fixturePath,
      '--expected-candidate-id', 'test-public-message-2026-08-25',
      '--root', root
    ], { cwd: repoRoot });
    const parsedPlan = JSON.parse(plan.stdout);
    expect(parsedPlan.status).toBe('copy_change');
    expect(parsedPlan.source.entity_id).toBe('phi_test_public_message');
    expect(await readFile(join(root, PUBLIC_MESSAGE_PATH), 'utf8')).toBe(currentBefore);

    const applied = await execFileAsync(process.execPath, [
      join(repoRoot, 'scripts/promote-public-message.mjs'),
      '--apply',
      '--candidate', fixturePath,
      '--expected-candidate-id', 'test-public-message-2026-08-25',
      '--root', root
    ], { cwd: repoRoot });
    expect(JSON.parse(applied.stdout).status).toBe('applied');

    const promoted = await loadPublicMessage(root);
    expect(promoted.candidate_id).toBe('test-public-message-2026-08-25');
    expect(promoted.copy.headline).toBe('テスト用の判断を、属人化させない。');

    const history = JSON.parse(await readFile(
      join(root, 'docs/publication/history/test-public-message-2026-08-25.json'),
      'utf8'
    ));
    expect(canonicalize(history)).toBe(canonicalize(promoted));

    const readme = await readFile(join(root, 'README.md'), 'utf8');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(readme).toContain(promoted.copy.headline);
    expect(packageJson.description).toBe(promoted.copy.package_description);
    await expect(syncPublicMessage(root, { write: false })).resolves.toMatchObject({
      changedFiles: []
    });
  });

  it('rejects a conflicting reuse of a history candidate id', async () => {
    const root = await createProjectionRoot();
    const args = [
      join(repoRoot, 'scripts/promote-public-message.mjs'),
      '--apply',
      '--candidate', fixturePath,
      '--root', root
    ];
    await execFileAsync(process.execPath, args, { cwd: repoRoot });

    const conflict = JSON.parse(await readFile(fixturePath, 'utf8'));
    conflict.copy.headline = '同じIDへ別内容を上書きしない。';
    const conflictPath = join(root, 'conflict.json');
    await import('node:fs/promises').then(({ writeFile }) => (
      writeFile(conflictPath, `${JSON.stringify(conflict, null, 2)}\n`)
    ));

    await expect(execFileAsync(process.execPath, [
      join(repoRoot, 'scripts/promote-public-message.mjs'),
      '--apply',
      '--candidate', conflictPath,
      '--root', root
    ], { cwd: repoRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining('history conflict')
    });
  });
});
