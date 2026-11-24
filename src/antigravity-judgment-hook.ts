// Antigravity CLI adapter for a hosted Brainbase judgment Host.
//
// Antigravity runs this as a synchronous command hook (`brainbase judgment:antigravity-hook`)
// for PreInvocation, PreToolUse, PostToolUse, and Stop.
//
// Key protocol differences from Claude Code handled here:
// 1. PreInvocation fires before EVERY model call in a turn (including tool-call loops),
//    and Reason Network may inject system USER_INPUT messages. Local turn state tracks
//    `turn_active`, `turn_id`, and `last_opened_user_step_index` so UserPromptSubmit is
//    forwarded strictly once per user turn, while draining turn-scoped pending messages.
// 2. Non-git workspaces (e.g. Orca bot homes) are supported when `project_code` is set
//    and either `allow_non_git: true` or `cwd_prefixes` matches.
// 3. PostToolUse stdin omits `tool_response` and Stop stdin omits `last_assistant_message`.
//    These are synthesized safely from `error` and bounded tail reads of `transcriptPath`.
// 4. Antigravity MCP tool names (`mcp_brainbase-unson_<tool>` / `call_mcp_tool`) are
//    normalized to `mcp__brainbase__<tool>`.
// 5. Base URLs with path prefixes (e.g. `https://bb.unson.jp/runtime-mcp`) preserve their
//    path when resolving `host/judgment/hook`.
// 6. Strict fail-open outputs with short HTTP timeouts:
//    - PreInvocation: `{}` (or `{ injectSteps: [{ systemMessage: { systemMessage, metadata? } }], terminationBehavior: '' }`)
//    - PreToolUse: `{ decision: 'allow' }` (or `{ decision: 'deny', reason }`)
//    - PostToolUse: ALWAYS `{}` (any follow-up context is queued with `turn_id` for next PreInvocation)
//    - Stop: ALWAYS `{ decision: '' }` (never `"continue"`)

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BrainbaseLoginError, getAccessTokenOfLogin, type AccessTokenOptions } from './brainbase-login.js';
import {
  PRE_TOOL_USE_TOOLS,
  REGISTRATION_ID,
  bearerTransportSafe,
  canonicalFilePath,
  canonicalRepositoryIdentifier,
  digestSummary,
  forwardedStopPayload,
  hostCanMapRepository,
  resolveRepositoryScope,
  shellQuote,
  singleQuotedWords,
  type PersonToken,
  type RepositoryScope,
} from './claude-code-judgment-hook.js';

export const ANTIGRAVITY_HOOK_CONFIG_SCHEMA = 'brainbase-antigravity-judgment-hook-v1';
export const ANTIGRAVITY_HOOK_COMMAND = 'judgment:antigravity-hook';
export const ANTIGRAVITY_HOOK_KEY = 'brainbase-judgment';

export const DEFAULT_ANTIGRAVITY_TIMEOUTS_MS = {
  PreInvocation: 4_000,
  PreToolUse: 2_500,
  PostToolUse: 2_500,
  Stop: 5_000,
} as const;

export interface AntigravityHookTimeoutsMs {
  PreInvocation?: number;
  PreToolUse?: number;
  PostToolUse?: number;
  Stop?: number;
}

export interface AntigravityHookConfig {
  schema_version: typeof ANTIGRAVITY_HOOK_CONFIG_SCHEMA;
  /** Base URL of the hosted MCP serving `host/judgment/hook` (path prefix such as `/runtime-mcp` is preserved). */
  origin: string;
  /** Optional explicit hook endpoint URL (overrides `origin` + `host/judgment/hook`). */
  endpoint?: string;
  /** Origin of the Brainbase API the person logged in to via `brainbase login`. */
  login_server: string;
  /** Sent as `x-brainbase-project-code`. Required for non-git workspaces. */
  project_code?: string;
  /** Allow auditing non-git directories when `project_code` is configured. */
  allow_non_git?: boolean;
  /** Optional canonical directory prefixes allowed for auditing (canary & scope control). */
  cwd_prefixes?: string[];
  /** Optional audited repositories allowlist (`host/owner/name`). */
  repositories?: string[];
  /** Registration identity tying this config to one Antigravity `hooks.json` entry. */
  registration: { id: string; settings: string };
  /** Optional per-event HTTP timeout overrides in milliseconds. */
  timeouts_ms?: AntigravityHookTimeoutsMs;
}

export type AntigravityHookPayload = Record<string, unknown>;
export type AntigravityHookOutput = Record<string, unknown>;

export interface AntigravityHookOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Overrides how the person token is obtained (tests). */
  accessToken?: () => Promise<string | PersonToken>;
  credentials?: AccessTokenOptions;
  /** The hook config file; the installer passes it as `--config`. */
  configPath?: string;
  /** The registration id the installer put in the command as `--registration`. */
  registrationId?: string;
  /** Clock override for stale-turn crash recovery tests. */
  now?: () => number;
  /** Stale active turn threshold in ms (default 30 minutes). */
  staleTurnMs?: number;
  /**
   * Explicit allowed transcript root directories (primarily for tests).
   * When omitted, defaults to Antigravity / Gemini conversation brain directories
   * (or `BRAINBASE_ANTIGRAVITY_TRANSCRIPT_ROOTS`).
   */
  allowedTranscriptRoots?: readonly string[];
}

export interface TranscriptReadOptions {
  conversationId: string;
  allowedTranscriptRoots?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

const TURN_SCHEMA = 'brainbase-antigravity-judgment-turn-v1';
const TRANSCRIPT_TAIL_MAX_BYTES = 256 * 1024;
const MAX_PENDING_MESSAGES = 8;
const DEFAULT_STALE_TURN_MS = 30 * 60 * 1000;
const MAX_CONFIG_TIMEOUT_MS = 60_000;
const TURN_STATE_LOCK_STALE_MS = 10_000;
const TURN_STATE_LOCK_TIMEOUT_MS = 2_000;
const TURN_STATE_LOCK_RETRY_MS = 10;

interface PendingContextMessage {
  turn_id: string;
  turn_generation?: number;
  additional_context?: string;
  system_message?: string;
  created_at: string;
}

interface AntigravityTurnState {
  schema_version: typeof TURN_SCHEMA;
  turn_id: string;
  turn_generation: number;
  turn_active: boolean;
  started_at: string;
  last_opened_user_step_index: number | null;
  last_prompt_digest: string | null;
  start_status: 'failed' | 'started' | 'out_of_scope';
  in_git: boolean;
  repository: string | null;
  checkout: string | null;
  non_git_scope_root: string | null;
  matched_cwd_prefix: string | null;
  destination: string;
  login: string | null;
  auth_fingerprint: string | null;
  pending_messages: PendingContextMessage[];
}

interface AntigravityScope extends RepositoryScope {
  cwd: string;
  matchedCwdPrefix: string | null;
}

interface Context {
  env: NodeJS.ProcessEnv;
  config: AntigravityHookConfig;
  fetch: typeof fetch;
  accessToken: () => Promise<string | PersonToken>;
  scope: AntigravityScope;
  configPath: string;
  now: () => number;
  staleTurnMs: number;
  allowedTranscriptRoots?: readonly string[];
}

type LoginPin = { expected?: string | null; used?: string | null };

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function brainbaseHome(env: NodeJS.ProcessEnv): string {
  return join(env.HOME || homedir(), '.brainbase');
}

export function defaultAntigravityHookConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAINBASE_ANTIGRAVITY_JUDGMENT_HOOK_CONFIG?.trim()
    || join(brainbaseHome(env), 'antigravity-judgment-hook.json');
}

