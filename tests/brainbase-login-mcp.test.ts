import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMcpClientName,
  CREDENTIALS_SCHEMA_VERSION,
  getAccessToken,
  loginWithDeviceCode,
  MCP_DEVICE_FLOW_CLIENT_ID,
  MCP_OAUTH_DEFAULT_SCOPE,
  normalizeMcpResourceUrl,
  normalizeMcpScope,
  normalizeMcpTenant,
  readCredentials,
  resolveMcpLoginConfig,
  writeCredentials,
  type BrainbaseCredentials,
} from '../src/brainbase-login.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function credentialsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-mcp-'));
  dirs.push(dir);
  return join(dir, 'nested', 'credentials.json');
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function jwt(expSeconds: number, sub = 'person-1'): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub, exp: expSeconds })}.signature`;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function startMockServer(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void | Promise<void>,
): Promise<{ origin: string }> {
  const server = createServer(async (req, res) => {
    try {
      const body = await readRequestBody(req);
      await handler(req, body, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind mock server');
  return { origin: `http://127.0.0.1:${address.port}` };
}

const NOW = Date.parse('2026-11-24T00:00:00Z');

describe('MCP login validation helpers', () => {
  it('accepts valid tenant slugs and canonical tenant ids, and rejects malformed values', () => {
    expect(normalizeMcpTenant('acme')).toBe('acme');
    expect(normalizeMcpTenant('ten_01abc-xyz')).toBe('ten_01abc-xyz');
    expect(normalizeMcpTenant('a')).toBe('a');
    expect(normalizeMcpTenant('a'.repeat(64))).toBe('a'.repeat(64));

    for (const invalid of ['', ' ', 'Acme', '-acme', '_acme', 'acme/other', '../other', 'acme?x=1', 'a'.repeat(65), ' acme']) {
      expect(() => normalizeMcpTenant(invalid)).toThrow(/login_mcp_tenant_invalid|Invalid --tenant/);
      try {
        normalizeMcpTenant(invalid);
      } catch (error) {
        expect(error).toMatchObject({ code: 'login_mcp_tenant_invalid' });
      }
    }
  });

  it('defaults scope to brainbase.graph.read and enforces the whitelist', () => {
    expect(normalizeMcpScope(undefined)).toBe(MCP_OAUTH_DEFAULT_SCOPE);
    expect(normalizeMcpScope('brainbase.graph.read')).toBe('brainbase.graph.read');
    expect(normalizeMcpScope('brainbase.graph.directory')).toBe('brainbase.graph.directory');
    expect(normalizeMcpScope('brainbase.graph.read brainbase.graph.directory')).toBe(
      'brainbase.graph.read brainbase.graph.directory',
    );
    expect(normalizeMcpScope('brainbase.graph.read  brainbase.graph.read')).toBe('brainbase.graph.read');

    for (const invalid of ['', '   ', 'brainbase.canonical.task', 'brainbase.agent.task', 'brainbase.graph.read admin', 'brainbase.graph.read\n']) {
      try {
        normalizeMcpScope(invalid);
        expect.unreachable(`expected scope ${JSON.stringify(invalid)} to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: 'login_mcp_scope_invalid' });
      }
    }
  });

  it('validates HTTPS resource URLs and /runtime-mcp/(t/<tenant>/)?mcp paths', () => {
    expect(normalizeMcpResourceUrl('https://api.example.net/runtime-mcp/mcp')).toBe(
      'https://api.example.net/runtime-mcp/mcp',
    );
    expect(normalizeMcpResourceUrl('https://api.example.net/runtime-mcp/t/ten_acme-1/mcp')).toBe(
      'https://api.example.net/runtime-mcp/t/ten_acme-1/mcp',
    );
    expect(normalizeMcpResourceUrl('http://127.0.0.1:31014/runtime-mcp/t/acme/mcp')).toBe(
      'http://127.0.0.1:31014/runtime-mcp/t/acme/mcp',
    );

    expect(() => normalizeMcpResourceUrl('http://api.example.net/runtime-mcp/mcp')).toThrow(/https/);
    for (const invalid of [
      'https://api.example.net/other/mcp',
      'https://api.example.net/runtime-mcp/mcp/',
      'https://api.example.net/runtime-mcp/t/ACME/mcp',
      'https://api.example.net/runtime-mcp/t/a/../mcp',
      'https://api.example.net/runtime-mcp/mcp?foo=bar',
      'https://api.example.net/runtime-mcp/mcp#frag',
      'https://user:pass@api.example.net/runtime-mcp/mcp',
      'not-a-url',
    ]) {
      try {
        normalizeMcpResourceUrl(invalid);
        expect.unreachable(`expected resource ${JSON.stringify(invalid)} to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: 'login_mcp_resource_invalid' });
      }
    }
  });

  it('resolves tenant resource defaults and rejects conflicting --tenant and --resource', () => {
    expect(resolveMcpLoginConfig('https://api.example.net', { tenant: 'ten_demo' })).toMatchObject({
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/t/ten_demo/mcp',
      tenant: 'ten_demo',
    });
    expect(resolveMcpLoginConfig('https://api.example.net')).toMatchObject({
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/mcp',
    });
    expect(
      resolveMcpLoginConfig('https://api.example.net', {
        tenant: 'ten_demo',
        resource: 'https://mcp.example.net/runtime-mcp/t/ten_demo/mcp',
      }),
    ).toMatchObject({
      resource: 'https://mcp.example.net/runtime-mcp/t/ten_demo/mcp',
      tenant: 'ten_demo',
    });

    for (const conflictingResource of [
      'https://api.example.net/runtime-mcp/t/other_tenant/mcp',
      'https://api.example.net/runtime-mcp/mcp',
    ]) {
      try {
        resolveMcpLoginConfig('https://api.example.net', {
          tenant: 'ten_demo',
          resource: conflictingResource,
        });
        expect.unreachable('expected mismatch error');
      } catch (error) {
        expect(error).toMatchObject({ code: 'login_mcp_resource_tenant_mismatch' });
      }
    }
  });

  it('builds a safe 1..80 char client_name', () => {
    const generated = buildMcpClientName();
    expect(generated.length).toBeGreaterThanOrEqual(1);
    expect(generated.length).toBeLessThanOrEqual(80);
    expect(generated).toMatch(/^brainbase-cli/u);

    const longCustom = buildMcpClientName(`host-${'x'.repeat(120)}\u0007\n`);
    expect(longCustom.length).toBe(80);
    expect(longCustom).not.toMatch(/[\u0000-\u001f\u007f]/u);
  });
});

