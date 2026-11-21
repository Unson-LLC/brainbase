// Claude Code adapter for a hosted Brainbase judgment Host.
//
// Claude Code runs this as a command hook (`brainbase judgment:claude-code-hook`)
// for UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure and Stop.
// Claude Code's hook input has no turn_id, so the adapter keeps one per prompt.
// It forwards each event to the hosted MCP's `/host/judgment/hook` with the
// person token from `brainbase login`, and returns only documented Claude Code
// hook fields.
//
// The hook is fail-open: the judgment plane audits, it does not authorize.
// Nothing here exits 2 or blocks a Stop, on its own error or on the Host's
// request. A failure becomes a warning for the person and the turn goes on.
//
// The person does not export variables. `judgment:install --target claude-code`
// writes the origin, and optionally the project and audited repositories, to
// the hook config file. When no project is configured, the Host chooses it
// from the repository name this adapter sends, or from the person's only project.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { getAccessToken, type AccessTokenOptions } from './brainbase-login.js';

export const CLAUDE_CODE_HOOK_CONFIG_SCHEMA = 'brainbase-claude-code-judgment-hook-v1';

export interface ClaudeCodeHookConfig {
  schema_version: typeof CLAUDE_CODE_HOOK_CONFIG_SCHEMA;
  /** Origin of the hosted MCP that serves /host/judgment/hook. */
  origin: string;
  /** Sent as x-brainbase-project-code. Omit to let the Host decide. */
  project_code?: string;
  /** Origin repository names to audit. Omit to audit every git repository. */
  repositories?: string[];
}

export type ClaudeCodeHookPayload = Record<string, unknown>;
export type ClaudeCodeHookOutput = Record<string, unknown>;

export interface ClaudeCodeHookOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Overrides how the person token is obtained (tests). */
  accessToken?: () => Promise<string>;
  credentials?: AccessTokenOptions;
}

const HOOK_PATH = '/host/judgment/hook';
const RECENT_PROMPTS = 16;
const TIMEOUT_MS: Record<string, number> = {
  UserPromptSubmit: 40_000, Stop: 40_000, PreToolUse: 15_000, PostToolUse: 15_000, PostToolUseFailure: 15_000,
};
// The Host reserves and checks a knowledge lookup attempt before it runs and
// records it only against that reservation. No other tool waits on the Host.
export const PRE_TOOL_USE_TOOLS = new Set(['mcp__brainbase__brainbase_knowledge_lookup']);
const OUTPUT_FIELDS = ['continue', 'suppressOutput', 'stopReason', 'decision', 'reason', 'systemMessage', 'hookSpecificOutput'];
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
  return {
    schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
    origin: value.origin,
    ...(typeof value.project_code === 'string' && value.project_code ? { project_code: value.project_code } : {}),
    ...(Array.isArray(value.repositories)
      ? { repositories: value.repositories.filter((name): name is string => typeof name === 'string' && name.length > 0) }
      : {}),
  };
}

// ---- Repository identity, read from git files without starting git ----

