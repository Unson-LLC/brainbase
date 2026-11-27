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
  extractToolResultFromTranscript,
  extractToolResultTextBlocksFromTranscript,
  handleAntigravityJudgmentHook,
  normalizeAntigravityHookBaseUrl,
  normalizeAntigravityToolName,
  registerAntigravityJudgmentHooks,
  resolveAntigravityHookEndpoint,
  splitConcatenatedJsonTextBlocks,
  stripOrcaInjectedPreambles,
  type AntigravityHookConfig,
} from '../src/antigravity-judgment-hook.js';
import { runCli } from '../src/cli.js';
import { toKnowledgeEventFromJudgmentEpisode } from '../src/judgment-event-adapter.js';
import {
  EXECUTION_OUTCOME_HOSTS,
  normalizeJudgmentExecutionOutcome,
} from '../src/judgment-execution-outcome.js';
import { frameApplicationMetadata } from '../src/judgment-frame-evidence.js';
import { JUDGMENT_FRAME_RECORD_VERSION } from '../src/judgment-frame.js';
import { canonicalJson } from '../src/judgment-resolution-contract.js';
import { processJudgmentHook } from '../src/judgment-host.js';
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

    // Verify nested injectSteps[].systemMessage + turn_id guard without protojson-breaking metadata
    expect(first.terminationBehavior).toBe('');
    const steps = first.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(steps[0].systemMessage.systemMessage).toContain('旧ターンの判断契約・先頭監査行は上書き');
    expect(steps[0].systemMessage.systemMessage.split('\n\n')[0]).not.toContain('owner_line');
    expect(steps[0].systemMessage.systemMessage).toContain('🧠 判断参照: 確認済み');
    expect(steps[0].systemMessage.systemMessage).toContain('owner_line: keep scope small');
    expect('metadata' in steps[0].systemMessage).toBe(false);
    expect(Object.keys(steps[0].systemMessage)).toEqual(['systemMessage']);

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

    const darwinExplicitTranscript = await canonicalTranscriptPath(home, 'conv-darwin-explicit');
    await writeFile(darwinExplicitTranscript, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'DARWIN_TRANSCRIPT_PROMPT' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'DARWIN_TRANSCRIPT_ANSWER' }),
    ].join('\n') + '\n');

    // Linux control with matching conversationId + canonical transcript: Stop extracts last_assistant_message.
    const { fetchImpl: linuxFetchImpl, sent: linuxSent } = mockHost();
    const linuxOpts = {
      env: { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: join(home, 'turns-linux-control') } as NodeJS.ProcessEnv,
      fetch: linuxFetchImpl,
      accessToken: token,
      configPath,
      registrationId: REG,
      platform: 'linux' as NodeJS.Platform,
    };
    const linuxPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-darwin-explicit',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: darwinExplicitTranscript,
      lastUserInput: 'Direct prompt on macOS',
    }, linuxOpts);
    expect(Array.isArray(linuxPre.injectSteps)).toBe(true);
    expect(linuxSent).toHaveLength(1);

    const linuxStop = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-darwin-explicit',
      cwd: repo,
      transcriptPath: darwinExplicitTranscript,
      terminationReason: 'NO_TOOL_CALL',
    }, linuxOpts);
    expect(linuxStop).toEqual({ decision: '' });
    expect(linuxSent).toHaveLength(2);
    expect(linuxSent[1].body.last_assistant_message).toBe('DARWIN_TRANSCRIPT_ANSWER');

    // Explicit lastUserInput + Stop on darwin with the same conversationId-matched canonical transcript:
    // hook runs fail-open without throwing and omits transcript-derived last_assistant_message solely due to platform.
    const darwinPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-darwin-explicit',
      invocationNum: 1,
      cwd: repo,
      transcriptPath: darwinExplicitTranscript,
      lastUserInput: 'Direct prompt on macOS',
    }, darwinOpts);
    expect(Array.isArray(darwinPre.injectSteps)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.prompt).toBe('Direct prompt on macOS');

    const darwinStop = await handleAntigravityJudgmentHook({
      hookEventName: 'Stop',
      conversationId: 'conv-darwin-explicit',
      cwd: repo,
      transcriptPath: darwinExplicitTranscript,
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

describe('transcript truncation recovery (transcript_full.jsonl & steps/<n>/output.txt) and systemMessage-only injection', () => {
  it('recovers full brainbase_resolve_turn JSON from sibling transcript_full.jsonl when transcript.jsonl is truncated and injects compact_4block_v3 additionalContext without loss', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const conversationId = 'conv-truncated-resolve';
    const transcriptPath = await canonicalTranscriptPath(home, conversationId);
    const fullTranscriptPath = join(dirname(transcriptPath), 'transcript_full.jsonl');

    const fullResolveTurnPayload = {
      schema_version: 'brainbase-resolve-turn-v1',
      status: 'resolved',
      turn_id: 'turn-resolve-1',
      reasoning_gate_mode: 'compact_4block_v3',
      frames: Array.from({ length: 40 }, (_, i) => ({
        id: `frame_${i}`,
        summary: `Detailed judgment frame ${i}: ${'context-'.repeat(20)}`,
      })),
      source_selection: {
        selected: ['ssot/judgment-policy'],
        excluded: [],
      },
    };
    const fullResolveTurnJson = JSON.stringify(fullResolveTurnPayload);
    const truncatedPreview = [
      'Created At: 2026-11-27T01:00:00+09:00',
      'Completed At: 2026-11-27T01:00:01+09:00',
      `The tool's output was truncated due to being too long. You can find the full output in a file at file://${join(dirname(dirname(transcriptPath)), 'steps', '6', 'output.txt')}.`,
      '',
      'Here is a preview with the middle of the output truncated:',
      fullResolveTurnJson.slice(0, 200),
      `<truncated ${fullResolveTurnJson.length - 300} bytes>`,
      fullResolveTurnJson.slice(-100),
    ].join('\n');

    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Implement item 165' }),
      JSON.stringify({
        step_index: 6,
        tool_use_id: 'toolu_resolve_6',
        source: 'MODEL',
        type: 'GENERIC',
        content: truncatedPreview,
        truncated_fields: ['content'],
      }),
    ].join('\n') + '\n');

    await writeFile(fullTranscriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Implement item 165' }),
      JSON.stringify({
        step_index: 6,
        tool_use_id: 'toolu_resolve_6',
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:00:00+09:00\nCompleted At: 2026-11-27T01:00:01+09:00\n${fullResolveTurnJson}`,
      }),
    ].join('\n') + '\n');

    // Direct unit check on extractToolResultFromTranscript
    const extracted = extractToolResultFromTranscript(transcriptPath, 6, {
      conversationId,
      env: testEnv,
      toolUseId: 'toolu_resolve_6',
    });
    expect(extracted).toBe(fullResolveTurnJson);
    expect(JSON.parse(extracted!)).toEqual(fullResolveTurnPayload);

    // End-to-end hook flow: simulated Host parses tool_response.content[0].text as JSON and returns compact_4block_v3
    const { fetchImpl, sent } = mockHost((body) => {
      if (body.hook_event_name === 'PostToolUse') {
        const resp = body.tool_response as { content?: Array<{ type: string; text: string }>; isError?: boolean };
        const parsed = JSON.parse(resp.content?.[0]?.text ?? 'invalid');
        expect(parsed.reasoning_gate_mode).toBe('compact_4block_v3');
        expect(parsed.frames).toHaveLength(40);
        return {
          status: 200,
          body: {
            schema_version: '1',
            accepted: true,
            hook_event_name: body.hook_event_name,
            session_id: body.session_id,
            turn_id: body.turn_id,
            output: {
              systemMessage: '📚 Brainbase判断解決: 正常応答を確認 ✓',
              hookSpecificOutput: {
                additionalContext: '[compact_4block_v3]\n1. 目的\n2. 根拠\n3. 反証\n4. 判断',
              },
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {},
        },
      };
    });

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Implement item 165',
    }, options);

    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 6,
      transcriptPath,
      toolCall: {
        id: 'toolu_resolve_6',
        name: 'mcp_brainbase-unson_brainbase_resolve_turn',
        args: { prompt: 'Implement item 165' },
      },
    }, options);
    expect(postOut).toEqual({});
    expect(sent).toHaveLength(2);
    expect(sent[1].body.tool_name).toBe('mcp__brainbase__brainbase_resolve_turn');
    expect(sent[1].body.tool_response).toEqual({
      content: [{ type: 'text', text: fullResolveTurnJson }],
      isError: false,
    });

    // Next PreInvocation drains pending compact_4block_v3 additionalContext cleanly
    const nextPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Implement item 165',
    }, options);
    const steps = nextPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[compact_4block_v3]');
    expect(steps[0].systemMessage.systemMessage).toContain('📚 Brainbase判断解決: 正常応答を確認 ✓');
    expect('metadata' in steps[0].systemMessage).toBe(false);

    // Verify compatibility with real judgment-host.ts callResultStatus + sourceSelection on a recovered search result
    const journalDir = join(home, 'host-journal');
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-real-host',
      turn_id: 'turn-real-host',
      prompt: 'Brainbase内を検索して',
      cwd: repo,
    }, { env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: journalDir } });
    const hostPost = await processJudgmentHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-real-host',
      turn_id: 'turn-real-host',
      tool_use_id: 'toolu_search_recovered',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'policy' },
      tool_response: {
        content: [{ type: 'text', text: extracted! }],
        isError: false,
      },
    }, { env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: journalDir } });
    expect(hostPost).toEqual({
      systemMessage: '📚 Brainbase検索: 「policy」→ 採用: ssot/judgment-policy ✓',
    });
  });

  it('matches truncated entries by tool_use_id in transcript_full.jsonl when step_index shifts, and does not misclassify valid JSON containing truncation text', async () => {
    const dir = await tempDir();
    const conversationId = 'conv-tool-use-id';
    const logsDir = join(dir, conversationId, '.system_generated', 'logs');
    await mkdir(logsDir, { recursive: true });
    const transcriptPath = join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = join(logsDir, 'transcript_full.jsonl');

    const fullJson = JSON.stringify({ ok: true, items: Array.from({ length: 30 }, (_, i) => `item-${i}`) });
    const literalTruncatedMentionJson = JSON.stringify({
      note: 'User quoted <truncated 42 bytes> inside a completely valid JSON response',
    });

    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 4,
        tool_use_id: 'toolu_shifted_1',
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:00:00+09:00\n{"ok":true,<truncated 400 bytes>}`,
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 8,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:01:00+09:00\n${literalTruncatedMentionJson}`,
      }),
    ].join('\n') + '\n');

    await writeFile(fullTranscriptPath, [
      JSON.stringify({
        step_index: 99,
        tool_use_id: 'toolu_shifted_1',
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:00:00+09:00\n${fullJson}`,
      }),
    ].join('\n') + '\n');

    const readOpts = { conversationId, allowedTranscriptRoots: [dir] };
    expect(extractToolResultFromTranscript(transcriptPath, 4, {
      ...readOpts,
      toolUseId: 'toolu_shifted_1',
    })).toBe(fullJson);
    // Valid JSON without truncated_fields is returned untouched even if its prose mentions "<truncated N bytes>".
    expect(extractToolResultFromTranscript(transcriptPath, 8, readOpts)).toBe(literalTruncatedMentionJson);
  });

  it('falls back safely to .system_generated/steps/<n>/output.txt when transcript_full.jsonl is still truncated or missing, and rejects oversized outputs', async () => {
    const dir = await tempDir();
    const conversationId = 'conv-steps-fallback';
    const sysGenDir = join(dir, conversationId, '.system_generated');
    const logsDir = join(sysGenDir, 'logs');
    const step6Dir = join(sysGenDir, 'steps', '6');
    const step7Dir = join(sysGenDir, 'steps', '7');
    const step8Dir = join(sysGenDir, 'steps', '8');
    await mkdir(logsDir, { recursive: true });
    await mkdir(step6Dir, { recursive: true });
    await mkdir(step7Dir, { recursive: true });
    await mkdir(step8Dir, { recursive: true });

    const transcriptPath = join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = join(logsDir, 'transcript_full.jsonl');
    const step6OutputPath = join(step6Dir, 'output.txt');
    const step7OutputPath = join(step7Dir, 'output.txt');
    const step8OutputPath = join(step8Dir, 'output.txt');

    const fullStep6Json = JSON.stringify({
      tool: 'brainbase_judgment_frame_read',
      content: 'full-frame-body-'.repeat(500),
    });
    const fullStep7Json = JSON.stringify({
      tool: 'brainbase_judgment_frame_catalog',
      frames: ['f1', 'f2', 'f3'],
    });
    await writeFile(
      step6OutputPath,
      `Created At: 2026-11-27T01:13:00+09:00\nCompleted At: 2026-11-27T01:13:02+09:00\n${fullStep6Json}\n`,
    );
    await writeFile(step7OutputPath, `${fullStep7Json}\n`);
    // Step 8 exceeds 512 KiB size cap -> must fail closed (null).
    await writeFile(step8OutputPath, `{"huge":"${'a'.repeat(600 * 1024)}"}\n`);

    const step6Banner = [
      'Created At: 2026-11-27T01:13:00+09:00',
      'Completed At: 2026-11-27T01:13:02+09:00',
      `The tool's output was truncated due to being too long. You can find the full output in a file at file://${step6OutputPath}.`,
      '',
      'Here is a preview with the middle of the output truncated:',
      '{"tool":"brainbase_judgment_frame_read"',
      '<truncated 6000 of 8000 bytes from the middle of the output>',
      '"}',
    ].join('\n');

    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 6,
        source: 'MODEL',
        type: 'GENERIC',
        content: step6Banner,
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 7,
        source: 'MODEL',
        type: 'GENERIC',
        content: 'Created At: 2026-11-27T01:14:00+09:00\n{"tool":"brainbase_judgment_frame_catalog"\n<truncated 1200 bytes>',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 8,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:15:00+09:00\nThe tool's output was truncated due to being too long. You can find the full output in a file at file://${step8OutputPath}.\n<truncated 500000 bytes>`,
        truncated_fields: ['content'],
      }),
    ].join('\n') + '\n');

    // Realistic Antigravity case: transcript_full.jsonl ALSO carries the steps/6/output.txt truncation banner.
    await writeFile(fullTranscriptPath, [
      JSON.stringify({
        step_index: 6,
        source: 'MODEL',
        type: 'GENERIC',
        content: step6Banner,
      }),
    ].join('\n') + '\n');

    const readOpts = { conversationId, allowedTranscriptRoots: [dir] };
    expect(extractToolResultFromTranscript(transcriptPath, 6, readOpts)).toBe(fullStep6Json);
    expect(extractToolResultFromTranscript(transcriptPath, 7, readOpts)).toBe(fullStep7Json);
    expect(extractToolResultFromTranscript(transcriptPath, 8, readOpts)).toBeNull();
    // Non-Linux fails closed on recovery as well.
    expect(extractToolResultFromTranscript(transcriptPath, 6, { ...readOpts, platform: 'darwin' })).toBeNull();
  });

  it('strictly rejects path traversal, cross-conversation URLs, and symlinks for transcript_full.jsonl and steps/<n>/output.txt', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const outsideDir = join(dir, 'outside-secret');
    await mkdir(outsideDir, { recursive: true });
    const outsideSecretFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideSecretFile, '{"secret":"MUST_NEVER_BE_READ"}\n');

    const conversationId = 'conv-sec-target';
    const otherConvId = 'conv-sec-other';
    const targetSysGen = join(allowedRoot, conversationId, '.system_generated');
    const targetLogs = join(targetSysGen, 'logs');
    const targetSteps = join(targetSysGen, 'steps');
    await mkdir(targetLogs, { recursive: true });
    await mkdir(join(targetSteps, '10'), { recursive: true });
    await mkdir(join(targetSteps, '11'), { recursive: true });

    const otherStepDir = join(allowedRoot, otherConvId, '.system_generated', 'steps', '10');
    await mkdir(otherStepDir, { recursive: true });
    const otherStepOutput = join(otherStepDir, 'output.txt');
    await writeFile(otherStepOutput, '{"secret":"OTHER_CONVERSATION_SECRET"}\n');

    const nonOutputFile = join(targetSteps, '10', 'not-output.txt');
    await writeFile(nonOutputFile, '{"secret":"WRONG_FILENAME"}\n');

    const symlinkOutput = join(targetSteps, '11', 'output.txt');
    await symlink(outsideSecretFile, symlinkOutput);
    const symlinkStepDir = join(targetSteps, '12');
    await symlink(outsideDir, symlinkStepDir);
    const intraSymlinkStepDir = join(targetSteps, '13');
    await writeFile(join(targetSteps, '10', 'output.txt'), '{"secret":"INTRA_SYMLINK_TARGET"}\n');
    await symlink(join(targetSteps, '10'), intraSymlinkStepDir);

    const transcriptPath = join(targetLogs, 'transcript.jsonl');
    const fullTranscriptPath = join(targetLogs, 'transcript_full.jsonl');

    // Place a symlink at transcript_full.jsonl pointing outside -> MUST be rejected.
    await symlink(outsideSecretFile, fullTranscriptPath);

    const makeTruncatedEntry = (stepIndex: number, fileUrl: string) => JSON.stringify({
      step_index: stepIndex,
      source: 'MODEL',
      type: 'GENERIC',
      content: [
        'Created At: 2026-11-27T01:20:00+09:00',
        `The tool's output was truncated due to being too long. You can find the full output in a file at ${fileUrl}.`,
        '<truncated 500 bytes>',
      ].join('\n'),
      truncated_fields: ['content'],
    });

    await writeFile(transcriptPath, [
      makeTruncatedEntry(1, 'file:///etc/passwd'),
      makeTruncatedEntry(2, `file://${outsideSecretFile}`),
      makeTruncatedEntry(3, `file://${otherStepOutput}`),
      makeTruncatedEntry(4, `file://${targetSteps}/10/../../logs/transcript.jsonl`),
      makeTruncatedEntry(5, `file://${nonOutputFile}`),
      makeTruncatedEntry(6, `file://${symlinkOutput}`),
      makeTruncatedEntry(7, `file://${join(symlinkStepDir, 'secret.txt')}`),
      makeTruncatedEntry(8, 'file://evil.example.com/etc/passwd'),
      makeTruncatedEntry(9, `file://${join(intraSymlinkStepDir, 'output.txt')}`),
    ].join('\n') + '\n');

    const readOpts = { conversationId, allowedTranscriptRoots: [allowedRoot] };
    for (const stepIndex of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(extractToolResultFromTranscript(transcriptPath, stepIndex, readOpts)).toBeNull();
    }
  });

  it('injects non-empty turn-guarded model text without metadata when Host returns systemMessage without additionalContext', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'proj-sysmsg-only' });
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
        output: body.hook_event_name === 'UserPromptSubmit'
          ? { systemMessage: '🧠 判断参照: 初期システムメッセージのみ' }
          : body.hook_event_name === 'PostToolUse'
            ? { systemMessage: '📚 Brainbase検索: 「arch」→ 正常応答を確認 ✓' }
            : {},
      },
    }));
    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // 1. UserPromptSubmit with systemMessage only -> non-empty systemMessage.systemMessage without metadata
    const firstPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-sysmsg-only',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: 'Check architecture',
    }, options);
    const firstSteps = firstPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(firstSteps).toHaveLength(1);
    expect(firstSteps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(firstSteps[0].systemMessage.systemMessage).toContain('🧠 判断参照: 初期システムメッセージのみ');
    expect('metadata' in firstSteps[0].systemMessage).toBe(false);

    // 2. PostToolUse with systemMessage only (exact judgment-host.ts shape) -> queued & drained cleanly
    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId: 'conv-sysmsg-only',
      cwd: repo,
      stepIdx: 3,
      toolCall: { id: 'toolu_sys_1', name: 'mcp_brainbase-unson_search', args: { query: 'arch' } },
    }, options);
    expect(postOut).toEqual({});

    const secondPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-sysmsg-only',
      invocationNum: 2,
      cwd: repo,
      lastUserInput: 'Check architecture',
    }, options);
    const secondSteps = secondPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(secondSteps).toHaveLength(1);
    expect(secondSteps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(secondSteps[0].systemMessage.systemMessage).toContain('📚 Brainbase検索: 「arch」→ 正常応答を確認 ✓');
    expect('metadata' in secondSteps[0].systemMessage).toBe(false);

    // 3. Pending queue is fully drained on subsequent PreInvocation (no duplicate leak)
    const thirdPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-sysmsg-only',
      invocationNum: 3,
      cwd: repo,
      lastUserInput: 'Check architecture',
    }, options);
    expect(thirdPre).toEqual({});
  });

  it('evaluates truncation marker and file URL patterns in linear time without quadratic ReDoS backtracking', async () => {
    const dir = await tempDir();
    const conversationId = 'conv-redos-regression';
    const logsDir = join(dir, conversationId, '.system_generated', 'logs');
    await mkdir(logsDir, { recursive: true });
    const transcriptPath = join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = join(logsDir, 'transcript_full.jsonl');

    const adversarialSpaces = ' '.repeat(120_000);
    const validJsonWithAdversarialMarker = JSON.stringify({
      ok: true,
      note: `<truncated 1 bytes${adversarialSpaces}`,
    });
    const invalidTextWithAdversarialMarker = `not-json <truncated 1 bytes${adversarialSpaces}end`;
    const adversarialUrlBanner = `The tool's output was truncated due to being too long. You can find the full output in a file at file:///${'.'.repeat(60_000)}a`;

    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'GENERIC',
        content: 'Created At: 2026-11-27T01:00:00+09:00\n{"ok":true,\n<truncated 400 bytes>',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:01:00+09:00\n${invalidTextWithAdversarialMarker}`,
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:02:00+09:00\n${adversarialUrlBanner}`,
        truncated_fields: ['content'],
      }),
    ].join('\n') + '\n');

    await writeFile(fullTranscriptPath, [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:00:00+09:00\n${validJsonWithAdversarialMarker}`,
      }),
    ].join('\n') + '\n');

    const readOpts = { conversationId, allowedTranscriptRoots: [dir] };

    const start1 = performance.now();
    const recovered1 = extractToolResultFromTranscript(transcriptPath, 1, readOpts);
    const elapsed1 = performance.now() - start1;
    expect(recovered1).toBe(validJsonWithAdversarialMarker);
    expect(elapsed1).toBeLessThan(500);

    const start2 = performance.now();
    const recovered2 = extractToolResultFromTranscript(transcriptPath, 2, readOpts);
    const elapsed2 = performance.now() - start2;
    expect(recovered2).toBe(invalidTextWithAdversarialMarker);
    expect(elapsed2).toBeLessThan(500);

    const start3 = performance.now();
    const recovered3 = extractToolResultFromTranscript(transcriptPath, 3, readOpts);
    const elapsed3 = performance.now() - start3;
    expect(recovered3).toBeNull();
    expect(elapsed3).toBeLessThan(500);
  });

  it('supports tool_call_id matching, no-URL stepIdx+1 fallback, and ignores non-banner file:// URLs in tool body', async () => {
    const dir = await tempDir();
    const conversationId = 'conv-fallbacks-and-anchor';
    const sysGenDir = join(dir, conversationId, '.system_generated');
    const logsDir = join(sysGenDir, 'logs');
    const step11Dir = join(sysGenDir, 'steps', '11');
    const step99Dir = join(sysGenDir, 'steps', '99');
    await mkdir(logsDir, { recursive: true });
    await mkdir(step11Dir, { recursive: true });
    await mkdir(step99Dir, { recursive: true });

    const transcriptPath = join(logsDir, 'transcript.jsonl');
    const fullTranscriptPath = join(logsDir, 'transcript_full.jsonl');
    const step11OutputPath = join(step11Dir, 'output.txt');
    const step99OutputPath = join(step99Dir, 'output.txt');

    const fullCallIdJson = JSON.stringify({ ok: true, via: 'tool_call_id' });
    const fullStep11Json = JSON.stringify({ ok: true, via: 'stepIdx_plus_1_fallback' });
    await writeFile(step11OutputPath, `${fullStep11Json}\n`);
    await writeFile(step99OutputPath, '{"secret":"OTHER_STEP_MUST_NOT_BE_SPOOFED"}\n');

    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 3,
        tool_call_id: 'call_shifted_42',
        source: 'MODEL',
        type: 'GENERIC',
        content: 'Created At: 2026-11-27T01:00:00+09:00\n{"ok":true,<truncated 250 bytes>}',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 10,
        source: 'MODEL',
        type: 'GENERIC',
        content: 'Created At: 2026-11-27T01:01:00+09:00\n{"ok":true\n<truncated 6000 of 8000 bytes from the middle of the output>',
        truncated_fields: ['content'],
      }),
      JSON.stringify({
        step_index: 20,
        source: 'MODEL',
        type: 'GENERIC',
        content: [
          'Created At: 2026-11-27T01:02:00+09:00',
          `{"quoted":"You can find the full output in a file at file://${step99OutputPath}."`,
          '<truncated 400 bytes>',
        ].join('\n'),
        truncated_fields: ['content'],
      }),
    ].join('\n') + '\n');

    await writeFile(fullTranscriptPath, [
      JSON.stringify({
        step_index: 77,
        tool_call_id: 'call_shifted_42',
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T01:00:00+09:00\n${fullCallIdJson}`,
      }),
    ].join('\n') + '\n');

    const readOpts = { conversationId, allowedTranscriptRoots: [dir] };

    // tool_call_id fallback when step_index differs between transcript.jsonl and transcript_full.jsonl
    expect(extractToolResultFromTranscript(transcriptPath, 3, {
      ...readOpts,
      toolUseId: 'call_shifted_42',
    })).toBe(fullCallIdJson);

    // No-URL stepIdx+1 fallback: step_index 10 has no steps/10/output.txt, falls back to steps/11/output.txt
    expect(extractToolResultFromTranscript(transcriptPath, 10, readOpts)).toBe(fullStep11Json);

    // Spoofed file:// URL inside non-banner body text must NOT redirect to steps/99/output.txt
    expect(extractToolResultFromTranscript(transcriptPath, 20, readOpts)).toBeNull();
  });
});

