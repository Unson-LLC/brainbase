import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  claudeCodeHookCommand,
  handleClaudeCodeJudgmentHook,
  registerClaudeCodeJudgmentHooks,
  repositoryIdentity,
} from '../src/claude-code-judgment-hook.js';
import { runCli } from '../src/cli.js';

const REG = 'a'.repeat(32);
const REGISTRATION = { id: REG, settings: '/home/me/.claude/settings.json' };
const REGISTRATION_B = { id: 'b'.repeat(32), settings: '/home/me/.claude-work/settings.json' };

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-claude-scope-'));
  dirs.push(dir);
  return dir;
}

async function checkout(root: string, name: string, configText: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, '.git', 'refs'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(dir, '.git', 'config'), configText);
  await mkdir(join(dir, 'src'), { recursive: true });
  return dir;
}

const withOrigin = (url: string) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n`;

function host() {
  const sent: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
    return new Response(JSON.stringify({
      schema_version: '1', accepted: true, hook_event_name: body.hook_event_name, session_id: body.session_id,
      turn_id: body.turn_id, output: {},
    }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

async function hookConfig(path: string, fields: Record<string, unknown>): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify({ schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, login_server: 'https://api.example.net', registration: REGISTRATION, ...fields }));
  return path;
}

const token = async () => 'person-jwt';
const tool = (cwd: string, prompt = 'p1') => ({
  hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: prompt, cwd, tool_name: 'Bash', tool_input: {}, tool_response: {},
});
const submit = (cwd: string, prompt = 'p1') => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: prompt, cwd, prompt: 'hi' });
const stop = (cwd: string, prompt = 'p1') => ({ hook_event_name: 'Stop', session_id: 's1', prompt_id: prompt, cwd, last_assistant_message: 'answer' });

describe('a turn keeps the destination it was opened with', () => {
  it('sends nothing more when the config is switched to another Host mid-turn', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', withOrigin('git@github.com:acme/app.git'));
    const config = await hookConfig(join(home, 'hook.json'), { origin: 'https://a.example.net' });
    const { fetchImpl, sent } = host();
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    await hookConfig(config, { origin: 'https://b.example.net', project_code: 'other' });
    expect(await handleClaudeCodeJudgmentHook(tool(repo), options)).toEqual({});
    const answer = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(String(answer.systemMessage)).toContain('judgment_turn_destination_changed');
    expect(sent.map((request) => request.url)).toEqual(['https://a.example.net/host/judgment/hook']);
  });

  it('keeps the turns of two registered configs apart, each with its own Host', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', withOrigin('git@github.com:acme/app.git'));
    const configA = await hookConfig(join(home, 'a.json'), { origin: 'https://a.example.net' });
    const configB = await hookConfig(join(home, 'b.json'), { origin: 'https://b.example.net', registration: REGISTRATION_B });
    const { fetchImpl, sent } = host();
    const base = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG };
    for (const event of [submit(repo), tool(repo), stop(repo)]) {
      await handleClaudeCodeJudgmentHook(event, { ...base, configPath: configA });
      await handleClaudeCodeJudgmentHook(event, { ...base, configPath: configB, registrationId: REGISTRATION_B.id });
    }
    const to = (origin: string) => sent.filter((request) => request.url.startsWith(origin)).map((request) => request.body.hook_event_name);
    expect(to('https://a.example.net')).toEqual(['UserPromptSubmit', 'PostToolUse', 'Stop']);
    expect(to('https://b.example.net')).toEqual(['UserPromptSubmit', 'PostToolUse', 'Stop']);
  });
});

describe('a turn in a repository without an origin stays in that checkout', () => {
  it('does not send events from another origin-less checkout or from outside git', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'scratch', '[core]\n');
    const other = await checkout(home, 'diary', '[core]\n');
    const outside = join(home, 'plain');
    await mkdir(outside);
    const config = await hookConfig(join(home, 'hook.json'), { origin: 'https://a.example.net' });
    const { fetchImpl, sent } = host();
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(await handleClaudeCodeJudgmentHook(tool(other), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(tool(outside), options)).toEqual({});
    const answer = await handleClaudeCodeJudgmentHook(stop(other), options);
    expect(String(answer.systemMessage)).toContain('judgment_turn_repository_changed');
    await handleClaudeCodeJudgmentHook(tool(join(repo, 'src')), options);
    expect(sent.map((request) => request.body.hook_event_name)).toEqual(['UserPromptSubmit', 'PostToolUse']);
  });
});

describe('an empty repository list audits nothing', () => {
  it('sends nothing when the config names no repository', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', withOrigin('git@github.com:acme/app.git'));
    const config = await hookConfig(join(home, 'hook.json'), { origin: 'https://a.example.net', repositories: [] });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(submit(repo), { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config });
    expect(sent).toEqual([]);
  });

  it('the installer refuses an explicitly empty --repositories', async () => {
    const dir = await tempDir();
    for (const value of ['', ',', ' , ']) {
      const out = capture();
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net',
        '--repositories', value, '--settings', join(dir, 'settings.json'), '--config', join(dir, 'hook.json')], out.io)).toBe(1);
      expect(out.stderr()).toContain('--repositories');
    }
    await expect(readFile(join(dir, 'settings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
    stdout: () => stdout, stderr: () => stderr,
  };
}

describe('the installer only touches files it owns', () => {
  it('refuses to overwrite a --config file that is not a hook config', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const notes = join(dir, 'notes.json');
    await writeFile(notes, '{"todo": ["keep me"]}\n');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net',
      '--settings', settings, '--config', notes], out.io)).toBe(1);
    expect(out.stderr()).toContain('not a brainbase hook config');
    expect(await readFile(notes, 'utf8')).toBe('{"todo": ["keep me"]}\n');
    await expect(readFile(settings, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('on --remove, keeps a --config file that no registration in the settings points at', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const original = JSON.stringify({ permissions: { allow: ['Read'] } });
    await writeFile(settings, original);
    const config = await hookConfig(join(dir, 'hook.json'), { origin: 'https://mcp.example.net' });
    const before = await readFile(config, 'utf8');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], out.io)).toBe(1);
    expect(out.stderr()).toContain('no registration');
    expect(await readFile(config, 'utf8')).toBe(before);
    expect(await readFile(settings, 'utf8')).toBe(original);
  });

  it('on --remove, takes the registrations out but keeps a --config file that is not a hook config', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const notes = join(dir, 'notes.json');
    await writeFile(notes, 'my notes\n');
    const registered = registerClaudeCodeJudgmentHooks({}, { command: claudeCodeHookCommand('/bin/node', '/cli.js', notes, REG), configPath: notes });
    await writeFile(settings, JSON.stringify(registered));
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', notes], out.io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({});
    expect(await readFile(notes, 'utf8')).toBe('my notes\n');
  });
});

describe('origin remote parsing', () => {
  it('reads case-insensitive section names, quoted values and trailing comments like git does', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', '[core]\n[Remote "origin"]\n\tURL = "git@github.com:acme/app.git" ; mirror\n');
    expect(repositoryIdentity(repo)).toBe('github.com/acme/app');
  });
});

// Review 7057359957 (PR #1042 at 517f607).
describe('one hook config belongs to one registration', () => {
  async function install(settings: string, config: string, origin: string, extra: string[] = []) {
    const out = capture();
    const code = await runCli(['judgment:install', '--target', 'claude-code', '--origin', origin, '--server', 'https://api.example.net',
      '--settings', settings, '--config', config, ...extra], out.io);
    return { code, out };
  }
  const registrationOf = async (settings: string) => {
    const saved = JSON.parse(await readFile(settings, 'utf8'));
    const command: string = saved.hooks.UserPromptSubmit[0].hooks[0].command;
    return /'--registration' '([a-f0-9]{32})'/u.exec(command)![1];
  };

  it('refuses to reuse a config registered from another Claude Code settings file, and leaves it as it was', async () => {
    const dir = await tempDir();
    const settingsA = join(dir, 'a', 'settings.json');
    const settingsB = join(dir, 'b', 'settings.json');
    const config = join(dir, 'hook.json');
    expect((await install(settingsA, config, 'https://a.example.net')).code).toBe(0);
    const before = await readFile(config, 'utf8');
    const second = await install(settingsB, config, 'https://b.example.net');
    expect(second.code).toBe(1);
    expect(second.out.stderr()).toContain('is used by');
    expect(await readFile(config, 'utf8')).toBe(before);
    await expect(readFile(settingsB, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a command copied from an earlier registration sends nothing, and removing it keeps the config of the current one', async () => {
    const dir = await tempDir();
    const settingsA = join(dir, 'a', 'settings.json');
    const settingsB = join(dir, 'b', 'settings.json');
    const config = join(dir, 'hook.json');
    expect((await install(settingsA, config, 'https://a.example.net')).code).toBe(0);
    // B holds a copy of A's registration (hand-copied settings).
    await mkdir(join(dir, 'b'));
    await writeFile(settingsB, await readFile(settingsA, 'utf8'));
    const oldId = await registrationOf(settingsA);
    expect((await install(settingsA, config, 'https://a2.example.net')).code).toBe(0);
    const repo = await checkout(dir, 'app', withOrigin('git@github.com:acme/app.git'));
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: dir }, fetch: fetchImpl, accessToken: token, configPath: config, registrationId: oldId });
    expect(String(output.systemMessage)).toContain('judgment:install');
    expect(sent).toEqual([]);

    const removed = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settingsB, '--config', config], removed.io)).toBe(0);
    expect(JSON.parse(await readFile(settingsB, 'utf8'))).toEqual({});
    expect(JSON.parse(await readFile(config, 'utf8'))).toMatchObject({ origin: 'https://a2.example.net' });
    await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: dir }, fetch: fetchImpl, accessToken: token, configPath: config, registrationId: await registrationOf(settingsA) });
    expect(sent.map((request) => request.url)).toEqual(['https://a2.example.net/host/judgment/hook']);
  });

  it('two registrations of one Claude Code session send different session and turn ids', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', withOrigin('git@github.com:acme/app.git'));
    const configA = await hookConfig(join(home, 'a.json'), { origin: 'https://host.example.net', project_code: 'one' });
    const configB = await hookConfig(join(home, 'b.json'), { origin: 'https://host.example.net', project_code: 'two', registration: REGISTRATION_B });
    const { fetchImpl, sent } = host();
    const base = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG };
    await handleClaudeCodeJudgmentHook(submit(repo), { ...base, configPath: configA });
    await handleClaudeCodeJudgmentHook(submit(repo), { ...base, configPath: configB, registrationId: REGISTRATION_B.id });
    expect(sent).toHaveLength(2);
    const [a, b] = sent.map((request) => request.body);
    expect(a.session_id).not.toBe(b.session_id);
    expect(a.turn_id).not.toBe(b.turn_id);
    expect([a.session_id, b.session_id]).not.toContain('s1');
  });

  it('when writing the settings fails, the earlier registration keeps its own destination, never the new one', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'claude', 'settings.json');
    const config = join(dir, 'hook.json');
    expect((await install(settings, config, 'https://a.example.net')).code).toBe(0);
    const oldId = await registrationOf(settings);
    await chmod(join(dir, 'claude'), 0o500);
    try {
      expect((await install(settings, config, 'https://b.example.net')).code).toBe(1);
    } finally {
      await chmod(join(dir, 'claude'), 0o700);
    }
    const repo = await checkout(dir, 'app', withOrigin('git@github.com:acme/app.git'));
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: dir }, fetch: fetchImpl, accessToken: token, configPath: config, registrationId: oldId });
    expect(sent.map((request) => request.url)).toEqual(['https://a.example.net/host/judgment/hook']);
  });
});

describe('repository paths keep their case where the host tells them apart', () => {
  it('a self-hosted server: Team/App and team/app are different repositories', async () => {
    const home = await tempDir();
    const listed = await checkout(home, 'listed', withOrigin('git@git.example.org:Team/App.git'));
    const other = await checkout(home, 'other', withOrigin('git@git.example.org:team/app.git'));
    const config = await hookConfig(join(home, 'hook.json'), { origin: 'https://a.example.net', repositories: ['GIT.example.org/Team/App'] });
    expect(repositoryIdentity(listed)).toBe('git.example.org/Team/App');
    expect(repositoryIdentity(other)).toBe('git.example.org/team/app');
    const { fetchImpl, sent } = host();
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, registrationId: REG, configPath: config };
    await handleClaudeCodeJudgmentHook(submit(other, 'p0'), options);
    expect(sent).toEqual([]);
    await handleClaudeCodeJudgmentHook(submit(listed), options);
    expect(await handleClaudeCodeJudgmentHook(tool(other), options)).toEqual({});
    expect(sent.map((request) => request.body.hook_event_name)).toEqual(['UserPromptSubmit']);
    expect(sent[0].headers['x-brainbase-repository']).toBe('git.example.org/Team/App');
  });

  it('github.com ignores the case of owner and name', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', withOrigin('git@GitHub.com:Acme/App.git'));
    expect(repositoryIdentity(repo)).toBe('github.com/acme/app');
  });

  it('the installer keeps the case of a self-hosted path', async () => {
    const dir = await tempDir();
    const config = join(dir, 'hook.json');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://a.example.net', '--server', 'https://api.example.net',
      '--repositories', 'Git.Example.org/Team/App,GitHub.com/Acme/App', '--settings', join(dir, 'settings.json'), '--config', config], out.io)).toBe(0);
    expect(JSON.parse(await readFile(config, 'utf8')).repositories).toEqual(['git.example.org/Team/App', 'github.com/acme/app']);
  });
});

describe('a settings file that is a symbolic link', () => {
  it('stays a link: install and removal change the file it points to', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'dotfiles'));
    await mkdir(join(dir, 'claude'));
    const shared = join(dir, 'dotfiles', 'claude-settings.json');
    const settings = join(dir, 'claude', 'settings.json');
    await writeFile(shared, JSON.stringify({ permissions: { allow: ['Read'] } }));
    await symlink(shared, settings);
    const config = join(dir, 'hook.json');
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://a.example.net', '--server', 'https://api.example.net',
      '--settings', settings, '--config', config], capture().io)).toBe(0);
    expect((await lstat(settings)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(shared, 'utf8')).hooks.Stop).toHaveLength(1);
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', config], capture().io)).toBe(0);
    expect((await lstat(settings)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(shared, 'utf8'))).toEqual({ permissions: { allow: ['Read'] } });
  });

  it('refuses a link that points to nothing', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    await symlink(join(dir, 'missing.json'), settings);
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://a.example.net', '--server', 'https://api.example.net',
      '--settings', settings, '--config', join(dir, 'hook.json')], out.io)).toBe(1);
    expect(out.stderr()).toContain('symbolic link');
    expect((await lstat(settings)).isSymbolicLink()).toBe(true);
  });
});
