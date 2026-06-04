import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

describe('onboarding CLI', () => {
  it('S-1 onboard:init creates the minimum files', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:init', '--dir', dir], output.io);

    expect(code).toBe(0);
    await expect(readFile(join(dir, 'graph.json'), 'utf8')).resolves.toContain('"version": 1');
    await expect(readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).resolves.toBe('');
    expect(output.stdout()).toContain('Initialized');
  });

  it('S-2 onboard:seed updates self, work, and relationships', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex'
    ], output.io);

    expect(code).toBe(0);
    const os = await loadPersonalOs(dir);
    expect(os.graph.owner?.name).toBe('Owner');
    expect(os.graph.entities.some((entity) => entity.name === 'MCP Onboarding')).toBe(true);
    expect(os.relationships.relationships[0]?.person).toBe('Otawara');
    expect(os.personalKg.some((entry) => entry.text === 'Local facts first')).toBe(true);
  });

  it('S-3 onboard:install --target codex --dry-run prints valid Codex TOML config', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('[mcp_servers.brainbase]');
    expect(output.stdout()).toContain(`[mcp_servers.brainbase.env]`);
    expect(output.stdout()).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(output.stdout()).toMatch(/args = \[".*src\/index\.js"\]/);
    expect(output.stdout()).toContain(`BRAINBASE_PERSONAL_OS_DIR = ${JSON.stringify(dir)}`);
  });

  it.each(['claude', 'codecode'])('S-3 onboard:install --target %s --dry-run prints valid MCP JSON config', async (target) => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', target, '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    expect(config.mcpServers.brainbase.command).toBe(process.execPath);
    expect(config.mcpServers.brainbase.args[0]).toMatch(/src\/index\.js$/);
    expect(config.mcpServers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR).toBe(dir);
  });

  it('S-3 onboard:install writes a new snippet file and refuses to overwrite existing client config', async () => {
    const dir = await tempDir();
    const outputPath = join(dir, 'brainbase-codex-snippet.toml');
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], output.io);

    expect(code).toBe(0);
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('[mcp_servers.brainbase]');

    const second = capture();
    const secondCode = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], second.io);

    expect(secondCode).toBe(1);
    expect(second.stderr()).toContain('Refusing to overwrite existing MCP config snippet');
  });

  it('S-3 fails loudly for unsupported install targets', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'unknown', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('onboard:install requires --target codex|claude|codecode');
  });

  it('S-2 fails loudly for malformed relationship seeds', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:seed', '--dir', dir, '--relationship', 'Otawara||'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('relationship must be');
  });
});
