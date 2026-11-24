// A save never overwrites a file another program puts at the saved-login path
// after it was checked, and a lock is only taken over when the file at the
// lock path is a brainbase lock record in its exact form (UNS-656 plan B PR2,
// review round 11). Every value here is a fake made up in this file.
import * as realFs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Runs `race` once, right when the save opens its temporary file: after the
// saved-login path was checked and before the file is put in place.
const hooks: { race?: () => Promise<void> } = {};

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = async (...args: Parameters<typeof actual.open>) => {
    if (String(args[0]).endsWith('.tmp') && args[1] === 'wx' && hooks.race) {
      const race = hooks.race;
      hooks.race = undefined;
      await race();
    }
    return actual.open(...args);
  };
  return { ...actual, open, default: { ...actual, open } };
});

const {
  CREDENTIALS_SCHEMA_VERSION, loginWithDeviceCode, readCredentials, withCredentialsLock, writeCredentials,
} = await import('../src/brainbase-login.js');
type BrainbaseCredentials = import('../src/brainbase-login.js').BrainbaseCredentials;

const dirs: string[] = [];
afterEach(async () => {
  hooks.race = undefined;
  await Promise.all(dirs.splice(0).map((dir) => realFs.rm(dir, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await realFs.mkdtemp(join(tmpdir(), 'brainbase-login-r11-'));
  dirs.push(dir);
  return dir;
}

const NOW = Date.parse('2026-11-21T03:00:00Z');
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

function approvingServer(): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/api/auth/device/code')) {
      return json(200, { device_code: 'fake-device-code', verification_uri: 'https://example.invalid/device', expires_in: 300, interval: 1 });
    }
    if (url.endsWith('/api/auth/device/token')) {
      return json(200, { access_token: jwt(NOW / 1000 + 3600), refresh_token: 'fake-new-refresh' });
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
  } as never);
}

async function leftovers(dir: string): Promise<string[]> {
  return (await realFs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
}

describe('a save does not overwrite a file created or swapped in after the check', () => {
  it('first save: a file another program creates meanwhile is kept (login, under the lock)', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    hooks.race = () => realFs.writeFile(path, OTHER_FILE);
    await expect(login(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('first save: the same holds for a direct save, with or without the lock', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    hooks.race = () => realFs.writeFile(path, OTHER_FILE);
    await expect(writeCredentials(path, saved())).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    await realFs.rm(path);
    hooks.race = () => realFs.writeFile(path, OTHER_FILE);
    await expect(withCredentialsLock(path, (lock) => writeCredentials(path, saved(), { lock })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('update: a saved login swapped for another file meanwhile is not replaced', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-old' }));
    hooks.race = async () => {
      await realFs.writeFile(`${path}.other`, OTHER_FILE);
      await realFs.rename(`${path}.other`, path);
    };
    await expect(withCredentialsLock(path, (lock) => writeCredentials(path, saved({ login_id: 'fake-login-new' }), { lock })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('update: a saved login rewritten in place meanwhile is not replaced either', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved({ login_id: 'fake-login-old' }));
    hooks.race = () => realFs.writeFile(path, OTHER_FILE);
    await expect(writeCredentials(path, saved({ login_id: 'fake-login-new' }))).rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
  });

  it('without a race, the first save and the update still go through', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await withCredentialsLock(path, (lock) => writeCredentials(path, saved({ login_id: 'fake-login-1' }), { lock }));
    expect((await readCredentials(path))?.login_id).toBe('fake-login-1');
    expect(((await realFs.stat(path)).mode & 0o777)).toBe(0o600);
    await withCredentialsLock(path, (lock) => writeCredentials(path, saved({ login_id: 'fake-login-2' }), { lock }));
    expect((await readCredentials(path))?.login_id).toBe('fake-login-2');
    expect((await realFs.stat(path)).nlink).toBe(1);
    expect(await leftovers(dir)).toEqual([]);
  });
});

/** The process id of a process that has already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid!;
}

async function makeOld(path: string): Promise<void> {
  const old = new Date(Date.now() - 3600_000);
  await realFs.utimes(path, old, old);
}

describe('only a brainbase lock record is ever taken over', () => {
  const lookAlikes: Array<[string, () => string]> = [
    ['another tool\'s process record (owner, pid, host of a process that is gone)',
      () => JSON.stringify({ owner: 'other-tool', pid: deadPid(), host: hostname() })],
    ['a record without the brainbase format, even with a 32-hex owner',
      () => JSON.stringify({ owner: 'a'.repeat(32), pid: deadPid(), host: hostname() })],
    ['another format',
      () => JSON.stringify({ format: 'other-lock/v1', owner: 'a'.repeat(32), pid: deadPid(), host: hostname() })],
    ['the brainbase format with a field brainbase does not write',
      () => JSON.stringify({ format: 'brainbase-login-lock/v1', owner: 'a'.repeat(32), pid: deadPid(), host: hostname(), note: 'kept' })],
    ['the brainbase format with an owner brainbase does not write',
      () => JSON.stringify({ format: 'brainbase-login-lock/v1', owner: 'not-hex', pid: deadPid(), host: hostname() })],
    ['the brainbase format, but not in the exact form brainbase writes',
      () => `${JSON.stringify({ format: 'brainbase-login-lock/v1', owner: 'a'.repeat(32), pid: deadPid(), host: hostname() }, null, 2)}\n`],
  ];

  it.each(lookAlikes)('%s is left as it is and the command stops with login_busy', async (_name, make) => {
    const path = join(await root(), 'credentials.json');
    const content = make();
    await realFs.writeFile(`${path}.lock`, content);
    await makeOld(`${path}.lock`);
    await expect(withCredentialsLock(path, async () => 'ran', { waitMs: 2000 }))
      .rejects.toMatchObject({ code: 'login_busy', message: expect.stringContaining('not a brainbase lock') });
    expect(await realFs.readFile(`${path}.lock`, 'utf8')).toBe(content);
  });

  it('a lock brainbase wrote, left by a process that is gone, is still taken over', async () => {
    const path = join(await root(), 'credentials.json');
    await realFs.writeFile(`${path}.lock`,
      JSON.stringify({ format: 'brainbase-login-lock/v1', owner: 'b'.repeat(32), pid: deadPid(), host: hostname() }));
    expect(await withCredentialsLock(path, async () => 'ran', { waitMs: 2000 })).toBe('ran');
  });

  it('the lock it writes carries the format', async () => {
    const path = join(await root(), 'credentials.json');
    await withCredentialsLock(path, async () => {
      const record = JSON.parse(await realFs.readFile(`${path}.lock`, 'utf8'));
      expect(record.format).toBe('brainbase-login-lock/v1');
      expect(record.owner).toMatch(/^[0-9a-f]{32}$/);
      expect(Object.keys(record).every((key) => ['format', 'owner', 'pid', 'host', 'start'].includes(key))).toBe(true);
    });
  });
});
