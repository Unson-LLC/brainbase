// Review 7058313327 (PR #1042 at e966857).
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  claudeCodeHookCommand,
  handleClaudeCodeJudgmentHook,
  installedHookConfigPath,
  registerClaudeCodeJudgmentHooks,
} from '../src/claude-code-judgment-hook.js';
import { runCli } from '../src/cli.js';

const REG = 'a'.repeat(32);

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-claude-registration-'));
  dirs.push(dir);
  return dir;
}

async function checkout(root: string, name: string, url: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, '.git', 'refs'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(dir, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
  return dir;
}

function host(output: (body: Record<string, unknown>) => Record<string, unknown> = () => ({})) {
  const sent: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push(body);
    return new Response(JSON.stringify({
      schema_version: '1', accepted: true, hook_event_name: body.hook_event_name, session_id: body.session_id,
      turn_id: body.turn_id, output: output(body),
    }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

async function writeConfig(path: string, fields: Record<string, unknown>): Promise<string> {
  await writeFile(path, JSON.stringify({
    schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://a.example.net', login_server: 'https://api.example.net',
    registration: { id: REG, settings: '/home/me/.claude/settings.json' }, ...fields,
  }));
  return path;
}

const token = async () => 'person-jwt';
const submit = (cwd: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd, prompt: 'hi' });
const tool = (cwd: string, event = 'PostToolUse') => ({
  hook_event_name: event, session_id: 's1', prompt_id: 'p1', cwd, tool_name: 'Bash', tool_input: {}, tool_response: {},
});
const lookup = (cwd: string) => ({
  hook_event_name: 'PreToolUse', session_id: 's1', prompt_id: 'p1', cwd, tool_name: 'mcp__brainbase__brainbase_knowledge_lookup', tool_input: {},
});
const stop = (cwd: string) => ({ hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd, last_assistant_message: 'answer' });

function capture() {
  let stderr = '';
  return { io: { stdout: { write: () => {} }, stderr: { write: (chunk: string) => { stderr += chunk; } } }, stderr: () => stderr };
}

const install = (settings: string, config: string, extra: string[] = []) => runCli(['judgment:install', '--target', 'claude-code',
  '--origin', 'https://a.example.net', '--server', 'https://api.example.net', '--settings', settings, '--config', config, ...extra], capture().io);

function commandsOf(settings: Record<string, unknown>, event = 'UserPromptSubmit'): string[] {
  const groups = ((settings.hooks ?? {}) as Record<string, Array<{ hooks: Array<{ command: string }> }>>)[event] ?? [];
  return groups.flatMap((group) => group.hooks.map((hook) => hook.command));
}

it('does not send later events under a new registration for the same config', async () => {
  const home = await tempDir();
  const repo = await checkout(home, 'app', 'git@github.com:acme/app.git');
  const config = await writeConfig(join(home, 'hook.json'), {});
  const { fetchImpl, sent } = host();
  const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
  await handleClaudeCodeJudgmentHook(submit(repo), options);

  const registrationId = 'b'.repeat(32);
  await writeConfig(config, { registration: { id: registrationId, settings: '/home/me/.claude/settings.json' } });
  const reinstalled = { ...options, registrationId };
  for (const event of [lookup(repo), tool(repo), tool(repo, 'PostToolUseFailure'), stop(repo)]) {
    await handleClaudeCodeJudgmentHook(event, reinstalled);
  }
  expect(sent.map((body) => body.hook_event_name)).toEqual(['UserPromptSubmit']);

  await handleClaudeCodeJudgmentHook({ ...submit(repo), prompt_id: 'p2' }, reinstalled);
  await handleClaudeCodeJudgmentHook({ ...stop(repo), prompt_id: 'p2' }, reinstalled);
  expect(sent.map((body) => body.hook_event_name)).toEqual(['UserPromptSubmit', 'UserPromptSubmit', 'Stop']);
});

describe('a repository taken off the list mid-turn', () => {
  it('sends nothing more from it, though the registration and destination stay the same', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', 'git@github.com:acme/app.git');
    const config = await writeConfig(join(home, 'hook.json'), { repositories: ['github.com/acme/app'] });
    const { fetchImpl, sent } = host();
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    await writeConfig(config, { repositories: ['github.com/acme/other'] });
    expect(await handleClaudeCodeJudgmentHook(tool(repo), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(tool(repo, 'PostToolUseFailure'), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(lookup(repo), options)).toEqual({});
    const answer = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(String(answer.systemMessage)).toContain('judgment_turn_repository_unaudited');
    expect(sent.map((body) => body.hook_event_name)).toEqual(['UserPromptSubmit']);
  });
});

describe('a Host answer never stops the Claude Code turn', () => {
  const stopping = {
    continue: false, stopReason: 'halt', decision: 'block', reason: 'because', suppressOutput: true,
    systemMessage: 'note', hookSpecificOutput: { additionalContext: 'ctx', permissionDecision: 'allow', updatedInput: { x: 1 } },
  };

  it('passes only the notice and the context on every event', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', 'git@github.com:acme/app.git');
    const config = await writeConfig(join(home, 'hook.json'), {});
    const { fetchImpl } = host(() => stopping);
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    expect(await handleClaudeCodeJudgmentHook(submit(repo), options)).toEqual({
      systemMessage: 'note', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ctx' },
    });
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      expect(await handleClaudeCodeJudgmentHook(tool(repo, event), options)).toEqual({
        systemMessage: 'note', hookSpecificOutput: { hookEventName: event, additionalContext: 'ctx' },
      });
    }
    expect(await handleClaudeCodeJudgmentHook(lookup(repo), options)).toEqual({
      systemMessage: 'note', hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ctx' },
    });
    const answer = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(Object.keys(answer)).toEqual(['systemMessage']);
    expect(String(answer.systemMessage)).toContain('note');
  });

  it('a Stop answer of continue:false alone is not passed on', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', 'git@github.com:acme/app.git');
    const config = await writeConfig(join(home, 'hook.json'), {});
    const { fetchImpl } = host((body) => (body.hook_event_name === 'Stop' ? { continue: false, stopReason: 'halt' } : {}));
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(await handleClaudeCodeJudgmentHook(stop(repo), options)).toEqual({});
  });
});

describe('registrations made at the same time', () => {
  it('two hook configs registered into one settings file at once are both kept', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const configs = Array.from({ length: 4 }, (_, index) => join(dir, `hook-${index}.json`));
    expect(await Promise.all(configs.map((config) => install(settings, config)))).toEqual([0, 0, 0, 0]);
    const saved = JSON.parse(await readFile(settings, 'utf8'));
    const registered = commandsOf(saved).map((command) => installedHookConfigPath({ type: 'command', command }));
    expect(registered.sort()).toEqual([...configs].sort());
  });

  it('two settings files creating one hook config at once: only one registration takes it', async () => {
    const dir = await tempDir();
    const config = join(dir, 'hook.json');
    const settings = [join(dir, 'a.json'), join(dir, 'b.json'), join(dir, 'c.json')];
    const codes = await Promise.all(settings.map((path) => install(path, config)));
    expect(codes.filter((code) => code === 0)).toHaveLength(1);
    const winner = settings[codes.indexOf(0)];
    const saved = JSON.parse(await readFile(config, 'utf8'));
    expect(saved.registration.settings).toBe(winner);
    expect(commandsOf(JSON.parse(await readFile(winner, 'utf8')))[0]).toContain(`'--registration' '${saved.registration.id}'`);
  });
});