/** The nearest directory at or above `start` that holds a `.git` entry. */
export function findGitRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    try {
      statSync(join(current, '.git'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
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

function originRepositoryUrl(commonDir: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(commonDir, 'config'), 'utf8');
  } catch {
    return null;
  }
  let inOrigin = false;
  for (const line of text.split(/\r?\n/u)) {
    const section = /^\s*\[(.+)\]\s*$/u.exec(line);
    if (section) {
      inOrigin = /^remote\s+"origin"$/u.test(section[1].trim());
      continue;
    }
    const url = inOrigin ? /^\s*url\s*=\s*(.+?)\s*$/u.exec(line) : null;
    if (url) return url[1];
  }
  return null;
}

/**
 * The repository a checkout works for: the origin repository's name, so every
 * worktree of one repository has the same name. Without an origin, the main
 * checkout's directory name.
 */
export function repositoryName(repoRoot: string): string {
  const commonDir = gitCommonDir(repoRoot);
  const url = commonDir ? originRepositoryUrl(commonDir) : null;
  const origin = url ? url.replace(/\/+$/u, '').split(/[/:]/u).pop()?.replace(/\.git$/u, '') : undefined;
  if (origin) return origin;
  const mainRoot = commonDir && basename(commonDir) === '.git' ? dirname(commonDir) : repoRoot;
  return basename(mainRoot).replace(/\.git$/u, '');
}

function turnRepository(payload: ClaudeCodeHookPayload): string | null {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = findGitRoot(cwd);
  return root ? repositoryName(root) : null;
}

function isAuditedRepository(repository: string | null, config: ClaudeCodeHookConfig): boolean {
  if (!repository) return false;
  return !config.repositories || config.repositories.length === 0 || config.repositories.includes(repository);
}

// ---- Turn state ----

function turnDirectory(env: NodeJS.ProcessEnv): string {
  return env.BRAINBASE_CLAUDE_JUDGMENT_TURN_DIR || join(brainbaseHome(env), 'var', 'claude-judgment-turns');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function statePath(env: NodeJS.ProcessEnv, sessionId: string): string {
  return join(turnDirectory(env), `${sha256(sessionId)}.json`);
}

// Present while an input Claude Code screened during this prompt's turn may
// still run as a turn of its own (see unannouncedTurn).
function screeningPath(env: NodeJS.ProcessEnv, sessionId: string, promptId: string): string {
  return join(turnDirectory(env), `${sha256(sessionId)}.screened-${sha256(promptId).slice(0, 32)}`);
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

interface Context {
  env: NodeJS.ProcessEnv;
  config: ClaudeCodeHookConfig;
  fetch: typeof fetch;
  accessToken: () => Promise<string>;
  repository: string | null;
}

async function forward(payload: ClaudeCodeHookPayload, context: Context): Promise<Record<string, unknown>> {
  let endpoint: URL;
  try {
    endpoint = new URL(HOOK_PATH, context.config.origin);
  } catch {
    throw new Error('judgment_hook_endpoint_invalid');
  }
  if (!bearerTransportSafe(endpoint)) throw new Error('judgment_hook_transport_unsafe');
  let token: string;
  try {
    token = await context.accessToken();
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw new Error(typeof code === 'string' && /^login_[a-z_]{1,60}$/u.test(code)
      ? `judgment_hook_${code}` : 'judgment_hook_login_unavailable');
  }
  const eventName = String(payload.hook_event_name);
  let response: Response;
  try {
    response = await context.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-brainbase-judgment-host': 'claude-code',
        ...(context.config.project_code ? { 'x-brainbase-project-code': context.config.project_code } : {}),
        ...(context.repository ? { 'x-brainbase-repository': context.repository } : {}),
      },
      body: JSON.stringify(payload),
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
    || envelope.session_id !== payload.session_id || envelope.turn_id !== payload.turn_id
    || !output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('judgment_hook_response_invalid');
  }
  return output as Record<string, unknown>;
}

// Only documented Claude Code hook fields leave this adapter. The Host's
// PostToolUse branch names its context PostToolUse even for a failure event.
function documentedOutput(output: Record<string, unknown>, eventName: string): ClaudeCodeHookOutput {
  const result: ClaudeCodeHookOutput = {};
  for (const field of OUTPUT_FIELDS) {
    if (output[field] !== undefined) result[field] = output[field];
  }
  const specific = result.hookSpecificOutput;
  if (specific && typeof specific === 'object' && !Array.isArray(specific)) {
    result.hookSpecificOutput = { ...specific, hookEventName: eventName };
  } else {
    delete result.hookSpecificOutput;
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

function currentTurn(payload: ClaudeCodeHookPayload, env: NodeJS.ProcessEnv): TurnState | null {
  const state = readState(env, String(payload.session_id));
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
  const sessionId = String(payload.session_id);
  const promptId = promptIdOf(payload);
  const previous = readState(env, sessionId);
  if (!promptId || typeof previous?.prompt_id !== 'string' || previous.prompt_id === promptId) return {};
  if (recentPrompts(previous).includes(promptId)) return {};
  const audited = isAuditedRepository(context.repository, context.config);
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
    });
  } catch {
    return told;
  }
  noteScreening(env, sessionId, promptId);
  return told;
}

async function handleUserPromptSubmit(payload: ClaudeCodeHookPayload, context: Context): Promise<ClaudeCodeHookOutput> {
  const { env } = context;
  const sessionId = String(payload.session_id);
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
  };
  if (!isAuditedRepository(context.repository, context.config)) {
    writeState(env, sessionId, { ...state, start_status: 'out_of_scope' });
    return {};
  }
  writeState(env, sessionId, state);
  try {
    const output = await forward({ ...payload, turn_id: state.turn_id }, context);
    writeState(env, sessionId, { ...state, start_status: 'started' });
    return documentedOutput(output, 'UserPromptSubmit');
  } catch (error) {
    return warning(`判断ハーネスに接続できないため、このターンは判断監査なしで続行します（${safeReason(error)}）。`);
  }
}

