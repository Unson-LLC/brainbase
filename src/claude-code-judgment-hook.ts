// Claude Code adapter for a hosted Brainbase judgment Host.
//
// Claude Code runs this as a command hook (`brainbase judgment:claude-code-hook`)
// for UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure and Stop.
// Claude Code's hook input has no turn_id, so the adapter keeps one per prompt.
// It forwards each event to the hosted MCP's `/host/judgment/hook` with the
// person token from `brainbase login`, and returns only a notice for the person
// and context for the model (and, for a knowledge lookup, the Host's denial).
//
// The hook is fail-open: the judgment plane audits, it does not authorize.
// Nothing here exits 2 or blocks a Stop, on its own error or on the Host's
// request. A failure becomes a warning for the person and the turn goes on.
//
// The person does not export variables. `judgment:install --target claude-code`
// writes the origin, and optionally the project and audited repositories, to
// the hook config file. When no project is configured, the Host chooses it
// from the repository this adapter sends (host/owner/name of the origin
// remote), or from the person's only project.

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getAccessTokenOfLogin, type AccessTokenOptions } from './brainbase-login.js';

export const CLAUDE_CODE_HOOK_CONFIG_SCHEMA = 'brainbase-claude-code-judgment-hook-v1';

export interface ClaudeCodeHookConfig {
  schema_version: typeof CLAUDE_CODE_HOOK_CONFIG_SCHEMA;
  /** Origin of the hosted MCP that serves /host/judgment/hook. */
  origin: string;
  /**
   * Origin of the Brainbase API the person logged in to for this Host. The
   * hook sends the saved login's token only when that login is for this
   * server, so a login to another environment never reaches this Host.
   */
  login_server: string;
  /** Sent as x-brainbase-project-code. Omit to let the Host decide. */
  project_code?: string;
  /**
   * Repositories to audit, as `host/owner/name` of the origin remote, e.g.
   * `github.com/example-org/app`. The host is compared without case; the
   * path keeps its case, except on hosts whose paths ignore case
   * (`github.com`). Omit to audit every git repository; an empty list audits
   * none.
   */
  repositories?: string[];
  /**
   * The one registration this config belongs to: a random id, also carried
   * by the registered command, and the Claude Code settings file that holds
   * it. A command with another id (a registration this config was taken
   * from) sends nothing.
   */
  registration: { id: string; settings: string };
}

export type ClaudeCodeHookPayload = Record<string, unknown>;
export type ClaudeCodeHookOutput = Record<string, unknown>;

export interface ClaudeCodeHookOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /**
   * Overrides how the person token is obtained (tests). A bare string has no
   * login id; a turn opened with one only continues with another bare string.
   */
  accessToken?: () => Promise<string | PersonToken>;
  credentials?: AccessTokenOptions;
  /** The hook config file; the installer passes it as `--config`. */
  configPath?: string;
  /** The registration id the installer put in the command as `--registration`. */
  registrationId?: string;
}

const HOOK_PATH = '/host/judgment/hook';
const RECENT_PROMPTS = 16;
const TIMEOUT_MS: Record<string, number> = {
  UserPromptSubmit: 40_000, Stop: 40_000, PreToolUse: 15_000, PostToolUse: 15_000, PostToolUseFailure: 15_000,
};
// The Host reserves and checks a knowledge lookup attempt before it runs and
// records it only against that reservation. No other tool waits on the Host.
export const PRE_TOOL_USE_TOOLS = new Set(['mcp__brainbase__brainbase_knowledge_lookup']);
const WARNING_PREFIX = '⚠️ Brainbase判断フック:';
const TURN_SCHEMA = 'brainbase-claude-judgment-turn-v1';

interface TurnState {
  schema_version: string;
  turn_id: string;
  prompt_id: string | null;
  started_at: string;
  start_status: 'failed' | 'started' | 'unannounced' | 'out_of_scope';
  stop_blocks: number;
  recent_prompt_ids: string[];
  /** The repository the turn was opened in; later events must match it. */
  repository?: string | null;
  /**
   * The checkout the turn was opened in (its shared git directory), for a
   * repository without an origin remote; later events must match it.
   */
  checkout?: string | null;
  /** Where the turn's events go; a config that changes mid-turn stops them. */
  destination?: string;
  /**
   * The saved login (its login_id, kept across renewals) the turn's first
   * event was sent with. A login as someone else mid-turn stops the turn.
   */
  login?: string | null;
}

function warning(text: string): ClaudeCodeHookOutput {
  return { systemMessage: `${WARNING_PREFIX} ${text}` };
}

function brainbaseHome(env: NodeJS.ProcessEnv): string {
  return join(env.HOME || homedir(), '.brainbase');
}

export function defaultClaudeCodeHookConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAINBASE_CLAUDE_JUDGMENT_HOOK_CONFIG?.trim() || join(brainbaseHome(env), 'claude-code-judgment-hook.json');
}

