import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPublishedMetadata,
  assertSerializedPublicationContext,
  classifyOidcEndpoint,
  commandFailureMessage,
  compareSemver,
  NPM_REGISTRY_CONVERGENCE_ATTEMPTS,
  NPM_REGISTRY_CONVERGENCE_MAX_DELAY_MS,
  npmRegistryConvergenceDelays,
  createReleaseArtifact,
  npmDistTag,
  releaseStagingTag,
  isVersionPublishedAtSha,
  planRelease,
  readNpmMetadata,
  reconcileDistTag,
  reconcileNpmRelease,
  resolveReleasePlan,
  validateReleaseCandidate,
  verifyNpmRelease
} from '../scripts/npm-release.mjs';

const temporaryRoots: string[] = [];

describe('serialized publication context', () => {
  const context = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Unson-LLC/brainbase',
    GITHUB_RUN_ID: '123',
    BRAINBASE_NPM_PUBLISH_SERIALIZED: 'true',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-issued-request-token'
  };

  function oidcToken(overrides = {}) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://token.actions.githubusercontent.com',
      aud: 'brainbase-npm-publish',
      repository: 'Unson-LLC/brainbase',
      run_id: '123',
      workflow_ref: 'Unson-LLC/brainbase/.github/workflows/npm-publish.yml@refs/heads/main',
      ref: 'refs/heads/main',
      ...overrides
    })).toString('base64url');
    return `${header}.${payload}.test-signature`;
  }

  it.each([
    [
      'accepted canonical endpoint shape',
      'https://pipelines.actions.githubusercontent.com/private-path?secret=query-sentinel',
      { url_present: true, parse_ok: true, protocol_https: true, hostname_trusted: true, raw_authority_colon: false, userinfo_present: false, normalized_nondefault_port: false }
    ],
    [
      'non-pipelines GitHub-hosted runner endpoint',
      'https://acghubeus2.actions.githubusercontent.com/private-path?secret=query-sentinel',
      { url_present: true, parse_ok: true, protocol_https: true, hostname_trusted: true, raw_authority_colon: false, userinfo_present: false, normalized_nondefault_port: false }
    ],
    [
      'regional endpoint with an explicit default port',
      'https://pipelinesghubeus4.actions.githubusercontent.com:443/private-path?secret=query-sentinel',
      { url_present: true, parse_ok: true, protocol_https: true, hostname_trusted: true, raw_authority_colon: true, userinfo_present: false, normalized_nondefault_port: false }
    ],
    [
      'userinfo and a non-default port',
      'https://user-sentinel:password-sentinel@pipelines.actions.githubusercontent.com:8443/private-path?secret=query-sentinel',
      { url_present: true, parse_ok: true, protocol_https: true, hostname_trusted: true, raw_authority_colon: true, userinfo_present: true, normalized_nondefault_port: true }
    ],
    [
      'malformed endpoint',
      'malformed-path-sentinel?secret=query-sentinel',
      { url_present: true, parse_ok: false, protocol_https: false, hostname_trusted: false, raw_authority_colon: false, userinfo_present: false, normalized_nondefault_port: false }
    ]
  ])('reports only fixed OIDC diagnostic booleans for %s', async (_label, endpoint, expected) => {
    const request = vi.fn();
    const diagnostic = JSON.stringify(expected);
    await expect(assertSerializedPublicationContext({
      BRAINBASE_NPM_OIDC_DIAGNOSTIC: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: endpoint,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-sentinel'
    }, request)).rejects.toThrow(new RegExp(`^GitHub Actions OIDC diagnostic ${diagnostic.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'));
    expect(classifyOidcEndpoint(endpoint)).toEqual(expected);
    expect(request).not.toHaveBeenCalled();
    await assertDiagnosticContainsNoSentinel(endpoint);
  });

  async function assertDiagnosticContainsNoSentinel(endpoint) {
    try {
      await assertSerializedPublicationContext({
        BRAINBASE_NPM_OIDC_DIAGNOSTIC: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: endpoint,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token-sentinel'
      }, vi.fn());
      throw new Error('diagnostic mode unexpectedly continued');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const sentinel of ['private-path', 'query-sentinel', 'user-sentinel', 'password-sentinel', 'token-sentinel']) {
        expect(message).not.toContain(sentinel);
      }
    }
  }

  it('rejects direct local publication outside the package workflow queue', async () => {
    await expect(assertSerializedPublicationContext({})).rejects.toThrow(/serialized GitHub Actions workflow/u);
    await expect(assertSerializedPublicationContext({
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'attacker/fork',
      GITHUB_RUN_ID: '123',
      BRAINBASE_NPM_PUBLISH_SERIALIZED: 'true'
    })).rejects.toThrow(/serialized GitHub Actions workflow/u);
  });

  it('rejects caller-spoofed context without a runner-issued OIDC attestation', async () => {
    await expect(assertSerializedPublicationContext({
      ...context,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.example/token'
    }, vi.fn())).rejects.toThrow(/OIDC endpoint is not trusted/u);

    const denied = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(assertSerializedPublicationContext(context, denied)).rejects.toThrow(/OIDC attestation failed/u);
  });

  it('accepts a runner-issued attestation for the exact upstream workflow and run', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken() })
    });
    await expect(assertSerializedPublicationContext(context, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'pipelines.actions.githubusercontent.com' }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer runner-issued-request-token' },
        redirect: 'error'
      })
    );
  });

  it('accepts GitHub-hosted runner regional OIDC endpoints', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken() })
    });
    await expect(assertSerializedPublicationContext({
      ...context,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelinesghubeus4.actions.githubusercontent.com/token'
    }, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'pipelinesghubeus4.actions.githubusercontent.com' }),
      expect.any(Object)
    );
  });

  it('accepts GitHub-hosted runner OIDC endpoints without a pipelines prefix', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken() })
    });
    await expect(assertSerializedPublicationContext({
      ...context,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://acghubeus2.actions.githubusercontent.com/token'
    }, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'acghubeus2.actions.githubusercontent.com' }),
      expect.any(Object)
    );
  });

  it('rejects lookalike OIDC endpoint suffixes', async () => {
    const request = vi.fn();
    await expect(assertSerializedPublicationContext({
      ...context,
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com.attacker.example/token'
    }, request)).rejects.toThrow(/OIDC endpoint is not trusted/u);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed URL', 'not-a-url'],
    ['HTTP', 'http://pipelines.actions.githubusercontent.com/token'],
    ['explicit default port', 'https://pipelines.actions.githubusercontent.com:443/token'],
    ['explicit default port with uppercase scheme', 'HTTPS://pipelines.actions.githubusercontent.com:443/token'],
    ['explicit non-default port', 'https://pipelines.actions.githubusercontent.com:8443/token'],
    ['username', 'https://user@pipelines.actions.githubusercontent.com/token'],
    ['username and password', 'https://user:password@pipelines.actions.githubusercontent.com/token']
  ])('rejects %s OIDC endpoints before token retrieval', async (_label, endpoint) => {
    const request = vi.fn();
    await expect(assertSerializedPublicationContext({
      ...context,
      ACTIONS_ID_TOKEN_REQUEST_URL: endpoint
    }, request)).rejects.toThrow(/OIDC endpoint is not trusted/u);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects an attestation for a different run', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken({ run_id: '999' }) })
    });
    await expect(assertSerializedPublicationContext(context, request)).rejects.toThrow(/OIDC claims do not match/u);
  });

  it('rejects an attestation from a different issuer', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken({ iss: 'https://attacker.example' }) })
    });
    await expect(assertSerializedPublicationContext(context, request)).rejects.toThrow(/OIDC claims do not match/u);
  });

  it('rejects the same workflow path from a non-develop ref', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: oidcToken({
        workflow_ref: 'Unson-LLC/brainbase/.github/workflows/npm-publish.yml@refs/heads/unreviewed-release-branch',
        ref: 'refs/heads/unreviewed-release-branch'
      }) })
    });
    await expect(assertSerializedPublicationContext(context, request)).rejects.toThrow(/OIDC claims do not match/u);
  });
});

async function releaseRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-release-'));
  temporaryRoots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: '@unson/brainbase-mcp',
    version: '0.1.0'
  }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: root });
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return { root, sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() };
}

async function bumpedReleaseRoot() {
  const { root, sha: beforeSha } = await releaseRoot();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: '@unson/brainbase-mcp',
    version: '0.1.1'
  }));
  execFileSync('git', ['add', 'package.json'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'bump'], { cwd: root });
  const afterSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, beforeSha, afterSha, version: '0.1.1' };
}

async function installFakeNpmView(fakeBin: string, payload: string | null) {
  const fakeNpm = path.join(fakeBin, 'npm');
  const body = payload === null
    ? 'echo "npm ERR! code E404" >&2; exit 1'
    : `printf '%s\\n' '${payload.replace(/'/gu, "'\\''")}'`;
  await writeFile(fakeNpm, `#!/bin/sh\nif [ "$1" = "view" ]; then\n  ${body}\nfi\nexit 0\n`);
  await chmod(fakeNpm, 0o755);
}

async function releaseProof(sha: string, trustedRef = 'trusted/develop') {
  const directory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-artifact-'));
  temporaryRoots.push(directory);
  const tarballPath = path.join(directory, 'unson-brainbase-mcp-0.1.0.tgz');
  const bytes = Buffer.from('validated artifact');
  await writeFile(tarballPath, bytes);
  return {
    packageName: '@unson/brainbase-mcp',
    version: '0.1.0',
    expectedSha: sha,
    trustedRef,
    tarballPath,
    tarballSha256: createHash('sha256').update(bytes).digest('hex'),
    tarballIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('npm release CLI', () => {
  it('selects stable and prerelease dist-tags', () => {
    expect(npmDistTag('0.1.0')).toBe('latest');
    expect(npmDistTag('0.2.0-beta.1')).toBe('beta');
    expect(npmDistTag('0.2.0-rc.1')).toBe('rc');
    expect(npmDistTag('0.2.0-1.0')).toBe('next');
    expect(npmDistTag('1.0.0-v1')).toBe('next');
    expect(npmDistTag('1.0.0-x.1')).toBe('next');
  });

  it('uses a commit-bound non-consumer tag while publication is unverified', () => {
    expect(releaseStagingTag('0123456789abcdef0123456789abcdef01234567')).toBe('release-0123456789ab');
    expect(() => releaseStagingTag('short-sha')).toThrow(/full lowercase git SHA/u);
  });

  it('compares stable and prerelease versions', () => {
    expect(compareSemver('0.2.0', '0.2.0-beta.2')).toBeGreaterThan(0);
    expect(compareSemver('0.2.0-beta.10', '0.2.0-beta.2')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
  });

  it('plans only increasing versions for automatic release', () => {
    expect(planRelease('0.1.0', '0.1.1')).toEqual({ releaseRequired: true, version: '0.1.1' });
    expect(planRelease('0.1.0', '0.1.0')).toEqual({ releaseRequired: false, version: '0.1.0' });
    expect(planRelease('0.2.0', '0.1.0')).toEqual({ releaseRequired: false, version: '0.1.0' });
  });

  it('detects when a version is already published at the release SHA', async () => {
    const metadata = vi.fn(async () => ({ version: '0.45.0', gitHead: 'abc' }));
    await expect(isVersionPublishedAtSha('@unson/brainbase-mcp', '0.45.0', 'abc', metadata)).resolves.toBe(true);
    await expect(isVersionPublishedAtSha('@unson/brainbase-mcp', '0.45.0', 'def', metadata)).resolves.toBe(false);
    await expect(isVersionPublishedAtSha('@unson/brainbase-mcp', '0.45.0', 'abc', async () => null)).resolves.toBe(false);
  });

  it('resolveReleasePlan skips when the registry already has the release gitHead', async () => {
    const { root, beforeSha, afterSha, version } = await bumpedReleaseRoot();
    const matching = await resolveReleasePlan(beforeSha, afterSha, {
      root,
      metadata: vi.fn().mockResolvedValue({ version, gitHead: afterSha })
    });
    expect(matching).toEqual({
      release_required: false,
      package_name: '@unson/brainbase-mcp',
      version,
      sha: afterSha
    });

    const mismatched = await resolveReleasePlan(beforeSha, afterSha, {
      root,
      metadata: vi.fn().mockResolvedValue({ version, gitHead: '0'.repeat(40) })
    });
    expect(mismatched.release_required).toBe(true);

    const unpublished = await resolveReleasePlan(beforeSha, afterSha, {
      root,
      metadata: vi.fn().mockResolvedValue(null)
    });
    expect(unpublished.release_required).toBe(true);
  });

  it('plan CLI writes release_required from registry-aware resolveReleasePlan', async () => {
    const version = '0.1.1';
    const fakeBin = await mkdtemp(path.join(tmpdir(), 'brainbase-fake-npm-plan-'));
    const cliRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-release-plan-cli-'));
    const outputPath = path.join(cliRoot, 'github-output');
    temporaryRoots.push(fakeBin, cliRoot);
    await mkdir(path.join(cliRoot, 'scripts'));
    await copyFile(path.join(process.cwd(), 'scripts/npm-release.mjs'), path.join(cliRoot, 'scripts/npm-release.mjs'));
    await copyFile(path.join(process.cwd(), 'scripts/npm-consumer-smoke.mjs'), path.join(cliRoot, 'scripts/npm-consumer-smoke.mjs'));
    execFileSync('git', ['init', '-q'], { cwd: cliRoot });
    execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: cliRoot });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: cliRoot });
    await writeFile(path.join(cliRoot, 'package.json'), JSON.stringify({
      name: '@unson/brainbase-mcp',
      version: '0.1.0'
    }));
    execFileSync('git', ['add', 'package.json', 'scripts/npm-release.mjs', 'scripts/npm-consumer-smoke.mjs'], { cwd: cliRoot });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: cliRoot });
    const planBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cliRoot, encoding: 'utf8' }).trim();
    await writeFile(path.join(cliRoot, 'package.json'), JSON.stringify({
      name: '@unson/brainbase-mcp',
      version
    }));
    execFileSync('git', ['add', 'package.json'], { cwd: cliRoot });
    execFileSync('git', ['commit', '-qm', 'bump'], { cwd: cliRoot });
    const planAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cliRoot, encoding: 'utf8' }).trim();

    await installFakeNpmView(fakeBin, JSON.stringify({ version, gitHead: planAfter }));
    execFileSync(process.execPath, [
      'scripts/npm-release.mjs',
      'plan',
      '--before', planBefore,
      '--after', planAfter
    ], {
      cwd: cliRoot,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, GITHUB_OUTPUT: outputPath }
    });
    expect(await readFile(outputPath, 'utf8')).toMatch(/^release_required=false\n/mu);
  });

  it('already-published CLI exits 0 only when registry gitHead matches', async () => {
    const fakeBin = await mkdtemp(path.join(tmpdir(), 'brainbase-fake-npm-already-'));
    temporaryRoots.push(fakeBin);
    const sha = 'a'.repeat(40);
    const version = '0.45.0';
    const payload = JSON.stringify({ version, gitHead: sha });

    await installFakeNpmView(fakeBin, payload);
    const matching = execFileSync(process.execPath, [
      'scripts/npm-release.mjs',
      'already-published',
      '--version', version,
      '--sha', sha
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
    });
    expect(matching.toString()).toBe('');

    await installFakeNpmView(fakeBin, JSON.stringify({ version, gitHead: 'b'.repeat(40) }));
    let mismatchStatus: number | null = null;
    try {
      execFileSync(process.execPath, [
        'scripts/npm-release.mjs',
        'already-published',
        '--version', version,
        '--sha', sha
      ], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
      });
    } catch (error) {
      mismatchStatus = (error as NodeJS.ErrnoException & { status?: number }).status ?? null;
    }
    expect(mismatchStatus).toBe(1);

    await installFakeNpmView(fakeBin, null);
    let missingStatus: number | null = null;
    try {
      execFileSync(process.execPath, [
        'scripts/npm-release.mjs',
        'already-published',
        '--version', version,
        '--sha', sha
      ], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
      });
    } catch (error) {
      missingStatus = (error as NodeJS.ErrnoException & { status?: number }).status ?? null;
    }
    expect(missingStatus).toBe(1);
  });

  it('rejects immutable version collisions', () => {
    expect(() => assertPublishedMetadata(
      { version: '0.1.0', gitHead: 'other' },
      '@unson/brainbase-mcp',
      '0.1.0',
      'expected'
    )).toThrow(/published versions are immutable/u);
  });

  it('does not publish or mutate a tag for an immutable collision', async () => {
    const { root, sha } = await releaseRoot();
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && (args[0] === 'merge-base' || args[0] === 'status')) return '';
      throw new Error(`unexpected mutation: ${command} ${args.join(' ')}`);
    });
    const reconcileTag = vi.fn();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata: vi.fn().mockResolvedValue({ version: '0.1.0', gitHead: 'different-sha' }),
      execute,
      validationProof: await releaseProof(sha),
      reconcileTag
    })).rejects.toThrow(/published versions are immutable/u);
    expect(reconcileTag).not.toHaveBeenCalled();
  });

  it('queries npm view with --prefer-online so readback revalidates the registry', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout: '{"version":"0.1.0"}', stderr: '' });
    readNpmMetadata('@unson/brainbase-mcp', '0.1.0', '.', spawn);
    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toContain('--prefer-online');
    expect(args).not.toContain('--cache');
  });

  it('bypasses the local npm cache with a throwaway cache directory when asked', async () => {
    const { existsSync } = await import('node:fs');
    let cacheDirectory = '';
    const spawn = vi.fn((_command: string, args: string[]) => {
      cacheDirectory = args[args.indexOf('--cache') + 1];
      expect(existsSync(cacheDirectory)).toBe(true);
      return { status: 1, stderr: 'npm error code E404\nNo match found for version 0.1.0', stdout: '' };
    });
    expect(readNpmMetadata('@unson/brainbase-mcp', '0.1.0', '.', spawn, { bypassCache: true })).toBeNull();
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--prefer-online', '--cache']));
    expect(cacheDirectory).toContain('brainbase-npm-readback-cache-');
    expect(existsSync(cacheDirectory)).toBe(false);
  });

  it('uses a convergence window longer than the registry packument max-age of 300 s', () => {
    const delays = npmRegistryConvergenceDelays();
    expect(delays).toHaveLength(NPM_REGISTRY_CONVERGENCE_ATTEMPTS - 1);
    expect(Math.max(...delays)).toBe(NPM_REGISTRY_CONVERGENCE_MAX_DELAY_MS);
    const total = delays.reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(300_000);
    expect(total).toBeLessThanOrEqual(10 * 60_000);
  });

  it('retries past a cached pre-publish 404 by bypassing the cache after the first readback', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const metadata = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: '0.1.0', gitHead: sha, 'dist.integrity': proof.tarballIntegrity });
    await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata,
      execute: vi.fn(() => ''),
      delay: async () => undefined,
      validationProof: proof,
      reconcileTag: vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' }),
      cleanupStagingTag: vi.fn().mockResolvedValue(undefined)
    });
    expect(metadata).toHaveBeenCalledTimes(4);
    expect(metadata.mock.calls[0][4]).toBeUndefined();
    expect(metadata.mock.calls[1][4]).toEqual({ bypassCache: false });
    expect(metadata.mock.calls[2][4]).toEqual({ bypassCache: true });
    expect(metadata.mock.calls[3][4]).toEqual({ bypassCache: true });
  });

  it('reads versions and dist-tags with --prefer-online when reconciling the dist-tag', async () => {
    const execute = vi.fn((_command: string, args: string[]) => args[1] === '@unson/brainbase-mcp' && args.includes('versions') ? '["0.1.0"]' : '{"latest":"0.1.0"}');
    await reconcileDistTag('@unson/brainbase-mcp', '0.1.0', '.', execute);
    const views = execute.mock.calls.filter(([, args]) => args[0] === 'view');
    expect(views.length).toBeGreaterThan(0);
    for (const [, args] of views) expect(args).toContain('--prefer-online');
  });

  it('treats only npm 404 as unpublished', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 1, stderr: 'npm error code E404\n404 Not Found', stdout: '' })
      .mockReturnValueOnce({ status: 1, stderr: 'npm error code E401\nUnauthorized', stdout: '' });
    expect(readNpmMetadata('@unson/brainbase-mcp', '0.1.0', '.', spawn)).toBeNull();
    expect(() => readNpmMetadata('@unson/brainbase-mcp', '0.1.0', '.', spawn)).toThrow(/metadata lookup failed/u);
  });

  it('publishes an absent version once and retries metadata to convergence', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const metadata = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: '0.1.0', gitHead: sha, 'dist.integrity': proof.tarballIntegrity });
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'merge-base') return '';
      if (command === 'npm' && args.includes('dist-tags')) return JSON.stringify({ [`release-${sha.slice(0, 12)}`]: '0.1.0' });
      return '';
    });
    const reconcileTag = vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' });
    const result = await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata,
      execute,
      delay: async () => undefined,
      validationProof: proof,
      reconcileTag
    });

    expect(execute).toHaveBeenCalledWith('npm', ['publish', proof.tarballPath, '--ignore-scripts', '--access', 'public', '--tag', `release-${sha.slice(0, 12)}`], root);
    expect(metadata).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith('npm', ['dist-tag', 'rm', '@unson/brainbase-mcp', `release-${sha.slice(0, 12)}`], root);
    expect(result.gitHead).toBe(sha);
  });

  it('keeps a verified release successful when npm denies only staging-tag cleanup', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const stagingTag = `release-${sha.slice(0, 12)}`;
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && (args[0] === 'merge-base' || args[0] === 'status')) return '';
      if (command === 'npm' && args.includes('dist-tags')) return JSON.stringify({ [stagingTag]: '0.1.0' });
      if (command === 'npm' && args[0] === 'dist-tag' && args[1] === 'rm') {
        const error = new Error('Command failed: npm (exit 1)');
        Object.assign(error, { stderr: 'npm error code E403\n403 Forbidden - DELETE dist-tags' });
        throw error;
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    const result = await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata: vi.fn().mockResolvedValue({
        version: '0.1.0',
        gitHead: sha,
        'dist.integrity': proof.tarballIntegrity
      }),
      execute,
      validationProof: proof,
      reconcileTag: vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' })
    });

    expect(result.stagingTagCleanup).toEqual({
      status: 'blocked',
      tag: stagingTag,
      reason: 'registry_permission_denied'
    });
  });

  it('still fails a release for an unknown staging-tag cleanup error', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);

    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata: vi.fn().mockResolvedValue({
        version: '0.1.0',
        gitHead: sha,
        'dist.integrity': proof.tarballIntegrity
      }),
      execute: vi.fn((command: string, args: string[]) => command === 'git' && (args[0] === 'merge-base' || args[0] === 'status') ? '' : ''),
      validationProof: proof,
      reconcileTag: vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' }),
      cleanupStagingTag: vi.fn().mockRejectedValue(new Error('unexpected filesystem failure'))
    })).rejects.toThrow(/unexpected filesystem failure/u);
  });

  it('retries partial registry metadata until identity and integrity converge', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const metadata = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: '0.1.0' })
      .mockResolvedValueOnce({ version: '0.1.0', gitHead: sha })
      .mockResolvedValueOnce({ version: '0.1.0', gitHead: sha, 'dist.integrity': proof.tarballIntegrity });
    const execute = vi.fn((command: string, args: string[]) => command === 'git' && args[0] === 'merge-base' ? '' : '');
    const reconcileTag = vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' });
    const cleanupStagingTag = vi.fn().mockResolvedValue(undefined);

    await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata,
      execute,
      delay: async () => undefined,
      validationProof: proof,
      reconcileTag,
      cleanupStagingTag
    });

    expect(metadata).toHaveBeenCalledTimes(4);
    expect(reconcileTag).toHaveBeenCalledTimes(1);
  });

  it('waits through delayed registry availability and publishes once', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const metadata = vi.fn();
    for (let index = 0; index < 8; index += 1) metadata.mockResolvedValueOnce(null);
    metadata.mockResolvedValueOnce({ version: '0.1.0', gitHead: sha, 'dist.integrity': proof.tarballIntegrity });
    const delays: number[] = [];
    const execute = vi.fn((command: string, args: string[]) => command === 'git' && (args[0] === 'merge-base' || args[0] === 'status') ? '' : '');
    const reconcileTag = vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' });
    const cleanupStagingTag = vi.fn().mockResolvedValue(undefined);

    await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata,
      execute,
      delay: async (milliseconds) => { delays.push(milliseconds); },
      validationProof: proof,
      reconcileTag,
      cleanupStagingTag
    });

    expect(metadata).toHaveBeenCalledTimes(9);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(execute.mock.calls.filter(([, args]) => args[0] === 'publish')).toHaveLength(1);
    expect(reconcileTag).toHaveBeenCalledTimes(1);
    expect(cleanupStagingTag).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile a dist-tag when registry metadata never converges', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const reconcileTag = vi.fn();
    const cleanupStagingTag = vi.fn();
    const metadata = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ version: '0.1.0', gitHead: sha });

    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata,
      execute: vi.fn((command: string, args: string[]) => command === 'git' && args[0] === 'merge-base' ? '' : ''),
      delay: async () => undefined,
      validationProof: proof,
      reconcileTag,
      cleanupStagingTag
    })).rejects.toThrow(/registry integrity does not match/u);

    expect(metadata).toHaveBeenCalledTimes(1 + NPM_REGISTRY_CONVERGENCE_ATTEMPTS);
    expect(reconcileTag).not.toHaveBeenCalled();
    expect(cleanupStagingTag).not.toHaveBeenCalled();
  });

  it('does not republish an existing version with the same gitHead', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'merge-base') return '';
      return '';
    });
    await reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata: vi.fn().mockResolvedValue({ version: '0.1.0', gitHead: sha, 'dist.integrity': proof.tarballIntegrity }),
      execute,
      validationProof: proof,
      reconcileTag: vi.fn().mockResolvedValue({ tag: 'latest', version: '0.1.0' }),
      cleanupStagingTag: vi.fn().mockResolvedValue(undefined)
    });
    expect(execute.mock.calls.some(([, args]) => args[0] === 'publish')).toBe(false);
  });

  it('rejects registry bytes that differ from the validated artifact', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const reconcileTag = vi.fn();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      metadata: vi.fn().mockResolvedValue({
        version: '0.1.0',
        gitHead: sha,
        'dist.integrity': 'sha512-different-registry-bytes'
      }),
      execute: vi.fn((command: string, args: string[]) => command === 'git' && args[0] === 'merge-base' ? '' : ''),
      validationProof: proof,
      reconcileTag
    })).rejects.toThrow(/registry integrity does not match/u);
    expect(reconcileTag).not.toHaveBeenCalled();
  });

  it('rejects a release commit outside the trusted ref before validation', async () => {
    const { root, sha } = await releaseRoot();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      execute: vi.fn(() => { throw new Error('not an ancestor'); }),
      validationProof: await releaseProof(sha)
    })).rejects.toThrow(/not reachable from trusted ref/u);
  });

  it('runs every validation command before producing a release proof', async () => {
    const { root, sha } = await releaseRoot();
    const proofDirectory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-proof-'));
    temporaryRoots.push(proofDirectory);
    const proofFile = path.join(proofDirectory, 'proof.json');
    const calls: string[] = [];
    const execute = vi.fn((command: string, args: string[]) => {
      calls.push(`${command} ${args.join(' ')}`);
      return '';
    });
    const createArtifact = vi.fn(async () => {
      const tarballPath = path.join(proofDirectory, 'package.tgz');
      const bytes = Buffer.from('packed bytes with stamped manifest');
      await writeFile(tarballPath, bytes);
      return {
        tarballPath,
        tarballSha256: createHash('sha256').update(bytes).digest('hex'),
        tarballIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`
      };
    });
    const consumerSmoke = vi.fn().mockResolvedValue({ status: 'passed' });
    const proof = await validateReleaseCandidate({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      proofFile,
      execute,
      createArtifact,
      consumerSmoke
    });
    expect(calls).toEqual([
      'git merge-base --is-ancestor ' + sha + ' trusted/develop',
      'git status --porcelain=v1 --untracked-files=all',
      'npm run build',
      'npm test -- --maxWorkers=2',
      'npm audit --omit=dev',
      'git status --porcelain=v1 --untracked-files=all'
    ]);
    expect(createArtifact).toHaveBeenCalledWith(root, proofDirectory, '0.1.0', sha, execute);
    expect(consumerSmoke).toHaveBeenCalledWith(path.join(proofDirectory, 'package.tgz'));
    expect(proof.expectedSha).toBe(sha);
    expect(proof.tarballSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(proof.tarballIntegrity).toMatch(/^sha512-/u);
  });

  it('embeds the exact reviewed git HEAD in the real release tarball manifest', async () => {
    const { root, sha } = await releaseRoot();
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-artifact-'));
    temporaryRoots.push(artifactDirectory);
    const sourceManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    sourceManifest.files = ['dist'];
    sourceManifest.scripts = { prepare: "node -e \"require('node:fs').accessSync('source-only')\"" };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(sourceManifest));
    await writeFile(path.join(root, 'source-only'), 'build prerequisite');
    await mkdir(path.join(root, 'dist'));
    await writeFile(path.join(root, 'dist/index.js'), 'export const ready = true;');
    const artifact = await createReleaseArtifact(root, artifactDirectory, '0.1.0', sha);
    const manifest = JSON.parse(execFileSync(
      'tar',
      ['-xOf', artifact.tarballPath, 'package/package.json'],
      { encoding: 'utf8' }
    ));
    expect(manifest).toMatchObject({
      name: '@unson/brainbase-mcp',
      version: '0.1.0',
      gitHead: sha
    });
    expect(manifest.scripts?.prepare).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual(sourceManifest);
    expect(artifact.tarballSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(artifact.tarballIntegrity).toMatch(/^sha512-/u);
  }, 30_000);

  it('does not produce a proof when validation fails', async () => {
    const { root, sha } = await releaseRoot();
    const proofDirectory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-proof-'));
    temporaryRoots.push(proofDirectory);
    const execute = vi.fn((command: string, args: string[]) => {
      if (command === 'npm' && args[0] === 'audit') throw new Error('audit failed');
      return '';
    });
    await expect(validateReleaseCandidate({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      proofFile: path.join(proofDirectory, 'proof.json'),
      execute
    })).rejects.toThrow(/audit failed/u);
    expect(execute.mock.calls.some(([command, args]) => command === 'npm' && args[0] === 'pack')).toBe(false);
    expect(execute.mock.calls.some(([command, args]) => command === 'npm' && args[0] === 'publish')).toBe(false);
  });

  it('surfaces redacted child-command diagnostics from the direct CLI', async () => {
    const fakeBin = await mkdtemp(path.join(tmpdir(), 'brainbase-fake-npm-'));
    const cliRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-release-cli-'));
    const proofDirectory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-proof-'));
    temporaryRoots.push(fakeBin, cliRoot, proofDirectory);
    const fakeNpm = path.join(fakeBin, 'npm');
    await writeFile(fakeNpm, '#!/bin/sh\necho "build failed: missing generated contract npm_SECRETSECRETSECRETSECRET"\necho "NODE_AUTH_TOKEN=stderr-secret" >&2\nexit 7\n');
    await chmod(fakeNpm, 0o755);
    await mkdir(path.join(cliRoot, 'scripts'));
    await copyFile(path.join(process.cwd(), 'scripts/npm-release.mjs'), path.join(cliRoot, 'scripts/npm-release.mjs'));
    await copyFile(path.join(process.cwd(), 'scripts/npm-consumer-smoke.mjs'), path.join(cliRoot, 'scripts/npm-consumer-smoke.mjs'));
    await writeFile(path.join(cliRoot, 'package.json'), JSON.stringify({
      name: '@unson/brainbase-mcp',
      version: '0.1.0'
    }));
    execFileSync('git', ['init', '-q'], { cwd: cliRoot });
    execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: cliRoot });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: cliRoot });
    execFileSync('git', ['add', 'package.json', 'scripts/npm-release.mjs', 'scripts/npm-consumer-smoke.mjs'], { cwd: cliRoot });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: cliRoot });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: cliRoot, encoding: 'utf8' }).trim();

    let failure: NodeJS.ErrnoException & { stderr?: string } | undefined;
    try {
      execFileSync(process.execPath, [
        'scripts/npm-release.mjs',
        'validate',
        '--version', '0.1.0',
        '--sha', sha,
        '--trusted-ref', 'HEAD',
        '--proof-file', path.join(proofDirectory, 'proof.json')
      ], {
        cwd: cliRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      failure = error as NodeJS.ErrnoException & { stderr?: string };
    }

    expect(failure?.stderr).toMatch(/build failed: missing generated contract \[REDACTED_NPM_TOKEN\]/u);
    expect(failure?.stderr).toMatch(/NODE_AUTH_TOKEN=\[REDACTED\]/u);
    expect(failure?.stderr).not.toContain('npm_SECRETSECRETSECRETSECRET');
    expect(failure?.stderr).not.toContain('stderr-secret');
  });

  it('redacts npm credentials when formatting command failures', () => {
    expect(commandFailureMessage({
      message: 'Command failed: npm test',
      stdout: 'NPM_TOKEN=secret-value\n//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz'
    })).toBe('Command failed: npm test\nNPM_TOKEN=[REDACTED]\n//registry.npmjs.org/:_authToken=[REDACTED]');
  });

  it('rejects a dirty checkout before validation or publication', async () => {
    const { root, sha } = await releaseRoot();
    const proofDirectory = await mkdtemp(path.join(tmpdir(), 'brainbase-npm-proof-'));
    temporaryRoots.push(proofDirectory);
    await writeFile(path.join(root, 'untracked.txt'), 'not reviewed');
    await expect(validateReleaseCandidate({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'HEAD',
      proofFile: path.join(proofDirectory, 'proof.json')
    })).rejects.toThrow(/must be clean/u);
  });

  it('fixes publication authority to the Brainbase package', async () => {
    const { root, sha } = await releaseRoot();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@attacker/other-package',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'HEAD',
      validationProof: {}
    })).rejects.toThrow(/publication authority is fixed/u);
  });

  it('rejects an artifact changed after validation before registry access', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    await writeFile(proof.tarballPath, 'changed after validation');
    const metadata = vi.fn();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      execute: vi.fn((command: string, args: string[]) => command === 'git' && args[0] === 'status' ? '' : ''),
      metadata,
      validationProof: proof
    })).rejects.toThrow(/artifact digest mismatch/u);
    expect(metadata).not.toHaveBeenCalled();
  });

  it('rejects a validation proof identity mismatch before registry access', async () => {
    const { root, sha } = await releaseRoot();
    const proof = await releaseProof(sha);
    const metadata = vi.fn();
    await expect(reconcileNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      trustedRef: 'trusted/develop',
      execute: vi.fn((command: string, args: string[]) => command === 'git' && args[0] === 'status' ? '' : ''),
      metadata,
      validationProof: { ...proof, trustedRef: 'attacker/unreviewed' }
    })).rejects.toThrow(/validation proof mismatch for trustedRef/u);
    expect(metadata).not.toHaveBeenCalled();
  });

  it('moves a dist-tag only forward to the greatest compatible version', async () => {
    const execute = vi.fn((_command: string, args: string[]) => {
      if (args.includes('versions')) return JSON.stringify(['0.2.0-beta.1', '0.2.0-beta.3', '0.2.0-beta.2']);
      if (args.includes('dist-tags')) return JSON.stringify({ beta: '0.2.0-beta.1' });
      return '';
    });
    const result = await reconcileDistTag('@unson/brainbase-mcp', '0.2.0-beta.2', '.', execute);
    expect(result).toEqual({ tag: 'beta', version: '0.2.0-beta.3' });
    expect(execute).toHaveBeenCalledWith('npm', ['dist-tag', 'add', '@unson/brainbase-mcp@0.2.0-beta.3', 'beta'], '.');
  });

  it('does not roll back a dist-tag advanced by a concurrent release', async () => {
    const execute = vi.fn((_command: string, args: string[]) => {
      if (args.includes('versions')) return JSON.stringify(['0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.3']);
      if (args.includes('dist-tags')) return JSON.stringify({ beta: '0.2.0-beta.4' });
      return '';
    });
    const result = await reconcileDistTag('@unson/brainbase-mcp', '0.2.0-beta.2', '.', execute);
    expect(result).toEqual({ tag: 'beta', version: '0.2.0-beta.4' });
    expect(execute.mock.calls.some(([, args]) => args[0] === 'dist-tag')).toBe(false);
  });

  it('keeps verify read-only and fails on a dist-tag mismatch', async () => {
    const { root, sha } = await releaseRoot();
    const execute = vi.fn((_command: string, args: string[]) => {
      if (args.includes('versions')) return JSON.stringify(['0.1.0']);
      if (args.includes('dist-tags')) return JSON.stringify({ latest: '0.0.9' });
      throw new Error(`unexpected mutation: ${args.join(' ')}`);
    });
    await expect(verifyNpmRelease({
      root,
      packageName: '@unson/brainbase-mcp',
      version: '0.1.0',
      expectedSha: sha,
      metadata: vi.fn().mockResolvedValue({ version: '0.1.0', gitHead: sha }),
      execute
    })).rejects.toThrow(/dist-tag latest/u);
    expect(execute.mock.calls.some(([, args]) => args[0] === 'dist-tag')).toBe(false);
  });
});
