// The login commands stop on an argument they do not know, before the save path
// is decided (UNS-656 plan B PR2, review round 11, item 3). A mistyped option
// used to be ignored, so logout fell back to the default path and deleted the
// default login. Every value here is a fake made up in this file.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION } from '../src/brainbase-login.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
let savedEnv: string | undefined;
let defaultPath = '';
let otherPath = '';

const SAVED = `${JSON.stringify({
  schema_version: CREDENTIALS_SCHEMA_VERSION,
  login_id: 'fake-login-id',
  server_url: 'https://api.example.invalid',
  access_token: 'fake.access.token',
  refresh_token: 'fake-refresh-token',
  expires_at: '2099-01-01T00:00:00.000Z',
}, null, 2)}\n`;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-r12-'));
  dirs.push(dir);
  defaultPath = join(dir, 'default-credentials.json');
  otherPath = join(dir, 'other-credentials.json');
  await writeFile(defaultPath, SAVED, { mode: 0o600 });
  await writeFile(otherPath, SAVED, { mode: 0o600 });
  savedEnv = process.env.BRAINBASE_CREDENTIALS_FILE;
  process.env.BRAINBASE_CREDENTIALS_FILE = defaultPath;
  vi.stubGlobal('fetch', async () => { throw new Error('the server must not be called'); });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (savedEnv === undefined) delete process.env.BRAINBASE_CREDENTIALS_FILE;
  else process.env.BRAINBASE_CREDENTIALS_FILE = savedEnv;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (t: string) => { stdout += t; } }, stderr: { write: (t: string) => { stderr += t; } } },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function bothFilesKept(): Promise<void> {
  expect(await readFile(defaultPath, 'utf8')).toBe(SAVED);
  expect(await readFile(otherPath, 'utf8')).toBe(SAVED);
}

describe('logout stops on an argument it does not know', () => {
  it.each([
    ['a misspelt option with a value', ['--credntials', 'OTHER']],
    ['a misspelt option without a value', ['--credential']],
    ['an option of another command', ['--dir', 'OTHER']],
    ['a single-dash option, read as a stray word', ['-credentials', 'OTHER']],
    ['a path with no option name', ['OTHER']],
    ['the right option next to an unknown one', ['--credentials', 'OTHER', '--force']],
    ['the right option given twice', ['--credentials', 'OTHER', '--credentials', 'OTHER']],
  ])('keeps the default login for %s', async (_name, args) => {
    const argv = ['logout', ...args.map((arg) => arg.replace('OTHER', otherPath))];
    const out = capture();
    expect(await runCli(argv, out.io as never)).toBe(1);
    expect(out.stderr()).toContain('何も変えずに止めました');
    expect(out.stderr()).toContain('brainbase logout [--credentials <path>]');
    expect(out.stdout()).not.toContain('消しました');
    await bothFilesKept();
  });

  it('names the option it did not know', async () => {
    const out = capture();
    expect(await runCli(['logout', '--credntials', otherPath], out.io as never)).toBe(1);
    expect(out.stderr()).toContain('--credntials');
  });

  it('still removes the login it was pointed at, and only that one', async () => {
    const out = capture();
    expect(await runCli(['logout', '--credentials', otherPath], out.io as never)).toBe(0);
    expect(out.stdout()).toContain(otherPath);
    await expect(readFile(otherPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(defaultPath, 'utf8')).toBe(SAVED);
  });

  it('still removes the default login when given nothing', async () => {
    const out = capture();
    expect(await runCli(['logout'], out.io as never)).toBe(0);
    await expect(readFile(defaultPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(otherPath, 'utf8')).toBe(SAVED);
  });
});

describe('login and login:status stop on an argument they do not know', () => {
  it.each([
    ['login', ['--server', 'https://api.example.invalid', '--credntials', 'OTHER']],
    ['login', ['--sever', 'https://api.example.invalid']],
    ['login', ['--server', 'https://api.example.invalid', 'OTHER']],
    ['login', ['--server', 'https://api.example.invalid', '--server', 'https://other.example.invalid']],
    ['login:status', ['--credntials', 'OTHER']],
    ['login:status', ['--format', 'json']],
    ['login:status', ['OTHER']],
  ])('%s %j does nothing and calls no server', async (command, args) => {
    const argv = [command, ...args.map((arg) => arg.replace('OTHER', otherPath))];
    const out = capture();
    expect(await runCli(argv, out.io as never)).toBe(1);
    expect(out.stderr()).toContain('何も変えずに止めました');
    expect(out.stdout()).toBe('');
    await bothFilesKept();
  });

  it('login:status still reads the login it was pointed at', async () => {
    const out = capture();
    expect(await runCli(['login:status', '--credentials', otherPath], out.io as never)).toBe(0);
    expect(out.stdout()).toContain('https://api.example.invalid');
  });

  it('--help is still answered for every login command', async () => {
    for (const command of ['login', 'login:status', 'logout']) {
      const out = capture();
      expect(await runCli([command, '--help'], out.io as never)).toBe(0);
    }
    await bothFilesKept();
  });
});
