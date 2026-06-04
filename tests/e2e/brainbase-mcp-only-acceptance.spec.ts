import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { defaultDataDir } from '../../src/paths.js';
import { toolDefinitions } from '../../src/server.js';
import { loadPersonalOs } from '../../src/ssot.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-story-e2e-'));
  dirs.push(dir);
  return dir;
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('brainbase-mcp-only story acceptance', () => {
  it('brainbase-mcp-only ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 covers the MCP-only onboarding journey', async () => {
    const repoRoot = process.cwd();
    const dir = await tempDir();

    const initOutput = capture();
    await expect(runCli(['onboard:init', '--dir', dir], initOutput.io)).resolves.toBe(0);

    const seedOutput = capture();
    await expect(runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex'
    ], seedOutput.io)).resolves.toBe(0);

    const os = await loadPersonalOs(dir);
    const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    const codexOutput = capture();
    const claudeOutput = capture();
    const codecodeOutput = capture();
    await expect(runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--dry-run'], codexOutput.io)).resolves.toBe(0);
    await expect(runCli(['onboard:install', '--target', 'claude', '--dir', dir, '--dry-run'], claudeOutput.io)).resolves.toBe(0);
    await expect(runCli(['onboard:install', '--target', 'codecode', '--dir', dir, '--dry-run'], codecodeOutput.io)).resolves.toBe(0);
    const [pack] = JSON.parse((await execFileAsync('npm', ['pack', '--dry-run', '--json'], { cwd: repoRoot })).stdout) as Array<{ files: Array<{ path: string }> }>;
    const packedFiles = pack.files.map((file) => file.path);

    expect(packageJson.name, 'brainbase-mcp-only ac:1 The root package is @unson/brainbase-mcp, with brainbase-mcp for stdio MCP and brainbase for onboarding CLI.').toBe('@unson/brainbase-mcp');
    expect(packageJson.bin, 'brainbase-mcp-only ac:1 The root package is @unson/brainbase-mcp, with brainbase-mcp for stdio MCP and brainbase for onboarding CLI.').toMatchObject({ 'brainbase-mcp': 'dist/index.js', brainbase: 'dist/cli.js' });
    expect(await pathExists(join(repoRoot, 'server.js')), 'brainbase-mcp-only ac:2 The repository contains no browser UI, session dashboard, xterm transport, launchd runtime, workflow mission control, SNS operation flow, hosted backend implementation, or Unson internal data.').toBe(false);
    await expect(pathExists(join(repoRoot, 'public'))).resolves.toBe(false);
    await expect(pathExists(join(repoRoot, 'ui-islands'))).resolves.toBe(false);
    expect(toolDefinitions.map((tool) => tool.name), 'brainbase-mcp-only ac:3 The v1 MCP tool surface is fixed to get_context, list_entities, search, search_personal_kg, and onboarding_status.').toEqual([
      'get_context',
      'list_entities',
      'search',
      'search_personal_kg',
      'onboarding_status'
    ]);
    expect(defaultDataDir(), 'brainbase-mcp-only ac:4 The default local SSOT directory is ~/.brainbase/personal-os/, overridable with BRAINBASE_PERSONAL_OS_DIR.').toContain('.brainbase/personal-os');
    expect(codexOutput.stdout(), 'brainbase-mcp-only ac:4 The default local SSOT directory is ~/.brainbase/personal-os/, overridable with BRAINBASE_PERSONAL_OS_DIR.').toContain('BRAINBASE_PERSONAL_OS_DIR');
    await expect(pathExists(join(dir, 'graph.json')), 'brainbase-mcp-only ac:5 The canonical local SSOT files are graph.json, personal-kg.jsonl, relationships.json, and decisions.jsonl.').resolves.toBe(true);
    await expect(pathExists(join(dir, 'personal-kg.jsonl'))).resolves.toBe(true);
    await expect(pathExists(join(dir, 'relationships.json'))).resolves.toBe(true);
    await expect(pathExists(join(dir, 'decisions.jsonl'))).resolves.toBe(true);
    await expect(pathExists(join(dir, 'sources')), 'brainbase-mcp-only ac:6 Raw notes, logs, and meeting transcripts can exist under sources/, but MCP responses prefer canonical SSOT data.').resolves.toBe(true);
    expect(os.personalKg.some((entry) => entry.text.includes('Local facts first')), 'brainbase-mcp-only ac:6 Raw notes, logs, and meeting transcripts can exist under sources/, but MCP responses prefer canonical SSOT data.').toBe(true);
    expect(initOutput.stdout(), 'brainbase-mcp-only ac:7 brainbase onboard:init creates the minimum local SSOT structure.').toContain('Initialized');
    expect(os.graph.owner?.name, 'brainbase-mcp-only ac:8 brainbase onboard:seed can seed self, work, and relationship context.').toBe('Owner');
    expect(os.relationships.relationships[0]?.person, 'brainbase-mcp-only ac:8 brainbase onboard:seed can seed self, work, and relationship context.').toBe('Otawara');
    expect(codexOutput.stdout(), 'brainbase-mcp-only ac:9 brainbase onboard:install --target codex|claude|codecode --dry-run emits a launchable client-specific MCP config without requiring users to guess a global binary path: Codex gets TOML, Claude and CodeCode get standard MCP JSON. --output writes a new snippet and refuses to overwrite existing client config.').toContain('[mcp_servers.brainbase]');
    expect(JSON.parse(claudeOutput.stdout()).mcpServers.brainbase.command, 'brainbase-mcp-only ac:9 brainbase onboard:install --target codex|claude|codecode --dry-run emits a launchable client-specific MCP config without requiring users to guess a global binary path: Codex gets TOML, Claude and CodeCode get standard MCP JSON. --output writes a new snippet and refuses to overwrite existing client config.').toBe(process.execPath);
    expect(JSON.parse(codecodeOutput.stdout()).mcpServers.brainbase.command).toBe(process.execPath);
    expect(JSON.stringify(packageJson.dependencies), 'brainbase-mcp-only ac:10 Local MCP mode requires no secrets, Infisical, bb.unson.jp, Lightsail, AWS credentials, or hosted backend.').not.toContain('infisical');
    expect(JSON.stringify(packageJson.scripts), 'brainbase-mcp-only ac:10 Local MCP mode requires no secrets, Infisical, bb.unson.jp, Lightsail, AWS credentials, or hosted backend.').not.toContain('BRAINBASE_BACKEND=hosted');
    expect(packedFiles.every((file) => (
      file === 'LICENSE'
      || file === 'README.md'
      || file === 'SECURITY.md'
      || file === 'package.json'
      || file.startsWith('dist/')
    )), 'brainbase-mcp-only ac:11 The package tarball excludes UI/internal artifacts, raw personal data, VibePro workbench files, and tests.').toBe(true);
  });
});
