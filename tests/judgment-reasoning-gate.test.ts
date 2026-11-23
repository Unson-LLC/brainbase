import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_LINE_STRIP_PREFIX,
  COMPACT_FOUR_BLOCK_GATE_PROMPT_V2,
  COMPACT_FOUR_BLOCK_GATE_PROMPT_V3,
  REASONING_GATE_MODES,
  resolveReasoningGateMode,
  shouldApplyReasoningGate,
  type ReasoningGateMode,
} from '../src/judgment-reasoning-gate-prompt.js';
import {
  canonicalJson,
  processJudgmentHook,
  resolveLocalJudgment,
  runJudgmentHost,
  type JudgmentReceipt,
} from '../src/judgment-host.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-reasoning-gate-'));
  dirs.push(dir);
  return dir;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function episodePath(journal: string, sessionId: string, turnId: string): string {
  return join(journal, digest(sessionId), `${digest(turnId)}.episode.json`);
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function rehashReceipt(receipt: JudgmentReceipt): JudgmentReceipt {
  const plan = { ...receipt } as Record<string, unknown>;
  delete plan.resolution_id;
  delete plan.resolved_at;
  delete plan.request_digest;
  delete plan.plan_digest;
  return { ...receipt, plan_digest: digest(canonicalJson(plan)) };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('RFC-001 PR-A Live Reasoning Gate contracts', () => {
  describe('resolveReasoningGateMode', () => {
    it('exports canonical mode list and defaults to off', () => {
      expect(REASONING_GATE_MODES).toEqual(['off', 'compact_4block_v3', 'compact_4block_with_wm']);
      expect(resolveReasoningGateMode({}, {})).toBe('off');
      expect(resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'off' })).toBe('off');
    });

    it('resolves compact_4block_v3, legacy compact_4block_v2 alias, and compact_4block_with_wm', () => {
      expect(
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3' }),
      ).toBe('compact_4block_v3');
      expect(
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: '  compact_4block_v3  ' }),
      ).toBe('compact_4block_v3');
      expect(
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v2' }),
      ).toBe('compact_4block_v3');
      expect(
        resolveReasoningGateMode({ reasoningGateMode: 'compact_4block_v2' }, {}),
      ).toBe('compact_4block_v3');
      expect(
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm' }),
      ).toBe('compact_4block_with_wm');
      expect(
        resolveReasoningGateMode(
          { reasoningGateMode: 'off' },
          { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3' },
        ),
      ).toBe('off');
    });

    it('filters by canary projects from options or comma-separated env', () => {
      const env = {
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase, unson-core ',
      };
      expect(resolveReasoningGateMode({}, env, 'brainbase')).toBe('compact_4block_with_wm');
      expect(resolveReasoningGateMode({}, env, 'unson-core')).toBe('compact_4block_with_wm');
      expect(resolveReasoningGateMode({}, env, 'other-project')).toBe('off');
      expect(resolveReasoningGateMode({}, env, undefined)).toBe('off');
      expect(resolveReasoningGateMode({}, env, '')).toBe('off');

      // Explicit options.reasoningGateCanaryProjects overrides env list
      expect(
        resolveReasoningGateMode(
          { reasoningGateCanaryProjects: ['pilot-a'] },
          env,
          'pilot-a',
        ),
      ).toBe('compact_4block_with_wm');
      expect(
        resolveReasoningGateMode(
          { reasoningGateCanaryProjects: ['pilot-a'] },
          env,
          'brainbase',
        ),
      ).toBe('off');
      // Empty canary list applies globally
      expect(
        resolveReasoningGateMode(
          { reasoningGateMode: 'compact_4block_v3', reasoningGateCanaryProjects: [] },
          env,
          undefined,
        ),
      ).toBe('compact_4block_v3');
    });

    it('throws judgment_reasoning_gate_mode_invalid for unknown modes', () => {
      expect(() =>
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'unknown_mode' }),
      ).toThrow('judgment_reasoning_gate_mode_invalid');
      expect(() =>
        resolveReasoningGateMode({ reasoningGateMode: 'invalid' as ReasoningGateMode }, {}),
      ).toThrow('judgment_reasoning_gate_mode_invalid');
      expect(() =>
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: '' }),
      ).toThrow('judgment_reasoning_gate_mode_invalid');
      expect(() =>
        resolveReasoningGateMode({}, { BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'toString' }),
      ).toThrow('judgment_reasoning_gate_mode_invalid');
    });
  });

  describe('shouldApplyReasoningGate', () => {
    it('blocks injection for needs_clarification status or clarification.v1 DAG', () => {
      expect(shouldApplyReasoningGate({ status: 'needs_clarification' })).toBe(false);
      expect(shouldApplyReasoningGate({ status: 'resolved', selected_dag_ids: ['clarification.v1'] })).toBe(false);
      expect(shouldApplyReasoningGate({ selected_dag_ids: ['common.v1', 'clarification.v1'] })).toBe(false);
      expect(shouldApplyReasoningGate({ status: 'resolved', selected_dag_ids: ['judgment.v1'] })).toBe(true);
      expect(shouldApplyReasoningGate({})).toBe(true);
    });
  });

  describe('COMPACT_FOUR_BLOCK_GATE_PROMPT_V3 & AUDIT_LINE_STRIP_PREFIX', () => {
    it('keeps deprecated V2 alias identical to V3 and includes v3.1 contracts', () => {
      expect(COMPACT_FOUR_BLOCK_GATE_PROMPT_V2).toBe(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3).toContain('[Brainbase Live Reasoning Gate v3.1 (compact)]');
      expect(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3).toContain('単純な文法・コマンド・SQL・翻訳・事実照会など');
      expect(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3).toContain('`owner_line:` 等の文字列を捏造しないこと');
      expect(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3).toContain('[内部整合ルール（厳守）]');
    });

    it('never starts any line of COMPACT_FOUR_BLOCK_GATE_PROMPT_V3 with AUDIT_LINE_STRIP_PREFIX', () => {
      for (const line of COMPACT_FOUR_BLOCK_GATE_PROMPT_V3.split('\n')) {
        expect(AUDIT_LINE_STRIP_PREFIX.test(line), `Strip prefix leaked into line: ${line}`).toBe(false);
      }
      // Positive sanity checks confirming AUDIT_LINE_STRIP_PREFIX matches audit headers
      expect(AUDIT_LINE_STRIP_PREFIX.test('🧠 判断参照: テスト ✓')).toBe(true);
      expect(AUDIT_LINE_STRIP_PREFIX.test('📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓')).toBe(true);
      expect(AUDIT_LINE_STRIP_PREFIX.test('⚠️ Brainbase検索: 失敗')).toBe(true);
      expect(AUDIT_LINE_STRIP_PREFIX.test('⚠️ 判断参照: 確認質問')).toBe(true);
    });
  });

  describe('runJudgmentHost integration', () => {
    it('preserves exact baseline output and episode/receipt digests when off (default)', async () => {
      const rootA = await tempDir();
      const rootB = await tempDir();
      const fixedNow = () => new Date('2026-11-24T00:00:00.000Z');
      const fixedId = () => 'fixed-resolution-id';
      const resolver = async (request: Parameters<typeof resolveLocalJudgment>[0]) =>
        resolveLocalJudgment(request, { now: fixedNow, id: fixedId });

      const payload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案AとBのトレードオフを検討して',
        session_id: 'rg-baseline-session',
        turn_id: 'turn-1',
        cwd: rootA,
      };
      const envA = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(rootA, 'journal') };
      const envB = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(rootB, 'journal') };

      const defaultOut = await runJudgmentHost(payload, { env: envA, resolver });
      const offOut = await runJudgmentHost({ ...payload, cwd: rootA }, {
        env: envB,
        resolver,
        reasoningGateMode: 'off',
      });

      expect(defaultOut.hookSpecificOutput.additionalContext).not.toContain('[Brainbase Live Reasoning Gate');
      expect(defaultOut.hookSpecificOutput.additionalContext).toBe(offOut.hookSpecificOutput.additionalContext);
      expect(defaultOut.receipt).toEqual(offOut.receipt);

      const episodeDefault = JSON.parse(await readFile(episodePath(envA.BRAINBASE_JUDGMENT_JOURNAL_DIR, payload.session_id, payload.turn_id), 'utf8'));
      const episodeOff = JSON.parse(await readFile(episodePath(envB.BRAINBASE_JUDGMENT_JOURNAL_DIR, payload.session_id, payload.turn_id), 'utf8'));
      expect(episodeDefault.initial_receipt_digest).toBe(episodeOff.initial_receipt_digest);
    });

    it.each([
      ['compact_4block_v3'],
      ['compact_4block_v2'],
      ['compact_4block_with_wm'],
    ] as const)('injects v3.1 prompt identically on both new-turn and replay paths for mode=%s', async (mode) => {
      const root = await tempDir();
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: mode,
      };
      const resolver = vi.fn(async (request: Parameters<typeof resolveLocalJudgment>[0]) =>
        resolveLocalJudgment(request, {
          now: () => new Date('2026-11-24T00:00:00.000Z'),
          id: () => `res-${mode}`,
        }),
      );
      const payload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'マイクロサービス分割仮説を検証して',
        session_id: `rg-session-${mode}`,
        turn_id: 'turn-1',
        cwd: root,
      };

      const first = await runJudgmentHost(payload, { env, resolver });
      const replay = await runJudgmentHost(payload, { env, resolver });

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(first.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(replay.hookSpecificOutput.additionalContext).toBe(first.hookSpecificOutput.additionalContext);
      expect(replay.receipt).toEqual(first.receipt);

      // Replaying the same episode with mode='off' omits the gate without breaking digest verification
      const replayOff = await runJudgmentHost(payload, {
        env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: env.BRAINBASE_JUDGMENT_JOURNAL_DIR },
        resolver,
      });
      expect(replayOff.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(first.hookSpecificOutput.additionalContext).toBe(
        `${replayOff.hookSpecificOutput.additionalContext}\n\n${COMPACT_FOUR_BLOCK_GATE_PROMPT_V3}`,
      );
    });

    it('never injects the gate when receipt requires clarification (needs_clarification / clarification.v1)', async () => {
      const root = await tempDir();
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
      };
      const payload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'それでいい',
        session_id: 'rg-clarification-session',
        turn_id: 'turn-1',
        cwd: root,
      };

      const first = await runJudgmentHost(payload, { env, trustedConversationMessages: [] });
      const replay = await runJudgmentHost(payload, { env, trustedConversationMessages: [] });

      expect(first.receipt.status).toBe('needs_clarification');
      expect(first.receipt.selected_dag_ids).toContain('clarification.v1');
      expect(first.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(replay.hookSpecificOutput.additionalContext).toBe(first.hookSpecificOutput.additionalContext);

      // Defense in depth: even if status is 'resolved', selected_dag_ids containing 'clarification.v1' blocks injection
      const customResolver = vi.fn(async (request: Parameters<typeof resolveLocalJudgment>[0]) => {
        const base = await resolveLocalJudgment(request);
        return rehashReceipt({
          ...base,
          status: 'resolved',
          selected_dag_ids: ['common.v1', 'clarification.v1'],
        });
      });
      const dagOnlyClarification = await runJudgmentHost({
        ...payload,
        prompt: '方針を説明して',
        session_id: 'rg-clarification-dag-only',
      }, { env, resolver: customResolver });
      expect(dagOnlyClarification.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
    });

    it('respects canary project filtering on both new-turn and replay paths', async () => {
      const root = await tempDir();
      const basePayload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案を評価して',
        turn_id: 'turn-1',
        cwd: root,
      };

      const matchingEnv = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal-match'),
        BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase, unson-core',
      };
      const matched = await runJudgmentHost({ ...basePayload, session_id: 'canary-match' }, { env: matchingEnv });
      const matchedReplay = await runJudgmentHost({ ...basePayload, session_id: 'canary-match' }, { env: matchingEnv });
      expect(matched.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(matchedReplay.hookSpecificOutput.additionalContext).toBe(matched.hookSpecificOutput.additionalContext);

      const nonMatchingEnv = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal-miss'),
        BRAINBASE_JUDGMENT_PROJECT_CODE: 'other-project',
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase, unson-core',
      };
      const missed = await runJudgmentHost({ ...basePayload, session_id: 'canary-miss' }, { env: nonMatchingEnv });
      expect(missed.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);

      const missingProjectEnv = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal-none'),
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase',
      };
      const noProject = await runJudgmentHost({ ...basePayload, session_id: 'canary-none' }, { env: missingProjectEnv });
      expect(noProject.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
    });

    it('fails fast before calling resolver on invalid reasoningGateMode', async () => {
      const root = await tempDir();
      const resolver = vi.fn();
      await expect(runJudgmentHost({
        prompt: '設計案を確認して',
        session_id: 'rg-invalid-mode',
        turn_id: 'turn-1',
        cwd: root,
      }, {
        env: {
          BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
          BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'bogus_mode',
        },
        resolver,
      })).rejects.toThrow('judgment_reasoning_gate_mode_invalid');
      expect(resolver).not.toHaveBeenCalled();
    });

    it('completes a full UserPromptSubmit -> Stop lifecycle cleanly with reasoning gate enabled', async () => {
      const root = await tempDir();
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
      };
      const identity = { session_id: 'rg-lifecycle', turn_id: 'turn-1', cwd: root };

      const started = await processJudgmentHook({
        hook_event_name: 'UserPromptSubmit',
        prompt: '案Aと案Bのどちらを優先すべきか評価して',
        ...identity,
      }, { env });
      if (!('hookSpecificOutput' in started)) throw new Error('expected UserPromptSubmit output');
      expect(started.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);

      const ownerLine = started.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      const finalized = await processJudgmentHook({
        hook_event_name: 'Stop',
        last_assistant_message: [
          ownerLine,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '1. 【主張の幹（Steelman）】案Aは初期検証速度を優先する仮説。',
          '2. 【母数・代表性と支持/反証】母数は未観測（unknown）。',
        ].join('\n'),
        ...identity,
      }, { env });
      expect(finalized).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
    });
  });

  describe('CLI option pass-through (codex judgment:install & judgment:hook)', () => {
    it('passes --reasoning-gate-mode and --reasoning-gate-projects through judgment:install and judgment:hook', async () => {
      const installOut = capture();
      const installCode = await runCli([
        'judgment:install', '--target', 'codex',
        '--reasoning-gate-mode', 'compact_4block_v2',
        '--reasoning-gate-projects', 'brainbase,unson-core',
        '--dry-run',
      ], installOut.io);
      expect(installCode).toBe(0);
      const config = JSON.parse(installOut.stdout());
      const commands = Object.values(config.hooks).map((bindings: any) => bindings[0].hooks[0].command);
      expect(commands.every((cmd: string) => cmd.includes('"--reasoning-gate-mode" "compact_4block_v3"'))).toBe(true);
      expect(commands.every((cmd: string) => cmd.includes('"--reasoning-gate-projects" "brainbase,unson-core"'))).toBe(true);

      const root = await tempDir();
      vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', join(root, 'journal'));
      vi.stubEnv('BRAINBASE_JUDGMENT_PROJECT_CODE', 'brainbase');
      const hookOut = capture();
      const payload = JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案を比較して',
        session_id: 'rg-cli-session',
        turn_id: 'turn-1',
        cwd: root,
      });
      const hookCode = await runCli([
        'judgment:hook',
        '--reasoning-gate-mode', 'compact_4block_v3',
        '--reasoning-gate-projects', 'brainbase',
      ], {
        ...hookOut.io,
        stdin: Readable.from([payload]),
      });
      expect(hookCode).toBe(0);
      const result = JSON.parse(hookOut.stdout());
      expect(result.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
    });
  });
});
