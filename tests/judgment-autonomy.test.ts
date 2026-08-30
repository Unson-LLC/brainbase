import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../src/judgment-host.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexCliJudgmentProvider,
  classifyEscalationAttempt,
  compileJudgmentPacket,
  processAutonomousJudgmentHook,
  validateSemanticJudgment,
  type JudgmentIntelligenceProvider,
  type JudgmentSourceProvider,
  type ResolverInput,
  type SemanticJudgment
} from '../src/judgment-autonomy.js';

const roots: string[] = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeToolEvent(
  env: Record<string, string>,
  turnId: string,
  event: Record<string, unknown>
): Promise<void> {
  const sessionRef = digest('session-1');
  const turnRef = digest(turnId);
  const directory = join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR!, sessionRef, `${turnRef}.events`);
  await mkdir(directory, { recursive: true });
  const eventDigest = digest(canonicalJson(event));
  await writeFile(join(directory, '000001.json'), `${JSON.stringify({ ...event, event_digest: eventDigest })}\n`);
}

async function journalEnv(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-autonomy-test-'));
  roots.push(root);
  return {
    BRAINBASE_JUDGMENT_JOURNAL_DIR: root,
    BRAINBASE_JUDGMENT_RESOLVER_MODE: 'off',
    ...extra
  };
}

