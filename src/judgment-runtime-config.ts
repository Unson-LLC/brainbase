import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import {
  resolveReasoningGateMode,
  type ReasoningGateHostConfig,
  type ReasoningGateMode
} from './judgment-reasoning-gate-prompt.js';

export type JudgmentRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export const JUDGMENT_AUTONOMY_MODES = ['off', 'canary', 'on'] as const;
export type JudgmentAutonomyMode = (typeof JUDGMENT_AUTONOMY_MODES)[number];

/**
 * The resolver adapter binding accepted by the Host. The adapter identity is
 * supplied by the Host configuration and is never inferred from a receipt.
 */
export interface JudgmentHostBinding {
  adapter_id: string;
  adapter_version: string;
  status: 'managed';
  enforcement_level: 'host_contract';
}

export const DEFAULT_JUDGMENT_HOST_BINDING: JudgmentHostBinding = Object.freeze({
  adapter_id: 'brainbase-local',
  adapter_version: '1',
  status: 'managed',
  enforcement_level: 'host_contract'
});

export type JudgmentJournalRootSource =
  | 'explicit'
  | 'env_journal_dir'
  | 'explicit_data_dir'
  | 'env_personal_os_dir'
  | 'default_personal_os_dir';

export interface JudgmentJournalRootResolution {
  readonly journalRoot: string;
  readonly source: JudgmentJournalRootSource;
}

export interface ResolveJudgmentJournalRootOptions {
  readonly journalRoot?: string;
  readonly dataDir?: string;
}

export interface JudgmentRuntimeConfigOptions extends ReasoningGateHostConfig {
  readonly runtimeConfig?: JudgmentRuntimeConfig;
  readonly journalRoot?: string;
  readonly dataDir?: string;
  readonly projectCode?: string;
  readonly transcriptRootCandidates?: readonly string[];
  readonly expectedHostBinding?: JudgmentHostBinding;
  readonly autonomyMode?: JudgmentAutonomyMode;
  readonly autonomyCanaryProjects?: readonly string[];
}

/**
 * Single immutable runtime configuration resolved once at a Host/CLI/MCP entrypoint
 * and passed down via DI so lower-level judgment functions never independently fall
 * back to `process.env` or divergent default paths.
 */
export interface JudgmentRuntimeConfig {
  readonly journalRoot: string;
  readonly journalRootSource: JudgmentJournalRootSource;
  readonly projectCode: string | undefined;
  readonly transcriptRootCandidates: readonly string[];
  readonly expectedHostBinding: JudgmentHostBinding;
  readonly autonomyMode: JudgmentAutonomyMode;
  readonly autonomyCanaryProjects: readonly string[];
  readonly reasoningGateMode: ReasoningGateMode;
  readonly reasoningGateCanaryProjects: readonly string[];
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Resolves the canonical judgment journal root along with diagnostic source metadata.
 *
 * Precedence:
 * 1. Explicit `options.journalRoot`
 * 2. `env.BRAINBASE_JUDGMENT_JOURNAL_DIR`
 * 3. Explicit `options.dataDir` (`<dataDir>/judgment-journal`)
 * 4. `env.BRAINBASE_PERSONAL_OS_DIR` (`<personalOs>/judgment-journal`)
 * 5. Default `~/.brainbase/personal-os/judgment-journal`
 */
export function resolveJudgmentJournalRootWithSource(
  env: JudgmentRuntimeEnvironment = process.env,
  options: ResolveJudgmentJournalRootOptions = {}
): JudgmentJournalRootResolution {
  const explicitJournal = nonEmptyTrimmed(options.journalRoot);
  if (explicitJournal) {
    return Object.freeze({ journalRoot: resolve(explicitJournal), source: 'explicit' });
  }
  const envJournal = nonEmptyTrimmed(env.BRAINBASE_JUDGMENT_JOURNAL_DIR);
  if (envJournal) {
    return Object.freeze({ journalRoot: resolve(envJournal), source: 'env_journal_dir' });
  }
  const explicitDataDir = nonEmptyTrimmed(options.dataDir);
  if (explicitDataDir) {
    return Object.freeze({
      journalRoot: join(resolve(explicitDataDir), 'judgment-journal'),
      source: 'explicit_data_dir'
    });
  }
  const envPersonalOs = nonEmptyTrimmed(env.BRAINBASE_PERSONAL_OS_DIR);
  if (envPersonalOs) {
    return Object.freeze({
      journalRoot: join(resolve(envPersonalOs), 'judgment-journal'),
      source: 'env_personal_os_dir'
    });
  }
  return Object.freeze({
    journalRoot: join(resolve(join(homedir(), '.brainbase', 'personal-os')), 'judgment-journal'),
    source: 'default_personal_os_dir'
  });
}

/**
 * Single source of truth for the judgment journal root shared by `judgment-host.ts`,
 * `cli.ts`, `judgment-value-proof-review.ts`, and external callers.
 */
export function resolveJudgmentJournalRoot(
  env: JudgmentRuntimeEnvironment = process.env,
  options: ResolveJudgmentJournalRootOptions = {}
): string {
  return resolveJudgmentJournalRootWithSource(env, options).journalRoot;
}

/**
 * Validates that a journal root resolution holds a normalized absolute path and,
 * when `requireExplicit` is true, refuses silent fallback to the implicit default home path.
 */
export function assertExplicitOrResolvedJournalRoot(
  resolution: JudgmentJournalRootResolution | Pick<JudgmentRuntimeConfig, 'journalRoot' | 'journalRootSource'>,
  options: { readonly requireExplicit?: boolean } = {}
): JudgmentJournalRootResolution {
  const source: JudgmentJournalRootSource = 'source' in resolution
    ? resolution.source
    : resolution.journalRootSource;
  const trimmed = nonEmptyTrimmed(resolution.journalRoot);
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error('judgment_journal_root_invalid');
  }
  if (options.requireExplicit && source === 'default_personal_os_dir') {
    throw new Error('judgment_journal_root_not_explicit');
  }
  return Object.freeze({ journalRoot: resolve(trimmed), source });
}