async function handlePostToolUse(payload: ClaudeCodeHookPayload, context: Context, eventName: string): Promise<ClaudeCodeHookOutput> {
  const state = currentTurn(payload, context.env);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started') return {};
  try {
    return documentedOutput(await forward({ ...forwardedToolPayload(payload), turn_id: state.turn_id }, context), eventName);
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
  const state = currentTurn(payload, context.env);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started') return {};
  try {
    return preToolUseOutput(await forward({ ...payload, turn_id: state.turn_id }, context));
  } catch (error) {
    return warning(`知識取得の試行を判断ハーネスへ予約できませんでした（${safeReason(error)}）。この試行は記録されません。`);
  }
}

async function handleStop(payload: ClaudeCodeHookPayload, context: Context): Promise<ClaudeCodeHookOutput> {
  const state = currentTurn(payload, context.env);
  if (!state) return unannouncedTurn(payload, context);
  if (state.start_status !== 'started') return {};
  const blocks = Number.isSafeInteger(state.stop_blocks) ? state.stop_blocks : 0;
  let output: ClaudeCodeHookOutput;
  try {
    output = documentedOutput(
      await forward({ ...payload, turn_id: state.turn_id, stop_hook_active: blocks > 0 }, context),
      'Stop',
    );
  } catch (error) {
    return warning(`回答の照合に失敗したため、監査未完了のまま終了します（${safeReason(error)}）。`);
  }
  if (output.decision !== 'block') return output;
  // The person has already read the answer when Stop runs. Sending the repair
  // request back would print the same answer twice, so it is shown as a notice.
  writeState(context.env, String(payload.session_id), { ...state, stop_blocks: blocks + 1 });
  const repairId = /r-[a-f0-9]{16}/u.exec(typeof output.reason === 'string' ? output.reason : '')?.[0];
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
    const config = readClaudeCodeHookConfig(defaultClaudeCodeHookConfigPath(env));
    // Not installed for this person, or removed: forward nothing.
    if (!config) return {};
    const eventName = payload.hook_event_name;
    if (typeof payload.session_id !== 'string' || !payload.session_id) return {};
    // A subagent's events are not the parent turn's.
    if (typeof payload.agent_id === 'string' && payload.agent_id) return {};
    const context: Context = {
      env,
      config,
      fetch: options.fetch ?? fetch,
      accessToken: options.accessToken
        ?? (async () => (await getAccessToken({ fetch: options.fetch, ...options.credentials })).token),
      repository: turnRepository(payload),
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

function isJudgmentHook(hook: unknown): boolean {
  const command = (hook as { command?: unknown })?.command;
  return typeof command === 'string' && command.includes(CLAUDE_CODE_HOOK_COMMAND);
}

function withoutJudgmentHooks(hooks: unknown): Record<string, unknown> {
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
      const remaining = inner.filter((hook) => !isJudgmentHook(hook));
      if (remaining.length > 0) kept.push({ ...(group as object), hooks: remaining });
    }
    if (kept.length > 0) result[event] = kept;
  }
  return result;
}

/**
 * Claude Code settings with exactly one judgment registration per event, or
 * none with `remove`. Other hooks and settings are kept as they are.
 */
export function registerClaudeCodeJudgmentHooks(
  settings: Record<string, unknown>,
  { command, remove = false }: { command: string; remove?: boolean },
): Record<string, unknown> {
  const hooks = withoutJudgmentHooks(settings.hooks);
  if (!remove) {
    for (const { event, matcher, timeout, statusMessage } of REGISTRATIONS) {
      const group = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout, statusMessage }] };
      hooks[event] = [...((hooks[event] as unknown[] | undefined) ?? []), group];
    }
  }
  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}