export function defaultAntigravityHooksJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), '.gemini', 'config', 'hooks.json');
}

/** Fail-open stdout contract per Antigravity lifecycle event. */
export function antigravityFailOpenOutput(eventName: unknown): AntigravityHookOutput {
  if (eventName === 'Stop') return { decision: '' };
  if (eventName === 'PreToolUse') return { decision: 'allow' };
  return {};
}

/**
 * Validates and normalizes a hosted MCP base URL while preserving its path
 * prefix (e.g. `https://bb.unson.jp/runtime-mcp`).
 */
export function normalizeAntigravityHookBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BrainbaseLoginError('login_server_invalid', `Not a URL: ${value}`);
  }
  if (!bearerTransportSafe(url)) {
    throw new BrainbaseLoginError('login_server_transport_unsafe', 'The server must use https (http is allowed only for localhost).');
  }
  if (url.username || url.password) {
    throw new BrainbaseLoginError('login_server_invalid', 'The server URL must not contain a user name or password.');
  }
  if (url.search || url.hash) {
    throw new BrainbaseLoginError('login_server_invalid', 'The hook base URL must not contain query parameters or a fragment.');
  }
  const cleanPath = url.pathname.replace(/\/+$/u, '');
  return cleanPath ? `${url.origin}${cleanPath}` : url.origin;
}

/**
 * Resolves the concrete judgment hook endpoint URL without dropping base URL
 * path prefixes such as `/runtime-mcp`.
 */
export function resolveAntigravityHookEndpoint(
  config: Pick<AntigravityHookConfig, 'origin' | 'endpoint'>,
): URL {
  if (typeof config.endpoint === 'string' && config.endpoint.trim()) {
    let explicit: URL;
    try {
      explicit = new URL(config.endpoint.trim());
    } catch {
      throw new Error('judgment_hook_endpoint_invalid');
    }
    if (!bearerTransportSafe(explicit) || explicit.username || explicit.password) {
      throw new Error('judgment_hook_transport_unsafe');
    }
    return explicit;
  }
  let endpoint: URL;
  try {
    const base = config.origin.trim();
    const parsedBase = new URL(base);
    if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
      throw new Error('judgment_hook_endpoint_invalid');
    }
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    endpoint = new URL('host/judgment/hook', normalizedBase);
  } catch (error) {
    if (error instanceof Error && error.message === 'judgment_hook_endpoint_invalid') throw error;
    throw new Error('judgment_hook_endpoint_invalid');
  }
  if (!bearerTransportSafe(endpoint) || endpoint.username || endpoint.password) {
    throw new Error('judgment_hook_transport_unsafe');
  }
  return endpoint;
}

function parseTimeouts(raw: unknown): AntigravityHookTimeoutsMs | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const result: AntigravityHookTimeoutsMs = {};
  for (const key of ['PreInvocation', 'PreToolUse', 'PostToolUse', 'Stop'] as const) {
    if (record[key] === undefined) continue;
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_CONFIG_TIMEOUT_MS) {
      return null;
    }
    result[key] = Math.trunc(value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function readAntigravityHookConfig(path: string): AntigravityHookConfig | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  return parseAntigravityHookConfig(text);
}

/** Parses an Antigravity hook config from JSON text, or null if unusable. */
export function parseAntigravityHookConfig(text: string): AntigravityHookConfig | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const value = parsed as Partial<AntigravityHookConfig> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema_version !== ANTIGRAVITY_HOOK_CONFIG_SCHEMA) return null;
  if (typeof value.origin !== 'string' || !value.origin.trim()) return null;
  if (typeof value.login_server !== 'string' || !value.login_server.trim()) return null;
  if (value.endpoint !== undefined && (typeof value.endpoint !== 'string' || !value.endpoint.trim())) return null;
  if (value.allow_non_git !== undefined && typeof value.allow_non_git !== 'boolean') return null;

  let repositories: string[] | undefined;
  if (value.repositories !== undefined) {
    if (!Array.isArray(value.repositories)) return null;
    repositories = [];
    for (const entry of value.repositories) {
      const normalized = typeof entry === 'string' ? canonicalRepositoryIdentifier(entry) : null;
      if (!normalized) return null;
      repositories.push(normalized);
    }
  }

  let cwdPrefixes: string[] | undefined;
  if (value.cwd_prefixes !== undefined) {
    if (!Array.isArray(value.cwd_prefixes)) return null;
    cwdPrefixes = [];
    for (const entry of value.cwd_prefixes) {
      if (typeof entry !== 'string' || !entry.trim()) return null;
      cwdPrefixes.push(canonicalFilePath(entry.trim()));
    }
  }

  const timeouts = parseTimeouts(value.timeouts_ms);
  if (timeouts === null) return null;

  const registration = value.registration as Partial<AntigravityHookConfig['registration']> | undefined;
  if (!registration || typeof registration.id !== 'string' || !REGISTRATION_ID.test(registration.id)
    || typeof registration.settings !== 'string' || !registration.settings) {
    return null;
  }

  return {
    schema_version: ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
    origin: value.origin.trim(),
    ...(value.endpoint ? { endpoint: value.endpoint.trim() } : {}),
    login_server: value.login_server.trim(),
    registration: { id: registration.id, settings: registration.settings },
    ...(typeof value.project_code === 'string' && value.project_code.trim()
      ? { project_code: value.project_code.trim() } : {}),
    ...(value.allow_non_git !== undefined ? { allow_non_git: value.allow_non_git } : {}),
    ...(cwdPrefixes !== undefined ? { cwd_prefixes: cwdPrefixes } : {}),
    ...(repositories !== undefined ? { repositories } : {}),
    ...(timeouts !== undefined ? { timeouts_ms: timeouts } : {}),
  };
}

export function isAntigravityHookConfigFile(path: string): boolean {
  try {
    return isAntigravityHookConfigText(readFileSync(path, 'utf8'));
  } catch {
    return false;
  }
}

export function isAntigravityHookConfigText(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { schema_version?: unknown } | null;
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && parsed.schema_version === ANTIGRAVITY_HOOK_CONFIG_SCHEMA;
  } catch {
    return false;
  }
}

// ---- Tool name normalization ----

/**
 * Normalizes Antigravity MCP tool names to the canonical Brainbase Host format
 * (`mcp__brainbase__<tool>`):
 * - `mcp_brainbase_<tool>` or `mcp_brainbase-<suffix>_<tool>` -> `mcp__brainbase__<tool>`
 * - `call_mcp_tool` with `ServerName` matching `^brainbase(?:-.+)?$` -> `mcp__brainbase__<ToolName>`
 */
export function normalizeAntigravityToolName(name: string, args?: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  if (trimmed.startsWith('mcp__brainbase__')) return trimmed;
  const eagerMatch = /^mcp_brainbase(?:-[a-z0-9-]+)?_(.+)$/u.exec(trimmed);
  if (eagerMatch) {
    return `mcp__brainbase__${eagerMatch[1]}`;
  }
  if (trimmed === 'call_mcp_tool' && args && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    const serverName = typeof record.ServerName === 'string' ? record.ServerName.trim()
      : typeof record.serverName === 'string' ? record.serverName.trim() : '';
    const toolName = typeof record.ToolName === 'string' ? record.ToolName.trim()
      : typeof record.toolName === 'string' ? record.toolName.trim() : '';
    if (/^brainbase(?:-.+)?$/u.test(serverName) && toolName) {
      return `mcp__brainbase__${toolName}`;
    }
  }
  return trimmed;
}

