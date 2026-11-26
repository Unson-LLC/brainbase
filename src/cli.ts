#!/usr/bin/env node
import { createPortableGraph, portableGraphDigest } from './portable-graph.js';
import { createOrganizationGraphConfig, createOrganizationGraphClient } from './organization-graph.js';
import {
  listLocalMemories,
  memoryListJson,
  registerSelectedMemories,
  registrationPreviewJson,
  renderMemoryList,
  renderRegistrationPreview,
  renderRegistrationResult,
  selectLocalMemories
} from './personal-memory-handover.js';
import { createHash, randomBytes } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import { access, chmod, link, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePersonalOs, loadPersonalOs, migrateCanonicalGraph, mutatePersonalOs } from './ssot.js';
import { diagnoseGraph, type GraphDiagnosis } from './graph-diagnosis.js';
import { resolveDataDir } from './paths.js';
import { auditPersonalOsDirectory } from './ontology-ssot.js';
import { portableOntology, resolveOntologyVersion } from './ontology.js';
import { onboardingStatus } from './tools.js';
import { buildCandidateDrafts, buildValueDemo, parseOnboardingFormat, renderAgentProtocol, renderCandidateDrafts, renderConnectorRecommendations, renderLocalOnboardingPlan, renderSourceDiagnosis, renderValueDemo } from './onboarding.js';
import {
  buildExtractedCandidateSet,
  extractCandidates,
  loadApplyCandidates,
  normalizeSource,
  parseProvider,
  planApply,
  renderSourceJsonl,
  sourcePathFor,
  type ApplyResult,
  type ExtractedCandidateSet,
  type SourceRecord
} from './import-extract.js';
import {
  buildClaudeScheduledTasks,
  buildRoutines,
  parseRoutineKinds,
  parseRoutineTarget,
  renderCodexAutomations,
  type RoutineDefinition
} from './routines.js';
import {
  assertPublicSafeSkillBundle,
  buildSkillBundle,
  parseSkillIds,
  parseSkillTarget,
  renderSkillsMarkdown,
  type SkillBundle
} from './skills.js';
import {
  buildProjectRegistrationPlan,
  parseProjectSource,
  parseProjectStakeholder,
  renderProjectRegistrationMarkdown,
  type ProjectRegistrationPlan
} from './projects.js';
import { renderGuidedFirstRun, type GuidedTarget } from './guided-onboarding.js';
import {
  blockedJudgmentOutput,
  processJudgmentHook,
  resolveReasoningGateMode,
  type JudgmentAutonomyMode,
  type JudgmentHookPayload,
  type ReasoningGateHostConfig,
  type ReasoningGateMode
} from './judgment-host.js';
import { applyCanonicalWrites, buildCanonicalEdge } from './canonical-edge-builder.js';
import { defaultJudgmentJournalRoot } from './judgment-value-proof-review.js';
import { createWorldExtension, readWorldVocabulary } from './world-extension.js';
import { createLocalWebHost, LOCAL_WEB_DEFAULT_PORT } from './local-web-host.js';
import {
  assertCredentialsFilePath,
  BrainbaseLoginError,
  CREDENTIALS_SCHEMA_VERSION,
  defaultCredentialsPath,
  loginWithDeviceCode,
  normalizeMcpResourceUrl,
  normalizeMcpScope,
  normalizeMcpTenant,
  normalizeServerUrl,
  readCredentials,
  removeCredentials,
  withCredentialsLock,
} from './brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  canonicalFilePath,
  claudeCodeHookCommand,
  claudeCodeJudgmentHookGroups,
  defaultClaudeCodeHookConfigPath,
  handleClaudeCodeJudgmentHook,
  hasInstalledClaudeCodeHooks,
  isClaudeCodeHookConfigText,
  parseClaudeCodeHookConfig,
  normalizeRepositoryEntry,
  registerClaudeCodeJudgmentHooks,
  type ClaudeCodeHookConfig
} from './claude-code-judgment-hook.js';
import {
  ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
  ANTIGRAVITY_HOOK_KEY,
  antigravityFailOpenOutput,
  antigravityHookCommand,
  antigravityJudgmentHookEntry,
  defaultAntigravityHookConfigPath,
  defaultAntigravityHooksJsonPath,
  handleAntigravityJudgmentHook,
  hasInstalledAntigravityHooks,
  isAntigravityHookConfigText,
  normalizeAntigravityHookBaseUrl,
  parseAntigravityHookConfig,
  registerAntigravityJudgmentHooks,
  resolveAntigravityHookEndpoint,
  type AntigravityHookConfig
} from './antigravity-judgment-hook.js';
import type { CanonicalEntity, DecisionRecord, PersonalKgEntry, PersonalOs, RelationshipRecord } from './types.js';

interface CliIo {
  stdin?: AsyncIterable<string | Uint8Array>;
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
  /** Stops a long-running command such as web:serve (besides SIGINT/SIGTERM). */
  signal?: AbortSignal;
}

interface ParsedArgs {
  command?: string;
  values: Map<string, string[]>;
  flags: Set<string>;
  /** Tokens after the command that are not an option or an option's value. */
  positionals: string[];
}

type InstallTarget = 'codex' | 'claude' | 'codecode';