describe('concatenated multi-JSON MCP block splitting (Item #165)', () => {
  it('splits 2-block and 3-block whitespace/newline-concatenated JSON including escaped quotes, backslashes, braces, and newlines inside strings', () => {
    const primaryObj = {
      status: 'ok',
      data: {
        status: 'resolved',
        quote_and_braces: 'literal {braces} [brackets] "quoted" backslash \\ end-slash \\',
        multiline_note: 'line1\n{"fake_block":true}\nline3',
        japanese: '判断契約: 確認済み',
      },
    };
    const scopeObj = {
      connection_scope: {
        organization_id: 'unson',
        project_code: 'brainbase',
        mode: 'remote_mcp',
      },
    };
    const block1 = JSON.stringify(primaryObj, null, 2);
    const block2 = JSON.stringify(scopeObj);
    const concatenated2 = `${block1}\n${block2}`;

    // Verify naive JSON.parse reproduces the real-world failure before splitting.
    expect(() => JSON.parse(concatenated2)).toThrow();

    const split2 = splitConcatenatedJsonTextBlocks(concatenated2);
    expect(split2).toEqual([block1, block2]);
    expect(JSON.parse(split2[0])).toEqual(primaryObj);
    expect(JSON.parse(split2[1])).toEqual(scopeObj);

    // 3 concatenated blocks (array + object + connection_scope) separated by CRLF / spaces / blank lines
    const arrayBlock = JSON.stringify([{ id: 'f1', text: 'a\\"b\\\\' }, { id: 'f2', text: '{x}' }]);
    const metaBlock = JSON.stringify({ status: 'ok', count: 2 });
    const concatenated3 = `  ${arrayBlock}\r\n\r\n\t${metaBlock}   \n${block2}\n`;
    const split3 = splitConcatenatedJsonTextBlocks(concatenated3);
    expect(split3).toEqual([arrayBlock, metaBlock, block2]);
    expect(split3.map((b) => JSON.parse(b))).toEqual([
      [{ id: 'f1', text: 'a\\"b\\\\' }, { id: 'f2', text: '{x}' }],
      { status: 'ok', count: 2 },
      scopeObj,
    ]);

    // Single JSON object/array stays intact as a 1-element array
    expect(splitConcatenatedJsonTextBlocks(block1)).toEqual([block1]);
    expect(splitConcatenatedJsonTextBlocks(arrayBlock)).toEqual([arrayBlock]);
  });

  it('fails open without throwing on non-JSON text, mixed valid/broken JSON, mismatched brackets, and missing separators', () => {
    const cases = [
      '',
      '   \n\t  ',
      'plain text output without json',
      'prefix {"a":1}\n{"b":2}',
      '{"a":1}\nnot-json-tail',
      '{"a":1}\n{"b":2',
      '{"a":1}\n{"b":invalid}',
      '{"a":1}\n{]',
      '{"a":1}{"b":2}',
      '{"a":1}\n{"b":"unterminated',
      '{"a":1,}\n{"b":2}',
      '{"a":1}\n{"b":"unescaped\nnewline"}',
      '{"a":1}\nnull',
    ];
    for (const input of cases) {
      expect(splitConcatenatedJsonTextBlocks(input)).toEqual([input]);
    }
  });

  it('recovers 20KB+ real-format multi-JSON steps/<n>/output.txt through PostToolUse -> Host compact_4block_v3 -> pending_messages -> next PreInvocation and real judgment-host', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const conversationId = 'conv-multi-json-steps-5';
    const transcriptPath = await canonicalTranscriptPath(home, conversationId);
    const sysGenDir = dirname(dirname(transcriptPath));
    const fullTranscriptPath = join(dirname(transcriptPath), 'transcript_full.jsonl');
    const step5Dir = join(sysGenDir, 'steps', '5');
    await mkdir(step5Dir, { recursive: true });
    const step5OutputPath = join(step5Dir, 'output.txt');

    // Mirror real Antigravity steps/5/output.txt: 20KB+ pretty-printed JSON (hundreds of lines)
    // followed by `\n{"connection_scope":{"organization_id":"unson",...}}`, including `{}` / `\"` / `\n` / truncation mention inside strings.
    const resolveTurnPayload = {
      status: 'ok',
      data: {
        status: 'resolved',
        turn_id: 'turn-resolve-165',
        reasoning_gate_mode: 'compact_4block_v3',
        notes: 'Contains {braces}, "escaped quotes", \\backslashes\\, newline\nand quoted <truncated 42 bytes> inside JSON',
        frames: Array.from({ length: 60 }, (_, idx) => ({
          id: `frame_${idx}`,
          title: `Judgment frame "${idx}" {scope}`,
          body: `Detailed frame content #${idx}: ${'policy-evidence-'.repeat(12)}\nline-break`,
        })),
      },
      source_selection: {
        selected: ['ssot/judgment-policy', 'ssot/item-165'],
        excluded: [{ source: 'raw/stale-note', reason: 'superseded' }],
      },
    };
    const connectionScopePayload = {
      connection_scope: {
        organization_id: 'unson',
        project_code: 'unson-lab',
        server: 'brainbase-unson',
      },
    };
    const primaryJson = JSON.stringify(resolveTurnPayload, null, 2);
    const scopeJson = JSON.stringify(connectionScopePayload);
    const combinedOutput = `${primaryJson}\n${scopeJson}`;
    expect(Buffer.byteLength(combinedOutput, 'utf8')).toBeGreaterThan(20 * 1024);

    await writeFile(
      step5OutputPath,
      `Created At: 2026-11-27T02:10:00+09:00\nCompleted At: 2026-11-27T02:10:02+09:00\n${combinedOutput}\n`,
    );

    const truncationBanner = [
      'Created At: 2026-11-27T02:10:00+09:00',
      'Completed At: 2026-11-27T02:10:02+09:00',
      `The tool's output was truncated due to being too long. You can find the full output in a file at file://${step5OutputPath}.`,
      '',
      'Here is a preview with the middle of the output truncated:',
      primaryJson.slice(0, 180),
      `<truncated ${combinedOutput.length - 280} of ${combinedOutput.length} bytes from the middle of the output>`,
      scopeJson,
    ].join('\n');

    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Verify item 165 multi-JSON fix' }),
      JSON.stringify({
        step_index: 5,
        tool_use_id: 'toolu_resolve_5',
        source: 'MODEL',
        type: 'GENERIC',
        content: truncationBanner,
        truncated_fields: ['content'],
      }),
    ].join('\n') + '\n');

    await writeFile(fullTranscriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Verify item 165 multi-JSON fix' }),
      JSON.stringify({
        step_index: 5,
        tool_use_id: 'toolu_resolve_5',
        source: 'MODEL',
        type: 'GENERIC',
        content: truncationBanner,
      }),
    ].join('\n') + '\n');

    // Direct helper verification
    const readOpts = { conversationId, env: testEnv, toolUseId: 'toolu_resolve_5' };
    expect(extractToolResultFromTranscript(transcriptPath, 5, readOpts)).toBe(combinedOutput);
    expect(extractToolResultTextBlocksFromTranscript(transcriptPath, 5, readOpts)).toEqual([primaryJson, scopeJson]);

    const compactContract = '[compact_4block_v3]\n1. 目的\n2. 判断軸\n3. 反証\n4. 結論';
    const { fetchImpl, sent } = mockHost((body) => {
      if (body.hook_event_name === 'PostToolUse') {
        const resp = body.tool_response as { content?: Array<{ type: string; text: string }>; isError?: boolean };
        expect(resp.isError).toBe(false);
        expect(resp.content).toHaveLength(2);
        // Simulate remote Host parsing EVERY text content block with JSON.parse
        const parsedBlocks = resp.content!.map((block) => {
          expect(block.type).toBe('text');
          return JSON.parse(block.text) as Record<string, unknown>;
        });
        expect((parsedBlocks[0].data as Record<string, unknown>).status).toBe('resolved');
        expect((parsedBlocks[0].data as Record<string, unknown>).reasoning_gate_mode).toBe('compact_4block_v3');
        expect(parsedBlocks[1].connection_scope).toEqual(connectionScopePayload.connection_scope);
        return {
          status: 200,
          body: {
            schema_version: '1',
            accepted: true,
            hook_event_name: body.hook_event_name,
            session_id: body.session_id,
            turn_id: body.turn_id,
            output: {
              systemMessage: '📚 Brainbase判断解決: compact_4block_v3 を確定 ✓',
              hookSpecificOutput: {
                additionalContext: compactContract,
              },
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {},
        },
      };
    });

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // 1. PreInvocation starts the turn
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Verify item 165 multi-JSON fix',
    }, options);

    // 2. PostToolUse recovers steps/5/output.txt, restores 2 text content blocks, and queues additionalContext in pending_messages
    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 5,
      transcriptPath,
      toolCall: {
        id: 'toolu_resolve_5',
        name: 'mcp_brainbase-unson_brainbase_resolve_turn',
        args: { prompt: 'Verify item 165 multi-JSON fix' },
      },
    }, options);
    expect(postOut).toEqual({});
    expect(sent).toHaveLength(2);
    expect(sent[1].body.tool_name).toBe('mcp__brainbase__brainbase_resolve_turn');
    expect(sent[1].body.tool_response).toEqual({
      content: [
        { type: 'text', text: primaryJson },
        { type: 'text', text: scopeJson },
      ],
      isError: false,
    });

    // Verify pending_messages persists additionalContext before next PreInvocation
    const key = __antigravityHookTestInternals.turnKey(conversationId, configPath);
    const turnStateFile = __antigravityHookTestInternals.statePath(testEnv, key);
    const persistedBeforeDrain = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(persistedBeforeDrain.pending_messages).toHaveLength(1);
    expect(persistedBeforeDrain.pending_messages[0].additional_context).toBe(compactContract);
    expect(persistedBeforeDrain.pending_messages[0].system_message).toBe('📚 Brainbase判断解決: compact_4block_v3 を確定 ✓');

    // 3. Next PreInvocation drains pending_messages into injectSteps and clears pending_messages
    const nextPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Verify item 165 multi-JSON fix',
    }, options);
    const steps = nextPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[Brainbase Judgment Turn:');
    expect(steps[0].systemMessage.systemMessage).toContain(compactContract);
    expect(steps[0].systemMessage.systemMessage).toContain('📚 Brainbase判断解決: compact_4block_v3 を確定 ✓');
    expect('metadata' in steps[0].systemMessage).toBe(false);

    const persistedAfterDrain = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(persistedAfterDrain.pending_messages).toEqual([]);

    // 4. Verify real judgment-host.ts callResultStatus + sourceSelection parses the restored 2-block tool_response cleanly
    const journalDir = join(home, 'host-journal-multi');
    await processJudgmentHook({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-real-host-multi',
      turn_id: 'turn-real-host-multi',
      prompt: 'Brainbase内を検索して',
      cwd: repo,
    }, { env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: journalDir } });
    const hostPost = await processJudgmentHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-real-host-multi',
      turn_id: 'turn-real-host-multi',
      tool_use_id: 'toolu_search_multi_5',
      tool_name: 'mcp__brainbase__search',
      tool_input: { query: 'item-165' },
      tool_response: sent[1].body.tool_response,
    }, { env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: journalDir } });
    expect(hostPost).toEqual({
      systemMessage: '📚 Brainbase検索: 「item-165」→ 採用: ssot/judgment-policy・ssot/item-165／除外: raw/stale-note（superseded） ✓',
    });
  });

  it('queues and drains additionalContext-only PostToolUse responses (without systemMessage) across PreInvocation', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const conversationId = 'conv-additional-context-only';
    const transcriptPath = await canonicalTranscriptPath(home, conversationId);

    const twoBlockContent = [
      JSON.stringify({ status: 'ok', data: { status: 'resolved' } }),
      JSON.stringify({ connection_scope: { organization_id: 'unson' } }),
    ].join('\n');

    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Check additionalContext only' }),
      JSON.stringify({
        step_index: 3,
        tool_use_id: 'toolu_ctx_only',
        source: 'MODEL',
        type: 'GENERIC',
        content: `Created At: 2026-11-27T02:15:00+09:00\n${twoBlockContent}`,
      }),
    ].join('\n') + '\n');

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
            hookSpecificOutput: {
              additionalContext: '[compact_4block_v3] additionalContext-only contract',
            },
          }
          : {},
      },
    }));

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Check additionalContext only',
    }, options);

    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 3,
      transcriptPath,
      toolCall: {
        id: 'toolu_ctx_only',
        name: 'mcp_brainbase-unson_brainbase_resolve_turn',
        args: { prompt: 'Check additionalContext only' },
      },
    }, options);
    expect(postOut).toEqual({});

    const key = __antigravityHookTestInternals.turnKey(conversationId, configPath);
    const turnStateFile = __antigravityHookTestInternals.statePath(testEnv, key);
    const queuedState = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(queuedState.pending_messages).toHaveLength(1);
    expect(queuedState.pending_messages[0].additional_context).toBe('[compact_4block_v3] additionalContext-only contract');
    expect(queuedState.pending_messages[0].system_message).toBeUndefined();

    const nextPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Check additionalContext only',
    }, options);
    const steps = nextPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].systemMessage.systemMessage).toContain('[compact_4block_v3] additionalContext-only contract');
    expect('metadata' in steps[0].systemMessage).toBe(false);

    const drainedState = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(drainedState.pending_messages).toEqual([]);
  });

  it('runs splitConcatenatedJsonTextBlocks in strict linear O(n) time on 500k+ char valid and adversarial inputs without ReDoS', () => {
    // Generous 5,000ms ceiling tolerates shared CI runner CPU contention while
    // decisively catching O(n^2) / ReDoS regressions (which take minutes on 500k+ chars).
    const maxLinearElapsedMs = 5_000;

    // 1. Valid 500k+ two-block concatenated JSON
    const largeBlock1 = JSON.stringify({
      status: 'ok',
      data: { payload: 'x'.repeat(500_000), nested: { a: [1, 2, 3] } },
    });
    const largeBlock2 = JSON.stringify({ connection_scope: { organization_id: 'unson' } });
    const largeConcat = `${largeBlock1}\n${largeBlock2}`;

    const t1 = performance.now();
    const splitLarge = splitConcatenatedJsonTextBlocks(largeConcat);
    const elapsed1 = performance.now() - t1;
    expect(splitLarge).toEqual([largeBlock1, largeBlock2]);
    expect(elapsed1).toBeLessThan(maxLinearElapsedMs);

    // 2. Adversarial 500k unclosed string full of escaped quotes
    const adversarialEscapes = `{"a":"${'\\"'.repeat(250_000)}`;
    const t2 = performance.now();
    expect(splitConcatenatedJsonTextBlocks(adversarialEscapes)).toEqual([adversarialEscapes]);
    const elapsed2 = performance.now() - t2;
    expect(elapsed2).toBeLessThan(maxLinearElapsedMs);

    // 3. Adversarial 500k unclosed open braces
    const adversarialBraces = '{'.repeat(500_000);
    const t3 = performance.now();
    expect(splitConcatenatedJsonTextBlocks(adversarialBraces)).toEqual([adversarialBraces]);
    const elapsed3 = performance.now() - t3;
    expect(elapsed3).toBeLessThan(maxLinearElapsedMs);

    // 4. Adversarial 500k deeply nested balanced brackets followed by second block -> completes in O(n) without stack overflow
    const deepBlock = `${'['.repeat(250_000)}${']'.repeat(250_000)}`;
    const adversarialDeep = `${deepBlock}\n{}`;
    const t4 = performance.now();
    const deepSplit = splitConcatenatedJsonTextBlocks(adversarialDeep);
    const elapsed4 = performance.now() - t4;
    expect(deepSplit.length === 2 ? deepSplit : [adversarialDeep]).toEqual(
      deepSplit.length === 2 ? [deepBlock, '{}'] : [adversarialDeep],
    );
    expect(elapsed4).toBeLessThan(maxLinearElapsedMs);

    // 5. Large 500k valid first block + invalid second block -> fails open safely in O(n)
    const largeMixedInvalid = `${largeBlock1}\n{"connection_scope":broken}`;
    const t5 = performance.now();
    expect(splitConcatenatedJsonTextBlocks(largeMixedInvalid)).toEqual([largeMixedInvalid]);
    const elapsed5 = performance.now() - t5;
    expect(elapsed5).toBeLessThan(maxLinearElapsedMs);
  });
});