export function readClaudeCodeHookConfig(path: string): ClaudeCodeHookConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const value = parsed as Partial<ClaudeCodeHookConfig> | null;
  if (!value || value.schema_version !== CLAUDE_CODE_HOOK_CONFIG_SCHEMA || typeof value.origin !== 'string') return null;
  // Without the login it belongs to, no saved token may be sent.
  if (typeof value.login_server !== 'string' || !value.login_server) return null;
  let repositories: string[] | undefined;
  if (value.repositories !== undefined) {
    // A list that cannot be read must not widen into "audit everything".
    if (!Array.isArray(value.repositories)) return null;
    repositories = [];
    for (const entry of value.repositories) {
      // Already an identifier: read as is, so a name ending in `.git` stays whole.
      const normalized = typeof entry === 'string' ? canonicalRepositoryIdentifier(entry) : null;
      if (!normalized) return null;
      repositories.push(normalized);
    }
  }
  const registration = value.registration as Partial<ClaudeCodeHookConfig['registration']> | undefined;
  if (!registration || typeof registration.id !== 'string' || !REGISTRATION_ID.test(registration.id)
    || typeof registration.settings !== 'string' || !registration.settings) return null;
  return {
    schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
    origin: value.origin,
    login_server: value.login_server,
    registration: { id: registration.id, settings: registration.settings },
    ...(typeof value.project_code === 'string' && value.project_code ? { project_code: value.project_code } : {}),
    // An empty list stays empty: it audits no repository, it never means all.
    ...(repositories ? { repositories } : {}),
  };
}

/** True when the file holds JSON with this hook config's schema (it was written by the installer). */
export function isClaudeCodeHookConfigFile(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { schema_version?: unknown } | null;
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && parsed.schema_version === CLAUDE_CODE_HOOK_CONFIG_SCHEMA;
  } catch {
    return false;
  }
}

export const REGISTRATION_ID = /^[a-f0-9]{32}$/u;

const REPOSITORY_HOST = /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?$/u;
const REPOSITORY_PATH = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+$/u;
/**
 * Hosts whose repository paths ignore case: there, `Owner/App` and `owner/app`
 * are one repository. Elsewhere (a self-hosted server may tell them apart),
 * the path is compared exactly.
 */
const CASE_INSENSITIVE_PATH_HOSTS = new Set(['github.com']);

/**
 * A repository named in the config: `host/owner/name`. The host is
 * lowercased (host names ignore case). The path keeps its case, except on a
 * host whose paths ignore case. A bare name or `owner/name` is refused,
 * because it would also match a repository of the same name under another
 * owner or host.
 */
export function normalizeRepositoryEntry(entry: string): string | null {
  // As in a remote URL, one trailing `.git` is the URL's, not the name's.
  return canonicalRepositoryIdentifier(entry.trim().replace(/\/+$/u, '').replace(/\.git$/iu, ''));
}

/**
 * A `host/owner/name` identifier in its one spelling: the host lowercased,
 * the path lowercased only on a host whose paths ignore case. Nothing is
 * stripped, so an identifier read back from the config stays the same.
 */
export function canonicalRepositoryIdentifier(entry: string): string | null {
  const value = entry.trim().replace(/\/+$/u, '');
  const slash = value.indexOf('/');
  if (slash <= 0) return null;
  const host = value.slice(0, slash).toLowerCase();
  const rawPath = value.slice(slash + 1);
  if (!REPOSITORY_HOST.test(host) || !REPOSITORY_PATH.test(rawPath)) return null;
  const path = CASE_INSENSITIVE_PATH_HOSTS.has(host) ? rawPath.toLowerCase() : rawPath;
  return `${host}/${path}`;
}

// ---- Repository identity, read from git files without starting git ----

