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
  const text = await readCredentialsText(path) ?? await readAfterSave(path) ?? await readAfterInterrupted(path);
  return text === null ? null : parseCredentials(text, path);
}

/**
 * A save that stopped after moving the saved login aside leaves no file at
 * the path. Nothing would ever put it back if reads only looked at the path,
 * so when such a file is there, the lock is taken (which rolls the save back,
 * see finishInterrupted) and the path is read again under it.
 */
async function readAfterInterrupted(path: string): Promise<string | null> {
  let target: string;
  try {
    target = await physicalPath(path);
  } catch {
    return null;
  }
  if (await isFree(replacingPath(target))) return null;
  return withCredentialsLock(path, (lock) => readCredentialsText(path, lock.target));
}

/** How long a read without the lock waits for a save in progress to put its file in place. */
const READ_DURING_SAVE_WAIT_MS = 1000;

/**
 * A save that replaces a saved login moves it aside before the new file is
 * linked into place (see placeCredentials), so a read without the lock may
 * find no file for a moment. When the lock is held meanwhile, this waits for
 * it to be released and reads again; when no save holds it, nothing is there.
 */
async function readAfterSave(path: string): Promise<string | null> {
  let target: string;
  try {
    target = await physicalPath(path);
  } catch {
    return null;
  }
  const started = Date.now();
  let waited = false;
  while (await readRaw(`${target}.lock`).catch(() => null) !== null) {
    if (Date.now() - started > READ_DURING_SAVE_WAIT_MS) break;
    waited = true;
    await defaultSleep(10);
  }
  return waited ? readCredentialsText(path) : null;
}

/**
 * The saved login's text, read from the same file that saves, locks and
 * logout act on (see physicalPath); null when there is none. A saved login
 * that is a symbolic link is refused, also when it is swapped in between.
 */
async function readCredentialsText(path: string, resolved?: string): Promise<string | null> {
  let target: string;
  try {
    target = resolved ?? await physicalPath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null; // Its folder is not there.
    throw error;
  }
  const read = await readRegularFile(target);
  if (read.kind === 'missing') return null;
  if (read.kind === 'symlink') throw symbolicLinkRefused(path);
  if (read.kind === 'other') throw notAFile(path);
  return read.text;
}

type RegularFileRead =
  | { kind: 'file'; text: string }
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'other' };

/** Opening without O_NONBLOCK would wait forever on a FIFO with no writer. */
const READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

/**
 * Reads `target` only when it is a regular file. It is opened without
 * following a symbolic link and without blocking, and its type is checked on
 * the open handle before anything is read, so a FIFO, a device or a socket at
 * the path never makes the command wait, and nothing swapped in between the
 * check and the read is read instead.
 */
