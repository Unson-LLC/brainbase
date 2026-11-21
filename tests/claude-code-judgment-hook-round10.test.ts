// Review of PR #1042 at 7f4ced1 (codex-sub, request_changes): a login as
// another account mid-turn, and a repository the Host cannot map.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION } from '../src/brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  handleClaudeCodeJudgmentHook,
  hostCanMapRepository,
} from '../src/claude-code-judgment-hook.js';

const REG = 'd'.repeat(32);
const LOGIN_SERVER = 'https://api.example.net';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round10-')));
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

function host() {
  const sent: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ headers: init?.headers as Record<string, string>, body });
    return new Response(JSON.stringify({
      schema_version: '1', accepted: true, hook_event_name: body.hook_event_name, session_id: body.session_id,
      turn_id: body.turn_id, output: {},
    }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

async function saveLogin(path: string, loginId: string, token: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: loginId, server_url: LOGIN_SERVER,
    access_token: token, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }), { mode: 0o600 });
}

async function setup(origin: string, extra: Record<string, unknown> = {}) {
  const dir = await tempDir();
  const repo = await checkout(dir, 'app', origin);
  const config = join(dir, 'hook.json');
  await writeFile(config, JSON.stringify({
    schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', login_server: LOGIN_SERVER,
    registration: { id: REG, settings: join(dir, 'settings.json') }, ...extra,
  }));
  const credentials = join(dir, 'credentials.json');
  const env = { HOME: dir, BRAINBASE_CLAUDE_JUDGMENT_TURN_DIR: join(dir, 'turns') } as NodeJS.ProcessEnv;
  return { dir, repo, config, credentials, env };
}

const submit = (cwd: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd, prompt: 'hi' });
const post = (cwd: string) => ({
  hook_event_name: 'PostToolUse', session_id: 's1', prompt_id: 'p1', cwd, tool_name: 'Read', tool_input: { file_path: 'a' }, tool_response: 'x',
});
const pre = (cwd: string) => ({
  hook_event_name: 'PreToolUse', session_id: 's1', prompt_id: 'p1', cwd, tool_name: 'mcp__brainbase__brainbase_knowledge_lookup', tool_input: {},
});
const stop = (cwd: string) => ({ hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', cwd, last_assistant_message: 'answer' });

describe('a turn keeps the login it was opened with', () => {
  it('sends nothing more once the saved login is replaced by another account on the same API', async () => {
    const { repo, config, credentials, env } = await setup('git@github.com:acme/app.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    await handleClaudeCodeJudgmentHook(post(repo), options);
    expect(sent.map((s) => s.headers.authorization)).toEqual(['Bearer token-of-alice', 'Bearer token-of-alice']);

    await saveLogin(credentials, 'b'.repeat(32), 'token-of-bob');
    const afterPost = await handleClaudeCodeJudgmentHook(post(repo), options);
    const afterPre = await handleClaudeCodeJudgmentHook(pre(repo), options);
    const afterStop = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(sent).toHaveLength(2);
    expect(String(afterPost.systemMessage)).toContain('judgment_turn_login_changed');
    expect(String(afterPre.systemMessage)).toContain('judgment_turn_login_changed');
    expect(String(afterStop.systemMessage)).toContain('judgment_turn_login_changed');

    // The next prompt opens a turn with the new login.
    await handleClaudeCodeJudgmentHook({ ...submit(repo), prompt_id: 'p2' }, options);
    await handleClaudeCodeJudgmentHook({ ...stop(repo), prompt_id: 'p2' }, options);
    expect(sent.slice(2).map((s) => s.headers.authorization)).toEqual(['Bearer token-of-bob', 'Bearer token-of-bob']);
  });

  it('keeps sending when the same login is renewed (a new token, the same login id)', async () => {
    const { repo, config, credentials, env } = await setup('git@github.com:acme/app.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-1');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    await saveLogin(credentials, 'a'.repeat(32), 'token-2');
    const output = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(output.systemMessage).toBeUndefined();
    expect(sent.map((s) => s.headers.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  it('sends nothing more for a turn whose state has no login recorded', async () => {
    const { repo, config, credentials, env } = await setup('git@github.com:acme/app.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    const { readdir, readFile } = await import('node:fs/promises');
    const turns = join(String(env.BRAINBASE_CLAUDE_JUDGMENT_TURN_DIR));
    const file = (await readdir(turns)).find((name) => /^[a-f0-9]{64}\.json$/u.test(name))!;
    const state = JSON.parse(await readFile(join(turns, file), 'utf8')) as Record<string, unknown>;
    expect(state.login).toBe('a'.repeat(32));
    delete state.login;
    await writeFile(join(turns, file), JSON.stringify(state));
    const output = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(sent).toHaveLength(1);
    expect(String(output.systemMessage)).toContain('judgment_turn_login_changed');
  });
});

describe('a repository the Host cannot map to a project', () => {
  it('is not sent without --project when its host has a port', async () => {
    const { repo, config, credentials, env } = await setup('ssh://git@git.example.com:2222/acme/app.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    const output = await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(String(output.systemMessage)).toContain('judgment_repository_unmappable');
    expect(String(output.systemMessage)).toContain('git.example.com:2222/acme/app');
    expect(await handleClaudeCodeJudgmentHook(post(repo), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(stop(repo), options)).toEqual({});
    expect(sent).toEqual([]);
  });

  it('is sent with the repository header when --project names the project', async () => {
    const { repo, config, credentials, env } = await setup('https://git.example.com:8443/acme/app.git', { project_code: 'growin' });
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    const output = await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(output.systemMessage).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-brainbase-project-code']).toBe('growin');
    expect(sent[0].headers['x-brainbase-repository']).toBe('git.example.com:8443/acme/app');
  });

  it('matches the Host pattern for repository lookups', () => {
    expect(hostCanMapRepository('github.com/acme/app', {})).toBe(true);
    expect(hostCanMapRepository(null, {})).toBe(true);
    expect(hostCanMapRepository('git.example.com:2222/acme/app', {})).toBe(false);
    expect(hostCanMapRepository('git.example.com/~acme/app', {})).toBe(false);
    expect(hostCanMapRepository(`github.com/acme/${'a'.repeat(200)}`, {})).toBe(false);
    expect(hostCanMapRepository('git.example.com:2222/acme/app', { project_code: 'growin' })).toBe(true);
  });
});