describe('loginWithDeviceCode in --mcp mode', () => {
  it('sends scope, resource, client_name, honors slow_down (+5s), and stores MCP OAuth metadata', async () => {
    const path = await credentialsFile();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const sleeps: number[] = [];
    let clock = NOW;
    let pollAttempt = 0;

    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      const pathname = new URL(url).pathname;

      if (pathname === '/api/auth/device/code') {
        return new Response(
          JSON.stringify({
            device_code: 'dev-mcp-1',
            user_code: 'MCP1-2345',
            verification_uri: 'https://api.example.net/device',
            verification_uri_complete: 'https://api.example.net/device?code=MCP1-2345',
            expires_in: 300,
            interval: 2,
          }),
          { status: 200 },
        );
      }

      if (pathname === '/api/auth/device/token') {
        pollAttempt += 1;
        if (pollAttempt === 1) {
          return new Response(JSON.stringify({ error: 'slow_down' }), { status: 400 });
        }
        if (pollAttempt === 2) {
          return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            access_token: 'bb_mcp_at_initial_secret',
            refresh_token: 'bb_mcp_rt_initial_secret',
            token_type: 'Bearer',
            expires_in: 600,
            scope: 'brainbase.graph.read',
            resource: 'https://api.example.net/runtime-mcp/t/acme/mcp',
            organization_id: 'org_acme',
            tenant_id: 'ten_acme',
            receipt_token: 'rcpt-mcp-1',
          }),
          { status: 200 },
        );
      }

      if (pathname === '/api/auth/device/received') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const credentials = await loginWithDeviceCode({
      serverUrl: 'https://api.example.net',
      credentialsPath: path,
      mcp: { tenant: 'acme' },
      fetch: fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      onPrompt: () => undefined,
    });

    // Verify /api/auth/device/code payload
    expect(calls[0].url).toBe('https://api.example.net/api/auth/device/code');
    expect(calls[0].body).toMatchObject({
      receipt_required: true,
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/t/acme/mcp',
    });
    expect(typeof calls[0].body.code_verifier).toBe('string');
    expect(typeof calls[0].body.client_name).toBe('string');
    expect((calls[0].body.client_name as string).length).toBeGreaterThanOrEqual(1);
    expect((calls[0].body.client_name as string).length).toBeLessThanOrEqual(80);

    // Verify slow_down extended interval by +5000ms (2000ms -> 7000ms -> 7000ms)
    expect(sleeps).toEqual([2000, 7000, 7000]);

    // Verify credentials persisted with MCP OAuth metadata
    expect(credentials).toEqual({
      schema_version: CREDENTIALS_SCHEMA_VERSION,
      login_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
      server_url: 'https://api.example.net',
      access_token: 'bb_mcp_at_initial_secret',
      refresh_token: 'bb_mcp_rt_initial_secret',
      expires_at: new Date(clock + 600_000).toISOString(),
      token_kind: 'mcp_oauth',
      organization_id: 'org_acme',
      tenant_id: 'ten_acme',
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/t/acme/mcp',
    });
    expect(await readCredentials(path)).toEqual(credentials);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(calls.at(-1)).toEqual({
      url: 'https://api.example.net/api/auth/device/received',
      body: { device_code: 'dev-mcp-1', receipt_token: 'rcpt-mcp-1' },
    });
  });

  it('fails safely with a clear message when server returns device_mcp_flow_disabled', async () => {
    const path = await credentialsFile();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'device_mcp_flow_disabled' }), { status: 400 })) as typeof fetch;

    await expect(
      loginWithDeviceCode({
        serverUrl: 'https://api.example.net',
        credentialsPath: path,
        mcp: { tenant: 'acme' },
        fetch: fetchImpl,
        sleep: async () => undefined,
        onPrompt: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'login_device_mcp_flow_disabled',
      message: expect.stringContaining('device_mcp_flow_disabled'),
    });
    expect(await readCredentials(path)).toBeNull();
  });
});

