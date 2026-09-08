import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveMacEvidenceSource } from '../../../scripts/capture-canonical-task-cutover-evidence.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function createSnapshot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canonical-task-mac-snapshot-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), 'snapshot\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', [
    '-c', 'user.email=canonical-task-test@example.test',
    '-c', 'user.name=Canonical Task Test',
    'commit', '--quiet', '-m', 'snapshot',
  ], { cwd: root });
  return root;
}

function head(directory) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
}

describe('resolveMacEvidenceSource', () => {
  it('keeps the same-host Mac checkout flow unchanged when no snapshot root is supplied', async () => {
    const snapshot = await createSnapshot();
    await mkdir(path.join(snapshot, 'evidence'), { recursive: true });
    await writeFile(path.join(snapshot, 'evidence/raw.log'), 'read-only consumer evidence\n');

    const resolved = await resolveMacEvidenceSource({
      rootDir: snapshot,
      macResult: {
        mac_checkout: snapshot,
        raw_log: 'evidence/raw.log',
        head_sha: head(snapshot),
      },
    });

    expect(resolved.checkout).toBe(snapshot);
    expect(resolved.originalCheckout).toBe(snapshot);
    expect(resolved.rawLogPath).toBe(path.join(snapshot, 'evidence/raw.log'));
  });

  it('uses a transported snapshot while leaving the original Mac result bytes unchanged', async () => {
    const snapshot = await createSnapshot();
    const rawLog = 'read-only consumer evidence\n';
    await mkdir(path.join(snapshot, 'evidence'), { recursive: true });
    await writeFile(path.join(snapshot, 'evidence/raw.log'), rawLog);
    const macResultPath = path.join(snapshot, 'mac-result.json');
    const originalResult = {
      mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
      raw_log: 'evidence/raw.log',
      head_sha: head(snapshot),
      raw_log_hash: sha256(rawLog),
    };
    const originalBytes = `${JSON.stringify(originalResult, null, 2)}\n`;
    await writeFile(macResultPath, originalBytes);

    const result = JSON.parse(await readFile(macResultPath, 'utf8'));
    const resolved = await resolveMacEvidenceSource({
      rootDir: snapshot,
      macResult: result,
      macSourceRoot: snapshot,
    });

    expect(resolved.checkout).toBe(snapshot);
    expect(resolved.rawLogPath).toBe(path.join(snapshot, 'evidence/raw.log'));
    expect(resolved.originalCheckout).toBe(originalResult.mac_checkout);
    expect(await readFile(macResultPath, 'utf8')).toBe(originalBytes);
  });

  it('rejects an absolute original raw log outside the original Mac checkout', async () => {
    const snapshot = await createSnapshot();
    await expect(resolveMacEvidenceSource({
      rootDir: snapshot,
      macSourceRoot: snapshot,
      macResult: {
        mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
        raw_log: '/private/other/raw.log',
        head_sha: head(snapshot),
      },
    })).rejects.toThrow(/outside the original Mac checkout/i);
  });

  it('rejects a relative raw log that escapes the original Mac checkout', async () => {
    const snapshot = await createSnapshot();
    await expect(resolveMacEvidenceSource({
      rootDir: snapshot,
      macSourceRoot: snapshot,
      macResult: {
        mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
        raw_log: '../../outside.log',
        head_sha: head(snapshot),
      },
    })).rejects.toThrow(/outside the original Mac checkout/i);
  });

  it('rejects a transported raw log reached through a symbolic link', async () => {
    const snapshot = await createSnapshot();
    await writeFile(path.join(snapshot, 'outside.log'), 'read-only consumer evidence\n');
    await mkdir(path.join(snapshot, 'evidence'), { recursive: true });
    await symlink('../outside.log', path.join(snapshot, 'evidence/raw.log'));

    await expect(resolveMacEvidenceSource({
      rootDir: snapshot,
      macSourceRoot: snapshot,
      macResult: {
        mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
        raw_log: 'evidence/raw.log',
        head_sha: head(snapshot),
      },
    })).rejects.toThrow(/symbolic link/i);
  });

  it('rejects a snapshot whose Git HEAD does not match the original Mac result', async () => {
    const snapshot = await createSnapshot();
    await mkdir(path.join(snapshot, 'evidence'), { recursive: true });
    await writeFile(path.join(snapshot, 'evidence/raw.log'), 'read-only consumer evidence\n');

    await expect(resolveMacEvidenceSource({
      rootDir: snapshot,
      macSourceRoot: snapshot,
      macResult: {
        mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
        raw_log: 'evidence/raw.log',
        head_sha: 'a'.repeat(40),
      },
    })).rejects.toThrow(/source HEAD is stale/i);
  });

  it('rejects a snapshot raw log whose bytes do not match the original Mac result hash', async () => {
    const snapshot = await createSnapshot();
    await mkdir(path.join(snapshot, 'evidence'), { recursive: true });
    await writeFile(path.join(snapshot, 'evidence/raw.log'), 'changed bytes\n');

    await expect(resolveMacEvidenceSource({
      rootDir: snapshot,
      macSourceRoot: snapshot,
      macResult: {
        mac_checkout: '/Users/ksato/workspace/repos/brainbase-mac-companion',
        raw_log: 'evidence/raw.log',
        head_sha: head(snapshot),
        raw_log_hash: sha256('expected bytes\n'),
      },
    })).rejects.toThrow(/raw log hash mismatch/i);
  });
});