export function normalizeExpectedHostBinding(
  value: JudgmentHostBinding | undefined
): JudgmentHostBinding {
  const candidate = value === undefined ? DEFAULT_JUDGMENT_HOST_BINDING : record(value);
  if (!candidate
    || typeof candidate.adapter_id !== 'string'
    || candidate.adapter_id.trim().length === 0
    || typeof candidate.adapter_version !== 'string'
    || candidate.adapter_version.trim().length === 0
    || candidate.status !== 'managed'
    || candidate.enforcement_level !== 'host_contract') {
    throw new Error('judgment_host_binding_config_invalid');
  }
  return Object.freeze({
    adapter_id: candidate.adapter_id,
    adapter_version: candidate.adapter_version,
    status: 'managed',
    enforcement_level: 'host_contract'
  });
}

export function resolveAutonomyConfig(
  options: {
    readonly autonomyMode?: JudgmentAutonomyMode;
    readonly autonomyCanaryProjects?: readonly string[];
  } = {},
  env: JudgmentRuntimeEnvironment = process.env
): {
  readonly mode: JudgmentAutonomyMode;
  readonly canaryProjects: readonly string[];
} {
  const rawMode = options.autonomyMode ?? env.BRAINBASE_JUDGMENT_AUTONOMY_MODE ?? 'off';
  if (!(JUDGMENT_AUTONOMY_MODES as readonly string[]).includes(rawMode)) {
    throw new Error('judgment_autonomy_mode_invalid');
  }
  const configuredProjects = options.autonomyCanaryProjects
    ?? (env.BRAINBASE_JUDGMENT_AUTONOMY_CANARY_PROJECTS ?? '').split(',');
  const canaryProjects = Object.freeze(
    [...new Set(configuredProjects.map((value) => value.trim()).filter(Boolean))]
  );
  if (rawMode === 'canary' && canaryProjects.length === 0) {
    throw new Error('judgment_autonomy_canary_project_missing');
  }
  return Object.freeze({
    mode: rawMode as JudgmentAutonomyMode,
    canaryProjects
  });
}

export function resolveTranscriptRootCandidates(
  env: JudgmentRuntimeEnvironment = process.env,
  explicitCandidates?: readonly string[]
): readonly string[] {
  if (explicitCandidates !== undefined) {
    return Object.freeze(
      [...new Set(explicitCandidates.map((value) => value.trim()).filter(Boolean))]
    );
  }
  const configured = (env.BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS ?? '')
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const defaultCodexHome = join(homedir(), '.codex');
  const defaultRoots = [...new Set([
    env.CODEX_HOME ? join(env.CODEX_HOME, 'sessions') : null,
    join(defaultCodexHome, 'sessions')
  ].filter((value): value is string => Boolean(value)))];
  return Object.freeze(configured.length > 0 ? configured : defaultRoots);
}

