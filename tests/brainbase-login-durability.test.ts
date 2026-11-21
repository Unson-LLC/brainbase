import * as realFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const { loginWithDeviceCode, readCredentials, removeCredentials, writeCredentials } = await import('../src/brainbase-login.js');
const { runCli } = await import('../src/cli.js');

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(async () => {
  process.chdir(startCwd);
  syncFailure.code = undefined;
  syncFailure.synced = [];
  await Promise.all(dirs.splice(0).map((dir) => realFs.rm(dir, { recursive: true, force: true })));
});

const NOW = Date.parse('2026-11-21T03:00:00Z');

function jwt(expSeconds: number): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'person-1', exp: expSeconds })}.signature`;
}

async function newRoot(): Promise<string> {
  const root = await realFs.mkdtemp(join(tmpdir(), 'brainbase-login-sync-'));
  dirs.push(root);
  return root;
}

async function run(existingRoot?: string) {
  const root = existingRoot ?? await newRoot();
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

  it('flushes the directories above it even when they already exist', async () => {
    const root = await newRoot();
    // Made a moment ago by another brainbase process, which has not flushed them yet.
    await realFs.mkdir(join(root, 'a', 'b'), { recursive: true });
    const { calls, result } = await run(root);
    await result;
    expect(syncFailure.synced).toEqual(expect.arrayContaining([join(root, 'a', 'b'), join(root, 'a'), root, dirname(root)]));
    expect(calls).toContain('/api/auth/device/received');
  });

  it('after a save whose flush failed, the next login flushes the directories it left before the receipt', async () => {
    syncFailure.code = 'EIO';
    const first = await run();
    await expect(first.result).rejects.toMatchObject({ code: 'login_save_failed' });
    syncFailure.code = undefined;
    syncFailure.synced = [];
    const second = await run(first.root);
    await second.result;
    expect(syncFailure.synced).toEqual(expect.arrayContaining([join(first.root, 'a'), first.root]));
    expect(second.calls).toContain('/api/auth/device/received');
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

const SAVED = {
  schema_version: 1,
  login_id: 'login-1',
  server_url: 'https://api.example.net',
  access_token: jwt(NOW / 1000 + 3600),
  expires_at: new Date(NOW + 3600_000).toISOString(),
} as const;

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (t: string) => { stdout += t; } }, stderr: { write: (t: string) => { stderr += t; } } },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('a relative save path', () => {
  it('flushes the directories above the working directory as well', async () => {
    const root = await newRoot();
    // A working directory made a moment ago: its own entry sits in root, unflushed.
    const work = join(root, 'work');
    await realFs.mkdir(work);
    process.chdir(work);
    const saved = await writeCredentials(join('a', 'b', 'credentials.json'), SAVED as never);
    expect(saved.durable).toBe(true);
    const realWork = await realFs.realpath(work);
    expect(syncFailure.synced).toEqual(expect.arrayContaining([
      join(realWork, 'a', 'b'), join(realWork, 'a'), realWork, dirname(realWork),
    ]));
  });

  it('sends the receipt only after the chain above the working directory is flushed', async () => {
    const root = await newRoot();
    const work = join(root, 'work');
    await realFs.mkdir(work);
    process.chdir(work);
    const calls: string[] = [];
    const syncedAtReceipt: string[][] = [];
    const fetchImpl = (async (input: string | URL) => {
      const pathname = new URL(String(input)).pathname;
      calls.push(pathname);
      if (pathname === '/api/auth/device/received') syncedAtReceipt.push([...syncFailure.synced]);
      const body = pathname === '/api/auth/device/code'
        ? { device_code: 'dev-1', verification_uri: 'https://x.example/d', expires_in: 60, interval: 1 }
        : pathname === '/api/auth/device/token'
          ? { access_token: jwt(NOW / 1000 + 3600), refresh_token: 'refresh-1', receipt_token: 'receipt-1' }
          : { ok: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    await loginWithDeviceCode({
      serverUrl: 'https://api.example.net', credentialsPath: join('a', 'credentials.json'), fetch: fetchImpl,
      now: () => NOW, sleep: async () => {}, onPrompt: () => {},
    });
    expect(calls).toContain('/api/auth/device/received');
    expect(syncedAtReceipt[0]).toContain(dirname(await realFs.realpath(work)));
  });
});

describe('logout is durable before it reports success', () => {
  async function saved(): Promise<string> {
    const path = join(await newRoot(), 'a', 'credentials.json');
    await writeCredentials(path, SAVED as never);
    syncFailure.synced = [];
    return path;
  }

  it('flushes the directory that held the login after removing it', async () => {
    const path = await saved();
    expect(await removeCredentials(path)).toEqual({ existed: true, durable: true });
    expect(await readCredentials(path)).toBeNull();
    expect(syncFailure.synced).toContain(dirname(path));
  });

  it('flushes the directory of a relative path by its absolute name', async () => {
    const path = await saved();
    process.chdir(dirname(path));
    expect(await removeCredentials('credentials.json')).toMatchObject({ existed: true, durable: true });
    expect(syncFailure.synced).toContain(await realFs.realpath(dirname(path)));
  });

  it('fails, and the CLI does not report a logout, when the flush hits an I/O error', async () => {
    const path = await saved();
    syncFailure.code = 'EIO';
    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'EIO' });

    await writeCredentials(path, SAVED as never).catch(() => undefined);
    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io as never)).toBe(1);
    expect(out.stdout()).not.toContain('消しました');
    expect(out.stderr()).toContain('EIO');
  });

  it('warns where the platform cannot flush the directory', async () => {
    const path = await saved();
    syncFailure.code = 'EINVAL';
    expect(await removeCredentials(path)).toEqual({ existed: true, durable: false });
    syncFailure.code = undefined;
    await writeCredentials(path, SAVED as never);
    syncFailure.code = 'EINVAL';
    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io as never)).toBe(0);
    expect(out.stderr()).toContain('電源が落ちると');
  });
});
