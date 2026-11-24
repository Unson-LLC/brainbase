import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __antigravityHookTestInternals,
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

async function canonicalTranscriptPath(home: string, conversationId: string): Promise<string> {
  const filePath = join(
    home,
    '.gemini',
    'antigravity-cli',
    'brain',
    conversationId,
    '.system_generated',
    'logs',
    'transcript.jsonl',
  );
  await mkdir(dirname(filePath), { recursive: true });
  return filePath;
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
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-1');
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
      transcript_path: await realpath(transcriptPath),
    });

    // Verify nested injectSteps[].systemMessage + turn_id guard + metadata.user_markdown
    expect(first.terminationBehavior).toBe('');
    const steps = first.injectSteps as Array<{ systemMessage: { systemMessage: string; metadata?: { user_markdown?: string } } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(steps[0].systemMessage.systemMessage).toContain('旧ターンの判断契約・先頭監査行は上書き');
    expect(steps[0].systemMessage.systemMessage.split('\n\n')[0]).not.toContain('owner_line');
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
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-sys');
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
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-pending' });
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
    const [stateFile] = (await readdir(turnDir)).filter((f) => f.endsWith('.json'));
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
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-crash');
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
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-full');
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

    // PostToolUse for Brainbase tool with missing transcript step -> fallback digest + success (both success and failure).
    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      stepIdx: 99,
      transcriptPath,
      toolCall: { id: 't5', name: 'mcp_brainbase-unson_get_entity', args: { id: 'ent_1' } },
    }, options);
    expect(sent[4].body.tool_response).toMatchObject({ success: true, digest: expect.stringMatching(/^sha256:/u) });
    expect(sent[4].body.tool_response).not.toHaveProperty('content');

    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-full',
      cwd: repo,
      stepIdx: 100,
      transcriptPath,
      error: 'mcp timeout',
      toolCall: { id: 't6', name: 'mcp_brainbase-unson_search', args: { query: 'missing' } },
    }, options);
    expect(sent[5].body.hook_event_name).toBe('PostToolUseFailure');
    expect(sent[5].body.tool_response).toMatchObject({ success: false, digest: expect.stringMatching(/^sha256:/u) });
    expect(sent[5].body.tool_response).not.toHaveProperty('content');
    expect(sent[5].body.error).toBe('mcp timeout');

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
    expect(sent[6].body).toMatchObject({
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
    expect(sent).toHaveLength(8);

    const canceledStop = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-full',
      cwd: repo,
      terminationReason: 'USER_CANCELED',
    }, options);
    expect(canceledStop).toEqual({ decision: '' });
    expect(sent).toHaveLength(8);

    // Since USER_CANCELED cleared turn_active, next PreInvocation opens a fresh turn.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-full',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Another prompt',
    }, options);
    expect(sent).toHaveLength(9);
  });

  it('extracts last_assistant_message and non-system USER_INPUT from bounded tail of large transcripts', async () => {
    const dir = await tempDir();
    const transcriptPath = join(dir, 'conv-large', '.system_generated', 'logs', 'transcript.jsonl');
    await mkdir(dirname(transcriptPath), { recursive: true });
    const filler = JSON.stringify({ step_index: 1, type: 'GENERIC', content: 'x'.repeat(10_000) });
    const lines = Array.from({ length: 35 }, () => filler);
    lines.push(JSON.stringify({ step_index: 50, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Tail user prompt' }));
    lines.push(JSON.stringify({ step_index: 51, source: 'SYSTEM_SDK', type: 'USER_INPUT', content: 'Reason Network: you are x' }));
    lines.push(JSON.stringify({ step_index: 52, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Tail assistant answer' }));
    await writeFile(transcriptPath, lines.join('\n') + '\n');

    const readOpts = { conversationId: 'conv-large', allowedTranscriptRoots: [dir] };
    expect(extractLatestNonSystemUserInput(transcriptPath, readOpts)).toEqual({ stepIndex: 50, content: 'Tail user prompt' });
    expect(extractLastAssistantMessage(transcriptPath, readOpts)).toBe('Tail assistant answer');
  });

  it('re-authorizes pending context in PreInvocation and discards it on cwd, endpoint, project, or login changes', async () => {
    const makePendingScenario = async (convId: string) => {
      const setup = await setupConfig({ project_code: 'proj-a' });
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      let currentLoginId = 'login-1';
      const dynamicToken = async () => ({ token: `jwt-${currentLoginId}`, loginId: currentLoginId });
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
              systemMessage: '📚 sensitive-pending-note',
              hookSpecificOutput: { additionalContext: 'SENSITIVE_PENDING_CONTEXT' },
            }
            : {},
        },
      }));
      const options = {
        env: testEnv,
        fetch: fetchImpl,
        accessToken: dynamicToken,
        configPath: setup.configPath,
        registrationId: REG,
      };
      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: convId,
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'Start authorized turn',
      }, options);
      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: convId,
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_p1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options);
      return {
        ...setup,
        turnDir,
        options,
        setLoginId: (id: string) => { currentLoginId = id; },
      };
    };

    // 1a. Moving cwd out of scope in same conversation drops pending context and does not inject even if returning later.
    {
      const sc = await makePendingScenario('conv-reauth-cwd');
      const outside = join(sc.home, 'outside-dir');
      await mkdir(outside, { recursive: true });
      const outScope = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-cwd',
        invocationNum: 2,
        cwd: outside,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(outScope).toEqual({});

      // Returning to repo must NOT inject discarded pending messages.
      const backInScope = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-cwd',
        invocationNum: 3,
        cwd: sc.repo,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(backInScope).toEqual({});
    }

    // 1b. Changing endpoint in config at same configPath drops pending context.
    {
      const sc = await makePendingScenario('conv-reauth-endpoint');
      await writeFile(sc.configPath, JSON.stringify({
        ...sc.config,
        endpoint: 'https://other-host.example.net/host/judgment/hook',
      }));
      const out = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-endpoint',
        invocationNum: 2,
        cwd: sc.repo,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(out).toEqual({});
    }

    // 1c. Changing project_code in config drops pending context.
    {
      const sc = await makePendingScenario('conv-reauth-project');
      await writeFile(sc.configPath, JSON.stringify({
        ...sc.config,
        project_code: 'proj-b',
      }));
      const out = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-project',
        invocationNum: 2,
        cwd: sc.repo,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(out).toEqual({});
    }

    // 1d. Changing login_server or loginId drops pending context.
    {
      const sc = await makePendingScenario('conv-reauth-login');
      sc.setLoginId('login-2');
      const out = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-login',
        invocationNum: 2,
        cwd: sc.repo,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(out).toEqual({});
      // Even switching back to login-1 must not resurrect discarded messages.
      sc.setLoginId('login-1');
      const after = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-reauth-login',
        invocationNum: 3,
        cwd: sc.repo,
        lastUserInput: 'Start authorized turn',
      }, sc.options);
      expect(after).toEqual({});
    }
  });

  it('prevents slow PostToolUse from resurrecting a Stop-closed turn or overwriting a newly opened turn', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-race' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };

    let releaseSlowPost!: () => void;
    let postEntered!: () => void;
    const slowPostGate = new Promise<void>((resolveGate) => { releaseSlowPost = resolveGate; });
    const postEnteredPromise = new Promise<void>((resolveEntered) => { postEntered = resolveEntered; });

    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.hook_event_name === 'PostToolUse') {
        postEntered();
        await slowPostGate;
        return new Response(JSON.stringify({
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {
            systemMessage: 'LATE_POST_SYSTEM',
            hookSpecificOutput: { additionalContext: 'LATE_POST_CONTEXT' },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: {},
      }), { status: 200 });
    }) as typeof fetch;

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // Case A: PostToolUse in flight while Stop closes the turn -> turn_active must stay false.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-race-stop',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Turn 1 prompt',
    }, options);

    const postPromise = handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-race-stop',
      cwd: repo,
      stepIdx: 2,
      toolCall: { id: 'toolu_slow', name: 'run_command', args: { CommandLine: 'echo slow' } },
    }, options);

    await postEnteredPromise;

    // Stop finishes while PostToolUse is waiting for HTTP.
    const stopOut = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-race-stop',
      cwd: repo,
      terminationReason: 'NO_TOOL_CALL',
    }, options);
    expect(stopOut).toEqual({ decision: '' });

    // Now let slow PostToolUse finish.
    releaseSlowPost();
    expect(await postPromise).toEqual({});

    const { readdir } = await import('node:fs/promises');
    const [stateFile] = (await readdir(turnDir)).filter((f) => f.endsWith('.json'));
    const persistedAfterStop = JSON.parse(await readFile(join(turnDir, stateFile), 'utf8'));
    expect(persistedAfterStop.turn_active).toBe(false);
    expect(persistedAfterStop.pending_messages).toEqual([]);

    // Case B: PostToolUse in flight while Stop closes Turn 1 AND Turn 2 opens -> Turn 2 state is untouched.
    let releaseSlowPost2!: () => void;
    let post2Entered!: () => void;
    const slowPostGate2 = new Promise<void>((resolveGate) => { releaseSlowPost2 = resolveGate; });
    const post2EnteredPromise = new Promise<void>((resolveEntered) => { post2Entered = resolveEntered; });
    const fetchImpl2 = (async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.hook_event_name === 'PostToolUse') {
        post2Entered();
        await slowPostGate2;
        return new Response(JSON.stringify({
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: { hookSpecificOutput: { additionalContext: 'STALE_TURN1_LEAK' } },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: {},
      }), { status: 200 });
    }) as typeof fetch;

    const options2 = { env: testEnv, fetch: fetchImpl2, accessToken: token, configPath, registrationId: REG };
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-race-newturn',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Turn 1',
    }, options2);

    const post2Promise = handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-race-newturn',
      cwd: repo,
      stepIdx: 2,
      toolCall: { id: 'toolu_slow2', name: 'run_command', args: { CommandLine: 'echo slow2' } },
    }, options2);

    await post2EnteredPromise;

    await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-race-newturn',
      cwd: repo,
      terminationReason: 'NO_TOOL_CALL',
    }, options2);

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-race-newturn',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Turn 2',
    }, options2);

    const stateFiles2 = (await readdir(turnDir)).filter((f) => f.endsWith('.json'));
    const newTurnStateBefore = (await Promise.all(
      stateFiles2.map(async (f) => ({ f, data: JSON.parse(await readFile(join(turnDir, f), 'utf8')) })),
    )).find((entry) => entry.data.turn_active === true && entry.data.turn_generation === 2)!;
    expect(newTurnStateBefore).toBeDefined();

    // Slow PostToolUse from Turn 1 completes now.
    releaseSlowPost2();
    expect(await post2Promise).toEqual({});

    const newTurnStateAfter = JSON.parse(await readFile(join(turnDir, newTurnStateBefore.f), 'utf8'));
    expect(newTurnStateAfter.turn_id).toBe(newTurnStateBefore.data.turn_id);
    expect(newTurnStateAfter.turn_generation).toBe(2);
    expect(newTurnStateAfter.turn_active).toBe(true);
    expect(newTurnStateAfter.pending_messages).toEqual([]);
  });

  it('rejects foreign-session transcripts, path traversal, symlinks, and non-regular FIFOs without blocking', async () => {
    const { home, repo, configPath, env } = await setupConfig();
    const otherTranscript = await canonicalTranscriptPath(home, 'conv-secret');
    await writeFile(otherTranscript, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'SECRET_OTHER_SESSION_PROMPT' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'SECRET_OTHER_SESSION_ANSWER' }),
    ].join('\n') + '\n');

    const { fetchImpl, sent } = mockHost();
    const options = { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // 3a. Foreign session transcriptPath rejected: no prompt extracted from other session.
    const foreignOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-current',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: otherTranscript,
      lastUserInput: 'Reason Network: system injected',
    }, options);
    expect(foreignOut).toEqual({});
    expect(sent).toHaveLength(0);

    // 3b. Path traversal into another session rejected.
    const currentLogsDir = dirname(await canonicalTranscriptPath(home, 'conv-current'));
    const traversalPath = join(currentLogsDir, '..', '..', '..', 'conv-secret', '.system_generated', 'logs', 'transcript.jsonl');
    expect(extractLatestNonSystemUserInput(traversalPath, { conversationId: 'conv-current', env })).toBeNull();
    expect(extractLastAssistantMessage(traversalPath, { conversationId: 'conv-current', env })).toBeUndefined();

    // 3c. Symlink inside current conversation pointing to foreign session rejected.
    const symlinkTranscript = join(currentLogsDir, 'transcript.jsonl');
    await symlink(otherTranscript, symlinkTranscript);
    expect(extractLatestNonSystemUserInput(symlinkTranscript, { conversationId: 'conv-current', env })).toBeNull();

    // 3d. FIFO (named pipe) at exact valid transcript path fails open immediately without blocking.
    const fifoConvDir = dirname(await canonicalTranscriptPath(home, 'conv-fifo'));
    const fifoPath = join(fifoConvDir, 'transcript.jsonl');
    const mkfifoResult = spawnSync('mkfifo', [fifoPath]);
    expect(mkfifoResult.status).toBe(0);

    const startedAt = Date.now();
    expect(extractLatestNonSystemUserInput(fifoPath, { conversationId: 'conv-fifo', env })).toBeNull();
    expect(extractLastAssistantMessage(fifoPath, { conversationId: 'conv-fifo', env })).toBeUndefined();
    const fifoHookOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-fifo',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: fifoPath,
      lastUserInput: 'Reason Network: system only',
    }, options);
    const elapsedMs = Date.now() - startedAt;
    expect(fifoHookOut).toEqual({});
    expect(elapsedMs).toBeLessThan(1_000);
    expect(sent).toHaveLength(0);
  });

  it('does not overwrite a newly opened turn when concurrent PreInvocation calls race on the turn lock', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-race-pre' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const { fetchImpl, sent } = mockHost();
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    const key = __antigravityHookTestInternals.turnKey('conv-concurrent-pre', configPath);
    let releaseBarrier!: () => void;
    let barrierEntered!: () => void;
    const barrierGate = new Promise<void>((resolveGate) => { releaseBarrier = resolveGate; });
    const barrierEnteredPromise = new Promise<void>((resolveEntered) => { barrierEntered = resolveEntered; });

    // Hold the turn lock briefly so both PreInvocation calls block on the exact same lock boundary.
    const barrier = __antigravityHookTestInternals.withTurnStateLock(testEnv, key, async () => {
      barrierEntered();
      await barrierGate;
    });
    await barrierEnteredPromise;

    const payload = {
      hookEventName: 'PreInvocation',
      conversationId: 'conv-concurrent-pre',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Concurrent prompt',
    };
    const callA = handleAntigravityJudgmentHook(payload, options);
    const callB = handleAntigravityJudgmentHook(payload, options);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    releaseBarrier();
    await barrier;

    const [outA, outB] = await Promise.all([callA, callB]);
    // Exactly one contender opened the turn and sent UserPromptSubmit; the other saw it inside the single lock.
    expect(sent).toHaveLength(1);
    const injectedCount = [outA, outB].filter((o) => Array.isArray(o.injectSteps)).length;
    const noopCount = [outA, outB].filter((o) => Object.keys(o).length === 0).length;
    expect(injectedCount).toBe(1);
    expect(noopCount).toBe(1);

    const persisted = JSON.parse(await readFile(__antigravityHookTestInternals.statePath(testEnv, key), 'utf8'));
    expect(persisted.turn_generation).toBe(1);
    expect(persisted.turn_active).toBe(true);
    expect(persisted.start_status).toBe('started');

    // Out-of-order PreInvocation with an older step_index must not overwrite a newer active turn.
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-order');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 5,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Newer turn prompt',
    }) + '\n');
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-order',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Newer turn prompt',
    }, options);
    expect(sent).toHaveLength(2);
    const orderKey = __antigravityHookTestInternals.turnKey('conv-order', configPath);
    const newerState = JSON.parse(await readFile(__antigravityHookTestInternals.statePath(testEnv, orderKey), 'utf8'));

    await writeFile(transcriptPath, JSON.stringify({
      step_index: 2,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Older delayed prompt',
    }) + '\n');
    const delayedOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-order',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Older delayed prompt',
    }, options);
    expect(delayedOut).toEqual({});
    expect(sent).toHaveLength(2);
    const afterDelayed = JSON.parse(await readFile(__antigravityHookTestInternals.statePath(testEnv, orderKey), 'utf8'));
    expect(afterDelayed.turn_id).toBe(newerState.turn_id);
    expect(afterDelayed.turn_generation).toBe(newerState.turn_generation);
  });

  it('rejects delayed older or duplicate step_index PreInvocation even after a newer turn is closed by Stop', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-order-closed' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const { fetchImpl, sent } = mockHost();
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    const transcriptPath = await canonicalTranscriptPath(home, 'conv-closed-step');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 10,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 10 prompt',
    }) + '\n');

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-closed-step',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 10 prompt',
    }, options);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.hook_event_name).toBe('UserPromptSubmit');

    const stopOut = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-closed-step',
      cwd: repo,
      transcriptPath,
      terminationReason: 'NO_TOOL_CALL',
    }, options);
    expect(stopOut).toEqual({ decision: '' });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.hook_event_name).toBe('Stop');

    const key = __antigravityHookTestInternals.turnKey('conv-closed-step', configPath);
    const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);
    const closedState = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(closedState.turn_active).toBe(false);
    expect(closedState.last_opened_user_step_index).toBe(10);

    // Delayed older PreInvocation (step_index 5) arrives AFTER step 10 closed -> MUST NOT open a turn or send UserPromptSubmit.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 5,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Delayed step 5 prompt',
    }) + '\n');
    const delayedOlder = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-closed-step',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Delayed step 5 prompt',
    }, options);
    expect(delayedOlder).toEqual({});
    expect(sent).toHaveLength(2);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual(closedState);

    // Duplicate delayed PreInvocation for the already-closed step_index 10 -> MUST NOT reopen or re-send UserPromptSubmit.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 10,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 10 prompt',
    }) + '\n');
    const duplicateClosed = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-closed-step',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 10 prompt',
    }, options);
    expect(duplicateClosed).toEqual({});
    expect(sent).toHaveLength(2);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual(closedState);

    // Genuine next human turn at step_index 11 -> opens a new turn cleanly.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 11,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Fresh step 11 prompt',
    }) + '\n');
    const nextTurn = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-closed-step',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Fresh step 11 prompt',
    }, options);
    expect(Array.isArray(nextTurn.injectSteps)).toBe(true);
    expect(sent).toHaveLength(3);
    expect(sent[2].body.hook_event_name).toBe('UserPromptSubmit');
    expect(sent[2].body.prompt).toBe('Fresh step 11 prompt');
    const reopenedState = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(reopenedState.turn_active).toBe(true);
    expect(reopenedState.turn_generation).toBe(2);
    expect(reopenedState.current_turn_user_step_index).toBe(11);
    expect(reopenedState.last_closed_user_step_index).toBe(10);
    expect(reopenedState.last_opened_user_step_index).toBe(11);
  });

  it('keeps closed step index separate from an active unnumbered turn and rejects delayed closed-step PreInvocation without draining pending context', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-step-sep' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const { fetchImpl, sent } = mockHost((body) => ({
      status: 200,
      body: {
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: body.hook_event_name === 'PostToolUse'
          ? {
            systemMessage: 'NEW_UNNUMBERED_TURN_BANNER',
            hookSpecificOutput: { additionalContext: 'NEW_UNNUMBERED_TURN_PENDING_CONTEXT' },
          }
          : body.hook_event_name === 'UserPromptSubmit'
            ? {
              systemMessage: 'init-banner',
              hookSpecificOutput: { additionalContext: 'init-context' },
            }
            : {},
      },
    }));
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };
    const key = __antigravityHookTestInternals.turnKey('conv-step-sep', configPath);
    const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);

    // 1. Open turn at step_index 10 and close it via Stop.
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-step-sep');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 10,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 10 prompt',
    }) + '\n');

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 10 prompt',
    }, options);
    expect(sent).toHaveLength(1);

    const activeStep10 = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(activeStep10.current_turn_user_step_index).toBe(10);
    expect(activeStep10.last_closed_user_step_index).toBeNull();

    const stopOut = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-step-sep',
      cwd: repo,
      transcriptPath,
      terminationReason: 'NO_TOOL_CALL',
    }, options);
    expect(stopOut).toEqual({ decision: '' });
    expect(sent).toHaveLength(2);

    const closedStep10 = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(closedStep10.turn_active).toBe(false);
    expect(closedStep10.current_turn_user_step_index).toBeNull();
    expect(closedStep10.last_closed_user_step_index).toBe(10);

    // 2. Open a new UNNUMBERED turn (no transcriptPath -> currentUserStepIndex === null).
    const unnumberedOpen = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Unnumbered Turn 2 prompt',
    }, options);
    expect(Array.isArray(unnumberedOpen.injectSteps)).toBe(true);
    expect(sent).toHaveLength(3);
    expect(sent[2].body.hook_event_name).toBe('UserPromptSubmit');
    expect(sent[2].body.prompt).toBe('Unnumbered Turn 2 prompt');

    const unnumberedState = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(unnumberedState.turn_active).toBe(true);
    expect(unnumberedState.turn_generation).toBe(2);
    expect(unnumberedState.current_turn_user_step_index).toBeNull();
    expect(unnumberedState.last_closed_user_step_index).toBe(10);
    expect(unnumberedState.last_opened_user_step_index).toBeNull();

    // 3. Queue pending context on the active unnumbered Turn 2 via PostToolUse.
    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-step-sep',
      cwd: repo,
      stepIdx: 2,
      toolCall: { id: 'toolu_unnum_1', name: 'run_command', args: { CommandLine: 'ls' } },
    }, options);
    expect(postOut).toEqual({});
    expect(sent).toHaveLength(4);

    const withPending = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(withPending.pending_messages).toHaveLength(1);
    expect(withPending.pending_messages[0].additional_context).toBe('NEW_UNNUMBERED_TURN_PENDING_CONTEXT');

    // 4. Delayed step 10 PreInvocation arrives (both invocationNum 2 and invocationNum 1) ->
    //    MUST be unconditionally rejected ({}), MUST NOT open a new turn, and MUST NOT drain or consume pending_messages.
    for (const invNum of [2, 1]) {
      const delayedStep10 = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-step-sep',
        invocationNum: invNum,
        cwd: repo,
        transcriptPath,
        lastUserInput: 'Step 10 prompt',
      }, options);
      expect(delayedStep10).toEqual({});
      expect(sent).toHaveLength(4);
      const persistedAfterDelayed = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(persistedAfterDelayed.turn_id).toBe(unnumberedState.turn_id);
      expect(persistedAfterDelayed.turn_generation).toBe(2);
      expect(persistedAfterDelayed.current_turn_user_step_index).toBeNull();
      expect(persistedAfterDelayed.last_closed_user_step_index).toBe(10);
      expect(persistedAfterDelayed.pending_messages).toHaveLength(1);
    }

    // 5. Delayed older step 5 PreInvocation is also rejected without touching pending_messages.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 5,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Delayed step 5 prompt',
    }) + '\n');
    const delayedStep5 = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Delayed step 5 prompt',
    }, options);
    expect(delayedStep5).toEqual({});
    expect(sent).toHaveLength(4);
    expect(JSON.parse(await readFile(stateFile, 'utf8')).pending_messages).toHaveLength(1);

    // 6. Legitimate next PreInvocation of the active unnumbered Turn 2 drains and injects its untouched pending context.
    const drained = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 2,
      cwd: repo,
      lastUserInput: 'Unnumbered Turn 2 prompt',
    }, options);
    const serialized = JSON.stringify(drained);
    expect(serialized).toContain('NEW_UNNUMBERED_TURN_PENDING_CONTEXT');
    expect(serialized).toContain('NEW_UNNUMBERED_TURN_BANNER');
    expect(JSON.parse(await readFile(stateFile, 'utf8')).pending_messages).toEqual([]);

    // 7. Superseding an active numbered turn (step 12 -> step 15 without Stop) monotonically updates last_closed_user_step_index to 12.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 12,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 12 prompt',
    }) + '\n');
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 12 prompt',
    }, options);
    const step12State = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(step12State.current_turn_user_step_index).toBe(12);
    expect(step12State.last_closed_user_step_index).toBe(10);

    await writeFile(transcriptPath, JSON.stringify({
      step_index: 15,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 15 prompt',
    }) + '\n');
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 15 prompt',
    }, options);
    const step15State = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(step15State.current_turn_user_step_index).toBe(15);
    expect(step15State.last_closed_user_step_index).toBe(12);

    // Delayed step 12 after supersession is rejected.
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 12,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Step 12 prompt',
    }) + '\n');
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-step-sep',
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Step 12 prompt',
    }, options)).toEqual({});
  });

  it('migrates legacy turn state fail-closed so delayed step 10 is rejected without consuming pending_messages', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-legacy-mig' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const { fetchImpl, sent } = mockHost((body) => ({
      status: 200,
      body: {
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: body.hook_event_name === 'PostToolUse'
          ? {
            systemMessage: 'LEGACY_ACTIVE_TURN_BANNER',
            hookSpecificOutput: { additionalContext: 'LEGACY_ACTIVE_TURN_PENDING_CONTEXT' },
          }
          : {},
      },
    }));
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };
    const key = __antigravityHookTestInternals.turnKey('conv-legacy-mig', configPath);
    const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);

    // 1. Open an active unnumbered turn and queue pending context via PostToolUse.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-legacy-mig',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Active unnumbered turn prompt',
    }, options);
    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-legacy-mig',
      cwd: repo,
      stepIdx: 2,
      toolCall: { id: 'toolu_legacy_1', name: 'run_command', args: { CommandLine: 'ls' } },
    }, options);
    expect(sent).toHaveLength(2);

    // 2. Rewrite persisted state into the legacy JSON format:
    //    turn_active: true, last_opened_user_step_index: 10, pending_messages present,
    //    and WITHOUT current_turn_user_step_index / last_closed_user_step_index keys.
    const rawState = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, unknown>;
    delete rawState.current_turn_user_step_index;
    delete rawState.last_closed_user_step_index;
    rawState.turn_active = true;
    rawState.last_opened_user_step_index = 10;
    await writeFile(stateFile, JSON.stringify(rawState));

    // 3. Delayed step 10 PreInvocation arrives -> MUST be rejected ({}) and MUST preserve pending_messages.
    const transcriptPath = await canonicalTranscriptPath(home, 'conv-legacy-mig');
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 10,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Delayed step 10 prompt',
    }) + '\n');

    for (const invNum of [2, 1]) {
      const delayedStep10 = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-legacy-mig',
        invocationNum: invNum,
        cwd: repo,
        transcriptPath,
        lastUserInput: 'Delayed step 10 prompt',
      }, options);
      expect(delayedStep10).toEqual({});
      expect(sent).toHaveLength(2);
      const afterDelayed = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(afterDelayed.pending_messages).toHaveLength(1);
      expect(afterDelayed.pending_messages[0].additional_context).toBe('LEGACY_ACTIVE_TURN_PENDING_CONTEXT');
    }

    // 4. Legitimate unnumbered PreInvocation for the active turn still drains and injects the preserved pending_messages.
    const drained = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-legacy-mig',
      invocationNum: 2,
      cwd: repo,
      lastUserInput: 'Active unnumbered turn prompt',
    }, options);
    expect(JSON.stringify(drained)).toContain('LEGACY_ACTIVE_TURN_PENDING_CONTEXT');
    expect(JSON.stringify(drained)).toContain('LEGACY_ACTIVE_TURN_BANNER');
    const afterDrain = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(afterDrain.pending_messages).toEqual([]);
    expect(afterDrain.current_turn_user_step_index).toBeNull();
    expect(afterDrain.last_closed_user_step_index).toBe(10);
  });

  it('does not inject initial context when Stop closes or a new turn supersedes the turn during UserPromptSubmit HTTP wait', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-closed' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };

    // Case 2a: Stop closes turn while UserPromptSubmit HTTP is in flight.
    let releasePromptHttp!: () => void;
    let promptHttpEntered!: () => void;
    const promptHttpGate = new Promise<void>((resolveGate) => { releasePromptHttp = resolveGate; });
    const promptHttpEnteredPromise = new Promise<void>((resolveEntered) => { promptHttpEntered = resolveEntered; });

    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.hook_event_name === 'UserPromptSubmit') {
        promptHttpEntered();
        await promptHttpGate;
        return new Response(JSON.stringify({
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {
            systemMessage: 'MUST_NOT_INJECT_CLOSED_TURN',
            hookSpecificOutput: { additionalContext: 'STALE_INITIAL_CONTEXT' },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: {},
      }), { status: 200 });
    }) as typeof fetch;

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };
    const prePromise = handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-stop-during-http',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Turn closed mid-flight',
    }, options);

    await promptHttpEnteredPromise;

    // Stop closes the turn while UserPromptSubmit is awaiting HTTP.
    const stopOut = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-stop-during-http',
      cwd: repo,
      terminationReason: 'USER_CANCELED',
    }, options);
    expect(stopOut).toEqual({ decision: '' });

    releasePromptHttp();
    const preOut = await prePromise;
    expect(preOut).toEqual({});

    const key = __antigravityHookTestInternals.turnKey('conv-stop-during-http', configPath);
    const persisted = JSON.parse(await readFile(__antigravityHookTestInternals.statePath(testEnv, key), 'utf8'));
    expect(persisted.turn_active).toBe(false);
    expect(persisted.start_status).toBe('failed');

    // Case 2b: A newer turn supersedes Turn 1 while Turn 1's UserPromptSubmit HTTP is still in flight.
    let releaseTurn1Http!: () => void;
    let turn1Entered!: () => void;
    const turn1Gate = new Promise<void>((resolveGate) => { releaseTurn1Http = resolveGate; });
    const turn1EnteredPromise = new Promise<void>((resolveEntered) => { turn1Entered = resolveEntered; });

    const fetchSupersede = (async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.prompt === 'Slow Turn 1') {
        turn1Entered();
        await turn1Gate;
        return new Response(JSON.stringify({
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {
            systemMessage: 'OLD_TURN_1_MUST_NOT_INJECT',
            hookSpecificOutput: { additionalContext: 'OLD_TURN_1_CONTEXT' },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        schema_version: '1',
        accepted: true,
        hook_event_name: body.hook_event_name,
        session_id: body.session_id,
        turn_id: body.turn_id,
        output: {
          systemMessage: 'NEW_TURN_2_OK',
          hookSpecificOutput: { additionalContext: 'NEW_TURN_2_CONTEXT' },
        },
      }), { status: 200 });
    }) as typeof fetch;

    const opts2 = { env: testEnv, fetch: fetchSupersede, accessToken: token, configPath, registrationId: REG };
    const slowTurn1 = handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-superseded-http',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Slow Turn 1',
    }, opts2);
    await turn1EnteredPromise;

    const fastTurn2 = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-superseded-http',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Fast Turn 2',
    }, opts2);
    expect(JSON.stringify(fastTurn2)).toContain('NEW_TURN_2_CONTEXT');

    releaseTurn1Http();
    expect(await slowTurn1).toEqual({});

    const key2 = __antigravityHookTestInternals.turnKey('conv-superseded-http', configPath);
    const persisted2 = JSON.parse(await readFile(__antigravityHookTestInternals.statePath(testEnv, key2), 'utf8'));
    expect(persisted2.turn_generation).toBe(2);
    expect(persisted2.turn_active).toBe(true);
    expect(persisted2.start_status).toBe('started');
  });

  it('uses OS-managed flock on a fixed non-deleted lock file, serializes concurrent and cross-process contenders, and fails open safely on timeout or unavailability', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-flock' });
    const turnDir = join(home, 'turns');
    await mkdir(turnDir, { recursive: true });
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir } as NodeJS.ProcessEnv;
    const key = 'os-flock-key';
    const lockPath = __antigravityHookTestInternals.lockPathFor(testEnv, key);

    // 1. First acquisition creates the fixed lock file and NEVER unlinks it after release; subsequent acquisitions reuse the exact same inode.
    await __antigravityHookTestInternals.withTurnStateLock(testEnv, key, () => {});
    const firstStat = lstatSync(lockPath, { bigint: true });
    expect(firstStat.isFile()).toBe(true);

    await __antigravityHookTestInternals.withTurnStateLock(testEnv, key, () => {});
    const secondStat = lstatSync(lockPath, { bigint: true });
    expect(secondStat.dev).toBe(firstStat.dev);
    expect(secondStat.ino).toBe(firstStat.ino);

    // 2. 8-way concurrent in-process contenders are strictly serialized (maxActive === 1) on the same fixed lock inode.
    let active = 0;
    let maxActive = 0;
    await Promise.all(Array.from({ length: 8 }, () => __antigravityHookTestInternals.withTurnStateLock(testEnv, key, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
      active -= 1;
    }, { timeoutMs: 5_000 })));
    expect(maxActive).toBe(1);
    expect(lstatSync(lockPath, { bigint: true }).ino).toBe(firstStat.ino);

    // 3. Cross-process OS flock mutual exclusion: a separate process holding `flock` blocks our contender until released.
    const holder = spawn('flock', ['-x', lockPath, process.execPath, '-e', 'console.log("LOCKED"); process.stdin.resume();'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    await new Promise<void>((resolveReady, rejectReady) => {
      holder.once('error', rejectReady);
      holder.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('LOCKED')) resolveReady();
      });
    });

    try {
      // While the external process holds the OS flock, a short-timeout acquisition fails closed with lock timeout.
      await expect(__antigravityHookTestInternals.withTurnStateLock(testEnv, key, () => 'should-not-run', {
        timeoutMs: 80,
      })).rejects.toThrow('antigravity_turn_state_lock_timeout');

      // Start a waiting contender, then release the external holder -> waiter succeeds strictly after release.
      let waiterEntered = false;
      const waiter = __antigravityHookTestInternals.withTurnStateLock(testEnv, key, () => {
        waiterEntered = true;
        return 'acquired-after-holder';
      }, { timeoutMs: 3_000 });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
      expect(waiterEntered).toBe(false);

      holder.kill('SIGTERM');
      await new Promise<void>((resolveExit) => holder.once('close', () => resolveExit()));
      expect(await waiter).toBe('acquired-after-holder');
      expect(lstatSync(lockPath, { bigint: true }).ino).toBe(firstStat.ino);
    } finally {
      if (holder.exitCode === null && holder.signalCode === null) {
        holder.kill('SIGKILL');
      }
    }

    // 4. Hook fail-open & state preservation on lock timeout and on unavailable OS lock binary.
    const { fetchImpl, sent } = mockHost();
    const baseOptions = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // Establish an active turn first.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-flock-failopen',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Initial turn',
    }, baseOptions);
    expect(sent).toHaveLength(1);

    const hookKey = __antigravityHookTestInternals.turnKey('conv-flock-failopen', configPath);
    const hookStatePath = __antigravityHookTestInternals.statePath(testEnv, hookKey);
    const persistedBefore = await readFile(hookStatePath, 'utf8');

    // Hold the turn lock while invoking PreInvocation & Stop with a short lock timeout -> fail-open, state untouched.
    let releaseHold!: () => void;
    let holdEntered!: () => void;
    const holdGate = new Promise<void>((resolveGate) => { releaseHold = resolveGate; });
    const holdEnteredPromise = new Promise<void>((resolveEntered) => { holdEntered = resolveEntered; });
    const hold = __antigravityHookTestInternals.withTurnStateLock(testEnv, hookKey, async () => {
      holdEntered();
      await holdGate;
    });
    await holdEnteredPromise;

    try {
      const timedOutPre = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-flock-failopen',
        invocationNum: 1,
        cwd: repo,
        lastUserInput: 'Different prompt while locked',
      }, { ...baseOptions, turnLock: { timeoutMs: 60 } });
      expect(timedOutPre).toEqual({});

      const timedOutStop = await handleAntigravityJudgmentHook({
        hookEventName: 'Stop',
        conversationId: 'conv-flock-failopen',
        cwd: repo,
        terminationReason: 'NO_TOOL_CALL',
      }, { ...baseOptions, turnLock: { timeoutMs: 60 } });
      expect(timedOutStop).toEqual({ decision: '' });

      expect(sent).toHaveLength(1);
      expect(await readFile(hookStatePath, 'utf8')).toBe(persistedBefore);
    } finally {
      releaseHold();
      await hold;
    }

    // Unavailable OS lock binary -> fail-closed on state (no overwrite, no HTTP), fail-open on output.
    const unavailableOpts = { ...baseOptions, turnLock: { flockBinary: '/nonexistent/flock-binary-unavailable' } };
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-flock-failopen',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Prompt with unavailable flock',
    }, unavailableOpts)).toEqual({});
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-flock-failopen',
      cwd: repo,
      terminationReason: 'NO_TOOL_CALL',
    }, unavailableOpts)).toEqual({ decision: '' });
    expect(sent).toHaveLength(1);
    expect(await readFile(hookStatePath, 'utf8')).toBe(persistedBefore);
  });

  it('enforces kernel openat + O_NOFOLLOW per component under allowed root, rejects symlink/FIFO swaps without blocking, and fails closed when helper is unavailable', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const outsideDir = join(dir, 'outside-secret');
    await mkdir(outsideDir, { recursive: true });
    const outsideTranscript = join(outsideDir, 'transcript.jsonl');
    await writeFile(outsideTranscript, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'OUTSIDE_SECRET_PROMPT',
    }) + '\n');

    const sysGenDir = join(allowedRoot, 'conv-toctou', '.system_generated');
    const logsDir = join(sysGenDir, 'logs');
    await mkdir(logsDir, { recursive: true });
    const insideTranscript = join(logsDir, 'transcript.jsonl');
    await writeFile(insideTranscript, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'LEGITIMATE_INSIDE_PROMPT',
    }) + '\n');

    const readOpts = { conversationId: 'conv-toctou', allowedTranscriptRoots: [allowedRoot] };
    // Baseline legitimate read succeeds through kernel openat helper.
    const baseline = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].content).toBe('LEGITIMATE_INSIDE_PROMPT');

    // Case 4a: Parent dir `logs` is swapped to an outside symlink right after validation and before openat().
    const backupLogsDir = join(sysGenDir, 'logs-backup');
    const entriesAfterParentSwap = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      onBeforeOpen: () => {
        renameSync(logsDir, backupLogsDir);
        symlinkSync(outsideDir, logsDir);
      },
    });
    expect(entriesAfterParentSwap).toEqual([]);
    await rm(logsDir, { force: true });
    renameSync(backupLogsDir, logsDir);

    // Case 4b: Higher intermediate dir `.system_generated` is swapped to a symlink pointing outside right before openat().
    const outsideSysGen = join(outsideDir, 'fake-sysgen');
    await mkdir(join(outsideSysGen, 'logs'), { recursive: true });
    await writeFile(join(outsideSysGen, 'logs', 'transcript.jsonl'), JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'OUTSIDE_INTERMEDIATE_SYMLINK_SECRET',
    }) + '\n');
    const backupSysGenDir = join(allowedRoot, 'conv-toctou', '.system_generated-backup');
    const entriesAfterIntermediateSwap = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      onBeforeOpen: () => {
        renameSync(sysGenDir, backupSysGenDir);
        symlinkSync(outsideSysGen, sysGenDir);
      },
    });
    expect(entriesAfterIntermediateSwap).toEqual([]);
    await rm(sysGenDir, { force: true });
    renameSync(backupSysGenDir, sysGenDir);

    // Case 4c: Leaf file `transcript.jsonl` is swapped to a symlink pointing outside right before openat().
    const backupFile = join(logsDir, 'transcript.jsonl.backup');
    const entriesAfterLeafSymlinkSwap = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      onBeforeOpen: () => {
        renameSync(insideTranscript, backupFile);
        symlinkSync(outsideTranscript, insideTranscript);
      },
    });
    expect(entriesAfterLeafSymlinkSwap).toEqual([]);
    unlinkSync(insideTranscript);
    renameSync(backupFile, insideTranscript);

    // Case 4d: Leaf file is swapped to a FIFO right before openat() -> O_NONBLOCK + fstat(S_ISREG) rejects immediately without blocking.
    const fifoStart = Date.now();
    const entriesAfterFifoSwap = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      onBeforeOpen: () => {
        renameSync(insideTranscript, backupFile);
        const mk = spawnSync('mkfifo', [insideTranscript]);
        if (mk.status !== 0) throw new Error('mkfifo failed');
      },
    });
    const fifoElapsedMs = Date.now() - fifoStart;
    expect(entriesAfterFifoSwap).toEqual([]);
    expect(fifoElapsedMs).toBeLessThan(1_000);
    unlinkSync(insideTranscript);
    renameSync(backupFile, insideTranscript);

    // Case 4e: Fail-closed when kernel openat helper is unavailable, non-POSIX, exits non-zero, or times out (NO openSync fallback).
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatHelperBinary: '/nonexistent/python3-openat-helper-unavailable',
    })).toEqual([]);
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatHelperBinary: '',
    })).toEqual([]);
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      platform: 'win32',
    })).toEqual([]);

    const failingHelper = join(dir, 'fail-helper.sh');
    await writeFile(failingHelper, '#!/bin/sh\nexit 1\n');
    chmodSync(failingHelper, 0o755);
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatHelperBinary: failingHelper,
    })).toEqual([]);

    const slowHelper = join(dir, 'slow-helper.sh');
    await writeFile(slowHelper, '#!/bin/sh\nsleep 2\n');
    chmodSync(slowHelper, 0o755);
    const timeoutStart = Date.now();
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatHelperBinary: slowHelper,
      helperTimeoutMs: 80,
    })).toEqual([]);
    expect(Date.now() - timeoutStart).toBeLessThan(1_000);

    // End-to-end hook fail-closed check when openat helper binary is unavailable.
    const { home, repo, configPath, env } = await setupConfig();
    const hookTranscript = await canonicalTranscriptPath(home, 'conv-no-helper');
    await writeFile(hookTranscript, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'TRANSCRIPT_ONLY_PROMPT',
    }) + '\n');
    const { fetchImpl, sent } = mockHost();
    const noHelperOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-no-helper',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: hookTranscript,
      lastUserInput: 'Reason Network: system only',
    }, {
      env,
      fetch: fetchImpl,
      accessToken: token,
      configPath,
      registrationId: REG,
      transcriptOpenatBinary: '/nonexistent/python3-unavailable',
    });
    expect(noHelperOut).toEqual({});
    expect(sent).toHaveLength(0);
  });

  it('never falls back to PATH python3 when fixed absolute candidates are unavailable', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const logsDir = join(allowedRoot, 'conv-no-path-fallback', '.system_generated', 'logs');
    await mkdir(logsDir, { recursive: true });
    const insideTranscript = join(logsDir, 'transcript.jsonl');
    await writeFile(insideTranscript, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'LEGITIMATE_PROMPT',
    }) + '\n');

    // Place a malicious fake `python3` on PATH that writes a marker file and emits valid JSONL.
    const fakeBinDir = join(dir, 'fake-path-bin');
    await mkdir(fakeBinDir, { recursive: true });
    const markerPath = join(dir, 'fake-python3-executed.marker');
    const fakePython = join(fakeBinDir, 'python3');
    await writeFile(
      fakePython,
      [
        '#!/bin/sh',
        `printf 'executed' > '${markerPath.replace(/'/g, "'\\''")}'`,
        'printf \'{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"POISONED_PATH_PYTHON3"}\\n\'',
        'exit 0',
      ].join('\n') + '\n',
    );
    chmodSync(fakePython, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`;
    try {
      // Confirm PATH genuinely resolves bare `python3` to our fake binary.
      const resolvedOnPath = spawnSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' });
      expect(resolvedOnPath.status).toBe(0);
      expect(resolvedOnPath.stdout.trim()).toBe(fakePython);

      // Direct resolver checks: empty/missing/relative/directory candidates all fail closed (null).
      expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(undefined, 'linux', [])).toBeNull();
      expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(
        undefined,
        'linux',
        ['/nonexistent/a/python3', '/nonexistent/b/python3'],
      )).toBeNull();
      expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(undefined, 'linux', ['python3'])).toBeNull();
      expect(__antigravityHookTestInternals.resolveOpenatHelperBinary('python3', 'linux')).toBeNull();
      expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(fakeBinDir, 'linux')).toBeNull();

      const readOpts = { conversationId: 'conv-no-path-fallback', allowedTranscriptRoots: [allowedRoot] };

      // Empty or nonexistent fixed candidates MUST return [] and MUST NOT execute fake PATH python3.
      expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
        openatHelperCandidates: [],
      })).toEqual([]);
      expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
        openatHelperCandidates: ['/nonexistent/a/python3', '/nonexistent/b/python3'],
      })).toEqual([]);
      expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
        openatHelperCandidates: ['python3'],
      })).toEqual([]);
      expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
        openatHelperBinary: 'python3',
      })).toEqual([]);

      expect(existsSync(markerPath)).toBe(false);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it('uses Linux openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS) exclusively without staged openat fallback and fails closed on ENOSYS/EPERM, rename escapes, and non-Linux platforms (darwin)', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const outsideDir = join(dir, 'outside-escape');
    await mkdir(outsideDir, { recursive: true });

    const convDir = join(allowedRoot, 'conv-rename-escape');
    const logsDir = join(convDir, '.system_generated', 'logs');
    await mkdir(logsDir, { recursive: true });
    const insideTranscript = join(logsDir, 'transcript.jsonl');
    await writeFile(insideTranscript, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'OPENAT2_VERIFIED_CONTENT',
    }) + '\n');

    const escapedConvDir = join(outsideDir, 'escaped-conv');
    const readOpts = { conversationId: 'conv-rename-escape', allowedTranscriptRoots: [allowedRoot] };

    // 1. Verify production helper script uses Linux openat2(2) exclusively and has NO staged openat fallback path.
    const helperSource = __antigravityHookTestInternals.PYTHON_OPENAT_TAIL_READER;
    expect(helperSource).toContain('sys.platform.startswith("linux")');
    expect(helperSource).toContain('RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS');
    expect(helperSource).toContain('syscall_fn(ctypes.c_long(437)');
    expect(helperSource).toContain('verify_fd_exact_path(file_fd, expected_exact_path)');
    expect(helperSource).not.toContain('segments[:-1]');
    expect(helperSource).not.toContain('return None');

    // 2. Normal path on Linux succeeds via openat2(2) with no fallback path present.
    const baseline = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].content).toBe('OPENAT2_VERIFIED_CONTENT');

    // 3. openat2 unavailable / denied (ENOSYS / EPERM) fails closed immediately with [] (zero fallback).
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatTestFaults: { forceOpenat2Errno: 'ENOSYS' },
    })).toEqual([]);
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatTestFaults: { forceOpenat2Errno: 'EPERM' },
    })).toEqual([]);

    // 4. Missing file / symlink swap / pre-open & post-read rename escape are rejected by openat2 + /proc/self/fd.
    const missingTranscript = join(logsDir, 'transcript_full.jsonl');
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(missingTranscript, readOpts)).toEqual([]);

    const afterReadEscape = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      openatTestFaults: {
        renameAfterTailRead: { from: convDir, to: escapedConvDir },
      },
    });
    expect(afterReadEscape).toEqual([]);
    renameSync(escapedConvDir, convDir);

    const beforeOpenEscape = __antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      onBeforeOpen: () => {
        renameSync(convDir, escapedConvDir);
      },
    });
    expect(beforeOpenEscape).toEqual([]);
    renameSync(escapedConvDir, convDir);

    // 5. macOS (platform: 'darwin') and non-Linux platforms fail closed for transcript reads ([]),
    //    while handleAntigravityJudgmentHook completes without throwing and preserves fail-open output.
    expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(undefined, 'darwin')).toBeNull();
    expect(__antigravityHookTestInternals.resolveOpenatHelperBinary(undefined, 'win32')).toBeNull();
    expect(__antigravityHookTestInternals.readTranscriptTailEntries(insideTranscript, readOpts, {
      platform: 'darwin',
    })).toEqual([]);
    expect(extractLatestNonSystemUserInput(insideTranscript, { ...readOpts, platform: 'darwin' })).toBeNull();
    expect(extractLastAssistantMessage(insideTranscript, { ...readOpts, platform: 'darwin' })).toBeUndefined();

    const { home, repo, configPath, env } = await setupConfig();
    const darwinTranscript = await canonicalTranscriptPath(home, 'conv-darwin');
    await writeFile(darwinTranscript, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'DARWIN_TRANSCRIPT_PROMPT' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'DARWIN_TRANSCRIPT_ANSWER' }),
    ].join('\n') + '\n');

    const { fetchImpl, sent } = mockHost();
    const darwinOpts = {
      env,
      fetch: fetchImpl,
      accessToken: token,
      configPath,
      registrationId: REG,
      platform: 'darwin' as NodeJS.Platform,
    };

    // System-only lastUserInput cannot fall back to transcript on darwin -> no-op fail-open {}, zero HTTP.
    const darwinSystemOnly = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-darwin',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: darwinTranscript,
      lastUserInput: 'Reason Network: system only',
    }, darwinOpts);
    expect(darwinSystemOnly).toEqual({});
    expect(sent).toHaveLength(0);

    // Explicit lastUserInput + Stop on darwin: hook runs fail-open without throwing and omits transcript-derived last_assistant_message.
    const darwinPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-darwin-explicit',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: darwinTranscript,
      lastUserInput: 'Direct prompt on macOS',
    }, darwinOpts);
    expect(Array.isArray(darwinPre.injectSteps)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.prompt).toBe('Direct prompt on macOS');

    const darwinStop = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-darwin-explicit',
      cwd: repo,
      transcriptPath: darwinTranscript,
      terminationReason: 'NO_TOOL_CALL',
    }, darwinOpts);
    expect(darwinStop).toEqual({ decision: '' });
    expect(sent).toHaveLength(2);
    expect(sent[1].body.last_assistant_message).toBeUndefined();

    // Even when OS flock is also unavailable (typical macOS default without util-linux flock),
    // handleAntigravityJudgmentHook never throws and returns strict fail-open responses.
    const darwinNoFlockOpts = {
      ...darwinOpts,
      turnLock: { flockBinary: '/nonexistent/flock-darwin' },
    };
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-darwin-noflock',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: darwinTranscript,
      lastUserInput: 'Direct prompt without flock',
    }, darwinNoFlockOpts)).toEqual({});
    expect(await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-darwin-noflock',
      cwd: repo,
      transcriptPath: darwinTranscript,
      terminationReason: 'NO_TOOL_CALL',
    }, darwinNoFlockOpts)).toEqual({ decision: '' });
  });

  it('strictly binds pending context re-authorization to bearer token fingerprint, non-null loginId, and confirmed effective project_code', async () => {
    // Case 5a: Bare string token derives non-null sha256 identity; changing string token discards pending context.
    {
      const setup = await setupConfig({ project_code: 'proj-a' });
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      let currentToken = 'raw-bearer-alpha';
      const { fetchImpl } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: body.hook_event_name === 'PostToolUse'
            ? { hookSpecificOutput: { additionalContext: 'TOKEN_BOUND_PENDING' } }
            : {},
        },
      }));
      const options = {
        env: testEnv,
        fetch: fetchImpl,
        accessToken: async () => currentToken,
        configPath: setup.configPath,
        registrationId: REG,
      };

      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-str-token-same',
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'String token turn',
      }, options);
      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-str-token-same',
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_s1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options);
      // Same string token -> pending context is authorized and injected.
      const sameOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-str-token-same',
        invocationNum: 2,
        cwd: setup.repo,
        lastUserInput: 'String token turn',
      }, options);
      expect(JSON.stringify(sameOut)).toContain('TOKEN_BOUND_PENDING');

      // Now queue another pending message, then change the bare string token before PreInvocation.
      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-str-token-same',
        cwd: setup.repo,
        stepIdx: 3,
        toolCall: { id: 'toolu_s2', name: 'run_command', args: { CommandLine: 'pwd' } },
      }, options);
      currentToken = 'raw-bearer-beta';
      const changedOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-str-token-same',
        invocationNum: 3,
        cwd: setup.repo,
        lastUserInput: 'String token turn',
      }, options);
      expect(changedOut).toEqual({});

      // Switching back to original token must not resurrect discarded pending context.
      currentToken = 'raw-bearer-alpha';
      const afterSwitchBack = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-str-token-same',
        invocationNum: 4,
        cwd: setup.repo,
        lastUserInput: 'String token turn',
      }, options);
      expect(afterSwitchBack).toEqual({});
    }

    // Case 5b: Unidentifiable login (empty token / loginId: null) discards pending context immediately.
    {
      const setup = await setupConfig({ project_code: 'proj-a' });
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      let tokenResult: string | { token: string; loginId: string | null } = { token: 'jwt-valid', loginId: 'login-1' };
      const { fetchImpl } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: body.hook_event_name === 'PostToolUse'
            ? { hookSpecificOutput: { additionalContext: 'MUST_DROP_EMPTY_LOGIN' } }
            : {},
        },
      }));
      const options = {
        env: testEnv,
        fetch: fetchImpl,
        accessToken: async () => tokenResult,
        configPath: setup.configPath,
        registrationId: REG,
      };
      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-empty-login',
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'Empty login test',
      }, options);
      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-empty-login',
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_e1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options);

      tokenResult = { token: '', loginId: null };
      const droppedOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-empty-login',
        invocationNum: 2,
        cwd: setup.repo,
        lastUserInput: 'Empty login test',
      }, options);
      expect(droppedOut).toEqual({});
    }

    // Case 5c: Unresolved effective project_code (omitted in config AND Host response) blocks pending injection (no null === null pass).
    {
      const setup = await setupConfig(); // project_code omitted
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      const { fetchImpl } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          // Host intentionally omits project_code
          output: body.hook_event_name === 'PostToolUse'
            ? { hookSpecificOutput: { additionalContext: 'UNRESOLVED_PROJECT_MUST_DROP' } }
            : {},
        },
      }));
      const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath: setup.configPath, registrationId: REG };

      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-unresolved-proj',
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'Unresolved project turn',
      }, options);
      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-unresolved-proj',
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_u1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options);

      const key = __antigravityHookTestInternals.turnKey('conv-unresolved-proj', setup.configPath);
      const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);
      const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(persisted.effective_project_code).toBeNull();
      expect(persisted.pending_messages).toEqual([]);

      // Even if a pending entry is manually persisted while effective_project_code is null, PreInvocation discards it.
      persisted.pending_messages = [{
        turn_id: persisted.turn_id,
        turn_generation: persisted.turn_generation,
        additional_context: 'INJECTED_WITHOUT_PROJECT',
        created_at: new Date().toISOString(),
      }];
      await writeFile(stateFile, JSON.stringify(persisted));

      const out = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-unresolved-proj',
        invocationNum: 2,
        cwd: setup.repo,
        lastUserInput: 'Unresolved project turn',
      }, options);
      expect(out).toEqual({});
      const afterDiscard = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(afterDiscard.pending_messages).toEqual([]);
    }

    // Case 5d: When config omits project_code (Host-assigned), pending context MUST NOT be injected and any persisted pending entry MUST be discarded.
    {
      const setup = await setupConfig(); // project_code omitted; Host decides
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      const { fetchImpl } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          project_code: 'host-proj-a',
          output: body.hook_event_name === 'PostToolUse'
            ? { hookSpecificOutput: { additionalContext: 'HOST_ASSIGNED_MUST_NOT_INJECT' } }
            : {},
        },
      }));
      const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath: setup.configPath, registrationId: REG };

      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-host-proj',
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'Host project turn',
      }, options);

      await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-host-proj',
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_h1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options);

      const key = __antigravityHookTestInternals.turnKey('conv-host-proj', setup.configPath);
      const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);
      const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(persisted.effective_project_code).toBe('host-proj-a');
      expect(persisted.pending_messages).toEqual([]);

      // Even if a pending entry with matching project_code is present in persisted state,
      // PreInvocation cannot locally confirm Host's current project assignment without explicit config.project_code,
      // so it MUST discard pending_messages and return {}.
      persisted.pending_messages = [{
        turn_id: persisted.turn_id,
        turn_generation: persisted.turn_generation,
        project_code: 'host-proj-a',
        additional_context: 'STALE_HOST_ASSIGNED_CONTEXT',
        created_at: new Date().toISOString(),
      }];
      await writeFile(stateFile, JSON.stringify(persisted));

      const drainedOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-host-proj',
        invocationNum: 2,
        cwd: setup.repo,
        lastUserInput: 'Host project turn',
      }, options);
      expect(drainedOut).toEqual({});
      const afterDiscard = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(afterDiscard.pending_messages).toEqual([]);
    }

    // Case 5e: When config specifies project_code 'alpha' and Host initial UserPromptSubmit response explicitly returns 'beta',
    // initial context MUST be rejected ({}) and the turn MUST NOT be marked started or allow pending injection.
    {
      const setup = await setupConfig({ project_code: 'alpha' });
      const turnDir = join(setup.home, 'turns');
      const testEnv = { ...setup.env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      const { fetchImpl, sent } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          project_code: 'beta',
          output: {
            systemMessage: 'BETA_WRONG_PROJECT_BANNER',
            hookSpecificOutput: { additionalContext: 'BETA_WRONG_PROJECT_CONTEXT' },
          },
        },
      }));
      const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath: setup.configPath, registrationId: REG };

      const initialOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-proj-mismatch',
        invocationNum: 1,
        cwd: setup.repo,
        lastUserInput: 'Prompt expecting alpha',
      }, options);
      expect(initialOut).toEqual({});
      expect(sent).toHaveLength(1);

      const key = __antigravityHookTestInternals.turnKey('conv-proj-mismatch', setup.configPath);
      const stateFile = __antigravityHookTestInternals.statePath(testEnv, key);
      const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(persisted.start_status).toBe('failed');
      expect(persisted.effective_project_code).toBeNull();
      expect(persisted.auth_fingerprint).toBeNull();
      expect(persisted.pending_messages).toEqual([]);

      // Subsequent PostToolUse and PreInvocation in the failed turn must not forward or inject anything.
      expect(await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: 'conv-proj-mismatch',
        cwd: setup.repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_m1', name: 'run_command', args: { CommandLine: 'ls' } },
      }, options)).toEqual({});
      expect(sent).toHaveLength(1);

      expect(await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: 'conv-proj-mismatch',
        invocationNum: 2,
        cwd: setup.repo,
        lastUserInput: 'Prompt expecting alpha',
      }, options)).toEqual({});
    }
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
    expect(installed.stdout()).toContain('送り先: https://bb.unson.jp/runtime-mcp/host/judgment/hook');

    // Re-install with explicit --endpoint prints the resolved actual endpoint, not --origin
    const withEndpoint = captureCli();
    expect(await runCli([
      'judgment:install', '--target', 'antigravity',
      '--origin', 'https://ignored-origin.example.net',
      '--endpoint', 'https://bb.unson.jp/runtime-mcp/custom/hook',
      '--server', 'https://bb.unson.jp',
      '--project', 'unson-lab',
      '--allow-non-git',
      '--cwd-prefix', botDir,
      '--settings', hooksPath,
      '--config', configPath,
    ], withEndpoint.io)).toBe(0);
    expect(withEndpoint.stdout()).toContain('送り先: https://bb.unson.jp/runtime-mcp/custom/hook');
    expect(withEndpoint.stdout()).not.toContain('送り先: https://ignored-origin.example.net');
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