describe('requestRenewal for token_kind === mcp_oauth', () => {
  async function savedMcp(overrides: Partial<BrainbaseCredentials> = {}): Promise<string> {
    const path = await credentialsFile();
    await writeCredentials(path, {
      schema_version: CREDENTIALS_SCHEMA_VERSION,
      login_id: 'mcp-login-1',
      server_url: 'https://api.example.net',
      access_token: 'bb_mcp_at_old',
      refresh_token: 'bb_mcp_rt_old',
      expires_at: new Date(NOW - 5_000).toISOString(),
      token_kind: 'mcp_oauth',
      organization_id: 'org_acme',
      tenant_id: 'ten_acme',
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/t/acme/mcp',
      ...overrides,
    });
    return path;
  }

  it('renews via POST /api/auth/mcp/token (form-urlencoded) without CSRF and atomically rotates tokens', async () => {
    const path = await savedMcp();
    const requests: Array<{ url: string; method: string; contentType: string | null; body: string }> = [];

    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? 'GET',
        contentType: headers.get('content-type'),
        body: String(init?.body ?? ''),
      });
      if (url.endsWith('/api/csrf-token') || url.endsWith('/api/auth/refresh')) {
        throw new Error(`Unexpected legacy endpoint call: ${url}`);
      }
      return new Response(
        JSON.stringify({
          access_token: 'bb_mcp_at_rotated',
          refresh_token: 'bb_mcp_rt_rotated',
          token_type: 'Bearer',
          expires_in: 600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await getAccessToken({ credentialsPath: path, fetch: fetchImpl, now: () => NOW });
    expect(result).toEqual({ token: 'bb_mcp_at_rotated', serverUrl: 'https://api.example.net' });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.example.net/api/auth/mcp/token');
    expect(requests[0].method).toBe('POST');
    expect(requests[0].contentType).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(requests[0].body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('client_id')).toBe(MCP_DEVICE_FLOW_CLIENT_ID);
    expect(form.get('refresh_token')).toBe('bb_mcp_rt_old');

    expect(await readCredentials(path)).toEqual({
      schema_version: CREDENTIALS_SCHEMA_VERSION,
      login_id: 'mcp-login-1',
      server_url: 'https://api.example.net',
      access_token: 'bb_mcp_at_rotated',
      refresh_token: 'bb_mcp_rt_rotated',
      expires_at: new Date(NOW + 600_000).toISOString(),
      token_kind: 'mcp_oauth',
      organization_id: 'org_acme',
      tenant_id: 'ten_acme',
      scope: 'brainbase.graph.read',
      resource: 'https://api.example.net/runtime-mcp/t/acme/mcp',
    });
  });

  it('reports retryable errors as login_refresh_unavailable and invalid_grant as login_expired', async () => {
    const path = await savedMcp();
    const unavailableFetch = (async () =>
      new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 429 })) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: unavailableFetch, now: () => NOW })).rejects.toMatchObject({
      code: 'login_refresh_unavailable',
    });
    expect((await readCredentials(path))?.refresh_token).toBe('bb_mcp_rt_old');

    const refusedFetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch;
    await expect(getAccessToken({ credentialsPath: path, fetch: refusedFetch, now: () => NOW })).rejects.toMatchObject({
      code: 'login_expired',
    });
  });
});

