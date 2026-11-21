import * as realFs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Directory fsync is made to fail on demand, to check that the receipt (which
// makes the server stop handing out the token) only goes out once the saved
// login is known to be on disk.
const syncFailure: { code?: string; synced: string[] } = { synced: [] };

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open = async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    const info = await handle.stat();
    if (!info.isDirectory()) return handle;
    const path = String(args[0]);
    return new Proxy(handle, {
      get(target, key, receiver) {
        if (key === 'sync') {
          return async () => {
            syncFailure.synced.push(path);
            if (syncFailure.code) {
              throw Object.assign(new Error(`${syncFailure.code}: directory fsync`), { code: syncFailure.code });
            }
            return target.sync();
          };
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  return { ...actual, open, default: { ...actual, open } };
});

const { loginWithDeviceCode, readCredentials } = await import('../src/brainbase-login.js');

const dirs: string[] = [];
afterEach(async () => {
  syncFailure.code = undefined;
  syncFailure.synced = [];
  await Promise.all(dirs.splice(0).map((dir) => realFs.rm(dir, { recursive: true, force: true })));
});

const NOW = Date.parse('2026-11-21T03:00:00Z');

function jwt(expSeconds: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'person-1', exp: expSeconds })}.signature`;
}

async function run() {
  const root = await realFs.mkdtemp(join(tmpdir(), 'brainbase-login-sync-'));
  dirs.push(root);
  const path = join(root, 'a', 'b', 'credentials.json');
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(new URL(url).pathname);
    const pathname = new URL(url).pathname;
    const body = pathname === '/api/auth/device/code'
      ? { device_code: 'dev-1', verification_uri: 'https://x.example/d', expires_in: 60, interval: 1 }
      : pathname === '/api/auth/device/token'
        ? { access_token: jwt(NOW / 1000 + 3600), refresh_token: 'refresh-1', receipt_token: 'receipt-1' }
        : { ok: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const result = loginWithDeviceCode({
    serverUrl: 'https://api.example.net', credentialsPath: path, fetch: fetchImpl, now: () => NOW,
    sleep: async () => {}, onPrompt: () => {},
  });
  return { root, path, calls, result };
}

describe('receipt only after the login is durable', () => {
  it('flushes every directory it created, from the parent of the first one down', async () => {
    const { root, calls, result } = await run();
    await result;
    expect(syncFailure.synced).toEqual(expect.arrayContaining([root, join(root, 'a'), join(root, 'a', 'b')]));
    expect(calls).toContain('/api/auth/device/received');
  });

  it('sends no receipt and fails when flushing the directory hits an I/O error', async () => {
    syncFailure.code = 'EIO';
    const { calls, result } = await run();
    await expect(result).rejects.toMatchObject({ code: 'login_save_failed' });
    expect(calls).not.toContain('/api/auth/device/received');
  });

  it('keeps the login but sends no receipt where directories cannot be flushed', async () => {
    syncFailure.code = 'EINVAL';
    const { path, calls, result } = await run();
    const credentials = await result;
    expect(await readCredentials(path)).toEqual(credentials);
    expect(calls).not.toContain('/api/auth/device/received');
  });
});
