// Review 01a202e5 (PR #1042 at 848bc34): (1) a Claude Code save landing
// between the installer's content check and its rename() was overwritten, so
// the installer must never replace the settings unconditionally. (2)
// --settings and --config must be refused, before any blocking read, when
// they are not regular files (a named pipe, also behind a link).
import { mkdtemp, readFile, readdir, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Claude Code saving is simulated at one step of the installer's write:
// - 'before-aside': right before the file is moved aside (after the check a
//   plain rename() used to make), so what is taken out is a newer save;
// - 'while-aside': while the file is aside, so a new file appears at the path;
// - 'after-placed': right after the installer's file was placed, written in place.
type Moment = 'before-aside' | 'while-aside' | 'after-placed';
const saves = vi.hoisted(() => ({ settings: '', moment: '' as string, remaining: 0, content: (n: number) => `${n}` }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const save = async () => {
    saves.remaining -= 1;
    await actual.writeFile(saves.settings, saves.content(saves.remaining));
  };
  const armed = (moment: Moment) => saves.remaining > 0 && saves.settings && saves.moment === moment;
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (armed('before-aside') && String(from) === saves.settings && String(to).endsWith('.brainbase-install-previous')) await save();
      return await actual.rename(from, to);
    },
    link: async (from: Parameters<typeof actual.link>[0], to: Parameters<typeof actual.link>[1]) => {
      const placing = String(to) === saves.settings && String(from).endsWith('.tmp');
      if (placing && armed('while-aside')) await save();
      await actual.link(from, to);
      if (placing && armed('after-placed')) await save();
    },
  };
});

const { runCli } = await import('../src/cli.js');

const dirs: string[] = [];
const savedEnv = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
afterEach(async () => {
  saves.settings = '';
  saves.moment = '';
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
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round14-')));
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

async function leftovers(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => /\.tmp$|\.link$|brainbase-install-(previous|ours)$/u.test(name));
}

const saved = () => JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo saved' }] }] } });

describe('judgment:install never writes over a Claude Code save made after its check', () => {
  for (const moment of ['before-aside', 'while-aside', 'after-placed'] as const) {
    it(`keeps a save made ${moment} and registers on top of it`, async () => {
      const { dir, settings } = await home();
      const config = join(dir, 'hook.json');
      Object.assign(saves, { settings, moment, remaining: 1, content: saved });
      const out = capture();
      expect(await runCli([...base, '--settings', settings, '--config', config], out.io)).toBe(0);
      expect(saves.remaining).toBe(0);
      const result = JSON.parse(await readFile(settings, 'utf8'));
      expect(result.permissions).toEqual({ allow: ['Bash(ls)'] });
      expect(commands(result)).toContain('echo saved');
      expect(commands(result).some((command) => command.includes(config))).toBe(true);
      expect(await leftovers(dir)).toEqual([]);
    });

    it(`keeps a save made ${moment} during --remove`, async () => {
      const { dir, settings } = await home();
      const config = join(dir, 'hook.json');
      expect(await runCli([...base, '--settings', settings, '--config', config], capture().io)).toBe(0);
      const registered = JSON.parse(await readFile(settings, 'utf8'));
      Object.assign(saves, { settings, moment, remaining: 1, content: () => JSON.stringify({ ...registered, permissions: { allow: ['Bash(pwd)'] } }) });
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], capture().io)).toBe(0);
      const result = JSON.parse(await readFile(settings, 'utf8'));
      expect(result.permissions).toEqual({ allow: ['Bash(pwd)'] });
      expect(commands(result)).toEqual(['echo kept']);
      expect(await leftovers(dir)).toEqual([]);
    });
  }

  it('stops without writing over the last save when every attempt is interrupted', async () => {
    const { dir, settings } = await home();
    const config = join(dir, 'hook.json');
    Object.assign(saves, { settings, moment: 'before-aside', remaining: 10, content: (n: number) => JSON.stringify({ model: `m${n}` }) });
    const out = capture();
    expect(await runCli([...base, '--settings', settings, '--config', config], out.io)).toBe(1);
    expect(out.stderr()).toMatch(/何度も別の保存が入ったため、何も変えずに止めました/);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ model: `m${saves.remaining}` });
    expect(existsSync(config)).toBe(false);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('writes through a link to the settings and keeps the link', async () => {
    const { dir, settings } = await home();
    const linked = join(dir, 'linked-settings.json');
    await symlink(settings, linked);
    Object.assign(saves, { settings, moment: 'while-aside', remaining: 1, content: saved });
    expect(await runCli([...base, '--settings', linked, '--config', join(dir, 'hook.json')], capture().io)).toBe(0);
    expect(realpathSync(linked)).toBe(settings);
    expect(JSON.parse(await readFile(settings, 'utf8')).permissions).toEqual({ allow: ['Bash(ls)'] });
  });
});

describe('judgment:install refuses settings and configs that are not regular files', () => {
  const fifo = (path: string) => execFileSync('mkfifo', [path]);
  const cases: Array<[string, (dir: string, settings: string) => Promise<string[]>]> = [
    ['--settings is a named pipe', async (dir) => { fifo(join(dir, 'pipe')); return ['--settings', join(dir, 'pipe'), '--config', join(dir, 'hook.json')]; }],
    ['--settings links to a named pipe', async (dir) => { fifo(join(dir, 'pipe')); await symlink(join(dir, 'pipe'), join(dir, 's.json')); return ['--settings', join(dir, 's.json'), '--config', join(dir, 'hook.json')]; }],
    ['--settings is a directory', async (dir) => { await mkdir(join(dir, 'sdir')); return ['--settings', join(dir, 'sdir'), '--config', join(dir, 'hook.json')]; }],
    ['--config is a named pipe', async (dir, settings) => { fifo(join(dir, 'hook.json')); return ['--settings', settings, '--config', join(dir, 'hook.json')]; }],
    ['--config links to a named pipe', async (dir, settings) => { fifo(join(dir, 'pipe')); await symlink(join(dir, 'pipe'), join(dir, 'hook.json')); return ['--settings', settings, '--config', join(dir, 'hook.json')]; }],
  ];
  for (const [name, setup] of cases) {
    for (const remove of [false, true]) {
      it(`${remove ? '--remove' : 'install'}: ${name}`, async () => {
        const { dir, settings } = await home();
        const before = await readFile(settings, 'utf8');
        const args = await setup(dir, settings);
        const out = capture();
        const command = remove ? ['judgment:install', '--target', 'claude-code', '--remove', ...args] : [...base, ...args];
        expect(await runCli(command, out.io)).toBe(1);
        expect(out.stderr()).toMatch(/は通常のファイルではありません/);
        expect(await readFile(settings, 'utf8')).toBe(before);
        // The install lock was let go: a normal install right after runs.
        expect(await runCli([...base, '--settings', settings, '--config', join(dir, 'ok.json')], capture().io)).toBe(0);
      }, 10_000);
    }
  }
});
