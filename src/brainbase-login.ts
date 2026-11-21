// `brainbase login`: a person signs in from the terminal with the Device Code
// Flow of their Brainbase API, and the CLI keeps the resulting person token on
// this machine. Hooks and commands then ask `getAccessToken` for a token
// instead of reading one from an environment variable; an expired token is
// renewed with the stored refresh token.
//
// The token is the same person JWT the Web login issues, so a hosted MCP that
// verifies it through the API treats it as that person. Nothing here carries a
// default server: the person names their own server once at login.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';

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
// A renewal holds the lock across its requests, so a waiter waits longer than
// they can take: a CSRF token and the refresh, asked once more when another
// API instance refuses the CSRF token, so up to four requests.
const RENEWAL_MAX_REQUESTS = 4;
const LOCK_WAIT_MS = RENEWAL_MAX_REQUESTS * REQUEST_TIMEOUT_MS + 5_000;
const LOCK_UNREADABLE_STALE_MS = 10_000;

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

type JsonResult = {
  status: number;
  ok: boolean;
  json: Record<string, unknown> | null;
  /** The connection broke before the whole body was read. */
  bodyLost?: true;
};

async function readJson(response: Response): Promise<JsonResult> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { status: response.status, ok: response.ok, json: null, bodyLost: true };
  }
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json };
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<JsonResult> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return readJson(response);
}

/**
 * The Brainbase API checks a CSRF token on every POST outside the device-flow
 * paths, `/api/auth/refresh` included. It hands one out at
 * `GET /api/csrf-token` for the `x-session-id` sent with it, and expects both
 * back as `x-session-id` and `x-csrf-token` (the same steps as the
 * organization client). A server without that endpoint (404) gets no headers.
 */
async function csrfHeaders(fetchImpl: FetchLike, serverUrl: string): Promise<Record<string, string>> {
  const sessionId = `brainbase-login-${randomUUID()}`;
  let result: JsonResult;
  try {
    result = await readJson(await fetchImpl(`${serverUrl}/api/csrf-token`, {
      method: 'GET',
      headers: { 'x-session-id': sessionId },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }));
  } catch {
    throw new BrainbaseLoginError('login_refresh_unreachable', `Cannot reach ${serverUrl} to renew the login.`);
  }
  if (result.status === 404) return {};
  const token = result.json?.token;
  if (!result.ok || typeof token !== 'string' || !token) {
    throw new BrainbaseLoginError('login_refresh_unavailable', 'The server could not renew the login right now. Try again.');
  }
  return { 'x-session-id': sessionId, 'x-csrf-token': token };
}

function isCsrfRefusal(result: JsonResult): boolean {
  const message = result.json?.message;
  return result.status === 403 && typeof message === 'string' && /csrf/iu.test(message);
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
  const text = await readCredentialsText(path);
  return text === null ? null : parseCredentials(text, path);
}

/**
 * The saved login's text, read from the same file that saves, locks and
 * logout act on (see physicalPath); null when there is none. A saved login
 * that is a symbolic link is refused, also when it is swapped in between.
 */
