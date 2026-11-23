// A login never replaces a file that is not a saved login, a lock is never
// taken from a file that is not a lock, the work under a lock stays on the
// file it locked, and a FIFO at a saved-login or lock path never makes a
// command wait (UNS-656 plan B PR2, review round 10). Every value here is a
// fake made up in this file.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIALS_SCHEMA_VERSION,
  getAccessToken,
  loginWithDeviceCode,
  readCredentials,
  removeCredentials,
  withCredentialsLock,
  writeCredentials,
  type BrainbaseCredentials,
} from '../src/brainbase-login.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-r10-'));
  dirs.push(dir);
  return dir;
}

const NOW = Date.parse('2026-11-21T03:00:00Z');

function jwt(expSeconds: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'fake-person', exp: expSeconds })}.fake-signature`;
}

function saved(overrides: Partial<BrainbaseCredentials> = {}): BrainbaseCredentials {
  return {
    schema_version: CREDENTIALS_SCHEMA_VERSION,
    login_id: 'fake-login-id',
    server_url: 'https://api.example.invalid',
    access_token: jwt(NOW / 1000 + 3600),
    refresh_token: 'fake-refresh-token',
    expires_at: new Date(NOW + 3600_000).toISOString(),
    ...overrides,
  } as BrainbaseCredentials;
}

const neverCalled = (async () => { throw new Error('the server must not be called'); }) as typeof fetch;

const OTHER_FILE = '{"theme":"dark","note":"fake settings of another tool"}\n';

/** A device-flow server that approves at once; `onToken` runs right before the token is handed out. */
function approvingServer(onToken: () => Promise<void> = async () => undefined): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/api/auth/device/code')) {
      return json(200, { device_code: 'fake-device-code', verification_uri: 'https://example.invalid/device', expires_in: 300, interval: 1 });
    }
    if (url.endsWith('/api/auth/device/token')) {
      await onToken();
      return json(200, { access_token: jwt(NOW / 1000 + 3600), refresh_token: 'fake-new-refresh' });
    }
    return json(200, {});
  }) as typeof fetch;
}

function login(path: string, fetchImpl: typeof fetch) {
  return loginWithDeviceCode({
    serverUrl: 'https://api.example.invalid',
    credentialsPath: path,
    fetch: fetchImpl,
    onPrompt: () => undefined,
    now: () => NOW,
    sleep: async () => undefined,
  } as never);
}

function mkfifo(path: string): void {
  const result = spawnSync('mkfifo', [path]);
  if (result.status !== 0) throw new Error(`mkfifo failed: ${result.stderr}`);
}

async function makeOld(path: string): Promise<void> {
  const old = new Date(Date.now() - 3600_000);
  await utimes(path, old, old);
}

describe('a login never replaces a file that is not a saved login', () => {
  it('refuses before the server is asked anything', async () => {
    const path = join(await root(), 'settings.json');
    await writeFile(path, OTHER_FILE);
    await expect(login(path, neverCalled)).rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(OTHER_FILE);
  });

  it('refuses at the save when the file appeared during the approval', async () => {
    const path = join(await root(), 'credentials.json');
    await expect(login(path, approvingServer(() => writeFile(path, OTHER_FILE))))
      .rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(OTHER_FILE);
  });

  it('refuses a direct save over such a file, with or without the lock', async () => {
    const path = join(await root(), 'settings.json');
    await writeFile(path, OTHER_FILE);
    await expect(writeCredentials(path, saved())).rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    await expect(withCredentialsLock(path, (lock) => writeCredentials(path, saved(), { lock })))
      .rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(OTHER_FILE);
  });

  it('still logs in again over a saved login, even an unusable one', async () => {
    const path = join(await root(), 'credentials.json');
    await writeFile(path, JSON.stringify({ schema_version: CREDENTIALS_SCHEMA_VERSION, broken: true }));
    const credentials = await login(path, approvingServer());
    expect(await readCredentials(path)).toEqual(credentials);
    const again = await login(path, approvingServer());
    expect(again.login_id).not.toBe(credentials.login_id);
    expect(await readCredentials(path)).toEqual(again);
  });

  it('does not save over another login\'s lock when the path names it', async () => {
    const dir = await root();
    const lockOfOther = join(dir, 'credentials.json.lock');
    await withCredentialsLock(join(dir, 'credentials.json'), async () => {
      const held = await readFile(lockOfOther, 'utf8');
      // A saved login may not be at a lock's name at all (review round 15).
      await expect(writeCredentials(lockOfOther, saved())).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
      expect(await readFile(lockOfOther, 'utf8')).toBe(held);
    });
  });
});

describe('a file that is not a lock record is never taken as a stale lock', () => {
  it('is left as it is however old, and the command stops at once with login_busy', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeFile(`${path}.lock`, OTHER_FILE);
    await makeOld(`${path}.lock`);
    const started = Date.now();
    await expect(withCredentialsLock(path, async () => 'ran')).rejects.toMatchObject({
      code: 'login_busy', message: expect.stringContaining('not a brainbase lock'),
    });
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(login(path, neverCalled)).rejects.toMatchObject({ code: 'login_busy' });
    expect(await readFile(`${path}.lock`, 'utf8')).toBe(OTHER_FILE);
  });

  it('keeps another account\'s saved login that sits where the lock goes', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-a' }));
    const other = `${path}.lock`;
    // Put there by hand: brainbase itself refuses to save a login at a lock's name.
    await writeFile(other, `${JSON.stringify(saved({ login_id: 'fake-login-b' }), null, 2)}\n`);
    await makeOld(other);
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_busy' });
    await expect(getAccessToken({ credentialsPath: path, now: () => NOW + 7200_000, fetch: neverCalled }))
      .rejects.toMatchObject({ code: 'login_busy' });
    expect(JSON.parse(await readFile(other, 'utf8')).login_id).toBe('fake-login-b');
    expect((await readCredentials(path))?.login_id).toBe('fake-login-a');
  });
});

describe('the work under a lock stays on the file it locked', () => {
  /** dir/link -> dir/a, each of a and b holding a saved login of its own. */
  async function swappable() {
    const dir = await root();
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeCredentials(join(dir, 'a', 'credentials.json'), saved({ login_id: 'fake-login-a' }));
    await writeCredentials(join(dir, 'b', 'credentials.json'), saved({ login_id: 'fake-login-b' }));
    await symlink(join(dir, 'a'), join(dir, 'link'));
    const swap = async () => {
      await symlink(join(dir, 'b'), join(dir, 'link.next'));
      await rename(join(dir, 'link.next'), join(dir, 'link'));
    };
    return { dir, path: join(dir, 'link', 'credentials.json'), swap };
  }

  it('refuses to save once the parent link leads elsewhere, and writes neither file', async () => {
    const { dir, path, swap } = await swappable();
    await expect(withCredentialsLock(path, async (lock) => {
      expect(lock.target).toBe(join(await import('node:fs/promises').then((fs) => fs.realpath(dir)), 'a', 'credentials.json'));
      await swap();
      await writeCredentials(path, saved({ login_id: 'fake-login-late' }), { lock });
    })).rejects.toMatchObject({ code: 'login_changed' });
    expect((await readCredentials(join(dir, 'a', 'credentials.json')))?.login_id).toBe('fake-login-a');
    expect((await readCredentials(join(dir, 'b', 'credentials.json')))?.login_id).toBe('fake-login-b');
    expect((await readdir(join(dir, 'b'))).sort()).toEqual(['credentials.json']);
  });

  it('a folder on the locked path replaced by a link is caught too', async () => {
    const dir = await root();
    await mkdir(join(dir, 'a'));
    await mkdir(join(dir, 'b'));
    await writeCredentials(join(dir, 'b', 'credentials.json'), saved({ login_id: 'fake-login-b' }));
    const path = join(dir, 'a', 'credentials.json');
    await expect(withCredentialsLock(path, async (lock) => {
      await rename(join(dir, 'a'), join(dir, 'a.moved'));
      await symlink(join(dir, 'b'), join(dir, 'a'));
      await writeCredentials(path, saved({ login_id: 'fake-login-late' }), { lock });
    })).rejects.toMatchObject({ code: /^login_(changed|lock_lost)$/ });
    expect((await readCredentials(join(dir, 'b', 'credentials.json')))?.login_id).toBe('fake-login-b');
  });
});

describe('a FIFO never makes a command wait', () => {
  it('at the saved-login path: read, renew, save, logout and login refuse it at once', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    mkfifo(path);
    await expect(readCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    await expect(getAccessToken({ credentialsPath: path, fetch: neverCalled })).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    await expect(writeCredentials(path, saved())).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    await expect(login(path, neverCalled)).rejects.toMatchObject({ code: 'login_credentials_path_invalid' });
    expect((await stat(path)).isFIFO()).toBe(true);
    // Logout released its lock.
    expect((await readdir(dir)).sort()).toEqual(['credentials.json']);
  }, 10_000);

  it('at the lock path: the command stops with login_busy and leaves it there', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    mkfifo(`${path}.lock`);
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_busy' });
    await expect(withCredentialsLock(path, async () => 'ran')).rejects.toMatchObject({ code: 'login_busy' });
    expect((await stat(`${path}.lock`)).isFIFO()).toBe(true);
    expect(await readCredentials(path)).not.toBeNull();
  }, 10_000);
});