function normalizedToolInput(rawName: string, normalizedName: string, args: unknown): unknown {
  if (rawName === 'call_mcp_tool' && normalizedName.startsWith('mcp__brainbase__')
    && args && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if ('Arguments' in record) return record.Arguments;
    if ('arguments' in record) return record.arguments;
  }
  return args ?? {};
}

// ---- Scope resolution (git + non-git + cwd_prefixes) ----

function stripTrailingSeparator(pathValue: string): string {
  if (pathValue === sep || pathValue === '/') return pathValue;
  const trimmed = pathValue.replace(/[/\\]+$/u, '');
  return trimmed || sep;
}

function matchesCwdPrefix(cwdCanonical: string, prefix: string): boolean {
  const canonicalPrefix = stripTrailingSeparator(canonicalFilePath(prefix));
  const canonicalCwd = stripTrailingSeparator(cwdCanonical);
  if (canonicalPrefix === sep || canonicalPrefix === '/') {
    return canonicalCwd.startsWith(canonicalPrefix);
  }
  return canonicalCwd === canonicalPrefix || canonicalCwd.startsWith(`${canonicalPrefix}${sep}`);
}

function resolvePayloadCwd(payload: AntigravityHookPayload): string {
  if (typeof payload.cwd === 'string' && payload.cwd.trim()) {
    return canonicalFilePath(payload.cwd.trim());
  }
  if (Array.isArray(payload.workspacePaths)) {
    const first = payload.workspacePaths.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (first) return canonicalFilePath(first.trim());
  }
  return canonicalFilePath(process.cwd());
}

function resolveAntigravityScope(
  payload: AntigravityHookPayload,
  config: AntigravityHookConfig,
  env: NodeJS.ProcessEnv,
): AntigravityScope {
  const cwd = resolvePayloadCwd(payload);
  const gitScope = resolveRepositoryScope(cwd, env);
  const matchedCwdPrefix = config.cwd_prefixes
    ? (config.cwd_prefixes.find((prefix) => matchesCwdPrefix(cwd, prefix)) ?? null)
    : null;
  return { ...gitScope, cwd, matchedCwdPrefix };
}

function isAuditedAntigravityScope(scope: AntigravityScope, config: AntigravityHookConfig): boolean {
  if (config.cwd_prefixes !== undefined && scope.matchedCwdPrefix === null) {
    return false;
  }
  if (scope.inGit) {
    if (scope.unresolved) return false;
    if (scope.unidentified && !config.project_code) return false;
    if (!config.repositories) return true;
    return scope.repository !== null && config.repositories.includes(scope.repository);
  }
  // Non-git directory (e.g. Orca bot home): requires explicit project_code
  // plus either allow_non_git: true or a matching cwd_prefixes entry.
  if (!config.project_code) return false;
  return config.allow_non_git === true || scope.matchedCwdPrefix !== null;
}

function sameTurnScope(state: AntigravityTurnState, scope: AntigravityScope): boolean {
  if (state.matched_cwd_prefix !== scope.matchedCwdPrefix) return false;
  if (state.in_git) {
    if (!scope.inGit) return false;
    if (typeof state.repository === 'string') return state.repository === scope.repository;
    return scope.repository === null && typeof state.checkout === 'string' && state.checkout === scope.checkout;
  }
  if (scope.inGit) return false;
  if (!state.non_git_scope_root) return false;
  return matchesCwdPrefix(scope.cwd, state.non_git_scope_root);
}

function resolvedEndpointString(config: Pick<AntigravityHookConfig, 'origin' | 'endpoint'>): string | null {
  try {
    return resolveAntigravityHookEndpoint(config).toString();
  } catch {
    return null;
  }
}

function destinationOf(context: Context): string {
  return JSON.stringify([
    context.configPath,
    resolvedEndpointString(context.config) ?? '',
    context.config.login_server,
    context.config.project_code ?? null,
    context.config.allow_non_git === true,
    context.config.cwd_prefixes ?? null,
    context.config.repositories ?? null,
  ]);
}

function sameDestination(state: AntigravityTurnState, context: Context): boolean {
  return state.destination === destinationOf(context);
}

function computeAuthFingerprint(
  context: Context,
  nonGitScopeRoot: string | null,
  loginId: string | null,
): string | null {
  const endpoint = resolvedEndpointString(context.config);
  if (!endpoint) return null;
  if (!isAuditedAntigravityScope(context.scope, context.config)
    || !hostCanMapRepository(context.scope.repository, context.config)) {
    return null;
  }
  return sha256(JSON.stringify({
    schema: TURN_SCHEMA,
    config_path: context.configPath,
    endpoint,
    login_server: context.config.login_server,
    project_code: context.config.project_code ?? null,
    allow_non_git: context.config.allow_non_git === true,
    cwd_prefixes: context.config.cwd_prefixes ?? null,
    repositories: context.config.repositories ?? null,
    in_git: context.scope.inGit,
    repository: context.scope.repository,
    checkout: context.scope.inGit ? context.scope.checkout : null,
    matched_cwd_prefix: context.scope.matchedCwdPrefix,
    non_git_scope_root: context.scope.inGit ? null : nonGitScopeRoot,
    login: loginId,
  }));
}

function isTurnStaticAuthorized(state: AntigravityTurnState, context: Context): boolean {
  if (!state.turn_active || state.start_status !== 'started' || state.turn_generation <= 0) {
    return false;
  }
  if (typeof state.auth_fingerprint !== 'string' || !state.auth_fingerprint) {
    return false;
  }
  if (!isAuditedAntigravityScope(context.scope, context.config)
    || !hostCanMapRepository(context.scope.repository, context.config)) {
    return false;
  }
  if (!sameTurnScope(state, context.scope) || !sameDestination(state, context)) {
    return false;
  }
  const expectedFingerprint = computeAuthFingerprint(context, state.non_git_scope_root, state.login);
  return expectedFingerprint !== null && expectedFingerprint === state.auth_fingerprint;
}

async function resolveCurrentLoginId(
  context: Context,
): Promise<{ ok: true; loginId: string | null } | { ok: false }> {
  try {
    const obtained = await context.accessToken();
    const loginId = typeof obtained === 'string' ? null : obtained.loginId;
    return { ok: true, loginId };
  } catch {
    return { ok: false };
  }
}

// ---- Transcript tail reader & extractors ----

interface TranscriptEntry {
  step_index?: unknown;
  source?: unknown;
  type?: unknown;
  content?: unknown;
}

const ALLOWED_TRANSCRIPT_FILENAMES = new Set(['transcript.jsonl', 'transcript_full.jsonl']);

function isSafeConversationIdSegment(conversationId: string): boolean {
  return conversationId.length > 0
    && conversationId !== '.'
    && conversationId !== '..'
    && !conversationId.includes('/')
    && !conversationId.includes('\\')
    && !conversationId.includes('\0');
}

function defaultAntigravityTranscriptRoots(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.BRAINBASE_ANTIGRAVITY_TRANSCRIPT_ROOTS ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured;
  const home = env.HOME || homedir();
  return [
    join(home, '.gemini', 'antigravity-cli', 'brain'),
    join(home, '.gemini', 'antigravity', 'brain'),
  ];
}

function canonicalTranscriptRoots(options: TranscriptReadOptions): string[] {
  const rawRoots = options.allowedTranscriptRoots !== undefined
    ? [...options.allowedTranscriptRoots]
    : defaultAntigravityTranscriptRoots(options.env ?? process.env);
  const resolved: string[] = [];
  for (const root of rawRoots) {
    if (typeof root !== 'string' || !root.trim()) continue;
    try {
      resolved.push(realpathSync(root.trim()));
    } catch {
      // Missing root cannot contain any authorized transcript file.
    }
  }
  return resolved;
}