describe('Antigravity G-1 final P0 regressions (Item #165: no protojson metadata panic & unflushed transcript steps fallback)', () => {
  it('omits metadata completely in buildSystemMessageStep and PreInvocation pending drain across additionalContext-only, systemMessage-only, both-distinct, and duplicate cases', async () => {
    const { buildSystemMessageStep } = __antigravityHookTestInternals;

    // 1. Direct buildSystemMessageStep checks across all combinations
    const ctxOnly = buildSystemMessageStep('turn-1', '[compact_4block_v3] context only', undefined) as {
      systemMessage: Record<string, unknown> & { systemMessage: string };
    };
    expect(ctxOnly).not.toBeNull();
    expect('metadata' in ctxOnly.systemMessage).toBe(false);
    expect(Object.keys(ctxOnly.systemMessage)).toEqual(['systemMessage']);
    expect(ctxOnly.systemMessage.systemMessage).toContain('[Brainbase Judgment Turn: turn-1]');
    expect(ctxOnly.systemMessage.systemMessage).toContain('[compact_4block_v3] context only');

    const msgOnly = buildSystemMessageStep('turn-2', undefined, '📚 Brainbase判断解決: OK ✓') as {
      systemMessage: Record<string, unknown> & { systemMessage: string };
    };
    expect(msgOnly).not.toBeNull();
    expect('metadata' in msgOnly.systemMessage).toBe(false);
    expect(Object.keys(msgOnly.systemMessage)).toEqual(['systemMessage']);
    expect(msgOnly.systemMessage.systemMessage).toContain('[Brainbase Judgment Turn: turn-2]');
    expect(msgOnly.systemMessage.systemMessage).toContain('📚 Brainbase判断解決: OK ✓');

    const bothDistinct = buildSystemMessageStep(
      'turn-3',
      '[compact_4block_v3] contract body',
      '📚 Brainbase判断解決: 確定 ✓',
    ) as { systemMessage: Record<string, unknown> & { systemMessage: string } };
    expect(bothDistinct).not.toBeNull();
    expect('metadata' in bothDistinct.systemMessage).toBe(false);
    expect(Object.keys(bothDistinct.systemMessage)).toEqual(['systemMessage']);
    expect(bothDistinct.systemMessage.systemMessage).toContain('📚 Brainbase判断解決: 確定 ✓');
    expect(bothDistinct.systemMessage.systemMessage).toContain('[compact_4block_v3] contract body');
    expect(bothDistinct.systemMessage.systemMessage).toContain('📚 Brainbase判断解決: 確定 ✓\n\n[compact_4block_v3] contract body');

    // Duplicate strings are included only once
    const bothIdentical = buildSystemMessageStep('turn-4', 'same-note', '  same-note  ') as {
      systemMessage: Record<string, unknown> & { systemMessage: string };
    };
    expect('metadata' in bothIdentical.systemMessage).toBe(false);
    expect(bothIdentical.systemMessage.systemMessage.split('same-note').length - 1).toBe(1);

    // Both empty returns null
    expect(buildSystemMessageStep('turn-5', '   ', '')).toBeNull();

    // 2. End-to-end PreInvocation pending drain across all 3 non-empty patterns
    const patterns: Array<{
      name: string;
      output: Record<string, unknown>;
      expectedSubstrings: string[];
    }> = [
      {
        name: 'additionalContext-only',
        output: { hookSpecificOutput: { additionalContext: '[compact_4block_v3] ctx-only' } },
        expectedSubstrings: ['[compact_4block_v3] ctx-only'],
      },
      {
        name: 'systemMessage-only',
        output: { systemMessage: '📚 sysmsg-only ✓' },
        expectedSubstrings: ['📚 sysmsg-only ✓'],
      },
      {
        name: 'both-distinct',
        output: {
          systemMessage: '📚 both-sysmsg ✓',
          hookSpecificOutput: { additionalContext: '[compact_4block_v3] both-ctx' },
        },
        expectedSubstrings: ['📚 both-sysmsg ✓', '[compact_4block_v3] both-ctx'],
      },
    ];

    for (const pattern of patterns) {
      const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
      const turnDir = join(home, 'turns');
      const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      const conversationId = `conv-no-meta-${pattern.name}`;
      const { fetchImpl } = mockHost((body) => ({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: body.hook_event_name === 'PostToolUse' ? pattern.output : {},
        },
      }));
      const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId,
        invocationNum: 1,
        cwd: repo,
        lastUserInput: `Test ${pattern.name}`,
      }, options);

      const postOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId,
        cwd: repo,
        stepIdx: 2,
        toolCall: { id: 'toolu_p', name: 'mcp_brainbase-unson_brainbase_resolve_turn', args: { prompt: 'p' } },
      }, options);
      expect(postOut).toEqual({});

      const drainedPre = await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId,
        invocationNum: 2,
        cwd: repo,
        lastUserInput: `Test ${pattern.name}`,
      }, options);
      const injectSteps = drainedPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
      expect(injectSteps).toHaveLength(1);
      expect('metadata' in injectSteps[0].systemMessage).toBe(false);
      expect(Object.keys(injectSteps[0].systemMessage)).toEqual(['systemMessage']);
      for (const expectedText of pattern.expectedSubstrings) {
        expect(injectSteps[0].systemMessage.systemMessage).toContain(expectedText);
      }
    }
  });

  it('recovers steps/5/output.txt directly for exact stepIdx 5 when transcript.jsonl has not flushed step 5 yet, splits 2 JSON blocks, queues compact_4block_v3, drains without metadata, and fails closed on planner stepIdx 4', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const conversationId = 'conv-unflushed-step-5';
    const transcriptPath = await canonicalTranscriptPath(home, conversationId);
    const sysGenDir = dirname(dirname(transcriptPath));
    const step5Dir = join(sysGenDir, 'steps', '5');
    await mkdir(step5Dir, { recursive: true });
    const step5OutputPath = join(step5Dir, 'output.txt');

    const primaryObj = {
      status: 'ok',
      data: {
        status: 'resolved',
        reasoning_gate_mode: 'compact_4block_v3',
        binding_contract: { mode: 'compact_4block_v3', required_blocks: 4 },
      },
    };
    const scopeObj = {
      connection_scope: {
        organization_id: 'unson',
        project_code: 'unson-lab',
        mode: 'remote_mcp',
      },
    };
    const primaryJson = JSON.stringify(primaryObj, null, 2);
    const scopeJson = JSON.stringify(scopeObj);
    await writeFile(
      step5OutputPath,
      `Created At: 2026-11-27T07:55:35+09:00\nCompleted At: 2026-11-27T07:55:36+09:00\n${primaryJson}\n${scopeJson}\n`,
    );

    // transcript.jsonl only has up to step_index: 4 (PLANNER_RESPONSE); step_index: 5 is NOT flushed yet.
    await writeFile(transcriptPath, [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Verify unflushed G-1 flow' }),
      JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Calling brainbase_resolve_turn...' }),
    ].join('\n') + '\n');

    // Planner index (stepIdx: 4) MUST fail closed (null) and MUST NOT unverified-fallback to steps/5/output.txt.
    expect(extractToolResultTextBlocksFromTranscript(transcriptPath, 4, {
      conversationId,
      env: testEnv,
      toolUseId: 'toolu_unflushed_5',
    })).toBeNull();
    expect(extractToolResultFromTranscript(transcriptPath, 4, {
      conversationId,
      env: testEnv,
    })).toBeNull();

    const compactContract = '[compact_4block_v3]\n1. 目的\n2. 判断軸\n3. 反証\n4. 結論';
    const auditSummary = '📚 Brainbase判断解決: compact_4block_v3 を確定 ✓';
    const { fetchImpl, sent } = mockHost((body) => {
      if (body.hook_event_name === 'PostToolUse') {
        const resp = body.tool_response as { content?: Array<{ type: string; text: string }>; isError?: boolean };
        expect(resp.isError).toBe(false);
        expect(resp.content).toHaveLength(2);
        expect(JSON.parse(resp.content![0].text)).toEqual(primaryObj);
        expect(JSON.parse(resp.content![1].text)).toEqual(scopeObj);
        return {
          status: 200,
          body: {
            schema_version: '1',
            accepted: true,
            hook_event_name: body.hook_event_name,
            session_id: body.session_id,
            turn_id: body.turn_id,
            output: {
              systemMessage: auditSummary,
              hookSpecificOutput: { additionalContext: compactContract },
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: body.hook_event_name,
          session_id: body.session_id,
          turn_id: body.turn_id,
          output: {},
        },
      };
    });

    const options = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Verify unflushed G-1 flow',
    }, options);

    const postOut = await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 5,
      transcriptPath,
      toolCall: {
        id: 'toolu_unflushed_5',
        name: 'mcp_brainbase-unson_brainbase_resolve_turn',
        args: { prompt: 'Verify unflushed G-1 flow' },
      },
    }, options);
    expect(postOut).toEqual({});
    expect(sent).toHaveLength(2);
    expect(sent[1].body.tool_response).toEqual({
      content: [
        { type: 'text', text: primaryJson },
        { type: 'text', text: scopeJson },
      ],
      isError: false,
    });

    const key = __antigravityHookTestInternals.turnKey(conversationId, configPath);
    const turnStateFile = __antigravityHookTestInternals.statePath(testEnv, key);
    const queuedState = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(queuedState.pending_messages).toHaveLength(1);
    expect(queuedState.pending_messages[0].additional_context).toBe(compactContract);
    expect(queuedState.pending_messages[0].system_message).toBe(auditSummary);

    const nextPre = await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 2,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Verify unflushed G-1 flow',
    }, options);
    const injectSteps = nextPre.injectSteps as Array<{ systemMessage: Record<string, unknown> & { systemMessage: string } }>;
    expect(injectSteps).toHaveLength(1);
    expect('metadata' in injectSteps[0].systemMessage).toBe(false);
    expect(Object.keys(injectSteps[0].systemMessage)).toEqual(['systemMessage']);
    expect(injectSteps[0].systemMessage.systemMessage).toContain(auditSummary);
    expect(injectSteps[0].systemMessage.systemMessage).toContain(compactContract);

    const drainedState = JSON.parse(await readFile(turnStateFile, 'utf8'));
    expect(drainedState.pending_messages).toEqual([]);
  });

  it('fails closed without falling through to neighboring steps on missing/oversized/symlink/non-regular/planner/mismatched-toolUseId cases (B-1 R1-R4 regressions)', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const outsideDir = join(dir, 'outside-secret');
    await mkdir(outsideDir, { recursive: true });
    const outsideSecretFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideSecretFile, '{"secret":"OUTSIDE_MUST_NEVER_BE_READ"}\n');

    const neighborShellOutput = 'AWS_SECRET_ACCESS_KEY=from-parallel-run-command\n';

    // R1 (missing): steps/20/output.txt does not exist, steps/21/output.txt has parallel run_command output -> MUST return null.
    {
      const convId = 'conv-b1-r1-missing';
      const sysGen = join(allowedRoot, convId, '.system_generated');
      await mkdir(join(sysGen, 'logs'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '21'), { recursive: true });
      await writeFile(join(sysGen, 'steps', '21', 'output.txt'), `Created At: 2026-11-27T07:56:37+09:00\n${neighborShellOutput}`);
      const transcriptPath = join(sysGen, 'logs', 'transcript.jsonl');
      await writeFile(transcriptPath, JSON.stringify({
        step_index: 19,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Parallel tool calls',
      }) + '\n');

      const opts = { conversationId: convId, allowedTranscriptRoots: [allowedRoot] };
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();
      expect(extractToolResultTextBlocksFromTranscript(transcriptPath, 20, { ...opts, toolUseId: 'toolu_bb_20' })).toBeNull();
    }

    // R2 (oversized >512 KiB): steps/20/output.txt exceeds cap, steps/21/output.txt has neighbor output -> MUST return null
    // in BOTH unflushed mode and transcript-matched mode (never fall through to step 21).
    {
      const convId = 'conv-b1-r2-oversized';
      const sysGen = join(allowedRoot, convId, '.system_generated');
      await mkdir(join(sysGen, 'logs'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '20'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '21'), { recursive: true });
      await writeFile(join(sysGen, 'steps', '20', 'output.txt'), `{"huge":"${'a'.repeat(600 * 1024)}"}\n`);
      await writeFile(join(sysGen, 'steps', '21', 'output.txt'), neighborShellOutput);
      const transcriptPath = join(sysGen, 'logs', 'transcript.jsonl');
      const opts = { conversationId: convId, allowedTranscriptRoots: [allowedRoot] };

      // Unflushed transcript (only planner step 19)
      await writeFile(transcriptPath, JSON.stringify({
        step_index: 19,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Parallel tool calls',
      }) + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 20, { ...opts, toolUseId: 'toolu_bb_20' })).toBeNull();

      // Transcript-matched truncated entry at step 20 (no explicit file:// URL) -> still MUST NOT fall through to step 21
      await writeFile(transcriptPath, [
        JSON.stringify({ step_index: 19, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Parallel tool calls' }),
        JSON.stringify({
          step_index: 20,
          source: 'MODEL',
          type: 'GENERIC',
          content: 'Created At: 2026-11-27T07:56:35+09:00\n{"huge":"<truncated 600000 bytes>',
          truncated_fields: ['content'],
        }),
      ].join('\n') + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();
    }

    // R3 (symlink / non-regular FIFO / truncation banner): steps/20/output.txt rejected -> MUST return null
    // and NEVER fall through to steps/21/output.txt (both unflushed and transcript-matched).
    {
      const convId = 'conv-b1-r3-symlink';
      const sysGen = join(allowedRoot, convId, '.system_generated');
      await mkdir(join(sysGen, 'logs'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '20'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '21'), { recursive: true });
      const step20Output = join(sysGen, 'steps', '20', 'output.txt');
      await writeFile(join(sysGen, 'steps', '21', 'output.txt'), neighborShellOutput);
      const transcriptPath = join(sysGen, 'logs', 'transcript.jsonl');
      const opts = { conversationId: convId, allowedTranscriptRoots: [allowedRoot] };

      // 3a. Symlink at steps/20/output.txt (unflushed & transcript-matched)
      await symlink(outsideSecretFile, step20Output);
      await writeFile(transcriptPath, JSON.stringify({
        step_index: 19,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Parallel tool calls',
      }) + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();

      await writeFile(transcriptPath, [
        JSON.stringify({ step_index: 19, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Parallel tool calls' }),
        JSON.stringify({
          step_index: 20,
          source: 'MODEL',
          type: 'GENERIC',
          content: 'Created At: 2026-11-27T07:56:35+09:00\n{"ok":true\n<truncated 500 bytes>',
          truncated_fields: ['content'],
        }),
      ].join('\n') + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();

      // 3b. Non-regular FIFO at steps/20/output.txt (transcript-matched) -> rejects immediately without falling through to step 21
      await rm(step20Output, { force: true });
      const mkfifoRes = spawnSync('mkfifo', [step20Output]);
      expect(mkfifoRes.status).toBe(0);
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();

      // 3c. Truncation banner inside steps/20/output.txt (transcript-matched) -> rejects without falling through to step 21
      await rm(step20Output, { force: true });
      await writeFile(step20Output, "The tool's output was truncated due to being too long.\n<truncated 100 bytes>\n");
      expect(extractToolResultFromTranscript(transcriptPath, 20, opts)).toBeNull();
    }

    // R4 (planner index / parallel batch & mismatched toolUseId):
    // Mirrors real conversation 223a184e: planner 33 -> run_command 34 / Brainbase 35.
    {
      const convId = 'conv-b1-r4-parallel';
      const sysGen = join(allowedRoot, convId, '.system_generated');
      await mkdir(join(sysGen, 'logs'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '34'), { recursive: true });
      await mkdir(join(sysGen, 'steps', '35'), { recursive: true });
      const brainbaseStep35Json = JSON.stringify({ status: 'ok', tool: 'brainbase_judgment_audit_read' });
      await writeFile(join(sysGen, 'steps', '34', 'output.txt'), `Created At: 2026-11-27T07:57:28+09:00\n${neighborShellOutput}`);
      await writeFile(join(sysGen, 'steps', '35', 'output.txt'), `Created At: 2026-11-27T07:57:29+09:00\n${brainbaseStep35Json}\n`);

      const transcriptPath = join(sysGen, 'logs', 'transcript.jsonl');
      const opts = { conversationId: convId, allowedTranscriptRoots: [allowedRoot] };

      // 4a. Transcript flushed only through planner step 33:
      //     stepIdx: 33 MUST return null (never leak step 34 shell output); exact stepIdx: 35 recovers Brainbase output.
      await writeFile(transcriptPath, JSON.stringify({
        step_index: 33,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'Calling run_command and brainbase_judgment_audit_read in parallel',
      }) + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 33, opts)).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 33, { ...opts, toolUseId: 'toolu_bb_35' })).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 35, { ...opts, toolUseId: 'toolu_bb_35' })).toBe(brainbaseStep35Json);

      // 4b. Transcript also flushed step 34 (run_command with explicit tool_use_id), step 35 not flushed yet:
      //     - stepIdx: 33 + toolUseId: toolu_bb_35 MUST NOT match step 34 in transcript or steps/34/output.txt
      //     - stepIdx: 34 + toolUseId: toolu_bb_35 MUST NOT match mismatched step 34 or read steps/34/output.txt
      await writeFile(transcriptPath, [
        JSON.stringify({ step_index: 33, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Parallel batch' }),
        JSON.stringify({
          step_index: 34,
          tool_use_id: 'toolu_cmd_34',
          source: 'MODEL',
          type: 'GENERIC',
          content: `Created At: 2026-11-27T07:57:28+09:00\n${neighborShellOutput}`,
        }),
      ].join('\n') + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 33, { ...opts, toolUseId: 'toolu_bb_35' })).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 34, { ...opts, toolUseId: 'toolu_bb_35' })).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 35, { ...opts, toolUseId: 'toolu_bb_35' })).toBe(brainbaseStep35Json);

      // 4c. Transcript flushed step 34 WITHOUT tool_use_id (real Antigravity GENERIC shape):
      //     stepIdx: 33 MUST STILL return null (never jump from planner 33 to untagged neighbor 34).
      await writeFile(transcriptPath, [
        JSON.stringify({ step_index: 33, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Parallel batch' }),
        JSON.stringify({
          step_index: 34,
          source: 'MODEL',
          type: 'GENERIC',
          content: `Created At: 2026-11-27T07:57:28+09:00\n${neighborShellOutput}`,
        }),
      ].join('\n') + '\n');
      expect(extractToolResultFromTranscript(transcriptPath, 33, opts)).toBeNull();
      expect(extractToolResultFromTranscript(transcriptPath, 33, { ...opts, toolUseId: 'toolu_bb_35' })).toBeNull();
    }

    // E2E PostToolUse guard: when Brainbase step 20 output is missing and parallel step 21 has secrets,
    // PostToolUse MUST send a digest summary (NEVER raw step 21 shell output).
    {
      const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
      const turnDir = join(home, 'turns');
      const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
      const convId = 'conv-b1-e2e-no-leak';
      const transcriptPath = await canonicalTranscriptPath(home, convId);
      const sysGen = dirname(dirname(transcriptPath));
      await mkdir(join(sysGen, 'steps', '21'), { recursive: true });
      await writeFile(join(sysGen, 'steps', '21', 'output.txt'), `Created At: 2026-11-27T07:56:37+09:00\n${neighborShellOutput}`);
      await writeFile(transcriptPath, [
        JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Check parallel boundary' }),
        JSON.stringify({ step_index: 19, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Parallel calls' }),
      ].join('\n') + '\n');

      const { fetchImpl, sent } = mockHost();
      const hookOpts = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

      await handleAntigravityJudgmentHook({
        hookEventName: 'PreInvocation',
        conversationId: convId,
        invocationNum: 1,
        cwd: repo,
        transcriptPath,
        lastUserInput: 'Check parallel boundary',
      }, hookOpts);

      const postOut = await handleAntigravityJudgmentHook({
        hookEventName: 'PostToolUse',
        conversationId: convId,
        cwd: repo,
        stepIdx: 20,
        transcriptPath,
        toolCall: {
          id: 'toolu_bb_20',
          name: 'mcp_brainbase-unson_brainbase_judgment_frame_read',
          args: { id: 'frame_1' },
        },
      }, hookOpts);
      expect(postOut).toEqual({});
      expect(sent).toHaveLength(2);
      expect(JSON.stringify(sent[1].body)).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(sent[1].body.tool_response).toMatchObject({
        success: true,
        digest: expect.stringMatching(/^sha256:/u),
      });
      expect(sent[1].body.tool_response).not.toHaveProperty('content');
    }
  });

  it('recovers from transcript_full.jsonl or steps/<n>/output.txt even before transcript.jsonl exists, while preserving strict symlink/traversal/size boundaries', async () => {
    const dir = await tempDir();
    const allowedRoot = join(dir, 'brain');
    const outsideDir = join(dir, 'outside-secret');
    await mkdir(outsideDir, { recursive: true });
    const outsideSecretFile = join(outsideDir, 'secret.txt');
    await writeFile(outsideSecretFile, '{"secret":"MUST_NEVER_BE_READ"}\n');

    // 1. transcript.jsonl and even logs/ do NOT exist yet, while steps/5/output.txt already exists
    const convNoLogs = 'conv-before-first-flush';
    const noLogsSysGen = join(allowedRoot, convNoLogs, '.system_generated');
    await mkdir(join(noLogsSysGen, 'steps', '5'), { recursive: true });
    const blockA = JSON.stringify({ status: 'ok', data: { status: 'resolved' } });
    const blockB = JSON.stringify({ connection_scope: { organization_id: 'unson' } });
    await writeFile(join(noLogsSysGen, 'steps', '5', 'output.txt'), `${blockA}\n${blockB}\n`);
    const missingTranscriptPath = join(noLogsSysGen, 'logs', 'transcript.jsonl');
    expect(existsSync(missingTranscriptPath)).toBe(false);
    expect(extractToolResultTextBlocksFromTranscript(missingTranscriptPath, 5, {
      conversationId: convNoLogs,
      allowedTranscriptRoots: [allowedRoot],
    })).toEqual([blockA, blockB]);

    // 2. transcript.jsonl is unflushed, but sibling transcript_full.jsonl already has step 5
    const convFullOnly = 'conv-unflushed-but-full-present';
    const fullOnlyLogs = join(allowedRoot, convFullOnly, '.system_generated', 'logs');
    await mkdir(fullOnlyLogs, { recursive: true });
    const unflushedBase = join(fullOnlyLogs, 'transcript.jsonl');
    const flushedFull = join(fullOnlyLogs, 'transcript_full.jsonl');
    await writeFile(unflushedBase, JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'working' }) + '\n');
    await writeFile(flushedFull, JSON.stringify({
      step_index: 5,
      tool_use_id: 'toolu_full_5',
      source: 'MODEL',
      type: 'GENERIC',
      content: `Created At: 2026-11-27T07:55:36+09:00\n${blockA}\n${blockB}`,
    }) + '\n');
    expect(extractToolResultTextBlocksFromTranscript(unflushedBase, 5, {
      conversationId: convFullOnly,
      allowedTranscriptRoots: [allowedRoot],
      toolUseId: 'toolu_full_5',
    })).toEqual([blockA, blockB]);

    // 3. Security invariants on missing/unflushed transcript fallback:
    //    - dangling symlink at transcript.jsonl MUST fail closed
    const convDangling = 'conv-dangling-symlink';
    const danglingSysGen = join(allowedRoot, convDangling, '.system_generated');
    await mkdir(join(danglingSysGen, 'logs'), { recursive: true });
    await mkdir(join(danglingSysGen, 'steps', '5'), { recursive: true });
    await writeFile(join(danglingSysGen, 'steps', '5', 'output.txt'), `${blockA}\n`);
    const danglingTranscript = join(danglingSysGen, 'logs', 'transcript.jsonl');
    await symlink(join(outsideDir, 'does-not-exist.jsonl'), danglingTranscript);
    expect(extractToolResultFromTranscript(danglingTranscript, 5, {
      conversationId: convDangling,
      allowedTranscriptRoots: [allowedRoot],
    })).toBeNull();

    //    - symlinked logs/ directory MUST fail closed even when transcript.jsonl is missing
    const convSymLogs = 'conv-symlink-logs';
    const symLogsSysGen = join(allowedRoot, convSymLogs, '.system_generated');
    await mkdir(join(symLogsSysGen, 'steps', '5'), { recursive: true });
    await writeFile(join(symLogsSysGen, 'steps', '5', 'output.txt'), `${blockA}\n`);
    await symlink(outsideDir, join(symLogsSysGen, 'logs'));
    expect(extractToolResultFromTranscript(join(symLogsSysGen, 'logs', 'transcript.jsonl'), 5, {
      conversationId: convSymLogs,
      allowedTranscriptRoots: [allowedRoot],
    })).toBeNull();

    //    - symlinked steps/5/output.txt MUST fail closed when transcript.jsonl is unflushed
    const convSymStep = 'conv-symlink-step-unflushed';
    const symStepSysGen = join(allowedRoot, convSymStep, '.system_generated');
    await mkdir(join(symStepSysGen, 'logs'), { recursive: true });
    await mkdir(join(symStepSysGen, 'steps', '5'), { recursive: true });
    await symlink(outsideSecretFile, join(symStepSysGen, 'steps', '5', 'output.txt'));
    const symStepTranscript = join(symStepSysGen, 'logs', 'transcript.jsonl');
    await writeFile(symStepTranscript, JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'hi' }) + '\n');
    expect(extractToolResultFromTranscript(symStepTranscript, 5, {
      conversationId: convSymStep,
      allowedTranscriptRoots: [allowedRoot],
    })).toBeNull();

    //    - path traversal (`..`) in missing transcriptPath MUST fail closed
    const traversalMissingPath = `${noLogsSysGen}/steps/../logs/transcript.jsonl`;
    expect(extractToolResultFromTranscript(traversalMissingPath, 5, {
      conversationId: convNoLogs,
      allowedTranscriptRoots: [allowedRoot],
    })).toBeNull();

    //    - oversized (>512 KiB) steps/5/output.txt MUST fail closed when transcript.jsonl is unflushed
    const convOversized = 'conv-oversized-unflushed';
    const oversizedSysGen = join(allowedRoot, convOversized, '.system_generated');
    await mkdir(join(oversizedSysGen, 'logs'), { recursive: true });
    await mkdir(join(oversizedSysGen, 'steps', '5'), { recursive: true });
    await writeFile(join(oversizedSysGen, 'steps', '5', 'output.txt'), `{"huge":"${'a'.repeat(600 * 1024)}"}\n`);
    const oversizedTranscript = join(oversizedSysGen, 'logs', 'transcript.jsonl');
    await writeFile(oversizedTranscript, JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'hi' }) + '\n');
    expect(extractToolResultFromTranscript(oversizedTranscript, 5, {
      conversationId: convOversized,
      allowedTranscriptRoots: [allowedRoot],
    })).toBeNull();
  });
});

