import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIALS_SCHEMA_VERSION,
  getAccessToken,
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

async function credentialsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-lock-'));
  dirs.push(dir);
  return join(dir, 'credentials.json');
}

const NOW = Date.parse('2026-11-21T03:00:00Z');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The process id of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid!;
}

function lockFile(pid: number, host = hostname()): string {
  return JSON.stringify({ owner: `holder-${pid}`, pid, host });
}

async function makeOld(path: string): Promise<void> {
  const old = new Date(Date.now() - 3600_000);
  await utimes(path, old, old);
}

function jwt(expSeconds: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'person-1', exp: expSeconds })}.signature`;
}

function login(overrides: Partial<BrainbaseCredentials> = {}): BrainbaseCredentials {
  return {
    schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-1', server_url: 'https://api.example.net',
    access_token: 'old-access', refresh_token: 'refresh-1', expires_at: new Date(NOW - 1000).toISOString(),
    ...overrides,
  };
}

describe('withCredentialsLock', () => {
  it('keeps the lock while the holder is still working, however old the file looks', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    const timing = { unreadableStaleMs: 50, waitMs: 3000 };
    const order: string[] = [];
    let second: Promise<void> | undefined;
    await withCredentialsLock(path, async () => {
      await makeOld(lockPath);
      second = withCredentialsLock(path, async () => { order.push('second'); }, timing);
      await delay(400);
      order.push('first-done');
    }, timing);
    await second;
    expect(order).toEqual(['first-done', 'second']);
  });

  it('never takes over the lock of a process that still runs', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, lockFile(process.ppid));
    await makeOld(lockPath);
    await expect(withCredentialsLock(path, async () => 'ran', { unreadableStaleMs: 50, waitMs: 300 }))
      .rejects.toMatchObject({ code: 'login_busy' });
    expect(await readFile(lockPath, 'utf8')).toBe(lockFile(process.ppid));
  });

  it('never takes over a lock held from another machine, and says where it is held', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, lockFile(deadPid(), 'other-machine.example'));
    await makeOld(lockPath);
    await expect(withCredentialsLock(path, async () => 'ran', { waitMs: 300 }))
      .rejects.toMatchObject({ code: 'login_busy', message: expect.stringContaining('other-machine.example') });
  });

  it('takes over a lock left by a process that died', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, lockFile(deadPid()));
    expect(await withCredentialsLock(path, async () => 'ran', { waitMs: 2000 })).toBe('ran');
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('when many take over the same dead lock at once, one holds it at a time', async () => {
    for (let round = 0; round < 5; round += 1) {
      const path = await credentialsFile();
      await writeFile(`${path}.lock`, lockFile(deadPid()));
      await makeOld(`${path}.lock`);
      let active = 0;
      let most = 0;
      await Promise.all(Array.from({ length: 8 }, () => withCredentialsLock(path, async () => {
        active += 1;
        most = Math.max(most, active);
        await delay(15);
        active -= 1;
      }, { unreadableStaleMs: 0, waitMs: 5000 })));
      expect(most).toBe(1);
    }
  });

  it('a takeover left half-done by a process that died does not block the next one', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, lockFile(deadPid()));
    // A taker that died while holding the takeover lock for that same file.
    const { createHash } = await import('node:crypto');
    const observed = await readFile(lockPath, 'utf8');
    const guard = `${lockPath}.takeover-${createHash('sha256').update(observed).digest('hex').slice(0, 16)}`;
    await writeFile(guard, lockFile(deadPid()));
    expect(await withCredentialsLock(path, async () => 'ran', { waitMs: 2000 })).toBe('ran');
    await expect(readFile(guard, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases only its own lock, and refuses to write once the lock is no longer its own', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await expect(withCredentialsLock(path, async (lock) => {
      await writeFile(lockPath, 'another-process');
      await writeCredentials(path, login({ access_token: 'late-write' }), { lock });
    })).rejects.toMatchObject({ code: 'login_lock_lost' });
    expect(await readFile(lockPath, 'utf8')).toBe('another-process');
    expect(await readCredentials(path)).toBeNull();
  });
});

describe('renewal under the lock', () => {
  it('a renewal that waits for another one uses the token it stored, without calling the server', async () => {
    const path = await credentialsFile();
    await writeCredentials(path, login());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const holding = new Promise<void>((resolve) => { entered = resolve; });
    const other = withCredentialsLock(path, async (lock) => {
      entered();
      await gate;
      await writeCredentials(path, login({ access_token: 'other-process', refresh_token: 'refresh-2',
        expires_at: new Date(NOW + 3600_000).toISOString() }), { lock });
    });
    await holding;
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ error: 'Refresh failed' }), { status: 401 });
    }) as typeof fetch;
    const pending = getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW });
    await delay(50);
    release();
    await other;
    expect(await pending).toEqual({ token: 'other-process', serverUrl: 'https://api.example.net' });
    expect(calls).toEqual([]);
  });

  it('a logout during a renewal waits for it and then wins', async () => {
    const path = await credentialsFile();
    await writeCredentials(path, login());
    const fresh = jwt(NOW / 1000 + 3600);
    let logout: Promise<{ existed: boolean; durable: boolean }> | undefined;
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith('/api/csrf-token')) return new Response('{}', { status: 404 });
      logout = removeCredentials(path);
      await delay(50);
      return new Response(JSON.stringify({ token: fresh, refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW })).toMatchObject({ token: fresh });
    expect(await logout).toMatchObject({ existed: true });
    expect(await readCredentials(path)).toBeNull();
  });

  it('a login during a renewal waits for it and then stays', async () => {
    const path = await credentialsFile();
    await writeCredentials(path, login());
    const other = login({ login_id: 'login-2', access_token: 'other-person', refresh_token: 'refresh-x',
      expires_at: new Date(NOW + 3600_000).toISOString() });
    let second: Promise<unknown> | undefined;
    const fetchImpl = (async (input: string | URL) => {
      if (String(input).endsWith('/api/csrf-token')) return new Response('{}', { status: 404 });
      second = withCredentialsLock(path, (lock) => writeCredentials(path, other, { lock }));
      await delay(50);
      return new Response(JSON.stringify({ token: jwt(NOW / 1000 + 3600), refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW });
    await second;
    expect(await readCredentials(path)).toEqual(other);
  });
});
