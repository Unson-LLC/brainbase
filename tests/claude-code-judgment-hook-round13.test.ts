// Review 01a200be (PR #1042 at 06bc015): (1) --settings could name another
// registration's hook config, and that registration's next run replaced the
// file whole and dropped the hooks added to it. (2) A settings save by Claude
// Code between the installer's read and write was overwritten.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Claude Code saving its settings is simulated at the installer's chmod of the
// temporary settings file: the last step before the installer's own check.
const saves = vi.hoisted(() => ({ settings: '', remaining: 0, content: (n: number) => `${n}` }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    chmod: async (path: Parameters<typeof actual.chmod>[0], mode: Parameters<typeof actual.chmod>[1]) => {
      await actual.chmod(path, mode);
      if (saves.remaining > 0 && saves.settings && String(path).startsWith(`${saves.settings}.`) && String(path).endsWith('.tmp')) {
        saves.remaining -= 1;
        await actual.writeFile(saves.settings, saves.content(saves.remaining));
      }
    },
  };
});

const { runCli } = await import('../src/cli.js');

const dirs: string[] = [];
const savedEnv = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
afterEach(async () => {
  saves.settings = '';
  saves.remaining = 0;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
    stdout: () => stdout, stderr: () => stderr,
  };
}

async function home() {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round13-')));
  dirs.push(dir);
  process.env.HOME = dir;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const settings = join(dir, 'settings.json');
  await writeFile(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo kept' }] }] } }));
  return { dir, settings };
}

const base = ['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net'];

function commands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  return Object.values(hooks).flat().flatMap((group) => group.hooks.map((hook) => hook.command));
}

describe('judgment:install refuses a --settings file brainbase writes for another use', () => {
  it('does not add hooks to another registration\'s hook config, so its next run cannot drop them', async () => {
    const { dir, settings } = await home();
    const configA = join(dir, 'a.json');
    const configB = join(dir, 'b.json');
    expect(await runCli([...base, '--settings', settings, '--config', configA], capture().io)).toBe(0);
    const before = await readFile(configA, 'utf8');

    const out = capture();
    expect(await runCli([...base, '--settings', configA, '--config', configB], out.io)).toBe(1);
    expect(out.stderr()).toMatch(/判断フックの設定で、Claude Code の設定ではありません/);
    expect(await readFile(configA, 'utf8')).toBe(before);
    expect(existsSync(configB)).toBe(false);

    // The first registration still runs again cleanly.
    expect(await runCli([...base, '--settings', settings, '--config', configA], capture().io)).toBe(0);
  });

  it('refuses the same for --remove', async () => {
    const { dir, settings } = await home();
    const configA = join(dir, 'a.json');
    expect(await runCli([...base, '--settings', settings, '--config', configA], capture().io)).toBe(0);
    const before = await readFile(configA, 'utf8');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', configA, '--config', join(dir, 'b.json')], out.io)).toBe(1);
    expect(out.stderr()).toMatch(/Claude Code の設定ではありません/);
    expect(await readFile(configA, 'utf8')).toBe(before);
  });

  it('refuses a saved brainbase login file', async () => {
    const { dir } = await home();
    const login = join(dir, 'other-login.json');
    const text = JSON.stringify({ schema_version: 'brainbase-credentials-v1', server_url: 'https://api.example.net' });
    await writeFile(login, text);
    const out = capture();
    expect(await runCli([...base, '--settings', login, '--config', join(dir, 'b.json')], out.io)).toBe(1);
    expect(out.stderr()).toMatch(/brainbase login の保存ファイル/);
    expect(await readFile(login, 'utf8')).toBe(text);
    expect(existsSync(join(dir, 'b.json'))).toBe(false);
  });
});

describe('judgment:install keeps a settings save made by Claude Code during the install', () => {
  it('starts again from the saved settings and keeps both the save and the hooks', async () => {
    const { dir, settings } = await home();
    const config = join(dir, 'hook.json');
    saves.settings = settings;
    saves.remaining = 1;
    saves.content = () => JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo saved' }] }] } });
    const out = capture();
    expect(await runCli([...base, '--settings', settings, '--config', config], out.io)).toBe(0);
    const saved = JSON.parse(await readFile(settings, 'utf8'));
    expect(saved.permissions).toEqual({ allow: ['Bash(ls)'] });
    expect(commands(saved)).toContain('echo saved');
    expect(commands(saved)).not.toContain('echo kept');
    expect(commands(saved).some((command) => command.includes(config))).toBe(true);
    expect(JSON.parse(await readFile(config, 'utf8')).registration.settings).toBe(settings);
  });

  it('stops without changing anything when the settings keep changing', async () => {
    const { dir, settings } = await home();
    const config = join(dir, 'hook.json');
    saves.settings = settings;
    saves.remaining = 10;
    saves.content = (n) => JSON.stringify({ model: `m${n}` });
    const out = capture();
    expect(await runCli([...base, '--settings', settings, '--config', config], out.io)).toBe(1);
    expect(out.stderr()).toMatch(/何度も別の保存が入ったため、何も変えずに止めました/);
    // The last save stays as it was written, and the new config was taken back.
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ model: `m${saves.remaining}` });
    expect(existsSync(config)).toBe(false);
    expect((await fsPromises.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps a save made during --remove and still removes the registration', async () => {
    const { dir, settings } = await home();
    const config = join(dir, 'hook.json');
    expect(await runCli([...base, '--settings', settings, '--config', config], capture().io)).toBe(0);
    const registered = JSON.parse(await readFile(settings, 'utf8'));
    saves.settings = settings;
    saves.remaining = 1;
    saves.content = () => JSON.stringify({ ...registered, permissions: { allow: ['Bash(pwd)'] } });
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], capture().io)).toBe(0);
    const saved = JSON.parse(await readFile(settings, 'utf8'));
    expect(saved.permissions).toEqual({ allow: ['Bash(pwd)'] });
    expect(commands(saved)).toContain('echo kept');
    expect(commands(saved).some((command) => command.includes(config))).toBe(false);
    expect(existsSync(config)).toBe(false);
  });
});
