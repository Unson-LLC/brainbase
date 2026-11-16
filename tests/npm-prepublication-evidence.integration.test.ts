import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  REGISTRY_ABSENCE_FAILURE,
  RELEASE_EVIDENCE_BASE_ENV,
  interpretPrepublicationEvidenceRun,
  resolveRegistryAbsenceScope
} from '../scripts/npm-prepublication-scope.mjs';

// Scope of the "target npm version is absent from the registry" check for the current HEAD.
// Without BRAINBASE_RELEASE_EVIDENCE_BASE this fails closed (required). The evidence script
// always runs on the current HEAD; only its registry step may become N/A, and only when the
// base is a distinct ancestor commit with release_required=false. N/A is reported as skipped.
const currentHeadScope = resolveRegistryAbsenceScope({
  root: process.cwd(),
  baseRef: process.env[RELEASE_EVIDENCE_BASE_ENV]
});

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

function gitOutput(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function commitFixtureFile(fixtureRoot: string, file: string, content: string): Promise<string> {
  await writeFile(path.join(fixtureRoot, file), content);
  execFileSync('git', ['add', file], { cwd: fixtureRoot });
  execFileSync('git', ['commit', '--quiet', '-m', `add ${file}`], { cwd: fixtureRoot });
  return gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
}

// Run the unchanged evidence script on a repository and interpret it against a scope. Because the
// evidence script stops at the registry step before its own after-run check, HEAD and the
// worktree are re-checked here.
function runAndInterpret(root: string, scope: ReturnType<typeof resolveRegistryAbsenceScope>, run = () => spawnSync(
  process.execPath,
  ['scripts/npm-prepublication-evidence.mjs'],
  { cwd: root, encoding: 'utf8' }
)) {
  const headBefore = gitOutput(root, ['rev-parse', 'HEAD']);
  const result = run();
  const interpreted = interpretPrepublicationEvidenceRun({
    scope,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  });
  expect(gitOutput(root, ['rev-parse', 'HEAD'])).toBe(headBefore);
  expect(gitOutput(root, ['status', '--porcelain'])).toBe('');
  return { interpreted, headBefore };
}

const NA_SCOPE = { registry_absence: 'not_applicable', reason: 'release_required=false (0.4.0 -> 0.4.0)' } as const;
const REQUIRED_SCOPE = { registry_absence: 'required', reason: 'release_required=true (0.3.0 -> 0.4.0)' } as const;

describe('npm prepublication evidence', () => {
  let currentHeadRun: ReturnType<typeof runAndInterpret> | undefined;

  it('binds clean worktree, production audit, and tarball integrity to the current HEAD (never skipped)', () => {
    currentHeadRun = runAndInterpret(process.cwd(), currentHeadScope as ReturnType<typeof resolveRegistryAbsenceScope>, () => spawnSync(
      process.execPath,
      ['scripts/npm-prepublication-evidence.mjs'],
      { cwd: process.cwd(), encoding: 'utf8' }
    ));
  }, 120_000);

  it('binds registry absence to the clean current HEAD, or records N/A (not PASS) for a non-publishing change', (context) => {
    if (!currentHeadRun) throw new Error('Current HEAD prepublication evidence did not complete');
    const { interpreted, headBefore } = currentHeadRun;
    if (interpreted.registry_absence === 'not_applicable') {
      process.stdout.write(`${interpreted.line}\n`);
      context.skip(interpreted.line);
      return;
    }
    const { evidence } = interpreted;
    const { name, version } = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    })) as {
      name: string;
      version: string;
    };

    expect(evidence).toMatchObject({
      status: 'pass',
      head_sha: headBefore,
      package: `${name}@${version}`,
      production_dependency_audit: { vulnerabilities: 0 },
      registry: { target_version_absent: true, evidence: 'E404' }
    });
    expect(evidence.tarball.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.tarball.sha512).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    expect(evidence.tarball.npm_integrity).toBe(evidence.tarball.sha512);
    expect(evidence.tarball.npm_shasum).toMatch(/^[a-f0-9]{40}$/u);
  }, 120_000);

  it('never statically skips the current HEAD evidence run', async () => {
    // npm test excludes this file, so lock the wiring here: no skipIf / skip / todo may gate
    // the current HEAD run, and the current HEAD run must go through the script interpreter.
    const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
    const forbidden = ['skip' + 'If(', 'it.' + 'skip(', 'describe.' + 'skip(', 'it.' + 'todo(', 'runIf' + '('];
    for (const token of forbidden) expect(source).not.toContain(token);
    expect(source).toContain('runAndInterpret(process.cwd(), currentHeadScope');
  });

  it('requires registry absence when no release evidence base is given (fail closed)', () => {
    expect(resolveRegistryAbsenceScope({ root: process.cwd(), baseRef: undefined }).registry_absence).toBe('required');
    expect(resolveRegistryAbsenceScope({ root: process.cwd(), baseRef: null }).registry_absence).toBe('required');
    expect(resolveRegistryAbsenceScope({ root: process.cwd(), baseRef: '  ' }).registry_absence).toBe('required');
  });

  it('marks registry absence N/A for a distinct ancestor base with the same version', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const base = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    const head = await commitFixtureFile(fixtureRoot, 'change.txt', 'change\n');
    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: base });

    expect(scope).toMatchObject({
      registry_absence: 'not_applicable',
      base_sha: base,
      head_sha: head,
      before_version: '0.4.0',
      after_version: '0.4.0'
    });
    expect(scope.reason).toContain('release_required=false');
  });

  it('requires registry absence when the base is the same commit as HEAD', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const head = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    for (const baseRef of ['HEAD', head, 'main', 'master']) {
      const resolved = spawnSync('git', ['rev-parse', '--verify', '--quiet', baseRef], { cwd: fixtureRoot });
      if (resolved.status !== 0) continue;
      const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef });
      expect(scope.registry_absence).toBe('required');
      expect(scope.reason).toContain('same commit as head');
    }
  });

  it('requires registry absence when the base already contains the head commits (bumped ref)', async () => {
    const fixtureRoot = await createCommittedFixture('0.3.0');
    await commitFixtureVersion(fixtureRoot, '0.4.0');
    const head = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    execFileSync('git', ['branch', 'bumped-release', head], { cwd: fixtureRoot });

    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: 'bumped-release' });
    expect(scope.registry_absence).toBe('required');
    expect(scope.reason).toContain('same commit as head');
  });

  it('requires registry absence when the base is not an ancestor of HEAD', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const root = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    execFileSync('git', ['checkout', '--quiet', '-b', 'side'], { cwd: fixtureRoot });
    const side = await commitFixtureFile(fixtureRoot, 'side.txt', 'side\n');
    execFileSync('git', ['checkout', '--quiet', root], { cwd: fixtureRoot });
    await commitFixtureFile(fixtureRoot, 'head.txt', 'head\n');

    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: side });
    expect(scope.registry_absence).toBe('required');
    expect(scope.reason).toContain('not an ancestor');

    // A descendant of HEAD (base ahead of head) is not an ancestor either.
    const head = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    await commitFixtureFile(fixtureRoot, 'ahead.txt', 'ahead\n');
    const ahead = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    const aheadScope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: ahead, headRef: head });
    expect(aheadScope.registry_absence).toBe('required');
    expect(aheadScope.reason).toContain('not an ancestor');
  });

  it('keeps a version downgrade from an ancestor as N/A (planRelease says release_required=false)', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const base = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    await commitFixtureVersion(fixtureRoot, '0.3.0');

    expect(resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: base })).toMatchObject({
      registry_absence: 'not_applicable',
      before_version: '0.4.0',
      after_version: '0.3.0'
    });
  });

  it('still requires and enforces registry absence for a publishing version bump', async () => {
    const fixtureRoot = await createCommittedFixture('0.3.0');
    const base = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
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
    expect(`${result.stdout}\n${result.stderr}`).toContain(REGISTRY_ABSENCE_FAILURE);
    expect(() => interpretPrepublicationEvidenceRun({ scope, ...result })).toThrow('registry absence required');
  }, 120_000);

  it('records N/A for a non-publishing change only after the unchanged script reaches the registry step', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const base = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    await commitFixtureFile(fixtureRoot, 'change.txt', 'change\n');
    await writeFile(path.join(fixtureRoot, '.gitignore'), '.npm-cache/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: fixtureRoot });
    execFileSync('git', ['commit', '--quiet', '-m', 'ignore cache'], { cwd: fixtureRoot });
    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: base });
    expect(scope.registry_absence).toBe('not_applicable');

    const { interpreted } = runAndInterpret(fixtureRoot, scope, () => runFixture(fixtureRoot));
    expect(interpreted).toMatchObject({ registry_absence: 'not_applicable' });
    expect(interpreted.registry_absence === 'not_applicable' && interpreted.line).toContain('N/A (not PASS)');
  }, 120_000);

  it('keeps a dirty worktree a failure even when registry absence is N/A', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');
    const base = gitOutput(fixtureRoot, ['rev-parse', 'HEAD']);
    await commitFixtureFile(fixtureRoot, 'change.txt', 'change\n');
    const scope = resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: base });
    expect(scope.registry_absence).toBe('not_applicable');
    await writeFile(path.join(fixtureRoot, 'dirty-sentinel.txt'), 'dirty\n');

    const result = runFixture(fixtureRoot);
    expect(result.status).not.toBe(0);
    expect(() => interpretPrepublicationEvidenceRun({ scope, ...result })).toThrow(
      'Prepublication evidence requires a clean worktree'
    );
  }, 120_000);

  it('keeps audit, tarball, repository-change, and unknown failures failures even when N/A', () => {
    for (const message of [
      'Production dependency audit reported vulnerabilities',
      'npm pack integrity does not match the generated tarball',
      'Repository changed while prepublication evidence was collected'
    ]) {
      expect(() => interpretPrepublicationEvidenceRun({
        scope: NA_SCOPE,
        status: 1,
        stdout: '',
        stderr: `Error: ${message}`
      })).toThrow(message);
    }
    // npm audit itself failing (e.g. network) never reaches the registry step.
    expect(() => interpretPrepublicationEvidenceRun({
      scope: NA_SCOPE,
      status: 1,
      stdout: '',
      stderr: 'Error: Command failed: npm audit --omit=dev --json'
    })).toThrow('other than registry absence');
    // A registry failure is only N/A for a not_applicable scope.
    expect(() => interpretPrepublicationEvidenceRun({
      scope: REQUIRED_SCOPE,
      status: 1,
      stdout: '',
      stderr: `Error: ${REGISTRY_ABSENCE_FAILURE}`
    })).toThrow('registry absence required');
    expect(interpretPrepublicationEvidenceRun({
      scope: NA_SCOPE,
      status: 1,
      stdout: '',
      stderr: `Error: ${REGISTRY_ABSENCE_FAILURE}`
    })).toMatchObject({ registry_absence: 'not_applicable' });
    // exit 0 still needs the pass JSON.
    expect(() => interpretPrepublicationEvidenceRun({ scope: NA_SCOPE, status: 0, stdout: '{}', stderr: '' })).toThrow(
      'without status=pass'
    );
  });

  it('fails loudly when the release evidence base or head ref cannot be read', async () => {
    const fixtureRoot = await createCommittedFixture('0.4.0');

    expect(() => resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: 'no-such-ref' })).toThrow(
      'Release evidence base ref cannot be read: no-such-ref'
    );
    expect(() => resolveRegistryAbsenceScope({ root: fixtureRoot, baseRef: 'HEAD', headRef: 'no-such-head' })).toThrow(
      'Release evidence head ref cannot be read: no-such-head'
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
