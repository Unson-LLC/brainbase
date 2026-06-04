import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);
const forbiddenArtifactPatterns = [
  /(^|\/)public(\/|$)/,
  /(^|\/)ui-islands(\/|$)/,
  /^(server|start)\.js$/,
  /(^|\/)mcp\/(brainbase|jibble|nocodb)(\/|$)/,
  /(^|\/)sns(\/|$)/,
  /(^|\/)launchd(\/|$)/,
  /(^|\/)workflow(s)?(\/|$)/,
  /xterm/i,
  /mission-control/i,
  /codex-app-server/i
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(repoRoot, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function gitTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoRoot });
  return stdout.split('\n').filter(Boolean);
}

async function packFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], { cwd: repoRoot });
  const [pack] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  return pack.files.map((file) => file.path);
}

function forbiddenMatches(files: string[]): string[] {
  return files.filter((file) => forbiddenArtifactPatterns.some((pattern) => pattern.test(file)));
}

describe('MCP-only repository hygiene', () => {
  it('AP-1 keeps UI and internal runtime surfaces out of the source tree', async () => {
    const forbiddenPaths = [
      'public',
      'ui-islands',
      'server.js',
      'start.js',
      'mcp/brainbase',
      'mcp/jibble',
      'mcp/nocodb',
      'sns',
      'launchd'
    ];

    await Promise.all(forbiddenPaths.map(async (path) => {
      expect(await exists(path), `${path} should not be present in the MCP-only repo`).toBe(false);
    }));

    const trackedFiles = await gitTrackedFiles();
    expect(forbiddenMatches(trackedFiles)).toEqual([]);
  });

  it('INV-1 keeps hosted backend and secret managers out of v1 dependencies', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    const dependencyNames = Object.keys({
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {})
    });

    expect(dependencyNames).not.toContain('infisical');
    expect(dependencyNames).not.toContain('@infisical/sdk');
    expect(JSON.stringify(packageJson.scripts)).not.toContain('BRAINBASE_BACKEND=hosted');
  });

  it('INV-4 publishes only runtime package files and public docs', async () => {
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.files).toEqual([
      'dist',
      'README.md',
      'LICENSE',
      'SECURITY.md'
    ]);

    const publishedFiles = await packFiles();
    expect(forbiddenMatches(publishedFiles)).toEqual([]);
    expect(publishedFiles.every((file) => (
      file === 'LICENSE'
      || file === 'README.md'
      || file === 'SECURITY.md'
      || file === 'package.json'
      || file.startsWith('dist/')
    ))).toBe(true);
  });
});