export async function runCli(argv = process.argv.slice(2), io: CliIo = process): Promise<number> {
  const parsed = parseArgs(argv);

  try {
    if (parsed.flags.has('help')) {
      write(io, usage());
      return 0;
    }
    switch (parsed.command) {
      case 'graph:upgrade': {
        const config = createOrganizationGraphConfig();
        if (!config) throw new Error('graph:upgrade requires all BRAINBASE_ORGANIZATION_* settings');
        const bundle = createPortableGraph(await loadPersonalOs(resolveDataDir(first(parsed, 'dir'))));
        const client = createOrganizationGraphClient(config);
        const imported = await client.importPortableGraph(bundle);
        const readback = await client.readPortableGraph();
        if (readback.digest !== portableGraphDigest(bundle)) throw new Error('organization_graph_readback_mismatch');
        write(io, JSON.stringify({ status: imported.status, digest: readback.digest, readbackVerified: true,
          sourceFilesUnchanged: true, graphId: config.graphId }) + '\n');
        return 0;
      }
      case 'graph:bundles': {
        const config = createOrganizationGraphConfig();
        if (!config) throw new Error('graph:bundles requires all BRAINBASE_ORGANIZATION_* settings');
        const format = first(parsed, 'format') ?? 'text';
        if (format !== 'text' && format !== 'json') throw new Error('graph:bundles --format must be text or json');
        const list = await createOrganizationGraphClient(config).listPortableGraphs();
        if (format === 'json') write(io, `${JSON.stringify(list, null, 2)}\n`);
        else if (list.bundles.length === 0) write(io, 'No Graph bundles have been uploaded to this organization yet.\n');
        else write(io, list.bundles.map((entry) => `${entry.createdAt}  ${entry.projectCode}  ${entry.graphId}  ${entry.digest}\n`).join('')
          + (list.truncated ? `Only the newest ${list.bundles.length} bundle(s) are shown.\n` : ''));
        return 0;
      }
      case 'memory:list':
        return await memoryList(parsed, io);
      case 'memory:register':
        return await memoryRegister(parsed, io);
      case 'onboard:init':
        return await onboardInit(parsed, io);
      case 'onboard:seed':
        return await onboardSeed(parsed, io);
      case 'onboard:install':
        return await onboardInstall(parsed, io);
      case 'onboard:agent':
        return await onboardAgent(parsed, io);
      case 'onboard:start':
        return await onboardStart(parsed, io);
      case 'onboard:demo':
        return await onboardDemo(parsed, io);
      case 'onboard:recommend':
        return await onboardRecommend(parsed, io);
      case 'onboard:diagnose-sources':
        return await onboardDiagnoseSources(parsed, io);
      case 'onboard:plan':
        return await onboardPlan(parsed, io);
      case 'onboard:projects':
        return await onboardProjects(parsed, io);
      case 'onboard:candidates':
        return await onboardCandidates(parsed, io);
      case 'onboard:import':
        return await onboardImport(parsed, io);
      case 'onboard:extract':
        return await onboardExtract(parsed, io);
      case 'onboard:apply':
        return await onboardApply(parsed, io);
      case 'onboard:routines':
        return await onboardRoutines(parsed, io);
      case 'onboard:skills':
        return await onboardSkills(parsed, io);
      case 'ontology:show':
        write(io, `${JSON.stringify(portableOntology, null, 2)}\n`);
        return 0;
      case 'ontology:audit':
        return await ontologyAudit(parsed, io);
      case 'ontology:migrate':
        return await ontologyMigrate(parsed, io);
      case 'judgment:hook':
        return await judgmentHook(parsed, io);
      case 'judgment:install':
        return await judgmentInstall(parsed, io);
      case 'judgment:claude-code-hook':
        return await judgmentClaudeCodeHook(parsed, io);
      case 'judgment:antigravity-hook':
        return await judgmentAntigravityHook(parsed, io);
      case 'login':
        return await login(parsed, io);
      case 'login:status':
        return await loginStatus(parsed, io);
      case 'logout':
        return await logout(parsed, io);
      case 'doctor':
        return await doctor(parsed, io);
      case 'web:serve':
      case 'review:serve':
        // review:serve is kept as an alias of the same local Web host.
        return await webServe(parsed, io, parsed.command);
      case 'mcp':
        await import('./index.js');
        return 0;
      default:
        write(io, usage());
        return parsed.flags.has('help') || !parsed.command ? 0 : 1;
    }
  } catch (error) {
    writeError(io, `${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function judgmentAutonomyOptions(parsed: ParsedArgs): {
  autonomyMode?: JudgmentAutonomyMode;
  autonomyCanaryProjects?: string[];
} {
  const rawMode = first(parsed, 'autonomy-mode');
  if (rawMode !== undefined && !['off', 'canary', 'on'].includes(rawMode)) {
    throw new Error('judgment_autonomy_mode_invalid');
  }
  const project = first(parsed, 'autonomy-project')?.trim();
  if (rawMode === 'canary' && !project) throw new Error('judgment_autonomy_canary_project_missing');
  return {
    ...(rawMode ? { autonomyMode: rawMode as JudgmentAutonomyMode } : {}),
    ...(project ? { autonomyCanaryProjects: [project] } : {})
  };
}

function judgmentReasoningGateOptions(parsed: ParsedArgs): ReasoningGateHostConfig {
  const rawMode = first(parsed, 'reasoning-gate-mode')?.trim();
  const rawProjects = parsed.values.get('reasoning-gate-projects')
    ?? parsed.values.get('reasoning-gate-project');
  const projects = rawProjects
    ? [...new Set(rawProjects.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))]
    : undefined;
  const resolvedMode = rawMode !== undefined
    ? resolveReasoningGateMode({ reasoningGateMode: rawMode as ReasoningGateMode }, {})
    : undefined;
  return {
    ...(resolvedMode !== undefined ? { reasoningGateMode: resolvedMode } : {}),
    ...(projects && projects.length > 0 ? { reasoningGateCanaryProjects: projects } : {})
  };
}

async function judgmentHook(parsed: ParsedArgs, io: CliIo): Promise<number> {
  let payload: JudgmentHookPayload = {};
  try {
    const input = await readHookStdin(io.stdin ?? process.stdin);
    payload = JSON.parse(input || '{}') as JudgmentHookPayload;
    const hookOptions = {
      ...judgmentAutonomyOptions(parsed),
      ...judgmentReasoningGateOptions(parsed)
    };
    write(io, `${JSON.stringify(await processJudgmentHook(payload, hookOptions))}\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const eventName = payload.hook_event_name ?? payload.hookEventName;
    if (eventName === 'Stop' && payload.stop_hook_active === true) {
      writeError(io, `${reason}\n`);
      return 1;
    }
    write(io, `${JSON.stringify(blockedJudgmentOutput(reason))}\n`);
  }
  return 0;
}

async function judgmentInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = first(parsed, 'target');
  if (target === 'claude-code') return await judgmentInstallClaudeCode(parsed, io);
  if (target === 'antigravity') return await judgmentInstallAntigravity(parsed, io);
  if (target !== 'codex') throw new Error('judgment:install requires --target codex|claude-code|antigravity');
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const autonomy = judgmentAutonomyOptions(parsed);
  const reasoningGate = judgmentReasoningGateOptions(parsed);
  const hookArguments = [
    process.execPath,
    cliPath,
    'judgment:hook',
    ...(autonomy.autonomyMode ? ['--autonomy-mode', autonomy.autonomyMode] : []),
    ...(autonomy.autonomyCanaryProjects?.[0]
      ? ['--autonomy-project', autonomy.autonomyCanaryProjects[0]]
      : []),
    ...(reasoningGate.reasoningGateMode
      ? ['--reasoning-gate-mode', reasoningGate.reasoningGateMode]
      : []),
    ...(reasoningGate.reasoningGateCanaryProjects?.length
      ? ['--reasoning-gate-projects', reasoningGate.reasoningGateCanaryProjects.join(',')]
      : [])
  ];
  const hook = {
    hooks: [{
      type: 'command',
      command: hookArguments.map((argument) => JSON.stringify(argument)).join(' '),
      statusMessage: 'brainbase judgment resolver'
    }]
  };
  const payload = `${JSON.stringify({
    hooks: {
      UserPromptSubmit: [hook],
      PostToolUse: [hook],
      Stop: [hook]
    }
  }, null, 2)}\n`;
  const outputPath = first(parsed, 'output');
  if (parsed.flags.has('dry-run') || !outputPath) {
    write(io, payload);
    return 0;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeConfigSnippet(outputPath, payload);
  write(io, `Wrote Codex Judgment Host config snippet to ${outputPath}\n`);
  return 0;
}

const CLAUDE_CODE_HOOK_MAX_INPUT_BYTES = 16 * 1024 * 1024;

async function judgmentClaudeCodeHook(parsed: ParsedArgs, io: CliIo): Promise<number> {
  // Fail-open: whatever happens, Claude Code gets a valid hook answer and exit 0.
  let output: Record<string, unknown>;
  try {
    const input = await readHookStdin(io.stdin ?? process.stdin, CLAUDE_CODE_HOOK_MAX_INPUT_BYTES);
    const payload: unknown = JSON.parse(input || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('judgment_hook_payload_invalid');
    const configPath = first(parsed, 'config');
    const registrationId = first(parsed, 'registration');
    output = await handleClaudeCodeJudgmentHook(payload as Record<string, unknown>, {
      ...(configPath ? { configPath } : {}),
      ...(registrationId ? { registrationId } : {}),
    });
  } catch (error) {
    const message = error instanceof Error && /^judgment_[a-z0-9_]{1,120}$/u.test(error.message)
      ? error.message : 'judgment_hook_failed';
    output = { systemMessage: `⚠️ Brainbase判断フック: 判断フックの処理に失敗しました（${message}）。判断監査なしで続行します。` };
  }
  write(io, `${JSON.stringify(output)}\n`);
  return 0;
}

async function judgmentAntigravityHook(parsed: ParsedArgs, io: CliIo): Promise<number> {
  // Fail-open: whatever happens, Antigravity gets a valid hook answer and exit 0.
  let eventName: unknown;
  let output: Record<string, unknown>;
  try {
    const input = await readHookStdin(io.stdin ?? process.stdin, CLAUDE_CODE_HOOK_MAX_INPUT_BYTES);
    const payload: unknown = JSON.parse(input || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('judgment_hook_payload_invalid');
    }
    eventName = (payload as Record<string, unknown>).hookEventName;
    const configPath = first(parsed, 'config');
    const registrationId = first(parsed, 'registration');
    output = await handleAntigravityJudgmentHook(payload as Record<string, unknown>, {
      ...(configPath ? { configPath } : {}),
      ...(registrationId ? { registrationId } : {}),
    });
  } catch {
    output = antigravityFailOpenOutput(eventName);
  }
  write(io, `${JSON.stringify(output)}\n`);
  return 0;
}

const HOOK_PROJECT_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

// Every option judgment:install --target claude-code reads. Anything else
// (a typo, or `--opt=value`, which parseArgs keeps whole as the key
// `opt=value`) would be ignored silently and widen what gets audited or write
// where a preview was meant, so it is refused before any file is touched.
const CLAUDE_CODE_INSTALL_VALUE_OPTIONS = new Set(['target', 'settings', 'config', 'origin', 'server', 'project', 'repositories']);
const CLAUDE_CODE_INSTALL_SWITCHES = new Set(['remove', 'dry-run']);

function assertClaudeCodeInstallOptions(parsed: ParsedArgs): void {
  for (const name of [...parsed.flags, ...parsed.values.keys()]) {
    if (CLAUDE_CODE_INSTALL_VALUE_OPTIONS.has(name) || CLAUDE_CODE_INSTALL_SWITCHES.has(name)) continue;
    const base = name.split('=')[0] ?? name;
    if (base !== name && (CLAUDE_CODE_INSTALL_VALUE_OPTIONS.has(base) || CLAUDE_CODE_INSTALL_SWITCHES.has(base))) {
      const hint = CLAUDE_CODE_INSTALL_SWITCHES.has(base) ? `--${base}` : `--${base} <値>`;
      throw new Error(`--${base}=… の形は使えません。${hint} のように書いてください。何も変えずに止めました。`);
    }
    throw new Error(`judgment:install --target claude-code は --${name} を知りません。何も変えずに止めました。`);
  }
  for (const name of CLAUDE_CODE_INSTALL_SWITCHES) {
    // `--dry-run true` would leave dry-run unset and write for real.
    if (parsed.values.has(name)) throw new Error(`--${name} は値をとりません（--${name} だけを書きます）。何も変えずに止めました。`);
  }
  for (const name of CLAUDE_CODE_INSTALL_VALUE_OPTIONS) {
    if (name !== 'repositories' && (parsed.values.get(name)?.length ?? 0) > 1) {
      throw new Error(`--${name} は1回だけ書けます。何も変えずに止めました。`);
    }
  }
}

// The file the system opens for `path`. resolve() drops `link/..` as text, but
// the system follows `link` first, so `alias/link/../settings.json` is a file
// next to the link's target, not in `alias`. The parent directory is resolved
// by the system and the last name added back; a missing parent has no links
// left to follow, so the text form is used. realpathSync.native, because the
// JavaScript realpathSync also normalizes the text before following links.
function settingsPathAsOpened(path: string): string {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
  const name = basename(absolute);
  if (name === '' || name === '.' || name === '..') return resolve(absolute);
  try {
    return join(realpathSync.native(dirname(absolute)), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resolve(absolute);
    throw error;
  }
}

async function judgmentInstallClaudeCode(parsed: ParsedArgs, io: CliIo): Promise<number> {
  assertClaudeCodeInstallOptions(parsed);
  // `--opt=value` or a bare `--opt` would otherwise fall back to the default
  // settings or config, and --remove would edit a file the user did not name.
  const settingsPath = settingsPathAsOpened(explicitValue(parsed, 'settings', '--settings <path>')
    ?? join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '', '.claude'), 'settings.json'));
  // Absolute, because the registered command carries it to every hook run.
  const configPath = resolve(explicitValue(parsed, 'config', '--config <path>') ?? defaultClaudeCodeHookConfigPath());
  const settingsReal = canonicalFilePath(settingsPath);
  const configReal = canonicalFilePath(configPath);
  if (settingsReal === configReal) {
    throw new Error('judgment:install --settings and --config must be different files');
  }
  if (configReal === canonicalFilePath(resolve(defaultCredentialsPath()))) {
    throw new Error('judgment:install --config must not be the brainbase login file');
  }
  const remove = parsed.flags.has('remove');
  const dryRun = parsed.flags.has('dry-run');
  const registrationId = randomBytes(16).toString('hex');
  let config: ClaudeCodeHookConfig | undefined;
  if (!remove) {
    const origin = explicitValue(parsed, 'origin', '--origin <hosted MCP URL>');
    if (!origin) throw new Error('judgment:install --target claude-code requires --origin <hosted MCP URL>');
    // A bare, empty or blank --project would drop the project and let the Host
    // pick one; leave the option out for that instead.
    const projectValue = explicitValue(parsed, 'project', '--project <code>');
    const projectCode = projectValue?.trim();
    if (projectValue !== undefined && !HOOK_PROJECT_CODE_PATTERN.test(projectCode ?? '')) throw new Error('judgment:install --project must match [a-z0-9][a-z0-9._-]{0,63}');
    explicitValue(parsed, 'repositories', '--repositories <host/owner/name,...>');
    const repositoryValues = parsed.values.get('repositories');
    const repositories = (repositoryValues ?? [])
      .flatMap((value) => value.split(',')).map((name) => name.trim()).filter(Boolean)
      .map((name) => {
        const normalized = normalizeRepositoryEntry(name);
        if (!normalized) {
          throw new Error(`judgment:install --repositories needs host/owner/name, e.g. github.com/example-org/app (got ${name})`);
        }
        return normalized;
      });
    // An empty list would read as "no limit". Leaving the option out audits
    // every repository; an empty value is refused instead of widening to that.
    // `--repositories ''` arrives as a bare flag.
    if ((repositoryValues !== undefined || parsed.flags.has('repositories')) && repositories.length === 0) {
      throw new Error('judgment:install --repositories needs at least one host/owner/name; leave the option out to audit every repository');
    }
    // The hook sends only the login made to this API, so a later login to
    // another environment never reaches this Host.
    const loginServer = explicitValue(parsed, 'server', '--server <API URL>')
      ?? (await readCredentials(defaultCredentialsPath()).catch(() => null))?.server_url;
    if (!loginServer) {
      throw new Error('judgment:install --target claude-code requires --server <API URL> (the server you log in to with brainbase login), or a saved login');
    }
    config = {
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
      origin: normalizeServerUrl(origin),
      login_server: normalizeServerUrl(loginServer),
      ...(projectCode ? { project_code: projectCode } : {}),
      ...(repositories.length > 0 ? { repositories: [...new Set(repositories)] } : {}),
      registration: { id: registrationId, settings: settingsReal }
    };
  }
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const command = claudeCodeHookCommand(process.execPath, cliPath, configPath, registrationId);
  const plan = { settingsPath, settingsReal, configPath, configReal, config, command, remove, dryRun };
  // Claude Code saves its settings without taking the install lock. When it
  // saved between our read and our write, start again from what it saved, so
  // its change is kept; give up after a few tries without changing anything.
  const run = async (): Promise<number> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await applyClaudeCodeRegistration(plan, io);
      } catch (error) {
        if (!(error instanceof SettingsChangedError)) throw error;
        if (attempt >= SETTINGS_CHANGED_ATTEMPTS) {
          throw new Error(`${settingsPath} は登録の途中で何度も別の保存が入ったため、何も変えずに止めました。Claude Code の設定の保存が落ち着いてから、もう一度実行してください。`);
        }
      }
    }
  };
  // A preview writes nothing, so it takes no lock.
  return dryRun ? await run() : await withInstallLocks([settingsReal, configReal], run);
}

/**
 * Runs `task` holding one lock per file, so that two installs touching the
 * same Claude Code settings or the same hook config run one after the other:
 * each reads, checks ownership and writes both files under the locks. The
 * locks are taken in one order (sorted real paths), so two installs never wait
 * on each other. Each lock sits next to the real file
 * (`<real path>.brainbase-install.lock`),
 * so installs run with different homes still share it. They follow the rules
 * of the saved-login lock: a lock is only taken over when its holder no
 * longer runs.
 */
// Install locks sit next to settings files that other tools also keep files
// beside. They get a name of their own, and a file there that is not a lock
// record this code wrote is never removed: the install waits and says which
// file to check instead.
// The settings are no saved login, so taking this lock never runs the
// recovery of a login save or logout that stopped half way (recover: false).
const INSTALL_LOCK = { suffix: '.brainbase-install.lock', recover: false } as const;

