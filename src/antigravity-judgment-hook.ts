// Antigravity CLI adapter for a hosted Brainbase judgment Host.
//
// Antigravity runs this as a synchronous command hook (`brainbase judgment:antigravity-hook`)
// for PreInvocation, PreToolUse, PostToolUse, and Stop.
//
// Key protocol differences from Claude Code handled here:
// 1. PreInvocation fires before EVERY model call in a turn (including tool-call loops),
//    and Reason Network may inject system USER_INPUT messages. Local turn state tracks
//    `turn_active`, `turn_id`, `current_turn_user_step_index`, and `last_closed_user_step_index`
//    so UserPromptSubmit is forwarded strictly once per user turn while rejecting delayed
//    events from closed/older steps and draining turn-scoped pending messages safely.
// 2. Non-git workspaces (e.g. Orca bot homes) are supported when `project_code` is set
//    and either `allow_non_git: true` or `cwd_prefixes` matches.
// 3. PostToolUse stdin omits `tool_response` and Stop stdin omits `last_assistant_message`.
//    These are synthesized safely from `error` and bounded tail reads of `transcriptPath`.
// 4. Antigravity MCP tool names (`mcp_brainbase-unson_<tool>` / `call_mcp_tool`) are
//    normalized to `mcp__brainbase__<tool>`.
// 5. Base URLs with path prefixes (e.g. `https://bb.unson.jp/runtime-mcp`) preserve their
//    path when resolving `host/judgment/hook`.
// 6. Strict fail-open outputs with short HTTP timeouts:
//    - PreInvocation: `{}` (or `{ injectSteps: [{ systemMessage: { systemMessage } }], terminationBehavior: '' }`)
//    - PreToolUse: `{ decision: 'allow' }` (or `{ decision: 'deny', reason }`)
//    - PostToolUse: ALWAYS `{}` (any follow-up context is queued with `turn_id` for next PreInvocation)
//    - Stop: ALWAYS `{ decision: '' }` (never `"continue"`)

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  /** Optional OS turn-state lock overrides (primarily for tests). */
  turnLock?: TurnStateLockOptions;
  /** Optional Linux `openat2` helper executable override for transcript reads (strictly for tests). */
  transcriptOpenatBinary?: string;
  /** Optional runtime platform override (strictly for tests). */
  platform?: NodeJS.Platform;
}

export interface TranscriptReadOptions {
  conversationId: string;
  allowedTranscriptRoots?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** Optional tool_use_id / tool_call_id hint when resolving truncated or shifted tool results. */
  toolUseId?: string;
  /** Override for the Linux `openat2` helper executable path (strictly for tests). */
  openatHelperBinary?: string;
  /** Override runtime platform check (strictly for tests). */
  platform?: NodeJS.Platform;
}

const TURN_SCHEMA = 'brainbase-antigravity-judgment-turn-v1';
const PROJECT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const TRANSCRIPT_TAIL_MAX_BYTES = 256 * 1024;
const TRANSCRIPT_FULL_TAIL_MAX_BYTES = 1024 * 1024;
const TRANSCRIPT_TOOL_RESULT_MAX_BYTES = 512 * 1024;
const TRANSCRIPT_OPENAT_TIMEOUT_MS = 1_500;
const MAX_PENDING_MESSAGES = 8;
const DEFAULT_STALE_TURN_MS = 30 * 60 * 1000;
const MAX_CONFIG_TIMEOUT_MS = 60_000;
const TURN_STATE_LOCK_TIMEOUT_MS = 2_000;
const FLOCK_CONFLICT_EXIT_CODE = 75;

interface PendingContextMessage {
  turn_id: string;
  turn_generation?: number;
  project_code?: string;
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
  current_turn_user_step_index: number | null;
  last_closed_user_step_index: number | null;
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
  effective_project_code: string | null;
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
  turnLock?: TurnStateLockOptions;
  transcriptOpenatBinary?: string;
  platform?: NodeJS.Platform;
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

function normalizeValidProjectCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return PROJECT_CODE_PATTERN.test(value) ? value : null;
}

function extractHostProjectCode(
  envelope: Record<string, unknown>,
  output: Record<string, unknown>,
): { kind: 'missing' } | { kind: 'valid'; value: string } | { kind: 'invalid' } {
  const specific = output.hookSpecificOutput
    && typeof output.hookSpecificOutput === 'object'
    && !Array.isArray(output.hookSpecificOutput)
    ? output.hookSpecificOutput as Record<string, unknown>
    : null;
  const binding = output.binding
    && typeof output.binding === 'object'
    && !Array.isArray(output.binding)
    ? output.binding as Record<string, unknown>
    : null;
  const candidates = [
    envelope.project_code,
    envelope.projectCode,
    output.project_code,
    output.projectCode,
    specific?.project_code,
    specific?.projectCode,
    binding?.project_code,
    binding?.projectCode,
  ].filter((value) => value !== undefined);
  if (candidates.length === 0) return { kind: 'missing' };
  let resolved: string | null = null;
  for (const raw of candidates) {
    const valid = normalizeValidProjectCode(raw);
    if (!valid) return { kind: 'invalid' };
    if (resolved !== null && resolved !== valid) return { kind: 'invalid' };
    resolved = valid;
  }
  return resolved ? { kind: 'valid', value: resolved } : { kind: 'missing' };
}

type EffectiveProjectCodeResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'invalid_config' | 'invalid_host' | 'mismatch' };

function resolveEffectiveProjectCode(
  envelope: Record<string, unknown>,
  output: Record<string, unknown>,
  configProjectCode: string | undefined,
): EffectiveProjectCodeResult {
  const hostResult = extractHostProjectCode(envelope, output);
  if (hostResult.kind === 'invalid') {
    return { ok: false, reason: 'invalid_host' };
  }
  const configValid = configProjectCode !== undefined ? normalizeValidProjectCode(configProjectCode) : null;
  if (configProjectCode !== undefined && configValid === null) {
    return { ok: false, reason: 'invalid_config' };
  }
  if (hostResult.kind === 'valid' && configValid !== null && hostResult.value !== configValid) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, value: hostResult.kind === 'valid' ? hostResult.value : configValid };
}

function derivePrincipalIdentity(
  obtained: string | PersonToken,
): { token: string; loginId: string | null } {
  const token = typeof obtained === 'string' ? obtained : obtained.token;
  if (typeof token !== 'string' || !token.trim()) {
    return { token: '', loginId: null };
  }
  const rawLoginId = typeof obtained === 'string' ? null : obtained.loginId;
  if (typeof rawLoginId === 'string' && rawLoginId.trim()) {
    return { token, loginId: `login:${rawLoginId.trim()}` };
  }
  return { token, loginId: `token-sha256:${sha256(token)}` };
}

