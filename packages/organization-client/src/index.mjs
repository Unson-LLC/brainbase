import { spawn as nodeSpawn } from 'node:child_process';
import { constants as osConstants, homedir, tmpdir } from 'node:os';
import { randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const ALLOWED_CONFIG_KEYS = new Set([
  'organization_id',
  'api_url',
  'mcp_url',
  'token_file',
  'mcp_server_name',
]);
const SECRET_CONFIG_KEYS = new Set([
  'access_token',
  'refresh_token',
  'token',
  'authorization',
  'client_secret',
  'password',
  'secret',
]);
const SECRET_CLI_NAMES = new Set([
  '--access-token',
  '--refresh-token',
  '--token',
  '--authorization',
  '--client-secret',
  '--password',
  '--secret',
]);
const SUPPORTED_COMMANDS = new Set(['auth', 'refresh', 'run', 'inspect']);
const DEFAULT_MCP_SERVER_NAME = 'brainbase';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_LIMIT = 120;
const SIGNALS_TO_FORWARD = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function fail(message) {
  throw new Error(message);
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`);
  }
  return value.trim();
}

function normalizeUrl(value, name) {
  const raw = assertString(value, name);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') {
    fail(`${name} must use HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    fail(`${name} must not contain credentials, query, or fragment`);
  }
  return parsed.toString();
}

function validateOrganizationId(value) {
  const organizationId = assertString(value, 'organization_id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(organizationId)) {
    fail('organization_id has an invalid format');
  }
  return organizationId;
}

function validateTokenFile(value) {
  if (value === undefined) return undefined;
  const tokenFile = assertString(value, 'token_file');
  if (tokenFile.includes('\0')) fail('token_file is invalid');
  return tokenFile;
}

function validateMcpServerName(value) {
  if (value === undefined) return DEFAULT_MCP_SERVER_NAME;
  const name = assertString(value, 'mcp_server_name');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    fail('mcp_server_name has an invalid format');
  }
  return name;
}

/**
 * Validate and normalize the deliberately small external configuration.
 * Endpoint defaults are intentionally absent: callers must state both URLs.
 */
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('configuration must be a JSON object');
  }

  for (const key of Object.keys(input)) {
    if (SECRET_CONFIG_KEYS.has(key) || (!ALLOWED_CONFIG_KEYS.has(key) && /token|secret|password|authorization/i.test(key))) {
      fail('secret values must not be included in configuration');
    }
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      fail(`unsupported configuration field: ${key}`);
    }
  }

  return {
    organization_id: validateOrganizationId(input.organization_id),
    api_url: normalizeUrl(input.api_url, 'api_url'),
    mcp_url: normalizeUrl(input.mcp_url, 'mcp_url'),
    ...(input.token_file === undefined ? {} : { token_file: validateTokenFile(input.token_file) }),
    mcp_server_name: validateMcpServerName(input.mcp_server_name),
  };
}

function defaultTokenFile(organizationId) {
  const safeOrganizationId = encodeURIComponent(organizationId);
  return join(homedir(), '.brainbase', 'organization-client', safeOrganizationId, 'tokens.json');
}

function withTokenFile(config, baseDir) {
  const tokenFile = config.token_file === undefined
    ? defaultTokenFile(config.organization_id)
    : (isAbsolute(config.token_file) ? config.token_file : resolve(baseDir || process.cwd(), config.token_file));
  return { ...config, token_file: tokenFile };
}

function normalizeConfig(input, { baseDir } = {}) {
  return withTokenFile(validateConfig(input), baseDir);
}

export function loadConfig(configPath) {
  const pathValue = assertString(configPath, 'config path');
  let contents;
  try {
    contents = readFileSync(pathValue, 'utf8');
  } catch {
    fail('unable to read configuration file');
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail('configuration file is not valid JSON');
  }
  return withTokenFile(validateConfig(parsed), dirname(resolve(pathValue)));
}

function canonicalTokenEndpoint(value, name) {
  try {
    return normalizeUrl(value, name);
  } catch {
    return null;
  }
}

function tokenMatchesConfig(token, config) {
  return Boolean(
    token
      && token.organization_id === config.organization_id
      && canonicalTokenEndpoint(token.api_url, 'api_url') === config.api_url
      && canonicalTokenEndpoint(token.mcp_url, 'mcp_url') === config.mcp_url,
  );
}

function assertTokenBinding(token, config) {
  if (!tokenMatchesConfig(token, config)) {
    fail('token binding mismatch');
  }
}

