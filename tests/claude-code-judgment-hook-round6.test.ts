// Review 7058761416 (PR #1042 at 99bba96).
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION, withCredentialsLock } from '../src/brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  handleClaudeCodeJudgmentHook,
  readClaudeCodeHookConfig,
} from '../src/claude-code-judgment-hook.js';
import { runCli } from '../src/cli.js';

const REG = 'b'.repeat(32);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round6-')));
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

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
    stdout: () => stdout, stderr: () => stderr,
  };
}

async function saveLogin(path: string, serverUrl: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: 'c'.repeat(32), server_url: serverUrl,
    access_token: `token-for-${serverUrl}`, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }), { mode: 0o600 });
}

const submit = (cwd: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd, prompt: 'hi' });

describe('the hook only sends the login it was installed for', () => {
  it('records the login server at install and sends nothing once the saved login is for another server', async () => {
    const dir = await tempDir();
    const repo = await checkout(dir, 'app', 'git@github.com:acme/app.git');
    const settings = join(dir, 'settings.json');
    const config = join(dir, 'hook.json');
    const credentials = join(dir, 'credentials.json');
    await saveLogin(credentials, 'https://api-staging.example.net');
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp-staging.example.net',
      '--server', 'https://api-staging.example.net', '--settings', settings, '--config', config], out.io)).toBe(0);
    const saved = readClaudeCodeHookConfig(config)!;
    expect(saved.login_server).toBe('https://api-staging.example.net');
    const options = { env: { HOME: dir }, configPath: config, registrationId: saved.registration.id, credentials: { credentialsPath: credentials } };

    const staging = host();
    await handleClaudeCodeJudgmentHook(submit(repo), { ...options, fetch: staging.fetchImpl });
    expect(staging.sent).toHaveLength(1);
    expect(staging.sent[0].headers.authorization).toBe('Bearer token-for-https://api-staging.example.net');

    // The person logs in to production: the staging registration must not carry that bearer.
    await saveLogin(credentials, 'https://api.example.net');
    const after = host();
    const output = await handleClaudeCodeJudgmentHook({ ...submit(repo), session_id: 's2', prompt_id: 'p2' }, { ...options, fetch: after.fetchImpl });
    expect(after.sent).toHaveLength(0);
    expect(String(output.systemMessage)).toContain('judgment_hook_login_origin_mismatch');
  });

  it('takes the login server from the saved login when --server is left out, and refuses without either', async () => {
    const dir = await tempDir();
    const credentials = join(dir, 'credentials.json');
    const env = process.env.BRAINBASE_CREDENTIALS_FILE;
    process.env.BRAINBASE_CREDENTIALS_FILE = credentials;
    try {
      const missing = capture();
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
        '--settings', join(dir, 's.json'), '--config', join(dir, 'h.json')], missing.io)).toBe(1);
      expect(missing.stderr()).toContain('--server');
      await saveLogin(credentials, 'https://api.example.net');
      expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
        '--settings', join(dir, 's.json'), '--config', join(dir, 'h.json')], capture().io)).toBe(0);
      expect(readClaudeCodeHookConfig(join(dir, 'h.json'))!.login_server).toBe('https://api.example.net');
    } finally {
      if (env === undefined) delete process.env.BRAINBASE_CREDENTIALS_FILE;
      else process.env.BRAINBASE_CREDENTIALS_FILE = env;
    }
  });
});