function matchesConversationTranscriptStructure(
  canonicalRoot: string,
  canonicalFile: string,
  conversationId: string,
): boolean {
  const rel = relative(canonicalRoot, canonicalFile);
  if (!rel || rel === '.' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return false;
  }
  const segments = rel.split(sep);
  if (segments.length === 4
    && segments[0] === conversationId
    && segments[1] === '.system_generated'
    && segments[2] === 'logs'
    && ALLOWED_TRANSCRIPT_FILENAMES.has(segments[3])) {
    return true;
  }
  if (segments.length === 5
    && segments[0] === 'brain'
    && segments[1] === conversationId
    && segments[2] === '.system_generated'
    && segments[3] === 'logs'
    && ALLOWED_TRANSCRIPT_FILENAMES.has(segments[4])) {
    return true;
  }
  if (segments.length === 2
    && segments[0] === conversationId
    && ALLOWED_TRANSCRIPT_FILENAMES.has(segments[1])) {
    return true;
  }
  if (segments.length === 1 && segments[0] === `${conversationId}.jsonl`) {
    return true;
  }
  return false;
}

function resolveAuthorizedTranscriptPath(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): string | null {
  if (typeof transcriptPath !== 'string' || !transcriptPath.trim() || transcriptPath.includes('\0')) {
    return null;
  }
  const conversationId = options?.conversationId?.trim() ?? '';
  if (!isSafeConversationIdSegment(conversationId)) return null;

  const rawPath = transcriptPath.trim();
  try {
    // Reject symlinks, FIFOs, sockets, devices, and directories before resolving or opening.
    if (!lstatSync(rawPath).isFile()) return null;
    const canonicalPath = realpathSync(rawPath);
    const roots = canonicalTranscriptRoots(options!);
    if (roots.length === 0) return null;
    const allowed = roots.some((root) => matchesConversationTranscriptStructure(root, canonicalPath, conversationId));
    return allowed ? canonicalPath : null;
  } catch {
    return null;
  }
}

function readTranscriptTailEntries(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): TranscriptEntry[] {
  const canonicalPath = resolveAuthorizedTranscriptPath(transcriptPath, options);
  if (!canonicalPath) return [];
  let fd: number | undefined;
  try {
    if (!lstatSync(canonicalPath).isFile()) return [];
    const openFlags = fsConstants.O_RDONLY
      | (fsConstants.O_NONBLOCK ?? 0)
      | (fsConstants.O_NOFOLLOW ?? 0);
    fd = openSync(canonicalPath, openFlags);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return [];
    const size = stat.size;
    if (size <= 0) return [];
    const readSize = Math.min(size, TRANSCRIPT_TAIL_MAX_BYTES);
    const offset = size - readSize;
    const buffer = Buffer.allocUnsafe(readSize);
    const bytesRead = readSync(fd, buffer, 0, readSize, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline < 0) return [];
      text = text.slice(firstNewline + 1);
    }
    const entries: TranscriptEntry[] = [];
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          entries.push(parsed as TranscriptEntry);
        }
      } catch {
        // Ignore truncated or malformed lines.
      }
    }
    return entries;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function stripUserRequestWrapper(text: string): string {
  const trimmed = text.trim();
  const match = /^<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/u.exec(trimmed);
  if (match) return match[1].trim();
  return trimmed;
}

const SYSTEM_INJECTED_PROMPT_PREFIXES = [
  /^Reason Network:/iu,
  /^<SYSTEM_MESSAGE>/iu,
];

/**
 * Identifies system-injected USER_INPUT messages (e.g. Reason Network hooks)
 * so they never masquerade as a fresh human prompt or trigger duplicate turns.
 */
export function isSystemInjectedUserInput(text: string, source?: unknown): boolean {
  if (source === 'SYSTEM_SDK' || source === 'SYSTEM') return true;
  const unwrapped = stripUserRequestWrapper(text);
  if (!unwrapped) return true;
  return SYSTEM_INJECTED_PROMPT_PREFIXES.some((pattern) => pattern.test(unwrapped));
}

export function extractLatestNonSystemUserInput(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): { stepIndex: number | null; content: string } | null {
  const entries = readTranscriptTailEntries(transcriptPath, options);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'USER_INPUT' || typeof entry.content !== 'string') continue;
    if (isSystemInjectedUserInput(entry.content, entry.source)) continue;
    const content = stripUserRequestWrapper(entry.content);
    if (!content) continue;
    const stepIndex = typeof entry.step_index === 'number' && Number.isSafeInteger(entry.step_index)
      ? entry.step_index
      : null;
    return { stepIndex, content };
  }
  return null;
}

export function extractLastAssistantMessage(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): string | undefined {
  const entries = readTranscriptTailEntries(transcriptPath, options);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== 'PLANNER_RESPONSE' || typeof entry.content !== 'string') continue;
    if (!entry.content.trim()) continue;
    return entry.content;
  }
  return undefined;
}

function stripToolTimestampHeader(text: string): string {
  const lines = text.split(/\r?\n/u);
  let index = 0;
  while (index < lines.length && /^(?:Created At|Completed At):\s+/u.test(lines[index])) {
    index += 1;
  }
  const body = lines.slice(index).join('\n').trim();
  return body || text.trim();
}

export function extractToolResultFromTranscript(
  transcriptPath: unknown,
  stepIdx: unknown,
  options?: TranscriptReadOptions,
): string | null {
  if (typeof stepIdx !== 'number' || !Number.isSafeInteger(stepIdx)) return null;
  const entries = readTranscriptTailEntries(transcriptPath, options);
  // Prefer exact step_index match, then immediate neighbor (+1) if wrapper shifted index.
  for (const targetStep of [stepIdx, stepIdx + 1]) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.step_index !== targetStep) continue;
      if (entry.type === 'USER_INPUT' || entry.type === 'PLANNER_RESPONSE') continue;
      if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
      return stripToolTimestampHeader(entry.content);
    }
  }
  return null;
}

// ---- Turn state persistence & exclusive lock ----

function turnDirectory(env: NodeJS.ProcessEnv): string {
  return env.BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR
    || join(brainbaseHome(env), 'var', 'antigravity-judgment-turns');
}

function turnKey(conversationId: string, configPath: string): string {
  return sha256(`${conversationId}\n${configPath}`);
}

function statePath(env: NodeJS.ProcessEnv, key: string): string {
  return join(turnDirectory(env), `${key}.json`);
}

function lockPathFor(env: NodeJS.ProcessEnv, key: string): string {
  return `${statePath(env, key)}.lock`;
}

async function withTurnStateLock<T>(
  env: NodeJS.ProcessEnv,
  key: string,
  fn: () => T,
): Promise<T> {
  mkdirSync(turnDirectory(env), { recursive: true, mode: 0o700 });
  const lockPath = lockPathFor(env, key);
  const lockToken = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + TURN_STATE_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      const fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      try {
        writeFileSync(fd, `${lockToken}\n`);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const stat = statSync(lockPath);
        stale = (Date.now() - stat.mtimeMs) > TURN_STATE_LOCK_STALE_MS;
      } catch (statError) {
        if ((statError as { code?: unknown })?.code === 'ENOENT') continue;
      }
      if (stale) {
        try { unlinkSync(lockPath); } catch {}
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('antigravity_turn_state_lock_timeout');
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, TURN_STATE_LOCK_RETRY_MS));
    }
  }

  try {
    return fn();
  } finally {
    try {
      const owner = readFileSync(lockPath, 'utf8').trim();
      if (owner === lockToken) {
        unlinkSync(lockPath);
      }
    } catch {}
  }
}

