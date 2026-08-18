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
const allowedWorkflowFiles = new Set([
  '.github/workflows/npm-publish.yml'
]);

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
  return files.filter((file) => (
    !file.startsWith('docs/manual/public/')
    && !allowedWorkflowFiles.has(file)
    && forbiddenArtifactPatterns.some((pattern) => pattern.test(file))
  ));
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

  it('AP-1 limits the workflow exception to the npm publication workflow', () => {
    expect(forbiddenMatches(['.github/workflows/npm-publish.yml'])).toEqual([]);
    expect(forbiddenMatches(['.github/workflows/xterm.yml'])).toEqual([
      '.github/workflows/xterm.yml'
    ]);
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
  }, 30_000);

  it('onboarding-first-value-experience S-4 C-4 agent instructions require useful output, not only readiness', async () => {
    const agents = await readFile(join(repoRoot, 'AGENTS.md'), 'utf8');
    const claude = await readFile(join(repoRoot, 'CLAUDE.md'), 'utf8');
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');

    for (const text of [agents, claude]) {
      expect(text).toContain('Do not stop at `ready: true`');
      expect(text).toContain('Show the first useful output');
      expect(text).toContain('what the user did not have to explain again');
      expect(text, 'onboarding-operationalization-next-actions S-5 C-5 agent instructions require operationalization next actions').toContain('Commands existing in the product are not enough');
      expect(text).toContain('public skills placement');
      expect(text).toContain('ohayo` / `oyasumi` / `retro');
      expect(text).toContain('MCP `resolve_entity` / `get_context` / `search` verification');
      expect(text).toContain('Lead with three short sections');
      expect(text).toContain('what Brainbase remembered');
      expect(text).toContain('how it connected the request');
      expect(text).toContain('what the user can do next');
      expect(text).toContain('Do not use a table for the first-value answer');
      expect(text).toContain('canonical IDs, relation paths, receipt digests, raw tool traces, and source file names under an optional details section');
      expect(text).toContain('Do not narrate internal skill loading, lookup retries, or tool orchestration');
    }

    expect(readme, 'onboarding-operationalization-next-actions S-5 C-5 README guidance must keep onboarding open after the demo').toContain('After the demo, keep onboarding open');
    expect(readme).toContain('brainbase onboard:skills --target codex');
    expect(readme).toContain('brainbase onboard:routines --target codex --cwd /path/to/brainbase');
    expect(readme).toContain('brainbase onboard:install --target codex --dry-run');
    expect(readme).toContain('source allowlist / import / candidate review decisions');
    expect(readme).toContain('MCP `resolve_entity` / `get_context` / `search` verification');
    expect(readme).toContain('Do not treat those generated artifacts as installed');
  });

  it('documents the concise first-value response contract in the public manual', async () => {
    const firstValue = await readFile(join(repoRoot, 'docs/manual/guide/first-value.md'), 'utf8');
    const quickStart = await readFile(join(repoRoot, 'docs/manual/guide/quick-start.md'), 'utf8');

    for (const text of [firstValue, quickStart]) {
      expect(text).toContain('覚えていたこと');
      expect(text).toContain('つながったこと');
      expect(text).toContain('次にできること');
      expect(text).toContain('初回表示に表は使いません');
      expect(text).toContain('正規ID、関係経路、Receipt digest、toolの生ログは「詳細」');
    }
  });

  it('keeps the public Judgment Host guide aligned with the three-hook audit contract', async () => {
    const guide = await readFile(join(repoRoot, 'docs/manual/guide/judgment-audit.md'), 'utf8');
    const operations = await readFile(join(repoRoot, 'docs/manual/guide/operations.md'), 'utf8');
    const cliReference = await readFile(join(repoRoot, 'docs/manual/reference/cli.md'), 'utf8');
    const publicDocs = `${guide}\n${operations}\n${cliReference}`;

    expect(guide).toContain('`UserPromptSubmit`');
    expect(guide).toContain('`PostToolUse`');
    expect(guide).toContain('`Stop`');
    expect(guide).toContain('🧠 判断参照:');
    expect(guide).toContain('📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓');
    expect(guide).toContain('doctor --judgment-hooks');
    expect(publicDocs).not.toContain('🧠 Brainbase参照:');
    expect(publicDocs).not.toContain('⚠️ Brainbase参照:');
  });
});
