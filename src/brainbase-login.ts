// `brainbase login`: a person signs in from the terminal with the Device Code
// Flow of their Brainbase API, and the CLI keeps the resulting person token on
// this machine. Hooks and commands then ask `getAccessToken` for a token
// instead of reading one from an environment variable; an expired token is
// renewed with the stored refresh token.
//
// The token is the same person JWT the Web login issues, so a hosted MCP that
// verifies it through the API treats it as that person. Nothing here carries a
// default server: the person names their own server once at login.

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CREDENTIALS_SCHEMA_VERSION = 'brainbase-credentials-v1';

export interface BrainbaseCredentials {
  schema_version: typeof CREDENTIALS_SCHEMA_VERSION;
  server_url: string;
  access_token: string;
  refresh_token?: string;
  /** ISO time at which the access token stops being accepted. */
  expires_at: string;
}

export interface DeviceAuthorizationPrompt {
  verificationUri: string;
  verificationUriComplete?: string;
  userCode?: string;
  expiresInSeconds: number;
}

type FetchLike = typeof fetch;

export interface LoginOptions {
  serverUrl: string;
  credentialsPath?: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onPrompt: (prompt: DeviceAuthorizationPrompt) => void;
  onWaiting?: () => void;
}

export interface AccessTokenOptions {
  credentialsPath?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Renew when the token expires within this many milliseconds. */
  refreshSkewMs?: number;
}

export class BrainbaseLoginError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'BrainbaseLoginError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_SKEW_MS = 60_000;

export function defaultCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BRAINBASE_CREDENTIALS_FILE?.trim();
  if (configured) return configured;
  return join(env.HOME || homedir(), '.brainbase', 'credentials.json');
}

/**
 * The server URL a person typed, reduced to its origin. A bearer token is only
 * ever sent over HTTPS, or over HTTP to this machine's loopback address.
 */
export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BrainbaseLoginError('login_server_invalid', `Not a URL: ${value}`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new BrainbaseLoginError('login_server_transport_unsafe', 'The server must use https (http is allowed only for localhost).');
  }
  if (url.username || url.password) {
    throw new BrainbaseLoginError('login_server_invalid', 'The server URL must not contain a user name or password.');
  }
  return url.origin;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown> | null }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json };
}

/** The `exp` claim of a JWT, read without verifying it (the server verifies). */
export function jwtExpiryMs(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = (claims as { exp?: unknown })?.exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function expiryIso(token: string, expiresInSeconds: unknown, now: number): string {
  const fromToken = jwtExpiryMs(token);
  if (fromToken !== undefined) return new Date(fromToken).toISOString();
  if (typeof expiresInSeconds === 'number' && expiresInSeconds > 0) {
    return new Date(now + expiresInSeconds * 1000).toISOString();
  }
  throw new BrainbaseLoginError('login_token_expiry_missing', 'The server did not say when the token expires. Nothing was saved.');
}

export async function readCredentials(path = defaultCredentialsPath()): Promise<BrainbaseCredentials | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrainbaseLoginError('login_credentials_invalid', `Saved login is not valid JSON: ${path}. Run brainbase login again.`);
  }
  const value = parsed as Partial<BrainbaseCredentials> | null;
  if (!value || value.schema_version !== CREDENTIALS_SCHEMA_VERSION
    || typeof value.server_url !== 'string' || typeof value.access_token !== 'string' || !value.access_token
    || typeof value.expires_at !== 'string' || Number.isNaN(Date.parse(value.expires_at))) {
    throw new BrainbaseLoginError('login_credentials_invalid', `Saved login is not usable: ${path}. Run brainbase login again.`);
  }
  return value as BrainbaseCredentials;
}