function readState(env: NodeJS.ProcessEnv, key: string): AntigravityTurnState | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(env, key), 'utf8')) as Partial<AntigravityTurnState> | null;
    if (!parsed || parsed.schema_version !== TURN_SCHEMA || typeof parsed.turn_id !== 'string' || !parsed.turn_id) {
      return null;
    }
    const pending = Array.isArray(parsed.pending_messages)
      ? parsed.pending_messages.filter((item): item is PendingContextMessage => (
        !!item && typeof item === 'object' && typeof (item as PendingContextMessage).turn_id === 'string'
      ))
      : [];
    const generation = typeof parsed.turn_generation === 'number'
      && Number.isSafeInteger(parsed.turn_generation) && parsed.turn_generation > 0
      ? parsed.turn_generation
      : 0;
    return {
      schema_version: TURN_SCHEMA,
      turn_id: parsed.turn_id,
      turn_generation: generation,
      turn_active: parsed.turn_active === true,
      started_at: typeof parsed.started_at === 'string' ? parsed.started_at : new Date(0).toISOString(),
      last_opened_user_step_index: typeof parsed.last_opened_user_step_index === 'number'
        ? parsed.last_opened_user_step_index : null,
      last_prompt_digest: typeof parsed.last_prompt_digest === 'string' ? parsed.last_prompt_digest : null,
      start_status: parsed.start_status === 'started' || parsed.start_status === 'out_of_scope'
        ? parsed.start_status : 'failed',
      in_git: parsed.in_git === true,
      repository: typeof parsed.repository === 'string' ? parsed.repository : null,
      checkout: typeof parsed.checkout === 'string' ? parsed.checkout : null,
      non_git_scope_root: typeof parsed.non_git_scope_root === 'string' ? parsed.non_git_scope_root : null,
      matched_cwd_prefix: typeof parsed.matched_cwd_prefix === 'string' ? parsed.matched_cwd_prefix : null,
      destination: typeof parsed.destination === 'string' ? parsed.destination : '',
      login: typeof parsed.login === 'string' ? parsed.login : null,
      auth_fingerprint: typeof parsed.auth_fingerprint === 'string' && parsed.auth_fingerprint
        ? parsed.auth_fingerprint : null,
      pending_messages: pending,
    };
  } catch {
    return null;
  }
}