async function readCredentialsText(path: string): Promise<string | null> {
  let target: string;
  try {
    target = await physicalPath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; // Its folder is not there.
    throw error;
  }
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw symbolicLinkRefused(path);
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) throw notAFile(path);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function parseCredentials(text: string, path: string): BrainbaseCredentials {
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

const DIRECTORY_OPEN_REFUSED = new Set(['EACCES', 'EPERM']);

/**
 * Flushes `directory` and the directories above it that hold an entry of this
 * user's: walking up, it flushes each directory, and stops after the first one
 * that this user does not own (that one holds the entry of the topmost
 * directory the user may have created). It does not matter who created a
 * directory or when: one made by another process a moment ago, or left by a
 * save whose flush failed, is flushed again. Returns false when some
 * directory could not be flushed.
 */
async function syncDirectoryChain(directory: string): Promise<boolean> {
  if (process.platform === 'win32') return false; // Directories cannot be opened for fsync there.
  const uid = process.getuid?.();
  let durable = true;
  // Callers pass the physical directory (see physicalPath), so each dirname()
  // is the real parent: no '.', no '..', no symbolic link left to resolve.
  for (let current = directory; ; current = dirname(current)) {
    try {
      durable = (await syncDirectory(current)) && durable;
    } catch (error) {
      if (!DIRECTORY_OPEN_REFUSED.has(String((error as NodeJS.ErrnoException)?.code))) throw error;
      durable = false;
    }
    if (dirname(current) === current || uid === undefined) break;
    if ((await stat(current)).uid !== uid) break;
  }
  return durable;
}

/**
 * The path the OS actually uses for `path`, with its directory resolved to
 * the real one: symbolic links followed and '.' and '..' applied the way the
 * OS applies them (a string resolve() would drop `link/..` instead). Changes
 * and flushes then go to the same directory. The directory must exist.
 */
async function physicalPath(path: string): Promise<string> {
  assertCredentialsFilePath(path);
  const target = join(await realpath(dirname(path)), basename(path));
  await assertNotSymbolicLink(target, path);
  return target;
}

/**
 * The saved login itself must not be a symbolic link. Reading follows a link
 * while rename() and rm() replace or remove the link itself, so a save would
 * split the login into two files and a logout would leave the linked file
 * behind with its tokens. Refused before anything is read, saved or removed.
 */
async function assertNotSymbolicLink(target: string, path: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw symbolicLinkRefused(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
}

function symbolicLinkRefused(path: string): BrainbaseLoginError {
  return new BrainbaseLoginError('login_credentials_path_symlink',
    `The saved-login path is a symbolic link: ${JSON.stringify(path)}. Give the real file with --credentials. Nothing was changed.`);
}

function notAFile(path: string): BrainbaseLoginError {
  return new BrainbaseLoginError('login_credentials_path_invalid',
    `The saved-login path is not a file: ${JSON.stringify(path)}. Nothing was changed.`);
}

/**
 * The saved login is a file, so its path must name one. `dir/` or `dir/.`
 * would otherwise lose its last part in dirname()/basename() and point at a
 * different file (logout would delete `dir`'s neighbour). Refused before any
 * lock or file is touched.
 */
export function assertCredentialsFilePath(path: string): void {
  const name = basename(path);
  if (!path || path.endsWith('/') || path.endsWith(sep) || name === '' || name === '.' || name === '..') {
    throw new BrainbaseLoginError('login_credentials_path_invalid',
      `The saved-login path must name a file, not a folder: ${JSON.stringify(path)}. Nothing was changed.`);
  }
}

export interface WriteCredentialsOptions {
  /** The lock this write runs under; checked to be still held right before the file is replaced. */
  lock?: CredentialsLock;
}

/**
 * Writes the file atomically: data and rename are flushed to disk, and so are
 * the directories above it that hold this user's entries, before this
 * returns. A new file is 0600, a new directory 0700. `durable` is false when
 * the platform could not flush a directory, so the file may not survive a
 * crash; a real I/O error is thrown instead.
 */
export async function writeCredentials(
  path: string,
  credentials: BrainbaseCredentials,
  options: WriteCredentialsOptions = {},
): Promise<{ durable: boolean }> {
  assertCredentialsFilePath(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const target = await physicalPath(path);
  const directory = dirname(target);
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.lock) await options.lock.assertHeld();
    await rename(temporary, target);
  } catch (error) {
    // No copy of the login is left behind when the save fails.
    await rm(temporary, { force: true });
    throw error;
  }
  return { durable: await syncDirectoryChain(directory) };
}

export interface CredentialsLock {
  /** Fails with `login_lock_lost` when the lock file no longer carries this holder's id. */
  assertHeld(): Promise<void>;
}

export interface LockTiming {
  /**
   * A lock file that is not a lock record (nothing this code writes) is
   * removed once it is this old.
   */
  unreadableStaleMs: number;
  /** How long to wait for another holder before failing with `login_busy`. */
  waitMs: number;
  /** Appended to the real path of the locked file to name the lock (default `.lock`). */
  suffix?: string;
}

const DEFAULT_LOCK_TIMING: LockTiming = { unreadableStaleMs: LOCK_UNREADABLE_STALE_MS, waitMs: LOCK_WAIT_MS };

interface LockRecord {
  owner: string;
  pid: number;
  host: string;
  /** When the holding process started (see processStart); absent in older locks. */
  start?: string;
}

const execFileAsync = promisify(execFile);

/**
 * An identity of the start of process `pid`, so that a process id the system
 * has handed to another process since is told apart from the holder. On Linux
 * it is the boot id and the start time in clock ticks from /proc; elsewhere the
 * start time `ps` reports. Null when it cannot be read, and always on Windows:
 * a lock there is only taken over when its process id runs no process.
 */
async function processStart(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      // Field 22 (starttime); the fields after the ')' that closes comm start at field 3.
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      return ticks ? `linux:${boot}:${ticks}` : null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      timeout: 5000,
      // Fixed locale and zone, so every process prints the same start the same way.
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    });
    const value = stdout.trim();
    return value ? `ps:${value}` : null;
  } catch {
    return null;
  }
}

