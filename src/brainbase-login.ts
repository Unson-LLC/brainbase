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
import { link, mkdir, open, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CREDENTIALS_SCHEMA_VERSION = 'brainbase-credentials-v1';

export interface BrainbaseCredentials {
  schema_version: typeof CREDENTIALS_SCHEMA_VERSION;
  /**
   * Random id of the `brainbase login` that produced this file. A renewal
   * keeps it; a new login replaces it. A renewal only writes back over the
   * same login, so a logout or a switch to another account is never undone.
   */
  login_id: string;
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
// A renewal holds the lock across its request, so a waiter waits longer than
// one request can take.
const LOCK_WAIT_MS = REQUEST_TIMEOUT_MS + 5_000;
const LOCK_STALE_MS = 10_000;
const LOCK_HEARTBEAT_MS = 2_000;

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
  const unusable = () => new BrainbaseLoginError('login_credentials_invalid', `Saved login is not usable: ${path}. Run brainbase login again.`);
  if (!value || value.schema_version !== CREDENTIALS_SCHEMA_VERSION
    || typeof value.login_id !== 'string' || !value.login_id
    || typeof value.server_url !== 'string' || typeof value.access_token !== 'string' || !value.access_token
    || typeof value.expires_at !== 'string' || Number.isNaN(Date.parse(value.expires_at))) {
    throw unusable();
  }
  // The saved server receives the refresh token, so it must pass the same
  // transport check as the server typed at login.
  let normalized: string;
  try {
    normalized = normalizeServerUrl(value.server_url);
  } catch {
    throw unusable();
  }
  if (normalized !== value.server_url) throw unusable();
  return value as BrainbaseCredentials;
}

export function newLoginId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Fsync on a directory: true once it is flushed, false on a platform or file
 * system that cannot flush directories. Any other failure is an I/O error and
 * is thrown.
 */
async function syncDirectory(directory: string): Promise<boolean> {
  if (process.platform === 'win32') return false; // Directories cannot be opened for fsync there.
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
    return true;
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(String((error as NodeJS.ErrnoException)?.code))) return false;
    throw error;
  } finally {
    await handle.close();
  }
}

const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);

/**
 * Creates the directory (0700) when it is missing. A new directory only
 * survives a crash once the directory holding it is flushed, so every
 * directory created here is flushed in its parent, from the top down.
 * Returns false when some directory could not be flushed.
 */
async function ensureDirectory(directory: string): Promise<boolean> {
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!firstCreated) return true;
  const chain: string[] = [];
  for (let current = directory; ; current = dirname(current)) {
    chain.unshift(current);
    if (current === firstCreated || dirname(current) === current) break;
  }
  let durable = await syncDirectory(dirname(firstCreated));
  for (const created of chain) durable = (await syncDirectory(created)) && durable;
  return durable;
}

export interface WriteCredentialsOptions {
  /** The lock this write runs under; checked to be still held right before the file is replaced. */
  lock?: CredentialsLock;
}

/**
 * Writes the file atomically: data and rename are flushed to disk before this
 * returns. A new file is 0600, a new directory 0700. `durable` is false when
 * the platform could not flush a directory, so the rename may not survive a
 * crash; a real I/O error is thrown instead.
 */
export async function writeCredentials(
  path: string,
  credentials: BrainbaseCredentials,
  options: WriteCredentialsOptions = {},
): Promise<{ durable: boolean }> {
  const directory = dirname(path);
  const directoryDurable = await ensureDirectory(directory);
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (options.lock) await options.lock.assertHeld();
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const renameDurable = await syncDirectory(directory);
  return { durable: directoryDurable && renameDurable && (options.lock?.directoryDurable ?? true) };
}

export interface CredentialsLock {
  /** Fails with `login_lock_lost` when the lock file no longer carries this holder's id. */
  assertHeld(): Promise<void>;
  /** False when the credentials directory was created but could not be flushed. */
  readonly directoryDurable: boolean;
}

export interface LockTiming {
  /** A lock whose file was not touched for this long belongs to a process that died. */
  staleMs: number;
  /** How often the holder touches the lock file while it works. */
  heartbeatMs: number;
  /** How long to wait for another holder before failing with `login_busy`. */
  waitMs: number;
}

const DEFAULT_LOCK_TIMING: LockTiming = { staleMs: LOCK_STALE_MS, heartbeatMs: LOCK_HEARTBEAT_MS, waitMs: LOCK_WAIT_MS };