async function readRegularFile(target: string): Promise<RegularFileRead> {
  let handle;
  try {
    handle = await open(target, READ_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { kind: 'missing' };
    if (code === 'ELOOP') return { kind: 'symlink' };
    // ENXIO: a FIFO opened for writing only; other kinds are opened and refused below.
    if (code === 'ENXIO') return { kind: 'other' };
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) return { kind: 'other' };
    return { kind: 'file', text: await handle.readFile('utf8') };
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
  if (RESERVED_SUFFIX.test(name)) {
    throw new BrainbaseLoginError('login_credentials_path_invalid',
      `The saved-login path ends in a name brainbase keeps for the lock and for a login moved aside while saving or logging out: ${JSON.stringify(path)}. Give another file name with --credentials. Nothing was changed.`);
  }
}

/**
 * Names brainbase derives from another saved login's path: its lock, the
 * login moved aside while saving or logging out, and the probe of the file
 * system. A saved login may not be at one of these, so recovering a stopped
 * save or logout (see finishInterrupted) never takes another saved login for
 * the one it moved aside. Case is ignored, as on macOS and Windows file systems.
 */
const RESERVED_SUFFIX = /\.(?:lock|replacing|removing|probe-[0-9a-f]+)$/iu;

/** Which file sits at a path: same values = the same file, unchanged. */
interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/**
 * Fails with `login_credentials_unrecognized` (or `_unreadable`, `_path_symlink`,
 * `_path_invalid`) unless `target` is free or holds a saved brainbase login,
 * so a save never replaces any other file. Returns null when nothing is
 * there, else which file was checked, so the save can make sure it replaces
 * that same file and nothing put there after the check.
 */
async function assertReplaceable(target: string, path: string, expected?: SavedLoginKey): Promise<FileIdentity | null> {
  const checked = await checkedSavedLogin(target, path);
  // Another login (or no login, or a login where there was none) was saved
  // since the caller looked: it stays, and this save is refused.
  if (expected !== undefined && checked.key !== expected) throw changedDuringSave(path);
  return checked.identity;
}

/**
 * Which saved login is at `target` and which file holds it. The file is
 * identified before and after its content is read: when both agree, the
 * content read is that file's, not one swapped in between. Throws like
 * savedLoginKey for a file that is no saved login.
 */
async function checkedSavedLogin(target: string, path: string): Promise<{ key: SavedLoginKey; identity: FileIdentity | null }> {
  const first = await identityOf(target, path);
  const key = await savedLoginKey(path, target);
  if (key === null) {
    // Nothing there: a file created later is caught by the exclusive link.
    if (first !== null) throw changedDuringSave(path);
    return { key, identity: null };
  }
  const second = await identityOf(target, path);
  if (first === null || second === null || !sameFile(first, second)) throw changedDuringSave(path);
  return { key, identity: second };
}

async function identityOf(target: string, path: string): Promise<FileIdentity | null> {
  try {
    const info = await lstat(target, { bigint: true });
    if (info.isSymbolicLink()) throw symbolicLinkRefused(path);
    if (!info.isFile()) throw notAFile(path);
    return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}

function changedDuringSave(path: string): BrainbaseLoginError {
  return new BrainbaseLoginError('login_changed',
    `Another program created or changed ${JSON.stringify(path)} while the login was being saved. That file was left as it is and the login was not saved. Check --credentials and run the command again.`);
}

/**
 * Puts the written `temporary` file at `target` without ever replacing a file
 * that was not checked. When nothing was at `target` at the check (`before`
 * is null), the file is linked into place, which fails instead of replacing a
 * file another program created meanwhile. When a saved login was there, it is
 * first moved aside in one step, so what is compared with `before` is exactly
 * the file taken away; only then is the new file linked into the now empty
 * path, again without replacing anything. A file another program put there
 * after the check is put back where it was and `login_changed` is thrown.
 * (rename() changes a file's ctime, so the moved file is compared by device,
 * inode, size and mtime.) A read without the lock that finds no file in
 * between waits for the lock (see readAfterSave).
 */
async function placeCredentials(temporary: string, target: string, path: string, before: FileIdentity | null): Promise<void> {
  if (before === null) {
    await linkNew(temporary, target, path);
    await rm(temporary, { force: true });
    return;
  }
  const aside = replacingPath(target);
  // A file left there would be replaced by the move below: finishInterrupted
  // runs whenever the lock is taken, so only a file it had to keep is there.
  await assertAsideFree(aside, path);
  try {
    await rename(target, aside);
  } catch (error) {
    // Gone since the check: removed by someone else, nothing is put there.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw changedDuringSave(path);
    throw error;
  }
  const moved = await identityOf(aside, path).catch(() => null);
  if (moved === null || moved.dev !== before.dev || moved.ino !== before.ino
    || moved.size !== before.size || moved.mtimeNs !== before.mtimeNs) {
    await putBack(aside, target, path);
    throw changedDuringSave(path);
  }
  try {
    await linkNew(temporary, target, path);
  } catch (error) {
    // A file created at the path meanwhile stays; else the checked login
    // goes back, so a failed save leaves the old login where it was.
    if (!(error instanceof BrainbaseLoginError && error.code === 'login_changed')) {
      await putBack(aside, target, path);
    } else {
      await rm(aside, { force: true });
    }
    throw error;
  }
  await rm(aside, { force: true });
  await rm(temporary, { force: true });
}

/** Links `source` to `target`, failing with `login_changed` instead of replacing a file there. */
async function linkNew(source: string, target: string, path: string): Promise<void> {
  try {
    await link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') throw changedDuringSave(path);
    if (code && NO_HARD_LINK_CODES.has(code)) throw storageUnsupported(dirname(target), code);
    throw error;
  }
}

/** Puts a file moved `aside` back at `target` without replacing anything created there meanwhile. */
async function putBack(aside: string, target: string, path: string): Promise<void> {
  try {
    await link(aside, target);
    await rm(aside, { force: true });
  } catch {
    throw new BrainbaseLoginError('login_changed',
      `Another program changed ${JSON.stringify(path)} while the login was being saved, and its file could not be put back. It was kept as ${JSON.stringify(aside)}. The login was not saved.`);
  }
}

/**
 * Where a save puts the checked login while it links the new one in, and
 * where a logout puts it before deleting it. The names are fixed, not random,
 * so a save or logout that stopped half way (the process was killed, the
 * machine lost power) leaves its file where the next holder of the lock looks
 * (see finishInterrupted). Only the holder of the lock uses them.
 */
function replacingPath(target: string): string {
  return `${target}.replacing`;
}

function removingPath(target: string): string {
  return `${target}.removing`;
}

/** Fails with `login_changed` when a file is at `aside`, so moving a login there never replaces it. */
async function assertAsideFree(aside: string, path: string): Promise<void> {
  try {
    await lstat(aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
  throw new BrainbaseLoginError('login_changed',
    `A file that is no saved brainbase login is at ${JSON.stringify(aside)}, where brainbase keeps a login while saving or logging out. It was left as it is and nothing was changed for ${JSON.stringify(path)}. Check that file, move it away, and run the command again.`);
}

/** What the lock holder found left by a save or logout that stopped half way. */
export interface InterruptedWork {
  /** A logout had moved the saved login aside: it was deleted now. */
  logoutFinished: boolean;
  /** A save had moved the saved login aside and placed nothing: it was put back. */
  saveRolledBack: boolean;
}

type AsideKind = 'login' | 'other-file' | 'other' | 'missing';

/**
 * What is at `aside`: a regular file holding a saved brainbase login, another
 * regular file, something that is no regular file (a link, a folder), or
 * nothing. It is read without following a link (see readRegularFile).
 */
async function asideKind(aside: string): Promise<AsideKind> {
  let info;
  try {
    info = await lstat(aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 'missing';
    throw error;
  }
  if (!info.isFile()) return 'other';
  try {
    return (await savedLoginKey(aside, aside)) === null ? 'missing' : 'login';
  } catch {
    return 'other-file';
  }
}

/** True when nothing is at `target`; a link or any other entry there counts as something. */
async function isFree(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
    throw error;
  }
}

/**
 * Brings back a consistent state after a save or logout that stopped half way.
 * Runs under the lock, right after it is taken, so it is never in the way of a
 * save or logout that is still running.
 *
 * - A logout's login left at `.removing`: the logout is finished by deleting
 *   it, so a retried logout leaves no token on the machine.
 * - A save's login left at `.replacing` with nothing at the path: the save
 *   stopped before its new file was linked in, so the old login is linked back
 *   and keeps working. With a file at the path, the save had placed its new
 *   file: the old login is deleted.
 * - A file there that is no saved brainbase login, or no regular file, was not
 *   put there by brainbase: no saved login may be at such a name (see
 *   assertCredentialsFilePath). It is left where it is, neither moved nor
 *   deleted, and the next save or logout fails while it is there (see
 *   assertAsideFree) instead of replacing it.
 */
async function finishInterrupted(target: string): Promise<InterruptedWork> {
  const done: InterruptedWork = { logoutFinished: false, saveRolledBack: false };
  let changed = false;
  for (const [aside, kind] of [[removingPath(target), 'logout'], [replacingPath(target), 'save']] as const) {
    if (await asideKind(aside) !== 'login') continue;
    if (kind === 'save' && await isFree(target)) {
      try {
        await link(aside, target);
        done.saveRolledBack = true;
      } catch (error) {
        // Created meanwhile by another program: that file stays.
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      }
    }
    await rm(aside, { force: true });
    if (kind === 'logout') done.logoutFinished = true;
    changed = true;
  }
  if (changed) await syncDirectory(dirname(target));
  return done;
}

/**
 * Where a save goes, resolved once: the physical file (see physicalPath) and
 * which folder holds it. A later lock taken with this destination refuses to
 * act on any other file or folder, so a folder on the path swapped for a link
 * (or for another folder) in between is caught instead of followed.
 */
export interface CredentialsDestination {
  readonly target: string;
  readonly folder: FolderIdentity;
}

/** Which folder sits at a path: same values = the same folder. */
export interface FolderIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

async function folderIdentity(directory: string): Promise<FolderIdentity> {
  const info = await stat(directory, { bigint: true });
  return { dev: info.dev, ino: info.ino };
}

function sameFolder(a: FolderIdentity, b: FolderIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function destinationChanged(): BrainbaseLoginError {
  return new BrainbaseLoginError('login_changed',
    'The folder of the saved login changed while it was locked or while the login waited. Nothing was changed. Run the command again.');
}

export interface CredentialsTargetCheck {
  /** The file and folder the save must go to; pass it to withCredentialsLock. */
  destination: CredentialsDestination;
  /**
   * Which saved login is there now (see SavedLoginKey); pass it to
   * writeCredentials as `expected`, so the save replaces only that login.
   */
  saved: SavedLoginKey;
}

/**
 * Fails before anything is asked of the server or of the person when a login
 * could not be saved to `path`: the file there is not a saved login, or the
 * lock cannot be taken because something that is no brainbase lock is in its
 * way. Returns where the save goes and which login is there, so the save
 * after the approval goes to the same file and replaces the same login.
 */
export async function checkCredentialsTarget(path: string): Promise<CredentialsTargetCheck> {
  return withCredentialsLock(path, async (lock) => ({
    destination: lock.destination,
    saved: await savedLoginKey(path, lock.target),
  }));
}

export interface WriteCredentialsOptions {
  /**
   * The lock this write runs under. The file it locked (lock.target) is the
   * one written, `path` must name that same file, and the lock is checked to
   * be still held, and to still lock that file, right before it is replaced.
   * Without a lock, the write takes one itself: every save runs under the lock.
   */
  lock?: CredentialsLock;
  /**
   * The saved login that may be replaced (see SavedLoginKey): null for "no
   * file there". Checked on the file itself right before it is replaced, so
   * a login saved by anyone else since the caller looked is never overwritten
   * (`login_changed`). Left out, any saved brainbase login may be replaced.
   */
  expected?: SavedLoginKey;
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
  const { lock } = options;
  // A save without the lock could land between another process's check and
  // its write (a renewal's read and write-back), so it takes the lock itself.
  if (!lock) return withCredentialsLock(path, (taken) => writeCredentials(path, credentials, { ...options, lock: taken }));
  const target = lock.target;
  // The lock must be the one for this file: a lock taken for another path
  // would make the write land in a file `path` does not name.
  await lock.assertHeld();
  if (await physicalPath(path) !== target) throw destinationChanged();
  // Only a saved login is ever replaced: a --credentials naming some other
  // file (a config, another tool's data, a lock) is left as it is.
  const before = await assertReplaceable(target, path, options.expected);
  await lock.assertHeld();
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
    await lock.assertHeld();
    await placeCredentials(temporary, target, path, before);
  } catch (error) {
    // No copy of the login is left behind when the save fails.
    await rm(temporary, { force: true });
    throw error;
  }
  return { durable: await syncDirectoryChain(directory) };
}

export interface CredentialsLock {
  /**
   * The saved-login file this lock covers, resolved once when the lock was
   * taken (see physicalPath). Everything done under the lock reads, writes and
   * removes this path, not a new resolution of the path it was asked for.
   */
  readonly target: string;
  /** lock.target with the folder that held it when the lock was taken. */
  readonly destination: CredentialsDestination;
  /**
   * What a save or logout that stopped half way had left, and was finished or
   * rolled back right after this lock was taken (see finishInterrupted).
   */
  readonly interrupted: InterruptedWork;
  /**
   * Fails with `login_lock_lost` when the lock file no longer carries this
   * holder's id, and with `login_changed` when the path the lock was taken for
   * now leads to another directory (a folder on it was replaced by a link or
   * by another folder).
   */
  assertHeld(): Promise<void>;
}

export interface LockTiming {
  /** How long to wait for another holder before failing with `login_busy`. */
  waitMs: number;
  /** Appended to the real path of the locked file to name the lock (default `.lock`). */
  suffix?: string;
}

export interface LockOptions extends LockTiming {
  /**
   * Where an earlier check resolved the path to (checkCredentialsTarget). The
   * lock is then taken only when the path still leads to that same file in
   * that same folder, and fails with `login_changed` otherwise: the work
   * under the lock never moves to a file the earlier check did not see.
   */
  destination?: CredentialsDestination;
}

const DEFAULT_LOCK_TIMING: LockTiming = { waitMs: LOCK_WAIT_MS };

interface LockRecord {
  /** Always LOCK_FORMAT. */
  format: typeof LOCK_FORMAT;
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

/**
 * A lock file's content, or null when there is none. Something at the path
 * that is not a regular file (a FIFO, a link, a folder) is not read: it gives
 * NOT_A_LOCK, which is no lock record, so it is never removed and only makes
 * the caller wait and report `login_busy`.
 */
async function readRaw(path: string): Promise<string | null> {
  const read = await readRegularFile(path).catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code === 'EISDIR') return { kind: 'other' } as const;
    throw error;
  });
  if (read.kind === 'missing') return null;
  return read.kind === 'file' ? read.text : NOT_A_LOCK;
}

/** What readRaw gives for a path that holds no regular file; no lock record ever equals it. */
const NOT_A_LOCK = '\u0000not-a-regular-file';

/**
 * What every lock file this code writes starts with. A file at a lock path is
 * only taken for a lock (and ever removed as an abandoned one) when it carries
 * exactly this format and exactly the fields lockRecord() writes, so another
 * tool's process record or any other JSON at that path is left as it is.
 */
const LOCK_FORMAT = 'brainbase-login-lock/v1';
const LOCK_KEYS = new Set(['format', 'owner', 'pid', 'host', 'start']);
const LOCK_OWNER_PATTERN = /^[0-9a-f]{32}$/;

function parseLockRecord(raw: string): LockRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null; // not a lock record
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !LOCK_KEYS.has(key))) return null;
  if (record.format !== LOCK_FORMAT) return null;
  if (typeof record.owner !== 'string' || !LOCK_OWNER_PATTERN.test(record.owner)) return null;
  if (typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0) return null;
  if (typeof record.host !== 'string' || !record.host) return null;
  if (record.start !== undefined && (typeof record.start !== 'string' || !record.start)) return null;
  // Byte for byte what lockRecord() writes, so a hand-edited or look-alike file is no lock.
  if (raw !== serializeLockRecord(record as unknown as LockRecord)) return null;
  return record as unknown as LockRecord;
}

