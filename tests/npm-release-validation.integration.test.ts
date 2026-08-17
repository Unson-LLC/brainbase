import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReleaseArtifact } from '../scripts/npm-release.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('npm release validation evidence', () => {
  it('audits production dependencies and hashes a real tarball without publication credentials', async () => {
    const root = process.cwd();
    const evidenceRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-release-evidence-'));
    temporaryRoots.push(evidenceRoot);
    const npmUserConfig = path.join(evidenceRoot, 'user-npmrc');
    const npmGlobalConfig = path.join(evidenceRoot, 'global-npmrc');
    const npmCache = path.join(evidenceRoot, 'cache');
    await writeFile(npmUserConfig, '');
    await writeFile(npmGlobalConfig, '');

    const {
      NPM_TOKEN: _npmToken,
      NODE_AUTH_TOKEN: _nodeAuthToken,
      ...credentialFreeEnvironment
    } = process.env;
    const environment = {
      ...credentialFreeEnvironment,
      NPM_CONFIG_USERCONFIG: npmUserConfig,
      NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
      NPM_CONFIG_CACHE: npmCache
    };
    const execute = (command: string, args: string[], cwd = root): string => execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: environment
    });

    expect(execute('npm', ['audit', '--omit=dev'])).toMatch(/found 0 vulnerabilities/u);
    const sha = execute('git', ['rev-parse', 'HEAD']).trim();
    const currentVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const artifact = await createReleaseArtifact(root, evidenceRoot, currentVersion, sha, execute);
    const bytes = await readFile(artifact.tarballPath);
    expect(artifact.tarballSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(artifact.tarballIntegrity).toBe(`sha512-${createHash('sha512').update(bytes).digest('base64')}`);

    const manifest = JSON.parse(execute('tar', ['-xOf', artifact.tarballPath, 'package/package.json']));
    expect(manifest).toMatchObject({
      name: '@unson/brainbase-mcp',
      version: currentVersion,
      gitHead: sha,
      repository: {
        type: 'git',
        url: 'git+https://github.com/Unson-LLC/brainbase.git'
      }
    });
  }, 30_000);
});