function tokenIsCurrent(token, now = () => Date.now()) {
  return Boolean(
    token?.access_token
      && typeof token.access_token === 'string'
      && Number(token.issued_at || 0) + Number(token.expires_in || 0) > now() / 1000 + 60,
  );
}

function parseTokenFile(contents) {
  let token;
  try {
    token = JSON.parse(contents);
  } catch {
    fail('token file is invalid');
  }
  if (!token || typeof token !== 'object' || Array.isArray(token)) {
    fail('token file is invalid');
  }
  return token;
}

/** Return null for a missing token, while never exposing token contents in errors. */
export function readToken(input) {
  const config = normalizeConfig(input);
  let metadata;
  try {
    metadata = lstatSync(config.token_file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('unable to read token file');
  }
  if (metadata.isSymbolicLink()) fail('token file must not be a symbolic link');
  if ((metadata.mode & 0o077) !== 0) fail('token file permissions are too open');
  try {
    return parseTokenFile(readFileSync(config.token_file, 'utf8'));
  } catch (error) {
    if (error?.message === 'token file is invalid') throw error;
    fail('unable to read token file');
  }
}

function readBoundToken(config) {
  const token = readToken(config);
  if (!token) fail('authentication required; run auth first');
  assertTokenBinding(token, config);
  return token;
}

function secureParentDirectory(tokenFile) {
  const parent = dirname(tokenFile);
  const wasPresent = existsSync(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!wasPresent) {
    try {
      chmodSync(parent, 0o700);
    } catch {
      fail('unable to secure token directory');
    }
  }
  return parent;
}

function writeToken(configInput, token) {
  const config = normalizeConfig(configInput);
  const tokenFile = config.token_file;
  const parent = secureParentDirectory(tokenFile);
  try {
    if (lstatSync(tokenFile).isSymbolicLink()) fail('token file must not be a symbolic link');
  } catch (error) {
    if (error?.message === 'token file must not be a symbolic link') throw error;
    if (error?.code !== 'ENOENT') fail('unable to inspect token file');
  }

  const temporaryFile = join(parent, `.${basename(tokenFile)}.${nodeRandomUUID()}.tmp`);
  try {
    writeFileSync(temporaryFile, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporaryFile, 0o600);
    renameSync(temporaryFile, tokenFile);
    chmodSync(tokenFile, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporaryFile);
    } catch {
      // Best effort cleanup; retain the original safe error below.
    }
    if (error?.message === 'token file must not be a symbolic link') throw error;
    fail('unable to store token securely');
  }
}

class HttpFailure extends Error {
  constructor(status) {
    super(`HTTP request failed (${status || 'unknown status'})`);
    this.name = 'HttpFailure';
    this.status = status;
  }
}

async function fetchJson(url, {
  fetchImpl = globalThis.fetch,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowHttpErrors = false,
} = {}) {
  if (typeof fetchImpl !== 'function') fail('fetch is not available');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') fail('request timed out');
      fail('network request failed');
    }
    if (!response || typeof response !== 'object' || typeof response.json !== 'function') {
      fail('network request failed');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') fail('request timed out');
      payload = null;
    }
    if (!response.ok && !allowHttpErrors) {
      throw new HttpFailure(response.status);
    }
    return { status: response.status, ok: response.ok, body: payload };
  } finally {
    clearTimeout(timeout);
  }
}