async function withInstallLocks<T>(files: string[], task: () => Promise<T>): Promise<T> {
  const keys = [...new Set(files)].sort();
  const hold = async (index: number): Promise<T> => {
    if (index === keys.length) return await task();
    try {
      return await withCredentialsLock(keys[index], () => hold(index + 1), INSTALL_LOCK);
    } catch (error) {
      if (error instanceof BrainbaseLoginError && error.code === 'login_busy') {
        throw new Error(`Another judgment:install is changing ${files.join(' or ')}. Try again. If no judgment:install runs, remove ${keys[index]}${INSTALL_LOCK.suffix}.`);
      }
      throw error;
    }
  };
  return await hold(0);
}

const SETTINGS_CHANGED_ATTEMPTS = 3;

/**
 * Reads `path` (following links) only when it is a regular file; null when
 * it does not exist. It is opened without waiting (a named pipe with no
 * writer would otherwise hold the install, and its lock, forever) and its
 * type is taken from the opened file, so a swap after the check is caught too.
 */
async function readRegularFile(path: string, option: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`judgment:install ${option} ${path} は通常のファイルではありません（名前付きパイプ、デバイス、ディレクトリなど）。何も変えずに止めました。`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** The file was saved by someone else after it was read; nothing was written over it. */
class SettingsChangedError extends Error {}

/**
 * A file brainbase writes for another use (a hook config, a saved login)
 * carries brainbase's schema_version. Taking it as Claude Code settings would
 * add hooks to it, and the registration that owns it would later replace it
 * whole and drop them.
 */
function brainbaseFileUse(value: Record<string, unknown>): string | null {
  const schema = value.schema_version;
  if (schema === CLAUDE_CODE_HOOK_CONFIG_SCHEMA || schema === ANTIGRAVITY_HOOK_CONFIG_SCHEMA) return '判断フックの設定';
  if (schema === CREDENTIALS_SCHEMA_VERSION) return 'brainbase login の保存ファイル';
  if (typeof schema === 'string' && schema.startsWith('brainbase')) return `brainbase のファイル（${schema}）`;
  return null;
}

interface ClaudeCodeRegistrationPlan {
  settingsPath: string;
  settingsReal: string;
  configPath: string;
  configReal: string;
  config: ClaudeCodeHookConfig | undefined;
  command: string;
  remove: boolean;
  dryRun: boolean;
}

async function applyClaudeCodeRegistration(plan: ClaudeCodeRegistrationPlan, io: CliIo): Promise<number> {
  const { settingsPath, settingsReal, configPath, configReal, config, command, remove, dryRun } = plan;
  let settings: Record<string, unknown> = {};
  // The text as read, so the write can tell whether someone saved since.
  const settingsText = await readRegularFile(settingsPath, '--settings');
  if (settingsText !== null) {
    const parsedSettings: unknown = JSON.parse(settingsText);
    if (!parsedSettings || typeof parsedSettings !== 'object' || Array.isArray(parsedSettings)) {
      throw new Error(`Claude Code settings is not a JSON object: ${settingsPath}`);
    }
    settings = parsedSettings as Record<string, unknown>;
  }
  const otherUse = brainbaseFileUse(settings);
  if (otherUse) {
    throw new Error(`judgment:install --settings ${settingsPath} は${otherUse}で、Claude Code の設定ではありません。何も変えずに止めました。Claude Code の settings.json を指定してください。`);
  }
  // The installer only overwrites or removes a config file it wrote itself.
  // Read once, as a regular file; the checks below use this text and do not
  // open the path again.
  const previousConfig = await readRegularFile(configPath, '--config');
  const configExists = previousConfig !== null;
  const configOwned = configExists && isClaudeCodeHookConfigText(previousConfig);
  if (!remove && configExists && !configOwned) {
    throw new Error(`judgment:install --config ${configPath} exists and is not a brainbase hook config; choose another path`);
  }
  // A hook config belongs to the one settings file that registered it. Another
  // settings file reusing it would redirect or, on removal, stop that
  // registration's hooks.
  const existingConfig = configOwned ? parseClaudeCodeHookConfig(previousConfig) : null;
  const registeredElsewhere = configOwned && (existingConfig
    ? canonicalFilePath(existingConfig.registration.settings) !== settingsReal
    : !hasInstalledClaudeCodeHooks(settings, configPath));
  if (!remove && registeredElsewhere) {
    throw new Error(`judgment:install --config ${configPath} is used by ${existingConfig?.registration.settings ?? 'another registration'}; choose another --config for ${settingsPath}`);
  }
  if (remove && !hasInstalledClaudeCodeHooks(settings, configPath)) {
    throw new Error(`judgment:install --remove found no registration for ${configPath} in ${settingsPath}; nothing was changed`);
  }
  const removedIds = new Set<string>();
  const next = registerClaudeCodeJudgmentHooks(settings, { command, configPath, remove, removedIds });
  if (dryRun) {
    // Only the change: the settings around it may hold secrets.
    write(io, `${JSON.stringify({
      settingsPath,
      configPath,
      config: config ?? null,
      hooks: { add: remove ? [] : claudeCodeJudgmentHookGroups(command), remove_registration_ids: [...removedIds] },
    }, null, 2)}\n`);
    return 0;
  }
  if (remove) {
    await replaceFileFollowingLinks(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 0o600, settingsText);
    // The config is deleted only when the registration it now carries was one
    // of the commands just taken out; otherwise a command elsewhere still uses it.
    const currentElsewhere = !!existingConfig && !removedIds.has(existingConfig.registration.id);
    // The real file goes, not a link to it: a command that names the real
    // path would otherwise still find its registration. The link is left.
    if (configOwned && !registeredElsewhere && !currentElsewhere) await rm(configReal, { force: true });
    write(io, [
      `Claude Codeの判断フックを外しました（${settingsPath}）。`,
      ...(configExists && !configOwned ? [`${configPath} は判断フックの設定ではないため、残しました。`] : []),
      ...(registeredElsewhere ? [`${configPath} は ${existingConfig?.registration.settings ?? '別の登録'} の登録が使っているため、残しました。`] : []),
      ...(!registeredElsewhere && currentElsewhere ? [`${configPath} は外した登録とは別の、いまの登録が使っているため、残しました。`] : []),
      ''
    ].join('\n'));
    return 0;
  }
  // The config goes first: while the settings are not yet written, the new
  // registration is not active, and an earlier one (whose command carries the
  // old registration id) sends nothing rather than to the new destination.
  // When writing the settings fails, the earlier config is put back, so the
  // earlier registration keeps auditing where it did.
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await replaceFileFollowingLinks(configPath, `${JSON.stringify(config, null, 2)}\n`, 0o600);
  try {
    await replaceFileFollowingLinks(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 0o600, settingsText);
  } catch (error) {
    try {
      if (previousConfig === null) await rm(configPath, { force: true });
      else await replaceFileFollowingLinks(configPath, previousConfig, 0o600);
    } catch {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${configPath} could not be put back, run judgment:install again`);
    }
    throw error;
  }
  write(io, [
    `Claude Codeの判断フックを登録しました（${settingsPath}）。`,
    `送り先: ${config!.origin}`,
    `project: ${config!.project_code ?? 'Hostが決める'}`,
    `対象のリポジトリ: ${config!.repositories?.join(', ') ?? 'すべて'}`,
    ...(await readCredentials(defaultCredentialsPath()).catch(() => null)
      ? []
      : ['まだログインしていません。brainbase login --server <API のURL> を実行してください。']),
    'Claude Codeを起動し直すと有効になります。',
    ''
  ].join('\n'));
  return 0;
}

const ANTIGRAVITY_INSTALL_VALUE_OPTIONS = new Set([
  'target', 'settings', 'config', 'origin', 'endpoint', 'server', 'project', 'repositories', 'cwd-prefix',
]);
const ANTIGRAVITY_INSTALL_SWITCHES = new Set(['allow-non-git', 'remove', 'dry-run']);
const ANTIGRAVITY_INSTALL_MULTI_OPTIONS = new Set(['repositories', 'cwd-prefix']);

function assertAntigravityInstallOptions(parsed: ParsedArgs): void {
  for (const name of [...parsed.flags, ...parsed.values.keys()]) {
    if (ANTIGRAVITY_INSTALL_VALUE_OPTIONS.has(name) || ANTIGRAVITY_INSTALL_SWITCHES.has(name)) continue;
    const base = name.split('=')[0] ?? name;
    if (base !== name && (ANTIGRAVITY_INSTALL_VALUE_OPTIONS.has(base) || ANTIGRAVITY_INSTALL_SWITCHES.has(base))) {
      const hint = ANTIGRAVITY_INSTALL_SWITCHES.has(base) ? `--${base}` : `--${base} <値>`;
      throw new Error(`--${base}=… の形は使えません。${hint} のように書いてください。何も変えずに止めました。`);
    }
    throw new Error(`judgment:install --target antigravity は --${name} を知りません。何も変えずに止めました。`);
  }
  for (const name of ANTIGRAVITY_INSTALL_SWITCHES) {
    if (parsed.values.has(name)) {
      throw new Error(`--${name} は値をとりません（--${name} だけを書きます）。何も変えずに止めました。`);
    }
  }
  for (const name of ANTIGRAVITY_INSTALL_VALUE_OPTIONS) {
    if (!ANTIGRAVITY_INSTALL_MULTI_OPTIONS.has(name) && (parsed.values.get(name)?.length ?? 0) > 1) {
      throw new Error(`--${name} は1回だけ書けます。何も変えずに止めました。`);
    }
  }
}

interface AntigravityRegistrationPlan {
  settingsPath: string;
  settingsReal: string;
  configPath: string;
  configReal: string;
  config: AntigravityHookConfig | undefined;
  command: string;
  remove: boolean;
  dryRun: boolean;
}

async function judgmentInstallAntigravity(parsed: ParsedArgs, io: CliIo): Promise<number> {
  assertAntigravityInstallOptions(parsed);
  const settingsPath = resolve(explicitValue(parsed, 'settings', '--settings <hooks.json>')
    ?? defaultAntigravityHooksJsonPath());
  const configPath = resolve(explicitValue(parsed, 'config', '--config <path>')
    ?? defaultAntigravityHookConfigPath());
  const settingsReal = canonicalFilePath(settingsPath);
  const configReal = canonicalFilePath(configPath);
  if (settingsReal === configReal) {
    throw new Error('judgment:install --settings and --config must be different files');
  }
  if (configReal === canonicalFilePath(resolve(defaultCredentialsPath()))) {
    throw new Error('judgment:install --config must not be the brainbase login file');
  }
  const remove = parsed.flags.has('remove');
  const dryRun = parsed.flags.has('dry-run');
  const registrationId = randomBytes(16).toString('hex');
  let config: AntigravityHookConfig | undefined;
  if (!remove) {
    const origin = explicitValue(parsed, 'origin', '--origin <baseUrl>');
    if (!origin) throw new Error('judgment:install --target antigravity requires --origin <baseUrl>');
    const endpoint = explicitValue(parsed, 'endpoint', '--endpoint <hook URL>');
    const projectValue = explicitValue(parsed, 'project', '--project <code>');
    const projectCode = projectValue?.trim();
    if (projectValue !== undefined && !HOOK_PROJECT_CODE_PATTERN.test(projectCode ?? '')) {
      throw new Error('judgment:install --project must match [a-z0-9][a-z0-9._-]{0,63}');
    }
    explicitValue(parsed, 'repositories', '--repositories <host/owner/name,...>');
    const repositoryValues = parsed.values.get('repositories');
    const repositories = (repositoryValues ?? [])
      .flatMap((value) => value.split(',')).map((name) => name.trim()).filter(Boolean)
      .map((name) => {
        const normalized = normalizeRepositoryEntry(name);
        if (!normalized) {
          throw new Error(`judgment:install --repositories needs host/owner/name, e.g. github.com/example-org/app (got ${name})`);
        }
        return normalized;
      });
    if ((repositoryValues !== undefined || parsed.flags.has('repositories')) && repositories.length === 0) {
      throw new Error('judgment:install --repositories needs at least one host/owner/name; leave the option out to audit every repository');
    }
    explicitValue(parsed, 'cwd-prefix', '--cwd-prefix <path>');
    const rawPrefixes = parsed.values.get('cwd-prefix');
    const cwdPrefixes = (rawPrefixes ?? [])
      .map((entry) => entry.trim()).filter(Boolean)
      .map((entry) => canonicalFilePath(entry));
    if ((rawPrefixes !== undefined || parsed.flags.has('cwd-prefix')) && cwdPrefixes.length === 0) {
      throw new Error('judgment:install --cwd-prefix needs a non-empty directory path');
    }
    const allowNonGit = parsed.flags.has('allow-non-git');
    const loginServer = explicitValue(parsed, 'server', '--server <API URL>')
      ?? (await readCredentials(defaultCredentialsPath()).catch(() => null))?.server_url;
    if (!loginServer) {
      throw new Error('judgment:install --target antigravity requires --server <API URL> (the server you log in to with brainbase login), or a saved login');
    }
    config = {
      schema_version: ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
      origin: normalizeAntigravityHookBaseUrl(origin),
      ...(endpoint ? { endpoint: normalizeAntigravityHookBaseUrl(endpoint) } : {}),
      login_server: normalizeServerUrl(loginServer),
      ...(projectCode ? { project_code: projectCode } : {}),
      ...(allowNonGit ? { allow_non_git: true } : {}),
      ...(cwdPrefixes.length > 0 ? { cwd_prefixes: [...new Set(cwdPrefixes)] } : {}),
      ...(repositories.length > 0 ? { repositories: [...new Set(repositories)] } : {}),
      registration: { id: registrationId, settings: settingsReal },
    };
    resolveAntigravityHookEndpoint(config);
  }
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  const command = antigravityHookCommand(process.execPath, cliPath, configPath, registrationId);
  const plan: AntigravityRegistrationPlan = {
    settingsPath, settingsReal, configPath, configReal, config, command, remove, dryRun,
  };
  const run = async (): Promise<number> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await applyAntigravityRegistration(plan, io);
      } catch (error) {
        if (!(error instanceof SettingsChangedError)) throw error;
        if (attempt >= SETTINGS_CHANGED_ATTEMPTS) {
          throw new Error(`${settingsPath} は登録の途中で何度も別の保存が入ったため、何も変えずに止めました。設定の保存が落ち着いてから、もう一度実行してください。`);
        }
      }
    }
  };
  return dryRun ? await run() : await withInstallLocks([settingsReal, configReal], run);
}

async function applyAntigravityRegistration(plan: AntigravityRegistrationPlan, io: CliIo): Promise<number> {
  const { settingsPath, settingsReal, configPath, configReal, config, command, remove, dryRun } = plan;
  let hooksJson: Record<string, unknown> = {};
  const settingsText = await readRegularFile(settingsPath, '--settings');
  if (settingsText !== null) {
    const parsedSettings: unknown = JSON.parse(settingsText);
    if (!parsedSettings || typeof parsedSettings !== 'object' || Array.isArray(parsedSettings)) {
      throw new Error(`Antigravity hooks.json is not a JSON object: ${settingsPath}`);
    }
    hooksJson = parsedSettings as Record<string, unknown>;
  }
  const otherUse = brainbaseFileUse(hooksJson);
  if (otherUse) {
    throw new Error(`judgment:install --settings ${settingsPath} は${otherUse}で、Antigravity の hooks.json ではありません。何も変えずに止めました。Antigravity の hooks.json を指定してください。`);
  }
  const previousConfig = await readRegularFile(configPath, '--config');
  const configExists = previousConfig !== null;
  const configOwned = configExists && isAntigravityHookConfigText(previousConfig);
  if (!remove && configExists && !configOwned) {
    throw new Error(`judgment:install --config ${configPath} exists and is not a brainbase antigravity hook config; choose another path`);
  }
  const existingConfig = configOwned ? parseAntigravityHookConfig(previousConfig) : null;
  const registeredElsewhere = configOwned && (existingConfig
    ? canonicalFilePath(existingConfig.registration.settings) !== settingsReal
    : !hasInstalledAntigravityHooks(hooksJson, configPath));
  if (!remove && registeredElsewhere) {
    throw new Error(`judgment:install --config ${configPath} is used by ${existingConfig?.registration.settings ?? 'another registration'}; choose another --config for ${settingsPath}`);
  }
  if (remove && !hasInstalledAntigravityHooks(hooksJson, configPath)) {
    throw new Error(`judgment:install --remove found no registration for ${configPath} in ${settingsPath}; nothing was changed`);
  }
  const removedIds = new Set<string>();
  const next = registerAntigravityJudgmentHooks(hooksJson, { command, configPath, remove, removedIds });
  if (dryRun) {
    write(io, `${JSON.stringify({
      settingsPath,
      configPath,
      config: config ?? null,
      hooks: {
        key: ANTIGRAVITY_HOOK_KEY,
        entry: remove ? null : antigravityJudgmentHookEntry(command),
        remove_registration_ids: [...removedIds],
      },
    }, null, 2)}\n`);
    return 0;
  }
  if (remove) {
    await replaceFileFollowingLinks(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 0o600, settingsText);
    const currentElsewhere = !!existingConfig && !removedIds.has(existingConfig.registration.id);
    if (configOwned && !registeredElsewhere && !currentElsewhere) await rm(configReal, { force: true });
    write(io, [
      `Antigravityの判断フックを外しました（${settingsPath}）。`,
      ...(configExists && !configOwned ? [`${configPath} は判断フックの設定ではないため、残しました。`] : []),
      ...(registeredElsewhere ? [`${configPath} は ${existingConfig?.registration.settings ?? '別の登録'} の登録が使っているため、残しました。`] : []),
      ...(!registeredElsewhere && currentElsewhere ? [`${configPath} は外した登録とは別の、いまの登録が使っているため、残しました。`] : []),
      ''
    ].join('\n'));
    return 0;
  }
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await replaceFileFollowingLinks(configPath, `${JSON.stringify(config, null, 2)}\n`, 0o600);
  try {
    await replaceFileFollowingLinks(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 0o600, settingsText);
  } catch (error) {
    try {
      if (previousConfig === null) await rm(configPath, { force: true });
      else await replaceFileFollowingLinks(configPath, previousConfig, 0o600);
    } catch {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${configPath} could not be put back, run judgment:install again`);
    }
    throw error;
  }
  const resolvedEndpoint = resolveAntigravityHookEndpoint(config!).toString();
  write(io, [
    `Antigravityの判断フックを登録しました（${settingsPath}）。`,
    `送り先: ${resolvedEndpoint}`,
    `project: ${config!.project_code ?? 'Hostが決める'}`,
    ...(config!.allow_non_git ? ['非Gitディレクトリ: 許可（allow_non_git: true）'] : []),
    ...(config!.cwd_prefixes ? [`対象ディレクトリ: ${config!.cwd_prefixes.join(', ')}`] : []),
    `対象のリポジトリ: ${config!.repositories?.join(', ') ?? 'すべて'}`,
    ...(await readCredentials(defaultCredentialsPath()).catch(() => null)
      ? []
      : ['まだログインしていません。brainbase login --server <API のURL> を実行してください。']),
    'Antigravityを再起動すると有効になります。',
    ''
  ].join('\n'));
  return 0;
}