let ownStart: Promise<string | null> | undefined;

async function readRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

function parseLockRecord(raw: string): LockRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<LockRecord> | null;
    if (value && typeof value.owner === 'string' && Number.isInteger(value.pid) && typeof value.host === 'string'
      && (value.start === undefined || typeof value.start === 'string')) {
      return value as LockRecord;
    }
  } catch {
    // not a lock record
  }
  return null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * True only when the holder is known to be gone: on this machine, its process
 * id runs no process, or runs one that started at another time than the one
 * recorded (the id was reused, for instance after a crash and a reboot). A
 * live holder never loses its lock, however long it works, so nothing has to
 * be re-checked between a check and a write. A lock held from another machine
 * is never taken over, nor one whose start cannot be read and compared.
 */
async function isAbandoned(path: string, raw: string, unreadableStaleMs: number): Promise<boolean> {
  const record = parseLockRecord(raw);
  if (!record) {
    const age = await stat(path).then((info) => Date.now() - info.mtimeMs, () => 0);
    return age > unreadableStaleMs;
  }
  if (record.host !== hostname()) return false;
  if (!processAlive(record.pid)) return true;
  if (record.start === undefined) return false;
  const current = await processStart(record.pid);
  return current !== null && current !== record.start;
}

/**
 * Creates `path` holding `content`, only when it does not exist yet. The
 * content is written first and linked into place, so the file is never seen
 * empty. Returns false when the file already exists.
 */
