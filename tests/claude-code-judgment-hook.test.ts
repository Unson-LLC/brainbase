import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  forwardedToolPayload,
  handleClaudeCodeJudgmentHook,
  registerClaudeCodeJudgmentHooks,
  repositoryName,
  type ClaudeCodeHookConfig,
} from '../src/claude-code-judgment-hook.js';
import { BrainbaseLoginError } from '../src/brainbase-login.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-claude-hook-'));
  dirs.push(dir);
  return dir;
}

async function checkout(root: string, name: string, origin?: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, '.git', 'config'), origin ? `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n` : '[core]\n');
  await mkdir(join(dir, 'src'), { recursive: true });
  return dir;
}

interface Sent { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function host(respond: (body: Record<string, unknown>) => { status: number; body: unknown } = (body) => ({
  status: 200,
  body: {
    schema_version: '1', accepted: true, hook_event_name: body.hook_event_name, session_id: body.session_id,
    turn_id: body.turn_id, output: { hookSpecificOutput: { additionalContext: 'context from host' } },
  },
})) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
    const answer = respond(body);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

async function setup(config: Partial<ClaudeCodeHookConfig> | null = {}) {
  const home = await tempDir();
  const repo = await checkout(home, 'work-app', 'git@github.com:acme/growin-app.git');
  if (config) {
    await mkdir(join(home, '.brainbase'), { recursive: true });
    await writeFile(join(home, '.brainbase', 'claude-code-judgment-hook.json'), JSON.stringify({
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', ...config,
    }));
  }
  const env = { HOME: home } as NodeJS.ProcessEnv;
  return { home, repo, env };
}

const token = async () => 'person-jwt';

describe('handleClaudeCodeJudgmentHook', () => {
  it('forwards nothing until the hook is installed', async () => {
    const { repo, env } = await setup(null);
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo, prompt: 'hi' },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(output).toEqual({});
    expect(sent).toEqual([]);
  });

  it('sends the person token and the repository name, and lets the Host choose the project', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: join(repo, 'src'), prompt: 'hi' },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(output).toEqual({ hookSpecificOutput: { additionalContext: 'context from host', hookEventName: 'UserPromptSubmit' } });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://mcp.example.net/host/judgment/hook');
    expect(sent[0].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer person-jwt',
      'x-brainbase-judgment-host': 'claude-code',
      'x-brainbase-repository': 'growin-app',
    });
    expect(sent[0].body).toMatchObject({ hook_event_name: 'UserPromptSubmit', session_id: 's1', turn_id: 'p1' });
  });

  it('sends the configured project code', async () => {
    const { repo, env } = await setup({ project_code: 'growin' });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(sent[0].headers['x-brainbase-project-code']).toBe('growin');
  });

  it('audits only the configured repositories', async () => {
    const { repo, env } = await setup({ repositories: ['other-repo'] });
    const { fetchImpl, sent } = host();
    const submit = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    const post = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: repo, tool_name: 'Bash', tool_input: {}, tool_response: {} },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect([submit, post]).toEqual([{}, {}]);
    expect(sent).toEqual([]);
  });

  it('does not audit a directory outside git', async () => {
    const { home, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: home },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(sent).toEqual([]);
  });

  it('sends digests, not bodies, of an ordinary tool in the started turn', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: repo, tool_name: 'Read',
        tool_input: { file_path: '/secret/file' }, tool_response: { content: 'file body' } },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1].body)).not.toContain('file body');
    expect(JSON.stringify(sent[1].body)).not.toContain('/secret/file');
    expect(sent[1].body).toMatchObject({ turn_id: 'p1', tool_response: { success: true } });
  });

  it('turns a Host repair request at Stop into a notice instead of blocking', async () => {
    const { repo, env } = await setup();
    const { fetchImpl } = host((body) => ({
      status: 200,
      body: {
        schema_version: '1', accepted: true, hook_event_name: body.hook_event_name, session_id: body.session_id,
        turn_id: body.turn_id,
        output: body.hook_event_name === 'Stop' ? { decision: 'block', reason: 'repair r-0123456789abcdef' } : {},
      },
    }));
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(output).not.toHaveProperty('decision');
    expect(String(output.systemMessage)).toContain('r-0123456789abcdef');
  });

  it('warns with the Host reason when the project cannot be decided, and records the turn as not started', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host(() => ({ status: 400, body: { error: 'judgment_project_unresolved' } }));
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_http_400_judgment_project_unresolved');
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(sent).toHaveLength(1);
  });

  it('warns that the person must log in, without sending anything', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: async () => { throw new BrainbaseLoginError('login_missing'); } },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_login_missing');
    expect(sent).toEqual([]);
  });

  it('refuses to send the token over plain http to another machine', async () => {
    const { repo, env } = await setup({ origin: 'http://mcp.example.net' });
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_transport_unsafe');
    expect(sent).toEqual([]);
  });

  it('stays silent when switched off or for a subagent event', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env: { ...env, BRAINBASE_CLAUDE_JUDGMENT_HOOK: 'disabled' }, fetch: fetchImpl, accessToken: token },
    );
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo, agent_id: 'sub' },
      { env, fetch: fetchImpl, accessToken: token },
    );
    expect(sent).toEqual([]);
  });

  it('does not resend a screening UserPromptSubmit of the running prompt', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    for (let index = 0; index < 2; index += 1) {
      await handleClaudeCodeJudgmentHook(
        { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
        { env, fetch: fetchImpl, accessToken: token },
      );
    }
    expect(sent).toHaveLength(1);
  });
});

