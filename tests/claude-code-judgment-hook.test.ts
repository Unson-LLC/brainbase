import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  forwardedToolPayload,
  handleClaudeCodeJudgmentHook,
  claudeCodeHookCommand,
  namespacedId,
  installedHookConfigPath,
  registerClaudeCodeJudgmentHooks,
  repositoryIdentity,
  repositoryIdentityFromUrl,
  type ClaudeCodeHookConfig,
} from '../src/claude-code-judgment-hook.js';
import { BrainbaseLoginError } from '../src/brainbase-login.js';
import { readHookStdin, runCli } from '../src/cli.js';

const REG = 'a'.repeat(32);
const REGISTRATION = { id: REG, settings: '/home/me/.claude/settings.json' };

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
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, '.git', 'refs'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
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
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', login_server: 'https://api.example.net', registration: REGISTRATION, ...config,
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
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(output).toEqual({});
    expect(sent).toEqual([]);
  });

  it('sends the person token and the repository name, and lets the Host choose the project', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: join(repo, 'src'), prompt: 'hi' },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(output).toEqual({ hookSpecificOutput: { additionalContext: 'context from host', hookEventName: 'UserPromptSubmit' } });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://mcp.example.net/host/judgment/hook');
    expect(sent[0].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer person-jwt',
      'x-brainbase-judgment-host': 'claude-code',
      'x-brainbase-repository': 'github.com/acme/growin-app',
    });
    expect(sent[0].body).toMatchObject({
      hook_event_name: 'UserPromptSubmit',
      session_id: namespacedId('s1', { registration: REGISTRATION }),
      turn_id: namespacedId('p1', { registration: REGISTRATION }),
    });
  });

  it('sends the configured project code', async () => {
    const { repo, env } = await setup({ project_code: 'growin' });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent[0].headers['x-brainbase-project-code']).toBe('growin');
  });

  it('audits only the configured repositories', async () => {
    const { repo, env } = await setup({ repositories: ['github.com/acme/other-repo'] });
    const { fetchImpl, sent } = host();
    const submit = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    const post = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: repo, tool_name: 'Bash', tool_input: {}, tool_response: {} },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect([submit, post]).toEqual([{}, {}]);
    expect(sent).toEqual([]);
  });

  it('does not audit a repository of the same name under another owner', async () => {
    const { repo, env } = await setup({ repositories: ['github.com/someone-else/growin-app'] });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toEqual([]);
  });

  it('forwards nothing when the repository list holds a bare name, instead of auditing everything', async () => {
    const { repo, env } = await setup({ repositories: ['growin-app'] });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toEqual([]);
  });

  it('keeps later events in the repository the turn was opened in', async () => {
    const { home, repo, env } = await setup({ repositories: ['github.com/acme/growin-app'] });
    const elsewhere = await checkout(home, 'private', 'git@github.com:acme/private-notes.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, accessToken: token, registrationId: REG };
    await handleClaudeCodeJudgmentHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo }, options);
    const moved = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: elsewhere, tool_name: 'Bash', tool_input: {}, tool_response: {} },
      options,
    );
    const stop = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: elsewhere, last_assistant_message: 'secret answer' },
      options,
    );
    expect(moved).toEqual({});
    expect(String(stop.systemMessage)).toContain('judgment_turn_repository_changed');
    expect(sent.map((request) => request.body.hook_event_name)).toEqual(['UserPromptSubmit']);

    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: join(repo, 'src'), tool_name: 'Bash', tool_input: {}, tool_response: {} },
      options,
    );
    expect(sent).toHaveLength(2);
    expect(sent[1].headers['x-brainbase-repository']).toBe('github.com/acme/growin-app');
  });

  it('reads the config file it is given instead of the default one', async () => {
    const { home, repo, env } = await setup(null);
    const config = join(home, 'elsewhere', 'hook.json');
    await mkdir(join(home, 'elsewhere'));
    await writeFile(config, JSON.stringify({ schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://other.example.net', login_server: 'https://api.example.net', registration: REGISTRATION }));
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config },
    );
    expect(sent.map((request) => request.url)).toEqual(['https://other.example.net/host/judgment/hook']);
  });

  it('does not audit a directory outside git', async () => {
    const { home, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: home },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toEqual([]);
  });

  it('sends digests, not bodies, of an ordinary tool in the started turn', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd: repo, tool_name: 'Read',
        tool_input: { file_path: '/secret/file' }, tool_response: { content: 'file body' } },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1].body)).not.toContain('file body');
    expect(JSON.stringify(sent[1].body)).not.toContain('/secret/file');
    expect(sent[1].body).toMatchObject({ turn_id: namespacedId('p1', { registration: REGISTRATION }), tool_response: { success: true } });
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
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(output).not.toHaveProperty('decision');
    expect(String(output.systemMessage)).toContain('r-0123456789abcdef');
  });

  it('warns with the Host reason when the project cannot be decided, and records the turn as not started', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host(() => ({ status: 400, body: { error: 'judgment_project_unresolved' } }));
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_http_400_judgment_project_unresolved');
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toHaveLength(1);
  });

  it('warns that the person must log in, without sending anything', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, registrationId: REG, accessToken: async () => { throw new BrainbaseLoginError('login_missing'); } },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_login_missing');
    expect(sent).toEqual([]);
  });

  it('refuses to send the token over plain http to another machine', async () => {
    const { repo, env } = await setup({ origin: 'http://mcp.example.net' });
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(String(output.systemMessage)).toContain('judgment_hook_transport_unsafe');
    expect(sent).toEqual([]);
  });

  it('stays silent when switched off or for a subagent event', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
      { env: { ...env, BRAINBASE_CLAUDE_JUDGMENT_HOOK: 'disabled' }, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo, agent_id: 'sub' },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toEqual([]);
  });

  it('does not resend a screening UserPromptSubmit of the running prompt', async () => {
    const { repo, env } = await setup();
    const { fetchImpl, sent } = host();
    for (let index = 0; index < 2; index += 1) {
      await handleClaudeCodeJudgmentHook(
        { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: repo },
        { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
      );
    }
    expect(sent).toHaveLength(1);
  });
});