function isGitMetadata(dotGit: string): boolean {
  try {
    if (statSync(dotGit).isDirectory()) return statSync(join(dotGit, 'HEAD')).isFile();
    return /^gitdir:\s*\S/u.test(readFileSync(dotGit, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * The nearest directory at or above `start` with valid git metadata. The walk
 * starts from the real path: a link inside one checkout that points into
 * another checkout belongs to the checkout it points into, not to the one
 * whose directory holds the link. A start that cannot be resolved gives null,
 * so nothing is sent for it.
 */
export function findGitRoot(start: string): string | null {
  let current: string;
  try {
    current = realpathSync(resolve(start));
  } catch {
    return null;
  }
  for (;;) {
    if (isGitMetadata(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The git directory a linked worktree shares with its main checkout. */
export function gitCommonDir(repoRoot: string): string | null {
  const dotGit = join(repoRoot, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const match = /^gitdir:\s*(.+?)\s*$/mu.exec(readFileSync(dotGit, 'utf8'));
    if (!match) return null;
    const gitDir = resolve(repoRoot, match[1]);
    try {
      return resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim());
    } catch {
      return gitDir;
    }
  } catch {
    return null;
  }
}

type OriginLookup = { status: 'found'; url: string } | { status: 'none' } | { status: 'unresolved' };

// Variables that would point git at another repository than the checkout.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_NAMESPACE'];

/**
 * The URL git itself uses for the `origin` remote, asked from git: includes,
 * `insteadOf` rewrites and the global and system config apply as for a fetch.
 * `none` when the checkout has no origin remote; `unresolved` when git could
 * not answer (not installed, refused the checkout, timed out), so nothing can
 * be said about the repository.
 */
function originLookup(repoRoot: string, env: NodeJS.ProcessEnv): OriginLookup {
  const childEnv: NodeJS.ProcessEnv = { ...env, PATH: env.PATH ?? process.env.PATH, GIT_TERMINAL_PROMPT: '0' };
  for (const name of GIT_LOCATION_VARIABLES) delete childEnv[name];
  const result = spawnSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
    env: childEnv, encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  if (result.error || result.status === null) return { status: 'unresolved' };
  const url = result.stdout.trim();
  if (result.status === 0 && url && !url.includes('\n')) return { status: 'found', url };
  // `git remote get-url` exits with 2 for a remote that does not exist.
  if (result.status === 2 && /No such remote/iu.test(result.stderr)) return { status: 'none' };
  return { status: 'unresolved' };
}

/**
 * `host/owner/name` of a git remote URL (normalized as in the config), or null when the URL has
 * no host or no owner. Accepts https/ssh/git URLs and scp-like `user@host:path`.
 */
export function repositoryIdentityFromUrl(remote: string): string | null {
  const value = remote.trim();
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/u.exec(value);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    [, host, path] = scp;
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!url.hostname) return null;
    host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    path = decodeURIComponent(url.pathname);
  }
  return normalizeRepositoryEntry(`${host}/${path.replace(/^\/+/u, '')}`);
}

/**
 * The repository a checkout works for: `host/owner/name` of its origin
 * remote, the same for every worktree of one repository. Null without an
 * origin remote whose URL names a host and an owner.
 */
export function repositoryIdentity(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const origin = originLookup(repoRoot, env);
  return origin.status === 'found' ? repositoryIdentityFromUrl(origin.url) : null;
}

interface RepositoryScope {
  /** A git checkout was found. */
  inGit: boolean;
  repository: string | null;
  /** Real path of the checkout's shared git directory; null outside git. */
  checkout: string | null;
  /** In git, but git could not tell the origin: nothing is sent for it. */
  unresolved?: boolean;
  /**
   * The checkout has an origin, but its URL gives no `host/owner/name`.
   * Unlike a checkout without origin, it works for some repository the Host
   * cannot be told about, so without --project nothing is sent for it.
   */
  unidentified?: boolean;
}

function eventRepository(payload: ClaudeCodeHookPayload, env: NodeJS.ProcessEnv): RepositoryScope {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = findGitRoot(cwd);
  if (!root) return { inGit: false, repository: null, checkout: null };
  const commonDir = gitCommonDir(root);
  let checkout: string | null = null;
  try {
    checkout = commonDir ? realpathSync(commonDir) : null;
  } catch {
    checkout = null;
  }
  const origin = originLookup(root, env);
  if (origin.status === 'unresolved') return { inGit: true, repository: null, checkout, unresolved: true };
  if (origin.status === 'none') return { inGit: true, repository: null, checkout };
  const repository = repositoryIdentityFromUrl(origin.url);
  return repository === null
    ? { inGit: true, repository: null, checkout, unidentified: true }
    : { inGit: true, repository, checkout };
}

function isAuditedRepository(scope: RepositoryScope, config: ClaudeCodeHookConfig): boolean {
  if (!scope.inGit || scope.unresolved) return false;
  // Sent without a repository, the Host would put the records in the
  // person's only project, which need not be the one this origin works for.
  if (scope.unidentified && !config.project_code) return false;
  if (!config.repositories) return true;
  return scope.repository !== null && config.repositories.includes(scope.repository);
}

// A later event belongs to the turn only when it runs in the repository the
// turn was opened in: the same host/owner/name, or, for a repository without
// one, the same checkout. Outside git nothing belongs to a turn. The turn's
// repository, not the event's, is sent.
function sameScope(state: TurnState, scope: RepositoryScope): boolean {
  if (!scope.inGit) return false;
  if (typeof state.repository === 'string') return state.repository === scope.repository;
  return scope.repository === null && typeof state.checkout === 'string' && state.checkout === scope.checkout;
}

// Where events go: the config file, the Host origin and the project. A turn
// keeps the destination it was opened with.
function destinationOf(context: Context): string {
  return JSON.stringify([context.configPath, context.config.origin, context.config.project_code ?? null]);
}

function sameDestination(state: TurnState, context: Context): boolean {
  return state.destination === destinationOf(context);
}

// ---- Turn state ----

function turnDirectory(env: NodeJS.ProcessEnv): string {
  return env.BRAINBASE_CLAUDE_JUDGMENT_TURN_DIR || join(brainbaseHome(env), 'var', 'claude-judgment-turns');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Turns are kept per session and per hook config, so two registered configs
// (two Hosts) never share a turn.
function stateKey(sessionId: string, configPath: string): string {
  return sha256(`${sessionId}\n${configPath}`);
}

function turnKey(payload: ClaudeCodeHookPayload, context: Context): string {
  return stateKey(String(payload.session_id), context.configPath);
}

function statePath(env: NodeJS.ProcessEnv, key: string): string {
  return join(turnDirectory(env), `${key}.json`);
}

// Present while an input Claude Code screened during this prompt's turn may
// still run as a turn of its own (see unannouncedTurn).
function screeningPath(env: NodeJS.ProcessEnv, sessionId: string, promptId: string): string {
  return join(turnDirectory(env), `${sessionId}.screened-${sha256(promptId).slice(0, 32)}`);
}

function noteScreening(env: NodeJS.ProcessEnv, sessionId: string, promptId: string): void {
  try {
    mkdirSync(turnDirectory(env), { recursive: true, mode: 0o700 });
    writeFileSync(screeningPath(env, sessionId, promptId), '', { mode: 0o600 });
  } catch {}
}

function forgetScreening(env: NodeJS.ProcessEnv, sessionId: string, promptId: string): void {
  try {
    unlinkSync(screeningPath(env, sessionId, promptId));
  } catch {}
}

function recentPrompts(previous: TurnState | null): string[] {
  const earlier = Array.isArray(previous?.recent_prompt_ids)
    ? previous.recent_prompt_ids.filter((id) => typeof id === 'string' && id !== previous.prompt_id) : [];
  return (typeof previous?.prompt_id === 'string' ? [...earlier, previous.prompt_id] : earlier).slice(-RECENT_PROMPTS);
}

function readState(env: NodeJS.ProcessEnv, sessionId: string): TurnState | null {
  try {
    const state = JSON.parse(readFileSync(statePath(env, sessionId), 'utf8')) as TurnState;
    return state && typeof state.turn_id === 'string' && state.turn_id ? state : null;
  } catch {
    return null;
  }
}

function writeState(env: NodeJS.ProcessEnv, sessionId: string, state: TurnState): void {
  mkdirSync(turnDirectory(env), { recursive: true, mode: 0o700 });
  const path = statePath(env, sessionId);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, path);
}

function promptIdOf(payload: ClaudeCodeHookPayload): string | null {
  return typeof payload.prompt_id === 'string' && payload.prompt_id ? payload.prompt_id : null;
}

// ---- Transport ----

function bearerTransportSafe(url: URL): boolean {
  return url.protocol === 'https:'
    || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
}

export interface PersonToken {
  token: string;
  /** The saved login's login_id; the same across renewals of one login. */
  loginId: string | null;
}

interface Context {
  env: NodeJS.ProcessEnv;
  config: ClaudeCodeHookConfig;
  fetch: typeof fetch;
  accessToken: () => Promise<string | PersonToken>;
  scope: RepositoryScope;
  /** Absolute path of the hook config this run read. */
  configPath: string;
}

/** `id` as this registration sends it to the Host. */
export function namespacedId(id: string, config: Pick<ClaudeCodeHookConfig, 'registration'>): string {
  return `${id}.bb-${sha256(`brainbase-claude-code-registration\n${config.registration.id}`).slice(0, 16)}`;
}

// The Host looks a repository up in its project mapping only in this form
// (REPOSITORY_PATTERN of the Host's remote-judgment-hook-http). Any other
// identifier is passed over there, and the Host falls back to the person's
// only project.
const HOST_MAPPABLE_REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;

/**
 * Whether the Host can choose the project for this repository from its
 * mapping. Without --project, a repository it cannot look up (a host with a
 * port, a `~` in the path, a very long name) is not sent at all.
 */
export function hostCanMapRepository(repository: string | null, config: Pick<ClaudeCodeHookConfig, 'project_code'>): boolean {
  if (config.project_code || repository === null) return true;
  return HOST_MAPPABLE_REPOSITORY.test(repository);
}

/**
 * The login a turn is pinned to: undefined opens the turn (any login), a
 * string or null must match the login that sends the event.
 */
type LoginPin = { expected?: string | null; used?: string | null };

async function forward(
  payload: ClaudeCodeHookPayload,
  context: Context,
  repository: string | null,
  login: LoginPin = {},
): Promise<Record<string, unknown>> {
  if (!hostCanMapRepository(repository, context.config)) throw new Error('judgment_repository_unmappable');
  let endpoint: URL;
  try {
    endpoint = new URL(HOOK_PATH, context.config.origin);
  } catch {
    throw new Error('judgment_hook_endpoint_invalid');
  }
  if (!bearerTransportSafe(endpoint)) throw new Error('judgment_hook_transport_unsafe');
  let token: string;
  let loginId: string | null;
  try {
    const obtained = await context.accessToken();
    token = typeof obtained === 'string' ? obtained : obtained.token;
    loginId = typeof obtained === 'string' ? null : obtained.loginId;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw new Error(typeof code === 'string' && /^login_[a-z_]{1,60}$/u.test(code)
      ? `judgment_hook_${code}` : 'judgment_hook_login_unavailable');
  }
  // Logged in again (as someone else, or the same person anew) since the turn
  // began: the turn's events are not sent with the new login.
  if (login.expected !== undefined && login.expected !== loginId) throw new Error('judgment_turn_login_changed');
  login.used = loginId;
  const eventName = String(payload.hook_event_name);
  // Claude Code's session and turn ids are the same for every registration
  // that sees the event. The Host keys a turn by them, so each registration
  // sends its own: the id with a tag of the registration appended.
  const sent = {
    ...payload,
    session_id: namespacedId(String(payload.session_id), context.config),
    turn_id: namespacedId(String(payload.turn_id), context.config),
  };
  let response: Response;
  try {
    response = await context.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-brainbase-judgment-host': 'claude-code',
        ...(context.config.project_code ? { 'x-brainbase-project-code': context.config.project_code } : {}),
        ...(repository ? { 'x-brainbase-repository': repository } : {}),
      },
      body: JSON.stringify(sent),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS[eventName] ?? 15_000),
    });
  } catch (error) {
    throw new Error((error as { name?: unknown })?.name === 'TimeoutError' ? 'judgment_hook_timeout' : 'judgment_hook_unreachable');
  }
  const text = await response.text();
  let envelope: Record<string, unknown> | null;
  try {
    envelope = JSON.parse(text) as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  if (!response.ok) {
    const upstream = typeof envelope?.error === 'string' && /^[a-z0-9_]{1,80}$/u.test(envelope.error)
      ? `_${envelope.error}` : '';
    throw new Error(`judgment_hook_http_${response.status}${upstream}`);
  }
  const output = envelope?.output;
  if (!envelope || envelope.schema_version !== '1' || envelope.accepted !== true
    || envelope.hook_event_name !== payload.hook_event_name
    || envelope.session_id !== sent.session_id || envelope.turn_id !== sent.turn_id
    || !output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('judgment_hook_response_invalid');
  }
  return output as Record<string, unknown>;
}

// The judgment plane audits; it never stops, blocks or rewrites. So only a
// notice for the person and, where Claude Code takes it, context for the model
// leave this adapter: never `continue`, `stopReason`, `decision`, `reason`,
// `suppressOutput` or a permission or input change, whatever the Host answers.
// Stop takes no context. The Host's PostToolUse branch names its context
// PostToolUse even for a failure event, so the event name is set here.
function documentedOutput(output: Record<string, unknown>, eventName: string): ClaudeCodeHookOutput {
  const result: ClaudeCodeHookOutput = typeof output.systemMessage === 'string' && output.systemMessage
    ? { systemMessage: output.systemMessage } : {};
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  if (eventName !== 'Stop' && specific && typeof specific === 'object' && !Array.isArray(specific)
    && typeof specific.additionalContext === 'string') {
    result.hookSpecificOutput = { hookEventName: eventName, additionalContext: specific.additionalContext };
  }
  return result;
}

function isBrainbaseTool(payload: ClaudeCodeHookPayload): boolean {
  return typeof payload.tool_name === 'string' && payload.tool_name.startsWith('mcp__brainbase__');
}

function digestSummary(value: unknown): { digest: string; bytes: number } {
  const text = JSON.stringify(value) ?? 'null';
  return { digest: `sha256:${sha256(text)}`, bytes: Buffer.byteLength(text) };
}

/**
 * The Host keeps only digests of a non-Brainbase tool's input, output and
 * error. Sending digests keeps file bodies and command output on this machine.
 * The success fact is kept beside the digest, because a non-empty digest
 * object alone would read as a success.
 */
/**
 * Fields of a Stop input the Host reads. Claude Code also puts the session's
 * background work in a Stop input (`background_tasks[].command`,
 * `session_crons[].prompt`, ...), whose commands and prompts can hold
 * secrets, so a Stop is rebuilt from this list and nothing else is sent.
 */
export const STOP_FORWARDED_FIELDS = [
  'hook_event_name', 'session_id', 'turn_id', 'prompt_id', 'transcript_path', 'cwd',
  'permission_mode', 'model', 'last_assistant_message', 'stop_hook_active',
] as const;

export function forwardedStopPayload(payload: ClaudeCodeHookPayload): ClaudeCodeHookPayload {
  const kept: ClaudeCodeHookPayload = {} as ClaudeCodeHookPayload;
  for (const field of STOP_FORWARDED_FIELDS) {
    if (payload[field] !== undefined) kept[field] = payload[field];
  }
  return kept;
}

export function forwardedToolPayload(payload: ClaudeCodeHookPayload): ClaudeCodeHookPayload {
  if (isBrainbaseTool(payload)) return payload;
  const summarized: ClaudeCodeHookPayload = { ...payload };
  for (const field of ['tool_input', 'tool_response', 'error']) {
    if (payload[field] !== undefined) summarized[field] = digestSummary(payload[field]);
  }
  const response = payload.tool_response as Record<string, unknown> | null | undefined;
  summarized.tool_response = {
    ...digestSummary(response),
    success: response !== undefined && response !== null
      && payload.hook_event_name !== 'PostToolUseFailure'
      && payload.is_interrupt !== true && response?.interrupted !== true
      && response?.is_error !== true && response?.isError !== true
      && response?.success !== false
      && response?.status !== 'error' && response?.status !== 'failed'
      && !(Number.isInteger(response?.exit_code) && response?.exit_code !== 0)
      && !(Number.isInteger(response?.exitCode) && response?.exitCode !== 0),
  };
  return summarized;
}

function safeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^judgment_[a-z0-9_]{1,120}$/u.test(message) ? message : 'judgment_hook_failed';
}

// ---- Event handlers ----

function currentTurn(payload: ClaudeCodeHookPayload, context: Context): TurnState | null {
  const state = readState(context.env, turnKey(payload, context));
  if (!state) return null;
  const promptId = promptIdOf(payload);
  if (promptId && typeof state.prompt_id === 'string' && state.prompt_id !== promptId) return null;
  return state;
}

// An event of a prompt that no UserPromptSubmit opened. Claude Code screens an
// input that arrives mid-turn and keeps the result; when that input later runs
// as its own turn, no UserPromptSubmit arrives for it. The Host cannot open a
// turn without that request, so the turn is recorded as unannounced and the
// person is told once.
function unannouncedTurn(payload: ClaudeCodeHookPayload, context: Context): ClaudeCodeHookOutput {
  const { env } = context;
  const sessionId = turnKey(payload, context);
  const promptId = promptIdOf(payload);
  const previous = readState(env, sessionId);
  if (!promptId || typeof previous?.prompt_id !== 'string' || previous.prompt_id === promptId) return {};
  if (recentPrompts(previous).includes(promptId)) return {};
  const audited = isAuditedRepository(context.scope, context.config);
  // Only one event takes the note: several processes can each unlink the same
  // file, but only one rename of it succeeds.
  const note = screeningPath(env, sessionId, previous.prompt_id);
  try {
    renameSync(note, `${note}.${process.pid}`);
  } catch {
    return {};
  }
  try {
    unlinkSync(`${note}.${process.pid}`);
  } catch {}
  if (readState(env, sessionId)?.prompt_id !== previous.prompt_id) return {};
  const told = audited
    ? warning('このターンはClaude CodeからUserPromptSubmitが届かなかったため、判断監査なしで続行します（judgment_turn_unannounced）。作業中に届いた入力が次のターンとして実行されたときなどに起こります。')
    : {};
  try {
    writeState(env, sessionId, {
      schema_version: TURN_SCHEMA,
      turn_id: promptId,
      prompt_id: promptId,
      started_at: new Date().toISOString(),
      start_status: audited ? 'unannounced' : 'out_of_scope',
      stop_blocks: 0,
      recent_prompt_ids: recentPrompts(previous),
      repository: context.scope.repository,
      checkout: context.scope.checkout,
      destination: destinationOf(context),
    });
  } catch {
    return told;
  }
  noteScreening(env, sessionId, promptId);
  return told;
}

async function handleUserPromptSubmit(payload: ClaudeCodeHookPayload, context: Context): Promise<ClaudeCodeHookOutput> {
  const { env } = context;
  const sessionId = turnKey(payload, context);
  const promptId = promptIdOf(payload);
  const previous = readState(env, sessionId);
  // Claude Code fires UserPromptSubmit again with the running turn's prompt_id
  // when it screens an input that arrives mid-turn. The first submission
  // decided the turn, so a screening is not sent; it is only noted.
  if (promptId && previous?.prompt_id === promptId) {
    noteScreening(env, sessionId, promptId);
    return {};
  }
  if (typeof previous?.prompt_id === 'string') forgetScreening(env, sessionId, previous.prompt_id);
  const state: TurnState = {
    schema_version: TURN_SCHEMA,
    turn_id: promptId ?? randomUUID(),
    prompt_id: promptId,
    started_at: new Date().toISOString(),
    start_status: 'failed',
    stop_blocks: 0,
    recent_prompt_ids: recentPrompts(previous),
    repository: context.scope.repository,
    checkout: context.scope.checkout,
    destination: destinationOf(context),
  };
  if (!isAuditedRepository(context.scope, context.config)) {
    writeState(env, sessionId, { ...state, start_status: 'out_of_scope' });
    if (context.scope.unresolved) {
      return warning('git からこのリポジトリの origin を確かめられなかったため、判断監査なしで続行します（judgment_repository_unresolved）。git が入っているか、このフォルダーを git が扱えるかを確かめてください。');
    }
    if (context.scope.unidentified) {
      return warning('このリポジトリの origin の URL からホスト・所有者・名前を読み取れず、送り先のプロジェクトを決められないため、判断監査なしで続行します（judgment_repository_unidentified）。judgment:install に --project を付けて登録し直してください。');
    }
    return {};
  }
  if (!hostCanMapRepository(context.scope.repository, context.config)) {
    writeState(env, sessionId, { ...state, start_status: 'out_of_scope' });
    return warning(`このリポジトリ（${context.scope.repository}）は判断ハーネスがプロジェクトを選べない形式のため、判断監査なしで続行します（judgment_repository_unmappable）。judgment:install に --project を付けて登録し直してください。`);
  }
  writeState(env, sessionId, state);
  try {
    const login: LoginPin = {};
    const output = await forward({ ...payload, turn_id: state.turn_id }, context, state.repository ?? null, login);
    writeState(env, sessionId, { ...state, start_status: 'started', login: login.used ?? null });
    return documentedOutput(output, 'UserPromptSubmit');
  } catch (error) {
    return warning(`判断ハーネスに接続できないため、このターンは判断監査なしで続行します（${safeReason(error)}）。`);
  }
}

// A started turn always has its login recorded; a state without one (written
// before logins were pinned) matches no login, so nothing more is sent.
function turnLogin(state: TurnState): LoginPin {
  return { expected: typeof state.login === 'string' || state.login === null ? state.login : '\u0000unrecorded' };
}

async function handlePostToolUse(payload: ClaudeCodeHookPayload, context: Context, eventName: string): Promise<ClaudeCodeHookOutput> {
  const state = currentTurn(payload, context);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started' || !sameScope(state, context.scope) || !sameDestination(state, context)
    || !isAuditedRepository(context.scope, context.config)) return {};
  try {
    return documentedOutput(
      await forward({ ...forwardedToolPayload(payload), turn_id: state.turn_id }, context, state.repository ?? null, turnLogin(state)),
      eventName,
    );
  } catch (error) {
    return warning(`監査記録に失敗しました（${safeReason(error)}）。作業は続行します。`);
  }
}