describe('repository identity', () => {
  it('uses the origin repository name, and the directory without an origin', async () => {
    const root = await tempDir();
    expect(repositoryName(await checkout(root, 'a', 'https://github.com/acme/app.git'))).toBe('app');
    expect(repositoryName(await checkout(root, 'local-only'))).toBe('local-only');
  });
});

describe('forwardedToolPayload', () => {
  it('keeps a Brainbase tool as it is and marks a failed command as unsuccessful', () => {
    const brainbase = { tool_name: 'mcp__brainbase__search', tool_input: { q: 'x' } };
    expect(forwardedToolPayload(brainbase)).toBe(brainbase);
    expect(forwardedToolPayload({ tool_name: 'Bash', tool_response: { exit_code: 1 } }).tool_response)
      .toMatchObject({ success: false });
  });
});

describe('registerClaudeCodeJudgmentHooks', () => {
  const command = '"/usr/bin/node" "/pkg/dist/cli.js" judgment:claude-code-hook';

  it('adds one registration per event, keeps other hooks, and is idempotent', () => {
    const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] }, model: 'x' };
    const once = registerClaudeCodeJudgmentHooks(other, { command });
    const twice = registerClaudeCodeJudgmentHooks(once, { command });
    expect(twice).toEqual(once);
    const hooks = once.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(Object.keys(hooks).sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
    expect(hooks.Stop.map((group) => group.hooks[0].command)).toEqual(['echo bye', command]);
    expect(once.model).toBe('x');
    expect(hooks).not.toHaveProperty('SessionEnd');
  });

  it('removes only the judgment registrations', () => {
    const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } };
    const removed = registerClaudeCodeJudgmentHooks(registerClaudeCodeJudgmentHooks(other, { command }), { command, remove: true });
    expect(removed).toEqual(other);
    expect(registerClaudeCodeJudgmentHooks({}, { command, remove: true })).toEqual({});
  });
});

describe('judgment:install --target claude-code', () => {
  function capture() {
    let stdout = '';
    let stderr = '';
    return {
      io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
      stdout: () => stdout, stderr: () => stderr,
    };
  }

  it('writes the settings and the hook config, then removes both', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'claude', 'settings.json');
    const config = join(dir, 'brainbase', 'hook.json');
    await mkdir(join(dir, 'claude'));
    await writeFile(settings, JSON.stringify({ permissions: { allow: ['Read'] } }));
    const out = capture();
    expect(await runCli([
      'judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net/mcp',
      '--repositories', 'growin-app,growin-api', '--settings', settings, '--config', config,
    ], out.io)).toBe(0);
    const written = JSON.parse(await readFile(settings, 'utf8'));
    expect(written.permissions).toEqual({ allow: ['Read'] });
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toContain('judgment:claude-code-hook');
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', repositories: ['growin-app', 'growin-api'],
    });

    const removed = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], removed.io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ permissions: { allow: ['Read'] } });
    await expect(readFile(config, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('previews without writing on --dry-run and refuses a missing or unsafe origin', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--project', 'growin',
      '--settings', settings, '--config', join(dir, 'hook.json'), '--dry-run'], out.io)).toBe(0);
    expect(JSON.parse(out.stdout()).config).toMatchObject({ origin: 'https://mcp.example.net', project_code: 'growin' });
    await expect(readFile(settings, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const missing = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--settings', settings], missing.io)).toBe(1);
    expect(missing.stderr()).toContain('--origin');
    const unsafe = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'http://mcp.example.net', '--settings', settings], unsafe.io)).toBe(1);
  });

  it('the hook command answers with valid JSON and exit 0 even for broken input', async () => {
    const out = capture();
    expect(await runCli(['judgment:claude-code-hook'], { ...out.io, stdin: Readable.from(['not json']) })).toBe(0);
    expect(JSON.parse(out.stdout()).systemMessage).toContain('判断フック');
  });
});
