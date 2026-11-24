import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
  ANTIGRAVITY_HOOK_KEY,
  antigravityHookCommand,
  antigravityNamespacedId,
  extractLastAssistantMessage,
  extractLatestNonSystemUserInput,
  handleAntigravityJudgmentHook,
  normalizeAntigravityHookBaseUrl,
  normalizeAntigravityToolName,
  registerAntigravityJudgmentHooks,
  resolveAntigravityHookEndpoint,
  type AntigravityHookConfig,
} from '../src/antigravity-judgment-hook.js';
import { runCli } from '../src/cli.js';
import { toKnowledgeEventFromJudgmentEpisode } from '../src/judgment-event-adapter.js';
import {
  EXECUTION_OUTCOME_HOSTS,
  normalizeJudgmentExecutionOutcome,
} from '../src/judgment-execution-outcome.js';
import { selectJudgmentProjectBinding } from '../src/judgment-project-binding.js';
import {
  REMOTE_JUDGMENT_HOOK_PATH,
  handleRemoteJudgmentHookRequest,
} from '../src/remote-judgment-hook-http.js';

const REG = 'b'.repeat(32);
const REGISTRATION = { id: REG, settings: '/home/me/.gemini/config/hooks.json' };
const token = async () => ({ token: 'person-jwt', loginId: 'login-1' });

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-antigravity-hook-'));
  dirs.push(dir);
  return dir;
}