describe('a saved repository list reads back the same', () => {
  it('keeps a name that ends in .git on a self-hosted server', async () => {
    const dir = await tempDir();
    const config = join(dir, 'hook.json');
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
      '--server', 'https://api.example.net', '--repositories', 'git.example.net/team/tools.git.git',
      '--settings', join(dir, 'settings.json'), '--config', config], capture().io)).toBe(0);
    expect(JSON.parse(await readFile(config, 'utf8')).repositories).toEqual(['git.example.net/team/tools.git']);
    const saved = readClaudeCodeHookConfig(config)!;
    expect(saved.repositories).toEqual(['git.example.net/team/tools.git']);

    const allowed = await checkout(dir, 'allowed', 'https://git.example.net/team/tools.git.git');
    const other = await checkout(dir, 'other', 'https://git.example.net/team/tools.git');
    const options = { env: { HOME: dir }, configPath: config, registrationId: saved.registration.id, accessToken: async () => 'jwt' };
    const a = host();
    await handleClaudeCodeJudgmentHook(submit(allowed), { ...options, fetch: a.fetchImpl });
    expect(a.sent).toHaveLength(1);
    const b = host();
    await handleClaudeCodeJudgmentHook({ ...submit(other), session_id: 's9', prompt_id: 'p9' }, { ...options, fetch: b.fetchImpl });
    expect(b.sent).toHaveLength(0);
  });
});

describe('removing through a link to the hook config', () => {
  it('registers again through the same config link after removal', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const real = join(dir, 'real', 'hook.json');
    const link = join(dir, 'links', 'hook.json');
    const base = ['judgment:install', '--target', 'claude-code', '--settings', settings];
    const install = [...base, '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net'];
    expect(await runCli([...install, '--config', real], capture().io)).toBe(0);
    const id = readClaudeCodeHookConfig(real)!.registration.id;
    await mkdir(join(dir, 'links'));
    await symlink('../real/hook.json', link);

    expect(await runCli([...base, '--remove', '--config', link], capture().io)).toBe(0);
    expect(readClaudeCodeHookConfig(real)).toBeNull();
    expect(await runCli([...install, '--config', link], capture().io)).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const config = readClaudeCodeHookConfig(real);
    expect(config).not.toBeNull();
    expect(config!.registration.id).not.toBe(id);
    expect(await readFile(settings, 'utf8')).toContain(config!.registration.id);
  });

  it('invalidates the registration in the real file', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const real = join(dir, 'real', 'hook.json');
    await mkdir(join(dir, 'real'));
    await mkdir(join(dir, 'links'));
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
      '--server', 'https://api.example.net', '--settings', settings, '--config', real], capture().io)).toBe(0);
    const id = readClaudeCodeHookConfig(real)!.registration.id;
    const link = join(dir, 'links', 'hook.json');
    await symlink(real, link);
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--remove', '--settings', settings, '--config', link], capture().io)).toBe(0);
    expect(readClaudeCodeHookConfig(real)).toBeNull();
    const repo = await checkout(dir, 'app', 'git@github.com:acme/app.git');
    const sent = host();
    await handleClaudeCodeJudgmentHook(submit(repo), { env: { HOME: dir }, configPath: real, registrationId: id, accessToken: async () => 'jwt', fetch: sent.fetchImpl });
    expect(sent.sent).toHaveLength(0);
    // The person's own link is left in place.
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });
});

describe('installs from different homes', () => {
  it('wait on the same lock for the same settings file', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'shared', 'settings.json');
    await mkdir(join(dir, 'shared'));
    await writeFile(settings, '{}\n');
    const home = process.env.HOME;
    let finished = false;
    await withCredentialsLock(settings, async () => {
      process.env.HOME = join(dir, 'other-home');
      const running = runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
        '--server', 'https://api.example.net', '--settings', settings, '--config', join(dir, 'hook.json')], capture().io)
        .then((code) => { finished = true; return code; });
      try {
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(finished).toBe(false);
        expect(await readFile(settings, 'utf8')).toBe('{}\n');
      } finally {
        process.env.HOME = home;
      }
      // Released when this returns; the install then goes on.
      void running;
    }, { suffix: '.brainbase-install.lock' });
    await expect.poll(() => finished, { timeout: 5000 }).toBe(true);
    expect(JSON.parse(await readFile(settings, 'utf8')).hooks).toBeDefined();
  });
});