function computeAuthFingerprint(
  context: Context,
  nonGitScopeRoot: string | null,
  loginId: string | null,
  effectiveProjectCode: string | null,
): string | null {
  if (typeof loginId !== 'string' || !loginId) return null;
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
    effective_project_code: effectiveProjectCode,
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
  if (typeof state.login !== 'string' || !state.login) {
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
  const expectedFingerprint = computeAuthFingerprint(
    context,
    state.non_git_scope_root,
    state.login,
    state.effective_project_code,
  );
  return expectedFingerprint !== null && expectedFingerprint === state.auth_fingerprint;
}

function canAuthorizePendingContext(
  state: AntigravityTurnState,
  context: Context,
  currentLoginId: string | null,
): boolean {
  if (!isTurnStaticAuthorized(state, context)) return false;
  if (typeof currentLoginId !== 'string' || !currentLoginId || state.login !== currentLoginId) {
    return false;
  }
  // Pending context draining happens locally in PreInvocation without consulting the Host,
  // so the caller MUST hold an authoritative explicit local project_code that matches the
  // persisted effective_project_code. When config.project_code is absent (Host-assigned),
  // we cannot verify locally whether Host assignment changed and MUST discard pending context.
  const configuredProjectCode = normalizeValidProjectCode(context.config.project_code);
  if (configuredProjectCode === null) {
    return false;
  }
  const effectiveProjectCode = normalizeValidProjectCode(state.effective_project_code);
  if (effectiveProjectCode === null || configuredProjectCode !== effectiveProjectCode) {
    return false;
  }
  const expectedFingerprint = computeAuthFingerprint(
    context,
    state.non_git_scope_root,
    currentLoginId,
    configuredProjectCode,
  );
  return expectedFingerprint !== null && expectedFingerprint === state.auth_fingerprint;
}

async function resolveCurrentLoginId(
  context: Context,
): Promise<{ ok: true; loginId: string } | { ok: false }> {
  try {
    const obtained = await context.accessToken();
    const { loginId } = derivePrincipalIdentity(obtained);
    if (loginId === null) return { ok: false };
    return { ok: true, loginId };
  } catch {
    return { ok: false };
  }
}

// ---- Transcript tail reader & extractors ----

interface TranscriptEntry {
  step_index?: unknown;
  tool_use_id?: unknown;
  tool_call_id?: unknown;
  source?: unknown;
  type?: unknown;
  content?: unknown;
  truncated_fields?: unknown;
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

function isStrictDescendantPath(canonicalRoot: string, candidatePath: string): boolean {
  if (!isAbsolute(canonicalRoot) || !isAbsolute(candidatePath)) return false;
  const prefix = canonicalRoot === sep ? sep : `${canonicalRoot}${sep}`;
  if (!candidatePath.startsWith(prefix)) return false;
  const rel = relative(canonicalRoot, candidatePath);
  if (!rel || rel === '.' || rel === '..' || isAbsolute(rel)) return false;
  const segments = rel.split(sep);
  return !segments.includes('..') && !segments.includes('.');
}

function matchesConversationTranscriptStructure(
  canonicalRoot: string,
  canonicalFile: string,
  conversationId: string,
): boolean {
  if (!isStrictDescendantPath(canonicalRoot, canonicalFile)) {
    return false;
  }
  const rel = relative(canonicalRoot, canonicalFile);
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

interface TranscriptOpenatTestFaults {
  /** Force Linux openat2(2) to fail with the specified errno to verify immediate fail-closed rejection (no fallback). */
  forceOpenat2Errno?: 'ENOSYS' | 'EPERM';
  /** Rename a path inside the helper right after reading tail bytes from file_fd. */
  renameAfterTailRead?: { from: string; to: string };
}

interface TranscriptOpenTestHooks {
  onBeforeOpen?: (canonicalPath: string) => void;
  /** Override for the Linux `openat2` helper executable path (strictly for tests). */
  openatHelperBinary?: string;
  /** Override fixed absolute candidate binaries searched when no explicit binary override is set (strictly for tests). */
  openatHelperCandidates?: readonly string[];
  /** Override timeout in ms for the Linux `openat2` helper (strictly for tests). */
  helperTimeoutMs?: number;
  /** Override platform check to test non-Linux fail-closed behavior. */
  platform?: NodeJS.Platform;
  /** Deterministic fault injection inside the openat2 helper (strictly for tests). */
  openatTestFaults?: TranscriptOpenatTestFaults;
}

interface AuthorizedTranscriptTarget {
  canonicalRoot: string;
  canonicalPath: string;
  segments: string[];
}

function isSafePathSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('/')
    && !segment.includes('\\')
    && !segment.includes('\0');
}

function verifyNoSymlinkPathUnderRoot(
  canonicalRoot: string,
  canonicalTarget: string,
): { ok: true; dev: bigint; ino: bigint } | { ok: false } {
  try {
    const rootStat = lstatSync(canonicalRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { ok: false };
    if (realpathSync(canonicalRoot) !== canonicalRoot) return { ok: false };
    if (!isStrictDescendantPath(canonicalRoot, canonicalTarget)) {
      return { ok: false };
    }
    const rel = relative(canonicalRoot, canonicalTarget);
    const segments = rel.split(sep);
    if (segments.length === 0 || !segments.every(isSafePathSegment)) {
      return { ok: false };
    }
    let current = canonicalRoot;
    for (let i = 0; i < segments.length - 1; i += 1) {
      current = join(current, segments[i]);
      const dirStat = lstatSync(current);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return { ok: false };
    }
    current = join(current, segments[segments.length - 1]);
    const fileStat = lstatSync(current, { bigint: true });
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return { ok: false };
    return { ok: true, dev: fileStat.dev, ino: fileStat.ino };
  } catch {
    return { ok: false };
  }
}

function resolveAuthorizedTranscriptTarget(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): AuthorizedTranscriptTarget | null {
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
    const matchedRoot = roots.find((root) => (
      root !== sep
      && root !== '/'
      && matchesConversationTranscriptStructure(root, canonicalPath, conversationId)
    ));
    if (!matchedRoot) return null;
    if (!verifyNoSymlinkPathUnderRoot(matchedRoot, canonicalPath).ok) return null;
    const segments = relative(matchedRoot, canonicalPath).split(sep);
    if (segments.length === 0 || !segments.every(isSafePathSegment)) return null;
    return { canonicalRoot: matchedRoot, canonicalPath, segments };
  } catch {
    return null;
  }
}

function resolveAuthorizedTranscriptPath(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): string | null {
  return resolveAuthorizedTranscriptTarget(transcriptPath, options)?.canonicalPath ?? null;
}

function isEnoentError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Resolves an authorized transcript location ONLY when the transcript file itself
 * does not exist yet (`ENOENT`), e.g. on the first tool call before Antigravity
 * flushes `logs/transcript.jsonl` while `steps/<n>/output.txt` already exists.
 *
 * Strictly enforces the same canonical root, conversation structure, and
 * no-symlink ancestor invariants; fails closed if the file exists (and was
 * already rejected by `resolveAuthorizedTranscriptTarget`), contains `.`/`..`,
 * or traverses any symlink inside the authorized root.
 */
function resolveAuthorizedMissingTranscriptTarget(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
): AuthorizedTranscriptTarget | null {
  if (typeof transcriptPath !== 'string' || !transcriptPath.trim() || transcriptPath.includes('\0')) {
    return null;
  }
  const conversationId = options?.conversationId?.trim() ?? '';
  if (!isSafeConversationIdSegment(conversationId)) return null;

  const rawPath = transcriptPath.trim();
  if (!isAbsolute(rawPath)) return null;
  const rawSegments = rawPath.split(/[/\\]/u);
  if (rawSegments.includes('..') || rawSegments.includes('.')) {
    return null;
  }

  try {
    lstatSync(rawPath);
    return null;
  } catch (error) {
    if (!isEnoentError(error)) return null;
  }

  const fileName = basename(rawPath);
  if (!ALLOWED_TRANSCRIPT_FILENAMES.has(fileName) || !isSafePathSegment(fileName)) {
    return null;
  }

  let candidateCanonical: string | null = null;
  const parentDir = dirname(rawPath);
  try {
    const parentStat = lstatSync(parentDir);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) return null;
    candidateCanonical = join(realpathSync(parentDir), fileName);
  } catch (error) {
    if (!isEnoentError(error)) return null;
    const parentName = basename(parentDir);
    if (parentName !== 'logs' || !isSafePathSegment(parentName)) return null;
    const grandParentDir = dirname(parentDir);
    try {
      const grandStat = lstatSync(grandParentDir);
      if (grandStat.isSymbolicLink() || !grandStat.isDirectory()) return null;
      candidateCanonical = join(realpathSync(grandParentDir), parentName, fileName);
    } catch {
      return null;
    }
  }

  if (!candidateCanonical) return null;

  const roots = canonicalTranscriptRoots(options!);
  if (roots.length === 0) return null;
  const matchedRoot = roots.find((root) => (
    root !== sep
    && root !== '/'
    && matchesConversationTranscriptStructure(root, candidateCanonical, conversationId)
  ));
  if (!matchedRoot) return null;

  try {
    const rootStat = lstatSync(matchedRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    if (realpathSync(matchedRoot) !== matchedRoot) return null;
  } catch {
    return null;
  }

  const segments = relative(matchedRoot, candidateCanonical).split(sep);
  if (segments.length === 0 || !segments.every(isSafePathSegment)) return null;

  let current = matchedRoot;
  let sawMissingDir = false;
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = join(current, segments[i]);
    if (sawMissingDir) return null;
    try {
      const dirStat = lstatSync(current);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
    } catch (error) {
      if (!isEnoentError(error) || i !== segments.length - 2 || segments[i] !== 'logs') {
        return null;
      }
      sawMissingDir = true;
    }
  }

  try {
    lstatSync(candidateCanonical);
    return null;
  } catch (error) {
    if (!isEnoentError(error)) return null;
  }

  return { canonicalRoot: matchedRoot, canonicalPath: candidateCanonical, segments };
}

function buildPythonOpenatReader(
  faults?: TranscriptOpenatTestFaults,
  mode: 'tail' | 'full' = 'tail',
): string {
  const forceOpenat2Errno = faults?.forceOpenat2Errno;
  const renameAfterRead = faults?.renameAfterTailRead;

  const lines: string[] = [
    'import ctypes, errno, os, platform, stat, sys',
    'def fail(): sys.exit(1)',
    'if not sys.platform.startswith("linux"): fail()',
    'if len(sys.argv) < 4: fail()',
    'if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY") and hasattr(os, "O_NONBLOCK") and (os.open in getattr(os, "supports_dir_fd", ()))): fail()',
    'root = sys.argv[1]',
    'try: max_bytes = int(sys.argv[2])',
    'except ValueError: fail()',
    'segments = sys.argv[3:]',
    'if max_bytes <= 0 or not root or not os.path.isabs(root) or "\\x00" in root: fail()',
    'root_parts = [p for p in root.split("/") if p]',
    'if not root_parts or os.path.realpath(root) != root: fail()',
    'if not segments: fail()',
    'for seg in segments:',
    '    if not seg or seg in (".", "..") or "/" in seg or "\\\\" in seg or "\\x00" in seg: fail()',
    'expected_exact_path = root.rstrip("/") + "/" + "/".join(segments)',
    'def verify_fd_exact_path(fd, expected_path):',
    '    try:',
    '        actual = os.readlink(f"/proc/self/fd/{fd}")',
    '    except OSError:',
    '        fail()',
    '    if not actual or actual.endswith(" (deleted)") or actual != expected_path:',
    '        fail()',
    'def openat2_beneath(root_fd, rel_bytes, flags):',
    '    arch = platform.machine().lower()',
    '    if arch not in ("x86_64", "amd64", "aarch64", "arm64", "i386", "i686", "armv7l", "armv6l", "riscv64", "s390x", "ppc64le", "ppc64", "loongarch64"):',
    '        fail()',
    '    class OpenHow(ctypes.Structure):',
    '        _fields_ = [("flags", ctypes.c_uint64), ("mode", ctypes.c_uint64), ("resolve", ctypes.c_uint64)]',
    '    try:',
    '        libc = ctypes.CDLL(None, use_errno=True)',
    '        syscall_fn = libc.syscall',
    '        syscall_fn.restype = ctypes.c_long',
    '    except (OSError, AttributeError):',
    '        fail()',
    '    RESOLVE_NO_SYMLINKS = 0x04',
    '    RESOLVE_BENEATH = 0x08',
    '    how = OpenHow(flags, 0, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)',
    '    ctypes.set_errno(0)',
    ...(forceOpenat2Errno
      ? [
        `    ctypes.set_errno(errno.${forceOpenat2Errno})`,
        '    res = -1',
      ]
      : [
        '    res = syscall_fn(ctypes.c_long(437), ctypes.c_int(root_fd), ctypes.c_char_p(rel_bytes), ctypes.byref(how), ctypes.c_size_t(ctypes.sizeof(how)))',
      ]),
    '    if res >= 0:',
    '        return int(res)',
    '    fail()',
    'cloexec = getattr(os, "O_CLOEXEC", 0)',
    'dir_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK | cloexec',
    'root_walk_flags = getattr(os, "O_PATH", os.O_RDONLY) | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK | cloexec',
    'file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | cloexec',
    'cur_fd = -1',
    'file_fd = -1',
    'try:',
    '    cur_fd = os.open("/", root_walk_flags)',
    '    for idx, part in enumerate(root_parts):',
    '        flags = dir_flags if idx == len(root_parts) - 1 else root_walk_flags',
    '        next_fd = os.open(part, flags, dir_fd=cur_fd)',
    '        os.close(cur_fd)',
    '        cur_fd = next_fd',
    '    root_st = os.fstat(cur_fd)',
    '    if not stat.S_ISDIR(root_st.st_mode): fail()',
    '    verify_fd_exact_path(cur_fd, root)',
    '    if os.path.realpath(root) != root: fail()',
    '    root_lstat = os.lstat(root)',
    '    if root_lstat.st_dev != root_st.st_dev or root_lstat.st_ino != root_st.st_ino: fail()',
    '    rel_bytes = os.fsencode("/".join(segments))',
    '    file_fd = openat2_beneath(cur_fd, rel_bytes, file_flags)',
    '    verify_fd_exact_path(cur_fd, root)',
    '    os.close(cur_fd)',
    '    cur_fd = -1',
    '    st = os.fstat(file_fd)',
    '    if not stat.S_ISREG(st.st_mode): fail()',
    '    verify_fd_exact_path(file_fd, expected_exact_path)',
    '    size = st.st_size',
    '    if size <= 0: sys.exit(0)',
    ...(mode === 'full'
      ? [
        '    if size > max_bytes: fail()',
        '    read_size = size',
        '    offset = 0',
      ]
      : [
        '    read_size = min(size, max_bytes)',
        '    offset = size - read_size',
      ]),
    '    chunks = []',
    '    remaining = read_size',
    '    pos = offset',
    '    has_pread = hasattr(os, "pread")',
    '    if not has_pread: os.lseek(file_fd, offset, os.SEEK_SET)',
    '    while remaining > 0:',
    '        chunk = os.pread(file_fd, remaining, pos) if has_pread else os.read(file_fd, remaining)',
    '        if not chunk: break',
    '        chunks.append(chunk)',
    '        n = len(chunk)',
    '        remaining -= n',
    '        pos += n',
    ...(renameAfterRead
      ? [`    os.rename(${JSON.stringify(renameAfterRead.from)}, ${JSON.stringify(renameAfterRead.to)})`]
      : []),
    '    verify_fd_exact_path(file_fd, expected_exact_path)',
    '    post_st = os.fstat(file_fd)',
    '    if not stat.S_ISREG(post_st.st_mode): fail()',
    ...(mode === 'full'
      ? ['    if post_st.st_size > max_bytes: fail()']
      : []),
    '    data = b"".join(chunks)',
    ...(mode === 'tail'
      ? [
        '    if offset > 0:',
        '        nl = data.find(b"\\n")',
        '        if nl < 0: sys.exit(0)',
        '        data = data[nl + 1:]',
      ]
      : [
        '    if len(data) > max_bytes: fail()',
      ]),
    '    if data:',
    '        sys.stdout.buffer.write(data)',
    '        sys.stdout.buffer.flush()',
    'except OSError:',
    '    fail()',
    'finally:',
    '    if cur_fd >= 0:',
    '        try: os.close(cur_fd)',
    '        except OSError: pass',
    '    if file_fd >= 0:',
    '        try: os.close(file_fd)',
    '        except OSError: pass',
  ];
  return lines.join('\n');
}

const PYTHON_OPENAT_TAIL_READER = buildPythonOpenatReader(undefined, 'tail');
const PYTHON_OPENAT_FULL_READER = buildPythonOpenatReader(undefined, 'full');

const DEFAULT_OPENAT_HELPER_CANDIDATES: readonly string[] = [
  '/usr/bin/python3',
  '/usr/local/bin/python3',
  '/bin/python3',
];

function isExecutableRegularFileAbsolute(candidate: string): boolean {
  if (!candidate || !isAbsolute(candidate) || candidate.includes('\0')) {
    return false;
  }
  try {
    const resolved = realpathSync(candidate);
    if (!isAbsolute(resolved) || !statSync(resolved).isFile()) {
      return false;
    }
    accessSync(resolved, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveOpenatHelperBinary(
  override?: string,
  platform: NodeJS.Platform = process.platform,
  candidates: readonly string[] = DEFAULT_OPENAT_HELPER_CANDIDATES,
): string | null {
  if (platform !== 'linux') {
    return null;
  }
  if (override !== undefined) {
    const trimmed = override.trim();
    return isExecutableRegularFileAbsolute(trimmed) ? trimmed : null;
  }
  for (const candidate of candidates) {
    if (isExecutableRegularFileAbsolute(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Reads up to `maxBytes` from the tail of a transcript file strictly via
 * Linux 5.6+ kernel-enforced `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)`
 * plus mandatory `/proc/self/fd/{fd}` exact path verification before and after reading.
 * Fails closed (`null`) immediately on non-Linux platforms, if `openat2` is unavailable
 * or denied (`ENOSYS` / `EPERM` / any error), if fixed `python3` is missing, or if any
 * kernel check rejects; NEVER falls back to staged `openat`, path-based `openSync`, or
 * bare `PATH` lookups.
 */
function readTailViaKernelOpenat(
  canonicalRoot: string,
  segments: readonly string[],
  maxBytes: number,
  options?: {
    openatHelperBinary?: string;
    openatHelperCandidates?: readonly string[];
    helperTimeoutMs?: number;
    platform?: NodeJS.Platform;
    openatTestFaults?: TranscriptOpenatTestFaults;
    mode?: 'tail' | 'full';
  },
): Buffer | null {
  const effectivePlatform = options?.platform ?? process.platform;
  if (effectivePlatform !== 'linux') {
    return null;
  }
  if (!canonicalRoot || !isAbsolute(canonicalRoot) || canonicalRoot === '/' || canonicalRoot.includes('\0')) {
    return null;
  }
  if (segments.length === 0 || !segments.every(isSafePathSegment)) {
    return null;
  }
  const helperBin = resolveOpenatHelperBinary(
    options?.openatHelperBinary,
    effectivePlatform,
    options?.openatHelperCandidates,
  );
  if (!helperBin) {
    return null;
  }
  const timeoutMs = options?.helperTimeoutMs ?? TRANSCRIPT_OPENAT_TIMEOUT_MS;
  const mode = options?.mode ?? 'tail';
  const helperScript = options?.openatTestFaults
    ? buildPythonOpenatReader(options.openatTestFaults, mode)
    : (mode === 'full' ? PYTHON_OPENAT_FULL_READER : PYTHON_OPENAT_TAIL_READER);
  try {
    const result = spawnSync(
      helperBin,
      ['-I', '-c', helperScript, canonicalRoot, String(maxBytes), ...segments],
      {
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: timeoutMs,
        maxBuffer: maxBytes + 4096,
        windowsHide: true,
      },
    );
    if (result.error || result.signal !== null || result.status !== 0) {
      return null;
    }
    if (!Buffer.isBuffer(result.stdout)) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

function readTranscriptEntriesFromTarget(
  target: AuthorizedTranscriptTarget,
  options: TranscriptReadOptions,
  maxBytes: number,
  testHooks?: TranscriptOpenTestHooks,
): TranscriptEntry[] {
  try {
    testHooks?.onBeforeOpen?.(target.canonicalPath);
    const rawTail = readTailViaKernelOpenat(
      target.canonicalRoot,
      target.segments,
      maxBytes,
      {
        openatHelperBinary: testHooks?.openatHelperBinary ?? options.openatHelperBinary,
        openatHelperCandidates: testHooks?.openatHelperCandidates,
        helperTimeoutMs: testHooks?.helperTimeoutMs,
        platform: testHooks?.platform ?? options.platform,
        openatTestFaults: testHooks?.openatTestFaults,
        mode: 'tail',
      },
    );
    if (rawTail === null || rawTail.length === 0) return [];
    const text = rawTail.toString('utf8');
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
  }
}

function readTranscriptTailEntries(
  transcriptPath: unknown,
  options?: TranscriptReadOptions,
  testHooks?: TranscriptOpenTestHooks,
): TranscriptEntry[] {
  const target = resolveAuthorizedTranscriptTarget(transcriptPath, options);
  if (!target || !options) return [];
  return readTranscriptEntriesFromTarget(target, options, TRANSCRIPT_TAIL_MAX_BYTES, testHooks);
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

const TOOL_OUTPUT_TRUNCATION_BANNER_PATTERN = /^The tool's output was truncated due to being too long\./u;
const INLINE_TRUNCATION_MARKER_PATTERN = /<truncated\s+\d+(?:\s+of\s+\d+)?\s+bytes(?:\s[^><\r\n]{0,256})?>/iu;
const TRUNCATED_OUTPUT_FILE_URL_PATTERN = /^The tool's output was truncated due to being too long\.\s+You can find the full output in (?:a )?file at (file:\/\/[^\s"'<>]+)/u;

function entryToolUseId(entry: TranscriptEntry): string | null {
  if (typeof entry.tool_use_id === 'string' && entry.tool_use_id.trim()) {
    return entry.tool_use_id.trim();
  }
  if (typeof entry.tool_call_id === 'string' && entry.tool_call_id.trim()) {
    return entry.tool_call_id.trim();
  }
  return null;
}

function hasTruncatedContentField(entry: TranscriptEntry): boolean {
  return Array.isArray(entry.truncated_fields) && entry.truncated_fields.includes('content');
}

function isJsonWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isValidJsonText(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Splits whitespace/newline-concatenated top-level JSON objects/arrays (`{...}` / `[...]`)
 * in a single strict O(n) character scan without regex backtracking.
 *
 * Antigravity CLI concatenates multiple MCP text content blocks with `\n` when writing
 * `steps/<n>/output.txt` and `transcript*.jsonl` (for example, a primary tool result JSON
 * followed by a trailing `{"connection_scope":{...}}` block). When 2+ top-level JSON
 * containers are found and every block validates via `JSON.parse`, returns the individual
 * blocks so `tool_response.content` restores the original multi-block MCP structure.
 * For a single JSON value, non-JSON text, or any malformed/partial block, fails open and
 * returns `[text]`.
 */
export function splitConcatenatedJsonTextBlocks(text: string): string[] {
  const length = text.length;
  if (length === 0) return [text];

  let i = 0;
  while (i < length && isJsonWhitespaceCode(text.charCodeAt(i))) {
    i += 1;
  }
  if (i >= length) return [text];

  const firstCode = text.charCodeAt(i);
  if (firstCode !== 0x7b && firstCode !== 0x5b) {
    return [text];
  }

  const candidates: string[] = [];
  const closeStack: number[] = [];

  while (i < length) {
    const start = i;
    const openCode = text.charCodeAt(i);
    if (openCode === 0x7b) {
      closeStack.push(0x7d);
    } else if (openCode === 0x5b) {
      closeStack.push(0x5d);
    } else {
      return [text];
    }

    i += 1;
    let inString = false;
    let escaped = false;

    while (i < length && closeStack.length > 0) {
      const code = text.charCodeAt(i);
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (code === 0x5c) {
          escaped = true;
        } else if (code === 0x22) {
          inString = false;
        }
      } else if (code === 0x22) {
        inString = true;
      } else if (code === 0x7b) {
        closeStack.push(0x7d);
      } else if (code === 0x5b) {
        closeStack.push(0x5d);
      } else if (code === 0x7d || code === 0x5d) {
        if (closeStack[closeStack.length - 1] !== code) {
          return [text];
        }
        closeStack.pop();
      }
      i += 1;
    }

    if (closeStack.length !== 0 || inString) {
      return [text];
    }

    candidates.push(text.slice(start, i));

    const wsStart = i;
    while (i < length && isJsonWhitespaceCode(text.charCodeAt(i))) {
      i += 1;
    }
    if (i < length && i === wsStart) {
      return [text];
    }
  }

  if (candidates.length < 2) {
    return [text];
  }

  for (const block of candidates) {
    if (!isValidJsonText(block)) {
      return [text];
    }
  }

  return candidates;
}

function isValidJsonOrConcatenatedJsonText(text: string): boolean {
  if (isValidJsonText(text)) return true;
  return splitConcatenatedJsonTextBlocks(text).length > 1;
}

function isTruncatedToolResult(entry: TranscriptEntry, strippedContent: string): boolean {
  if (hasTruncatedContentField(entry)) return true;
  if (TOOL_OUTPUT_TRUNCATION_BANNER_PATTERN.test(strippedContent)) return true;
  if (INLINE_TRUNCATION_MARKER_PATTERN.test(strippedContent) && !isValidJsonOrConcatenatedJsonText(strippedContent)) {
    return true;
  }
  return false;
}

function trimTrailingUrlPunctuation(rawUrl: string): string {
  let end = rawUrl.length;
  while (end > 0) {
    const ch = rawUrl[end - 1];
    if (ch === '.' || ch === ',' || ch === ';' || ch === ')' || ch === ']') {
      end -= 1;
    } else {
      break;
    }
  }
  return rawUrl.slice(0, end);
}

function extractTruncatedOutputFileUrl(text: string): string | null {
  const match = TRUNCATED_OUTPUT_FILE_URL_PATTERN.exec(text);
  if (!match) return null;
  const cleaned = trimTrailingUrlPunctuation(match[1]);
  return cleaned || null;
}

function parseLocalFileUrlPath(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) {
    return null;
  }
  try {
    const filePath = fileURLToPath(url);
    if (!filePath || !isAbsolute(filePath) || filePath.includes('\0')) {
      return null;
    }
    return filePath;
  } catch {
    return null;
  }
}

function systemGeneratedPrefixSegments(
  target: AuthorizedTranscriptTarget,
  conversationId: string,
): string[] | null {
  const segs = target.segments;
  if (segs.length === 4
    && segs[0] === conversationId
    && segs[1] === '.system_generated'
    && segs[2] === 'logs') {
    return [conversationId, '.system_generated'];
  }
  if (segs.length === 5
    && segs[0] === 'brain'
    && segs[1] === conversationId
    && segs[2] === '.system_generated'
    && segs[3] === 'logs') {
    return ['brain', conversationId, '.system_generated'];
  }
  return null;
}

function resolveSiblingFullTranscriptTarget(
  baseTarget: AuthorizedTranscriptTarget,
  options: TranscriptReadOptions,
): AuthorizedTranscriptTarget | null {
  if (baseTarget.segments[baseTarget.segments.length - 1] !== 'transcript.jsonl') {
    return null;
  }
  const baseDir = dirname(baseTarget.canonicalPath);
  const candidatePath = join(baseDir, 'transcript_full.jsonl');
  const fullTarget = resolveAuthorizedTranscriptTarget(candidatePath, options);
  if (!fullTarget) return null;
  if (fullTarget.canonicalRoot !== baseTarget.canonicalRoot) return null;
  if (dirname(fullTarget.canonicalPath) !== baseDir) return null;
  return fullTarget;
}

function resolveAuthorizedStepOutputTarget(
  baseTarget: AuthorizedTranscriptTarget,
  conversationId: string,
  candidatePath: string,
): AuthorizedTranscriptTarget | null {
  if (!candidatePath || !isAbsolute(candidatePath) || candidatePath.includes('\0')) {
    return null;
  }
  const sysGenSegments = systemGeneratedPrefixSegments(baseTarget, conversationId);
  if (!sysGenSegments) return null;
  const stepsDirRaw = join(baseTarget.canonicalRoot, ...sysGenSegments, 'steps');
  try {
    const stepsDirStat = lstatSync(stepsDirRaw);
    if (stepsDirStat.isSymbolicLink() || !stepsDirStat.isDirectory()) return null;
    const stepsDir = realpathSync(stepsDirRaw);
    if (stepsDir !== stepsDirRaw || !isStrictDescendantPath(baseTarget.canonicalRoot, stepsDir)) {
      return null;
    }
    const candidateParentStat = lstatSync(dirname(candidatePath));
    if (candidateParentStat.isSymbolicLink() || !candidateParentStat.isDirectory()) return null;
    const candidateStat = lstatSync(candidatePath);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) return null;
    const canonicalFile = realpathSync(candidatePath);
    if (!isStrictDescendantPath(stepsDir, canonicalFile)) return null;
    const relFromSteps = relative(stepsDir, canonicalFile).split(sep);
    if (relFromSteps.length !== 2 || !/^\d+$/u.test(relFromSteps[0]) || relFromSteps[1] !== 'output.txt') {
      return null;
    }
    if (!verifyNoSymlinkPathUnderRoot(baseTarget.canonicalRoot, canonicalFile).ok) {
      return null;
    }
    return {
      canonicalRoot: baseTarget.canonicalRoot,
      canonicalPath: canonicalFile,
      segments: [...sysGenSegments, 'steps', relFromSteps[0], 'output.txt'],
    };
  } catch {
    return null;
  }
}

function findToolEntryInTranscript(
  entries: readonly TranscriptEntry[],
  stepCandidates: readonly number[],
  toolUseId?: string,
): TranscriptEntry | null {
  const normalizedToolUseId = typeof toolUseId === 'string' && toolUseId.trim() ? toolUseId.trim() : null;
  for (const targetStep of stepCandidates) {
    if (normalizedToolUseId !== null) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry.step_index !== targetStep) continue;
        if (entry.type === 'USER_INPUT' || entry.type === 'PLANNER_RESPONSE') continue;
        if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
        if (entryToolUseId(entry) === normalizedToolUseId) return entry;
      }
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.step_index !== targetStep) continue;
      if (entry.type === 'USER_INPUT' || entry.type === 'PLANNER_RESPONSE') continue;
      if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
      return entry;
    }
  }
  if (normalizedToolUseId !== null) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.type === 'USER_INPUT' || entry.type === 'PLANNER_RESPONSE') continue;
      if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
      if (entryToolUseId(entry) === normalizedToolUseId) return entry;
    }
  }
  return null;
}