function apiEndpoint(config, path) {
  return new URL(path.replace(/^\//, ''), config.api_url).toString();
}

function randomBytesDefault(size) {
  return nodeRandomBytes(size);
}

function sleepDefault(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function authenticate(input, {
  fetchImpl = globalThis.fetch,
  sleep = sleepDefault,
  now = () => Date.now(),
  randomBytes = randomBytesDefault,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPolls = DEFAULT_POLL_LIMIT,
} = {}) {
  const config = normalizeConfig(input);
  const codeVerifier = randomBytes(32).toString('base64url');
  let started;
  try {
    started = await fetchJson(apiEndpoint(config, '/api/auth/device/code'), {
      fetchImpl,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code_verifier: codeVerifier }),
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof HttpFailure) fail('authentication start failed');
    throw error;
  }
  if (!started.ok || !started.body?.device_code || !started.body?.expires_in) {
    fail('authentication start failed');
  }

  const authorization = started.body;
  console.log('\nOpen the authorization URL in your organization account:');
  console.log(authorization.verification_uri_complete || authorization.verification_uri || '');
  if (!authorization.verification_uri_complete && authorization.user_code) {
    console.log(`Verification code: ${authorization.user_code}`);
  }

  const expiresAt = now() + Number(authorization.expires_in) * 1000;
  let intervalMs = Math.max(Number(authorization.interval || 5), 1) * 1000;
  for (let attempt = 0; attempt < maxPolls && now() < expiresAt; attempt += 1) {
    await sleep(intervalMs);
    let result;
    try {
      result = await fetchJson(apiEndpoint(config, '/api/auth/device/token'), {
        fetchImpl,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_code: authorization.device_code }),
        timeoutMs,
        allowHttpErrors: true,
      });
    } catch (error) {
      if (error instanceof HttpFailure) fail('device authentication failed');
      throw error;
    }
    const tokenResponse = result.body || {};
    if (result.ok && tokenResponse.access_token) {
      const token = {
        version: 1,
        organization_id: config.organization_id,
        api_url: config.api_url,
        mcp_url: config.mcp_url,
        access_token: tokenResponse.access_token,
        ...(tokenResponse.refresh_token ? { refresh_token: tokenResponse.refresh_token } : {}),
        expires_in: Number(tokenResponse.expires_in || 3600),
        issued_at: Math.floor(now() / 1000),
      };
      writeToken(config, token);
      console.log(`Authentication completed: ${config.token_file}`);
      return { ...token, token_file: config.token_file };
    }
    if (['authorization_pending', 'slow_down'].includes(tokenResponse.error)) {
      if (tokenResponse.error === 'slow_down') intervalMs += 5_000;
      continue;
    }
    fail('device authentication failed');
  }
  fail('device authentication expired; run auth again');
}

export async function refresh(input, {
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  randomUUID = nodeRandomUUID,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = normalizeConfig(input);
  const current = readBoundToken(config);
  if (typeof current.refresh_token !== 'string' || current.refresh_token === '') {
    fail('refresh token is not available; run auth first');
  }

  const sessionId = randomUUID();
  let csrf;
  try {
    csrf = await fetchJson(apiEndpoint(config, '/api/csrf-token'), {
      fetchImpl,
      headers: { 'X-Session-Id': sessionId },
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof HttpFailure) fail('refresh preparation failed');
    throw error;
  }
  if (!csrf.ok || typeof csrf.body?.token !== 'string' || csrf.body.token === '') {
    fail('refresh preparation failed');
  }

  let response;
  try {
    response = await fetchJson(apiEndpoint(config, '/api/auth/refresh'), {
      fetchImpl,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-CSRF-Token': csrf.body.token,
        'X-Session-Id': sessionId,
      },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
      timeoutMs,
      allowHttpErrors: true,
    });
  } catch (error) {
    if (error instanceof HttpFailure) fail('authentication refresh failed');
    throw error;
  }
  const refreshed = response.body || {};
  const accessToken = refreshed.access_token || refreshed.token;
  if (!response.ok || typeof accessToken !== 'string' || accessToken === '') {
    fail('authentication refresh failed');
  }

  const next = {
    version: 1,
    organization_id: config.organization_id,
    api_url: config.api_url,
    mcp_url: config.mcp_url,
    access_token: accessToken,
    refresh_token: refreshed.refresh_token || current.refresh_token,
    expires_in: Number(refreshed.expires_in || 3600),
    issued_at: Math.floor(now() / 1000),
  };
  writeToken(config, next);
  console.log('Organization client authentication refreshed.');
  return { ...next, token_file: config.token_file };
}

export function inspectClient(input, { now = () => Date.now() } = {}) {
  const config = normalizeConfig(input);
  let token = null;
  let tokenStatus = 'missing';
  try {
    token = readToken(config);
    if (token) tokenStatus = tokenMatchesConfig(token, config) ? 'bound' : 'binding_mismatch';
  } catch {
    tokenStatus = 'invalid';
  }
  const bindingValid = tokenStatus === 'bound';
  return {
    organization_id: config.organization_id,
    api_url: config.api_url,
    mcp_url: config.mcp_url,
    token_file: config.token_file,
    authenticated: bindingValid && tokenIsCurrent(token, now),
    binding_valid: bindingValid,
    token_status: tokenStatus,
    token_expires_at: token && Number.isFinite(Number(token.issued_at)) && Number.isFinite(Number(token.expires_in))
      ? Number(token.issued_at) + Number(token.expires_in)
      : null,
  };
}

function assertNoMcpOverrides(args) {
  for (const arg of args) {
    if (/^--(?:mcp-config|strict-mcp-config|no-strict-mcp-config)(?:=|$)/.test(arg)) {
      fail('MCP configuration override is not allowed');
    }
  }
}

function safeChildEnvironment(overrides) {
  const environment = { ...process.env, ...(overrides || {}) };
  for (const name of Object.keys(environment)) {
    if (/^ORGANIZATION_CLIENT_(?:ACCESS|REFRESH)_TOKEN$/.test(name)) {
      delete environment[name];
    }
  }
  return environment;
}

function signalExitCode(signal) {
  return 128 + (osConstants.signals[signal] || 1);
}

function spawnClaude(command, args, options, spawnImpl) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const signalHandlers = new Map();
    const child = spawnImpl(command, args, options);

    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    for (const signal of SIGNALS_TO_FORWARD) {
      const handler = () => {
        if (typeof child.kill === 'function') child.kill(signal);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    child.once('error', () => finish(rejectPromise, new Error('Claude failed to start')));
    child.once('close', (code, signal) => {
      if (signal) {
        finish(resolvePromise, { exitCode: signalExitCode(signal), code: null, signal });
      } else {
        finish(resolvePromise, { exitCode: Number.isInteger(code) ? code : 1, code, signal: null });
      }
    });
  });
}