/**
 * An option the user typed must carry a value. parseArgs turns `--opt` with no
 * value (or `--opt ''`) into a bare flag; falling back to the default there would
 * act on a path or server the user did not choose (logout would delete the
 * default login). Stop before touching any file or the network.
 */
function explicitValue(parsed: ParsedArgs, key: string, hint: string): string | undefined {
  if (parsed.flags.has(key)) throw new Error(`--${key} には値が要ります（${hint}）。何も変えずに止めました。`);
  // parseArgs keeps `--opt=value` whole as the key `opt=value`, so the option
  // would look absent and the default would be used. Refuse that spelling.
  const prefix = `${key}=`;
  if ([...parsed.flags, ...parsed.values.keys()].some((name) => name.startsWith(prefix))) {
    throw new Error(`--${key}=… の形は使えません。${hint} のように空白で区切ってください。何も変えずに止めました。`);
  }
  return first(parsed, key);
}

/**
 * The login commands act on a saved login, so an argument they do not know must
 * stop them. Ignoring a mistyped `--credntials other.json` would make logout fall
 * back to the default path and delete the default login. Checked before the save
 * path is decided, so nothing is read, removed or sent.
 */
const LOGIN_OPTION_VALUE_HINT: Record<string, string> = {
  credentials: 'path',
  server: 'url',
  tenant: 'tenant',
  scope: 'scope',
  resource: 'url',
};

function assertOnlyLoginOptions(
  parsed: ParsedArgs,
  command: string,
  allowed: readonly string[],
  switches: readonly string[] = [],
): void {
  const hintFor = (key: string) => `--${key} <${LOGIN_OPTION_VALUE_HINT[key] ?? 'value'}>`;
  const usageParts = [
    ...allowed.map((key) => `[${hintFor(key)}]`),
    ...switches.map((key) => `[--${key}]`),
  ];
  const usageHint = `brainbase ${command} ${usageParts.join(' ')}`;
  const stop = (what: string) => new Error(`${what}。${usageHint} の形で指定してください。何も変えずに止めました。`);
  // A known option without a value (or as --opt=value) gets its own, more precise message first.
  for (const key of allowed) explicitValue(parsed, key, hintFor(key));
  for (const key of switches) {
    if (parsed.values.has(key)) {
      throw new Error(`--${key} は値をとりません（--${key} だけを書きます）。何も変えずに止めました。`);
    }
    const prefix = `${key}=`;
    if ([...parsed.flags, ...parsed.values.keys()].some((name) => name.startsWith(prefix))) {
      throw new Error(`--${key}=… の形は使えません。--${key} だけを書いてください。何も変えずに止めました。`);
    }
  }
  for (const name of [...parsed.flags, ...parsed.values.keys()]) {
    // `--known=value` is refused by explicitValue / switches check above with its own message.
    const base = name.includes('=') ? name.slice(0, name.indexOf('=')) : name;
    if (!allowed.includes(base) && !switches.includes(base)) {
      throw stop(`${command} は --${base} というオプションを知りません`);
    }
  }
  for (const [key, list] of parsed.values) {
    if (list.length > 1) throw stop(`--${key} が${list.length}回指定されています。1回だけにしてください`);
  }
  if (parsed.positionals.length > 0) {
    throw stop(`${command} は「${parsed.positionals[0]}」のような引数を取りません`);
  }
}

function credentialsPathOf(parsed: ParsedArgs): string {
  const path = explicitValue(parsed, 'credentials', '--credentials <path>') ?? defaultCredentialsPath();
  assertCredentialsFilePath(path);
  return path;
}