function readStepOutputFallback(
  baseTarget: AuthorizedTranscriptTarget,
  conversationId: string,
  referenceTexts: readonly string[],
  candidateSteps: readonly number[],
  options: TranscriptReadOptions,
): string | null {
  let explicitUrl: string | null = null;
  for (const text of referenceTexts) {
    const found = extractTruncatedOutputFileUrl(text);
    if (found) {
      explicitUrl = found;
      break;
    }
  }

  const readTarget = (stepTarget: AuthorizedTranscriptTarget): string | null => {
    const raw = readTailViaKernelOpenat(
      stepTarget.canonicalRoot,
      stepTarget.segments,
      TRANSCRIPT_TOOL_RESULT_MAX_BYTES,
      {
        openatHelperBinary: options.openatHelperBinary,
        platform: options.platform,
        mode: 'full',
      },
    );
    if (raw === null || raw.length === 0) return null;
    const decoded = raw.toString('utf8');
    const stripped = stripToolTimestampHeader(decoded);
    if (!stripped) return null;
    if (Buffer.byteLength(stripped, 'utf8') > TRANSCRIPT_TOOL_RESULT_MAX_BYTES) return null;
    if (isTruncatedToolResult({ content: decoded }, stripped)) return null;
    return stripped;
  };

  if (explicitUrl !== null) {
    const filePath = parseLocalFileUrlPath(explicitUrl);
    if (!filePath) return null;
    const stepTarget = resolveAuthorizedStepOutputTarget(baseTarget, conversationId, filePath);
    if (!stepTarget) return null;
    return readTarget(stepTarget);
  }

  const sysGenSegments = systemGeneratedPrefixSegments(baseTarget, conversationId);
  if (!sysGenSegments) return null;
  const stepsDir = join(baseTarget.canonicalRoot, ...sysGenSegments, 'steps');
  const seenSteps = new Set<number>();
  for (const stepNum of candidateSteps) {
    if (!Number.isSafeInteger(stepNum) || stepNum < 0 || seenSteps.has(stepNum)) continue;
    seenSteps.add(stepNum);
    const candidatePath = join(stepsDir, String(stepNum), 'output.txt');
    const stepTarget = resolveAuthorizedStepOutputTarget(baseTarget, conversationId, candidatePath);
    if (!stepTarget) continue;
    const recovered = readTarget(stepTarget);
    if (recovered !== null) return recovered;
  }
  return null;
}

