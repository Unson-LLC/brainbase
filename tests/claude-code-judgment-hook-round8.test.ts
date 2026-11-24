// Same shape as review 7064222101 (PR #1041 at fdd275a), applied to judgment:install.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
const savedEnv = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
afterEach(async () => {
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

describe('judgment:install refuses --opt=value and a bare --opt instead of using the default file', () => {
  const other = '/tmp/brainbase-round8-not-used';
  for (const extra of [
    [`--settings=${other}/settings.json`],
    [`--config=${other}/hook.json`],
    ['--settings', '--config', `${other}/hook.json`],
    ['--config', '--settings', `${other}/settings.json`],
    [`--settings=${other}/settings.json`, '--remove'],
    [`--config=${other}/hook.json`, '--remove'],
    ['--server=https://api.example.net'],
    ['--origin=https://mcp.example.net'],
  ]) {
    it(`refuses ${JSON.stringify(extra)} and leaves the default settings alone`, async () => {
      const home = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round8-')));
      dirs.push(home);
      process.env.HOME = home;
      process.env.CLAUDE_CONFIG_DIR = home;
      const settings = join(home, 'settings.json');
      const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo kept' }] }] } };
      await writeFile(settings, JSON.stringify(existing));
      const argv = ['judgment:install', '--target', 'claude-code', ...extra];
      if (!extra.some((token) => token.startsWith('--origin'))) argv.push('--origin', 'https://mcp.example.net');
      if (!extra.some((token) => token.startsWith('--server'))) argv.push('--server', 'https://api.example.net');
      const out = capture();
      expect(await runCli(argv, out.io)).toBe(1);
      expect(out.stderr()).toMatch(/--(settings|config|server|origin)(=… の形は使えません| には値が要ります)/);
      expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(existing);
      expect(await readdir(home)).toEqual(['settings.json']);
    });
  }
});
