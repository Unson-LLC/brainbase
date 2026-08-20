import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReleaseArtifact } from '../scripts/npm-release.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('npm tarball consumer smoke', () => {
  it('runs the public CLI and MCP tools/list from a fresh installed consumer', async () => {
    const root = process.cwd();
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-consumer-artifact-'));
    temporaryRoots.push(artifactRoot);
    const npmUserConfig = path.join(artifactRoot, 'user-npmrc');
    const npmGlobalConfig = path.join(artifactRoot, 'global-npmrc');
    const npmCache = path.join(artifactRoot, 'cache');
    await writeFile(npmUserConfig, '');
    await writeFile(npmGlobalConfig, '');
    const environment = {
      ...process.env,
      NPM_TOKEN: undefined,
      NODE_AUTH_TOKEN: undefined,
      NPM_CONFIG_USERCONFIG: npmUserConfig,
      NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
      NPM_CONFIG_CACHE: npmCache
    };
    const execute = (command: string, args: string[], cwd = root): string => execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: environment
    });
    execute('npm', ['run', 'build']);
    const sha = execute('git', ['rev-parse', 'HEAD']).trim();
    const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const artifact = await createReleaseArtifact(root, artifactRoot, version, sha, execute);

    const smokeEnvironment = {
      ...environment,
      npm_execpath: undefined,
      PATH: path.join(root, 'node_modules', '.bin'),
      NODE_PATH: path.join(root, 'node_modules'),
      NODE_OPTIONS: '--no-warnings',
      NPM_CONFIG_REGISTRY: 'https://registry-user:registry-password@example.invalid/',
      HTTPS_PROXY: 'http://proxy-user:proxy-password@example.invalid:8080'
    };
    const smokeOutput = execFileSync(process.execPath, [
      path.join(root, 'scripts/npm-consumer-smoke.mjs'), artifact.tarballPath
    ], {
      cwd: root,
      encoding: 'utf8',
      env: smokeEnvironment
    });
    const result = JSON.parse(smokeOutput);

    expect(result).toMatchObject({
      packageName: '@unson/brainbase-mcp',
      version,
      cli: {
        help: 'passed',
        start: 'passed',
        seed: 'passed',
        doctor: 'passed'
      },
      mcp: {
        toolsList: 'passed',
        contextReadback: 'passed'
      },
      judgmentDag: {
        subpathImport: 'passed',
        legacyDeepImport: 'passed',
        contractArtifacts: {
          schema: 'passed',
          fixture: 'passed',
          sourceLock: 'passed',
          digest: 'passed'
        },
        contractVerification: {
          sourceLockSources: 2,
          digestFiles: 6,
          aggregateDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
        },
        executionOrder: [
          'context.account', 'context.customer', 'judgment.fit', 'resource.scope',
          'execution.proposal', 'execution.outcome', 'evaluation.result'
        ],
        negativeBoundaries: {
          missing_dependency: { status: 'passed', errorCode: 'missing_dependency' },
          cycle: { status: 'passed', errorCode: 'cycle' },
          mirror_mismatch: { status: 'passed', errorCode: 'invalid_contract' },
          scope_boundary_violation: { status: 'passed', errorCode: 'scope_boundary_violation' },
          invalid_contract: { status: 'passed', errorCode: 'invalid_contract' }
        }
      },
      runtime: {
        command: process.execPath,
        cliTarget: 'dist/cli.js',
        mcpTarget: 'dist/index.js'
      }
    });
    expect(result.consumerRoot).not.toContain(root);
    await expect(access(result.consumerRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);
});