async function createExclusive(path: string, content: string): Promise<boolean> {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.new`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') return false;
    if (code && NO_HARD_LINK_CODES.has(code)) throw storageUnsupported(dirname(path), code);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

/** What link() answers on a file system without hard links (exFAT, FAT32, some network shares). */
const NO_HARD_LINK_CODES = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);

function storageUnsupported(directory: string, code: string): BrainbaseLoginError {
  return new BrainbaseLoginError('login_storage_unsupported',
    `The saved login needs a folder on a file system with hard links (such as APFS, ext4 or NTFS); ${directory} does not offer them (${code}). `
    + 'Pass --credentials with a path on such a file system, or leave it out to use the default under your home folder. Nothing was changed.');
}

/**
 * Fails with `login_storage_unsupported` when the folder of `path` cannot hold
 * the lock, before anything is asked of the server or of the person.
 */
export async function checkCredentialsStorage(path: string): Promise<void> {
  assertCredentialsFilePath(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const probe = `${await physicalPath(path)}.probe-${randomBytes(6).toString('hex')}`;
  try {
    await createExclusive(probe, '');
  } finally {
    await rm(probe, { force: true });
  }
}

async function lockRecord(owner: string): Promise<string> {
  ownStart ??= processStart(process.pid);
  const start = await ownStart;
  return JSON.stringify({ owner, pid: process.pid, host: hostname(), ...(start ? { start } : {}) } satisfies LockRecord);
}

/**
 * Removes the lock at `path`, which was seen holding `observed` from a holder
 * that is gone. Every process that wants to remove that same lock first takes
 * a takeover lock named after what it saw; only the one holding it reads the
 * file again and removes it, and only when it still holds `observed`. Nobody
 * else changes the file meanwhile: its holder is gone, a new lock cannot be
 * created while it exists, and the other takers wait for the takeover lock.
 * A takeover lock left by a taker that died is removed the same way.
 */
async function removeAbandoned(path: string, observed: string, unreadableStaleMs: number): Promise<boolean> {
  const guard = `${path}.takeover-${createHash('sha256').update(observed).digest('hex').slice(0, 16)}`;
  const owner = randomBytes(16).toString('hex');
  if (!(await createExclusive(guard, await lockRecord(owner)))) {
    const guardRaw = await readRaw(guard);
    if (guardRaw !== null && await isAbandoned(guard, guardRaw, unreadableStaleMs)) {
      await removeAbandoned(guard, guardRaw, unreadableStaleMs);
    }
    return false; // Another process is taking it over; the caller looks again.
  }
  try {
    const current = await readRaw(path);
    if (current === observed && await isAbandoned(path, current, unreadableStaleMs)) {
      await rm(path, { force: true });
    }
    return true;
  } finally {
    if (parseLockRecord((await readRaw(guard)) ?? '')?.owner === owner) await rm(guard, { force: true });
  }
}

function busy(lockPath: string, holder: string): BrainbaseLoginError {
  const record = parseLockRecord(holder);
  if (record && record.host !== hostname()) {
    return new BrainbaseLoginError('login_busy', `The saved login is locked from another machine (${record.host}). If nothing runs there, remove ${lockPath}.`);
  }
  if (record && record.start === undefined && process.platform === 'win32') {
    // Windows does not let this tell a crashed holder whose process id was
    // given to another program from a holder that still runs, so it waits.
    return new BrainbaseLoginError('login_busy',
      `Another brainbase process may be changing the saved login. On Windows, a lock left by a brainbase process that stopped cannot be told apart from a running one. If no brainbase command is running, remove ${lockPath} and try again.`);
  }
  return new BrainbaseLoginError('login_busy', 'Another brainbase process is changing the saved login. Try again.');
}

/**
 * Serialises changes to the credentials file between processes on this
 * machine: login, logout, and a renewal from its request to its write-back.
 * The lock file holds the holder's random id, process id and host name. It is
 * held until the holder removes it: another process only removes it when the
 * holder's process no longer runs, so the lock covers every read, write and
 * removal of the credentials file done under it.
 */
export async function withCredentialsLock<T>(
  path: string,
  task: (lock: CredentialsLock) => Promise<T>,
  timing: Partial<LockTiming> = {},
): Promise<T> {
  assertCredentialsFilePath(path);
  const { unreadableStaleMs, waitMs, suffix = '.lock' } = { ...DEFAULT_LOCK_TIMING, ...timing };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Every spelling of the same file takes the same lock.
  const lockPath = `${await physicalPath(path)}${suffix}`;
  const owner = randomBytes(16).toString('hex');
  const record = await lockRecord(owner);
  const started = Date.now();
  while (!(await createExclusive(lockPath, record))) {
    const holder = await readRaw(lockPath);
    if (holder === null) continue; // Released meanwhile.
    if (await isAbandoned(lockPath, holder, unreadableStaleMs)
      && await removeAbandoned(lockPath, holder, unreadableStaleMs)) continue;
    if (Date.now() - started > waitMs) throw busy(lockPath, holder);
    await defaultSleep(25);
  }
  const lock: CredentialsLock = {
    async assertHeld() {
      if ((await readRaw(lockPath)) !== record) {
        throw new BrainbaseLoginError('login_lock_lost', 'Another brainbase process took over the saved login. Run the command again.');
      }
    },
  };
  try {
    return await task(lock);
  } finally {
    // Nobody else removes a lock whose holder runs, so this is still ours
    // unless something outside brainbase replaced it.
    if ((await readRaw(lockPath).catch(() => null)) === record) await rm(lockPath, { force: true });
  }
}

export interface RemoveCredentialsResult {
  /** A saved login was there. */
  existed: boolean;
  /**
   * The removal is flushed to disk. False only where the platform cannot
   * flush a directory; a real I/O error is thrown instead.
   */
  durable: boolean;
}

/**
 * Whether `path` holds a saved login that logout may remove: false when no
 * file is there. A file that brainbase did not write (a mistyped
 * --credentials naming some other file) or that cannot be read is refused,
 * so logout never deletes it. A saved login that has become unusable still
 * counts while it carries brainbase's schema_version, so the person can log
 * out of a broken one.
 */
async function isSavedLogin(path: string): Promise<boolean> {
  let text: string | null;
  try {
    text = await readCredentialsText(path);
  } catch (error) {
    if (error instanceof BrainbaseLoginError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code ?? 'error';
    throw new BrainbaseLoginError('login_credentials_unreadable',
      `The saved login could not be read (${code}): ${path}. Nothing was removed.`);
  }
  if (text === null) return false;
  try {
    parseCredentials(text, path);
    return true;
  } catch {
    // Unusable: still ours if brainbase wrote it.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if ((parsed as { schema_version?: unknown } | null)?.schema_version === CREDENTIALS_SCHEMA_VERSION) return true;
  throw new BrainbaseLoginError('login_credentials_unrecognized',
    `This file is not a saved brainbase login: ${path}. It was left as it is. Check --credentials.`);
}

/**
 * Removes the saved login and flushes the directory that held it, under the
 * lock, before this returns. Without the flush, a power loss right after a
 * logout could bring the old login back. The directory is flushed even when
 * no file was there, since an earlier logout may have stopped before its flush.
 * Only a file that is a saved login is removed (see isSavedLogin); any other
 * file is left as it is and `login_credentials_unrecognized` is thrown.
 */
export async function removeCredentials(path = defaultCredentialsPath()): Promise<RemoveCredentialsResult> {
  assertCredentialsFilePath(path);
  return withCredentialsLock(path, async (lock) => {
    const existed = await isSavedLogin(path);
    // Remove and flush in the same, real directory (the lock made it exist).
    const target = await physicalPath(path);
    await lock.assertHeld();
    await rm(target, { force: true });
    const durable = await syncDirectory(dirname(target));
    return { existed, durable };
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
  // A folder that cannot hold the lock would only fail after the approval.
  await checkCredentialsStorage(credentialsPath);

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
    if (now() >= deadline) break; // A longer wait (slow_down) may have run past the code's expiry.
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
  const refresh = async () => {
    const headers = await csrfHeaders(fetchImpl, credentials.server_url);
    try {
      return await postJson(fetchImpl, `${credentials.server_url}/api/auth/refresh`, {
        refresh_token: credentials.refresh_token,
      }, headers);
    } catch {
      throw new BrainbaseLoginError('login_refresh_unreachable', `Cannot reach ${credentials.server_url} to renew the login.`);
    }
  };
  let result = await refresh();
  // The API keeps CSRF tokens in each server process, so a token handed out
  // by one instance can be refused by another. That says nothing about the
  // refresh token: ask once more, and otherwise report a retryable failure.
  if (isCsrfRefusal(result)) result = await refresh();
  const token = result.json?.token ?? result.json?.access_token;
  if (!result.ok || typeof token !== 'string' || !token) {
    // Overload and server errors say nothing about the refresh token: the saved
    // login stays and a later try may succeed.
    // An answer cut off in transit is no refusal either.
    if (result.status === 429 || result.status >= 500 || isCsrfRefusal(result) || result.bodyLost) {
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