describe('one hook config named by two paths', () => {
  it('registering again through a linked directory replaces the earlier registration', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'real'));
    await symlink(join(dir, 'real'), join(dir, 'link'));
    const settings = join(dir, 'settings.json');
    expect(await install(settings, join(dir, 'link', 'hook.json'))).toBe(0);
    expect(await install(settings, join(dir, 'real', 'hook.json'))).toBe(0);
    const saved = JSON.parse(await readFile(settings, 'utf8'));
    expect(commandsOf(saved)).toHaveLength(1);
    expect(commandsOf(saved, 'Stop')).toHaveLength(1);
    // Removing through the other name takes it out and deletes the config.
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings,
      '--config', join(dir, 'link', 'hook.json')], capture().io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
    await expect(readFile(join(dir, 'real', 'hook.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removal keeps the config when its current registration id is not among the removed commands', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const config = join(dir, 'hook.json');
    const current = 'c'.repeat(32);
    await writeConfig(config, { registration: { id: current, settings } });
    // A stale command with an older id, the current one lives elsewhere.
    await writeFile(settings, JSON.stringify(registerClaudeCodeJudgmentHooks({},
      { command: claudeCodeHookCommand('/bin/node', '/cli.js', config, REG), configPath: config })));
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings,
      '--config', config], capture().io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
    expect(JSON.parse(await readFile(config, 'utf8')).registration.id).toBe(current);
  });
});

describe('a failed settings write', () => {
  it('puts the earlier hook config back, so the earlier registration keeps its destination', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'claude'));
    const settings = join(dir, 'claude', 'settings.json');
    const config = join(dir, 'hook.json');
    expect(await install(settings, config)).toBe(0);
    const before = await readFile(config, 'utf8');
    await chmod(join(dir, 'claude'), 0o500);
    try {
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://b.example.net', '--server', 'https://api.example.net',
        '--settings', settings, '--config', config], capture().io)).toBe(1);
    } finally {
      await chmod(join(dir, 'claude'), 0o700);
    }
    expect(await readFile(config, 'utf8')).toBe(before);
  });

  it('removes a hook config it had just created', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'claude'));
    const settings = join(dir, 'claude', 'settings.json');
    const config = join(dir, 'hook.json');
    await chmod(join(dir, 'claude'), 0o500);
    try {
      expect(await install(settings, config)).toBe(1);
    } finally {
      await chmod(join(dir, 'claude'), 0o700);
    }
    await expect(readFile(config, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