function writeState(env: NodeJS.ProcessEnv, key: string, state: AntigravityTurnState): void {
  mkdirSync(turnDirectory(env), { recursive: true, mode: 0o700 });
  const target = statePath(env, key);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    renameSync(temporary, target);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

// ---- Transport ----

/** Namespaces session and turn IDs per registration, matching Claude Code isolation. */
export function antigravityNamespacedId(id: string, config: Pick<AntigravityHookConfig, 'registration'>): string {
  return `${id}.bb-${sha256(`brainbase-antigravity-registration\n${config.registration.id}`).slice(0, 16)}`;
}

function timeoutForEvent(
  config: AntigravityHookConfig,
  antigravityEvent: keyof typeof DEFAULT_ANTIGRAVITY_TIMEOUTS_MS,
): number {
  return config.timeouts_ms?.[antigravityEvent] ?? DEFAULT_ANTIGRAVITY_TIMEOUTS_MS[antigravityEvent];
}

function turnLogin(state: AntigravityTurnState): LoginPin {
  return { expected: typeof state.login === 'string' || state.login === null ? state.login : '\u0000unrecorded' };
}

async function forward(
  payload: Record<string, unknown>,
  context: Context,
  repository: string | null,
  login: LoginPin,
  antigravityEvent: keyof typeof DEFAULT_ANTIGRAVITY_TIMEOUTS_MS,
): Promise<Record<string, unknown>> {
  if (!hostCanMapRepository(repository, context.config)) throw new Error('judgment_repository_unmappable');
  const endpoint = resolveAntigravityHookEndpoint(context.config);
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
  if (login.expected !== undefined && login.expected !== loginId) throw new Error('judgment_turn_login_changed');
  login.used = loginId;

  const sent = {
    ...payload,
    session_id: antigravityNamespacedId(String(payload.session_id), context.config),
    turn_id: antigravityNamespacedId(String(payload.turn_id), context.config),
  };

  let response: Response;
  try {
    response = await context.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-brainbase-judgment-host': 'antigravity',
        ...(context.config.project_code ? { 'x-brainbase-project-code': context.config.project_code } : {}),
        ...(repository ? { 'x-brainbase-repository': repository } : {}),
      },
      body: JSON.stringify(sent),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutForEvent(context.config, antigravityEvent)),
    });
  } catch (error) {
    throw new Error((error as { name?: unknown })?.name === 'TimeoutError'
      ? 'judgment_hook_timeout' : 'judgment_hook_unreachable');
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

// ---- Output conversion (Host -> Antigravity injectSteps) ----

function extractHostMessages(output: Record<string, unknown>): {
  additionalContext?: string;
  systemMessage?: string;
} {
  const systemMessage = typeof output.systemMessage === 'string' && output.systemMessage.trim()
    ? output.systemMessage.trim()
    : undefined;
  const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
  const additionalContext = specific && typeof specific === 'object' && !Array.isArray(specific)
    && typeof specific.additionalContext === 'string' && specific.additionalContext.trim()
    ? specific.additionalContext.trim()
    : undefined;
  return { additionalContext, systemMessage };
}

/**
 * Formats a Brainbase judgment context as an Antigravity `injectSteps` entry.
 * Because `systemMessage` persists in Antigravity's conversation trajectory across turns,
 * the header binds it to the current `turn_id` and explicitly supersedes earlier turns.
 */
function buildSystemMessageStep(
  turnId: string,
  additionalContext?: string,
  userMarkdown?: string,
): Record<string, unknown> | null {
  if (!additionalContext && !userMarkdown) return null;
  const guardHeader = [
    `[Brainbase Judgment Turn: ${turnId}]`,
    `※この判断契約・先頭監査行は当ターン（${turnId}）のみ有効です。過去のターンに注入された旧ターンの判断契約・先頭監査行は上書きされ無効です。`,
  ].join('\n');
  const modelText = additionalContext ? `${guardHeader}\n\n${additionalContext}` : '';
  return {
    systemMessage: {
      systemMessage: modelText,
      ...(userMarkdown ? { metadata: { user_markdown: userMarkdown } } : {}),
    },
  };
}

function preInvocationOutputFromSteps(steps: Array<Record<string, unknown>>): AntigravityHookOutput {
  if (steps.length === 0) return {};
  return {
    injectSteps: steps,
    terminationBehavior: '',
  };
}

// ---- Event handlers ----

function shouldRecoverNewTurn(
  state: AntigravityTurnState,
  currentUserStepIndex: number | null,
  promptDigest: string | null,
  invocationNum: number | null,
  nowMs: number,
  staleTurnMs: number,
): boolean {
  if (!state.turn_active) return true;
  if (currentUserStepIndex !== null && state.last_opened_user_step_index !== null
    && currentUserStepIndex > state.last_opened_user_step_index) {
    return true;
  }
  if (invocationNum === 1) {
    if (promptDigest !== null && state.last_prompt_digest !== null && promptDigest !== state.last_prompt_digest) {
      return true;
    }
    const startedMs = Date.parse(state.started_at);
    if (Number.isFinite(startedMs) && (nowMs - startedMs) >= staleTurnMs) {
      return true;
    }
  }
  return false;
}

function transcriptOptionsFor(conversationId: string, context: Context): TranscriptReadOptions {
  return {
    conversationId,
    env: context.env,
    ...(context.allowedTranscriptRoots !== undefined
      ? { allowedTranscriptRoots: context.allowedTranscriptRoots } : {}),
  };
}

function matchesPendingEntry(entry: PendingContextMessage, state: AntigravityTurnState): boolean {
  if (entry.turn_id !== state.turn_id) return false;
  if (entry.turn_generation !== undefined && entry.turn_generation !== state.turn_generation) return false;
  return true;
}

async function handlePreInvocation(
  payload: AntigravityHookPayload,
  conversationId: string,
  context: Context,
): Promise<AntigravityHookOutput> {
  const key = turnKey(conversationId, context.configPath);
  const transcriptOpts = transcriptOptionsFor(conversationId, context);
  const authorizedTranscriptPath = resolveAuthorizedTranscriptPath(payload.transcriptPath, transcriptOpts);
  const transcriptUser = extractLatestNonSystemUserInput(payload.transcriptPath, transcriptOpts);
  const rawLastUserInput = typeof payload.lastUserInput === 'string' ? payload.lastUserInput : '';
  const prompt = rawLastUserInput && !isSystemInjectedUserInput(rawLastUserInput)
    ? stripUserRequestWrapper(rawLastUserInput)
    : (transcriptUser?.content ?? null);
  const currentUserStepIndex = transcriptUser?.stepIndex ?? null;
  const promptDigest = prompt ? sha256(prompt) : null;
  const invocationNum = typeof payload.invocationNum === 'number' && Number.isSafeInteger(payload.invocationNum)
    ? payload.invocationNum : null;

  const previous = await withTurnStateLock(context.env, key, () => readState(context.env, key));

  if (previous && !shouldRecoverNewTurn(
    previous,
    currentUserStepIndex,
    promptDigest,
    invocationNum,
    context.now(),
    context.staleTurnMs,
  )) {
    // Same active turn (2nd+ PreInvocation in tool loop or duplicate):
    // NEVER fire a new UserPromptSubmit. Re-authorize started state, scope,
    // destination, project, and current login BEFORE draining or injecting.
    if (previous.pending_messages.length === 0) {
      return {};
    }

    const staticAuthorized = isTurnStaticAuthorized(previous, context);
    if (!staticAuthorized) {
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (latest && latest.turn_id === previous.turn_id
            && latest.turn_generation === previous.turn_generation
            && latest.pending_messages.length > 0) {
            writeState(context.env, key, { ...latest, pending_messages: [] });
          }
        });
      } catch {}
      return {};
    }

    const currentLogin = await resolveCurrentLoginId(context);
    const expectedFingerprint = currentLogin.ok
      ? computeAuthFingerprint(context, previous.non_git_scope_root, currentLogin.loginId)
      : null;
    const loginAuthorized = currentLogin.ok
      && currentLogin.loginId === previous.login
      && expectedFingerprint !== null
      && expectedFingerprint === previous.auth_fingerprint;

    const drained = await withTurnStateLock(context.env, key, (): PendingContextMessage[] => {
      const latest = readState(context.env, key);
      if (!latest || latest.turn_id !== previous.turn_id || latest.turn_generation !== previous.turn_generation) {
        return [];
      }
      if (!latest.turn_active) {
        return [];
      }
      const stillAuthorized = loginAuthorized
        && isTurnStaticAuthorized(latest, context)
        && latest.login === (currentLogin.ok ? currentLogin.loginId : null)
        && latest.auth_fingerprint === expectedFingerprint;
      if (!stillAuthorized) {
        if (latest.pending_messages.length > 0) {
          writeState(context.env, key, { ...latest, pending_messages: [] });
        }
        return [];
      }
      const matching = latest.pending_messages.filter((entry) => matchesPendingEntry(entry, latest));
      if (latest.pending_messages.length > 0) {
        writeState(context.env, key, { ...latest, pending_messages: [] });
      }
      return matching;
    });

    const steps: Array<Record<string, unknown>> = [];
    for (const entry of drained) {
      const step = buildSystemMessageStep(previous.turn_id, entry.additional_context, entry.system_message);
      if (step) steps.push(step);
    }
    return preInvocationOutputFromSteps(steps);
  }

  // Opening a new turn: if no non-system user prompt could be found, skip cleanly.
  if (!prompt) {
    if (previous && previous.pending_messages.length > 0) {
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (latest && latest.turn_id === previous.turn_id
            && latest.turn_generation === previous.turn_generation
            && latest.pending_messages.length > 0) {
            writeState(context.env, key, { ...latest, turn_active: false, pending_messages: [] });
          }
        });
      } catch {}
    }
    return {};
  }

  const nonGitRoot = context.scope.inGit
    ? null
    : (context.scope.matchedCwdPrefix ?? context.scope.cwd);
  const inScope = isAuditedAntigravityScope(context.scope, context.config)
    && hostCanMapRepository(context.scope.repository, context.config);
  const newTurnId = randomUUID();

  const openedState = await withTurnStateLock(context.env, key, () => {
    const latest = readState(context.env, key);
    const nextGeneration = (latest?.turn_generation ?? 0) + 1;
    const state: AntigravityTurnState = {
      schema_version: TURN_SCHEMA,
      turn_id: newTurnId,
      turn_generation: nextGeneration,
      turn_active: true,
      started_at: new Date(context.now()).toISOString(),
      last_opened_user_step_index: currentUserStepIndex,
      last_prompt_digest: promptDigest,
      start_status: inScope ? 'failed' : 'out_of_scope',
      in_git: context.scope.inGit,
      repository: context.scope.repository,
      checkout: context.scope.checkout,
      non_git_scope_root: nonGitRoot,
      matched_cwd_prefix: context.scope.matchedCwdPrefix,
      destination: destinationOf(context),
      login: null,
      auth_fingerprint: null,
      pending_messages: [],
    };
    writeState(context.env, key, state);
    return state;
  });

  if (!inScope) {
    return {};
  }

  try {
    const login: LoginPin = {};
    const hostPayload: Record<string, unknown> = {
      hook_event_name: 'UserPromptSubmit',
      session_id: conversationId,
      turn_id: openedState.turn_id,
      prompt,
      cwd: context.scope.cwd,
      ...(authorizedTranscriptPath ? { transcript_path: authorizedTranscriptPath } : {}),
      ...(typeof payload.modelName === 'string' && payload.modelName
        ? { model: payload.modelName } : {}),
    };
    const output = await forward(hostPayload, context, openedState.repository, login, 'PreInvocation');
    const loginId = login.used ?? null;
    const authFingerprint = computeAuthFingerprint(context, openedState.non_git_scope_root, loginId);
    try {
      await withTurnStateLock(context.env, key, () => {
        const latest = readState(context.env, key);
        if (latest && latest.turn_active === true
          && latest.turn_id === openedState.turn_id
          && latest.turn_generation === openedState.turn_generation) {
          writeState(context.env, key, {
            ...latest,
            start_status: 'started',
            login: loginId,
            auth_fingerprint: authFingerprint,
          });
        }
      });
    } catch {}
    const { additionalContext, systemMessage } = extractHostMessages(output);
    const step = buildSystemMessageStep(openedState.turn_id, additionalContext, systemMessage);
    return step ? preInvocationOutputFromSteps([step]) : {};
  } catch {
    // Fail-open: keep turn_active=true with start_status='failed' so subsequent invocations
    // in the same turn do not retry or leak orphan events.
    return {};
  }
}