async function login(parsed: ParsedArgs, io: CliIo): Promise<number> {
  assertOnlyLoginOptions(
    parsed,
    'login',
    ['credentials', 'server', 'tenant', 'scope', 'resource'],
    ['mcp'],
  );
  const mcp = parsed.flags.has('mcp');
  const tenant = explicitValue(parsed, 'tenant', '--tenant <tenant>');
  const scope = explicitValue(parsed, 'scope', '--scope <scope>');
  const resource = explicitValue(parsed, 'resource', '--resource <url>');
  if (!mcp && (tenant !== undefined || scope !== undefined || resource !== undefined)) {
    throw new Error('--tenant / --scope / --resource は --mcp と一緒に指定してください。何も変えずに止めました。');
  }
  if (mcp) {
    if (tenant !== undefined) normalizeMcpTenant(tenant);
    if (scope !== undefined) normalizeMcpScope(scope);
    if (resource !== undefined) normalizeMcpResourceUrl(resource);
  }
  const credentialsPath = credentialsPathOf(parsed);
  const serverUrl = explicitValue(parsed, 'server', '--server <url>') ?? (await readCredentials(credentialsPath).catch(() => null))?.server_url;
  if (!serverUrl) throw new Error('login requires --server <url> (your Brainbase API URL)');
  const credentials = await loginWithDeviceCode({
    serverUrl,
    credentialsPath,
    ...(mcp ? {
      mcp: {
        ...(tenant !== undefined ? { tenant } : {}),
        ...(scope !== undefined ? { scope } : {}),
        ...(resource !== undefined ? { resource } : {}),
      },
    } : {}),
    onPrompt: (prompt) => {
      write(io, [
        'ブラウザで次の URL を開き、ログインして承認してください。',
        `  URL: ${prompt.verificationUriComplete ?? prompt.verificationUri}`,
        ...(prompt.userCode ? [`  コード: ${prompt.userCode}`] : []),
        `  期限: ${Math.round(prompt.expiresInSeconds / 60)} 分`,
        '承認を待っています...',
        ''
      ].join('\n'));
    }
  });
  if (credentials.token_kind === 'mcp_oauth') {
    write(io, [
      `遠隔 MCP としてログインしました（${credentials.server_url}）。`,
      ...(credentials.organization_id ? [`  組織: ${credentials.organization_id}`] : []),
      ...(credentials.tenant_id ? [`  テナント: ${credentials.tenant_id}`] : []),
      ...(credentials.scope ? [`  スコープ: ${credentials.scope}`] : []),
      ...(credentials.resource ? [`  接続先 resource: ${credentials.resource}`] : []),
      `  保存先: ${credentialsPath}`,
      ''
    ].join('\n'));
  } else {
    write(io, `ログインしました（${credentials.server_url}）。保存先: ${credentialsPath}\n`);
  }
  return 0;
}

async function loginStatus(parsed: ParsedArgs, io: CliIo): Promise<number> {
  assertOnlyLoginOptions(parsed, 'login:status', ['credentials']);
  const credentialsPath = credentialsPathOf(parsed);
  const credentials = await readCredentials(credentialsPath);
  if (!credentials) {
    write(io, 'ログインしていません。brainbase login --server <url> を実行してください。\n');
    return 1;
  }
  const expired = Date.parse(credentials.expires_at) <= Date.now();
  write(io, [
    `サーバー: ${credentials.server_url}`,
    ...(credentials.token_kind === 'mcp_oauth' ? [
      '接続種別: 遠隔 MCP (OAuth Device Flow)',
      `組織: ${credentials.organization_id ?? '未指定'}`,
      `テナント: ${credentials.tenant_id ?? '未指定'}`,
      `スコープ: ${credentials.scope ?? '未指定'}`,
      `接続先 resource: ${credentials.resource ?? '未指定'}`,
    ] : []),
    `token の期限: ${credentials.expires_at}${expired ? '（切れています）' : ''}`,
    `自動の更新: ${credentials.refresh_token ? 'できる' : 'できない（期限が来たら brainbase login をやり直す）'}`,
    `保存先: ${credentialsPath}`,
    ''
  ].join('\n'));
  return 0;
}

async function logout(parsed: ParsedArgs, io: CliIo): Promise<number> {
  assertOnlyLoginOptions(parsed, 'logout', ['credentials']);
  const credentialsPath = credentialsPathOf(parsed);
  let removed;
  try {
    removed = await removeCredentials(credentialsPath);
  } catch (error) {
    if (error instanceof BrainbaseLoginError) throw error; // login_busy and the like say what to do.
    // The file may be gone in memory but not on disk: do not report a logout.
    const code = (error as NodeJS.ErrnoException)?.code ?? 'error';
    writeError(io, `ログインを消したことを、ディスクに書き切れませんでした（${code}）。brainbase logout をやり直してください。\n`);
    return 1;
  }
  write(io, removed.existed ? `この端末のログインを消しました（${credentialsPath}）。\n` : 'ログインはありませんでした。\n');
  if (!removed.durable) {
    writeError(io, 'この環境ではディレクトリをディスクに書き切れないため、電源が落ちると消したログインが戻ることがあります。\n');
  }
  return 0;
}