export async function runClaude(input, claudeArgs = [], {
  spawnImpl = nodeSpawn,
  platform = process.platform,
  env,
  now = () => Date.now(),
} = {}) {
  assertNoMcpOverrides(claudeArgs);
  if (platform === 'win32') {
    fail('Windows is not supported by this launcher');
  }
  const config = normalizeConfig(input);
  const token = readBoundToken(config);
  if (!tokenIsCurrent(token, now)) {
    fail('authentication is missing or expired; run refresh or auth first');
  }

  const temporaryDir = mkdtempSync(join(tmpdir(), 'organization-client-mcp-'));
  const mcpConfigPath = join(temporaryDir, 'mcp.json');
  try {
    const mcpConfig = {
      mcpServers: {
        [config.mcp_server_name]: {
          type: 'http',
          url: config.mcp_url,
          headers: { Authorization: `Bearer ${token.access_token}` },
        },
      },
    };
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), { encoding: 'utf8', mode: 0o600 });
    chmodSync(mcpConfigPath, 0o600);
    return await spawnClaude(
      'claude',
      ['--strict-mcp-config', '--mcp-config', mcpConfigPath, ...claudeArgs],
      { stdio: 'inherit', shell: false, env: safeChildEnvironment(env) },
      spawnImpl,
    );
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function isSecretCliOption(arg) {
  const name = String(arg).split('=', 1)[0];
  if (name === '--token-file') return false;
  return SECRET_CLI_NAMES.has(name) || /^(?:--.*(?:token|secret|password|authorization))$/i.test(name);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!SUPPORTED_COMMANDS.has(command)) {
    fail('command must be one of auth, refresh, run, inspect');
  }

  let configPath;
  let tokenFile;
  const claudeArgs = [];
  let afterSeparator = false;
  while (args.length) {
    const arg = args.shift();
    if (isSecretCliOption(arg)) fail('secret values must not be passed on the command line');
    if (arg === '--') {
      afterSeparator = true;
      claudeArgs.push(...args);
      break;
    }
    if (!afterSeparator && (arg === '--config' || arg === '--config-path')) {
      configPath = args.shift();
      if (!configPath || configPath.startsWith('--')) fail('--config requires a path');
      continue;
    }
    if (!afterSeparator && arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      if (!configPath) fail('--config requires a path');
      continue;
    }
    if (!afterSeparator && arg === '--token-file') {
      tokenFile = args.shift();
      if (!tokenFile || tokenFile.startsWith('--')) fail('--token-file requires a path');
      continue;
    }
    if (!afterSeparator && arg.startsWith('--token-file=')) {
      tokenFile = arg.slice('--token-file='.length);
      if (!tokenFile) fail('--token-file requires a path');
      continue;
    }
    if (command === 'run') {
      claudeArgs.push(arg);
    } else {
      fail(`unsupported option: ${arg}`);
    }
  }
  if (!configPath) fail('--config is required');
  return { command, configPath, ...(tokenFile ? { tokenFile } : {}), claudeArgs };
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout } = {}) {
  const parsed = parseCliArgs(argv);
  const loaded = loadConfig(parsed.configPath);
  const config = parsed.tokenFile
    ? { ...loaded, token_file: isAbsolute(parsed.tokenFile) ? parsed.tokenFile : resolve(process.cwd(), parsed.tokenFile) }
    : loaded;

  if (parsed.command === 'auth') return authenticate(config);
  if (parsed.command === 'refresh') return refresh(config);
  if (parsed.command === 'inspect') {
    const result = inspectClient(config);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  return runClaude(config, parsed.claudeArgs);
}
