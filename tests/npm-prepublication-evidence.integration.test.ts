import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RELEASE_EVIDENCE_BASE_ENV,
  resolveRegistryAbsenceScope
} from '../scripts/npm-prepublication-scope.mjs';

// Scope of the "target npm version is absent from the registry" check for the current HEAD.
// Without BRAINBASE_RELEASE_EVIDENCE_BASE this fails closed (required). With a base ref, it
// follows release:plan: a non-publishing change (release_required=false) records the check as
// N/A (skipped, not PASS); a publishing change (release_required=true) still must prove E404.
const currentHeadScope = resolveRegistryAbsenceScope({
  root: process.cwd(),
  baseRef: process.env[RELEASE_EVIDENCE_BASE_ENV]
});
if (currentHeadScope.registry_absence === 'not_applicable') {
  process.stdout.write(
    `[release-evidence] registry absence for current HEAD: N/A (not PASS) - ${currentHeadScope.reason}\n`
  );
}

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

async function commitFixtureVersion(fixtureRoot: string, version: string): Promise<void> {
  for (const file of ['package.json', 'package-lock.json']) {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, file), 'utf8'));
    manifest.version = version;
    if (manifest.packages?.['']) manifest.packages[''].version = version;
    await writeFile(path.join(fixtureRoot, file), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  execFileSync('git', ['commit', '--quiet', '-am', `bump ${version}`], { cwd: fixtureRoot });
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

const itWhenRegistryAbsenceApplies = it.skipIf(currentHeadScope.registry_absence === 'not_applicable');

describe('npm prepublication evidence', () => {
  itWhenRegistryAbsenceApplies('binds production audit, tarball hashes, and registry absence to the clean current HEAD', () => {
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

  it('requires registry absence when no release evidence base is given (fail closed)', () => {
    expect(resolveRegistryAbsenceScope({ root: process.cwd(), baseRef: undefined }).registry_absence).toBe('required');
    expect(resolveRegistryAbsenceScope({ root: process.cwd(), baseRef: '  ' }).registry_absence).toBe('required');
  });

  it('marks registry absence N/A only when release:plan says release_required=false', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: 'HEAD' });

    expect(scope).toMatchObject({
      registry_absence: 'not_applicable',
      before_version: '0.4.0',
      after_version: '0.4.0'
    });
    expect(scope.reason).toContain('release_required=false');
  });

  it('still requires and enforces registry absence for a publishing version bump', async () => {
    const fixtureRoot = await createCommittedFixture('0.3.0');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixtureRoot, encoding: 'utf8' }).trim();
    await commitFixtureVersion(fixtureRoot, '0.4.0');

    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: base });
    expect(scope).toMatchObject({
      registry_absence: 'required',
      before_version: '0.3.0',
      after_version: '0.4.0'
    });
    expect(scope.reason).toContain('release_required=true');

    // 0.4.0 is already on npm, so a publishing bump to it must keep failing the absence proof.
    const result = runFixture(fixtureRoot);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Target npm version is not proven absent');
  }, 120_000);

  it('fails loudly when the release evidence base ref cannot be read', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');

    expect(() => resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: 'no-such-ref' })).toThrow(
      'Release evidence base ref cannot be read: no-such-ref'
    );
  });

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
