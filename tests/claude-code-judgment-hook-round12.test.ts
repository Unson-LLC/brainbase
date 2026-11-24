// Review of PR #1042 at 5c98a94 (codex-sub, request_changes):
// 1. a Stop sends only the fields the Host reads, never the session's
//    background commands or scheduled prompts;
// 2. the git root is found from the real path, so a link inside an audited
//    checkout that points into another checkout is not sent as the audited one.
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION } from '../src/brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  STOP_FORWARDED_FIELDS,
  findGitRoot,
  forwardedStopPayload,
  handleClaudeCodeJudgmentHook,
} from '../src/claude-code-judgment-hook.js';

const REG = 'd'.repeat(32);
const LOGIN_SERVER = 'https://api.example.net';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round12-')));
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


const SECRET_COMMAND = 'curl -H "Authorization: Bearer fake-secret-in-background-command" https://x.invalid';
const SECRET_PROMPT = 'fake-secret-in-scheduled-prompt';
const stopWithBackground = (cwd: string) => ({
  ...stop(cwd),
  transcript_path: '/tmp/t.jsonl',
  permission_mode: 'default',
  stop_hook_active: false,
  background_tasks: [{ id: 'b1', command: SECRET_COMMAND, status: 'running' }],
  session_crons: [{ id: 'c1', cron: '*/5 * * * *', prompt: SECRET_PROMPT }],
  some_future_field: { nested: SECRET_PROMPT },
});

describe('a Stop sends only the fields the Host reads', () => {
  it('drops background tasks, scheduled prompts and unknown fields', () => {
    const kept = forwardedStopPayload(stopWithBackground('/w'));
    expect(Object.keys(kept).sort()).toEqual(
      ['cwd', 'hook_event_name', 'last_assistant_message', 'permission_mode', 'prompt_id', 'session_id', 'stop_hook_active', 'transcript_path'],
    );
    for (const key of Object.keys(kept)) expect(STOP_FORWARDED_FIELDS).toContain(key);
  });

  it('never puts a background command or scheduled prompt on the wire', async () => {
    const { repo, config, credentials, env } = await setup('git@github.com:acme/app.git');
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    await handleClaudeCodeJudgmentHook(stopWithBackground(repo), options);
    expect(sent).toHaveLength(2);
    const wire = JSON.stringify(sent[1].body);
    expect(sent[1].body.hook_event_name).toBe('Stop');
    expect(sent[1].body.last_assistant_message).toBe('answer');
    expect(wire).not.toContain('fake-secret');
    expect(sent[1].body).not.toHaveProperty('background_tasks');
    expect(sent[1].body).not.toHaveProperty('session_crons');
    expect(sent[1].body).not.toHaveProperty('some_future_field');
  });
});

describe('the git root is found from the real path', () => {
  async function nested() {
    const { dir, repo, config, credentials, env } = await setup('git@github.com:acme/target.git', {
      repositories: ['github.com/acme/target'],
    });
    const other = await checkout(dir, 'other', 'git@github.com:acme/other.git');
    await mkdir(join(other, 'sub'), { recursive: true });
    await symlink(join(other, 'sub'), join(repo, 'link'));
    return { dir, repo, other, config, credentials, env };
  }

  it('gives the checkout the link points into', async () => {
    const { repo, other } = await nested();
    expect(findGitRoot(join(repo, 'link'))).toBe(other);
    expect(findGitRoot(repo)).toBe(repo);
  });

  it('gives null for a start that cannot be resolved', async () => {
    const { repo } = await nested();
    await symlink(join(repo, 'missing'), join(repo, 'dangling'));
    expect(findGitRoot(join(repo, 'dangling'))).toBeNull();
    expect(findGitRoot(join(repo, 'no-such-dir'))).toBeNull();
  });

  it('sends nothing for work through a link into an unaudited checkout', async () => {
    const { repo, config, credentials, env } = await nested();
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    const via = join(repo, 'link');
    expect(await handleClaudeCodeJudgmentHook(submit(via), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(post(via), options)).toEqual({});
    expect(await handleClaudeCodeJudgmentHook(stop(via), options)).toEqual({});
    expect(sent).toEqual([]);
  });

  it('ends a turn opened in the audited checkout without sending once work moves through the link', async () => {
    const { repo, config, credentials, env } = await nested();
    const { fetchImpl, sent } = host();
    const options = { env, fetch: fetchImpl, configPath: config, registrationId: REG, credentials: { credentialsPath: credentials } };
    await saveLogin(credentials, 'a'.repeat(32), 'token-of-alice');
    await handleClaudeCodeJudgmentHook(submit(repo), options);
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-brainbase-repository']).toBe('github.com/acme/target');
    const via = join(repo, 'link');
    expect(await handleClaudeCodeJudgmentHook(post(via), options)).toEqual({});
    const output = await handleClaudeCodeJudgmentHook(stop(via), options);
    expect(String(output.systemMessage)).toContain('judgment_turn_repository_changed');
    expect(sent).toHaveLength(1);
  });
});