/**
 * Resolves all Judgment Host runtime configuration into a single immutable object.
 *
 * When `options.runtimeConfig` is provided, `env` is NOT consulted for any unset
 * field, preventing silent fallback drift from `process.env`. Any explicit option
 * field provided alongside `options.runtimeConfig` overrides that field cleanly.
 */
export function resolveJudgmentRuntimeConfig(
  options: JudgmentRuntimeConfigOptions = {},
  env: JudgmentRuntimeEnvironment = process.env
): JudgmentRuntimeConfig {
  const base = options.runtimeConfig;
  const effectiveEnv: JudgmentRuntimeEnvironment = base ? {} : env;

  const journalResolution = options.journalRoot !== undefined || options.dataDir !== undefined
    ? resolveJudgmentJournalRootWithSource(effectiveEnv, {
      journalRoot: options.journalRoot,
      dataDir: options.dataDir
    })
    : base
      ? assertExplicitOrResolvedJournalRoot({
        journalRoot: resolve(base.journalRoot),
        source: base.journalRootSource
      })
      : resolveJudgmentJournalRootWithSource(effectiveEnv);

  const expectedHostBinding = normalizeExpectedHostBinding(
    options.expectedHostBinding !== undefined
      ? options.expectedHostBinding
      : base?.expectedHostBinding
  );

  const autonomy = resolveAutonomyConfig(
    {
      autonomyMode: options.autonomyMode !== undefined ? options.autonomyMode : base?.autonomyMode,
      autonomyCanaryProjects: options.autonomyCanaryProjects !== undefined
        ? options.autonomyCanaryProjects
        : base?.autonomyCanaryProjects
    },
    effectiveEnv
  );

  // Delegate mode validation and legacy alias normalization to `resolveReasoningGateMode` (SSOT).
  // Passing `reasoningGateCanaryProjects: []` validates and normalizes the configured mode
  // without project-level filtering; project filtering happens in `resolveEffectiveReasoningGateMode`.
  const reasoningGateMode = resolveReasoningGateMode(
    {
      reasoningGateMode: options.reasoningGateMode !== undefined
        ? options.reasoningGateMode
        : base?.reasoningGateMode,
      reasoningGateCanaryProjects: []
    },
    effectiveEnv
  );

  const reasoningGateCanaryProjects = Object.freeze(
    options.reasoningGateCanaryProjects !== undefined
      ? [...new Set(options.reasoningGateCanaryProjects.map((value) => value.trim()).filter(Boolean))]
      : base
        ? [...new Set(base.reasoningGateCanaryProjects.map((value) => value.trim()).filter(Boolean))]
        : (effectiveEnv.BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS
          ? [...new Set(effectiveEnv.BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS.split(',').map((value) => value.trim()).filter(Boolean))]
          : [])
  );

  const projectCode = options.projectCode !== undefined
    ? options.projectCode
    : base
      ? base.projectCode
      : effectiveEnv.BRAINBASE_JUDGMENT_PROJECT_CODE;

  const transcriptRootCandidates = resolveTranscriptRootCandidates(
    effectiveEnv,
    options.transcriptRootCandidates !== undefined
      ? options.transcriptRootCandidates
      : base?.transcriptRootCandidates
  );

  return Object.freeze({
    journalRoot: journalResolution.journalRoot,
    journalRootSource: journalResolution.source,
    projectCode,
    transcriptRootCandidates,
    expectedHostBinding,
    autonomyMode: autonomy.mode,
    autonomyCanaryProjects: autonomy.canaryProjects,
    reasoningGateMode,
    reasoningGateCanaryProjects
  });
}

/**
 * Evaluates the effective reasoning gate mode for a specific turn's `projectCode`
 * using only the already-resolved `JudgmentRuntimeConfig` (never reading `process.env`).
 */
export function resolveEffectiveReasoningGateMode(
  config: Pick<JudgmentRuntimeConfig, 'reasoningGateMode' | 'reasoningGateCanaryProjects'>,
  projectCode?: string
): ReasoningGateMode {
  return resolveReasoningGateMode(
    {
      reasoningGateMode: config.reasoningGateMode,
      reasoningGateCanaryProjects: config.reasoningGateCanaryProjects
    },
    {},
    projectCode
  );
}
