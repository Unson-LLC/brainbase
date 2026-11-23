// Logout removes only a saved brainbase login, and a saved login that is a
// symbolic link is refused by every operation (UNS-656 plan B PR2, review
// round 9). Every value here is a fake made up in this file.
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIALS_SCHEMA_VERSION,
  checkCredentialsStorage,
  getAccessToken,
  loginWithDeviceCode,
  readCredentials,
  removeCredentials,
  withCredentialsLock,
  writeCredentials,
  type BrainbaseCredentials,
} from '../src/brainbase-login.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await chmod(join(dir, 'unreadable.json'), 0o600).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-r9-'));
  dirs.push(dir);
  return dir;
}

const NOW = Date.parse('2026-11-21T03:00:00Z');

function jwt(expSeconds: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'fake-person', exp: expSeconds })}.fake-signature`;
}

const SAVED: BrainbaseCredentials = {
  schema_version: CREDENTIALS_SCHEMA_VERSION,
  login_id: 'fake-login-id',
  server_url: 'https://api.example.invalid',
  access_token: jwt(NOW / 1000 - 60),
  refresh_token: 'fake-refresh-token',
  expires_at: new Date(NOW - 60_000).toISOString(),
} as BrainbaseCredentials;

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (t: string) => { stdout += t; } }, stderr: { write: (t: string) => { stderr += t; } } },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

const neverCalled = (async () => { throw new Error('the server must not be called'); }) as typeof fetch;

describe('logout removes only a saved brainbase login', () => {
  it.each([
    ['another JSON file', '{\n  "theme": "dark"\n}\n'],
    ['a JSON file with a different schema', '{"schema_version":"some-other-tool-v1","access_token":"x"}'],
    ['a text file', 'export PATH=/usr/bin\n'],
    ['an empty file', ''],
  ])('leaves %s as it is and fails', async (_name, content) => {
    const path = join(await root(), 'settings.json');
    await writeFile(path, content);
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(content);

    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io as never)).toBe(1);
    expect(out.stderr()).toContain('not a saved brainbase login');
    expect(out.stdout()).not.toContain('消しました');
    expect(await readFile(path, 'utf8')).toBe(content);
  });

  it('leaves a file it cannot read as it is', async () => {
    if (process.getuid?.() === 0) return; // root reads mode 000 files.
    const dir = await root();
    const path = join(dir, 'unreadable.json');
    await writeFile(path, JSON.stringify(SAVED));
    await chmod(path, 0o000);
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_unreadable' });
    await chmod(path, 0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(SAVED);
  });

  it('leaves a folder at the saved-login path as it is', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await mkdir(path);
    await writeFile(join(path, 'keep.txt'), 'keep');
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    expect(await readdir(path)).toEqual(['keep.txt']);
  });

  it('still removes a saved login that brainbase wrote but that became unusable', async () => {
    const path = join(await root(), 'credentials.json');
    await writeFile(path, JSON.stringify({ schema_version: CREDENTIALS_SCHEMA_VERSION, server_url: 'https://api.example.invalid' }));
    await expect(readCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_invalid' });
    expect(await removeCredentials(path)).toMatchObject({ existed: true });
    expect(await readCredentials(path)).toBeNull();
  });

  it('removes a usable saved login and reports nothing there afterwards', async () => {
    const path = join(await root(), 'credentials.json');
    await writeCredentials(path, SAVED);
    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io as never)).toBe(0);
    expect(out.stdout()).toContain('消しました');
    expect(await removeCredentials(path)).toMatchObject({ existed: false });
  });
});

describe('a saved login that is a symbolic link', () => {
  async function linked() {
    const dir = await root();
    const real = join(dir, 'real-credentials.json');
    const path = join(dir, 'credentials.json');
    await writeFile(real, `${JSON.stringify(SAVED, null, 2)}\n`, { mode: 0o600 });
    await symlink(real, path);
    const before = await readFile(real, 'utf8');
    const unchanged = async () => {
      expect((await lstat(path)).isSymbolicLink()).toBe(true);
      expect(await readlink(path)).toBe(real);
      expect(await readFile(real, 'utf8')).toBe(before);
      expect((await readdir(dir)).sort()).toEqual(['credentials.json', 'real-credentials.json']);
    };
    return { dir, real, path, unchanged };
  }

  it('is not read', async () => {
    const { path, unchanged } = await linked();
    await expect(readCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await unchanged();
  });

  it('is not replaced by a save', async () => {
    const { path, unchanged } = await linked();
    await expect(writeCredentials(path, { ...SAVED, login_id: 'fake-other-login' })).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await unchanged();
  });

  it('is not removed by logout, so no copy of the tokens is left behind', async () => {
    const { path, unchanged } = await linked();
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io as never)).toBe(1);
    expect(out.stderr()).toContain('symbolic link');
    expect(out.stdout()).not.toContain('消しました');
    await unchanged();
  });

  it('is not renewed, so the refresh token is not rotated into a second file', async () => {
    const { path, unchanged } = await linked();
    await expect(getAccessToken({ credentialsPath: path, now: () => NOW, fetch: neverCalled }))
      .rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await unchanged();
  });

  it('stops a login before the server is asked anything', async () => {
    const { path, unchanged } = await linked();
    await expect(checkCredentialsStorage(path)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await expect(loginWithDeviceCode({
      serverUrl: 'https://api.example.invalid',
      credentialsPath: path,
      fetch: neverCalled,
      onPrompt: () => undefined,
      now: () => NOW,
      sleep: async () => undefined,
    } as never)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await unchanged();
  });

  it('takes no lock', async () => {
    const { path, unchanged } = await linked();
    await expect(withCredentialsLock(path, async () => 'ran')).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await unchanged();
  });

  it('is refused even when the link points at nothing', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await symlink(join(dir, 'missing.json'), path);
    await expect(readCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await expect(writeCredentials(path, SAVED)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_symlink' });
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readdir(dir)).toEqual(['credentials.json']);
  });
});
