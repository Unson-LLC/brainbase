import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(repoRoot, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
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
  });
});
