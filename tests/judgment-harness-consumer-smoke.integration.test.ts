import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReleaseArtifact } from '../scripts/npm-release.mjs';

const JUDGMENT_HARNESS_CONSUMER_TIMEOUT_MS = 120_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('judgment harness tarball consumer smoke (AC-05)', () => {
  it('imports Host and portable contracts from a packed tarball and passes queue/readback smoke', async () => {
    const root = process.cwd();
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-judgment-harness-artifact-'));
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

    const smokeOutput = execFileSync(process.execPath, [
      path.join(root, 'scripts/judgment-harness-consumer-smoke.mjs'),
      artifact.tarballPath
    ], {
      cwd: root,
      encoding: 'utf8',
      env: environment
    });
    const result = JSON.parse(smokeOutput);

    expect(result).toMatchObject({
      packageName: '@unson/brainbase-mcp',
      version,
      judgmentHarness: {
        hostApi: 'passed',
        executionOutcome: 'passed',
        nodeEvidence: 'passed',
        eventAdapter: 'passed',
        queueReadbackSmoke: 'passed',
        outbox: {
          enqueue: 'queued',
          delivery: {
            status: 'processed',
            delivered: 1,
            failed: 0,
            pending: 0
          },
          posts: 1
        },
        subpathImports: expect.arrayContaining([
          expect.objectContaining({ subpath: '@unson/brainbase-mcp/judgment-host' }),
          expect.objectContaining({ subpath: '@unson/brainbase-mcp/judgment-execution-outcome' }),
          expect.objectContaining({ subpath: '@unson/brainbase-mcp/judgment-node-evidence' }),
          expect.objectContaining({ subpath: '@unson/brainbase-mcp/judgment-event-adapter' }),
          expect.objectContaining({ subpath: '@unson/brainbase-mcp/judgment-event-outbox' })
        ])
      }
    });
    expect(result.judgmentHarness.subpathImports.every((entry: { modulePath: string }) => (
      entry.modulePath.startsWith('dist/')
    ))).toBe(true);
    expect(result.consumerRoot).not.toContain(root);
    await expect(access(result.consumerRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  }, JUDGMENT_HARNESS_CONSUMER_TIMEOUT_MS);
});
