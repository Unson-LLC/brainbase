import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIALS_SCHEMA_VERSION,
  getAccessToken,
  loginWithDeviceCode,
  normalizeServerUrl,
  readCredentials,
  removeCredentials,
  writeCredentials,
  type BrainbaseCredentials,
} from '../src/brainbase-login.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function credentialsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-'));
  dirs.push(dir);
  return join(dir, 'nested', 'credentials.json');
}

function jwt(expSeconds: number, sub = 'person-1'): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub, exp: expSeconds })}.signature`;
}

interface Call { url: string; body: Record<string, unknown> }

function fakeServer(routes: Record<string, Array<{ status: number; body: unknown } | Error>>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    const path = new URL(url).pathname;
    const queue = routes[path];
    const next = queue && queue.length > 1 ? queue.shift()! : queue?.[0];
    if (!next) return new Response('{}', { status: 404 });
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const NOW = Date.parse('2026-11-21T03:00:00Z');

describe('normalizeServerUrl', () => {
  it('keeps only the origin of an https server', () => {
    expect(normalizeServerUrl(' https://api.example.net/some/path ')).toBe('https://api.example.net');
  });
  it('allows http only for loopback', () => {
    expect(normalizeServerUrl('http://127.0.0.1:31013')).toBe('http://127.0.0.1:31013');
    expect(() => normalizeServerUrl('http://api.example.net')).toThrow(/https/);
  });
  it('rejects credentials in the URL and non-URLs', () => {
    expect(() => normalizeServerUrl('https://user:pw@api.example.net')).toThrow();
    expect(() => normalizeServerUrl('not a url')).toThrow();
  });
});

describe('loginWithDeviceCode', () => {
  it('asks for a receipt, polls with the verifier, stores the token privately, then acknowledges it', async () => {
    const path = await credentialsFile();
    const access = jwt(NOW / 1000 + 3600);
    const { fetchImpl, calls } = fakeServer({
      '/api/auth/device/code': [{ status: 200, body: {
        device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://app.example.net/device',
        verification_uri_complete: 'https://app.example.net/device?code=ABCD-EFGH', expires_in: 600, interval: 1,
        receipt_required: true,
      } }],
      '/api/auth/device/token': [
        { status: 400, body: { error: 'authorization_pending' } },
        { status: 200, body: { access_token: access, refresh_token: 'refresh-1', expires_in: 3600, receipt_token: 'receipt-1' } },
      ],
      '/api/auth/device/received': [{ status: 200, body: { ok: true } }],
    });
    const prompts: unknown[] = [];
    let waits = 0;
    const credentials = await loginWithDeviceCode({
      serverUrl: 'https://api.example.net/', credentialsPath: path, fetch: fetchImpl, now: () => NOW,
      sleep: async () => {}, onPrompt: (prompt) => prompts.push(prompt), onWaiting: () => { waits += 1; },
    });

    expect(prompts).toEqual([{
      verificationUri: 'https://app.example.net/device',
      verificationUriComplete: 'https://app.example.net/device?code=ABCD-EFGH',
      userCode: 'ABCD-EFGH', expiresInSeconds: 600,
    }]);
    expect(waits).toBe(1);
    const [start, poll1, poll2, ack] = calls;
    expect(start.url).toBe('https://api.example.net/api/auth/device/code');
    expect(start.body.receipt_required).toBe(true);
    expect(typeof start.body.code_verifier).toBe('string');
    expect(poll1.body).toEqual({ device_code: 'dev-1', code_verifier: start.body.code_verifier });
    expect(poll2.body).toEqual(poll1.body);
    expect(ack).toEqual({ url: 'https://api.example.net/api/auth/device/received', body: { device_code: 'dev-1', receipt_token: 'receipt-1' } });

    expect(credentials).toEqual({
      schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: expect.stringMatching(/^[0-9a-f]{32}$/u), server_url: 'https://api.example.net',
      access_token: access, refresh_token: 'refresh-1', expires_at: new Date(NOW + 3600_000).toISOString(),
    });
    expect(await readCredentials(path)).toEqual(credentials);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('receipt_token');
  });

  for (const [error, code] of [['access_denied', 'login_denied'], ['expired_token', 'login_expired'], ['invalid_grant', 'login_invalid_grant']] as const) {
    it(`saves nothing when the server answers ${error}`, async () => {
      const path = await credentialsFile();
      const { fetchImpl } = fakeServer({
        '/api/auth/device/code': [{ status: 200, body: { device_code: 'dev-1', verification_uri: 'https://x.example/d', expires_in: 60, interval: 1 } }],
        '/api/auth/device/token': [{ status: 400, body: { error } }],
      });
      await expect(loginWithDeviceCode({
        serverUrl: 'https://api.example.net', credentialsPath: path, fetch: fetchImpl, now: () => NOW,
        sleep: async () => {}, onPrompt: () => {},
      })).rejects.toMatchObject({ code });
      expect(await readCredentials(path)).toBeNull();
    });
  }

  it('stores the login before the receipt goes out, and retries a passing server error while polling', async () => {
    const path = await credentialsFile();
    const access = jwt(NOW / 1000 + 3600);
    let storedAtReceipt: unknown = 'not called';
    const base = fakeServer({
      '/api/auth/device/code': [{ status: 200, body: { device_code: 'dev-1', verification_uri: 'https://x.example/d', expires_in: 60, interval: 1 } }],
      '/api/auth/device/token': [
        { status: 500, body: { error: 'server_error' } },
        { status: 200, body: { access_token: access, refresh_token: 'refresh-1', receipt_token: 'receipt-1' } },
      ],
      '/api/auth/device/received': [{ status: 200, body: { ok: true } }],
    });
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/auth/device/received')) {
        storedAtReceipt = (await readCredentials(path))?.access_token;
      }
      return base.fetchImpl(input, init);
    }) as typeof fetch;
    const credentials = await loginWithDeviceCode({
      serverUrl: 'https://api.example.net', credentialsPath: path, fetch: fetchImpl, now: () => NOW,
      sleep: async () => {}, onPrompt: () => {},
    });
    expect(credentials.access_token).toBe(access);
    expect(storedAtReceipt).toBe(access);
  });

  it('says terminal login is unavailable on a server without the device flow', async () => {
    const { fetchImpl } = fakeServer({});
    await expect(loginWithDeviceCode({
      serverUrl: 'https://api.example.net', credentialsPath: await credentialsFile(), fetch: fetchImpl,
      sleep: async () => {}, onPrompt: () => {},
    })).rejects.toMatchObject({ code: 'login_device_flow_unavailable' });
  });

  it('times out when nobody approves before the code expires', async () => {
    let clock = NOW;
    const { fetchImpl } = fakeServer({
      '/api/auth/device/code': [{ status: 200, body: { device_code: 'dev-1', verification_uri: 'https://x.example/d', expires_in: 10, interval: 5 } }],
      '/api/auth/device/token': [{ status: 400, body: { error: 'authorization_pending' } }],
    });
    await expect(loginWithDeviceCode({
      serverUrl: 'https://api.example.net', credentialsPath: await credentialsFile(), fetch: fetchImpl,
      now: () => clock, sleep: async (ms) => { clock += ms; }, onPrompt: () => {},
    })).rejects.toMatchObject({ code: 'login_timeout' });
  });
});

describe('getAccessToken', () => {
  async function saved(overrides: Partial<BrainbaseCredentials> = {}): Promise<string> {
    const path = await credentialsFile();
    await writeCredentials(path, {
      schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-1', server_url: 'https://api.example.net',
      access_token: 'old-access', refresh_token: 'refresh-1', expires_at: new Date(NOW + 3600_000).toISOString(),
      ...overrides,
    });
    return path;
  }

  it('returns the stored token while it is valid, without calling the server', async () => {
    const path = await saved();
    const { fetchImpl, calls } = fakeServer({});
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .toEqual({ token: 'old-access', serverUrl: 'https://api.example.net' });
    expect(calls).toEqual([]);
  });

  it('renews a token that is about to expire and stores the rotated refresh token', async () => {
    const path = await saved({ expires_at: new Date(NOW + 30_000).toISOString() });
    const fresh = jwt(NOW / 1000 + 3600);
    const { fetchImpl, calls } = fakeServer({
      '/api/auth/refresh': [{ status: 200, body: { token: fresh, refresh_token: 'refresh-2' } }],
    });
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .toEqual({ token: fresh, serverUrl: 'https://api.example.net' });
    expect(calls).toEqual([{ url: 'https://api.example.net/api/auth/refresh', body: { refresh_token: 'refresh-1' } }]);
    expect(await readCredentials(path)).toMatchObject({
      access_token: fresh, refresh_token: 'refresh-2', expires_at: new Date(NOW + 3600_000).toISOString(),
    });
  });

  it('asks for a new login when the refresh is refused', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const { fetchImpl } = fakeServer({ '/api/auth/refresh': [{ status: 401, body: { error: 'Refresh failed' } }] });
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_expired' });
  });

  it('reports a retryable failure when the server cannot renew right now', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const { fetchImpl } = fakeServer({ '/api/auth/refresh': [{ status: 503, body: { error: 'Session check unavailable' } }] });
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_refresh_unavailable' });
  });

  it('does not bring back a login that was logged out while the renewal was in flight', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const fresh = jwt(NOW / 1000 + 3600);
    const fetchImpl = (async () => {
      await removeCredentials(path);
      return new Response(JSON.stringify({ token: fresh, refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await readCredentials(path)).toBeNull();
  });

  it('does not overwrite another login made while the renewal was in flight, nor hand out its token', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const other: BrainbaseCredentials = {
      schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-2', server_url: 'https://api.example.net',
      access_token: 'other-person', refresh_token: 'refresh-x', expires_at: new Date(NOW + 3600_000).toISOString(),
    };
    const fetchImpl = (async () => {
      await writeCredentials(path, other);
      return new Response(JSON.stringify({ token: jwt(NOW / 1000 + 3600), refresh_token: 'refresh-2' }), { status: 200 });
    }) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await readCredentials(path)).toEqual(other);
  });

  it('after a failed renewal, ignores a fresh token that belongs to another login', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const fetchImpl = (async () => {
      await writeCredentials(path, {
        schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-2', server_url: 'https://api.example.net',
        access_token: 'other-person', refresh_token: 'refresh-x', expires_at: new Date(NOW + 3600_000).toISOString(),
      });
      return new Response(JSON.stringify({ error: 'Refresh failed' }), { status: 401 });
    }) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_expired' });
  });

  it('refuses a saved server that would send the refresh token over plain http', async () => {
    const path = await saved({ server_url: 'http://api.example.net', expires_at: new Date(NOW - 1000).toISOString() });
    const { fetchImpl, calls } = fakeServer({});
    await expect(getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .rejects.toMatchObject({ code: 'login_credentials_invalid' });
    expect(calls).toEqual([]);
  });

  it('uses a token without a refresh token until it actually expires', async () => {
    const path = await saved({ refresh_token: undefined, expires_at: new Date(NOW + 30_000).toISOString() });
    expect(await getAccessToken({ credentialsPath: path, now: () => NOW })).toMatchObject({ token: 'old-access' });
    await expect(getAccessToken({ credentialsPath: path, now: () => NOW + 31_000 }))
      .rejects.toMatchObject({ code: 'login_expired' });
  });

  it('uses a token another process stored while this one failed to renew', async () => {
    const path = await saved({ expires_at: new Date(NOW - 1000).toISOString() });
    const fetchImpl = (async () => {
      await writeCredentials(path, {
        schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-1', server_url: 'https://api.example.net',
        access_token: 'other-process', refresh_token: 'refresh-2', expires_at: new Date(NOW + 3600_000).toISOString(),
      });
      return new Response(JSON.stringify({ error: 'Refresh failed' }), { status: 401 });
    }) as typeof fetch;
    expect(await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW }))
      .toEqual({ token: 'other-process', serverUrl: 'https://api.example.net' });
  });

  it('fails with login_missing when nobody logged in, and on an unusable file', async () => {
    const path = await credentialsFile();
    await expect(getAccessToken({ credentialsPath: path })).rejects.toMatchObject({ code: 'login_missing' });
    await writeCredentials(path, { schema_version: 'other' } as unknown as BrainbaseCredentials);
    await expect(getAccessToken({ credentialsPath: path })).rejects.toMatchObject({ code: 'login_credentials_invalid' });
  });
});

describe('login CLI', () => {
  function capture() {
    let stdout = '';
    let stderr = '';
    return {
      io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
      stdout: () => stdout, stderr: () => stderr,
    };
  }

  it('shows the saved login without printing the token, and logout removes it', async () => {
    const path = await credentialsFile();
    await writeCredentials(path, {
      schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'login-1', server_url: 'https://api.example.net',
      access_token: 'secret-access', refresh_token: 'secret-refresh', expires_at: '2099-01-01T00:00:00.000Z',
    });
    const status = capture();
    expect(await runCli(['login:status', '--credentials', path], status.io)).toBe(0);
    expect(status.stdout()).toContain('https://api.example.net');
    expect(status.stdout()).not.toContain('secret');

    const out = capture();
    expect(await runCli(['logout', '--credentials', path], out.io)).toBe(0);
    expect(await readCredentials(path)).toBeNull();
    expect(await removeCredentials(path)).toBe(false);

    const after = capture();
    expect(await runCli(['login:status', '--credentials', path], after.io)).toBe(1);
  });

  it('requires a server on the first login', async () => {
    const path = await credentialsFile();
    const out = capture();
    expect(await runCli(['login', '--credentials', path], out.io)).toBe(1);
    expect(out.stderr()).toContain('--server');
  });

  it('refuses an unsafe server before sending anything', async () => {
    const path = await credentialsFile();
    const out = capture();
    expect(await runCli(['login', '--server', 'http://api.example.net', '--credentials', path], out.io)).toBe(1);
    expect(out.stderr()).toContain('https');
  });
});