async function handlePreToolUse(
  payload: AntigravityHookPayload,
  conversationId: string,
  context: Context,
): Promise<AntigravityHookOutput> {
  const toolCall = payload.toolCall as { id?: unknown; name?: unknown; args?: unknown } | undefined;
  const rawName = typeof toolCall?.name === 'string' ? toolCall.name : '';
  const normalizedName = normalizeAntigravityToolName(rawName, toolCall?.args);
  if (!PRE_TOOL_USE_TOOLS.has(normalizedName)) {
    return { decision: 'allow' };
  }

  const key = turnKey(conversationId, context.configPath);
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key));
  if (!state || !isTurnStaticAuthorized(state, context)) {
    return { decision: 'allow' };
  }

  const transcriptOpts = transcriptOptionsFor(conversationId, context);
  const authorizedTranscriptPath = resolveAuthorizedTranscriptPath(payload.transcriptPath, transcriptOpts);
  const toolUseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
    ? toolCall.id.trim()
    : (typeof payload.stepIdx === 'number' ? `step-${payload.stepIdx}` : randomUUID());
  try {
    const output = await forward(
      {
        hook_event_name: 'PreToolUse',
        session_id: conversationId,
        turn_id: state.turn_id,
        tool_name: normalizedName,
        tool_use_id: toolUseId,
        tool_input: normalizedToolInput(rawName, normalizedName, toolCall?.args),
        cwd: context.scope.cwd,
        ...(authorizedTranscriptPath ? { transcript_path: authorizedTranscriptPath } : {}),
        ...(typeof payload.modelName === 'string' && payload.modelName
          ? { model: payload.modelName } : {}),
      },
      context,
      state.repository,
      turnLogin(state),
      'PreToolUse',
    );
    const specific = output.hookSpecificOutput as Record<string, unknown> | undefined;
    if (specific && typeof specific === 'object' && !Array.isArray(specific)
      && specific.permissionDecision === 'deny') {
      const reason = typeof specific.permissionDecisionReason === 'string' && specific.permissionDecisionReason
        ? specific.permissionDecisionReason
        : undefined;
      return { decision: 'deny', ...(reason ? { reason } : {}) };
    }
    return { decision: 'allow' };
  } catch {
    return { decision: 'allow' };
  }
}

async function handlePostToolUse(
  payload: AntigravityHookPayload,
  conversationId: string,
  context: Context,
): Promise<AntigravityHookOutput> {
  const key = turnKey(conversationId, context.configPath);
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key));
  if (!state || !isTurnStaticAuthorized(state, context)) {
    return {};
  }
  const startedTurnId = state.turn_id;
  const startedGeneration = state.turn_generation;
  const startedAuthFingerprint = state.auth_fingerprint;

  const toolCall = payload.toolCall as { id?: unknown; name?: unknown; args?: unknown } | undefined;
  const rawName = typeof toolCall?.name === 'string' ? toolCall.name : '';
  const normalizedName = normalizeAntigravityToolName(rawName, toolCall?.args);
  if (!normalizedName) return {};

  const errorText = typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : undefined;
  const hasError = errorText !== undefined;
  const hostEventName = hasError ? 'PostToolUseFailure' : 'PostToolUse';
  const toolUseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
    ? toolCall.id.trim()
    : (typeof payload.stepIdx === 'number' ? `step-${payload.stepIdx}` : randomUUID());

  const transcriptOpts = transcriptOptionsFor(conversationId, context);
  const authorizedTranscriptPath = resolveAuthorizedTranscriptPath(payload.transcriptPath, transcriptOpts);
  const isBrainbase = normalizedName.startsWith('mcp__brainbase__');
  let toolInput: unknown;
  let toolResponse: unknown;
  let errorField: unknown;

  if (isBrainbase) {
    toolInput = normalizedToolInput(rawName, normalizedName, toolCall?.args);
    const transcriptText = extractToolResultFromTranscript(payload.transcriptPath, payload.stepIdx, transcriptOpts);
    if (transcriptText !== null) {
      toolResponse = {
        content: [{ type: 'text', text: transcriptText }],
        isError: hasError,
      };
    } else {
      toolResponse = {
        ...digestSummary({ tool_use_id: toolUseId, tool_name: normalizedName, error: hasError ? errorText : null }),
        success: !hasError,
      };
    }
    if (hasError) errorField = errorText;
  } else {
    toolInput = digestSummary(toolCall?.args ?? null);
    toolResponse = {
      ...digestSummary(hasError ? { error: errorText } : { tool_use_id: toolUseId, ok: true }),
      success: !hasError,
    };
    if (hasError) errorField = digestSummary(errorText);
  }

  try {
    const output = await forward(
      {
        hook_event_name: hostEventName,
        session_id: conversationId,
        turn_id: startedTurnId,
        tool_name: normalizedName,
        tool_use_id: toolUseId,
        tool_input: toolInput,
        tool_response: toolResponse,
        ...(errorField !== undefined ? { error: errorField } : {}),
        cwd: context.scope.cwd,
        ...(authorizedTranscriptPath ? { transcript_path: authorizedTranscriptPath } : {}),
        ...(typeof payload.modelName === 'string' && payload.modelName
          ? { model: payload.modelName } : {}),
      },
      context,
      state.repository,
      turnLogin(state),
      'PostToolUse',
    );
    const { additionalContext, systemMessage } = extractHostMessages(output);
    if (additionalContext || systemMessage) {
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (!latest
            || latest.turn_active !== true
            || latest.turn_id !== startedTurnId
            || latest.turn_generation !== startedGeneration
            || latest.auth_fingerprint !== startedAuthFingerprint
            || !isTurnStaticAuthorized(latest, context)) {
            return;
          }
          const nextPending: PendingContextMessage[] = [
            ...latest.pending_messages.filter((entry) => matchesPendingEntry(entry, latest)),
            {
              turn_id: latest.turn_id,
              turn_generation: latest.turn_generation,
              ...(additionalContext ? { additional_context: additionalContext } : {}),
              ...(systemMessage ? { system_message: systemMessage } : {}),
              created_at: new Date(context.now()).toISOString(),
            },
          ].slice(-MAX_PENDING_MESSAGES);
          writeState(context.env, key, { ...latest, pending_messages: nextPending });
        });
      } catch {}
    }
  } catch {
    // Fail-open.
  }
  // Antigravity PostToolUse strictly expects `{}`.
  return {};
}

async function handleStop(
  payload: AntigravityHookPayload,
  conversationId: string,
  context: Context,
): Promise<AntigravityHookOutput> {
  const key = turnKey(conversationId, context.configPath);
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key));
  const terminationReason = typeof payload.terminationReason === 'string' ? payload.terminationReason : '';

  const clearTurn = async () => {
    if (!state) return;
    try {
      await withTurnStateLock(context.env, key, () => {
        const latest = readState(context.env, key);
        if (latest && latest.turn_id === state.turn_id && latest.turn_generation === state.turn_generation) {
          writeState(context.env, key, { ...latest, turn_active: false, pending_messages: [] });
        }
      });
    } catch {}
  };

  if (terminationReason !== 'NO_TOOL_CALL') {
    await clearTurn();
    return { decision: '' };
  }

  if (!state || !isTurnStaticAuthorized(state, context)) {
    await clearTurn();
    return { decision: '' };
  }

  const transcriptOpts = transcriptOptionsFor(conversationId, context);
  const authorizedTranscriptPath = resolveAuthorizedTranscriptPath(payload.transcriptPath, transcriptOpts);
  const lastAssistantMessage = extractLastAssistantMessage(payload.transcriptPath, transcriptOpts);
  try {
    const stopPayload = forwardedStopPayload({
      hook_event_name: 'Stop',
      session_id: conversationId,
      turn_id: state.turn_id,
      cwd: context.scope.cwd,
      ...(authorizedTranscriptPath ? { transcript_path: authorizedTranscriptPath } : {}),
      ...(typeof payload.modelName === 'string' && payload.modelName
        ? { model: payload.modelName } : {}),
      ...(lastAssistantMessage !== undefined ? { last_assistant_message: lastAssistantMessage } : {}),
      stop_hook_active: payload.continuationActive === true,
    });
    await forward(stopPayload, context, state.repository, turnLogin(state), 'Stop');
  } catch {
    // Fail-open.
  } finally {
    await clearTurn();
  }
  // Never return `"continue"` from Stop.
  return { decision: '' };
}

