import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertExplicitOrResolvedJournalRoot,
  DEFAULT_JUDGMENT_HOST_BINDING,
  JUDGMENT_AUTONOMY_MODES,
  normalizeExpectedHostBinding,
  resolveAutonomyConfig,
  resolveEffectiveReasoningGateMode,
  resolveJudgmentJournalRoot,
  resolveJudgmentJournalRootWithSource,
  resolveJudgmentRuntimeConfig,
  resolveTranscriptRootCandidates,
  type JudgmentHostBinding,
  type JudgmentRuntimeConfig
} from '../src/judgment-runtime-config.js';
import {
  buildJudgmentRequest,
  COMPACT_FOUR_BLOCK_GATE_PROMPT_V3,
  processJudgmentHook,
  resolveLocalJudgment,
  runJudgmentHost
} from '../src/judgment-host.js';
import {
  defaultJudgmentJournalRoot,
  readJudgmentValueProofJournal
} from '../src/judgment-value-proof-review.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-runtime-config-'));
  dirs.push(dir);
  return dir;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function episodePath(journal: string, sessionId: string, turnId: string): string {
  return join(journal, sha256(sessionId), `${sha256(turnId)}.episode.json`);
}

function finalPath(journal: string, sessionId: string, turnId: string): string {
  return join(journal, sha256(sessionId), `${sha256(turnId)}.final.json`);
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('JudgmentRuntimeConfig single source of truth', () => {
  describe('journalRoot precedence and Hook / defaultJudgmentJournalRoot parity', () => {
    it('follows explicit > BRAINBASE_JUDGMENT_JOURNAL_DIR > explicit dataDir > BRAINBASE_PERSONAL_OS_DIR > default', async () => {
      const root = await tempDir();
      const explicitJournal = join(root, 'explicit-journal');
      const envJournal = join(root, 'env-journal');
      const explicitDataDir = join(root, 'explicit-data');
      const envPersonalOs = join(root, 'env-personal-os');

      const fullEnv = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: envJournal,
        BRAINBASE_PERSONAL_OS_DIR: envPersonalOs
      };

      expect(resolveJudgmentJournalRootWithSource(fullEnv, {
        journalRoot: explicitJournal,
        dataDir: explicitDataDir
      })).toEqual({ journalRoot: resolve(explicitJournal), source: 'explicit' });

      expect(resolveJudgmentJournalRootWithSource(fullEnv, {
        dataDir: explicitDataDir
      })).toEqual({ journalRoot: resolve(envJournal), source: 'env_journal_dir' });

      expect(resolveJudgmentJournalRootWithSource(
        { BRAINBASE_PERSONAL_OS_DIR: envPersonalOs },
        { dataDir: explicitDataDir }
      )).toEqual({ journalRoot: join(resolve(explicitDataDir), 'judgment-journal'), source: 'explicit_data_dir' });

      expect(resolveJudgmentJournalRootWithSource(
        { BRAINBASE_PERSONAL_OS_DIR: envPersonalOs }
      )).toEqual({ journalRoot: join(resolve(envPersonalOs), 'judgment-journal'), source: 'env_personal_os_dir' });

      expect(resolveJudgmentJournalRootWithSource({})).toEqual({
        journalRoot: join(resolve(join(homedir(), '.brainbase', 'personal-os')), 'judgment-journal'),
        source: 'default_personal_os_dir'
      });
    });

    it('matches between JudgmentHost runtimeConfig and defaultJudgmentJournalRoot across env modes', async () => {
      const root = await tempDir();
      const envJournal = join(root, 'shared-journal');
      const envPersonalOs = join(root, 'shared-personal-os');

      // 1. BRAINBASE_JUDGMENT_JOURNAL_DIR set
      const envWithJournal = { BRAINBASE_JUDGMENT_JOURNAL_DIR: envJournal };
      expect(defaultJudgmentJournalRoot(undefined, envWithJournal))
        .toBe(resolveJudgmentRuntimeConfig({}, envWithJournal).journalRoot);
      expect(defaultJudgmentJournalRoot(undefined, envWithJournal))
        .toBe(resolveJudgmentJournalRoot(envWithJournal));

      // 2. Only BRAINBASE_PERSONAL_OS_DIR set
      const envWithPersonalOs = { BRAINBASE_PERSONAL_OS_DIR: envPersonalOs };
      expect(defaultJudgmentJournalRoot(undefined, envWithPersonalOs))
        .toBe(resolveJudgmentRuntimeConfig({}, envWithPersonalOs).journalRoot);

      // 3. Default (empty env)
      expect(defaultJudgmentJournalRoot(undefined, {}))
        .toBe(resolveJudgmentRuntimeConfig({}, {}).journalRoot);

      // 4. process.env parity when BRAINBASE_JUDGMENT_JOURNAL_DIR is stubbed
      vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', envJournal);
      expect(defaultJudgmentJournalRoot()).toBe(resolve(envJournal));
      expect(resolveJudgmentRuntimeConfig().journalRoot).toBe(resolve(envJournal));

      // 5. readJudgmentValueProofJournal uses runtimeConfig.journalRoot over process.env
      const isolatedJournal = join(root, 'isolated-journal');
      const runtimeConfig = resolveJudgmentRuntimeConfig({ journalRoot: isolatedJournal }, {});
      const journalRead = await readJudgmentValueProofJournal({ runtimeConfig });
      expect(journalRead).toMatchObject({
        status: 'unavailable',
        root: resolve(isolatedJournal),
        reason: 'judgment_journal_not_found'
      });
    });

    it('validates journal root via assertExplicitOrResolvedJournalRoot', async () => {
      const root = await tempDir();
      const explicit = resolveJudgmentJournalRootWithSource({}, { journalRoot: join(root, 'j') });
      expect(assertExplicitOrResolvedJournalRoot(explicit, { requireExplicit: true })).toEqual(explicit);

      const implicitDefault = resolveJudgmentJournalRootWithSource({});
      expect(assertExplicitOrResolvedJournalRoot(implicitDefault)).toEqual(implicitDefault);
      expect(() => assertExplicitOrResolvedJournalRoot(implicitDefault, { requireExplicit: true }))
        .toThrow('judgment_journal_root_not_explicit');

      expect(() => assertExplicitOrResolvedJournalRoot({ journalRoot: 'relative/path', source: 'explicit' }))
        .toThrow('judgment_journal_root_invalid');
      expect(() => assertExplicitOrResolvedJournalRoot({ journalRoot: '   ', source: 'explicit' }))
        .toThrow('judgment_journal_root_invalid');
    });
  });

  describe('autonomyMode, reasoningGateMode, hostBinding, transcriptRoots, and fail-fast validation', () => {
    it('resolves and freezes all settings into an immutable config', async () => {
      const root = await tempDir();
      const config = resolveJudgmentRuntimeConfig({}, {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
        BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
        BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS: `${join(root, 't1')}:${join(root, 't2')}`,
        BRAINBASE_JUDGMENT_AUTONOMY_MODE: 'canary',
        BRAINBASE_JUDGMENT_AUTONOMY_CANARY_PROJECTS: 'brainbase, unson-core, brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v2',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase, pilot'
      });

      expect(JUDGMENT_AUTONOMY_MODES).toEqual(['off', 'canary', 'on']);
      expect(config).toEqual({
        journalRoot: resolve(join(root, 'journal')),
        journalRootSource: 'env_journal_dir',
        projectCode: 'brainbase',
        transcriptRootCandidates: [join(root, 't1'), join(root, 't2')],
        expectedHostBinding: DEFAULT_JUDGMENT_HOST_BINDING,
        autonomyMode: 'canary',
        autonomyCanaryProjects: ['brainbase', 'unson-core'],
        reasoningGateMode: 'compact_4block_v3',
        reasoningGateCanaryProjects: ['brainbase', 'pilot']
      });

      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.expectedHostBinding)).toBe(true);
      expect(Object.isFrozen(config.transcriptRootCandidates)).toBe(true);
      expect(Object.isFrozen(config.autonomyCanaryProjects)).toBe(true);
      expect(Object.isFrozen(config.reasoningGateCanaryProjects)).toBe(true);

      expect(resolveEffectiveReasoningGateMode(config, 'brainbase')).toBe('compact_4block_v3');
      expect(resolveEffectiveReasoningGateMode(config, 'other-project')).toBe('off');
      expect(resolveEffectiveReasoningGateMode(config, undefined)).toBe('off');
    });

    it('fails fast on invalid autonomyMode, missing canary projects, invalid reasoningGateMode, or invalid hostBinding', async () => {
      const root = await tempDir();
      const resolver = vi.fn();

      expect(() => resolveAutonomyConfig({}, { BRAINBASE_JUDGMENT_AUTONOMY_MODE: 'bogus' }))
        .toThrow('judgment_autonomy_mode_invalid');
      expect(() => resolveAutonomyConfig({}, { BRAINBASE_JUDGMENT_AUTONOMY_MODE: 'canary' }))
        .toThrow('judgment_autonomy_canary_project_missing');
      expect(() => resolveJudgmentRuntimeConfig({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'unknown' }))
        .toThrow('judgment_reasoning_gate_mode_invalid');
      expect(() => normalizeExpectedHostBinding({ adapter_id: '' } as JudgmentHostBinding))
        .toThrow('judgment_host_binding_config_invalid');

      await expect(runJudgmentHost({
        prompt: '設計案を確認して',
        session_id: 'fail-fast-autonomy',
        turn_id: 'turn-1',
        cwd: root
      }, {
        env: {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
          BRAINBASE_JUDGMENT_AUTONOMY_MODE: 'invalid_mode'
        },
        resolver
      })).rejects.toThrow('judgment_autonomy_mode_invalid');

      await expect(runJudgmentHost({
        prompt: '設計案を確認して',
        session_id: 'fail-fast-autonomy-canary',
        turn_id: 'turn-1',
        cwd: root
      }, {
        env: {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
          BRAINBASE_JUDGMENT_AUTONOMY_MODE: 'canary'
        },
        resolver
      })).rejects.toThrow('judgment_autonomy_canary_project_missing');

      await expect(runJudgmentHost({
        prompt: '設計案を確認して',
        session_id: 'fail-fast-rg',
        turn_id: 'turn-1',
        cwd: root
      }, {
        env: {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
          BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'bogus'
        },
        resolver
      })).rejects.toThrow('judgment_reasoning_gate_mode_invalid');

      expect(resolver).not.toHaveBeenCalled();
    });

    it('resolves CODEX_HOME fallback for transcriptRootCandidates when BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS is unset', () => {
      const candidates = resolveTranscriptRootCandidates({ CODEX_HOME: '/custom/codex' });
      expect(candidates[0]).toBe(join('/custom/codex', 'sessions'));
      expect(candidates).toContain(join(homedir(), '.codex', 'sessions'));
    });
  });

  describe('runtimeConfig DI prevents lower-level fallback drift from process.env', () => {
    it('isolates journalRoot, projectCode, transcriptRoots, autonomyMode, and reasoningGateMode from conflicting process.env', async () => {
      const root = await tempDir();
      const injectedJournal = join(root, 'injected-journal');
      const pollutedJournal = join(root, 'polluted-env-journal');
      const injectedTranscriptDir = join(root, 'injected-transcripts');
      const pollutedTranscriptDir = join(root, 'polluted-transcripts');
      await mkdir(injectedTranscriptDir, { recursive: true });
      await mkdir(pollutedTranscriptDir, { recursive: true });

      const sessionId = 'di-isolation-session';
      const transcriptFile = join(injectedTranscriptDir, 'session.jsonl');
      await writeFile(transcriptFile, [
        JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            turn_id: 'turn-0',
            content: 'APIの設計を実装して'
          }
        })
      ].join('\n') + '\n', 'utf8');

      // Construct immutable runtimeConfig from clean inputs before process.env is polluted.
      const runtimeConfig: JudgmentRuntimeConfig = resolveJudgmentRuntimeConfig({
        journalRoot: injectedJournal,
        projectCode: 'injected-project',
        transcriptRootCandidates: [injectedTranscriptDir],
        autonomyMode: 'off',
        reasoningGateMode: 'compact_4block_v3',
        reasoningGateCanaryProjects: ['injected-project']
      }, {});

      // Pollute process.env with conflicting values for every judgment setting.
      vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', pollutedJournal);
      vi.stubEnv('BRAINBASE_PERSONAL_OS_DIR', join(root, 'polluted-os'));
      vi.stubEnv('BRAINBASE_JUDGMENT_PROJECT_CODE', 'polluted-project');
      vi.stubEnv('BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS', pollutedTranscriptDir);
      vi.stubEnv('BRAINBASE_JUDGMENT_AUTONOMY_MODE', 'on');
      vi.stubEnv('BRAINBASE_JUDGMENT_REASONING_GATE_MODE', 'off');
      vi.stubEnv('BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS', 'polluted-project');

      // 1. buildJudgmentRequest respects injected runtimeConfig (not polluted process.env)
      const builtRequest = buildJudgmentRequest({
        prompt: '続けて',
        session_id: sessionId,
        turn_id: 'turn-1',
        transcript_path: transcriptFile,
        cwd: root
      }, { runtimeConfig });
      expect(builtRequest.project_code).toBe('injected-project');
      expect(builtRequest.conversation_context.completeness).toBe('complete');
      expect(builtRequest.conversation_context.messages.some((m) => m.text === 'APIの設計を実装して')).toBe(true);

      // 2. Full Hook lifecycle respects injected runtimeConfig even without passing `env`
      const started = await processJudgmentHook({
        hook_event_name: 'UserPromptSubmit',
        prompt: '続けて',
        session_id: sessionId,
        turn_id: 'turn-1',
        transcript_path: transcriptFile,
        cwd: root
      }, { runtimeConfig });
      if (!('hookSpecificOutput' in started)) throw new Error('expected UserPromptSubmit output');

      expect(started.receipt.project_code).toBe('injected-project');
      expect(started.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);

      // Episode must exist in injectedJournal and NOT in pollutedJournal
      await expect(access(episodePath(injectedJournal, sessionId, 'turn-1'))).resolves.toBeUndefined();
      await expect(access(pollutedJournal)).rejects.toThrow();

      // Stop must respect runtimeConfig.autonomyMode='off' (not polluted 'on') even for a routine question
      const ownerLine = started.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      const finalized = await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-1',
        cwd: root,
        last_assistant_message: [
          ownerLine,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          'テストを実行しますか？'
        ].join('\n')
      }, { runtimeConfig });
      expect(finalized).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
      await expect(access(finalPath(injectedJournal, sessionId, 'turn-1'))).resolves.toBeUndefined();
      await expect(access(pollutedJournal)).rejects.toThrow();
    });

    it('lets options.runtimeConfig beat options.env while allowing explicit field overrides on top of runtimeConfig', async () => {
      const root = await tempDir();
      const baseJournal = join(root, 'base-journal');
      const overrideJournal = join(root, 'override-journal');
      const envJournal = join(root, 'env-journal');

      const baseConfig = resolveJudgmentRuntimeConfig({
        journalRoot: baseJournal,
        projectCode: 'base-proj',
        reasoningGateMode: 'compact_4block_v3'
      }, {});

      const fromBase = resolveJudgmentRuntimeConfig(
        { runtimeConfig: baseConfig },
        {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: envJournal,
          BRAINBASE_JUDGMENT_PROJECT_CODE: 'env-proj',
          BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'off'
        }
      );
      expect(fromBase.journalRoot).toBe(resolve(baseJournal));
      expect(fromBase.projectCode).toBe('base-proj');
      expect(fromBase.reasoningGateMode).toBe('compact_4block_v3');

      const withExplicitOverride = resolveJudgmentRuntimeConfig(
        {
          runtimeConfig: baseConfig,
          journalRoot: overrideJournal,
          reasoningGateMode: 'off'
        },
        { BRAINBASE_JUDGMENT_JOURNAL_DIR: envJournal }
      );
      expect(withExplicitOverride.journalRoot).toBe(resolve(overrideJournal));
      expect(withExplicitOverride.journalRootSource).toBe('explicit');
      expect(withExplicitOverride.projectCode).toBe('base-proj');
      expect(withExplicitOverride.reasoningGateMode).toBe('off');
    });
  });

  describe('episode_digest and receipt_digest backward compatibility', () => {
    it('produces byte-for-byte identical receipt, episode_digest, final_digest, and additionalContext between env and runtimeConfig', async () => {
      const rootA = await tempDir();
      const rootB = await tempDir();
      const journalA = join(rootA, 'journal');
      const journalB = join(rootB, 'journal');
      const sharedCwd = join(rootA, 'workspace');
      await mkdir(sharedCwd, { recursive: true });

      const fixedDate = new Date('2026-11-24T00:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedDate);

      const resolver = async (request: Parameters<typeof resolveLocalJudgment>[0]) =>
        resolveLocalJudgment(request, { now: () => fixedDate, id: () => 'fixed-resolution-id' });

      const startPayload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案AとBのトレードオフを検討して',
        session_id: 'digest-parity-session',
        turn_id: 'turn-1',
        cwd: sharedCwd
      };

      const envOptions = {
        env: {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: journalA,
          BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase'
        },
        resolver
      };
      const runtimeConfig = resolveJudgmentRuntimeConfig({
        journalRoot: journalB,
        projectCode: 'brainbase'
      }, {});
      const diOptions = { runtimeConfig, resolver };

      const startA = await runJudgmentHost(startPayload, envOptions);
      const startB = await runJudgmentHost(startPayload, diOptions);

      expect(startB.receipt).toEqual(startA.receipt);
      expect(startB.hookSpecificOutput.additionalContext).toBe(startA.hookSpecificOutput.additionalContext);

      const episodeA = JSON.parse(await readFile(episodePath(journalA, startPayload.session_id, startPayload.turn_id), 'utf8'));
      const episodeB = JSON.parse(await readFile(episodePath(journalB, startPayload.session_id, startPayload.turn_id), 'utf8'));

      expect(episodeB.initial_receipt_digest).toBe(episodeA.initial_receipt_digest);
      expect(episodeB.adoption.receipt_digest).toBe(episodeA.adoption.receipt_digest);
      expect(episodeB.episode_digest).toBe(episodeA.episode_digest);
      expect(episodeB).toEqual(episodeA);

      const ownerLine = startA.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      const stopPayload = {
        hook_event_name: 'Stop',
        session_id: startPayload.session_id,
        turn_id: startPayload.turn_id,
        cwd: sharedCwd,
        last_assistant_message: [
          ownerLine,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '検討結果です。'
        ].join('\n')
      };

      const finalA = await processJudgmentHook(stopPayload, envOptions);
      const finalB = await processJudgmentHook(stopPayload, diOptions);
      expect(finalB).toEqual(finalA);
    });
  });

  describe('CLI integration with JudgmentRuntimeConfig', () => {
    it('resolves runtimeConfig once in judgment:hook and honors BRAINBASE_JUDGMENT_JOURNAL_DIR', async () => {
      const root = await tempDir();
      const journal = join(root, 'cli-journal');
      vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', journal);
      vi.stubEnv('BRAINBASE_JUDGMENT_PROJECT_CODE', 'brainbase');

      const out = capture();
      const payload = JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案を確認して',
        session_id: 'cli-runtime-config-session',
        turn_id: 'turn-1',
        cwd: root
      });
      const exitCode = await runCli(['judgment:hook'], {
        ...out.io,
        stdin: Readable.from([payload])
      });

      expect(exitCode).toBe(0);
      const result = JSON.parse(out.stdout());
      expect(result.continue).toBe(true);
      expect(result.receipt.project_code).toBe('brainbase');
      await expect(access(episodePath(journal, 'cli-runtime-config-session', 'turn-1'))).resolves.toBeUndefined();
    });
  });
});