describe('repository identity', () => {
  it('is host/owner/name of the origin remote, and null without one', async () => {
    const root = await tempDir();
    expect(repositoryIdentity(await checkout(root, 'a', 'https://github.com/Acme/App.git'))).toBe('github.com/acme/app');
    expect(repositoryIdentity(await checkout(root, 'local-only'))).toBeNull();
  });

  it('reads https, ssh and scp-like remotes alike, and tells owners and hosts apart', () => {
    expect(repositoryIdentityFromUrl('git@github.com:acme/app.git')).toBe('github.com/acme/app');
    expect(repositoryIdentityFromUrl('ssh://git@github.com/acme/app.git')).toBe('github.com/acme/app');
    expect(repositoryIdentityFromUrl('https://token@github.com/acme/app/')).toBe('github.com/acme/app');
    expect(repositoryIdentityFromUrl('git@gitlab.example.com:group/sub/app.git')).toBe('gitlab.example.com/group/sub/app');
    expect(repositoryIdentityFromUrl('git@github.com:other/app.git')).not.toBe(repositoryIdentityFromUrl('git@github.com:acme/app.git'));
    expect(repositoryIdentityFromUrl('/srv/git/app.git')).toBeNull();
  });

  it('does not take an empty .git entry for a repository', async () => {
    const root = await tempDir();
    await mkdir(join(root, '.git'));
    const { fetchImpl, sent } = host();
    const env = { HOME: root } as NodeJS.ProcessEnv;
    await mkdir(join(root, '.brainbase'));
    await writeFile(join(root, '.brainbase', 'claude-code-judgment-hook.json'), JSON.stringify({
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', login_server: 'https://api.example.net', registration: REGISTRATION,
    }));
    await handleClaudeCodeJudgmentHook(
      { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd: root },
      { env, fetch: fetchImpl, accessToken: token, registrationId: REG },
    );
    expect(sent).toEqual([]);
  });
});

