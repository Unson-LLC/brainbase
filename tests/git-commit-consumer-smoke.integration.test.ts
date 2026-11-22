import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const GIT_CONSUMER_TEST_TIMEOUT_MS = 240_000;
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

describe('exact git commit consumer contract', () => {
  it('declares the build lifecycle required by an exact git dependency', async () => {
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts?.prepare).toBe('npm run build');
  });

  it('installs the exact current commit and imports the public Judgment DAG API', async () => {
    const repositoryRoot = process.cwd();
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }).trim();
    const consumerRoot = await mkdtemp(path.join(tmpdir(), 'brainbase-git-consumer-'));
    temporaryRoots.push(consumerRoot);
    await writeFile(path.join(consumerRoot, 'package.json'), JSON.stringify({
      name: 'brainbase-exact-git-consumer',
      private: true,
      type: 'module'
    }));

    const dependency = `git+${pathToFileURL(repositoryRoot).href}#${sha}`;
    // pacote prepares git dependencies inside `<npm-cache>/_cacache/tmp/git-clone*`,
    // extracting ~389 devDependencies (~20k files) and running `npm run build` there.
    // On shared WSL2 CI runners, doing that on the shared disk cache (~/.npm) takes
    // ~140s under disk contention. When /dev/shm tmpfs has >= 1 GiB free, putting
    // a throwaway npm cache inside consumerRoot (/dev/shm) keeps extraction,
    // TypeScript compilation, and cleanup in RAM (~30s faster on busy runners).
    let isolatedCache: string | undefined;
    if (process.env.BRAINBASE_TEST_FIXTURE_ROOT) {
      try {
        const stats = statfsSync(consumerRoot);
        if (stats.bavail * stats.bsize >= 1024 * 1024 * 1024) {
          isolatedCache = path.join(consumerRoot, 'npm-cache');
        }
      } catch {
        // Fall back to the default npm cache when statfs is unavailable.
      }
    }
    execFileSync('npm', ['install', '--save-exact', '--prefer-offline', '--no-audit', '--no-fund', `@unson/brainbase-mcp@${dependency}`], {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(isolatedCache ? { NPM_CONFIG_CACHE: isolatedCache } : {}),
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_PREFER_OFFLINE: 'true',
        NPM_CONFIG_PROGRESS: 'false',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false'
      }
    });

    const installedPackage = JSON.parse(await readFile(
      path.join(consumerRoot, 'node_modules/@unson/brainbase-mcp/package.json'),
      'utf8'
    ));
    const lock = JSON.parse(await readFile(path.join(consumerRoot, 'package-lock.json'), 'utf8'));
    const locked = lock.packages?.['node_modules/@unson/brainbase-mcp'];
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', [
      "import { saveJudgmentDAGRunArtifact } from '@unson/brainbase-mcp/judgment-dag';",
      "process.stdout.write(typeof saveJudgmentDAGRunArtifact);"
    ].join('\n')], {
      cwd: consumerRoot,
      encoding: 'utf8'
    });

    expect(installedPackage.name).toBe('@unson/brainbase-mcp');
    expect(locked?.resolved).toBe(dependency);
    expect(output).toBe('function');
  }, GIT_CONSUMER_TEST_TIMEOUT_MS);
});