// Bytes are joined before decoding, so a character split across chunks stays intact.
export async function readHookStdin(input: AsyncIterable<string | Uint8Array>, maxBytes = Number.POSITIVE_INFINITY): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error('judgment_hook_payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// The real path of a file, or of its nearest existing parent joined with the
// rest, so two spellings of one file (symlinks, `..`) compare equal.
/**
 * Replaces the file at `path` atomically. When `path` is a symbolic link, the
 * file it points to is replaced and the link stays; a link to nothing is
 * refused. A file that exists keeps its mode; a new one gets `mode`.
 *
 * With `expected` (the text read earlier, or null for "did not exist"), the
 * file is only replaced while it still holds that text (swapInIfUnchanged);
 * otherwise a save made since stays and SettingsChangedError is thrown.
 */
async function replaceFileFollowingLinks(path: string, content: string, mode: number, expected?: string | null): Promise<void> {
  let target = resolve(path);
  let targetMode = mode;
  try {
    target = await realpath(target);
    targetMode = (await stat(target)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    const link = await lstat(target).catch(() => null);
    if (link?.isSymbolicLink()) throw new Error(`${path} is a symbolic link to a missing file; nothing was changed`);
    await mkdir(dirname(target), { recursive: true });
  }
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, content, { mode: targetMode, flag: 'wx' });
    await chmod(temporary, targetMode);
    if (expected === undefined) await rename(temporary, target);
    else {
      await swapInIfUnchanged(path, target, temporary, content, expected);
      await rm(temporary, { force: true });
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Puts `temporary` at `target` only when `target` still holds `expected`.
 * Claude Code saves its settings without our lock, and rename() replaces
 * whatever is there, so a check followed by rename() would overwrite a save
 * made in between. Instead the file there is first moved aside (rename is
 * atomic, so exactly the file present at that moment is taken), ours is
 * placed with link(), which never replaces a file, and only then is the
 * file taken out compared. The rule is that a save someone else made always
 * stays: when what was taken out is not what was read, it goes back; when a
 * file appeared at `target` meanwhile, that file stays and ours is dropped.
 * Either way SettingsChangedError is thrown and the caller starts again from
 * the saved file. Nothing here replaces a file that is not ours.
 */
async function swapInIfUnchanged(path: string, target: string, temporary: string, content: string, expected: string | null): Promise<void> {
  const changed = () => new SettingsChangedError(`${path} was saved by someone else while it was being changed; nothing was written over it`);
  const tag = `${process.pid}.${randomBytes(4).toString('hex')}`;
  // A file system without hard links fails here, before the settings are touched.
  const probe = `${temporary}.link`;
  await link(temporary, probe);
  await rm(probe, { force: true });
  const placeOurs = async (): Promise<boolean> => {
    try {
      await link(temporary, target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false;
      throw error;
    }
  };
  if (expected === null) {
    if (!(await placeOurs())) throw changed();
  } else {
    const aside = `${target}.${tag}.brainbase-install-previous`;
    try {
      await rename(target, aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw changed();
      throw error;
    }
    let placed: boolean;
    try {
      placed = await placeOurs();
    } catch (error) {
      await putBackIfFree(aside, target).catch(() => rename(aside, target));
      throw error;
    }
    if (!placed) {
      // Saved while the file was aside: that save is the newest and stays.
      await rm(aside, { force: true });
      throw changed();
    }
    const taken = await readFile(aside, 'utf8');
    if (taken !== expected) {
      // What was taken out is a save made after our read. Take ours out again
      // and give that save back, unless an even newer one has replaced ours.
      const ours = `${target}.${tag}.brainbase-install-ours`;
      await rename(target, ours).catch(() => undefined);
      const back = await readFile(ours, 'utf8').catch(() => null);
      if (back === null || back === content) await putBackIfFree(aside, target);
      else await putBackIfFree(ours, target);
      await rm(ours, { force: true });
      await rm(aside, { force: true });
      throw changed();
    }
    await rm(aside, { force: true });
  }
  // A writer that replaces the file in place right after ours was placed
  // leaves its own text; start again from it so the hooks are not missing.
  if ((await readFile(target, 'utf8').catch(() => null)) !== content) throw changed();
}

/** Puts `from` back at `target` unless a file has appeared there; `from` is then left to the caller. */
async function putBackIfFree(from: string, target: string): Promise<void> {
  try {
    await link(from, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
  }
  await rm(from, { force: true });
}

function textOrJsonFormat(parsed: ParsedArgs, command: string): 'text' | 'json' {
  const format = first(parsed, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') throw new Error(`${command} --format must be text or json`);
  return format;
}

async function memoryList(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = textOrJsonFormat(parsed, 'memory:list');
  const memories = await listLocalMemories(first(parsed, 'dir'));
  write(io, format === 'json' ? `${JSON.stringify(memoryListJson(memories), null, 2)}\n` : renderMemoryList(memories));
  return 0;
}

async function memoryRegister(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = textOrJsonFormat(parsed, 'memory:register');
  const ids = parsed.values.get('id') ?? [];
  if (ids.length === 0) throw new Error('memory:register requires at least one --id <id> (see brainbase memory:list)');
  const dataDir = first(parsed, 'dir');
  if (!parsed.flags.has('write')) {
    const selected = selectLocalMemories(await listLocalMemories(dataDir), ids);
    write(io, format === 'json' ? `${JSON.stringify(registrationPreviewJson(selected), null, 2)}\n` : renderRegistrationPreview(selected));
    return 0;
  }
  const config = createOrganizationGraphConfig();
  if (!config) throw new Error('memory:register --write requires all BRAINBASE_ORGANIZATION_* settings; nothing was sent');
  const result = await registerSelectedMemories({ dataDir, ids, organization: { url: config.url, token: config.token } });
  write(io, format === 'json' ? `${JSON.stringify({ status: 'registered', ...result }, null, 2)}\n` : renderRegistrationResult(result));
  return 0;
}

async function onboardInit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  write(io, `Initialized Brainbase Personal OS at ${dataDir}\n`);
  return 0;
}

async function onboardSeed(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const name = first(parsed, 'name');
  const encodedRelationships = parsed.values.get('relationship') ?? [];
  for (const encoded of encodedRelationships) {
    const [person, , context] = encoded.split('|').map((part) => part.trim());
    if (!person || !context) {
      throw new Error([
        '関係者の形式が正しくありません。',
        '形式: "人|役割|覚えておく文脈"',
        '例: "田中|責任者|Atlas導入の最終判断を担当"',
        '保存内容は変更していません。',
        `再実行: ${seedRetryCommand(parsed, dataDir, encoded)}`
      ].join('\n'));
    }
  }
  await initializePersonalOs(dataDir);
  const hasSeedValues = Boolean(name)
    || ['value', 'project', 'decision-principle', 'relationship'].some((key) => (parsed.values.get(key)?.length ?? 0) > 0);
  if (!parsed.flags.has('non-interactive') && !hasSeedValues) {
    write(io, 'No seed values provided. Use --name, --value, --project, --decision-principle, or --relationship.\n');
    return 1;
  }

  await mutatePersonalOs(dataDir, (os) => {
    const now = new Date().toISOString();
    const personalEntries: PersonalKgEntry[] = [...os.personalKg];
    const decisions: DecisionRecord[] = [...os.decisions];
    const relationships: RelationshipRecord[] = [...os.relationships.relationships];
    const canonicalEntities: CanonicalEntity[] = [];

    if (name) {
      canonicalEntities.push({
        id: 'self',
        type: 'person',
        name,
        summary: 'このPersonal OSの本人。',
        tags: ['self']
      });
      upsertById(personalEntries, {
        id: `self-${hash(name)}`,
        type: 'self',
        text: `私は${name}です。`,
        tags: ['self'],
        updatedAt: now
      });
    }

    for (const value of parsed.values.get('value') ?? []) {
      upsertById(personalEntries, {
        id: `value-${hash(value)}`,
        type: 'value',
        text: value,
        tags: ['onboarding'],
        updatedAt: now
      });
    }

    for (const project of parsed.values.get('project') ?? []) {
      canonicalEntities.push({
        id: `project-${hash(project)}`,
        type: 'project',
        name: project,
        summary: '現在取り組んでいるプロジェクト。',
        tags: ['work']
      });
      upsertById(personalEntries, {
        id: `work-${hash(project)}`,
        type: 'work',
        text: project,
        tags: ['work'],
        updatedAt: now
      });
    }

    for (const value of parsed.values.get('decision-principle') ?? []) {
      const decision = {
        id: `decision-${hash(value)}`,
        title: 'オンボーディングで登録した判断基準',
        decision: value,
        tags: ['principle', 'onboarding'],
        updatedAt: now
      };
      upsertById(decisions, decision);
      canonicalEntities.push({
        id: decision.id,
        type: 'decision',
        name: decision.title,
        summary: decision.decision,
        tags: decision.tags
      });
    }

    for (const encoded of encodedRelationships) {
      const [person, role, context] = encoded.split('|').map((part) => part.trim());
      upsertById(relationships, {
        id: `relationship-${hash(encoded)}`,
        person,
        role: role || undefined,
        context,
        tags: ['relationship'],
        updatedAt: now
      });
      canonicalEntities.push({
        id: `person-${hash(person)}`,
        type: 'person',
        name: person,
        summary: context,
        tags: ['relationship']
      });
    }

    const projects = (parsed.values.get('project') ?? []).map((project) => ({
      id: `project-${hash(project)}`,
      name: project
    }));
    const people = encodedRelationships.map((encoded) => {
      const [person, role, context] = encoded.split('|').map((part) => part.trim());
      return {
        id: `person-${hash(person)}`,
        relationshipId: `relationship-${hash(encoded)}`,
        role: role || undefined,
        context
      };
    });
    const seedDecisions = (parsed.values.get('decision-principle') ?? []).map((decision) => ({
      id: `decision-${hash(decision)}`,
      decision
    }));
    const canonicalEdges = projects.flatMap((project) => [
      ...(name ? [buildCanonicalEdge({
        fromId: 'self',
        relation: 'participates_in',
        toId: project.id,
        context: 'Registered together during onboarding.',
        provenance: { sourceKind: 'onboarding' as const, sourceId: project.id }
      })] : []),
      ...people.map((person) => buildCanonicalEdge({
        fromId: person.id,
        relation: 'participates_in',
        toId: project.id,
        role: person.role,
        context: person.context,
        provenance: { sourceKind: 'onboarding' as const, sourceId: person.relationshipId }
      })),
      ...seedDecisions.map((decision) => buildCanonicalEdge({
        fromId: decision.id,
        relation: 'governs',
        toId: project.id,
        context: decision.decision,
        provenance: { sourceKind: 'onboarding' as const, sourceId: decision.id }
      }))
    ]);
    const graph = applyCanonicalWrites(os.graph, { entities: canonicalEntities, edges: canonicalEdges });

    return proposedPersonalOs(os, {
      graph: {
        ...graph,
        owner: { ...graph.owner, ...(name ? { id: 'self', name } : {}) }
      },
      relationships: { version: 1, relationships },
      personalKg: personalEntries,
      decisions
    });
  });
  const summary = [
    `Brainbaseへ保存しました: ${dataDir}`,
    ...(name ? [`- 本人: ${name}`] : []),
    ...(parsed.values.get('value') ?? []).map((value) => `- 価値観: ${value}`),
    ...(parsed.values.get('project') ?? []).map((project) => `- プロジェクト: ${project}`),
    ...encodedRelationships.map((encoded) => {
      const [person, role] = encoded.split('|').map((part) => part.trim());
      return `- 関係者: ${person}${role ? `（${role}）` : ''}`;
    }),
    ...(parsed.values.get('decision-principle') ?? []).map((value) => `- 判断基準: ${value}`),
    '- 同じ文脈は更新しました。既存の別データは削除していません。',
    '',
    '次に実行:',
    `brainbase onboard:install --target codex --dir ${shellArg(dataDir)} --dry-run`,
    '設定を承認・反映してエージェントを再起動した後、実際の依頼でBrainbaseのresolve_entity、get_context、searchを使います。',
    ''
  ];
  write(io, summary.join('\n'));
  return 0;
}

function seedRetryCommand(parsed: ParsedArgs, dataDir: string, invalidRelationship: string): string {
  const args = ['brainbase', 'onboard:seed', '--dir', dataDir];
  const append = (flag: string, value: string | undefined): void => {
    if (value) args.push(flag, value);
  };
  append('--name', first(parsed, 'name'));
  append('--value', first(parsed, 'value'));
  append('--project', first(parsed, 'project'));
  append('--decision-principle', first(parsed, 'decision-principle'));
  for (const relationship of parsed.values.get('relationship') ?? []) {
    if (relationship !== invalidRelationship) append('--relationship', relationship);
  }
  append('--relationship', '田中|責任者|Atlas導入の最終判断を担当');
  return args.map(shellArg).join(' ');
}

async function onboardInstall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const target = first(parsed, 'target');
  if (!isInstallTarget(target)) {
    throw new Error('onboard:install requires --target codex|claude|codecode');
  }

  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const payload = buildInstallPayload(target, dataDir);
  const outputPath = first(parsed, 'output');

  if (parsed.flags.has('dry-run') || !outputPath) {
    write(io, payload);
    return 0;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeConfigSnippet(outputPath, payload);
  write(io, `Wrote ${target} MCP config to ${outputPath}\n`);
  return 0;
}

async function onboardAgent(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderAgentProtocol(format));
  return 0;
}

async function onboardStart(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseGuidedTarget(first(parsed, 'target'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const os = await loadPersonalOs(dataDir);
  const status = onboardingStatus(os);
  const missing = Array.isArray(status.missing)
    ? status.missing.filter((item): item is string => typeof item === 'string')
    : [];
  const explicitGogCommand = first(parsed, 'gog-command');
  const gogCommand = explicitGogCommand ?? 'gog';
  const gogAvailable = parsed.flags.has('assume-gog') || await commandExists(gogCommand);
  const projectName = first(parsed, 'project') ?? first(parsed, 'project-name');
  const project = projectName ? {
    name: projectName,
    goal: first(parsed, 'goal'),
    status: first(parsed, 'status'),
    role: first(parsed, 'role'),
    stakeholders: (parsed.values.get('stakeholder') ?? []).map(parseProjectStakeholder),
    sources: (parsed.values.get('source') ?? []).map(parseProjectSource),
    taskSources: parsed.values.get('task-source') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? []
  } : undefined;

  write(io, renderGuidedFirstRun({
    dataDir,
    target,
    profile: first(parsed, 'profile'),
    host: first(parsed, 'host'),
    name: first(parsed, 'name'),
    value: parsed.values.get('value') ?? [],
    email: first(parsed, 'email'),
    secondaryEmails: parsed.values.get('secondary-email') ?? [],
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    driveFolders: parsed.values.get('drive-folder') ?? [],
    localFolders: parsed.values.get('local-folder') ?? [],
    tasks: first(parsed, 'tasks'),
    inactiveTaskTools: parsed.values.get('inactive-task-tool') ?? [],
    gogCommand: explicitGogCommand,
    assumeGog: parsed.flags.has('assume-gog'),
    gogAvailable,
    project,
    connected: readLocalBackendConnected(status),
    missing
  }, format, parsed.flags.has('details')));
  return 0;
}

async function onboardDemo(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const os = await loadPersonalOs(dataDir);
  const demo = buildValueDemo({ os, scenario: first(parsed, 'scenario') });
  write(io, renderValueDemo({ os, scenario: first(parsed, 'scenario') }, format, parsed.flags.has('details')));
  return demo.ready ? 0 : 1;
}

async function onboardRecommend(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderConnectorRecommendations({
    email: first(parsed, 'email'),
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    tasks: first(parsed, 'tasks')
  }, format));
  return 0;
}

async function onboardDiagnoseSources(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const gogCommand = first(parsed, 'gog-command') ?? 'gog';
  const gogAvailable = parsed.flags.has('assume-gog') || await commandExists(gogCommand);
  write(io, renderSourceDiagnosis({
    dataDir,
    email: first(parsed, 'email'),
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    tasks: first(parsed, 'tasks'),
    gogCommand,
    gogAvailable,
    driveFolders: parsed.values.get('drive-folder') ?? []
  }, format));
  return 0;
}

async function onboardPlan(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  write(io, renderLocalOnboardingPlan({
    profile: first(parsed, 'profile'),
    host: first(parsed, 'host'),
    email: first(parsed, 'email'),
    secondaryEmails: parsed.values.get('secondary-email') ?? [],
    calendar: first(parsed, 'calendar'),
    drive: first(parsed, 'drive'),
    driveFolders: parsed.values.get('drive-folder') ?? [],
    localFolders: parsed.values.get('local-folder') ?? [],
    tasks: first(parsed, 'tasks'),
    inactiveTaskTools: parsed.values.get('inactive-task-tool') ?? []
  }, format));
  return 0;
}

async function onboardCandidates(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);
  const input = {
    dataDir,
    name: first(parsed, 'name'),
    values: parsed.values.get('value') ?? [],
    projects: parsed.values.get('project') ?? [],
    relationships: parsed.values.get('relationship') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? [],
    now: new Date().toISOString()
  };
  const candidateSet = buildCandidateDrafts(input);
  if (candidateSet.candidates.length === 0 && !parsed.flags.has('non-interactive')) {
    write(io, 'No candidate values provided. Use --name, --value, --project, --decision-principle, or --relationship.\n');
    return 1;
  }
  if (parsed.flags.has('write')) {
    await mkdir(dirname(candidateSet.candidatePath), { recursive: true });
    await writeFile(candidateSet.candidatePath, `${JSON.stringify(candidateSet, null, 2)}\n`, { flag: 'wx' });
  }
  write(io, renderCandidateDrafts(input, format));
  if (parsed.flags.has('write')) {
    write(io, format === 'json' ? '' : `Wrote candidate file: ${candidateSet.candidatePath}\n`);
  }
  return 0;
}

async function onboardProjects(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const name = first(parsed, 'name');
  if (!name) {
    throw new Error('onboard:projects requires --name <project-name>');
  }
  const plan = buildProjectRegistrationPlan({
    name,
    goal: first(parsed, 'goal'),
    status: first(parsed, 'status'),
    role: first(parsed, 'role'),
    stakeholders: (parsed.values.get('stakeholder') ?? []).map(parseProjectStakeholder),
    sources: (parsed.values.get('source') ?? []).map(parseProjectSource),
    taskSources: parsed.values.get('task-source') ?? [],
    decisionPrinciples: parsed.values.get('decision-principle') ?? [],
    now: parsed.flags.has('write') ? new Date().toISOString() : undefined
  });

  const willWrite = parsed.flags.has('write');
  if (willWrite) {
    await applyProjectRegistrationPlan(dataDir, plan);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ ...plan, canonicalWrites: willWrite, dataDir }, null, 2)}\n`);
  } else {
    write(io, renderProjectRegistrationMarkdown(plan, willWrite, dataDir));
  }
  return 0;
}

async function applyProjectRegistrationPlan(dataDir: string, plan: ProjectRegistrationPlan): Promise<void> {
  await mutatePersonalOs(dataDir, (os) => {
    const graph = applyCanonicalWrites(os.graph, {
      entities: plan.writes.canonicalEntities,
      edges: plan.writes.canonicalEdges
    });
    const relationships = [...os.relationships.relationships];
    for (const relationship of plan.writes.relationships) {
      upsertById(relationships, relationship);
    }
    const personalKg = [...os.personalKg];
    for (const entry of plan.writes.personalKg) {
      upsertById(personalKg, entry);
    }
    const decisions = [...os.decisions];
    for (const decision of plan.writes.decisions) {
      upsertById(decisions, decision);
    }
    return proposedPersonalOs(os, {
      graph,
      relationships: { version: 1, relationships },
      personalKg,
      decisions
    });
  });
}

async function onboardImport(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const provider = parseProvider(first(parsed, 'source'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const fromPath = first(parsed, 'from');
  if (!fromPath) {
    throw new Error('onboard:import requires --from <file|-> with collected provider JSON.');
  }
  const rawText = await readInput(fromPath, io);
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`onboard:import expected JSON from ${fromPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const records = normalizeSource(provider, raw, { includeDescriptions: parsed.flags.has('include-descriptions') });
  const relativePath = first(parsed, 'out') ?? sourcePathFor(provider);
  const outPath = isAbsolute(relativePath) ? relativePath : join(dataDir, relativePath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderSourceJsonl(records));

  if (format === 'json') {
    write(io, `${JSON.stringify({ provider, sourcePath: outPath, count: records.length }, null, 2)}\n`);
  } else {
    write(io, `Imported ${records.length} ${provider} record(s) (metadata-first) to ${outPath}\n`);
  }
  return 0;
}

async function onboardExtract(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const records = await readSourceRecords(dataDir);
  const candidates = extractCandidates(records, {
    selfEmails: parsed.values.get('self-email') ?? [],
    topRelationships: numberOption(first(parsed, 'top-relationships'))
  });
  const candidateSet = buildExtractedCandidateSet(candidates, dataDir);

  if (records.length === 0) {
    write(io, format === 'json'
      ? `${JSON.stringify(candidateSet, null, 2)}\n`
      : 'No source records found. Run onboard:import first.\n');
    return records.length === 0 && !parsed.flags.has('write') ? 1 : 0;
  }

  if (parsed.flags.has('write')) {
    await mkdir(dirname(candidateSet.candidatePath), { recursive: true });
    await writeFile(candidateSet.candidatePath, `${JSON.stringify(candidateSet, null, 2)}\n`);
  }

  write(io, format === 'json' ? `${JSON.stringify(candidateSet, null, 2)}\n` : renderExtractedSet(candidateSet));
  if (parsed.flags.has('write') && format !== 'json') {
    write(io, `Wrote extracted candidate file: ${candidateSet.candidatePath}\n`);
  }
  return 0;
}

async function onboardApply(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  await initializePersonalOs(dataDir);

  const fromPath = first(parsed, 'from');
  if (!fromPath) {
    throw new Error('onboard:apply requires --from <candidate-file>.');
  }
  const raw = JSON.parse(await readInput(fromPath, io));
  const candidates = loadApplyCandidates(raw);
  const selectedIds = new Set(parsed.values.get('select') ?? []);
  const all = parsed.flags.has('all');
  if (!all && selectedIds.size === 0) {
    throw new Error('onboard:apply requires --select <id> (repeatable) or --all to choose which candidates to promote.');
  }

  const now = new Date().toISOString();
  const willWrite = parsed.flags.has('write');
  let result: ApplyResult | undefined;
  if (willWrite) {
    await mutatePersonalOs(dataDir, (os) => {
      if (os.graph.version !== 2) {
        throw new Error('migration_required: Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing');
      }
      result = planApply(candidates, { ids: selectedIds, all }, {
        graphEntities: [...os.graph.entities],
        graphEdges: [...os.graph.edges],
        relationships: [...os.relationships.relationships],
        personalKg: os.personalKg,
        decisions: os.decisions,
        ownerName: os.graph.owner?.name
      }, now);
      const personalKg = [...os.personalKg];
      for (const entry of result.personalKgAdditions) upsertById(personalKg, entry);
      const decisions = [...os.decisions];
      for (const decision of result.decisionAdditions) upsertById(decisions, decision);
      const graph = applyCanonicalWrites(os.graph, result.canonicalWrites);
      return proposedPersonalOs(os, {
        graph: { ...graph, owner: result.ownerName ? { ...graph.owner, name: result.ownerName } : graph.owner },
        relationships: { version: 1, relationships: result.relationships },
        personalKg,
        decisions
      });
    });
  } else {
    const os = await loadPersonalOs(dataDir);
    if (os.graph.version !== 2) {
      throw new Error('migration_required: Graph v1 cannot store canonical ID edges; migrate graph.json to Graph v2 before writing');
    }
    result = planApply(candidates, { ids: selectedIds, all }, {
      graphEntities: [...os.graph.entities],
      graphEdges: [...os.graph.edges],
      relationships: [...os.relationships.relationships],
      personalKg: os.personalKg,
      decisions: os.decisions,
      ownerName: os.graph.owner?.name
    }, now);
  }

  if (!result) {
    throw new Error('Failed to compute onboarding apply result.');
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ applied: result.applied, skipped: result.skipped, canonicalWrites: willWrite, dataDir }, null, 2)}\n`);
  } else {
    write(io, renderApplyResult(result, willWrite, dataDir));
  }
  return 0;
}

async function readInput(fromPath: string, io: CliIo): Promise<string> {
  if (fromPath === '-') {
    return readStdin();
  }
  return readFile(fromPath, 'utf8');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readSourceRecords(dataDir: string): Promise<SourceRecord[]> {
  const relativePaths = ['sources/gmail/threads.jsonl', 'sources/calendar/events.jsonl', 'sources/drive/files.jsonl', 'sources/drive/local-files.jsonl'];
  const records: SourceRecord[] = [];
  for (const relativePath of relativePaths) {
    let content = '';
    try {
      content = await readFile(join(dataDir, relativePath), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n').map((row) => row.trim()).filter(Boolean)) {
      try {
        records.push(JSON.parse(line) as SourceRecord);
      } catch {
        // Skip malformed source lines; sources are secondary material.
      }
    }
  }
  return records;
}

function renderExtractedSet(set: ExtractedCandidateSet): string {
  const lines: string[] = ['# Brainbase Extracted Candidates', '', set.goal, ''];
  lines.push(`- Candidate path: \`${set.candidatePath}\``);
  lines.push(`- Counts: person ${set.counts.person}, org ${set.counts.org}, project ${set.counts.project}, relationship ${set.counts.relationship}, next_action ${set.counts.next_action}`);
  lines.push('', '## Candidates');
  for (const candidate of set.candidates) {
    const label = candidate.payload.name ?? candidate.payload.person ?? candidate.payload.text ?? candidate.id;
    lines.push(`- [${candidate.kind}] ${candidate.id}: ${String(label)} (count ${candidate.provenance.count}, sources ${candidate.provenance.sources.join('/')})`);
  }
  lines.push('', '## Safety Rules');
  for (const rule of set.safetyRules) {
    lines.push(`- ${rule}`);
  }
  lines.push('', '## Next Commands');
  for (const command of set.nextCommands) {
    lines.push(`- ${command}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderApplyResult(result: ApplyResult, wrote: boolean, dataDir: string): string {
  const lines: string[] = ['# Brainbase Apply', ''];
  lines.push(`- Canonical writes: ${wrote}`);
  lines.push(`- Data dir: ${dataDir}`);
  lines.push('', '## Applied');
  if (result.applied.length === 0) {
    lines.push('- (none)');
  }
  for (const item of result.applied) {
    lines.push(`- [${item.kind}] ${item.id}: ${item.summary}`);
  }
  lines.push('', '## Skipped');
  if (result.skipped.length === 0) {
    lines.push('- (none)');
  }
  for (const item of result.skipped) {
    lines.push(`- ${item.id}: ${item.reason}`);
  }
  if (!wrote) {
    lines.push('', 'Dry-run only. Re-run with --write to promote selected candidates into canonical SSOT.');
  }
  return `${lines.join('\n')}\n`;
}

function numberOption(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function onboardRoutines(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseRoutineTarget(first(parsed, 'target'));
  const kinds = parseRoutineKinds(first(parsed, 'routines'));
  const cwd = first(parsed, 'cwd') ?? process.cwd();
  const definitions = buildRoutines(kinds, {
    ohayoHour: numberOption(first(parsed, 'ohayo-hour')),
    ohayoMinute: numberOption(first(parsed, 'ohayo-minute')),
    oyasumiHour: numberOption(first(parsed, 'oyasumi-hour')),
    oyasumiMinute: numberOption(first(parsed, 'oyasumi-minute')),
    retroDow: first(parsed, 'retro-dow'),
    retroHour: numberOption(first(parsed, 'retro-hour')),
    retroMinute: numberOption(first(parsed, 'retro-minute'))
  });

  const payload = target === 'codex'
    ? renderCodexAutomations(definitions, cwd, first(parsed, 'model') ?? 'gpt-5')
    : `${JSON.stringify(buildClaudeScheduledTasks(definitions, cwd), null, 2)}\n`;

  const outPath = first(parsed, 'out');
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeConfigSnippet(outPath, payload);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ target, cwd, outPath: outPath ?? null, routines: definitions }, null, 2)}\n`);
  } else {
    write(io, renderRoutinesMarkdown(definitions, target, payload, outPath));
  }
  return 0;
}

function renderRoutinesMarkdown(definitions: RoutineDefinition[], target: string, payload: string, outPath?: string): string {
  const lines: string[] = ['# Brainbase Personal Routines', ''];
  lines.push(`- Target agent: ${target}`);
  lines.push(`- Routines: ${definitions.map((definition) => definition.kind).join(', ')}`);
  lines.push('- Generation only: this prints a definition; it does not register with any live scheduler.');
  lines.push('', '## Schedule');
  for (const definition of definitions) {
    const when = definition.schedule.freq === 'weekly'
      ? `weekly ${definition.schedule.dayOfWeek} ${pad(definition.schedule.hour)}:${pad(definition.schedule.minute)}`
      : `daily ${pad(definition.schedule.hour)}:${pad(definition.schedule.minute)}`;
    lines.push(`- ${definition.kind}: ${when} (rrule \`${definition.rrule}\`, cron \`${definition.cron}\`)`);
  }
  lines.push('', `## ${target === 'codex' ? 'automation.toml' : 'scheduled-tasks.json'}`, '', '```', payload.trimEnd(), '```');
  lines.push('', '## Register');
  if (target === 'codex') {
    lines.push('- Save each per-file TOML document as ~/.codex/automations/<id>/automation.toml on your agent host, or import it through your Codex automation UI.');
  } else {
    lines.push('- Register each scheduled task with your Claude Code scheduler (for example the /schedule command) using its cron and prompt.');
  }
  lines.push('- Routines run against your local Brainbase MCP context; keep external side effects confirmation-gated.');
  if (outPath) {
    lines.push(`- Wrote routine definition to ${outPath}`);
  }
  return `${lines.join('\n')}\n`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

async function onboardSkills(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const format = parseOnboardingFormat(first(parsed, 'format'));
  const target = parseSkillTarget(first(parsed, 'target'));
  const ids = parseSkillIds(first(parsed, 'skills'));
  const bundle = buildSkillBundle(target, ids);
  assertPublicSafeSkillBundle(bundle);

  const outDir = first(parsed, 'out');
  if (outDir) {
    await writeSkillBundle(outDir, bundle);
  }

  if (format === 'json') {
    write(io, `${JSON.stringify({ ...bundle, outDir: outDir ?? null }, null, 2)}\n`);
  } else {
    write(io, renderSkillsMarkdown(bundle, outDir));
  }
  return 0;
}

async function writeSkillBundle(outDir: string, bundle: SkillBundle): Promise<void> {
  for (const skill of bundle.skills) {
    const outputPath = join(outDir, skill.relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    try {
      await writeFile(outputPath, skill.content, { flag: 'wx' });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing skill file ${outputPath}. Choose a new --out directory or remove the old file first.`);
      }
      throw error;
    }
  }
}

function isInstallTarget(value: string | undefined): value is InstallTarget {
  return value === 'codex' || value === 'claude' || value === 'codecode';
}

function parseGuidedTarget(value: string | undefined): GuidedTarget {
  if (!value || value === 'codex') {
    return 'codex';
  }
  if (value === 'claude' || value === 'codecode') {
    return value;
  }
  throw new Error('onboard:start requires --target codex|claude|codecode');
}

function buildInstallPayload(target: InstallTarget, dataDir: string): string {
  const server = {
    command: process.execPath,
    args: [fileURLToPath(new URL('./index.js', import.meta.url))],
    env: {
      BRAINBASE_PERSONAL_OS_DIR: dataDir
    }
  };

  if (target === 'codex') {
    return [
      '[mcp_servers.brainbase]',
      `command = ${tomlString(server.command)}`,
      `args = [${server.args.map(tomlString).join(', ')}]`,
      '',
      '[mcp_servers.brainbase.env]',
      `BRAINBASE_PERSONAL_OS_DIR = ${tomlString(dataDir)}`,
      ''
    ].join('\n');
  }

  return `${JSON.stringify({ mcpServers: { brainbase: server } }, null, 2)}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function writeConfigSnippet(outputPath: string, payload: string): Promise<void> {
  try {
    await writeFile(outputPath, payload, { flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing MCP config snippet ${outputPath}. Choose a new --output path or remove the old snippet first.`);
    }
    throw error;
  }
}

async function doctor(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const graphDiagnosis = await diagnoseGraph(dataDir);
  let status: Record<string, unknown>;
  try {
    status = onboardingStatus(await loadPersonalOs(dataDir));
  } catch (error) {
    write(io, `${JSON.stringify({
      graphDiagnosis,
      localBackend: { connected: false, backend: 'local' },
      issue: error instanceof Error ? error.message : String(error)
    }, null, 2)}\n`);
    return graphDiagnosisExitCode(graphDiagnosis.status) || 1;
  }
  const judgmentHooksPath = first(parsed, 'judgment-hooks');
  if (!judgmentHooksPath) {
    write(io, `${JSON.stringify({ ...status, graphDiagnosis }, null, 2)}\n`);
    return graphDiagnosisExitCode(graphDiagnosis.status);
  }
  const config = JSON.parse(await readFile(judgmentHooksPath, 'utf8')) as Record<string, unknown>;
  const hooks = config.hooks as Record<string, unknown> | undefined;
  const requiredEvents = ['UserPromptSubmit', 'PostToolUse', 'Stop'];
  const valid = Boolean(hooks) && requiredEvents.every((eventName) => {
    const bindings = hooks?.[eventName];
    return Array.isArray(bindings) && bindings.some((binding) => {
      const commands = (binding as { hooks?: unknown }).hooks;
      return Array.isArray(commands) && commands.some((command) => (
        typeof (command as { command?: unknown }).command === 'string'
        && (command as { command: string }).command.includes('judgment:hook')
      ));
    });
  });
  if (!valid) throw new Error('judgment_hooks_invalid');
  write(io, `${JSON.stringify({
    ...status,
    graphDiagnosis,
    judgment_hooks: { status: 'ready', events: requiredEvents, source: judgmentHooksPath }
  }, null, 2)}\n`);
  return graphDiagnosisExitCode(graphDiagnosis.status);
}

function graphDiagnosisExitCode(status: GraphDiagnosis['status']): number {
  return status === 'invalid' || status === 'unavailable' || status === 'migration_required' ? 1 : 0;
}

async function webServe(parsed: ParsedArgs, io: CliIo, command: string): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const journalRoot = first(parsed, 'journal')
    ?? process.env.BRAINBASE_JUDGMENT_JOURNAL_DIR
    ?? defaultJudgmentJournalRoot(dataDir);
  const port = Number(first(parsed, 'port') ?? String(LOCAL_WEB_DEFAULT_PORT));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${command} requires --port to be an integer between 0 and 65535`);
  }
  // World view (ledger P17): the businesses as a city above the home. Off unless the flag is given.
  const world = parsed.flags.has('world');
  // The owner's words for project kinds and statuses (labels, buildings, lifecycle phases).
  const worldVocabularyPath = first(parsed, 'world-vocabulary');
  if (worldVocabularyPath !== undefined && !world) throw new Error(`${command} --world-vocabulary requires --world`);
  const worldVocabulary = worldVocabularyPath === undefined ? undefined : await readWorldVocabulary(resolve(worldVocabularyPath));
  // The organization Graph is shown by the organization web, not by this local host (C1 ended 2026-10-05).
  for (const removed of ['organization-graph', 'organization-web']) {
    if (parsed.flags.has(removed) || first(parsed, removed) !== undefined) {
      throw new Error(`${command} --${removed} was removed; open the organization web to see the organization Graph`);
    }
  }
  const { server } = createLocalWebHost({
    dataDir,
    journalRoot,
    extensions: world ? [createWorldExtension(worldVocabulary ? { vocabulary: worldVocabulary } : {})] : []
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const origin = `http://127.0.0.1:${actualPort}`;
  write(io, [
    `Brainbase: ${origin}/`,
    `- 判断の履歴: ${origin}/#value-proofs`,
    `- 目的と現状: ${origin}/#objectives`,
    `- プロジェクトと関係者: ${origin}/#projects`,
    `- 情報と関係: ${origin}/#graph`,
    ...(world ? [`- 世界: ${origin}/#world`] : []),
    `データ: ${dataDir}`,
    `判断journal: ${journalRoot}`,
    '終了: Ctrl+C',
    ''
  ].join('\n'));
  await new Promise<void>((resolveClose) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      io.signal?.removeEventListener('abort', stop);
      server.close(() => resolveClose());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (io.signal?.aborted) stop();
    else io.signal?.addEventListener('abort', stop, { once: true });
  });
  return 0;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [firstToken, ...remaining] = argv;
  const command = firstToken?.startsWith('--') ? undefined : firstToken;
  const rest = command ? remaining : argv;
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith('--')) {
      if (token !== undefined) positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), next]);
    index += 1;
  }

  return {
    command,
    values,
    flags,
    positionals
  };
}

function first(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.values.get(key)?.[0];
}

function readLocalBackendConnected(status: Record<string, unknown>): boolean {
  const localBackend = status.localBackend;
  return typeof localBackend === 'object'
    && localBackend !== null
    && 'connected' in localBackend
    && localBackend.connected === true;
}

async function commandExists(command: string): Promise<boolean> {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, command));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue checking PATH candidates.
    }
  }
  return false;
}

