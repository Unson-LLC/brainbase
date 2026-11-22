// The save after a browser approval goes to the file checked before it, every
// save runs under the lock, a renewal replaces only the login it renewed, and
// logout removes only the file it checked (UNS-656 plan B PR2, review round
// 12). Every value here is a fake made up in this file.
import * as realFs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each hook runs once, at the point named, then is cleared.
const hooks: {
  /** While the login waits for the browser (on its first token poll). */
  approval?: () => Promise<void>;
  /** Right before logout moves the checked file away. */
  beforeRemove?: () => Promise<void>;
  /** On the first read of a lock file (the lock check after logout's check). */
  lockRead?: () => Promise<void>;
} = {};

function once<K extends keyof typeof hooks>(key: K): (() => Promise<void>) | undefined {
  const hook = hooks[key];
  hooks[key] = undefined;
  return hook;
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = async (...args: Parameters<typeof actual.open>) => {
    if (String(args[0]).endsWith('.lock') && typeof args[1] === 'number') await once('lockRead')?.();
    return actual.open(...args);
  };
  const rename = async (...args: Parameters<typeof actual.rename>) => {
    if (String(args[1]).endsWith('.removing')) await once('beforeRemove')?.();
    return actual.rename(...args);
  };
  return { ...actual, open, rename, default: { ...actual, open, rename } };
});

const {
  CREDENTIALS_SCHEMA_VERSION, getAccessToken, loginWithDeviceCode, readCredentials, removeCredentials,
  withCredentialsLock, writeCredentials,
} = await import('../src/brainbase-login.js');
type BrainbaseCredentials = import('../src/brainbase-login.js').BrainbaseCredentials;

const dirs: string[] = [];
afterEach(async () => {
  for (const key of Object.keys(hooks) as (keyof typeof hooks)[]) hooks[key] = undefined;
  await Promise.all(dirs.splice(0).map((dir) => realFs.rm(dir, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await realFs.mkdtemp(join(tmpdir(), 'brainbase-login-r13-'));
  dirs.push(dir);
  return dir;
}

const NOW = Date.parse('2026-11-22T03:00:00Z');
const OTHER_FILE = '{"theme":"dark","note":"fake settings of another tool"}\n';

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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function approvingServer(): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/api/auth/device/code')) {
      return json(200, { device_code: 'fake-device-code', verification_uri: 'https://example.invalid/device', expires_in: 300, interval: 1 });
    }
    if (url.endsWith('/api/auth/device/token')) {
      await once('approval')?.();
      return json(200, { access_token: jwt(NOW / 1000 + 3600), refresh_token: 'fake-new-refresh', receipt_token: 'fake-receipt' });
    }
    return json(200, {});
  }) as typeof fetch;
}

function login(path: string) {
  return loginWithDeviceCode({
    serverUrl: 'https://api.example.invalid',
    credentialsPath: path,
    fetch: approvingServer(),
    onPrompt: () => undefined,
    now: () => NOW,
    sleep: async () => undefined,
  });
}

async function writeRaw(path: string, text: string): Promise<void> {
  await realFs.writeFile(`${path}.swap`, text);
  await realFs.rename(`${path}.swap`, path);
}