export function extractToolResultFromTranscript(
  transcriptPath: unknown,
  stepIdx: unknown,
  options?: TranscriptReadOptions,
): string | null {
  const hasStepIdx = typeof stepIdx === 'number' && Number.isSafeInteger(stepIdx);
  const hintToolUseId = typeof options?.toolUseId === 'string' && options.toolUseId.trim()
    ? options.toolUseId.trim()
    : undefined;
  if (!hasStepIdx && !hintToolUseId) return null;
  if (!options) return null;

  const existingBaseTarget = resolveAuthorizedTranscriptTarget(transcriptPath, options);
  const baseTarget = existingBaseTarget ?? resolveAuthorizedMissingTranscriptTarget(transcriptPath, options);
  if (!baseTarget) return null;

  const conversationId = options.conversationId.trim();
  // Prefer exact step_index match, then immediate neighbor (+1) if wrapper shifted index.
  const stepCandidates = hasStepIdx ? [stepIdx, stepIdx + 1] : [];

  let matchedEntry: TranscriptEntry | null = null;
  let baseStripped: string | null = null;
  if (existingBaseTarget !== null) {
    const baseEntries = readTranscriptEntriesFromTarget(existingBaseTarget, options, TRANSCRIPT_TAIL_MAX_BYTES);
    matchedEntry = findToolEntryInTranscript(baseEntries, stepCandidates, hintToolUseId);
    if (matchedEntry && typeof matchedEntry.content === 'string') {
      const stripped = stripToolTimestampHeader(matchedEntry.content);
      if (stripped) {
        if (!isTruncatedToolResult(matchedEntry, stripped)) {
          return Buffer.byteLength(stripped, 'utf8') <= TRANSCRIPT_TOOL_RESULT_MAX_BYTES
            ? stripped
            : null;
        }
        baseStripped = stripped;
      }
    }
  }

  const matchedStep = matchedEntry && typeof matchedEntry.step_index === 'number' && Number.isSafeInteger(matchedEntry.step_index)
    ? matchedEntry.step_index
    : null;
  const effectiveStepCandidates = [
    ...(matchedStep !== null ? [matchedStep] : []),
    ...stepCandidates.filter((step) => step !== matchedStep),
  ];
  const effectiveToolUseId = (matchedEntry ? entryToolUseId(matchedEntry) : null) ?? hintToolUseId;

  // 1. Prefer sibling `transcript_full.jsonl` in the exact same authorized logs directory
  //    (handles both truncated `transcript.jsonl` entries and steps not yet flushed to `transcript.jsonl`).
  let fullStripped: string | null = null;
  let fullMatchedStep: number | null = null;
  const fullTarget = resolveSiblingFullTranscriptTarget(baseTarget, options);
  if (fullTarget) {
    const fullEntries = readTranscriptEntriesFromTarget(fullTarget, options, TRANSCRIPT_FULL_TAIL_MAX_BYTES);
    const fullEntry = findToolEntryInTranscript(fullEntries, effectiveStepCandidates, effectiveToolUseId);
    if (fullEntry && typeof fullEntry.content === 'string') {
      if (typeof fullEntry.step_index === 'number' && Number.isSafeInteger(fullEntry.step_index)) {
        fullMatchedStep = fullEntry.step_index;
      }
      const candidateStripped = stripToolTimestampHeader(fullEntry.content);
      if (candidateStripped) {
        if (!isTruncatedToolResult(fullEntry, candidateStripped)) {
          return Buffer.byteLength(candidateStripped, 'utf8') <= TRANSCRIPT_TOOL_RESULT_MAX_BYTES
            ? candidateStripped
            : null;
        }
        fullStripped = candidateStripped;
      }
    }
  }

  // 2. Fallback to authorized `<conversation>/.system_generated/steps/<n>/output.txt`
  //    (strictly confined by realpath + no-symlink + Linux openat2 RESOLVE_BENEATH).
  //    Antigravity writes `steps/<n>/output.txt` before flushing `transcript.jsonl`, so this
  //    also recovers unflushed steps directly when `stepCandidates` (`[stepIdx, stepIdx + 1]`) are present.
  const stepFallbackCandidates = [
    ...(fullMatchedStep !== null ? [fullMatchedStep] : []),
    ...effectiveStepCandidates.filter((step) => step !== fullMatchedStep),
  ];
  const referenceTexts: string[] = [];
  if (fullStripped !== null) referenceTexts.push(fullStripped);
  if (baseStripped !== null) referenceTexts.push(baseStripped);
  if (referenceTexts.length === 0 && stepFallbackCandidates.length === 0) {
    return null;
  }
  return readStepOutputFallback(
    baseTarget,
    conversationId,
    referenceTexts,
    stepFallbackCandidates,
    options,
  );
}