async function readLockOwner(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Removes the lock file only when it carries `owner`. The file is first moved
 * aside, so it cannot change between the check and the removal; a file that
 * turns out to belong to someone else is linked back (link never overwrites).
 */
async function removeLockIfOwner(lockPath: string, owner: string): Promise<void> {
  const aside = `${lockPath}.${randomBytes(4).toString('hex')}.release`;
  try {
    await rename(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
  try {
    if ((await readLockOwner(aside)) !== owner) {
      await link(aside, lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error?.code !== 'EEXIST') throw error;
      });
    }
  } finally {
    await rm(aside, { force: true });
  }
}

/**
 * Serialises changes to the credentials file between processes on this
 * machine: login, logout, and a renewal from its request to its write-back.
 * The lock file carries a random id of its holder. The holder touches it every
 * `heartbeatMs` while it works, so a lock is only taken over when its holder
 * stopped touching it for `staleMs` (the process died). Only the holder
 * removes the lock, and a write under the lock checks it is still held.
 */
export async function withCredentialsLock<T>(
  path: string,
  task: (lock: CredentialsLock) => Promise<T>,
  timing: Partial<LockTiming> = {},
): Promise<T> {
  const { staleMs, heartbeatMs, waitMs } = { ...DEFAULT_LOCK_TIMING, ...timing };
  const directoryDurable = await ensureDirectory(dirname(path));
  const lockPath = `${path}.lock`;
  const owner = randomBytes(16).toString('hex');
  const started = Date.now();
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      const [holder, age] = await Promise.all([
        readLockOwner(lockPath),
        stat(lockPath).then((info) => Date.now() - info.mtimeMs, () => 0),
      ]);
      if (holder !== null && age > staleMs) {
        await removeLockIfOwner(lockPath, holder);
        continue;
      }
      if (Date.now() - started > waitMs) {
        throw new BrainbaseLoginError('login_busy', 'Another brainbase process is changing the saved login. Try again.');
      }
      await defaultSleep(25);
      continue;
    }
    try {
      await handle.writeFile(owner, 'utf8');
    } finally {
      await handle.close();
    }
    break;
  }
  const lock: CredentialsLock = {
    directoryDurable,
    async assertHeld() {
      if ((await readLockOwner(lockPath)) !== owner) {
        throw new BrainbaseLoginError('login_lock_lost', 'Another brainbase process took over the saved login. Run the command again.');
      }
    },
  };
  let touching = Promise.resolve();
  const heartbeat = setInterval(() => {
    touching = touching.then(async () => {
      if ((await readLockOwner(lockPath).catch(() => null)) !== owner) return;
      const now = new Date();
      await utimes(lockPath, now, now).catch(() => undefined);
    });
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    return await task(lock);
  } finally {
    clearInterval(heartbeat);
    await touching;
    await removeLockIfOwner(lockPath, owner);
  }
}

export async function removeCredentials(path = defaultCredentialsPath()): Promise<boolean> {
  return withCredentialsLock(path, async (lock) => {
    const existed = (await readCredentials(path).catch(() => ({}))) !== null;
    await lock.assertHeld();
    await rm(path, { force: true });
    return existed;
  });
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
      if (poll.status >= 500) {
        continue; // A passing server error is retried until the code expires.
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
      login_id: newLoginId(),
      server_url: serverUrl,
      access_token: accessToken,
      ...(typeof refreshToken === 'string' && refreshToken ? { refresh_token: refreshToken } : {}),
      expires_at: expiryIso(accessToken, poll.json?.expires_in, now()),
    };
    // The receipt lets the server forget the token, so it goes out only once
    // the file is known to be on disk. Where a directory cannot be flushed,
    // no receipt is sent and the code expires on its own.
    let saved;
    try {
      saved = await withCredentialsLock(credentialsPath, (lock) => writeCredentials(credentialsPath, credentials, { lock }));
    } catch (error) {
      if (error instanceof BrainbaseLoginError) throw error;
      throw new BrainbaseLoginError('login_save_failed', `Could not save the login to ${credentialsPath} (${(error as NodeJS.ErrnoException)?.code ?? 'error'}). Run brainbase login again.`);
    }
    const receiptToken = poll.json?.receipt_token;
    if (saved.durable && typeof receiptToken === 'string' && receiptToken) {
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

async function requestRenewal(
  credentials: BrainbaseCredentials & { refresh_token: string },
  fetchImpl: FetchLike,
  now: () => number,
): Promise<BrainbaseCredentials> {
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
  return {
    ...credentials,
    access_token: token,
    ...(typeof nextRefresh === 'string' && nextRefresh ? { refresh_token: nextRefresh } : {}),
    expires_at: expiryIso(token, result.json?.expires_in, now()),
  };
}

function sameLogin(a: BrainbaseCredentials, b: BrainbaseCredentials): boolean {
  return a.login_id === b.login_id && a.server_url === b.server_url;
}

function isFresh(credentials: BrainbaseCredentials, now: number, skew: number): boolean {
  return Date.parse(credentials.expires_at) - skew > now;
}

function usableWithoutRenewal(credentials: BrainbaseCredentials, now: number): { token: string; serverUrl: string } {
  // Nothing can renew it, so it is used until it actually expires.
  if (Date.parse(credentials.expires_at) > now) {
    return { token: credentials.access_token, serverUrl: credentials.server_url };
  }
  throw new BrainbaseLoginError('login_expired', 'The saved login has expired. Run brainbase login again.');
}

/**
 * The person token for this machine, renewed first when it is about to expire.
 * Fails with a `login_*` code when there is no usable login.
 *
 * A renewal holds the credentials lock from its request to its write-back, so
 * two renewals never race on a rotating refresh token, and a logout or another
 * login waits for it and then wins.
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
  if (isFresh(credentials, now(), skew)) {
    return { token: credentials.access_token, serverUrl: credentials.server_url };
  }
  if (!credentials.refresh_token) return usableWithoutRenewal(credentials, now());
  return withCredentialsLock(credentialsPath, async (lock) => {
    // Read again under the lock: another process may have renewed, logged out
    // or logged in as someone else while this one waited.
    const latest = await readCredentials(credentialsPath).catch(() => null);
    if (!latest || !sameLogin(latest, credentials)) {
      throw new BrainbaseLoginError('login_changed', 'The saved login changed while it was being renewed. Run the command again.');
    }
    if (isFresh(latest, now(), skew)) return { token: latest.access_token, serverUrl: latest.server_url };
    if (!latest.refresh_token) return usableWithoutRenewal(latest, now());
    const next = await requestRenewal(latest as BrainbaseCredentials & { refresh_token: string }, fetchImpl, now);
    await writeCredentials(credentialsPath, next, { lock });
    return { token: next.access_token, serverUrl: next.server_url };
  });
}