// Only a denial with its reason, or context for the model, leaves a
// PreToolUse: the judgment plane never allows, rewrites or stops a call.
function preToolUseOutput(output: Record<string, unknown>): ClaudeCodeHookOutput {
  const result: ClaudeCodeHookOutput = typeof output.systemMessage === 'string' ? { systemMessage: output.systemMessage } : {};
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  if (!specific || typeof specific !== 'object' || Array.isArray(specific)) return result;
  if (specific.permissionDecision === 'deny') {
    result.hookSpecificOutput = {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      ...(typeof specific.permissionDecisionReason === 'string'
        ? { permissionDecisionReason: specific.permissionDecisionReason } : {}),
    };
  } else if (typeof specific.additionalContext === 'string') {
    result.hookSpecificOutput = { hookEventName: 'PreToolUse', additionalContext: specific.additionalContext };
  }
  return result;
}

async function handlePreToolUse(payload: ClaudeCodeHookPayload, context: Context): Promise<ClaudeCodeHookOutput> {
  if (typeof payload.tool_name !== 'string' || !PRE_TOOL_USE_TOOLS.has(payload.tool_name)) return {};
  const state = currentTurn(payload, context);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started' || !sameScope(state, context.scope) || !sameDestination(state, context)
    || !isAuditedRepository(context.scope, context.config)) return {};
  try {
    return preToolUseOutput(await forward({ ...payload, turn_id: state.turn_id }, context, state.repository ?? null, turnLogin(state)));
  } catch (error) {
    return warning(`知識取得の試行を判断ハーネスへ予約できませんでした（${safeReason(error)}）。この試行は記録されません。`);
  }
}