function upsertById<T extends { id: string }>(entries: T[], entry: T): void {
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.push(entry);
  }
}

function hash(value: string): string {
  let hashValue = 0;
  for (const char of value) {
    hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hashValue).toString(36);
}

function write(io: CliIo, text: string): void {
  io.stdout?.write(text);
}

function writeError(io: CliIo, text: string): void {
  io.stderr?.write(text);
}

async function ontologyAudit(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const requestedVersion = first(parsed, 'ontology-version');
  const ontologyVersion = requestedVersion === undefined
    ? undefined
    : resolveOntologyVersion(requestedVersion);
  const result = await auditPersonalOsDirectory(dataDir, { ontologyVersion });
  write(io, `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'unverified') {
    return 1;
  }
  return result.violations.some((violation) => violation.severity === 'error') ? 1 : 0;
}

async function ontologyMigrate(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(first(parsed, 'dir'));
  const result = await migrateCanonicalGraph(dataDir, {
    write: parsed.flags.has('write'),
    expectedInputDigest: first(parsed, 'expected-input-digest')
  });
  write(io, `${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'blocked' ? 1 : 0;
}

function proposedPersonalOs(
  os: PersonalOs,
  proposed: Pick<PersonalOs, 'graph' | 'relationships' | 'personalKg' | 'decisions'>
): PersonalOs {
  return { ...os, ...proposed };
}

function usage(): string {
  return `初回価値まで（5ステップ）:
  1. brainbase onboard:start --target codex
  2. 表示された brainbase onboard:seed を確認して実行
  3. brainbase onboard:install --target codex --dry-run
  4. 設定を承認・反映し、Codexを再起動
  5. 新しいエージェントで実際の依頼を送り、役立ったか本人が判断

使い方:
  brainbase-mcp
  brainbase mcp
  brainbase onboard:init [--dir path]
  brainbase onboard:seed [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"]
  brainbase onboard:install --target codex|claude|codecode [--dir path] [--dry-run] [--output path]
  brainbase onboard:agent [--format markdown|json]
  brainbase onboard:start [--target codex|claude|codecode] [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--goal value] [--status value] [--role value] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--local-folder path] [--tasks value] [--format markdown|json] [--details]
  brainbase onboard:demo [--dir path] [--scenario value] [--format markdown|json] [--details]
  brainbase onboard:recommend [--email value] [--calendar value] [--drive value] [--tasks value] [--format markdown|json]
  brainbase onboard:diagnose-sources [--dir path] [--email value] [--calendar value] [--drive value] [--drive-folder id] [--tasks value] [--assume-gog] [--gog-command command] [--format markdown|json]
  brainbase onboard:plan [--profile google-workspace-local] [--host value] [--email value] [--secondary-email value] [--calendar value] [--drive value] [--drive-folder id] [--local-folder path] [--tasks value] [--inactive-task-tool value] [--format markdown|json]
  brainbase onboard:projects --name value [--goal value] [--status value] [--role value] [--stakeholder "person|role|context"] [--source "area|label|ref"] [--task-source value] [--decision-principle value] [--write] [--dir path] [--format markdown|json]
  brainbase onboard:candidates [--dir path] [--name value] [--value value] [--project value] [--decision-principle value] [--relationship "person|role|context"] [--write] [--format markdown|json]
  brainbase onboard:import --source gmail|calendar|drive|local --from path|- [--dir path] [--out path] [--include-descriptions] [--format markdown|json]
  brainbase onboard:extract [--dir path] [--self-email value] [--top-relationships n] [--write] [--format markdown|json]
  brainbase onboard:apply --from path [--select id] [--all] [--write] [--dir path] [--format markdown|json]
  brainbase onboard:routines --target codex|claude [--routines ohayo,oyasumi,retro] [--ohayo-hour n] [--oyasumi-hour n] [--retro-dow MON-SUN] [--retro-hour n] [--cwd path] [--out path] [--format markdown|json]
  brainbase onboard:skills --target codex|claude|portable [--skills id,id] [--out dir] [--format markdown|json]
  brainbase ontology:show
  brainbase ontology:audit [--dir path] [--ontology-version 0.0.0|1.0.0|2.0.0]
  brainbase graph:upgrade [--dir path]
  brainbase graph:bundles [--format text|json]
  brainbase memory:list [--dir path] [--format text|json]
  brainbase memory:register --id id [--id id...] [--dir path] [--write] [--format text|json]
  brainbase ontology:migrate [--dir path] [--write --expected-input-digest digest]
  brainbase judgment:install --target codex [--autonomy-mode off|canary|on] [--autonomy-project code] [--reasoning-gate-mode off|compact_4block_v3|compact_4block_with_wm] [--reasoning-gate-projects code,code] [--dry-run] [--output path]
  brainbase judgment:install --target claude-code --origin url [--server url] [--project code] [--repositories name,name] [--settings path] [--config path] [--dry-run] [--remove]
  brainbase judgment:install --target antigravity --origin baseUrl [--server url] [--project code] [--allow-non-git] [--cwd-prefix path] [--repositories name,name] [--settings hooks.json] [--config path] [--dry-run] [--remove]
  brainbase judgment:claude-code-hook [--config path]
  brainbase judgment:antigravity-hook [--config path] [--registration id]
  brainbase judgment:hook [--autonomy-mode off|canary|on] [--autonomy-project code] [--reasoning-gate-mode off|compact_4block_v3|compact_4block_with_wm] [--reasoning-gate-projects code,code]
  brainbase login --server url [--credentials path] [--mcp [--tenant tenant] [--scope scope] [--resource url]]
  brainbase login:status [--credentials path]
  brainbase logout [--credentials path]
  brainbase doctor [--dir path] [--judgment-hooks path]
  brainbase web:serve [--dir path] [--journal path] [--port n] [--world [--world-vocabulary file]]
  brainbase review:serve [--dir path] [--journal path] [--port n]  （web:serveの別名）
`;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

export function isCliEntrypoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  if (!invokedPath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(invokedPath);
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const code = await runCli();
  process.exit(code);
}