describe('readHookStdin', () => {
  it('keeps a multibyte character that is split across chunks', async () => {
    const bytes = Buffer.from(JSON.stringify({ prompt: '日本語の監査' }), 'utf8');
    const chunks = Array.from({ length: bytes.length }, (_, index) => bytes.subarray(index, index + 1));
    expect(JSON.parse(await readHookStdin(Readable.from(chunks)))).toEqual({ prompt: '日本語の監査' });
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
  const configPath = '/home/me/.brainbase/claude-code-judgment-hook.json';
  const command = claudeCodeHookCommand('/usr/bin/node', '/pkg/dist/cli.js', configPath, REG);

  it('adds one registration per event, keeps other hooks, and is idempotent', () => {
    const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] }, model: 'x' };
    const once = registerClaudeCodeJudgmentHooks(other, { command, configPath });
    const twice = registerClaudeCodeJudgmentHooks(once, { command, configPath });
    expect(twice).toEqual(once);
    const hooks = once.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(Object.keys(hooks).sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
    expect(hooks.Stop.map((group) => group.hooks[0].command)).toEqual(['echo bye', command]);
    expect(once.model).toBe('x');
    expect(hooks).not.toHaveProperty('SessionEnd');
  });

  it('removes only the judgment registrations', () => {
    const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } };
    const removed = registerClaudeCodeJudgmentHooks(
      registerClaudeCodeJudgmentHooks(other, { command, configPath }), { command, configPath, remove: true },
    );
    expect(removed).toEqual(other);
    expect(registerClaudeCodeJudgmentHooks({}, { command, configPath, remove: true })).toEqual({});
  });

  it('leaves wrappers, look-alikes and registrations of another config file alone', () => {
    const wrapper = { type: 'command', command: `/opt/audit/wrap.sh ${command}` };
    const mention = { type: 'command', command: 'echo judgment:claude-code-hook --config x' };
    const otherConfig = { type: 'command', command: claudeCodeHookCommand('/usr/bin/node', '/pkg/dist/cli.js', '/elsewhere/hook.json', REG) };
    const settings = { hooks: { Stop: [{ hooks: [wrapper, mention, otherConfig] }] } };
    expect(installedHookConfigPath(wrapper)).toBeNull();
    expect(installedHookConfigPath(mention)).toBeNull();
    const removed = registerClaudeCodeJudgmentHooks(
      registerClaudeCodeJudgmentHooks(settings, { command, configPath }), { command, configPath, remove: true },
    );
    expect(removed).toEqual(settings);
  });

  it('quotes every argument so the shell passes paths through unchanged', async () => {
    const dir = await tempDir();
    const script = join(dir, 'print args.mjs');
    await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const tricky = join(dir, "it's $(touch pwned) `id` & \"q\".json");
    const quoted = claudeCodeHookCommand(process.execPath, script, tricky, REG);
    expect(JSON.parse(execFileSync('/bin/sh', ['-c', quoted], { encoding: 'utf8' })))
      .toEqual(['judgment:claude-code-hook', '--config', tricky, '--registration', REG]);
    expect(installedHookConfigPath({ type: 'command', command: quoted })).toBe(tricky);
    await expect(readFile(join(dir, 'pwned'))).rejects.toMatchObject({ code: 'ENOENT' });
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
      'judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net/mcp', '--server', 'https://api.example.net',
      '--repositories', 'github.com/Acme/growin-app,github.com/acme/growin-api', '--settings', settings, '--config', config,
    ], out.io)).toBe(0);
    expect(out.stdout()).toContain('Claude Codeを再起動してください。');
    const written = JSON.parse(await readFile(settings, 'utf8'));
    expect(written.permissions).toEqual({ allow: ['Read'] });
    expect(installedHookConfigPath(written.hooks.UserPromptSubmit[0].hooks[0])).toBe(config);
    const savedConfig = JSON.parse(await readFile(config, 'utf8'));
    expect(savedConfig).toEqual({
      schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', login_server: 'https://api.example.net',
      repositories: ['github.com/acme/growin-app', 'github.com/acme/growin-api'],
      registration: { id: expect.stringMatching(/^[a-f0-9]{32}$/u), settings: await realpath(settings) },
    });
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toContain(`'--registration' '${savedConfig.registration.id}'`);

    const removed = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], removed.io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ permissions: { allow: ['Read'] } });
    await expect(readFile(config, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses settings and config that are the same file, also through a symlink, and a bare repository name', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'claude', 'settings.json');
    await mkdir(join(dir, 'claude'));
    const original = JSON.stringify({ permissions: { allow: ['Read'] } });
    await writeFile(settings, original);
    await symlink(join(dir, 'claude'), join(dir, 'alias'));
    for (const config of [settings, join(dir, 'alias', 'settings.json'), join(dir, 'claude', '..', 'claude', 'settings.json')]) {
      for (const extra of [[], ['--remove']]) {
        const out = capture();
        expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net',
          '--settings', settings, '--config', config, ...extra], out.io)).toBe(1);
        expect(out.stderr()).toContain('different files');
      }
    }
    expect(await readFile(settings, 'utf8')).toBe(original);

    const bare = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net',
      '--repositories', 'growin-app', '--settings', settings, '--config', join(dir, 'hook.json')], bare.io)).toBe(1);
    expect(bare.stderr()).toContain('host/owner/name');
  });

  it('previews without writing on --dry-run and refuses a missing or unsafe origin', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net', '--project', 'growin',
      '--settings', settings, '--config', join(dir, 'hook.json'), '--dry-run'], out.io)).toBe(0);
    expect(JSON.parse(out.stdout()).config).toMatchObject({ origin: 'https://mcp.example.net', project_code: 'growin' });
    await expect(readFile(settings, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const missing = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--settings', settings], missing.io)).toBe(1);
    expect(missing.stderr()).toContain('--origin');
    const unsafe = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'http://mcp.example.net', '--server', 'https://api.example.net', '--settings', settings], unsafe.io)).toBe(1);
  });

  it('the hook command answers with valid JSON and exit 0 even for broken input', async () => {
    const out = capture();
    expect(await runCli(['judgment:claude-code-hook'], { ...out.io, stdin: Readable.from(['not json']) })).toBe(0);
    expect(JSON.parse(out.stdout()).systemMessage).toContain('判断フック');
  });
});