async function handleStop(payload: ClaudeCodeHookPayload, context: Context): Promise<ClaudeCodeHookOutput> {
  const state = currentTurn(payload, context);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started') return {};
  if (!sameScope(state, context.scope)) {
    return warning('ターンの途中で別のリポジトリに移ったため、回答を送らずに監査未完了のまま終了します（judgment_turn_repository_changed）。');
  }
  if (!sameDestination(state, context)) {
    return warning('ターンの途中で判断フックの送り先が変わったため、回答を送らずに監査未完了のまま終了します（judgment_turn_destination_changed）。');
  }
  // The config is read again for every event: a repository taken off the list
  // mid-turn sends nothing more, though the destination stays the same.
  if (!isAuditedRepository(context.scope, context.config)) {
    return warning('ターンの途中でこのリポジトリが監査の対象から外れたため、回答を送らずに終了します（judgment_turn_repository_unaudited）。');
  }
  const blocks = Number.isSafeInteger(state.stop_blocks) ? state.stop_blocks : 0;
  let raw: Record<string, unknown>;
  try {
    raw = await forward({ ...forwardedStopPayload(payload), turn_id: state.turn_id, stop_hook_active: blocks > 0 }, context, state.repository ?? null, turnLogin(state));
  } catch (error) {
    return warning(`回答の照合に失敗したため、監査未完了のまま終了します（${safeReason(error)}）。`);
  }
  const output = documentedOutput(raw, 'Stop');
  if (raw.decision !== 'block') return output;
  // The person has already read the answer when Stop runs. Sending the repair
  // request back would print the same answer twice, so it is shown as a notice.
  writeState(context.env, turnKey(payload, context), { ...state, stop_blocks: blocks + 1 });
  const repairId = /r-[a-f0-9]{16}/u.exec(typeof raw.reason === 'string' ? raw.reason : '')?.[0];
  const notice = warning(`回答は差し戻しません。監査は未完了のまま終了します${repairId ? `（${repairId}）` : ''}。`).systemMessage;
  return { systemMessage: [output.systemMessage, notice].filter(Boolean).join('\n') };
}