/** Handles one Antigravity lifecycle hook event. Never throws. */
export async function handleAntigravityJudgmentHook(
  payload: AntigravityHookPayload,
  options: AntigravityHookOptions = {},
): Promise<AntigravityHookOutput> {
  const env = options.env ?? process.env;
  const eventName = payload?.hookEventName;
  try {
    if (env.BRAINBASE_ANTIGRAVITY_JUDGMENT_HOOK === 'disabled') {
      return antigravityFailOpenOutput(eventName);
    }
    const configPath = resolve(options.configPath ?? defaultAntigravityHookConfigPath(env));
    const config = readAntigravityHookConfig(configPath);
    if (!config) return antigravityFailOpenOutput(eventName);
    if (options.registrationId !== config.registration.id) {
      return antigravityFailOpenOutput(eventName);
    }
    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId.trim() : '';
    if (!conversationId) return antigravityFailOpenOutput(eventName);

    const context: Context = {
      env,
      config,
      fetch: options.fetch ?? fetch,
      accessToken: options.accessToken ?? (async () => {
        const login = await getAccessTokenOfLogin({ fetch: options.fetch, ...options.credentials });
        if (login.serverUrl !== config.login_server) {
          throw Object.assign(new Error('login_origin_mismatch'), { code: 'login_origin_mismatch' });
        }
        return { token: login.token, loginId: login.loginId };
      }),
      scope: resolveAntigravityScope(payload, config, env),
      configPath,
      now: options.now ?? Date.now,
      staleTurnMs: options.staleTurnMs ?? DEFAULT_STALE_TURN_MS,
      ...(options.allowedTranscriptRoots !== undefined
        ? { allowedTranscriptRoots: options.allowedTranscriptRoots } : {}),
    };

    if (eventName === 'PreInvocation') return await handlePreInvocation(payload, conversationId, context);
    if (eventName === 'PreToolUse') return await handlePreToolUse(payload, conversationId, context);
    if (eventName === 'PostToolUse') return await handlePostToolUse(payload, conversationId, context);
    if (eventName === 'Stop') return await handleStop(payload, conversationId, context);
    return antigravityFailOpenOutput(eventName);
  } catch {
    return antigravityFailOpenOutput(eventName);
  }
}

// ---- Registration in Antigravity hooks.json ----

/** Builds the POSIX-quoted command registered in Antigravity `hooks.json`. */
export function antigravityHookCommand(
  nodePath: string,
  cliPath: string,
  configPath: string,
  registrationId: string,
): string {
  return [nodePath, cliPath, ANTIGRAVITY_HOOK_COMMAND, '--config', configPath, '--registration', registrationId]
    .map(shellQuote).join(' ');
}

export function installedAntigravityHookRegistration(
  hook: unknown,
): { configPath: string; registrationId: string } | null {
  const value = hook as { type?: unknown; command?: unknown } | null;
  if (!value || (value.type !== undefined && value.type !== 'command') || typeof value.command !== 'string') {
    return null;
  }
  const words = singleQuotedWords(value.command);
  if (!words || words.length !== 7 || words[2] !== ANTIGRAVITY_HOOK_COMMAND || words[3] !== '--config'
    || words[5] !== '--registration' || !REGISTRATION_ID.test(words[6]) || !words[4]) {
    return null;
  }
  return { configPath: words[4], registrationId: words[6] };
}

function sameConfigFile(registered: string, configPath: string): boolean {
  return registered === configPath || canonicalFilePath(registered) === canonicalFilePath(configPath);
}

function collectHookRegistrationsFromEntry(entry: unknown): Array<{ configPath: string; registrationId: string }> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
  const spec = entry as Record<string, unknown>;
  const found: Array<{ configPath: string; registrationId: string }> = [];
  for (const flatEvent of ['SessionStart', 'PreInvocation', 'PostInvocation', 'Stop']) {
    const list = spec[flatEvent];
    if (!Array.isArray(list)) continue;
    for (const handler of list) {
      const reg = installedAntigravityHookRegistration(handler);
      if (reg) found.push(reg);
    }
  }
  for (const groupedEvent of ['PreToolUse', 'PostToolUse']) {
    const groups = spec[groupedEvent];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const inner = (group as { hooks?: unknown })?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const handler of inner) {
        const reg = installedAntigravityHookRegistration(handler);
        if (reg) found.push(reg);
      }
    }
  }
  return found;
}

/** True when `hooksJson` contains a Brainbase Antigravity registration for `configPath`. */
export function hasInstalledAntigravityHooks(hooksJson: Record<string, unknown>, configPath: string): boolean {
  const entry = hooksJson[ANTIGRAVITY_HOOK_KEY];
  return collectHookRegistrationsFromEntry(entry).some((reg) => sameConfigFile(reg.configPath, configPath));
}

/** Generates the `"brainbase-judgment"` hook block for Antigravity `hooks.json`. */
export function antigravityJudgmentHookEntry(command: string): Record<string, unknown> {
  return {
    enabled: true,
    PreInvocation: [
      { type: 'command', command, timeout: 6 },
    ],
    PreToolUse: [
      {
        matcher: 'mcp_brainbase.*knowledge_lookup|call_mcp_tool',
        hooks: [{ type: 'command', command, timeout: 5 }],
      },
    ],
    PostToolUse: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command, timeout: 5 }],
      },
    ],
    Stop: [
      { type: 'command', command, timeout: 8 },
    ],
  };
}

/**
 * Idempotently updates or removes only the `"brainbase-judgment"` top-level key
 * of Antigravity `hooks.json`, preserving every other hook entry untouched.
 */
export function registerAntigravityJudgmentHooks(
  hooksJson: Record<string, unknown>,
  options: {
    command?: string;
    configPath: string;
    registrationId?: string;
    remove?: boolean;
    removedIds?: Set<string>;
  },
): Record<string, unknown> {
  const { command, configPath, remove = false, removedIds } = options;
  const next: Record<string, unknown> = { ...hooksJson };
  const existing = collectHookRegistrationsFromEntry(hooksJson[ANTIGRAVITY_HOOK_KEY]);
  let matchedExisting = false;
  for (const reg of existing) {
    if (sameConfigFile(reg.configPath, configPath)) {
      matchedExisting = true;
      removedIds?.add(reg.registrationId);
    }
  }
  if (remove) {
    if (matchedExisting) {
      delete next[ANTIGRAVITY_HOOK_KEY];
    }
    return next;
  }
  if (!command) {
    throw new Error('registerAntigravityJudgmentHooks requires command unless remove is true');
  }
  next[ANTIGRAVITY_HOOK_KEY] = antigravityJudgmentHookEntry(command);
  return next;
}
