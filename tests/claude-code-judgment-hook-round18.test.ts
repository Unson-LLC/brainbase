// Review 01a205aa (PR #1042 at 3c2ff1e9, codex, request_changes), the two
// musts Director kept in this PR (RUNNER_REVIEW_LIMIT rounds=18):
// (1) an absolute scp-like origin (`host:/srv/a/b`) read as the same
//     repository as `host:a/b`; (2) the judgment:install lock ran the login's
//     recovery of a stopped save or logout on the files next to the settings.
// Every value here is a fake made up in this file.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CREDENTIALS_SCHEMA_VERSION, withCredentialsLock } from '../src/brainbase-login.js';
import { repositoryIdentityFromUrl } from '../src/claude-code-judgment-hook.js';
import { runCli } from '../src/cli.js';

const dirs: string[] = [];
const savedEnv = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round18-')));
  dirs.push(dir);
  return dir;
}

function capture() {
  let stderr = '';
  return {
    io: { stdout: { write: () => undefined }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
    stderr: () => stderr,
  };
}

const EXPIRES_AT = new Date(Date.now() + 3_600_000).toISOString();

/** A saved brainbase login: what the recovery of a stopped save or logout acts on. */
function savedLogin(loginId: string): string {
  return `${JSON.stringify({
    schema_version: CREDENTIALS_SCHEMA_VERSION, login_id: loginId, server_url: 'https://api.example.net',
    access_token: `fake.${loginId}.access`, expires_at: EXPIRES_AT,
  }, null, 2)}\n`;
}

describe('must 1: an absolute scp-like origin names no repository', () => {
  it('gives null for host:/path, so it is not read as host:path', () => {
    expect(repositoryIdentityFromUrl('git@git.example.com:/srv/acme/app.git')).toBeNull();
    expect(repositoryIdentityFromUrl('git.example.com:/acme/app.git')).toBeNull();
  });

  it('still names the repository of a relative scp-like path and of URLs', () => {
    expect(repositoryIdentityFromUrl('git@git.example.com:acme/app.git')).toBe('git.example.com/acme/app');
    expect(repositoryIdentityFromUrl('ssh://git@git.example.com/acme/app.git')).toBe('git.example.com/acme/app');
    expect(repositoryIdentityFromUrl('https://git.example.com/acme/app.git')).toBe('git.example.com/acme/app');
  });
});

describe('must 2: the judgment:install lock never runs the login recovery', () => {
  it('a lock taken with recover: false leaves a saved login at the aside names as it is', async () => {
    const dir = await tempDir();
    const path = join(dir, 'settings.json');
    await writeFile(`${path}.removing`, savedLogin('fake-login-a'));
    await writeFile(`${path}.replacing`, savedLogin('fake-login-b'));

    const interrupted = await withCredentialsLock(path, async (lock) => lock.interrupted, { suffix: '.brainbase-install.lock', recover: false });
    expect(interrupted).toEqual({ logoutFinished: false, saveRolledBack: false });
    expect(await readFile(`${path}.removing`, 'utf8')).toBe(savedLogin('fake-login-a'));
    expect(await readFile(`${path}.replacing`, 'utf8')).toBe(savedLogin('fake-login-b'));
  });

  it('judgment:install and --remove leave the files next to the settings as they are', async () => {
    const dir = await tempDir();
    process.env.HOME = dir;
    process.env.CLAUDE_CONFIG_DIR = dir;
    const settings = join(dir, 'settings.json');
    const config = join(dir, 'hook.json');
    await writeFile(settings, JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
    await writeFile(`${settings}.removing`, savedLogin('fake-login-a'));
    await writeFile(`${settings}.replacing`, savedLogin('fake-login-b'));
    const base = ['judgment:install', '--target', 'claude-code', '--settings', settings, '--config', config];

    const install = capture();
    expect(await runCli([...base, '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net'], install.io), install.stderr()).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8')).permissions).toEqual({ allow: ['Bash(ls)'] });
    const remove = capture();
    expect(await runCli([...base, '--remove'], remove.io), remove.stderr()).toBe(0);

    expect(await readFile(`${settings}.removing`, 'utf8')).toBe(savedLogin('fake-login-a'));
    expect(await readFile(`${settings}.replacing`, 'utf8')).toBe(savedLogin('fake-login-b'));
  });
});
