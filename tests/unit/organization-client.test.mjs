import { EventEmitter } from 'node:events';
import { constants as osConstants } from 'node:os';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticate,
  inspectClient,
  loadConfig,
  parseCliArgs,
  readToken,
  refresh,
  runClaude,
  validateConfig,
} from '../../packages/organization-client/src/index.mjs';

const WORK_ROOT = mkdtempSync(join(tmpdir(), 'organization-client-test-'));

afterEach(() => {
  vi.restoreAllMocks();
});

function config(overrides = {}) {
  return {
    organization_id: 'org_fixture',
    api_url: 'https://api.fixture.example',
    mcp_url: 'https://mcp.fixture.example/mcp',
    token_file: join(WORK_ROOT, 'tokens.json'),
    ...overrides,
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    async json() {
      return body;
    },
  };
}

function writeToken(overrides = {}) {
  const value = {
    version: 1,
    organization_id: 'org_fixture',
    api_url: 'https://api.fixture.example',
    mcp_url: 'https://mcp.fixture.example/mcp',
    access_token: 'access-secret-fixture',
    refresh_token: 'refresh-secret-fixture',
    expires_in: 3600,
    issued_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  mkdirSync(WORK_ROOT, { recursive: true });
  writeFileSync(config().token_file, JSON.stringify(value), { mode: 0o600 });
  chmodSync(config().token_file, 0o600);
  return value;
}

describe('organization-client configuration and package boundary', () => {
  it('requires explicit organization and HTTPS API/MCP endpoints', () => {
    expect(() => validateConfig({ organization_id: 'org_fixture' })).toThrow(/api_url is required/);
    expect(() => validateConfig({
      organization_id: 'org_fixture',
      api_url: 'http://api.fixture.example',
      mcp_url: 'https://mcp.fixture.example/mcp',
    })).toThrow(/HTTPS/);
    expect(() => validateConfig({
      organization_id: 'org_fixture',
      api_url: 'https://api.fixture.example',
      mcp_url: 'https://mcp.fixture.example/mcp',
    })).not.toThrow();
  });

  it('does not accept secret fields in external configuration', () => {
    expect(() => validateConfig({
      ...config(),
      access_token: 'must-not-be-configured',
    })).toThrow(/secret values/);
  });

  it('keeps the package private and limits files to the client allowlist', () => {
    const manifest = JSON.parse(readFileSync('packages/organization-client/package.json', 'utf8'));
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.files).toEqual(['bin', 'src', 'package.json']);
  });
});

describe('organization-client device auth and refresh', () => {
  it('performs device auth and stores a 0600 token bound to the organization and endpoints', async () => {
    const calls = [];
    const responses = [
      jsonResponse({
        device_code: 'device-code-fixture',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.fixture.example/device',
        expires_in: 30,
        interval: 1,
      }),
      jsonResponse({ error: 'authorization_pending' }, { status: 428 }),
      jsonResponse({
        access_token: 'access-secret-fixture',
        refresh_token: 'refresh-secret-fixture',
        expires_in: 3600,
      }),
    ];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    };
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await authenticate(config(), {
      fetchImpl,
      sleep: async () => {},
      now: () => 1_700_000_000_000,
      randomBytes: () => Buffer.alloc(32, 7),
    });

    const stored = readToken(config());
    expect(stored).toMatchObject({
      organization_id: 'org_fixture',
      api_url: 'https://api.fixture.example/',
      mcp_url: 'https://mcp.fixture.example/mcp',
      access_token: 'access-secret-fixture',
    });
    expect(statSync(config().token_file).mode & 0o777).toBe(0o600);
    expect(calls.map(({ url }) => url)).toEqual([
      'https://api.fixture.example/api/auth/device/code',
      'https://api.fixture.example/api/auth/device/token',
      'https://api.fixture.example/api/auth/device/token',
    ]);
    expect(calls[0].options.redirect).toBe('error');
    expect(calls[0].options.body).not.toContain('access-secret-fixture');
    expect(output.mock.calls.flat().join(' ')).not.toContain('access-secret-fixture');
  });

  it('refuses refresh when the stored token is bound to another endpoint or organization', async () => {
    writeToken({ api_url: 'https://other-api.fixture.example/' });
    const fetchImpl = vi.fn();

    await expect(refresh(config(), { fetchImpl })).rejects.toThrow(/token binding mismatch/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes with CSRF headers and replaces the token atomically without logging it', async () => {
    writeToken();
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/csrf-token')) return jsonResponse({ token: 'csrf-fixture' });
      return jsonResponse({ access_token: 'new-access-secret', refresh_token: 'new-refresh-secret', expires_in: 3600 });
    };
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refresh(config(), { fetchImpl, now: () => 1_700_000_000_000, randomUUID: () => 'session-fixture' });

    expect(calls).toHaveLength(2);
    expect(calls[0].options.redirect).toBe('error');
    expect(calls[1].options.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-fixture',
      'X-Session-Id': 'session-fixture',
    });
    expect(calls[1].options.body).toContain('refresh-secret-fixture');
    expect(readToken(config()).access_token).toBe('new-access-secret');
    expect(statSync(config().token_file).mode & 0o777).toBe(0o600);
    expect(output.mock.calls.flat().join(' ')).not.toContain('new-access-secret');
  });
});

