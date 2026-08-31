import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
    execFileSync('npm', ['install', '--save-exact', `@unson/brainbase-mcp@${dependency}`], {
      cwd: consumerRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false'
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
  }, 120_000);
});