function payload(turnId: string, answer: string) {
  return {
    hook_event_name: 'Stop',
    session_id: 'session-1',
    turn_id: turnId,
    cwd: process.cwd(),
    last_assistant_message: answer
  } as const;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('autonomous Stop judgment', () => {
  it('blocks a low-risk confirmation without invoking an LLM', async () => {
    const env = await journalEnv();
    const provider = { id: 'must-not-run', resolve: vi.fn() } as unknown as JudgmentIntelligenceProvider;
    const delegate = vi.fn();

    const output = await processAutonomousJudgmentHook(
      payload('turn-low-risk', 'テストを実行しますか？'),
      { env, provider, delegate }
    );

    expect(output).toMatchObject({ decision: 'block' });
    expect((output as { reason: string }).reason).toContain('Brainbase代理判断: NG');
    expect(provider.resolve).not.toHaveBeenCalled();
    expect(delegate).not.toHaveBeenCalled();
  });

  it('allows a hard external-impact boundary to reach the existing audit Stop', async () => {
    const env = await journalEnv();
    const delegateResult = { schema_version: 'delegated-final' };
    const delegate = vi.fn().mockResolvedValue(delegateResult);

    const output = await processAutonomousJudgmentHook(
      payload('turn-human', '本番データを削除してよいですか？'),
      { env, delegate }
    );

    expect(output).toEqual(delegateResult);
    expect(delegate).toHaveBeenCalledOnce();
  });

  it('uses an independent semantic provider for a gray-zone priority choice', async () => {
    const env = await journalEnv();
    const provider: JudgmentIntelligenceProvider = {
      id: 'test-provider',
      resolve: vi.fn().mockResolvedValue({
        verdict: 'NG',
        reason: 'センターピンを先に証明すべきため',
        basis: [{
          id: 'brainbase.autonomy.default.v1',
          application: '既存基準で安全に選べる場合は人間へ戻さない'
        }],
        instruction_patch: {
          cancel: ['人間への優先順位確認'],
          do_next: ['代理判断の縦切りを先に実装する'],
          acceptance_criteria: ['人間へ戻さず実装と検証を終える']
        },
        human_escalation: { required: false, reason_code: null, question: null },
        confidence: 'high'
      } satisfies SemanticJudgment)
    };

    const output = await processAutonomousJudgmentHook(
      payload('turn-semantic', '証跡台帳と代理判断のどちらを先に実装しますか？'),
      { env, provider, delegate: vi.fn() }
    );

    expect(output).toMatchObject({ decision: 'block' });
    expect((output as { reason: string }).reason).toContain('代理判断の縦切りを先に実装する');
    expect(provider.resolve).toHaveBeenCalledOnce();
  });

  it('includes digest-verified current-turn Brainbase evidence and redacts secrets', async () => {
    const env = await journalEnv();
    const turnId = 'turn-event-source';
    await writeToolEvent(env, turnId, {
      schema_version: 'brainbase-judgment-tool-event-v1',
      session_ref: digest('session-1'),
      turn_id: turnId,
      sequence: 1,
      recorded_at: '2026-08-30T00:00:00.000Z',
      tool_use_id: 'tool-1',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: '代理判断' },
      tool_response: {
        results: [{ id: 'dec-centerpin', title: '代理判断', decision: '人間へ戻さず続行する' }],
        diagnostic: 'Authorization: Bearer top-secret-token',
        api_key: 'sk-test-secret-value'
      },
      audit_kind: 'search',
      success: true,
      satisfies: ['knowledge.search'],
      display_line: '📚 Brainbase検索: 代理判断 ✓',
      event_fingerprint: 'fingerprint'
    });

    const packet = compileJudgmentPacket(payload(turnId, ''), env);
    expect(packet.judgment_sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'brainbase:dec-centerpin' }),
      expect.objectContaining({ kind: 'brainbase_evidence' })
    ]));
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain('top-secret-token');
    expect(serialized).not.toContain('sk-test-secret-value');
    expect(serialized).toContain('[redacted]');
  });

  it('fails closed on a tampered episode before issuing a continuation', async () => {
    const env = await journalEnv();
    const turnId = 'turn-tampered-episode';
    const sessionRef = digest('session-1');
    const turnRef = digest(turnId);
    const directory = join(env.BRAINBASE_JUDGMENT_JOURNAL_DIR!, sessionRef);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${turnRef}.episode.json`), JSON.stringify({
      schema_version: 'brainbase-judgment-episode-v1',
      session_ref: sessionRef,
      turn_id: turnId,
      adoption: {},
      episode_digest: 'tampered'
    }));

    await expect(processAutonomousJudgmentHook(
      payload(turnId, 'テストを実行しますか？'),
      { env, delegate: vi.fn() }
    )).rejects.toThrow('autonomy_episode_invalid');
  });

  it('adds Brainbase judgment sources before asking the independent resolver', async () => {
    const env = await journalEnv();
    const sourceProvider: JudgmentSourceProvider = {
      id: 'test-source-provider',
      load: vi.fn().mockResolvedValue([{
        id: 'brainbase:dec-centerpin',
        kind: 'brainbase_record',
        instruction: '代理判断の縦切りを監査拡張より先に証明する',
        authority: 'local_graph',
        source_ref: 'graph:dec-centerpin'
      }])
    };
    const provider: JudgmentIntelligenceProvider = {
      id: 'source-aware-resolver',
      resolve: vi.fn().mockImplementation(async (input: ResolverInput) => {
        expect(input.judgment_packet.judgment_sources).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: 'brainbase:dec-centerpin' })
        ]));
        return {
          verdict: 'NG',
          reason: 'Brainbaseの既存Decisionに反するため',
          basis: [{ id: 'brainbase:dec-centerpin', application: '代理判断の縦切りを先行する' }],
          instruction_patch: {
            cancel: ['人間への優先順位確認'],
            do_next: ['代理判断の縦切りを実装する'],
            acceptance_criteria: ['Brainbase Decisionを根拠に同一turnで続行する']
          },
          human_escalation: { required: false, reason_code: null, question: null },
          confidence: 'high'
        } satisfies SemanticJudgment;
      })
    };

    const output = await processAutonomousJudgmentHook(
      payload('turn-source-provider', '証跡台帳と代理判断のどちらを先に実装しますか？'),
      { env, provider, sourceProvider, delegate: vi.fn() }
    );

    expect(output).toMatchObject({ decision: 'block' });
    expect((output as { reason: string }).reason).toContain('brainbase:dec-centerpin');
    expect(sourceProvider.load).toHaveBeenCalledOnce();
  });

  it('rejects invented Brainbase basis ids and falls back to same-worker continuation', async () => {
    const env = await journalEnv();
    const provider: JudgmentIntelligenceProvider = {
      id: 'inventing-provider',
      resolve: vi.fn().mockResolvedValue({
        verdict: 'NG',
        reason: 'invented basis',
        basis: [{ id: 'decision:does-not-exist', application: 'invented' }],
        instruction_patch: {
          cancel: ['question'],
          do_next: ['continue'],
          acceptance_criteria: ['done']
        },
        human_escalation: { required: false, reason_code: null, question: null },
        confidence: 'high'
      } satisfies SemanticJudgment)
    };

    const output = await processAutonomousJudgmentHook(
      payload('turn-invalid-basis', 'A案とB案のどちらを選びますか？'),
      { env, provider, delegate: vi.fn() }
    );

    expect(output).toMatchObject({ decision: 'block' });
    expect((output as { reason: string }).reason).toContain('独立Resolverを利用できないため');
  });

  it('does not grant missing-authority escalation without trusted host evidence', async () => {
    const env = await journalEnv();
    const provider: JudgmentIntelligenceProvider = {
      id: 'authority-provider',
      resolve: vi.fn().mockResolvedValue({
        verdict: 'HUMAN_REQUIRED',
        reason: '権限がないと自己申告されたため',
        basis: [{ id: 'brainbase.autonomy.default.v1', application: '権限不足なら人間へ上げる' }],
        instruction_patch: { cancel: [], do_next: [], acceptance_criteria: [] },
        human_escalation: {
          required: true,
          reason_code: 'missing_authority',
          question: '権限をください'
        },
        confidence: 'high'
      } satisfies SemanticJudgment)
    };
    const delegate = vi.fn();

    const output = await processAutonomousJudgmentHook(
      payload('turn-no-authority-evidence', '権限がないので、権限を付けてもらえますか？'),
      { env, provider, delegate }
    );

    expect(output).toMatchObject({ decision: 'block' });
    expect(delegate).not.toHaveBeenCalled();
    expect((output as { reason: string }).reason).toContain('Resolverを利用できない');
  });

  it('reuses an immutable decision for the same state and policy snapshot', async () => {
    const env = await journalEnv();
    const resolve = vi.fn().mockResolvedValue({
      verdict: 'NG',
      reason: '同じ判断',
      basis: [{ id: 'brainbase.autonomy.default.v1', application: '同じ基準' }],
      instruction_patch: {
        cancel: ['question'],
        do_next: ['continue'],
        acceptance_criteria: ['done']
      },
      human_escalation: { required: false, reason_code: null, question: null },
      confidence: 'high'
    } satisfies SemanticJudgment);
    const provider = { id: 'idempotent-provider', resolve };
    const input = payload('turn-idempotent', 'A案とB案のどちらを選びますか？');

    await processAutonomousJudgmentHook(input, { env, provider, delegate: vi.fn() });
    await processAutonomousJudgmentHook(input, { env, provider, delegate: vi.fn() });

    expect(resolve).toHaveBeenCalledOnce();
  });

  it('fails closed when the same continuation is repeated during an active Stop repair', async () => {
    const env = await journalEnv();
    const first = payload('turn-repeat', 'テストを実行しますか？');
    await processAutonomousJudgmentHook(first, { env, delegate: vi.fn() });

    await expect(processAutonomousJudgmentHook(
      { ...first, stop_hook_active: true },
      { env, delegate: vi.fn() }
    )).rejects.toThrow('judgment_autonomy_continuation_exhausted');
  });

  it('bypasses the autonomy layer inside the resolver subprocess', async () => {
    const env = await journalEnv({ BRAINBASE_RESOLVER_ACTIVE: '1' });
    const delegateResult = { bypassed: true };
    const delegate = vi.fn().mockResolvedValue(delegateResult);

    const output = await processAutonomousJudgmentHook(
      payload('turn-recursion', 'テストを実行しますか？'),
      { env, delegate }
    );

    expect(output).toEqual(delegateResult);
    expect(delegate).toHaveBeenCalledOnce();
  });
});

describe('resolver contract', () => {
  it('classifies only hard external boundaries deterministically', () => {
    expect(classifyEscalationAttempt('テストを実行しますか？').kind).toBe('continue');
    expect(classifyEscalationAttempt('本番データを削除してよいですか？').kind).toBe('human');
    expect(classifyEscalationAttempt('権限がないので権限をください').kind).toBe('semantic');
    expect(classifyEscalationAttempt('AとBのどちらを選びますか？').kind).toBe('semantic');
    expect(classifyEscalationAttempt('なぜこの設計か？ 理由は安全性です。以上です。').kind).toBe('none');
  });

  it('validates basis ids against the compiled packet', async () => {
    const env = await journalEnv();
    const packet = compileJudgmentPacket(payload('turn-packet', ''), env);
    expect(() => validateSemanticJudgment({
      verdict: 'NG',
      reason: 'invalid basis',
      basis: [{ id: 'invented', application: 'invalid' }],
      instruction_patch: { cancel: [], do_next: ['continue'], acceptance_criteria: ['done'] },
      human_escalation: { required: false, reason_code: null, question: null },
      confidence: 'high'
    }, packet)).toThrow(/basis_unknown/);
  });

  it('launches Codex as an isolated read-only structured-output resolver', async () => {
    const env = await journalEnv();
    const packet = compileJudgmentPacket(payload('turn-provider', ''), env);
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string; stdin?: string }> = [];
    const provider = new CodexCliJudgmentProvider({
      env,
      command: 'codex-test',
      runner: async (command, args, options) => {
        calls.push({ command, args, env: options.env, cwd: options.cwd, stdin: options.stdin });
        const outputPath = args[args.indexOf('-o') + 1];
        if (!outputPath) throw new Error('missing output path');
        const decision: SemanticJudgment = {
          verdict: 'NG',
          reason: 'test',
          basis: [{ id: 'brainbase.autonomy.default.v1', application: 'test' }],
          instruction_patch: { cancel: ['question'], do_next: ['continue'], acceptance_criteria: ['done'] },
          human_escalation: { required: false, reason_code: null, question: null },
          confidence: 'high'
        };
        const { writeFile } = await import('node:fs/promises');
        await writeFile(outputPath, JSON.stringify(decision));
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }
    });

    await provider.resolve({
      schema_version: 'brainbase-semantic-resolver-input-v1',
      decision_case: {
        schema_version: 'brainbase-decision-case-v1',
        question: 'A or B?',
        proposed_escalation: 'ask_human',
        alternatives: ['continue', 'ask'],
        risk: {
          reversible: true,
          external_effect: false,
          financial_commitment: false,
          authority_or_secret_missing: false,
          trusted_evidence_refs: [],
          signals: ['semantic_choice']
        },
        state_digest: 'state'
      },
      judgment_packet: packet,
      required_output: {
        verdicts: ['OK', 'NG', 'OK_WITH_CONDITIONS', 'HUMAN_REQUIRED'],
        basis_rule: 'existing_source_ids_only',
        instruction_patch_required_when_not_human: true
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('codex-test');
    expect(calls[0]?.args).toEqual(expect.arrayContaining([
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--ask-for-approval', 'never', '--output-schema', '-'
    ]));
    expect(calls[0]?.stdin).toContain('brainbase-semantic-resolver-input-v1');
    expect(calls[0]?.args.join(' ')).not.toContain('brainbase-semantic-resolver-input-v1');
    expect(calls[0]?.cwd).toContain('brainbase-resolver-');
    expect(calls[0]?.env.BRAINBASE_RESOLVER_ACTIVE).toBe('1');
  });
});
