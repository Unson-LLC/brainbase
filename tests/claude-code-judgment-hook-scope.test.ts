import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  await mkdir(join(dir, '.git'), { recursive: true });
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
  await writeFile(path, JSON.stringify({ schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, ...fields }));
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
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, configPath: config };
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
    const configB = await hookConfig(join(home, 'b.json'), { origin: 'https://b.example.net' });
    const { fetchImpl, sent } = host();
    const base = { env: { HOME: home }, fetch: fetchImpl, accessToken: token };
    for (const event of [submit(repo), tool(repo), stop(repo)]) {
      await handleClaudeCodeJudgmentHook(event, { ...base, configPath: configA });
      await handleClaudeCodeJudgmentHook(event, { ...base, configPath: configB });
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
    const options = { env: { HOME: home }, fetch: fetchImpl, accessToken: token, configPath: config };
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
    await handleClaudeCodeJudgmentHook(submit(repo), { env: { HOME: home }, fetch: fetchImpl, accessToken: token, configPath: config });
    expect(sent).toEqual([]);
  });

  it('the installer refuses an explicitly empty --repositories', async () => {
    const dir = await tempDir();
    for (const value of ['', ',', ' , ']) {
      const out = capture();
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
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
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
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
    const registered = registerClaudeCodeJudgmentHooks({}, { command: claudeCodeHookCommand('/bin/node', '/cli.js', notes), configPath: notes });
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