function serializeLockRecord(record: LockRecord): string {
  const { owner, pid, host, start } = record;
  return JSON.stringify({ format: LOCK_FORMAT, owner, pid, host, ...(start !== undefined ? { start } : {}) });
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
 *
 * A file that is not a lock record is never taken over, however old: the
 * saved-login path is chosen freely, so the derived lock path can name a file
 * that is no lock at all (a config, another login's saved file). This code
 * links a lock file into place only once its content is written, so a lock
 * it made is always a record.
 */
async function isAbandoned(raw: string): Promise<boolean> {
  const record = parseLockRecord(raw);
  if (!record) return false;
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
  if (await createExclusive(probe, '')) await rm(probe, { force: true });
}

async function lockRecord(owner: string): Promise<string> {
  ownStart ??= processStart(process.pid);
  const start = await ownStart;
  return serializeLockRecord({ format: LOCK_FORMAT, owner, pid: process.pid, host: hostname(), ...(start ? { start } : {}) });
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
async function removeAbandoned(path: string, observed: string): Promise<boolean> {
  const guard = `${path}.takeover-${createHash('sha256').update(observed).digest('hex').slice(0, 16)}`;
  const owner = randomBytes(16).toString('hex');
  if (!(await createExclusive(guard, await lockRecord(owner)))) {
    const guardRaw = await readRaw(guard);
    if (guardRaw !== null && await isAbandoned(guardRaw)) {
      await removeAbandoned(guard, guardRaw);
    }
    return false; // Another process is taking it over; the caller looks again.
  }
  try {
    const current = await readRaw(path);
    if (current === observed && await isAbandoned(current)) {
      await rm(path, { force: true });
    }
    return true;
  } finally {
    if (parseLockRecord((await readRaw(guard)) ?? '')?.owner === owner) await rm(guard, { force: true });
  }
}

function busy(lockPath: string, holder: string): BrainbaseLoginError {
  const record = parseLockRecord(holder);
  if (!record) {
    return new BrainbaseLoginError('login_busy',
      `${lockPath} is in the way of the saved login's lock and is not a brainbase lock, so it was left as it is. `
      + 'If it is not needed, move it away; otherwise pass another path with --credentials.');
  }
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
  timing: Partial<LockOptions> = {},
): Promise<T> {
  assertCredentialsFilePath(path);
  const { waitMs, destination: pinned, suffix = '.lock' } = { ...DEFAULT_LOCK_TIMING, ...timing };
  // A pinned destination is a folder that was there: it is not made again.
  if (!pinned) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Every spelling of the same file takes the same lock, and the work under
  // the lock acts on this one resolution (lock.target).
  const target = await physicalPath(path).catch((error) => {
    if (pinned && (error as NodeJS.ErrnoException)?.code === 'ENOENT') throw destinationChanged();
    throw error;
  });
  const folder = await folderIdentity(dirname(target));
  if (pinned && (pinned.target !== target || !sameFolder(pinned.folder, folder))) throw destinationChanged();
  const destination: CredentialsDestination = { target, folder };
  const lockPath = `${target}${suffix}`;
  const owner = randomBytes(16).toString('hex');
  const record = await lockRecord(owner);
  const started = Date.now();
  while (!(await createExclusive(lockPath, record))) {
    const holder = await readRaw(lockPath);
    if (holder === null) continue; // Released meanwhile.
    // This code links a lock into place only once it is written, so a file
    // that is no lock record is no lock of a holder that is about to finish:
    // waiting would not free it.
    if (!parseLockRecord(holder)) throw busy(lockPath, holder);
    if (await isAbandoned(holder) && await removeAbandoned(lockPath, holder)) continue;
    if (Date.now() - started > waitMs) throw busy(lockPath, holder);
    await defaultSleep(25);
  }
  const release = async () => {
    // Nobody else removes a lock whose holder runs, so this is still ours
    // unless something outside brainbase replaced it.
    if ((await readRaw(lockPath).catch(() => null)) === record) await rm(lockPath, { force: true });
  };
  let interrupted: InterruptedWork;
  try {
    // Whoever takes the lock next finishes (or rolls back) a save or logout
    // that stopped half way, before anything else reads or writes the login.
    interrupted = await finishInterrupted(target);
  } catch (error) {
    await release();
    throw error;
  }
  const lock: CredentialsLock = {
    target,
    destination,
    interrupted,
    async assertHeld() {
      if ((await readRaw(lockPath)) !== record) {
        throw new BrainbaseLoginError('login_lock_lost', 'Another brainbase process took over the saved login. Run the command again.');
      }
      // A folder on the way may have been swapped for a link since the lock
      // was taken: then the path no longer leads to the locked file, nor does
      // the locked path itself lead to the same folder.
      const directory = dirname(target);
      const now = await Promise.all([realpath(directory), realpath(dirname(path)), folderIdentity(directory)]).catch(() => null);
      // The same real path can also name a new folder (the old one moved away
      // and another made in its place), so the folder itself is compared too.
      if (!now || now[0] !== directory || now[1] !== directory || !sameFolder(now[2], folder)) throw destinationChanged();
    },
  };
  try {
    return await task(lock);
  } finally {
    await release();
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
 * Which saved login a file holds, to tell whether it is still the same one:
 * `login:<login_id>` for a saved login (a renewal keeps it, any new login
 * gets a new one), `file:<sha256>` for a saved login too broken to carry a
 * login_id, null for no file.
 */
export type SavedLoginKey = string | null;

/**
 * The SavedLoginKey of the file at `path` (read at `target`): null when no
 * file is there. A file that brainbase did not write (a mistyped
 * --credentials naming some other file) or that cannot be read is refused,
 * so no save replaces it and logout never deletes it. A saved login that has
 * become unusable still counts while it carries brainbase's schema_version,
 * so the person can log out of a broken one.
 */
async function savedLoginKey(path: string, target?: string): Promise<SavedLoginKey> {
  let text: string | null;
  try {
    text = await readCredentialsText(path, target);
  } catch (error) {
    if (error instanceof BrainbaseLoginError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code ?? 'error';
    throw new BrainbaseLoginError('login_credentials_unreadable',
      `The saved login could not be read (${code}): ${path}. Nothing was removed.`);
  }
  if (text === null) return null;
  try {
    return loginKeyOf(parseCredentials(text, path));
  } catch {
    // Unusable: still ours if brainbase wrote it.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if ((parsed as { schema_version?: unknown } | null)?.schema_version === CREDENTIALS_SCHEMA_VERSION) {
    return `file:${createHash('sha256').update(text).digest('hex')}`;
  }
  throw new BrainbaseLoginError('login_credentials_unrecognized',
    `This file is not a saved brainbase login: ${path}. It was left as it is. Check --credentials.`);
}

/** The SavedLoginKey of a login: equal for the login and its renewals. */
export function loginKeyOf(credentials: BrainbaseCredentials): SavedLoginKey {
  return `login:${credentials.login_id}`;
}

/**
 * Removes the file at `target` only when it is the file that was checked
 * (`checked`). It is first moved aside in one step, so what is compared is
 * exactly the file taken away: when another program replaced the saved login
 * after the check, its file is put back where it was and `login_changed` is
 * thrown. (rename() changes a file's ctime, so the moved file is compared by
 * device, inode, size and mtime.)
 */
async function removeCheckedFile(target: string, path: string, checked: FileIdentity): Promise<void> {
  const aside = removingPath(target);
  await assertAsideFree(aside, path);
  try {
    await rename(target, aside);
  } catch (error) {
    // Gone since the check: removed by someone else, nothing of ours is left.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw changedDuringRemove(path);
    throw error;
  }
  const moved = await identityOf(aside, path).catch(() => null);
  if (moved === null || moved.dev !== checked.dev || moved.ino !== checked.ino
    || moved.size !== checked.size || moved.mtimeNs !== checked.mtimeNs) {
    // Put it back without replacing anything created at the path meanwhile.
    try {
      await link(aside, target);
      await rm(aside, { force: true });
    } catch {
      throw new BrainbaseLoginError('login_changed',
        `Another program changed ${JSON.stringify(path)} while logging out, and its file could not be put back. It was kept as ${JSON.stringify(aside)}. Nothing was removed.`);
    }
    throw changedDuringRemove(path);
  }
  await rm(aside, { force: true });
}

function changedDuringRemove(path: string): BrainbaseLoginError {
  return new BrainbaseLoginError('login_changed',
    `Another program created or changed ${JSON.stringify(path)} while logging out. That file was left as it is. Check --credentials and run the command again.`);
}

/**
 * Removes the saved login and flushes the directory that held it, under the
 * lock, before this returns. Without the flush, a power loss right after a
 * logout could bring the old login back. The directory is flushed even when
 * no file was there, since an earlier logout may have stopped before its flush.
 * Only a file that is a saved login is removed (see savedLoginKey); any other
 * file is left as it is and `login_credentials_unrecognized` is thrown.
 */
export async function removeCredentials(path = defaultCredentialsPath()): Promise<RemoveCredentialsResult> {
  assertCredentialsFilePath(path);
  return withCredentialsLock(path, async (lock) => {
    // Check, remove and flush the file the lock covers, in its real directory.
    const { target } = lock;
    const { identity } = await checkedSavedLogin(target, path);
    await lock.assertHeld();
    // No file at the check: nothing is removed, so a file another program
    // creates meanwhile stays. The folder is still flushed (see above).
    if (identity !== null) await removeCheckedFile(target, path, identity);
    const durable = await syncDirectory(dirname(target));
    // A logout that stopped half way was finished when the lock was taken:
    // its login was there and is gone now.
    return { existed: identity !== null || lock.interrupted.logoutFinished, durable };
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
  // A path that names some other file would only be refused after the approval.
  // Where the save goes and which login is there are fixed here: the save
  // after the approval goes to this same file and replaces only this login.
  const check = await checkCredentialsTarget(credentialsPath);

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
      saved = await withCredentialsLock(
        credentialsPath,
        (lock) => writeCredentials(credentialsPath, credentials, { lock, expected: check.saved }),
        { destination: check.destination },
      );
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

function usableWithoutRenewal(credentials: BrainbaseCredentials, now: number): { token: string; serverUrl: string; loginId: string } {
  // Nothing can renew it, so it is used until it actually expires.
  if (Date.parse(credentials.expires_at) > now) {
    return { token: credentials.access_token, serverUrl: credentials.server_url, loginId: credentials.login_id };
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
  const { token, serverUrl } = await getAccessTokenOfLogin(options);
  return { token, serverUrl };
}

/**
 * getAccessToken, with the saved login's login_id. A renewal keeps the
 * login_id; another `brainbase login` (as anyone) gets a new one.
 */
export async function getAccessTokenOfLogin(options: AccessTokenOptions = {}): Promise<{ token: string; serverUrl: string; loginId: string }> {
  const credentialsPath = options.credentialsPath ?? defaultCredentialsPath();
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const skew = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const credentials = await readCredentials(credentialsPath);
  if (!credentials) {
    throw new BrainbaseLoginError('login_missing', 'Not logged in. Run brainbase login --server <url>.');
  }
  if (isFresh(credentials, now(), skew)) {
    return { token: credentials.access_token, serverUrl: credentials.server_url, loginId: credentials.login_id };
  }
  if (!credentials.refresh_token) return usableWithoutRenewal(credentials, now());
  return withCredentialsLock(credentialsPath, async (lock) => {
    // Read again under the lock: another process may have renewed, logged out
    // or logged in as someone else while this one waited.
    const latest = await readCredentialsText(credentialsPath, lock.target)
      .then((text) => (text === null ? null : parseCredentials(text, credentialsPath)), () => null);
    if (!latest || !sameLogin(latest, credentials)) {
      throw new BrainbaseLoginError('login_changed', 'The saved login changed while it was being renewed. Run the command again.');
    }
    if (isFresh(latest, now(), skew)) return { token: latest.access_token, serverUrl: latest.server_url, loginId: latest.login_id };
    if (!latest.refresh_token) return usableWithoutRenewal(latest, now());
    const next = await requestRenewal(latest as BrainbaseCredentials & { refresh_token: string }, fetchImpl, now);
    // The login checked before the request must still be the one replaced.
    await writeCredentials(credentialsPath, next, { lock, expected: loginKeyOf(latest) });
    return { token: next.access_token, serverUrl: next.server_url, loginId: next.login_id };
  });
}
