// Review of PR #1042 at cc80970 (codex-sub, request_changes): an origin whose
// URL gives no host/owner/name must not be sent as a checkout without origin.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION } from '../src/brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  handleClaudeCodeJudgmentHook,
} from '../src/claude-code-judgment-hook.js';

const REG = 'd'.repeat(32);
const LOGIN_SERVER = 'https://api.example.net';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round11-')));
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

describe('an origin the client cannot turn into host/owner/name', () => {
  for (const url of ['file:///srv/git/app.git', '/srv/git/app.git', 'https://example.com/app.git']) {
    it(`is not sent without --project (${url})`, async () => {
      const { repo, config, credentials, env } = await setup(url);
      const { fetchImpl, sent } = host();
      const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
      await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
      const output = await handleClaudeCodeJudgmentHook(submit(repo), options);
      expect(String(output.systemMessage)).toContain('judgment_repository_unidentified');
      expect(await handleClaudeCodeJudgmentHook(post(repo), options)).toEqual({});
      expect(await handleClaudeCodeJudgmentHook(stop(repo), options)).toEqual({});
      expect(sent).toEqual([]);
    });
  }

  it('is sent to the named project with --project', async () => {
    const { repo, config, credentials, env } = await setup('file:///srv/git/app.git', { project_code: 'growin' });
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    const output = await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(output.systemMessage).toBeUndefined();
    await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(sent).toHaveLength(2);
    expect(sent[0].headers['x-brainbase-project-code']).toBe('growin');
    expect(sent[0].headers['x-brainbase-repository']).toBeUndefined();
  });

  it('stops sending when an origin like that is set mid-turn in a checkout that had none', async () => {
    const { dir, credentials, env, config } = await setup('git@github.com:acme/unused.git');
    const repo = join(dir, 'bare');
    await mkdir(join(repo, '.git', 'objects'), { recursive: true });
    await mkdir(join(repo, '.git', 'refs'), { recursive: true });
    await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(repo, '.git', 'config'), '');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(sent).toHaveLength(1);
    await writeFile(join(repo, '.git', 'config'), '[remote "origin"]\n\turl = file:///srv/git/app.git\n');
    expect(await handleClaudeCodeJudgmentHook(post(repo), options)).toEqual({});
    const output = await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(String(output.systemMessage)).toContain('judgment_turn_repository_unaudited');
    expect(sent).toHaveLength(1);
  });

  it('a checkout without origin is still sent as before', async () => {
    const { dir, credentials, env, config } = await setup('git@github.com:acme/unused.git');
    const repo = join(dir, 'bare');
    await mkdir(join(repo, '.git', 'objects'), { recursive: true });
    await mkdir(join(repo, '.git', 'refs'), { recursive: true });
    await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(repo, '.git', 'config'), '');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    const output = await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(output.systemMessage).toBeUndefined();
    await handleClaudeCodeJudgmentHook(stop(repo), options);
    expect(sent).toHaveLength(2);
  });
});
