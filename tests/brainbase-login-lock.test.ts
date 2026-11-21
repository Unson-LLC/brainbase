import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  it('keeps the lock while the holder is still working, even past the stale age', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    const timing = { staleMs: 150, heartbeatMs: 20, waitMs: 3000 };
    const order: string[] = [];
    let second: Promise<void> | undefined;
    await withCredentialsLock(path, async () => {
      // Looks abandoned: the last touch was an hour ago. The holder's heartbeat
      // must refresh it before anyone treats it as stale.
      const old = new Date(Date.now() - 3600_000);
      await utimes(lockPath, old, old);
      await delay(80);
      second = withCredentialsLock(path, async () => { order.push('second'); }, timing);
      await delay(400);
      order.push('first-done');
    }, timing);
    await second;
    expect(order).toEqual(['first-done', 'second']);
  });

  it('takes over a lock left by a process that died', async () => {
    const path = await credentialsFile();
    const lockPath = `${path}.lock`;
    await writeFile(lockPath, 'dead-process');
    const old = new Date(Date.now() - 3600_000);
    await utimes(lockPath, old, old);
    expect(await withCredentialsLock(path, async () => 'ran', { staleMs: 150, heartbeatMs: 20, waitMs: 2000 })).toBe('ran');
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
    let logout: Promise<boolean> | undefined;
    const fetchImpl = (async () => {
      logout = removeCredentials(path);
      await delay(50);
      return new Response(JSON.stringify({ token: fresh, refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW })).toMatchObject({ token: fresh });
    expect(await logout).toBe(true);
    expect(await readCredentials(path)).toBeNull();
  });

  it('a login during a renewal waits for it and then stays', async () => {
    const path = await credentialsFile();
    await writeCredentials(path, login());
    const other = login({ login_id: 'login-2', access_token: 'other-person', refresh_token: 'refresh-x',
      expires_at: new Date(NOW + 3600_000).toISOString() });
    let second: Promise<unknown> | undefined;
    const fetchImpl = (async () => {
      second = withCredentialsLock(path, (lock) => writeCredentials(path, other, { lock }));
      await delay(50);
      return new Response(JSON.stringify({ token: jwt(NOW / 1000 + 3600), refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW });
    await second;
    expect(await readCredentials(path)).toEqual(other);
  });
});
