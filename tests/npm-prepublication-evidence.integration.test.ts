import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createCommittedFixture(version: string): Promise<string> {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-prepublication-guard-'));
  temporaryRoots.push(fixtureRoot);
  await mkdir(path.join(fixtureRoot, 'scripts'));
  await copyFile(
    path.join(process.cwd(), 'scripts/npm-prepublication-evidence.mjs'),
    path.join(fixtureRoot, 'scripts/npm-prepublication-evidence.mjs')
  );
  await writeFile(path.join(fixtureRoot, 'package.json'), `${JSON.stringify({
    name: '@unson/brainbase-mcp',
    version
  }, null, 2)}\n`);
  await writeFile(path.join(fixtureRoot, 'package-lock.json'), `${JSON.stringify({
    name: '@unson/brainbase-mcp',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: '@unson/brainbase-mcp',
        version
      }
    }
  }, null, 2)}\n`);
  execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: fixtureRoot });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: fixtureRoot });
  execFileSync('git', ['add', 'package.json', 'package-lock.json', 'scripts/npm-prepublication-evidence.mjs'], { cwd: fixtureRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: fixtureRoot });
  return fixtureRoot;
}

function runFixture(fixtureRoot: string) {
  return spawnSync(process.execPath, ['scripts/npm-prepublication-evidence.mjs'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: path.join(fixtureRoot, '.npm-cache')
    }
  });
}

describe('npm prepublication evidence', () => {
  it('binds production audit, tarball hashes, and registry absence to the clean current HEAD', () => {
    const root = process.cwd();
    const output = execFileSync(process.execPath, ['scripts/npm-prepublication-evidence.mjs'], {
      cwd: root,
      encoding: 'utf8'
    });
    const evidence = JSON.parse(output);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    const { name, version } = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], {
      cwd: root,
      encoding: 'utf8'
    })) as {
      name: string;
      version: string;
    };

    expect(evidence).toMatchObject({
      status: 'pass',
      head_sha: head,
      package: `${name}@${version}`,
      production_dependency_audit: { vulnerabilities: 0 },
      registry: { target_version_absent: true, evidence: 'E404' }
    });
    expect(evidence.tarball.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.tarball.sha512).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    expect(evidence.tarball.npm_integrity).toBe(evidence.tarball.sha512);
    expect(evidence.tarball.npm_shasum).toMatch(/^[a-f0-9]{40}$/u);
  }, 120_000);

  it('rejects a version already present in the registry', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const result = runFixture(fixtureRoot);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Target npm version is not proven absent');
  }, 120_000);

  it('rejects a dirty HEAD before collecting release evidence', async () => {
    const fixtureRoot = await createCommittedFixture('0.0.0-dirty-fixture');
    await writeFile(path.join(fixtureRoot, 'dirty-sentinel.txt'), 'dirty\n');
    const result = runFixture(fixtureRoot);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Prepublication evidence requires a clean worktree');
    expect(await readFile(path.join(fixtureRoot, 'dirty-sentinel.txt'), 'utf8')).toBe('dirty\n');
  }, 120_000);
});