describe('organization-client inspect and strict MCP run', () => {
  it('inspects only non-secret binding and authentication state', () => {
    writeToken();
    const result = inspectClient(config(), { now: () => 1_700_000_000_000 });
    expect(result).toMatchObject({
      organization_id: 'org_fixture',
      api_url: 'https://api.fixture.example/',
      mcp_url: 'https://mcp.fixture.example/mcp',
      authenticated: true,
      binding_valid: true,
    });
    expect(JSON.stringify(result)).not.toContain('access-secret-fixture');
    expect(JSON.stringify(result)).not.toContain('refresh-secret-fixture');
  });

  it('rejects MCP override arguments before spawning Claude', async () => {
    writeToken();
    const spawnImpl = vi.fn();

    await expect(runClaude(config(), ['--mcp-config=/tmp/attacker.json'], { spawnImpl }))
      .rejects.toThrow(/MCP configuration override is not allowed/);
    await expect(runClaude(config(), ['--strict-mcp-config'], { spawnImpl }))
      .rejects.toThrow(/MCP configuration override is not allowed/);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('uses strict MCP config, does not use a shell, cleans the secret file, and maps signals', async () => {
    writeToken();
    let observed;
    const spawnImpl = vi.fn((command, args, options) => {
      observed = { command, args, options };
      expect(options.shell).toBe(false);
      const configPath = args[args.indexOf('--mcp-config') + 1];
      const mcpConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(mcpConfig.mcpServers.brainbase.headers.Authorization).toBe('Bearer access-secret-fixture');
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return child;
    });

    const result = await runClaude(config(), ['--print', 'hello world'], { spawnImpl });

    expect(result).toMatchObject({ exitCode: 128 + osConstants.signals.SIGTERM, signal: 'SIGTERM' });
    expect(observed.command).toBe('claude');
    expect(observed.args.slice(0, 3)).toEqual(['--strict-mcp-config', '--mcp-config', expect.any(String)]);
    expect(observed.args.slice(3)).toEqual(['--print', 'hello world']);
    expect(observed.options.env).not.toHaveProperty('ORGANIZATION_CLIENT_ACCESS_TOKEN');
    expect(existsSync(observed.args[2])).toBe(false);
  });

  it('rejects Windows explicitly instead of enabling shell interpolation', async () => {
    writeToken();
    await expect(runClaude(config(), [], { platform: 'win32', spawnImpl: vi.fn() }))
      .rejects.toThrow(/Windows is not supported/);
  });
});

describe('organization-client CLI parser', () => {
  it('requires config and rejects secret CLI options', () => {
    expect(() => parseCliArgs(['auth'])).toThrow(/--config is required/);
    expect(() => parseCliArgs(['auth', '--config', 'fixture.json', '--access-token', 'secret']))
      .toThrow(/secret values must not be passed/);
    expect(parseCliArgs(['inspect', '--config', 'fixture.json', '--token-file', 'tokens.json']))
      .toMatchObject({ command: 'inspect', configPath: 'fixture.json', tokenFile: 'tokens.json' });
    expect(parseCliArgs(['run', '--config=fixture.json', '--', '--print', 'hello']))
      .toMatchObject({ command: 'run', configPath: 'fixture.json', claudeArgs: ['--print', 'hello'] });
  });
});

afterEach(() => {
  rmSync(WORK_ROOT, { recursive: true, force: true });
});