/**
 * Extracts a tool result from the authorized transcript / step output and restores
 * whitespace/newline-concatenated MCP JSON text blocks into individual text block strings.
 */
export function extractToolResultTextBlocksFromTranscript(
  transcriptPath: unknown,
  stepIdx: unknown,
  options?: TranscriptReadOptions,
): string[] | null {
  const extracted = extractToolResultFromTranscript(transcriptPath, stepIdx, options);
  if (extracted === null) return null;
  return splitConcatenatedJsonTextBlocks(extracted);
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

export interface TurnStateLockOptions {
  timeoutMs?: number;
  /** Override for the `flock` executable path (strictly for tests). */
  flockBinary?: string;
}

function resolveFlockBinary(override?: string): string | null {
  if (override !== undefined) {
    return override.trim() ? override : null;
  }
  if (process.platform === 'win32') {
    return null;
  }
  for (const candidate of ['/usr/bin/flock', '/bin/flock']) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return 'flock';
}

function runFlockOnInheritedFd(
  flockBin: string,
  fd: number,
  remainingMs: number,
): Promise<'acquired' | 'timeout' | 'unavailable'> {
  return new Promise((resolveOutcome) => {
    const args = remainingMs <= 0
      ? ['-x', '-E', String(FLOCK_CONFLICT_EXIT_CODE), '-n', '3']
      : ['-x', '-E', String(FLOCK_CONFLICT_EXIT_CODE), '-w', Math.max(0.001, remainingMs / 1000).toFixed(3), '3'];

    let settled = false;
    const finish = (outcome: 'acquired' | 'timeout' | 'unavailable') => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolveOutcome(outcome);
    };

    const child = spawn(flockBin, args, {
      stdio: ['ignore', 'ignore', 'ignore', fd],
      windowsHide: true,
    });

    const watchdog = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      finish('timeout');
    }, Math.max(50, remainingMs) + 500);
    watchdog.unref();

    child.on('error', () => {
      finish('unavailable');
    });

    child.on('close', (code, signal) => {
      if (code === 0 && signal === null) {
        finish('acquired');
      } else if (code === FLOCK_CONFLICT_EXIT_CODE) {
        finish('timeout');
      } else {
        finish('unavailable');
      }
    });
  });
}