async function gitCheckout(root: string, name: string, origin = 'git@github.com:acme/growin-app.git'): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, '.git', 'refs'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(dir, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n`);
  return dir;
}

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function mockHost(
  respond: (body: Record<string, unknown>, sentCount: number) => { status: number; body: unknown } = (body) => ({
    status: 200,
    body: {
      schema_version: '1',
      accepted: true,
      hook_event_name: body.hook_event_name,
      session_id: body.session_id,
      turn_id: body.turn_id,
      output: body.hook_event_name === 'UserPromptSubmit'
        ? {
          systemMessage: '🧠 判断参照: 確認済み',
          hookSpecificOutput: { additionalContext: 'owner_line: keep scope small' },
        }
        : {},
    },
  }),
) {
  const sent: SentRequest[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body,
    });
    const answer = respond(body, sent.length);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

async function setupConfig(overrides: Partial<AntigravityHookConfig> = {}) {
  const home = await tempDir();
  const repo = await gitCheckout(home, 'repo-app');
  const configPath = join(home, '.brainbase', 'antigravity-judgment-hook.json');
  await mkdir(join(home, '.brainbase'), { recursive: true });
  const config: AntigravityHookConfig = {
    schema_version: ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
    origin: 'https://bb.unson.jp/runtime-mcp',
    login_server: 'https://bb.unson.jp',
    registration: REGISTRATION,
    ...overrides,
  };
  await writeFile(configPath, JSON.stringify(config));
  const env = { HOME: home } as NodeJS.ProcessEnv;
  return { home, repo, configPath, env, config };
}

function captureCli() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
  };
}

describe('endpoint path preservation (/runtime-mcp)', () => {
  it('preserves base URL path prefixes instead of dropping them with leading slash', () => {
    expect(resolveAntigravityHookEndpoint({ origin: 'https://bb.unson.jp/runtime-mcp' }).toString())
      .toBe('https://bb.unson.jp/runtime-mcp/host/judgment/hook');
    expect(resolveAntigravityHookEndpoint({ origin: 'https://bb.unson.jp/runtime-mcp/' }).toString())
      .toBe('https://bb.unson.jp/runtime-mcp/host/judgment/hook');
    expect(resolveAntigravityHookEndpoint({ origin: 'https://mcp.example.net' }).toString())
      .toBe('https://mcp.example.net/host/judgment/hook');
    expect(resolveAntigravityHookEndpoint({ origin: 'http://127.0.0.1:4100/runtime-mcp' }).toString())
      .toBe('http://127.0.0.1:4100/runtime-mcp/host/judgment/hook');
    expect(resolveAntigravityHookEndpoint({
      origin: 'https://ignored.example.net',
      endpoint: 'https://bb.unson.jp/runtime-mcp/host/judgment/hook',
    }).toString()).toBe('https://bb.unson.jp/runtime-mcp/host/judgment/hook');
    expect(normalizeAntigravityHookBaseUrl('https://bb.unson.jp/runtime-mcp/')).toBe('https://bb.unson.jp/runtime-mcp');
    expect(() => resolveAntigravityHookEndpoint({ origin: 'http://bb.unson.jp/runtime-mcp' }))
      .toThrow('judgment_hook_transport_unsafe');
  });
});

describe('normalizeAntigravityToolName', () => {
  it('normalizes eager mcp_brainbase* and lazy call_mcp_tool names', () => {
    expect(normalizeAntigravityToolName('mcp_brainbase-unson_search')).toBe('mcp__brainbase__search');
    expect(normalizeAntigravityToolName('mcp_brainbase-unson_brainbase_admin_read'))
      .toBe('mcp__brainbase__brainbase_admin_read');
    expect(normalizeAntigravityToolName('mcp_brainbase-unson_brainbase_knowledge_lookup'))
      .toBe('mcp__brainbase__brainbase_knowledge_lookup');
    expect(normalizeAntigravityToolName('mcp_brainbase_get_entity')).toBe('mcp__brainbase__get_entity');
    expect(normalizeAntigravityToolName('mcp__brainbase__search')).toBe('mcp__brainbase__search');
    expect(normalizeAntigravityToolName('call_mcp_tool', {
      ServerName: 'brainbase-unson',
      ToolName: 'search_personal_kg',
      Arguments: { query: 'test' },
    })).toBe('mcp__brainbase__search_personal_kg');
    expect(normalizeAntigravityToolName('call_mcp_tool', {
      ServerName: 'brainbase',
      ToolName: 'brainbase_knowledge_lookup',
    })).toBe('mcp__brainbase__brainbase_knowledge_lookup');
    expect(normalizeAntigravityToolName('call_mcp_tool', {
      ServerName: 'reason-network',
      ToolName: 'send_message',
    })).toBe('call_mcp_tool');
    expect(normalizeAntigravityToolName('run_command', { CommandLine: 'ls' })).toBe('run_command');
  });
});

describe('handleAntigravityJudgmentHook lifecycle', () => {
  it('fires UserPromptSubmit once per turn across repeated PreInvocation + Reason Network injections, adds turn_id guard, and formats injectSteps', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const transcriptPath = join(home, 'transcript.jsonl');
    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: '<USER_REQUEST>\nImplement PR-A cleanly\n</USER_REQUEST>\n<ADDITIONAL_METADATA>now</ADDITIONAL_METADATA>',
      }),
      JSON.stringify({
        step_index: 1,
        source: 'SYSTEM_SDK',
        type: 'USER_INPUT',
        content: '<USER_REQUEST>\nReason Network: you are info/bot. Teammates can message you.\n</USER_REQUEST>',
      }),
    ].join('\n') + '\n');

    const { fetchImpl, sent } = mockHost();
    const options = { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // 1st PreInvocation: lastUserInput was overwritten by Reason Network, so it falls back to transcript USER_INPUT.
    const first = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-1',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      modelName: 'gemini-pro',
      lastUserInput: 'Reason Network: you are info/bot.',
    }, options);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://bb.unson.jp/runtime-mcp/host/judgment/hook');
    expect(sent[0].headers['x-brainbase-judgment-host']).toBe('antigravity');
    expect(sent[0].headers['x-brainbase-repository']).toBe('github.com/acme/growin-app');
    expect(sent[0].body).toMatchObject({
      hook_event_name: 'UserPromptSubmit',
      session_id: antigravityNamespacedId('conv-1', { registration: REGISTRATION }),
      prompt: 'Implement PR-A cleanly',
      model: 'gemini-pro',
      transcript_path: transcriptPath,
    });

    // Verify nested injectSteps[].systemMessage + turn_id guard + metadata.user_markdown
    expect(first.terminationBehavior).toBe('');
    const steps = first.injectSteps as Array<{ systemMessage: { systemMessage: string; metadata?: { user_markdown?: string } } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(steps[0].systemMessage.systemMessage).toContain('旧ターンの判断契約・owner_lineは上書き');
    expect(steps[0].systemMessage.systemMessage).toContain('owner_line: keep scope small');
    expect(steps[0].systemMessage.metadata?.user_markdown).toBe('🧠 判断参照: 確認済み');

    // 2nd & 3rd PreInvocation in same turn: MUST NOT fire UserPromptSubmit again.
    const second = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-1',
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Reason Network: you are info/bot.',
    }, options);
    const third = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-1',
      invocationNum: 3,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Implement PR-A cleanly',
    }, options);
    expect(second).toEqual({});
    expect(third).toEqual({});
    expect(sent).toHaveLength(1);
  });

  it('skips PreInvocation as no-op when only Reason Network system input exists', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const transcriptPath = join(home, 'transcript.jsonl');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 0,
      source: 'SYSTEM_SDK',
      type: 'USER_INPUT',
      content: 'Reason Network: you are info/bot.',
    }) + '\n');
    const { fetchImpl, sent } = mockHost();
    const out = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-sys',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Reason Network: you are info/bot.',
    }, { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG });
    expect(out).toEqual({});
    expect(sent).toEqual([]);
  });

  it('queues PostToolUse context with turn_id, drains only matching turn_id, and discards stale mismatched pending entries', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const { fetchImpl } = mockHost((body) => ({
      status: 200,
      body: {
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: body.hook_event_name === 'PostToolUse'
          ? {
            systemMessage: '📚 audit note',
            hookSpecificOutput: { additionalContext: 'follow-up reminder' },
          }
          : {},
      },
    }));
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-pending',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Check repo',
    }, options);

    // PostToolUse MUST return {} even when Host returns systemMessage / additionalContext.
    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-pending',
      cwd: repo,
      stepIdx: 4,
      toolCall: { id: 'toolu_1', name: 'run_command', args: { CommandLine: 'echo secret-cmd' } },
    }, options);
    expect(postOut).toEqual({});

    // Inject a stale mismatched turn_id entry into persisted state to verify turn_id filtering.
    const { readdir } = await import('node:fs/promises');
    const [stateFile] = await readdir(turnDir);
    const fullStatePath = join(turnDir, stateFile);
    const rawState = JSON.parse(await readFile(fullStatePath, 'utf8'));
    rawState.pending_messages.unshift({
      turn_id: 'stale-previous-turn-id',
      additional_context: 'STALE_CONTEXT_MUST_BE_DROPPED',
      system_message: 'STALE_MARKDOWN_MUST_BE_DROPPED',
      created_at: new Date().toISOString(),
    });
    await writeFile(fullStatePath, JSON.stringify(rawState));

    // Next PreInvocation in same turn drains ONLY the current turn's pending entry.
    const nextPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-pending',
      invocationNum: 2,
      cwd: repo,
      lastUserInput: 'Check repo',
    }, options);
    const serialized = JSON.stringify(nextPre);
    expect(serialized).toContain('follow-up reminder');
    expect(serialized).toContain('📚 audit note');
    expect(serialized).not.toContain('STALE_CONTEXT_MUST_BE_DROPPED');
    expect(serialized).not.toContain('STALE_MARKDOWN_MUST_BE_DROPPED');

    // Subsequent PreInvocation has nothing left in pending buffer.
    const afterDrain = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-pending',
      invocationNum: 3,
      cwd: repo,
      lastUserInput: 'Check repo',
    }, options);
    expect(afterDrain).toEqual({});
  });

  it('recovers cleanly to a new turn after a crash without Stop when step_index advances or stale threshold passes', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const transcriptPath = join(home, 'transcript.jsonl');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'First turn prompt',
    }) + '\n');

    const { fetchImpl, sent } = mockHost();
    let currentTime = 1_700_000_000_000;
    const options = {
      env,
      fetch: fetchImpl,
      accessToken: token,
      configPath,
      registrationId: REG,
      now: () => currentTime,
      staleTurnMs: 60_000,
    };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-crash',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'First turn prompt',
    }, options);
    expect(sent).toHaveLength(1);

    // Crash occurs (no Stop). User submits a new prompt at step_index 5.
    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'First turn prompt' }),
      JSON.stringify({ step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Second turn prompt' }),
    ].join('\n') + '\n');

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-crash',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Reason Network: you are info/bot.',
    }, options);
    expect(sent).toHaveLength(2);
    expect(sent[1].body.prompt).toBe('Second turn prompt');
    expect(sent[1].body.turn_id).not.toBe(sent[0].body.turn_id);

    // Crash again with no transcript advance, but staleTurnMs elapses with invocationNum === 1.
    currentTime += 120_000;
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-crash',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Second turn prompt',
    }, options);
    expect(sent).toHaveLength(3);
    expect(sent[2].body.turn_id).not.toBe(sent[1].body.turn_id);
  });

  it('handles PreToolUse (lookup only), PostToolUse (non-Brainbase digest vs Brainbase transcript extraction + failure), and Stop (last_assistant_message & USER_CANCELED)', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const transcriptPath = join(home, 'transcript.jsonl');
    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Search knowledge' }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'GENERIC',
        content: 'Created At: 2026-11-24T17:00:00+09:00\nCompleted At: 2026-11-24T17:00:01+09:00\n{"results":[{"id":"e1"}]}',
      }),
      JSON.stringify({ step_index: 5, source: 'MODEL', type: 'PLANNER_RESPONSE', content: '' }),
      JSON.stringify({ step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Final verified answer.' }),
    ].join('\n') + '\n');

    const { fetchImpl, sent } = mockHost((body) => ({
      status: 200,
      body: {
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: body.hook_event_name === 'PreToolUse'
          ? {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'stale lookup revision',
            },
          }
          : body.hook_event_name === 'Stop'
            ? { decision: 'block', reason: 'should never become continue' }
            : {},
      },
    }));
    const options = { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-full',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Search knowledge',
    }, options);

    // Non-lookup tool PreToolUse: instant allow, no HTTP call.
    const ordinaryPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'ls' } },
    }, options);
    expect(ordinaryPre).toEqual({ decision: 'allow' });
    expect(sent).toHaveLength(1);

    // Brainbase lookup via call_mcp_tool: normalized and forwarded to Host.
    const lookupPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      toolCall: {
        id: 't2',
        name: 'call_mcp_tool',
        args: { ServerName: 'brainbase-unson', ToolName: 'brainbase_knowledge_lookup', Arguments: { query: 'x' } },
      },
    }, options);
    expect(lookupPre).toEqual({ decision: 'deny', reason: 'stale lookup revision' });
    expect(sent[1].body).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__brainbase__brainbase_knowledge_lookup',
      tool_input: { query: 'x' },
    });

    // PostToolUse for non-Brainbase failed tool -> PostToolUseFailure with digest only (no secret leak).
    const failedShell = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      stepIdx: 2,
      error: 'exit status 1: SECRET_TOKEN=xyz',
      toolCall: { id: 't3', name: 'run_command', args: { CommandLine: 'cat /secret/key' } },
    }, options);
    expect(failedShell).toEqual({});
    expect(sent[2].body.hook_event_name).toBe('PostToolUseFailure');
    expect(JSON.stringify(sent[2].body)).not.toContain('/secret/key');
    expect(JSON.stringify(sent[2].body)).not.toContain('SECRET_TOKEN=xyz');
    expect(sent[2].body.tool_response).toMatchObject({ success: false });

    // PostToolUse for Brainbase knowledge tool -> normalized + transcript result extracted into MCP content[].
    const bbSearch = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      stepIdx: 4,
      transcriptPath,
      toolCall: { id: 't4', name: 'mcp_brainbase-unson_search', args: { query: 'architecture' } },
    }, options);
    expect(bbSearch).toEqual({});
    expect(sent[3].body).toMatchObject({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'architecture' },
      tool_response: {
        content: [{ type: 'text', text: '{"results":[{"id":"e1"}]}' }],
        isError: false,
      },
    });

    // PostToolUse for Brainbase tool with missing transcript step -> fallback digest + success.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      stepIdx: 99,
      transcriptPath,
      toolCall: { id: 't5', name: 'mcp_brainbase-unson_get_entity', args: { id: 'ent_1' } },
    }, options);
    expect(sent[4].body.tool_response).toMatchObject({ success: true, digest: expect.stringMatching(/^sha256:/u) });

    // Stop with NO_TOOL_CALL -> extracts last_assistant_message, ALWAYS returns {"decision":""}.
    const stopOut = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-full',
      cwd: repo,
      transcriptPath,
      terminationReason: 'NO_TOOL_CALL',
      continuationActive: false,
    }, options);
    expect(stopOut).toEqual({ decision: '' });
    expect(sent[5].body).toMatchObject({
      hook_event_name: 'Stop',
      last_assistant_message: 'Final verified answer.',
      stop_hook_active: false,
    });

    // Start another turn and terminate with USER_CANCELED -> MUST NOT forward Stop, MUST clear turn_active.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-full',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Another prompt',
    }, options);
    expect(sent).toHaveLength(7);

    const canceledStop = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-full',
      cwd: repo,
      terminationReason: 'USER_CANCELED',
    }, options);
    expect(canceledStop).toEqual({ decision: '' });
    expect(sent).toHaveLength(7);

    // Since USER_CANCELED cleared turn_active, next PreInvocation opens a fresh turn.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-full',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Another prompt',
    }, options);
    expect(sent).toHaveLength(8);
  });

  it('extracts last_assistant_message and non-system USER_INPUT from bounded tail of large transcripts', async () => {
    const dir = await tempDir();
    const transcriptPath = join(dir, 'large-transcript.jsonl');
    const filler = JSON.stringify({ step_index: 1, type: 'GENERIC', content: 'x'.repeat(10_000) });
    const lines = Array.from({ length: 35 }, () => filler);
    lines.push(JSON.stringify({ step_index: 50, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Tail user prompt' }));
    lines.push(JSON.stringify({ step_index: 51, source: 'SYSTEM_SDK', type: 'USER_INPUT', content: 'Reason Network: you are x' }));
    lines.push(JSON.stringify({ step_index: 52, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Tail assistant answer' }));
    await writeFile(transcriptPath, lines.join('\n') + '\n');

    expect(extractLatestNonSystemUserInput(transcriptPath)).toEqual({ stepIndex: 50, content: 'Tail user prompt' });
    expect(extractLastAssistantMessage(transcriptPath)).toBe('Tail assistant answer');
  });

  it('fails open on HTTP errors and timeouts for all events', async () => {
    const { repo, configPath, env } = await setupConfig({
      timeouts_ms: { PreInvocation: 50, PreToolUse: 50, PostToolUse: 50, Stop: 50 },
    });
    const timeoutFetch = (async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    const opts = { env, fetch: timeoutFetch, accessToken: token, configPath, registrationId: REG };
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation', conversationId: 'conv-fail', invocationNum: 1, cwd: repo, lastUserInput: 'hi',
    }, opts)).toEqual({});
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreToolUse', conversationId: 'conv-fail', cwd: repo,
      toolCall: { id: 't1', name: 'mcp_brainbase-unson_brainbase_knowledge_lookup', args: {} },
    }, opts)).toEqual({ decision: 'allow' });
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse', conversationId: 'conv-fail', cwd: repo,
      toolCall: { id: 't1', name: 'run_command', args: {} },
    }, opts)).toEqual({});
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'Stop', conversationId: 'conv-fail', cwd: repo, terminationReason: 'NO_TOOL_CALL',
    }, opts)).toEqual({ decision: '' });
  });
});

describe('non-git workspace, cwd_prefixes canary, and kill switch', () => {
  it('audits non-git Orca bot home with project_code + allow_non_git/cwd_prefixes, excludes out-of-prefix dirs, and honors kill switch', async () => {
    const home = await tempDir();
    const botHome = join(home, 'bots', 'unson-lab');
    const otherBot = join(home, 'bots', 'other-bot');
    await mkdir(botHome, { recursive: true });
    await mkdir(otherBot, { recursive: true });

    const configPath = join(home, '.brainbase', 'antigravity-judgment-hook.json');
    await mkdir(join(home, '.brainbase'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      schema_version: ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
      origin: 'https://bb.unson.jp/runtime-mcp',
      login_server: 'https://bb.unson.jp',
      project_code: 'unson-lab',
      allow_non_git: true,
      cwd_prefixes: [botHome],
      registration: REGISTRATION,
    }));

    const { fetchImpl, sent } = mockHost();
    const env = { HOME: home } as NodeJS.ProcessEnv;
    const opts = { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // Inside allowed non-git bot home -> audited with explicit project_code and NO x-brainbase-repository header.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-bot',
      invocationNum: 1,
      cwd: botHome,
      lastUserInput: 'Research item 55',
    }, opts);
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-brainbase-project-code']).toBe('unson-lab');
    expect(sent[0].headers['x-brainbase-repository']).toBeUndefined();

    // Outside cwd_prefixes -> excluded silently.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-other',
      invocationNum: 1,
      cwd: otherBot,
      lastUserInput: 'Other bot task',
    }, opts);
    expect(sent).toHaveLength(1);

    // Kill switch -> immediate fail-open per event with zero HTTP traffic.
    const disabledOpts = {
      ...opts,
      env: { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_HOOK: 'disabled' },
    };
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation', conversationId: 'conv-kill', invocationNum: 1, cwd: botHome, lastUserInput: 'hi',
    }, disabledOpts)).toEqual({});
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreToolUse', conversationId: 'conv-kill', cwd: botHome,
      toolCall: { id: 't1', name: 'mcp_brainbase-unson_brainbase_knowledge_lookup', args: {} },
    }, disabledOpts)).toEqual({ decision: 'allow' });
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'Stop', conversationId: 'conv-kill', cwd: botHome, terminationReason: 'NO_TOOL_CALL',
    }, disabledOpts)).toEqual({ decision: '' });
    expect(sent).toHaveLength(1);
  });

  it('refuses non-git auditing when project_code is omitted', async () => {
    const home = await tempDir();
    const nonGit = join(home, 'non-git');
    await mkdir(nonGit, { recursive: true });
    const configPath = join(home, '.brainbase', 'antigravity-judgment-hook.json');
    await mkdir(join(home, '.brainbase'), { recursive: true });
    await writeFile(configPath, JSON.stringify({
      schema_version: ANTIGRAVITY_HOOK_CONFIG_SCHEMA,
      origin: 'https://bb.unson.jp/runtime-mcp',
      login_server: 'https://bb.unson.jp',
      allow_non_git: true,
      registration: REGISTRATION,
    }));
    const { fetchImpl, sent } = mockHost();
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-no-proj',
      invocationNum: 1,
      cwd: nonGit,
      lastUserInput: 'Should not send',
    }, { env: { HOME: home }, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG });
    expect(sent).toEqual([]);
  });
});

describe('registerAntigravityJudgmentHooks & CLI', () => {
  const configPath = '/home/ubuntu/.brainbase/antigravity-judgment-hook.json';
  const command = antigravityHookCommand('/usr/bin/node', '/pkg/dist/cli.js', configPath, REG);

  it('merges brainbase-judgment non-destructively alongside existing hooks, is idempotent, and removes cleanly', () => {
    const existing = {
      'orca-status': {
        PreInvocation: [{ type: 'command', command: '/bin/sh orca.sh', timeout: 10 }],
      },
      'reason-network': {
        enabled: true,
        Stop: [{ type: 'command', command: 'reason-network hook antigravity stop', timeout: 15 }],
      },
    };
    const once = registerAntigravityJudgmentHooks(existing, { command, configPath, registrationId: REG });
    const twice = registerAntigravityJudgmentHooks(once, { command, configPath, registrationId: REG });
    expect(twice).toEqual(once);
    expect(once['orca-status']).toEqual(existing['orca-status']);
    expect(once['reason-network']).toEqual(existing['reason-network']);

    const entry = once[ANTIGRAVITY_HOOK_KEY] as Record<string, unknown>;
    expect(entry.enabled).toBe(true);
    expect((entry.PreInvocation as Array<{ timeout: number }>)[0].timeout).toBe(6);
    expect((entry.PreToolUse as Array<{ hooks: Array<{ timeout: number }> }>)[0].hooks[0].timeout).toBe(5);
    expect((entry.PostToolUse as Array<{ hooks: Array<{ timeout: number }> }>)[0].hooks[0].timeout).toBe(5);
    expect((entry.Stop as Array<{ timeout: number }>)[0].timeout).toBe(8);

    const removedIds = new Set<string>();
    const removed = registerAntigravityJudgmentHooks(once, { configPath, remove: true, removedIds });
    expect(removed).toEqual(existing);
    expect([...removedIds]).toEqual([REG]);
  });

  it('installs, previews (--dry-run), and removes via CLI while preserving /runtime-mcp and existing hooks', async () => {
    const root = await tempDir();
    const hooksPath = join(root, '.agents', 'hooks.json');
    const configPath = join(root, 'antigravity-judgment-hook.json');
    const botDir = join(root, 'unson-lab');
    await mkdir(join(root, '.agents'), { recursive: true });
    await mkdir(botDir, { recursive: true });
    const initialHooks = {
      'orca-status': { Stop: [{ type: 'command', command: 'echo orca', timeout: 10 }] },
    };
    await writeFile(hooksPath, JSON.stringify(initialHooks, null, 2));

    // Dry-run does not modify files
    const preview = captureCli();
    expect(await runCli([
      'judgment:install', '--target', 'antigravity',
      '--origin', 'https://bb.unson.jp/runtime-mcp/',
      '--server', 'https://bb.unson.jp',
      '--project', 'unson-lab',
      '--allow-non-git',
      '--cwd-prefix', botDir,
      '--settings', hooksPath,
      '--config', configPath,
      '--dry-run',
    ], preview.io)).toBe(0);
    const previewJson = JSON.parse(preview.stdout());
    expect(previewJson.config.origin).toBe('https://bb.unson.jp/runtime-mcp');
    expect(previewJson.config.allow_non_git).toBe(true);
    expect(previewJson.config.project_code).toBe('unson-lab');
    expect(JSON.parse(await readFile(hooksPath, 'utf8'))).toEqual(initialHooks);

    // Real install
    const installed = captureCli();
    expect(await runCli([
      'judgment:install', '--target', 'antigravity',
      '--origin', 'https://bb.unson.jp/runtime-mcp',
      '--server', 'https://bb.unson.jp',
      '--project', 'unson-lab',
      '--allow-non-git',
      '--cwd-prefix', botDir,
      '--settings', hooksPath,
      '--config', configPath,
    ], installed.io)).toBe(0);

    const writtenConfig = JSON.parse(await readFile(configPath, 'utf8')) as AntigravityHookConfig;
    expect(writtenConfig.schema_version).toBe(ANTIGRAVITY_HOOK_CONFIG_SCHEMA);
    expect(writtenConfig.origin).toBe('https://bb.unson.jp/runtime-mcp');
    expect(writtenConfig.project_code).toBe('unson-lab');
    expect(writtenConfig.allow_non_git).toBe(true);
    expect(writtenConfig.cwd_prefixes).toHaveLength(1);

    const writtenHooks = JSON.parse(await readFile(hooksPath, 'utf8')) as Record<string, unknown>;
    expect(writtenHooks['orca-status']).toEqual(initialHooks['orca-status']);
    expect(writtenHooks[ANTIGRAVITY_HOOK_KEY]).toBeDefined();

    // Remove restores initial hooks.json
    const removed = captureCli();
    expect(await runCli([
      'judgment:install', '--target', 'antigravity',
      '--remove', '--settings', hooksPath, '--config', configPath,
    ], removed.io)).toBe(0);
    expect(JSON.parse(await readFile(hooksPath, 'utf8'))).toEqual(initialHooks);

    // judgment:antigravity-hook CLI fails open with exit 0 even on invalid JSON
    const badInput = captureCli();
    expect(await runCli(['judgment:antigravity-hook'], {
      ...badInput.io,
      stdin: Readable.from(['not valid json']),
    })).toBe(0);
    expect(JSON.parse(badInput.stdout())).toEqual({});
  });
});

describe('host acceptance for antigravity across HTTP, binding, and outcome contracts', () => {
  it('accepts x-brainbase-judgment-host: antigravity in handleRemoteJudgmentHookRequest', async () => {
    const trustedPrincipal = {
      personId: 'per_1',
      organizationId: 'org_1',
      tenantId: 'ten_1',
      projectCodes: ['unson-lab'],
    };
    const calls: unknown[] = [];
    const published: unknown[] = [];
    const userPrompt = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'ag-session',
      turn_id: 'ag-turn',
      cwd: '/home/ubuntu/.orca/bots/unson-lab',
    };

    const hosted = await handleRemoteJudgmentHookRequest({
      method: 'POST',
      url: REMOTE_JUDGMENT_HOOK_PATH,
      authorization: 'Bearer token',
      bearerToken: 'token',
      body: Buffer.from(JSON.stringify(userPrompt)),
      declaredHost: 'antigravity',
      personHostedClaudeCodeAllowed: true,
      trustedAuthKind: 'brainbase-jwt',
      trustedToken: 'person-jwt',
      trustedPrincipal,
      projectCode: 'unson-lab',
      isAuthorized: () => true,
      dispatch: async (_payload, projectCode, options) => {
        calls.push({ projectCode, options });
        return { output: {}, receiptId: 'res-ag', routeResolutionSha256: 'c'.repeat(64) };
      },
    });
    expect(hosted?.status).toBe(200);
    expect(calls).toEqual([{
      projectCode: 'unson-lab',
      options: {
        host: 'antigravity',
        trustedPrincipal,
        trustedToken: 'person-jwt',
        trustedAuthKind: 'brainbase-jwt',
      },
    }]);

    // PreToolUse and Stop journal publisher also work for antigravity
    const stopRes = await handleRemoteJudgmentHookRequest({
      method: 'POST',
      url: REMOTE_JUDGMENT_HOOK_PATH,
      authorization: 'Bearer token',
      bearerToken: 'token',
      body: Buffer.from(JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'ag-session',
        turn_id: 'ag-turn',
        last_assistant_message: 'done',
      })),
      declaredHost: 'antigravity',
      personHostedClaudeCodeAllowed: true,
      trustedAuthKind: 'brainbase-jwt',
      trustedToken: 'person-jwt',
      trustedPrincipal,
      projectCode: 'unson-lab',
      isAuthorized: () => true,
      dispatch: async () => ({ output: {} }),
      journalTurnPublisher: async (input) => { published.push(input); },
    });
    expect(stopRes?.status).toBe(200);
    expect(published).toHaveLength(1);

    // Unauthorized antigravity declaration is rejected
    const rejected = await handleRemoteJudgmentHookRequest({
      method: 'POST',
      url: REMOTE_JUDGMENT_HOOK_PATH,
      authorization: 'Bearer token',
      bearerToken: 'token',
      body: Buffer.from(JSON.stringify(userPrompt)),
      declaredHost: 'antigravity',
      personHostedClaudeCodeAllowed: false,
      localClaudeCodeAllowed: false,
      isAuthorized: () => true,
      dispatch: async () => ({ output: {} }),
    });
    expect(rejected).toEqual({ status: 400, body: { error: 'judgment_hook_host_unsupported' } });
  });

  it('honors antigravity in selectJudgmentProjectBinding, EXECUTION_OUTCOME_HOSTS, and knowledge event projection', () => {
    expect(selectJudgmentProjectBinding({
      hostRuntime: 'antigravity',
      configuredProjectCode: 'unson-lab',
      relayProjectCode: 'brainbase',
      ownerRepositoryProjectCode: 'owner-proj',
      sourceRepository: 'repo',
    })).toBe('unson-lab');

    expect(EXECUTION_OUTCOME_HOSTS.has('antigravity')).toBe(true);
    const outcome = normalizeJudgmentExecutionOutcome({
      schema_version: 'judgment_execution_outcome.v1',
      host: { type: 'antigravity', adapter_id: 'antigravity-hook', adapter_version: '1' },
      execution_id: 'exec-ag-1',
      turn_id: 'turn-ag-1',
      scope: 'host_turn',
      status: 'completed',
      stage: 'finalize',
      failure: null,
      resume_from: null,
      evidence: { state: 'confirmed', refs: ['receipt:turn-ag-1'] },
    });
    expect(outcome.host.type).toBe('antigravity');

    const event = toKnowledgeEventFromJudgmentEpisode({
      episode_id: 'ep-ag-1',
      session_id: 'sess-ag-1',
      turn_id: 'turn-ag-1',
      finalized_at: '2026-11-24T08:00:00.000Z',
      answer_digest: 'digest-ag-1',
      completion_status: 'complete',
      final_answer: 'Antigravity answer.',
      project_code: 'unson-lab',
      execution_outcome: outcome,
    });
    expect(event?.source.type).toBe('agent_judgment');
    expect(event?.source_pointer.uri).toBe('brainbase-judgment://antigravity/exec-ag-1#turn=turn-ag-1');
  });
});