export async function writeCredentials(path: string, credentials: BrainbaseCredentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function removeCredentials(path = defaultCredentialsPath()): Promise<boolean> {
  const existed = (await readCredentials(path).catch(() => ({}))) !== null;
  await rm(path, { force: true });
  return existed;
}

/**
 * Runs the Device Code Flow against `serverUrl` and saves the person token.
 * Asks for a receipt so the server issues the token once and forgets it only
 * after this machine has stored it.
 */
export async function loginWithDeviceCode(options: LoginOptions): Promise<BrainbaseCredentials> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath();
  const codeVerifier = randomBytes(32).toString('base64url');

  let start;
  try {
    start = await postJson(fetchImpl, `${serverUrl}/api/auth/device/code`, {
      code_verifier: codeVerifier,
      receipt_required: true,
    });
  } catch {
    throw new BrainbaseLoginError('login_server_unreachable', `Cannot reach ${serverUrl}. Nothing was saved.`);
  }
  if (start.status === 404) {
    throw new BrainbaseLoginError('login_device_flow_unavailable', `${serverUrl} does not offer terminal login (HTTP 404). Nothing was saved.`);
  }
  const deviceCode = start.json?.device_code;
  const verificationUri = start.json?.verification_uri;
  if (!start.ok || typeof deviceCode !== 'string' || !deviceCode || typeof verificationUri !== 'string') {
    throw new BrainbaseLoginError('login_device_code_failed', `The server refused to start a login (HTTP ${start.status}). Nothing was saved.`);
  }
  const expiresInSeconds = typeof start.json?.expires_in === 'number' ? start.json.expires_in : 300;
  let intervalMs = (typeof start.json?.interval === 'number' && start.json.interval > 0 ? start.json.interval : 5) * 1000;
  options.onPrompt({
    verificationUri,
    ...(typeof start.json?.verification_uri_complete === 'string'
      ? { verificationUriComplete: start.json.verification_uri_complete } : {}),
    ...(typeof start.json?.user_code === 'string' ? { userCode: start.json.user_code } : {}),
    expiresInSeconds,
  });

  const deadline = now() + expiresInSeconds * 1000;
  while (now() < deadline) {
    await sleep(intervalMs);
    let poll;
    try {
      poll = await postJson(fetchImpl, `${serverUrl}/api/auth/device/token`, {
        device_code: deviceCode,
        code_verifier: codeVerifier,
      });
    } catch {
      continue; // A dropped poll is retried until the code expires.
    }
    const error = poll.json?.error;
    if (!poll.ok) {
      if (error === 'authorization_pending') {
        options.onWaiting?.();
        continue;
      }
      if (error === 'slow_down') {
        intervalMs += 5000;
        continue;
      }
      if (error === 'access_denied') {
        throw new BrainbaseLoginError('login_denied', 'The login was denied in the browser. Nothing was saved.');
      }
      if (error === 'expired_token') {
        throw new BrainbaseLoginError('login_expired', 'The login code expired or was already used. Run brainbase login again.');
      }
      if (typeof error === 'string' && /^[a-z_]{1,40}$/u.test(error)) {
        throw new BrainbaseLoginError(`login_${error}`, `The server refused the login (${error}). Nothing was saved.`);
      }
      continue;
    }
    const accessToken = poll.json?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new BrainbaseLoginError('login_token_response_invalid', 'The server answered without a token. Nothing was saved.');
    }
    const refreshToken = poll.json?.refresh_token;
    const credentials: BrainbaseCredentials = {
      schema_version: CREDENTIALS_SCHEMA_VERSION,
      server_url: serverUrl,
      access_token: accessToken,
      ...(typeof refreshToken === 'string' && refreshToken ? { refresh_token: refreshToken } : {}),
      expires_at: expiryIso(accessToken, poll.json?.expires_in, now()),
    };
    await writeCredentials(credentialsPath, credentials);
    const receiptToken = poll.json?.receipt_token;
    if (typeof receiptToken === 'string' && receiptToken) {
      // Tells the server the token is stored, so it stops handing it out.
      // A lost receipt only leaves the code to expire on its own.
      await postJson(fetchImpl, `${serverUrl}/api/auth/device/received`, {
        device_code: deviceCode,
        receipt_token: receiptToken,
      }).catch(() => undefined);
    }
    return credentials;
  }
  throw new BrainbaseLoginError('login_timeout', 'The login was not approved in time. Run brainbase login again.');
}

async function refreshCredentials(
  credentials: BrainbaseCredentials,
  credentialsPath: string,
  fetchImpl: FetchLike,
  now: number,
): Promise<BrainbaseCredentials> {
  if (!credentials.refresh_token) {
    throw new BrainbaseLoginError('login_expired', 'The saved login has expired. Run brainbase login again.');
  }
  let result;
  try {
    result = await postJson(fetchImpl, `${credentials.server_url}/api/auth/refresh`, {
      refresh_token: credentials.refresh_token,
    });
  } catch {
    throw new BrainbaseLoginError('login_refresh_unreachable', `Cannot reach ${credentials.server_url} to renew the login.`);
  }
  const token = result.json?.token ?? result.json?.access_token;
  if (!result.ok || typeof token !== 'string' || !token) {
    if (result.status === 503) {
      throw new BrainbaseLoginError('login_refresh_unavailable', 'The server could not renew the login right now. Try again.');
    }
    throw new BrainbaseLoginError('login_expired', 'The saved login can no longer be renewed. Run brainbase login again.');
  }
  const nextRefresh = result.json?.refresh_token;
  const next: BrainbaseCredentials = {
    ...credentials,
    access_token: token,
    ...(typeof nextRefresh === 'string' && nextRefresh ? { refresh_token: nextRefresh } : {}),
    expires_at: expiryIso(token, result.json?.expires_in, now),
  };
  await writeCredentials(credentialsPath, next);
  return next;
}

/**
 * The person token for this machine, renewed first when it is about to expire.
 * Fails with a `login_*` code when there is no usable login.
 */
export async function getAccessToken(options: AccessTokenOptions = {}): Promise<{ token: string; serverUrl: string }> {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath();
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const skew = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const credentials = await readCredentials(credentialsPath);
  if (!credentials) {
    throw new BrainbaseLoginError('login_missing', 'Not logged in. Run brainbase login --server <url>.');
  }
  if (Date.parse(credentials.expires_at) - skew > now()) {
    return { token: credentials.access_token, serverUrl: credentials.server_url };
  }
  try {
    const next = await refreshCredentials(credentials, credentialsPath, fetchImpl, now());
    return { token: next.access_token, serverUrl: next.server_url };
  } catch (error) {
    // Two processes may renew at once and the server may rotate the refresh
    // token. When another process already stored a fresh token, use it.
    const latest = await readCredentials(credentialsPath).catch(() => null);
    if (latest && latest.access_token !== credentials.access_token
      && Date.parse(latest.expires_at) - skew > now()) {
      return { token: latest.access_token, serverUrl: latest.server_url };
    }
    throw error;
  }
}