describe('CLI integration with mock HTTP server (MCP mode + legacy regression)', () => {
  it('runs brainbase login --mcp end-to-end, displays non-secret login:status, and renews via /api/auth/mcp/token', async () => {
    const path = await credentialsFile();
    const receivedRequests: Array<{ method: string; url: string; contentType: string | undefined; body: string }> = [];
    let tokenPollCount = 0;

    const { origin } = await startMockServer((req, body, res) => {
      receivedRequests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        contentType: req.headers['content-type'],
        body,
      });
      res.setHeader('content-type', 'application/json');

      if (req.method === 'POST' && req.url === '/api/auth/device/code') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            device_code: 'dev-http-1',
            user_code: 'HTTP-9999',
            verification_uri: `${origin}/device`,
            verification_uri_complete: `${origin}/device?code=HTTP-9999`,
            expires_in: 60,
            interval: 0.01,
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/auth/device/token') {
        tokenPollCount += 1;
        if (tokenPollCount === 1) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'authorization_pending' }));
          return;
        }
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: 'bb_mcp_at_secret_value_1',
            refresh_token: 'bb_mcp_rt_secret_value_1',
            token_type: 'Bearer',
            expires_in: 600,
            scope: 'brainbase.graph.directory',
            resource: `${origin}/runtime-mcp/t/ten_demo/mcp`,
            organization_id: 'org_demo',
            tenant_id: 'ten_demo',
            receipt_token: 'rcpt-http-1',
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/auth/device/received') {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/auth/mcp/token') {
        const params = new URLSearchParams(body);
        if (
          params.get('grant_type') === 'refresh_token'
          && params.get('client_id') === 'device_flow_mcp'
          && params.get('refresh_token') === 'bb_mcp_rt_secret_value_1'
        ) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: 'bb_mcp_at_secret_value_2',
              refresh_token: 'bb_mcp_rt_secret_value_2',
              token_type: 'Bearer',
              expires_in: 600,
            }),
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }

      res.statusCode = 404;
      res.end('{}');
    });

    const loginOut = capture();
    const loginExit = await runCli(
      [
        'login',
        '--server',
        origin,
        '--mcp',
        '--tenant',
        'ten_demo',
        '--scope',
        'brainbase.graph.directory',
        '--credentials',
        path,
      ],
      loginOut.io,
    );
    expect(loginExit).toBe(0);
    expect(loginOut.stderr()).toBe('');
    expect(loginOut.stdout()).toContain('HTTP-9999');
    expect(loginOut.stdout()).not.toContain('bb_mcp_at_secret_value_1');
    expect(loginOut.stdout()).not.toContain('bb_mcp_rt_secret_value_1');

    const deviceCodePayload = JSON.parse(receivedRequests[0].body) as Record<string, unknown>;
    expect(deviceCodePayload).toMatchObject({
      receipt_required: true,
      scope: 'brainbase.graph.directory',
      resource: `${origin}/runtime-mcp/t/ten_demo/mcp`,
    });
    expect(typeof deviceCodePayload.client_name).toBe('string');

    const statusOut = capture();
    expect(await runCli(['login:status', '--credentials', path], statusOut.io)).toBe(0);
    expect(statusOut.stdout()).toContain('接続種別: 遠隔 MCP (OAuth Device Flow)');
    expect(statusOut.stdout()).toContain('組織: org_demo');
    expect(statusOut.stdout()).toContain('テナント: ten_demo');
    expect(statusOut.stdout()).toContain('スコープ: brainbase.graph.directory');
    expect(statusOut.stdout()).toContain(`接続先 resource: ${origin}/runtime-mcp/t/ten_demo/mcp`);
    expect(statusOut.stdout()).not.toContain('bb_mcp_at_');
    expect(statusOut.stdout()).not.toContain('bb_mcp_rt_');

    // Trigger token renewal past expiry against the real mock server
    const saved = await readCredentials(path);
    expect(saved?.token_kind).toBe('mcp_oauth');
    const afterExpiry = Date.parse(saved!.expires_at) + 1_000;
    const renewed = await getAccessToken({ credentialsPath: path, now: () => afterExpiry });
    expect(renewed).toEqual({ token: 'bb_mcp_at_secret_value_2', serverUrl: origin });
    expect(await readCredentials(path)).toMatchObject({
      access_token: 'bb_mcp_at_secret_value_2',
      refresh_token: 'bb_mcp_rt_secret_value_2',
      token_kind: 'mcp_oauth',
      organization_id: 'org_demo',
      tenant_id: 'ten_demo',
    });
    expect(receivedRequests.some((req) => req.url === '/api/csrf-token' || req.url === '/api/auth/refresh')).toBe(false);
  });

  it('exits safely when mock server returns device_mcp_flow_disabled', async () => {
    const path = await credentialsFile();
    const { origin } = await startMockServer((_req, _body, res) => {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'device_mcp_flow_disabled' }));
    });

    const out = capture();
    expect(await runCli(['login', '--server', origin, '--mcp', '--tenant', 'acme', '--credentials', path], out.io)).toBe(1);
    expect(out.stderr()).toContain('device_mcp_flow_disabled');
    expect(await readCredentials(path)).toBeNull();
  });

  it('rejects invalid CLI options for --mcp, --tenant, --scope, and --resource before network access', async () => {
    const path = await credentialsFile();
    const invalidInvocations: Array<{ argv: string[]; pattern: RegExp }> = [
      {
        argv: ['login', '--server', 'https://api.example.net', '--tenant', 'acme', '--credentials', path],
        pattern: /--mcp と一緒に指定してください/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--scope', 'brainbase.graph.read', '--credentials', path],
        pattern: /--mcp と一緒に指定してください/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--resource', 'https://api.example.net/runtime-mcp/mcp', '--credentials', path],
        pattern: /--mcp と一緒に指定してください/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp', 'true', '--credentials', path],
        pattern: /--mcp は値をとりません/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp=true', '--credentials', path],
        pattern: /--mcp=… の形は使えません/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp', '--tenant', '../bad', '--credentials', path],
        pattern: /Invalid --tenant/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp', '--scope', 'brainbase.canonical.task', '--credentials', path],
        pattern: /Invalid --scope/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp', '--resource', 'http://api.example.net/runtime-mcp/mcp', '--credentials', path],
        pattern: /https/,
      },
      {
        argv: ['login', '--server', 'https://api.example.net', '--mcp', '--resource', 'https://api.example.net/wrong/path', '--credentials', path],
        pattern: /\/runtime-mcp\/mcp/,
      },
    ];

    for (const { argv, pattern } of invalidInvocations) {
      const out = capture();
      expect(await runCli(argv, out.io)).toBe(1);
      expect(out.stderr()).toMatch(pattern);
      expect(out.stdout()).toBe('');
    }
    expect(await readCredentials(path)).toBeNull();
  });

  it('preserves 100% backward compatibility for legacy brainbase login without --mcp', async () => {
    const path = await credentialsFile();
    const seen: Array<{ method: string; url: string; body: string }> = [];
    const initialJwt = jwt(Math.floor(Date.now() / 1000) + 3600);
    const renewedJwt = jwt(Math.floor(Date.now() / 1000) + 7200);

    const { origin } = await startMockServer((req, body, res) => {
      seen.push({ method: req.method ?? 'GET', url: req.url ?? '/', body });
      res.setHeader('content-type', 'application/json');

      if (req.url === '/api/auth/device/code') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            device_code: 'dev-legacy-1',
            user_code: 'LGCY-1111',
            verification_uri: `${origin}/device`,
            expires_in: 60,
            interval: 0.01,
          }),
        );
        return;
      }
      if (req.url === '/api/auth/device/token') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: initialJwt,
            refresh_token: 'legacy-refresh-1',
            receipt_token: 'legacy-receipt-1',
          }),
        );
        return;
      }
      if (req.url === '/api/auth/device/received') {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === '/api/csrf-token') {
        res.statusCode = 200;
        res.end(JSON.stringify({ token: 'csrf-legacy-1' }));
        return;
      }
      if (req.url === '/api/auth/refresh') {
        res.statusCode = 200;
        res.end(JSON.stringify({ token: renewedJwt, refresh_token: 'legacy-refresh-2' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });

    const loginOut = capture();
    expect(await runCli(['login', '--server', origin, '--credentials', path], loginOut.io)).toBe(0);
    expect(loginOut.stdout()).toContain(`ログインしました（${origin}）。保存先: ${path}`);

    // Legacy /api/auth/device/code payload MUST NOT send scope, resource, or client_name
    const codePayload = JSON.parse(seen[0].body) as Record<string, unknown>;
    expect(Object.keys(codePayload).sort()).toEqual(['code_verifier', 'receipt_required']);

    // Saved credentials.json MUST NOT contain MCP-specific fields
    const rawSaved = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(rawSaved).not.toHaveProperty('token_kind');
    expect(rawSaved).not.toHaveProperty('organization_id');
    expect(rawSaved).not.toHaveProperty('tenant_id');
    expect(rawSaved).not.toHaveProperty('scope');
    expect(rawSaved).not.toHaveProperty('resource');

    // Legacy login:status output unchanged
    const statusOut = capture();
    expect(await runCli(['login:status', '--credentials', path], statusOut.io)).toBe(0);
    expect(statusOut.stdout()).toContain(`サーバー: ${origin}`);
    expect(statusOut.stdout()).not.toContain('接続種別:');
    expect(statusOut.stdout()).not.toContain('接続先 resource:');

    // Legacy renewal still calls /api/csrf-token + /api/auth/refresh and NEVER /api/auth/mcp/token
    const afterExpiry = Date.parse(String(rawSaved.expires_at)) + 1_000;
    const renewed = await getAccessToken({ credentialsPath: path, now: () => afterExpiry });
    expect(renewed).toEqual({ token: renewedJwt, serverUrl: origin });
    expect(seen.some((req) => req.url === '/api/csrf-token')).toBe(true);
    expect(seen.some((req) => req.url === '/api/auth/refresh')).toBe(true);
    expect(seen.some((req) => req.url === '/api/auth/mcp/token')).toBe(false);
  });
});
