import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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
    await expect(access(join(dir, 'sources', 'gmail'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'calendar'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'drive'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'tasks'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'candidates'))).resolves.toBeUndefined();
    expect((await loadPersonalOs(dir)).sourceCount).toBe(0);
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

  it('S-9 onboard:agent --format json prints the Codex and Claude Code interview protocol', async () => {
    const output = capture();
    const code = await runCli(['onboard:agent', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const protocol = JSON.parse(output.stdout());
    expect(protocol.goal).toContain('Codex');
    expect(protocol.interviewSections.map((section: { id: string }) => section.id)).toEqual([
      'email',
      'calendar',
      'drive',
      'tasks',
      'permissions',
      'approval'
    ]);
    expect(protocol.safetyRules.join('\n')).toContain('Do not ask the user to paste OAuth tokens');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:recommend');
  });

  it('S-10 onboard:recommend maps Google tools to metadata-first GoG source staging', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:recommend',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'notion',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const recommendations = JSON.parse(output.stdout()).recommendations;
    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'email',
        recommendation: expect.stringContaining('GoG Gmail'),
        sourcePath: 'sources/gmail/threads.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'calendar',
        recommendation: expect.stringContaining('GoG Google Calendar'),
        sourcePath: 'sources/calendar/events.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'drive',
        recommendation: expect.stringContaining('GoG Drive'),
        sourcePath: 'sources/drive/files.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'tasks',
        recommendation: expect.stringContaining('Notion'),
        sourcePath: 'sources/tasks/tasks.jsonl',
        importMode: 'export-first'
      })
    ]));
  });

  it('S-10 onboard:recommend handles no task tool deterministically', async () => {
    const output = capture();
    const code = await runCli(['onboard:recommend', '--tasks', 'none', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const tasks = JSON.parse(output.stdout()).recommendations.find((recommendation: { area: string }) => recommendation.area === 'tasks');
    expect(tasks).toMatchObject({
      area: 'tasks',
      input: 'none',
      importMode: 'not-configured'
    });
  });

  it('S-2 fails loudly for malformed relationship seeds', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:seed', '--dir', dir, '--relationship', 'Otawara||'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('relationship must be');
  });
});