/** Handles one Claude Code hook event. Never throws. */
export async function handleClaudeCodeJudgmentHook(
  payload: ClaudeCodeHookPayload,
  options: ClaudeCodeHookOptions = {},
): Promise<ClaudeCodeHookOutput> {
  const env = options.env ?? process.env;
  try {
    if (env.BRAINBASE_CLAUDE_JUDGMENT_HOOK === 'disabled') return {};
    const configPath = resolve(options.configPath ?? defaultClaudeCodeHookConfigPath(env));
    const config = readClaudeCodeHookConfig(configPath);
    // Not installed for this person, or removed: forward nothing.
    if (!config) return {};
    const eventName = payload.hook_event_name;
    // The config now belongs to another registration (installed again from
    // another settings file): this one sends nothing, and says so once a turn.
    if (options.registrationId !== config.registration.id) {
      return eventName === 'UserPromptSubmit'
        ? warning(`この登録の設定（${configPath}）は、別のClaude Codeの設定（${config.registration.settings}）の登録に使われています。判断監査なしで続行します。judgment:install をやり直してください。`)
        : {};
    }
    if (typeof payload.session_id !== 'string' || !payload.session_id) return {};
    // A subagent's events are not the parent turn's.
    if (typeof payload.agent_id === 'string' && payload.agent_id) return {};
    const context: Context = {
      env,
      config,
      fetch: options.fetch ?? fetch,
      accessToken: options.accessToken ?? (async () => {
        const login = await getAccessTokenOfLogin({ fetch: options.fetch, ...options.credentials });
        // A login to another environment (production instead of staging, say)
        // must not reach this Host.
        if (login.serverUrl !== config.login_server) {
          throw Object.assign(new Error('login_origin_mismatch'), { code: 'login_origin_mismatch' });
        }
        return { token: login.token, loginId: login.loginId };
      }),
      scope: eventRepository(payload, env),
      configPath,
    };
    if (eventName === 'UserPromptSubmit') return await handleUserPromptSubmit(payload, context);
    if (eventName === 'PreToolUse') return await handlePreToolUse(payload, context);
    if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
      return await handlePostToolUse(payload, context, eventName);
    }
    if (eventName === 'Stop') return await handleStop(payload, context);
    return {};
  } catch (error) {
    return warning(`判断フックの処理に失敗しました（${safeReason(error)}）。判断監査なしで続行します。`);
  }
}