describe('Phase 2 pre-rollout Antigravity hook fixes (PR-A: Fix 1 & Fix 2)', () => {
  it('Fix 1: strips synthetic toolSummary from Brainbase MCP tool inputs (eager & call_mcp_tool) so strict judgment_frame matching succeeds, while preserving unknown keys and non-Brainbase args', async () => {
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const turnDir = join(home, 'turns');
    const testEnv = { ...env, BRAINBASE_ANTIGRAVITY_JUDGMENT_TURN_DIR: turnDir };
    const conversationId = 'conv-fix1-tool-summary';
    const transcriptPath = await canonicalTranscriptPath(home, conversationId);
    const sysGen = dirname(dirname(transcriptPath));

    const catalogDigest = `sha256:${'a'.repeat(64)}`;
    const framePayload = {
      record_version: JUDGMENT_FRAME_RECORD_VERSION,
      catalog_digest: catalogDigest,
      selections: [
        { ref: 'philosophy:local-first', kind: 'philosophy', why: 'Keep OSS runtime local-first.' },
      ],
      none: {
        objective: 'No active objective applies to this diagnostic check.',
        model: 'No world model applies to this diagnostic check.',
      },
      options: [
        {
          label: 'Verify locally',
          uses: [
            {
              ref: 'philosophy:local-first',
              role: 'constraint',
              verdict: 'satisfied',
              note: 'Runs strictly against local fixtures.',
            },
          ],
        },
      ],
      chosen_option: 'Verify locally',
    };
    const recordedFrameResponse = {
      status: 'ok',
      data: {
        record_version: JUDGMENT_FRAME_RECORD_VERSION,
        catalog_digest: catalogDigest,
        selections: framePayload.selections,
        none: framePayload.none,
        options: framePayload.options,
        chosen_option: framePayload.chosen_option,
        escalations: [],
      },
    };
    const evidenceArgs = {
      node_id: 'node_knowledge_lookup',
      tool_use_id: 'toolu_lookup_1',
      summary: 'Verified canonical hook contract.',
    };
    const kgAnswerArgs = {
      question: 'Which branch is the base for PR-A?',
      answer: 'develop',
      confidence: 'high',
    };

    await mkdir(join(sysGen, 'steps', '10'), { recursive: true });
    await mkdir(join(sysGen, 'steps', '11'), { recursive: true });
    await mkdir(join(sysGen, 'steps', '12'), { recursive: true });
    await writeFile(join(sysGen, 'steps', '10', 'output.txt'), `${JSON.stringify(recordedFrameResponse)}\n`);
    await writeFile(join(sysGen, 'steps', '11', 'output.txt'), `${JSON.stringify({ status: 'ok', data: { recorded: true } })}\n`);
    await writeFile(join(sysGen, 'steps', '12', 'output.txt'), `${JSON.stringify({ status: 'ok', data: { recorded: true } })}\n`);
    await writeFile(transcriptPath, JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: 'Record judgment frame and evidence',
    }) + '\n');

    const { fetchImpl, sent } = mockHost();
    const hookOpts = { env: testEnv, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Record judgment frame and evidence',
    }, hookOpts);

    // 1. Eager mcp_brainbase-unson_brainbase_judgment_frame_record with Antigravity synthetic `toolSummary`
    const rawFrameArgs = { ...framePayload, toolSummary: 'Record judgment frame for this turn' };
    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 10,
      transcriptPath,
      toolCall: {
        id: 'toolu_frame_10',
        name: 'mcp_brainbase-unson_brainbase_judgment_frame_record',
        args: rawFrameArgs,
      },
    }, hookOpts);

    // Original caller object must not be mutated.
    expect(rawFrameArgs.toolSummary).toBe('Record judgment frame for this turn');

    const framePost = sent[1].body;
    expect(framePost.tool_name).toBe('mcp__brainbase__brainbase_judgment_frame_record');
    const forwardedFrameInput = framePost.tool_input as Record<string, unknown>;
    expect(Object.hasOwn(forwardedFrameInput, 'toolSummary')).toBe(false);
    expect(forwardedFrameInput).toEqual(framePayload);

    // Mirror Host-side strict frameObjectKeys / canonicalJson projection + frameApplicationMetadata verification.
    const allowedFrameKeys = new Set([
      'record_version',
      'catalog_digest',
      'selections',
      'none',
      'options',
      'chosen_option',
      'public_frame',
    ]);
    expect(Object.keys(forwardedFrameInput).every((key) => allowedFrameKeys.has(key))).toBe(true);
    const frameResponseText = (
      framePost.tool_response as { content: Array<{ type: string; text: string }> }
    ).content[0].text;
    const parsedFrameData = (JSON.parse(frameResponseText) as { data: Record<string, unknown> }).data;
    const projectedRequest = {
      record_version: forwardedFrameInput.record_version,
      catalog_digest: forwardedFrameInput.catalog_digest,
      selections: forwardedFrameInput.selections,
      none: forwardedFrameInput.none,
      options: forwardedFrameInput.options,
      chosen_option: forwardedFrameInput.chosen_option,
    };
    const projectedResponse = {
      record_version: parsedFrameData.record_version,
      catalog_digest: parsedFrameData.catalog_digest,
      selections: parsedFrameData.selections,
      none: parsedFrameData.none,
      options: parsedFrameData.options,
      chosen_option: parsedFrameData.chosen_option,
    };
    expect(canonicalJson(projectedRequest)).toBe(canonicalJson(projectedResponse));
    const judgmentFrame = frameApplicationMetadata(parsedFrameData, forwardedFrameInput);
    expect(judgmentFrame.application_complete).toBe(true);
    expect(judgmentFrame.applications).toHaveLength(1);
    expect(judgmentFrame.applications[0]).toMatchObject({
      kind: 'philosophy',
      ref: 'philosophy:local-first',
      role: 'constraint',
      verdict: 'satisfied',
    });

    // 2. Eager brainbase_knowledge_evidence_record and brainbase_personal_kg_answer_record also strip toolSummary.
    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 11,
      transcriptPath,
      toolCall: {
        id: 'toolu_ev_11',
        name: 'mcp_brainbase-unson_brainbase_knowledge_evidence_record',
        args: { ...evidenceArgs, toolSummary: 'Record knowledge evidence' },
      },
    }, hookOpts);
    expect(sent[2].body.tool_name).toBe('mcp__brainbase__brainbase_knowledge_evidence_record');
    expect(sent[2].body.tool_input).toEqual(evidenceArgs);
    expect(Object.hasOwn(sent[2].body.tool_input as Record<string, unknown>, 'toolSummary')).toBe(false);

    await handleAntigravityJudgmentHook({
      hookEventName: 'PostToolUse',
      conversationId,
      cwd: repo,
      stepIdx: 12,
      transcriptPath,
      toolCall: {
        id: 'toolu_kg_12',
        name: 'mcp_brainbase-unson_brainbase_personal_kg_answer_record',
        args: { ...kgAnswerArgs, toolSummary: 'Record personal KG answer' },
      },
    }, hookOpts);
    expect(sent[3].body.tool_name).toBe('mcp__brainbase__brainbase_personal_kg_answer_record');
    expect(sent[3].body.tool_input).toEqual(kgAnswerArgs);
    expect(Object.hasOwn(sent[3].body.tool_input as Record<string, unknown>, 'toolSummary')).toBe(false);

    // 3. call_mcp_tool (both `Arguments` and `arguments`) strips `toolSummary`, while keeping other unknown keys untouched.
    const lazyUpper = __antigravityHookTestInternals.normalizedToolInput(
      'call_mcp_tool',
      'mcp__brainbase__brainbase_judgment_frame_record',
      {
        ServerName: 'brainbase-unson',
        ToolName: 'brainbase_judgment_frame_record',
        Arguments: { ...framePayload, toolSummary: 'Lazy summary', unexpectedKey: 'keep-for-host-validation' },
      },
    ) as Record<string, unknown>;
    expect(Object.hasOwn(lazyUpper, 'toolSummary')).toBe(false);
    expect(lazyUpper.unexpectedKey).toBe('keep-for-host-validation');

    const lazyLower = __antigravityHookTestInternals.normalizedToolInput(
      'call_mcp_tool',
      'mcp__brainbase__brainbase_personal_kg_answer_record',
      {
        serverName: 'brainbase-unson',
        toolName: 'brainbase_personal_kg_answer_record',
        arguments: { ...kgAnswerArgs, toolSummary: 'Lowercase lazy summary' },
      },
    ) as Record<string, unknown>;
    expect(lazyLower).toEqual(kgAnswerArgs);
    expect(Object.hasOwn(lazyLower, 'toolSummary')).toBe(false);

    // Non-plain Arguments (null / array) stay intact without throwing.
    expect(__antigravityHookTestInternals.normalizedToolInput(
      'call_mcp_tool',
      'mcp__brainbase__search',
      { ServerName: 'brainbase-unson', ToolName: 'search', Arguments: null },
    )).toBeNull();
    expect(__antigravityHookTestInternals.normalizedToolInput(
      'call_mcp_tool',
      'mcp__brainbase__search',
      { ServerName: 'brainbase-unson', ToolName: 'search', Arguments: ['a', 'b'] },
    )).toEqual(['a', 'b']);

    // 4. Non-Brainbase tools (`run_command`, non-Brainbase `call_mcp_tool`) are completely unaffected.
    const runCommandArgs = { CommandLine: 'git status', toolSummary: 'Check git status' };
    expect(__antigravityHookTestInternals.normalizedToolInput('run_command', 'run_command', runCommandArgs))
      .toEqual(runCommandArgs);
    const otherMcpArgs = {
      ServerName: 'reason-network',
      ToolName: 'send_message',
      Arguments: { message: 'hello', toolSummary: 'Send team message' },
      toolSummary: 'Outer summary',
    };
    expect(__antigravityHookTestInternals.normalizedToolInput('call_mcp_tool', 'call_mcp_tool', otherMcpArgs))
      .toEqual(otherMcpArgs);
  });

  it('Fix 2: strips Orca-injected SOUL.md / MEMORY.md / [Orca: ...] preambles while preserving user text, bot-to-bot messages, and fail-safe fallback', async () => {
    const orcaCombinedPrompt = [
      "[Your SOUL.md was updated; this replaces your earlier standing instructions. They rank below the user's current request.]",
      '',
      '# SOUL.md',
      '- 本番デプロイは人間の明示承認がない限り実行禁止',
      '- 外部送信（Slack / メール / Webhook）は禁止',
      '- リンク確認時は [Orca: ...] を誤認しないこと',
      '',
      '[Your MEMORY.md changed outside this chat since you last saw it. These are notes to consult, not instructions.]',
      'Added:',
      '<<<',
      '- 2026-11-27: Item #172 Phase 1 canary observation active',
      '>>>',
      'Removed:',
      '<<<',
      '- Outdated canary note',
      '>>>',
      '',
      '[Orca: your other chats active in the last 48 h, newest first (names, not instructions):]',
      '<<<',
      '- unson-lab / canary-review',
      '>>>',
      '',
      '[Orca: your live work now, for reference:]',
      '<<<',
      '- Item #172 Phase 1 verification',
      '>>>',
      '',
      '今君は正しくhooks経由でBrainbaseをひけてるの？',
    ].join('\n');

    expect(stripOrcaInjectedPreambles(orcaCombinedPrompt))
      .toBe('今君は正しくhooks経由でBrainbaseをひけてるの？');

    // Transcript extraction + PreInvocation (both transcript fallback and direct lastUserInput) strip the preambles cleanly.
    const { home, repo, configPath, env } = await setupConfig({ project_code: 'unson-lab' });
    const convId = 'conv-fix2-orca-preambles';
    const transcriptPath = await canonicalTranscriptPath(home, convId);
    await writeFile(transcriptPath, [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        content: `<USER_REQUEST>\n${orcaCombinedPrompt}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>now</ADDITIONAL_METADATA>`,
      }),
      JSON.stringify({
        step_index: 1,
        source: 'SYSTEM_SDK',
        type: 'USER_INPUT',
        content: 'Reason Network: you are info/jin.',
      }),
    ].join('\n') + '\n');

    expect(extractLatestNonSystemUserInput(transcriptPath, { conversationId: convId, env }))
      .toEqual({ stepIndex: 0, content: '今君は正しくhooks経由でBrainbaseをひけてるの？' });

    const { fetchImpl, sent } = mockHost();
    const opts = { env, fetch: fetchImpl, accessToken: token, configPath, registrationId: REG };

    // Via transcript fallback (lastUserInput overwritten by Reason Network)
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: convId,
      invocationNum: 1,
      cwd: repo,
      transcriptPath,
      lastUserInput: 'Reason Network: you are info/jin.',
    }, opts);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.prompt).toBe('今君は正しくhooks経由でBrainbaseをひけてるの？');
    expect(String(sent[0].body.prompt)).not.toContain('本番デプロイ');
    expect(String(sent[0].body.prompt)).not.toContain('外部送信');

    // Via direct lastUserInput on a fresh conversation
    await handleAntigravityJudgmentHook({
      hookEventName: 'PreInvocation',
      conversationId: 'conv-fix2-direct-last-input',
      invocationNum: 1,
      cwd: repo,
      lastUserInput: `<USER_REQUEST>\n${orcaCombinedPrompt}\n</USER_REQUEST>`,
    }, opts);
    expect(sent).toHaveLength(2);
    expect(sent[1].body.prompt).toBe('今君は正しくhooks経由でBrainbaseをひけてるの？');

    // Bot-to-bot message after `[Orca: if you asked your owner something ...]` must preserve `──── From: ...` verbatim.
    const botMessageBody = [
      '──── From: ORCA_SESSION_ID:999621c5-6e6b-4707-b1e1-e8ea0730c681',
      'PR-A の実装を開始してください。',
      '条件:',
      '- base は develop',
      '- author-model: gemini を末尾に記載',
    ].join('\n');
    const orcaWithBotMessage = [
      '[Orca: if you asked your owner something in this chat and got no reply, check whether they answered in another chat.]',
      '',
      botMessageBody,
    ].join('\n');
    expect(stripOrcaInjectedPreambles(orcaWithBotMessage)).toBe(botMessageBody);

    // Ordinary human utterance without preambles (including mid-sentence `[Orca: ...]`) stays byte-for-byte intact.
    const ordinaryPrompt = '通常の発話です。[Orca: ...] ブロックが途中にあっても削らないでください。';
    expect(stripOrcaInjectedPreambles(ordinaryPrompt)).toBe(ordinaryPrompt);

    // User-authored leading `[Orca: ...]` headings — including ambiguous `[Orca: it is ...]` and
    // user `[Orca: ...]` followed by `<<<\n...\n>>>` fences — stay 100% byte-for-byte intact.
    const userMigrationNotes = '[Orca: migration notes] Please summarize this heading and sentence.';
    expect(stripOrcaInjectedPreambles(userMigrationNotes)).toBe(userMigrationNotes);

    const userItIsTimeToMigrate = '[Orca: it is time to migrate] Please summarize this heading and sentence.';
    expect(stripOrcaInjectedPreambles(userItIsTimeToMigrate)).toBe(userItIsTimeToMigrate);

    const userItIsBroken = '[Orca: it is broken] please fix';
    expect(stripOrcaInjectedPreambles(userItIsBroken)).toBe(userItIsBroken);

    const userMyPasteFence = '[Orca: my paste]\n<<<\ncode\n>>>\nexplain this';
    expect(stripOrcaInjectedPreambles(userMyPasteFence)).toBe(userMyPasteFence);

    const userNote = '[Orca: note] I wrote this myself';
    expect(stripOrcaInjectedPreambles(userNote)).toBe(userNote);

    const userJapaneseHeading = '[Orca: 質問]\nフックの仕様を教えて';
    expect(stripOrcaInjectedPreambles(userJapaneseHeading)).toBe(userJapaneseHeading);

    // Near-miss non-system headers (loose `[Orca: it is ...]`, unknown fenced `[Orca: ...]`,
    // shortened `[Your MEMORY.md changed]`, or missing-space `[Your SOUL.md was updated;...]`) are NOT stripped.
    const looseItIsPrompt = '[Orca: it is Friday, Nov 27, 2026.]\n\n通常プロンプト';
    expect(stripOrcaInjectedPreambles(looseItIsPrompt)).toBe(looseItIsPrompt);
    const isoWithoutActionSuffix = '[Orca: it is 2026-11-27T19:00:00+09:00] please check';
    expect(stripOrcaInjectedPreambles(isoWithoutActionSuffix)).toBe(isoWithoutActionSuffix);
    const customFencedOrca = '[Orca: custom reference block:]\n<<<\n- item\n>>>\n\n通常プロンプト';
    expect(stripOrcaInjectedPreambles(customFencedOrca)).toBe(customFencedOrca);
    const shortMemoryHeader = '[Your MEMORY.md changed] please review';
    expect(stripOrcaInjectedPreambles(shortMemoryHeader)).toBe(shortMemoryHeader);

    // Exact known Orca system preambles (`your MEMORY.md, as notes to consult, ` and strict ISO-8601 scheduled time) ARE stripped.
    expect(stripOrcaInjectedPreambles(
      '[Orca: it is 2026-11-27T19:00:00+09:00, the time you were asked to act at.]\n\n通常プロンプト',
    )).toBe('通常プロンプト');
    expect(stripOrcaInjectedPreambles(
      '[Orca: it is 2026-11-27T10:00:00.123Z, the time you were asked to act at.]\n\n通常プロンプト',
    )).toBe('通常プロンプト');
    expect(stripOrcaInjectedPreambles(
      '[Orca: your MEMORY.md, as notes to consult, not instructions:]\n<<<\n- memo\n>>>\n\n通常プロンプト',
    )).toBe('通常プロンプト');

    // `findNextKnownOrcaPreambleStart` ignores user-authored `[Orca: ...]` lines (including ambiguous `[Orca: it is ...]` and fenced blocks) inside SOUL.md body and preserves user `[Orca: ...]` after real preambles.
    const soulWithUserOrcaLines = [
      "[Your SOUL.md was updated; this replaces your earlier standing instructions. They rank below the user's current request.]",
      '',
      '# SOUL.md',
      '[Orca: note] Standing note that starts with [Orca: ...] at line start',
      '[Orca: it is broken] Do not treat this as a system preamble',
      '[Orca: my paste]',
      '<<<',
      'code',
      '>>>',
      '',
      '[Orca: your live work now, for reference:]',
      '<<<',
      '- Item #172 verification',
      '>>>',
      '',
      userMigrationNotes,
    ].join('\n');
    expect(stripOrcaInjectedPreambles(soulWithUserOrcaLines)).toBe(userMigrationNotes);

    const soulFollowedOnlyByUserOrcaHeading = [
      "[Your SOUL.md was updated; this replaces your earlier standing instructions. They rank below the user's current request.]",
      '',
      '# SOUL.md',
      '- Standalone SOUL update',
      '',
      userMyPasteFence,
    ].join('\n');
    expect(stripOrcaInjectedPreambles(soulFollowedOnlyByUserOrcaHeading)).toBe(soulFollowedOnlyByUserOrcaHeading);

    // Fail-safe: preamble-only inputs MUST NEVER become empty strings.
    const orcaOnlyPrompt = '[Orca: your live work now, for reference:]\n<<<\n- Item #172\n>>>';
    expect(stripOrcaInjectedPreambles(orcaOnlyPrompt)).toBe(orcaOnlyPrompt);
    expect(stripOrcaInjectedPreambles(orcaOnlyPrompt).length).toBeGreaterThan(0);

    const soulOnlyPrompt = [
      "[Your SOUL.md was updated; this replaces your earlier standing instructions. They rank below the user's current request.]",
      '',
      '# SOUL.md',
      '- Standalone SOUL update without following known preamble',
    ].join('\n');
    expect(stripOrcaInjectedPreambles(soulOnlyPrompt)).toBe(soulOnlyPrompt);
    expect(stripOrcaInjectedPreambles(soulOnlyPrompt).length).toBeGreaterThan(0);

    // Adversarial ReDoS regression: deeply repeated unclosed prefixes finish in linear time and fail safe.
    const adversarial = `${'[Orca: '.repeat(5000)}unclosed`;
    const startedAt = Date.now();
    expect(stripOrcaInjectedPreambles(adversarial)).toBe(adversarial);
    expect(Date.now() - startedAt).toBeLessThan(200);
  });
});