/**
 * Acquires an OS kernel-managed `flock(2)` exclusive lock on the fixed lock file.
 *
 * The lock file is NEVER unlinked after creation: its inode stays fixed, and the
 * lock lives on the open file description held by `fd`. When the holder closes `fd`
 * (or crashes / is killed), the OS kernel releases the lock automatically without
 * any stale-lock unlink reaping.
 */
async function acquireOsFlockFd(
  lockPath: string,
  timeoutMs: number,
  flockBinaryOverride?: string,
): Promise<number> {
  const flockBin = resolveFlockBinary(flockBinaryOverride);
  if (!flockBin) {
    throw new Error('antigravity_turn_state_lock_unavailable');
  }
  const openFlags = fsConstants.O_CREAT
    | fsConstants.O_RDWR
    | (fsConstants.O_NONBLOCK ?? 0)
    | (fsConstants.O_NOFOLLOW ?? 0);
  const deadline = Date.now() + Math.max(0, timeoutMs);

  for (;;) {
    let fd: number;
    try {
      fd = openSync(lockPath, openFlags, 0o600);
    } catch {
      throw new Error('antigravity_turn_state_lock_unavailable');
    }

    let fdDev = 0n;
    let fdIno = 0n;
    try {
      const fdStat = fstatSync(fd, { bigint: true });
      if (!fdStat.isFile()) {
        closeSync(fd);
        throw new Error('antigravity_turn_state_lock_unavailable');
      }
      fdDev = fdStat.dev;
      fdIno = fdStat.ino;
    } catch (error) {
      try { closeSync(fd); } catch {}
      if (error instanceof Error && error.message === 'antigravity_turn_state_lock_unavailable') {
        throw error;
      }
      throw new Error('antigravity_turn_state_lock_unavailable');
    }

    const remainingMs = Math.max(0, deadline - Date.now());
    const outcome = await runFlockOnInheritedFd(flockBin, fd, remainingMs);
    if (outcome !== 'acquired') {
      try { closeSync(fd); } catch {}
      throw new Error(outcome === 'timeout'
        ? 'antigravity_turn_state_lock_timeout'
        : 'antigravity_turn_state_lock_unavailable');
    }

    // Confirm the locked fd still corresponds to the current inode at `lockPath`
    // in case an external process unlinked or replaced the file before `flock` completed.
    try {
      const pathStat = lstatSync(lockPath, { bigint: true });
      if (pathStat.isFile() && pathStat.dev === fdDev && pathStat.ino === fdIno) {
        return fd;
      }
    } catch {
      // Fall through to close & retry if within deadline.
    }

    try { closeSync(fd); } catch {}
    if (Date.now() >= deadline) {
      throw new Error('antigravity_turn_state_lock_timeout');
    }
  }
}

async function withTurnStateLock<T>(
  env: NodeJS.ProcessEnv,
  key: string,
  fn: () => T | Promise<T>,
  options?: TurnStateLockOptions,
): Promise<T> {
  mkdirSync(turnDirectory(env), { recursive: true, mode: 0o700 });
  const lockPath = lockPathFor(env, key);
  const timeoutMs = options?.timeoutMs ?? TURN_STATE_LOCK_TIMEOUT_MS;
  const fd = await acquireOsFlockFd(lockPath, timeoutMs, options?.flockBinary);
  try {
    return await fn();
  } finally {
    // Release the OS kernel lock by closing the open file description; NEVER unlink `lockPath`.
    try {
      closeSync(fd);
    } catch {}
  }
}

function parseOptionalStepIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function maxStepIndex(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
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
    const turnActive = parsed.turn_active === true;
    const lastOpened = parseOptionalStepIndex(parsed.last_opened_user_step_index);
    const isLegacyStepState = parsed.current_turn_user_step_index === undefined
      && parsed.last_closed_user_step_index === undefined;
    const hasCurrentStepField = Object.prototype.hasOwnProperty.call(parsed, 'current_turn_user_step_index');
    const hasLastClosedField = Object.prototype.hasOwnProperty.call(parsed, 'last_closed_user_step_index');
    let currentTurnUserStepIndex = isLegacyStepState
      ? null
      : (hasCurrentStepField ? parseOptionalStepIndex(parsed.current_turn_user_step_index) : null);
    let lastClosedUserStepIndex = isLegacyStepState
      ? lastOpened
      : (hasLastClosedField ? parseOptionalStepIndex(parsed.last_closed_user_step_index) : lastOpened);
    if (!turnActive && currentTurnUserStepIndex !== null) {
      lastClosedUserStepIndex = maxStepIndex(lastClosedUserStepIndex, currentTurnUserStepIndex);
      currentTurnUserStepIndex = null;
    }
    return {
      schema_version: TURN_SCHEMA,
      turn_id: parsed.turn_id,
      turn_generation: generation,
      turn_active: turnActive,
      started_at: typeof parsed.started_at === 'string' ? parsed.started_at : new Date(0).toISOString(),
      current_turn_user_step_index: currentTurnUserStepIndex,
      last_closed_user_step_index: lastClosedUserStepIndex,
      last_opened_user_step_index: lastOpened,
      last_prompt_digest: typeof parsed.last_prompt_digest === 'string' ? parsed.last_prompt_digest : null,
      start_status: parsed.start_status === 'started' || parsed.start_status === 'out_of_scope'
        ? parsed.start_status : 'failed',
      in_git: parsed.in_git === true,
      repository: typeof parsed.repository === 'string' ? parsed.repository : null,
      checkout: typeof parsed.checkout === 'string' ? parsed.checkout : null,
      non_git_scope_root: typeof parsed.non_git_scope_root === 'string' ? parsed.non_git_scope_root : null,
      matched_cwd_prefix: typeof parsed.matched_cwd_prefix === 'string' ? parsed.matched_cwd_prefix : null,
      destination: typeof parsed.destination === 'string' ? parsed.destination : '',
      login: typeof parsed.login === 'string' && parsed.login ? parsed.login : null,
      effective_project_code: normalizeValidProjectCode(parsed.effective_project_code),
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
  return { expected: typeof state.login === 'string' && state.login ? state.login : '\u0000unrecorded' };
}

interface ForwardResult {
  output: Record<string, unknown>;
  envelope: Record<string, unknown>;
}

async function forward(
  payload: Record<string, unknown>,
  context: Context,
  repository: string | null,
  login: LoginPin,
  antigravityEvent: keyof typeof DEFAULT_ANTIGRAVITY_TIMEOUTS_MS,
): Promise<ForwardResult> {
  if (!hostCanMapRepository(repository, context.config)) throw new Error('judgment_repository_unmappable');
  const endpoint = resolveAntigravityHookEndpoint(context.config);
  let token: string;
  let loginId: string | null;
  try {
    const obtained = await context.accessToken();
    const identity = derivePrincipalIdentity(obtained);
    token = identity.token;
    loginId = identity.loginId;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw new Error(typeof code === 'string' && /^login_[a-z_]{1,60}$/u.test(code)
      ? `judgment_hook_${code}` : 'judgment_hook_login_unavailable');
  }
  if (!token || loginId === null) throw new Error('judgment_hook_login_unavailable');
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
  return { output: output as Record<string, unknown>, envelope };
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
  const normalizedContext = typeof additionalContext === 'string' && additionalContext.trim()
    ? additionalContext.trim()
    : undefined;
  const normalizedMarkdown = typeof userMarkdown === 'string' && userMarkdown.trim()
    ? userMarkdown.trim()
    : undefined;
  if (!normalizedContext && !normalizedMarkdown) return null;
  const guardHeader = [
    `[Brainbase Judgment Turn: ${turnId}]`,
    `※この判断契約・先頭監査行は当ターン（${turnId}）のみ有効です。過去のターンに注入された旧ターンの判断契約・先頭監査行は上書きされ無効です。`,
  ].join('\n');
  const bodyParts: string[] = [];
  if (normalizedMarkdown) {
    bodyParts.push(normalizedMarkdown);
  }
  if (normalizedContext && normalizedContext !== normalizedMarkdown) {
    bodyParts.push(normalizedContext);
  }
  const modelBody = bodyParts.join('\n\n');
  const modelText = `${guardHeader}\n\n${modelBody}`;
  return {
    systemMessage: {
      systemMessage: modelText,
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

function isStaleOrAlreadyClosedStep(
  state: AntigravityTurnState,
  currentUserStepIndex: number | null,
): boolean {
  if (currentUserStepIndex === null) {
    return false;
  }
  if (state.last_closed_user_step_index !== null && currentUserStepIndex <= state.last_closed_user_step_index) {
    return true;
  }
  if (state.current_turn_user_step_index !== null) {
    if (currentUserStepIndex < state.current_turn_user_step_index) {
      return true;
    }
    if (!state.turn_active && currentUserStepIndex <= state.current_turn_user_step_index) {
      return true;
    }
  }
  return false;
}

function shouldRecoverNewTurn(
  state: AntigravityTurnState,
  currentUserStepIndex: number | null,
  promptDigest: string | null,
  invocationNum: number | null,
  nowMs: number,
  staleTurnMs: number,
): boolean {
  // Always reject delayed past-step events (and duplicate closed-step events)
  // BEFORE checking `!state.turn_active`.
  if (isStaleOrAlreadyClosedStep(state, currentUserStepIndex)) {
    return false;
  }
  if (!state.turn_active) return true;
  if (currentUserStepIndex !== null && state.current_turn_user_step_index !== null) {
    if (currentUserStepIndex > state.current_turn_user_step_index) {
      return true;
    }
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
    ...(context.transcriptOpenatBinary !== undefined
      ? { openatHelperBinary: context.transcriptOpenatBinary } : {}),
    ...(context.platform !== undefined
      ? { platform: context.platform } : {}),
  };
}

function matchesPendingEntry(
  entry: PendingContextMessage,
  state: AntigravityTurnState,
  expectedProjectCode: string,
): boolean {
  if (entry.turn_id !== state.turn_id) return false;
  if (entry.turn_generation !== state.turn_generation) return false;
  const effectiveProject = normalizeValidProjectCode(state.effective_project_code);
  if (effectiveProject === null || effectiveProject !== expectedProjectCode) return false;
  if (typeof entry.project_code !== 'string' || entry.project_code !== expectedProjectCode) return false;
  return true;
}

type PreInvocationDecision =
  | { kind: 'stale_step' }
  | { kind: 'existing_turn'; state: AntigravityTurnState }
  | { kind: 'no_prompt' }
  | { kind: 'opened_new_turn'; state: AntigravityTurnState; inScope: boolean };

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

  const nonGitRoot = context.scope.inGit
    ? null
    : (context.scope.matchedCwdPrefix ?? context.scope.cwd);
  const inScope = isAuditedAntigravityScope(context.scope, context.config)
    && hostCanMapRepository(context.scope.repository, context.config);

  // Atomically decide whether to open a new turn or join the existing active turn
  // AND write the new turn state within a single OS-locked critical section.
  const decision = await withTurnStateLock(context.env, key, (): PreInvocationDecision => {
    const latest = readState(context.env, key);
    const nowMs = context.now();
    if (latest && isStaleOrAlreadyClosedStep(latest, currentUserStepIndex)) {
      return { kind: 'stale_step' };
    }
    if (latest && !shouldRecoverNewTurn(
      latest,
      currentUserStepIndex,
      promptDigest,
      invocationNum,
      nowMs,
      context.staleTurnMs,
    )) {
      return { kind: 'existing_turn', state: latest };
    }
    if (!prompt) {
      if (latest && latest.pending_messages.length > 0) {
        writeState(context.env, key, {
          ...latest,
          turn_active: false,
          current_turn_user_step_index: null,
          last_closed_user_step_index: maxStepIndex(
            latest.last_closed_user_step_index,
            latest.current_turn_user_step_index,
          ),
          pending_messages: [],
        });
      }
      return { kind: 'no_prompt' };
    }
    const nextGeneration = (latest?.turn_generation ?? 0) + 1;
    const closingPreviousStep = latest
      && latest.current_turn_user_step_index !== null
      && (!latest.turn_active || latest.current_turn_user_step_index !== currentUserStepIndex)
      ? latest.current_turn_user_step_index
      : null;
    const nextLastClosedUserStepIndex = maxStepIndex(
      latest?.last_closed_user_step_index ?? null,
      closingPreviousStep,
    );
    const state: AntigravityTurnState = {
      schema_version: TURN_SCHEMA,
      turn_id: randomUUID(),
      turn_generation: nextGeneration,
      turn_active: true,
      started_at: new Date(nowMs).toISOString(),
      current_turn_user_step_index: currentUserStepIndex,
      last_closed_user_step_index: nextLastClosedUserStepIndex,
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
      effective_project_code: null,
      auth_fingerprint: null,
      pending_messages: [],
    };
    writeState(context.env, key, state);
    return { kind: 'opened_new_turn', state, inScope };
  }, context.turnLock);

  if (decision.kind === 'no_prompt' || decision.kind === 'stale_step') {
    return {};
  }

  if (decision.kind === 'existing_turn') {
    const previous = decision.state;
    // Same active turn (2nd+ PreInvocation in tool loop or duplicate):
    // NEVER fire a new UserPromptSubmit. Re-authorize started state, scope,
    // destination, explicit local project_code, and current login BEFORE draining or injecting.
    if (previous.pending_messages.length === 0) {
      return {};
    }

    const configuredProjectCode = normalizeValidProjectCode(context.config.project_code);
    const staticPendingEligible = configuredProjectCode !== null
      && isTurnStaticAuthorized(previous, context)
      && normalizeValidProjectCode(previous.effective_project_code) === configuredProjectCode
      && typeof previous.login === 'string'
      && previous.login.length > 0;
    if (!staticPendingEligible || configuredProjectCode === null) {
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (latest && latest.turn_id === previous.turn_id
            && latest.turn_generation === previous.turn_generation
            && latest.pending_messages.length > 0) {
            writeState(context.env, key, { ...latest, pending_messages: [] });
          }
        }, context.turnLock);
      } catch {}
      return {};
    }

    const requiredProjectCode = configuredProjectCode;
    const currentLogin = await resolveCurrentLoginId(context);
    const currentLoginId = currentLogin.ok ? currentLogin.loginId : null;
    const preAuthorized = canAuthorizePendingContext(previous, context, currentLoginId);

    const drained = await withTurnStateLock(context.env, key, (): PendingContextMessage[] => {
      const latest = readState(context.env, key);
      if (!latest || latest.turn_id !== previous.turn_id || latest.turn_generation !== previous.turn_generation) {
        return [];
      }
      if (!latest.turn_active) {
        return [];
      }
      const stillAuthorized = preAuthorized && canAuthorizePendingContext(latest, context, currentLoginId);
      if (!stillAuthorized) {
        if (latest.pending_messages.length > 0) {
          writeState(context.env, key, { ...latest, pending_messages: [] });
        }
        return [];
      }
      const matching = latest.pending_messages.filter((entry) => (
        matchesPendingEntry(entry, latest, requiredProjectCode)
      ));
      if (latest.pending_messages.length > 0) {
        writeState(context.env, key, { ...latest, pending_messages: [] });
      }
      return matching;
    }, context.turnLock);

    const steps: Array<Record<string, unknown>> = [];
    for (const entry of drained) {
      const step = buildSystemMessageStep(previous.turn_id, entry.additional_context, entry.system_message);
      if (step) steps.push(step);
    }
    return preInvocationOutputFromSteps(steps);
  }

  const openedState = decision.state;
  if (!decision.inScope) {
    return {};
  }

  try {
    const login: LoginPin = {};
    const hostPayload: Record<string, unknown> = {
      hook_event_name: 'UserPromptSubmit',
      session_id: conversationId,
      turn_id: openedState.turn_id,
      prompt: prompt!,
      cwd: context.scope.cwd,
      ...(authorizedTranscriptPath ? { transcript_path: authorizedTranscriptPath } : {}),
      ...(typeof payload.modelName === 'string' && payload.modelName
        ? { model: payload.modelName } : {}),
    };
    const { output, envelope } = await forward(hostPayload, context, openedState.repository, login, 'PreInvocation');
    const loginId = login.used ?? null;
    const effectiveProjectResult = resolveEffectiveProjectCode(envelope, output, context.config.project_code);
    if (!effectiveProjectResult.ok) {
      // Explicit Host project_code mismatch or invalid project_code:
      // NEVER inject initial context, NEVER mark turn started, and prevent any pending injection.
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (latest
            && latest.turn_id === openedState.turn_id
            && latest.turn_generation === openedState.turn_generation) {
            writeState(context.env, key, {
              ...latest,
              start_status: 'failed',
              login: null,
              effective_project_code: null,
              auth_fingerprint: null,
              pending_messages: [],
            });
          }
        }, context.turnLock);
      } catch {}
      return {};
    }

    const effectiveProjectCode = effectiveProjectResult.value;
    const authFingerprint = computeAuthFingerprint(
      context,
      openedState.non_git_scope_root,
      loginId,
      effectiveProjectCode,
    );
    let committed = false;
    try {
      committed = await withTurnStateLock(context.env, key, () => {
        const latest = readState(context.env, key);
        if (!latest
          || latest.turn_active !== true
          || latest.turn_id !== openedState.turn_id
          || latest.turn_generation !== openedState.turn_generation) {
          return false;
        }
        writeState(context.env, key, {
          ...latest,
          start_status: 'started',
          login: loginId,
          effective_project_code: effectiveProjectCode,
          auth_fingerprint: authFingerprint,
        });
        return true;
      }, context.turnLock);
    } catch {
      committed = false;
    }
    if (!committed) {
      // Turn was closed (e.g. by Stop) or superseded while awaiting HTTP:
      // never inject initial context for a finished or replaced turn.
      return {};
    }
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
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key), context.turnLock);
  if (!state || !isTurnStaticAuthorized(state, context)) {
    return { decision: 'allow' };
  }

  const transcriptOpts = transcriptOptionsFor(conversationId, context);
  const authorizedTranscriptPath = resolveAuthorizedTranscriptPath(payload.transcriptPath, transcriptOpts);
  const toolUseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
    ? toolCall.id.trim()
    : (typeof payload.stepIdx === 'number' ? `step-${payload.stepIdx}` : randomUUID());
  try {
    const { output } = await forward(
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
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key), context.turnLock);
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
    const toolCallId = typeof toolCall?.id === 'string' && toolCall.id.trim() ? toolCall.id.trim() : undefined;
    const transcriptBlocks = extractToolResultTextBlocksFromTranscript(
      payload.transcriptPath,
      payload.stepIdx,
      toolCallId ? { ...transcriptOpts, toolUseId: toolCallId } : transcriptOpts,
    );
    if (transcriptBlocks !== null) {
      toolResponse = {
        content: transcriptBlocks.map((text) => ({ type: 'text', text })),
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
    const { output, envelope } = await forward(
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
    const configuredProjectCode = normalizeValidProjectCode(context.config.project_code);
    const postProjectResult = resolveEffectiveProjectCode(envelope, output, context.config.project_code);
    if ((additionalContext || systemMessage)
      && configuredProjectCode !== null
      && postProjectResult.ok
      && postProjectResult.value === configuredProjectCode) {
      try {
        await withTurnStateLock(context.env, key, () => {
          const latest = readState(context.env, key);
          if (!latest
            || latest.turn_active !== true
            || latest.turn_id !== startedTurnId
            || latest.turn_generation !== startedGeneration
            || latest.auth_fingerprint !== startedAuthFingerprint
            || latest.effective_project_code !== configuredProjectCode
            || !isTurnStaticAuthorized(latest, context)) {
            return;
          }
          const nextPending: PendingContextMessage[] = [
            ...latest.pending_messages.filter((entry) => matchesPendingEntry(entry, latest, configuredProjectCode)),
            {
              turn_id: latest.turn_id,
              turn_generation: latest.turn_generation,
              project_code: configuredProjectCode,
              ...(additionalContext ? { additional_context: additionalContext } : {}),
              ...(systemMessage ? { system_message: systemMessage } : {}),
              created_at: new Date(context.now()).toISOString(),
            },
          ].slice(-MAX_PENDING_MESSAGES);
          writeState(context.env, key, { ...latest, pending_messages: nextPending });
        }, context.turnLock);
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
  const state = await withTurnStateLock(context.env, key, () => readState(context.env, key), context.turnLock);
  const terminationReason = typeof payload.terminationReason === 'string' ? payload.terminationReason : '';

  const clearTurn = async () => {
    if (!state) return;
    try {
      await withTurnStateLock(context.env, key, () => {
        const latest = readState(context.env, key);
        if (latest && latest.turn_id === state.turn_id && latest.turn_generation === state.turn_generation) {
          writeState(context.env, key, {
            ...latest,
            turn_active: false,
            current_turn_user_step_index: null,
            last_closed_user_step_index: maxStepIndex(
              latest.last_closed_user_step_index,
              latest.current_turn_user_step_index,
            ),
            pending_messages: [],
          });
        }
      }, context.turnLock);
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
      ...(options.turnLock !== undefined ? { turnLock: options.turnLock } : {}),
      ...(options.transcriptOpenatBinary !== undefined
        ? { transcriptOpenatBinary: options.transcriptOpenatBinary } : {}),
      ...(options.platform !== undefined
        ? { platform: options.platform } : {}),
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

/** @internal Exposed strictly for deterministic concurrency and TOCTOU regression tests. */
export const __antigravityHookTestInternals = {
  buildSystemMessageStep,
  withTurnStateLock,
  readTranscriptTailEntries,
  resolveOpenatHelperBinary,
  PYTHON_OPENAT_TAIL_READER,
  turnKey,
  lockPathFor,
  statePath,
};
