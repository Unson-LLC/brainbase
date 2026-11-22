// A save or logout that stopped half way (the process was killed, the machine
// lost power) is finished or rolled back by whoever takes the lock next, so a
// retry neither stays at login_missing nor leaves tokens on the machine
// (UNS-656 plan B PR2, review round 14, musts 1 and 3). Each test sets up the
// exact files a stopped process leaves: its lock, held by a process that no
// longer runs, and the login it had moved aside. Every value here is a fake
// made up in this file.
import { lstat, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIALS_SCHEMA_VERSION,
  checkCredentialsTarget,
  getAccessToken,
  loginKeyOf,
  readCredentials,
  removeCredentials,
  writeCredentials,
  type BrainbaseCredentials,
} from '../src/brainbase-login.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function root(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-login-r15-'));
  dirs.push(dir);
  return { dir, path: join(dir, 'credentials.json') };
}

const NOW = Date.parse('2026-11-23T09:00:00Z');
const OTHER_FILE = '{"theme":"dark","note":"fake settings of another tool"}\n';

function saved(overrides: Partial<BrainbaseCredentials> = {}): BrainbaseCredentials {
  return {
    schema_version: CREDENTIALS_SCHEMA_VERSION,
    login_id: 'fake-login-old',
    server_url: 'https://api.example.invalid',
    access_token: 'fake.old.access',
    refresh_token: 'fake-old-refresh',
    expires_at: new Date(NOW + 3600_000).toISOString(),
    ...overrides,
  } as BrainbaseCredentials;
}

function text(credentials: BrainbaseCredentials): string {
  return `${JSON.stringify(credentials, null, 2)}\n`;
}

/** The lock a process that stopped while holding it leaves: its pid no longer runs. */
async function leaveDeadLock(path: string): Promise<void> {
  const pid = spawnSync(process.execPath, ['-e', '']).pid!;
  const owner = createHash('md5').update(`stopped-${pid}`).digest('hex');
  await writeFile(`${path}.lock`, JSON.stringify({ format: 'brainbase-login-lock/v1', owner, pid, host: hostname() }));
}

async function exists(target: string): Promise<boolean> {
  return lstat(target).then(() => true, () => false);
}

async function asides(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => /\.(replacing|removing|lock)$/u.test(name)).sort();
}