// ---- Registration in the person's Claude Code settings ----

export const CLAUDE_CODE_HOOK_COMMAND = 'judgment:claude-code-hook';

/** One argument quoted for a POSIX shell (Claude Code runs hook commands with sh). */
export function shellQuote(argument: string): string {
  return `'${argument.replace(/'/gu, `'\\''`)}'`;
}

/**
 * The command the installer registers: node, the CLI, the hook command, the
 * config file and the registration id, each quoted for the shell.
 */
export function claudeCodeHookCommand(nodePath: string, cliPath: string, configPath: string, registrationId: string): string {
  return [nodePath, cliPath, CLAUDE_CODE_HOOK_COMMAND, '--config', configPath, '--registration', registrationId]
    .map(shellQuote).join(' ');
}

/** The arguments of a command made only of single-quoted words, or null. */
function singleQuotedWords(command: string): string[] | null {
  const words: string[] = [];
  let index = 0;
  while (index < command.length) {
    if (command[index] !== "'") return null;
    let word = '';
    for (;;) {
      const close = command.indexOf("'", index + 1);
      if (close < 0) return null;
      word += command.slice(index + 1, close);
      index = close + 1;
      if (command.startsWith("\\''", index)) {
        word += "'";
        index += 2; // continue with the reopening quote
        continue;
      }
      break;
    }
    words.push(word);
    if (index === command.length) break;
    if (command[index] !== ' ') return null;
    index += 1;
  }
  return words;
}

/**
 * The config path and registration id of a registration this installer
 * wrote, or null for any other hook (a wrapper, or another hook that only
 * mentions the command).
 */
export function installedHookRegistration(hook: unknown): { configPath: string; registrationId: string } | null {
  const value = hook as { type?: unknown; command?: unknown } | null;
  if (!value || value.type !== 'command' || typeof value.command !== 'string') return null;
  const words = singleQuotedWords(value.command);
  if (!words || words.length !== 7 || words[2] !== CLAUDE_CODE_HOOK_COMMAND || words[3] !== '--config'
    || words[5] !== '--registration' || !REGISTRATION_ID.test(words[6]) || !words[4]) return null;
  return { configPath: words[4], registrationId: words[6] };
}

/** The config path of a registration this installer wrote, or null. */
export function installedHookConfigPath(hook: unknown): string | null {
  return installedHookRegistration(hook)?.configPath ?? null;
}

/**
 * One name for a file however it is reached: the real path, with links in
 * every existing directory followed. For a file that does not exist yet, its
 * nearest existing directory is resolved and the rest appended.
 */
export function canonicalFilePath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(canonicalFilePath(parent), absolute.slice(parent.length).replace(/^[/\\]+/u, ''));
  }
}

// A registered command names the config by the path it was installed with.
// Two paths to one file (a linked directory) are one registration.
function sameConfigFile(registered: string, configPath: string): boolean {
  return registered === configPath || canonicalFilePath(registered) === canonicalFilePath(configPath);
}

// Timeouts (seconds) outlast the adapter's own HTTP deadlines.
const REGISTRATIONS: Array<{ event: string; matcher?: string; timeout: number; statusMessage: string }> = [
  { event: 'UserPromptSubmit', timeout: 60, statusMessage: 'brainbase judgment' },
  {
    event: 'PreToolUse',
    matcher: 'mcp__brainbase__brainbase_knowledge_lookup',
    timeout: 30,
    statusMessage: 'brainbase judgment lookup check',
  },
  { event: 'PostToolUse', timeout: 30, statusMessage: 'brainbase judgment audit' },
  { event: 'PostToolUseFailure', timeout: 30, statusMessage: 'brainbase judgment audit' },
  { event: 'Stop', timeout: 60, statusMessage: 'brainbase judgment answer check' },
];

function withoutInstalledHooks(hooks: unknown, configPath: string, removedIds?: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries((hooks ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      result[event] = groups;
      continue;
    }
    const kept: unknown[] = [];
    for (const group of groups) {
      const inner = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) {
        kept.push(group);
        continue;
      }
      const remaining = inner.filter((hook) => {
        const registration = installedHookRegistration(hook);
        if (!registration || !sameConfigFile(registration.configPath, configPath)) return true;
        removedIds?.add(registration.registrationId);
        return false;
      });
      if (remaining.length === inner.length) kept.push(group);
      else if (remaining.length > 0) kept.push({ ...(group as object), hooks: remaining });
    }
    if (kept.length > 0) result[event] = kept;
  }
  return result;
}

/** True when the settings hold a registration this installer wrote for `configPath`. */
export function hasInstalledClaudeCodeHooks(settings: Record<string, unknown>, configPath: string): boolean {
  for (const groups of Object.values((settings.hooks ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = (group as { hooks?: unknown })?.hooks;
      if (Array.isArray(inner) && inner.some((hook) => {
        const registered = installedHookConfigPath(hook);
        return registered !== null && sameConfigFile(registered, configPath);
      })) return true;
    }
  }
  return false;
}

/**
 * The hook groups one registration adds to Claude Code settings, one per
 * event. A preview shows these, not the settings they go into, which may hold
 * secrets (`env`, `apiKeyHelper`, other hooks' commands).
 */
export function claudeCodeJudgmentHookGroups(command: string): Array<{ event: string; group: Record<string, unknown> }> {
  return REGISTRATIONS.map(({ event, matcher, timeout, statusMessage }) => ({
    event,
    group: { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout, statusMessage }] },
  }));
}

/**
 * Claude Code settings with exactly one registration per event for
 * `configPath`, or none with `remove`. Only registrations this installer wrote
 * for the same config file (by any path to it) are replaced; every other hook
 * and setting is kept. The registration ids of the replaced commands are added
 * to `removedIds`.
 */
export function registerClaudeCodeJudgmentHooks(
  settings: Record<string, unknown>,
  { command, configPath, remove = false, removedIds }:
    { command: string; configPath: string; remove?: boolean; removedIds?: Set<string> },
): Record<string, unknown> {
  const hooks = withoutInstalledHooks(settings.hooks, configPath, removedIds);
  if (!remove) {
    for (const { event, group } of claudeCodeJudgmentHookGroups(command)) {
      hooks[event] = [...((hooks[event] as unknown[] | undefined) ?? []), group];
    }
  }
  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}
