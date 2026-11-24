// Review 7063566574 (PR #1042 at 42de5de).
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BrainbaseLoginError, withCredentialsLock } from '../src/brainbase-login.js';
import {
  CLAUDE_CODE_HOOK_CONFIG_SCHEMA,
  handleClaudeCodeJudgmentHook,
  repositoryIdentity,
} from '../src/claude-code-judgment-hook.js';
import { runCli } from '../src/cli.js';

const REG = 'd'.repeat(32);
const REGISTRATION = { id: REG, settings: '/home/person/.claude/settings.json' };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round7-')));
  dirs.push(dir);
  return dir;
}

/** A checkout git itself accepts: HEAD, objects, refs and a config. */
async function checkout(root: string, name: string, configText: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, '.git', 'objects'), { recursive: true });
  await mkdir(join(dir, '.git', 'refs'), { recursive: true });
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(dir, '.git', 'config'), configText);
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

async function hookConfig(home: string, extra: Record<string, unknown> = {}): Promise<string> {
  await mkdir(join(home, '.brainbase'), { recursive: true });
  const path = join(home, '.brainbase', 'claude-code-judgment-hook.json');
  await writeFile(path, JSON.stringify({
    schema_version: CLAUDE_CODE_HOOK_CONFIG_SCHEMA, origin: 'https://mcp.example.net', login_server: 'https://api.example.net',
    registration: REGISTRATION, ...extra,
  }));
  return path;
}

const token = async () => 'fake-token';
const submit = (cwd: string) => ({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt_id: 'p1', cwd, prompt: 'hi' });
const origin = (url: string, more = '') => `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n${more}`;

describe('the repository is the origin git actually uses', () => {
  it('follows an insteadOf rewrite in the repository config', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', origin('https://github.com/acme/app',
      '[url "https://github.com/other/"]\n\tinsteadOf = https://github.com/acme/\n'));
    expect(repositoryIdentity(repo)).toBe('github.com/other/app');
    const configPath = await hookConfig(home, { repositories: ['github.com/acme/app'] });
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: home }, configPath, fetch: fetchImpl, accessToken: token, registrationId: REG });
    expect(sent).toEqual([]);
  });

  it('follows an insteadOf rewrite in the global git config of HOME, and sends the rewritten repository', async () => {
    const home = await tempDir();
    await writeFile(join(home, '.gitconfig'), '[url "git@github.com:other/"]\n\tinsteadOf = https://github.com/acme/\n');
    const repo = await checkout(home, 'app', origin('https://github.com/acme/app'));
    const allowed = await hookConfig(home, { repositories: ['github.com/acme/app'] });
    const first = host();
    await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: home }, configPath: allowed, fetch: first.fetchImpl, accessToken: token, registrationId: REG });
    expect(first.sent).toEqual([]);

    const open = await hookConfig(home);
    const second = host();
    await handleClaudeCodeJudgmentHook({ ...submit(repo), session_id: 's2', prompt_id: 'p2' },
      { env: { HOME: home }, configPath: open, fetch: second.fetchImpl, accessToken: token, registrationId: REG });
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0].headers['x-brainbase-repository']).toBe('github.com/other/app');
  });

  it('sends nothing, and says why, when git cannot tell the origin', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', origin('https://github.com/acme/app'));
    const configPath = await hookConfig(home);
    const { fetchImpl, sent } = host();
    const output = await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: home, PATH: join(home, 'no-git-here') }, configPath, fetch: fetchImpl, accessToken: token, registrationId: REG });
    expect(sent).toEqual([]);
    expect(String(output.systemMessage)).toContain('judgment_repository_unresolved');
  });

  it('keeps sending for a checkout without an origin when no list is set', async () => {
    const home = await tempDir();
    const repo = await checkout(home, 'app', '[core]\n\tbare = false\n');
    expect(repositoryIdentity(repo)).toBeNull();
    const configPath = await hookConfig(home);
    const { fetchImpl, sent } = host();
    await handleClaudeCodeJudgmentHook(submit(repo),
      { env: { HOME: home }, configPath, fetch: fetchImpl, accessToken: token, registrationId: REG });
    expect(sent).toHaveLength(1);
    expect(sent[0].headers['x-brainbase-repository']).toBeUndefined();
  });
});

describe('--dry-run shows only the hook change', () => {
  it('does not print the rest of the Claude Code settings', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const existing = {
      env: { ANTHROPIC_API_KEY: 'fake-secret-for-test-1', OTHER_TOKEN: 'fake-secret-for-test-2' },
      apiKeyHelper: 'echo fake-secret-for-test-3',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify --token fake-secret-for-test-4' }] }] },
    };
    await writeFile(settings, JSON.stringify(existing));
    const base = ['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
      '--server', 'https://api.example.net', '--settings', settings, '--config', join(dir, 'hook.json')];
    const preview = capture();
    expect(await runCli([...base, '--dry-run'], preview.io)).toBe(0);
    expect(preview.stdout()).not.toContain('fake-secret');
    const shown = JSON.parse(preview.stdout());
    expect(shown.settings).toBeUndefined();
    expect(shown.hooks.add.map((entry: { event: string }) => entry.event))
      .toEqual(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'].filter((event) =>
        shown.hooks.add.some((entry: { event: string }) => entry.event === event)));
    expect(JSON.stringify(shown.hooks.add)).toContain('judgment:claude-code-hook');
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(existing);

    expect(await runCli(base, capture().io)).toBe(0);
    const removal = capture();
    expect(await runCli([...base, '--remove', '--dry-run'], removal.io)).toBe(0);
    expect(removal.stdout()).not.toContain('fake-secret');
    const removed = JSON.parse(removal.stdout());
    expect(removed.hooks.add).toEqual([]);
    expect(removed.hooks.remove_registration_ids).toHaveLength(1);
  });
});

describe('install locks never remove a file they did not create', () => {
  it('leaves an unrelated <settings>.lock and <config>.lock alone, however old', async () => {
    const dir = await tempDir();
    const settings = join(dir, 'settings.json');
    const config = join(dir, 'hook.json');
    await writeFile(settings, '{}');
    for (const path of [`${settings}.lock`, `${config}.lock`]) {
      await writeFile(path, 'kept: not a brainbase lock\n');
      await utimes(path, new Date('2020-01-01'), new Date('2020-01-01'));
    }
    const out = capture();
    expect(await runCli(['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net',
      '--server', 'https://api.example.net', '--settings', settings, '--config', config], out.io)).toBe(0);
    expect(await readFile(`${settings}.lock`, 'utf8')).toBe('kept: not a brainbase lock\n');
    expect(await readFile(`${config}.lock`, 'utf8')).toBe('kept: not a brainbase lock\n');
  });

  it('waits on, and never removes, a lock file that is not a lock record when told to keep unreadable files', async () => {
    const dir = await tempDir();
    const target = join(dir, 'settings.json');
    const lockPath = `${target}.brainbase-install.lock`;
    await writeFile(lockPath, 'garbage');
    await utimes(lockPath, new Date('2020-01-01'), new Date('2020-01-01'));
    await expect(withCredentialsLock(target, async () => 'ran',
      { waitMs: 100, suffix: '.brainbase-install.lock' }))
      .rejects.toBeInstanceOf(BrainbaseLoginError);
    expect(await readFile(lockPath, 'utf8')).toBe('garbage');
  });
});