describe('must 1: a save that stopped after moving the saved login aside', () => {
  it('before the new file was linked in: the next read rolls it back and the old login keeps working', async () => {
    const { dir, path } = await root();
    await writeCredentials(path, saved());
    // The stopped save had moved the checked login aside and placed nothing.
    await rename(path, `${path}.replacing`);
    await leaveDeadLock(path);

    await expect(getAccessToken({ credentialsPath: path, now: () => NOW }))
      .resolves.toEqual({ token: 'fake.old.access', serverUrl: 'https://api.example.invalid' });
    expect(await readFile(path, 'utf8')).toBe(text(saved()));
    expect(await asides(dir)).toEqual([]);
  });

  it('without a lock left behind (it was released or removed): the read still rolls it back', async () => {
    const { dir, path } = await root();
    await writeCredentials(path, saved());
    await rename(path, `${path}.replacing`);

    expect(await readCredentials(path)).toEqual(saved());
    expect(await asides(dir)).toEqual([]);
  });

  it('the next login save sees the rolled-back login and replaces only that one', async () => {
    const { dir, path } = await root();
    await writeCredentials(path, saved());
    await rename(path, `${path}.replacing`);
    await leaveDeadLock(path);

    const check = await checkCredentialsTarget(path);
    expect(check.saved).toBe(loginKeyOf(saved()));
    const next = saved({ login_id: 'fake-login-new', access_token: 'fake.new.access' });
    await writeCredentials(path, next, { expected: check.saved });
    expect(await readFile(path, 'utf8')).toBe(text(next));
    expect(await asides(dir)).toEqual([]);
  });

  it('after the new file was linked in: the old login is deleted, the new one stays', async () => {
    const { dir, path } = await root();
    const next = saved({ login_id: 'fake-login-new', access_token: 'fake.new.access' });
    await writeFile(`${path}.replacing`, text(saved()), { mode: 0o600 });
    await writeFile(path, text(next), { mode: 0o600 });
    await leaveDeadLock(path);

    await expect(getAccessToken({ credentialsPath: path, now: () => NOW - 7200_000, refreshSkewMs: 0 }))
      .resolves.toMatchObject({ token: 'fake.new.access' });
    // getAccessToken did not need the lock; the next change takes it and cleans up.
    await writeCredentials(path, next);
    expect(await readFile(path, 'utf8')).toBe(text(next));
    expect(await asides(dir)).toEqual([]);
  });

  it('a file left aside that is no saved login is put back into the empty path, never deleted', async () => {
    const { dir, path } = await root();
    await writeFile(`${path}.replacing`, OTHER_FILE);

    await expect(writeCredentials(path, saved())).rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await asides(dir)).toEqual([]);
  });

  it('a file left aside that is no saved login, with a login at the path: both stay, the save refuses', async () => {
    const { path } = await root();
    await writeCredentials(path, saved());
    await writeFile(`${path}.replacing`, OTHER_FILE);

    await expect(writeCredentials(path, saved({ access_token: 'fake.next.access' }))).rejects.toMatchObject({ code: 'login_changed' });
    expect(await readFile(`${path}.replacing`, 'utf8')).toBe(OTHER_FILE);
    expect(await readFile(path, 'utf8')).toBe(text(saved()));
  });

  it('a link left aside is not followed, moved or deleted', async () => {
    const { dir, path } = await root();
    const elsewhere = join(dir, 'elsewhere.json');
    await writeFile(elsewhere, text(saved()));
    await symlink(elsewhere, `${path}.replacing`);

    expect(await readCredentials(path)).toBeNull();
    // A first save needs no aside; replacing that login would move it onto the link, so it refuses.
    const first = saved({ login_id: 'fake-login-new', access_token: 'fake.new.access' });
    await writeCredentials(path, first);
    await expect(writeCredentials(path, saved({ login_id: 'fake-login-third' }))).rejects.toMatchObject({ code: 'login_changed' });
    expect((await lstat(`${path}.replacing`)).isSymbolicLink()).toBe(true);
    expect(await readFile(elsewhere, 'utf8')).toBe(text(saved()));
    expect(await readFile(path, 'utf8')).toBe(text(first));
  });
});

describe('must 3: a logout that stopped after moving the saved login aside', () => {
  it('the retried logout deletes it and says a login was there', async () => {
    const { dir, path } = await root();
    await writeCredentials(path, saved());
    await rename(path, `${path}.removing`);
    await leaveDeadLock(path);

    await expect(removeCredentials(path)).resolves.toMatchObject({ existed: true });
    expect(await exists(`${path}.removing`)).toBe(false);
    expect(await asides(dir)).toEqual([]);
  });

  it('any other command that takes the lock finishes the logout instead of bringing the login back', async () => {
    const { dir, path } = await root();
    await writeCredentials(path, saved());
    await rename(path, `${path}.removing`);

    const next = saved({ login_id: 'fake-login-new', access_token: 'fake.new.access' });
    await writeCredentials(path, next, { expected: null });
    expect(await readFile(path, 'utf8')).toBe(text(next));
    expect(await asides(dir)).toEqual([]);
    expect(await readCredentials(path)).toEqual(next);
  });

  it('a file left aside that is no saved login is put back, and the logout leaves it as it is', async () => {
    const { dir, path } = await root();
    await writeFile(`${path}.removing`, OTHER_FILE);

    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_credentials_unrecognized' });
    expect(await readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await asides(dir)).toEqual([]);
  });

  it('a file left aside that is no saved login, with a login at the path: both stay, the logout refuses', async () => {
    const { path } = await root();
    await writeCredentials(path, saved());
    await writeFile(`${path}.removing`, OTHER_FILE);

    await expect(removeCredentials(path)).rejects.toMatchObject({ code: 'login_changed' });
    expect(await readFile(`${path}.removing`, 'utf8')).toBe(OTHER_FILE);
    expect(await readFile(path, 'utf8')).toBe(text(saved()));
  });
});