describe('must 1: the save after the approval goes to the file checked before it', () => {
  it('a parent link switched to another folder while waiting: the other folder\'s login stays', async () => {
    const dir = await root();
    await realFs.mkdir(join(dir, 'a'));
    await realFs.mkdir(join(dir, 'b'));
    const other = `${JSON.stringify(saved({ login_id: 'fake-login-of-b' }), null, 2)}\n`;
    await realFs.writeFile(join(dir, 'b', 'credentials.json'), other);
    await realFs.symlink(join(dir, 'a'), join(dir, 'home'));
    const path = join(dir, 'home', 'credentials.json');
    hooks.approval = async () => {
      await realFs.rm(join(dir, 'home'));
      await realFs.symlink(join(dir, 'b'), join(dir, 'home'));
    };
    await expect(login(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(join(dir, 'b', 'credentials.json'), 'utf8')).toBe(other);
    expect(await realFs.readdir(join(dir, 'a'))).toEqual([]);
  });

  it('the folder replaced by a new folder at the same real path while waiting: nothing is saved there', async () => {
    const dir = await root();
    await realFs.mkdir(join(dir, 'home'));
    const path = join(dir, 'home', 'credentials.json');
    hooks.approval = async () => {
      await realFs.rename(join(dir, 'home'), join(dir, 'home-old'));
      await realFs.mkdir(join(dir, 'home'));
    };
    await expect(login(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readdir(join(dir, 'home'))).toEqual([]);
  });

  it('another login saved at the same file while waiting is not overwritten', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    hooks.approval = async () => { await writeCredentials(path, saved({ login_id: 'fake-login-meanwhile' })); };
    await expect(login(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect((await readCredentials(path))?.login_id).toBe('fake-login-meanwhile');
  });

  it('a renewal of the login that was there while waiting does not stop the new login', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-before' }));
    hooks.approval = async () => {
      await writeCredentials(path, saved({ login_id: 'fake-login-before', access_token: jwt(NOW / 1000 + 7200) }));
    };
    const credentials = await login(path);
    expect((await readCredentials(path))?.login_id).toBe(credentials.login_id);
  });

  it('a lock taken for one path does not save into another', async () => {
    const dir = await root();
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    await expect(withCredentialsLock(a, (lock) => writeCredentials(b, saved(), { lock })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readdir(dir)).toEqual([]);
  });
});

describe('must 2: every save runs under the lock, and a renewal replaces only the login it renewed', () => {
  it('a save without a lock waits while another process holds the lock', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    let done = false;
    let save: Promise<unknown> | undefined;
    await withCredentialsLock(path, async () => {
      save = writeCredentials(path, saved({ login_id: 'fake-login-waiting' })).then(() => { done = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done).toBe(false);
      expect(await readCredentials(path)).toBeNull();
    });
    await save;
    expect((await readCredentials(path))?.login_id).toBe('fake-login-waiting');
  });

  it('a renewal does not write back over a login another program saved while the server answered', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-renewing', expires_at: new Date(NOW - 1000).toISOString() }));
    const other = `${JSON.stringify(saved({ login_id: 'fake-login-other' }), null, 2)}\n`;
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith('/api/csrf-token')) return json(404, {});
      // A program that does not use the lock saves another login meanwhile.
      await writeRaw(path, other);
      return json(200, { token: jwt(NOW / 1000 + 3600), refresh_token: 'fake-rotated' });
    }) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(other);
  });

  it('a renewal of the same login still writes back', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-renewing', expires_at: new Date(NOW - 1000).toISOString() }));
    const token = jwt(NOW / 1000 + 3600);
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith('/api/csrf-token')) return json(404, {});
      return json(200, { token, refresh_token: 'fake-rotated' });
    }) as typeof fetch;
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW })).toMatchObject({ token });
    expect(await readCredentials(path)).toMatchObject({ login_id: 'fake-login-renewing', refresh_token: 'fake-rotated' });
  });

  it('a direct save with an expected login refuses a file holding another one', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-there' }));
    await expect(withCredentialsLock(path, (lock) => writeCredentials(path, saved({ login_id: 'fake-login-new' }), { lock, expected: null })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect((await readCredentials(path))?.login_id).toBe('fake-login-there');
  });
});

describe('must 3: logout removes only the file it checked', () => {
  it('no file at the check: a file another program creates meanwhile stays', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    hooks.lockRead = () => realFs.writeFile(path, OTHER_FILE);
    expect(await removeCredentials(path)).toMatchObject({ existed: false });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
  });

  it('a saved login swapped for another file before the removal: that file is put back', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeRemove = () => writeRaw(path, OTHER_FILE);
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect((await realFs.readdir(dir)).filter((name) => name.endsWith('.removing'))).toEqual([]);
  });

  it('a saved login rewritten in place before the removal is put back too', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeRemove = () => realFs.appendFile(path, ' ');
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toMatch(/fake-login-id/u);
  });

  it('an unchanged saved login is removed', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    expect(await removeCredentials(path)).toMatchObject({ existed: true });
    expect(await realFs.readdir(dir)).toEqual([]);
  });
});
