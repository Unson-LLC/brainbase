// A save that replaces a saved login moves exactly the checked file aside and
// links the new one into the empty path, so a file another program puts there
// after the last check is never overwritten (UNS-656 plan B PR2, review round
// 13). Every value here is a fake made up in this file.
import * as realFs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each hook runs once, at the point named, then is cleared.
const hooks: {
  /** Right before a save moves the checked login aside. */
  beforeMoveAside?: () => Promise<void>;
  /** Right before a save links its new file into the path (after the move aside). */
  beforeLinkNew?: () => Promise<void>;
} = {};

function once<K extends keyof typeof hooks>(key: K): (() => Promise<void>) | undefined {
  const hook = hooks[key];
  hooks[key] = undefined;
  return hook;
}

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rename = async (...args: Parameters<typeof actual.rename>) => {
    if (String(args[1]).endsWith('.replacing')) await once('beforeMoveAside')?.();
    return actual.rename(...args);
  };
  const link = async (...args: Parameters<typeof actual.link>) => {
    if (String(args[0]).endsWith('.tmp') && !String(args[1]).endsWith('.lock')) await once('beforeLinkNew')?.();
    return actual.link(...args);
  };
  return { ...actual, rename, link, default: { ...actual, rename, link } };
});

const { CREDENTIALS_SCHEMA_VERSION, readCredentials, writeCredentials } = await import('../src/brainbase-login.js');
type BrainbaseCredentials = import('../src/brainbase-login.js').BrainbaseCredentials;

const dirs: string[] = [];
afterEach(async () => {
  for (const key of Object.keys(hooks) as (keyof typeof hooks)[]) hooks[key] = undefined;
  await Promise.all(dirs.splice(0).map((dir) => realFs.rm(dir, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const dir = await realFs.mkdtemp(join(tmpdir(), 'brainbase-login-r14-'));
  dirs.push(dir);
  return dir;
}

const NOW = Date.parse('2026-11-23T03:00:00Z');
const OTHER_FILE = '{"theme":"dark","note":"fake settings of another tool"}\n';

function saved(overrides: Partial<BrainbaseCredentials> = {}): BrainbaseCredentials {
  return {
    schema_version: CREDENTIALS_SCHEMA_VERSION,
    login_id: 'fake-login-id',
    server_url: 'https://api.example.invalid',
    access_token: 'fake.access.token',
    refresh_token: 'fake-refresh-token',
    expires_at: new Date(NOW + 3600_000).toISOString(),
    ...overrides,
  } as BrainbaseCredentials;
}

async function writeRaw(path: string, text: string): Promise<void> {
  await realFs.writeFile(`${path}.swap`, text);
  await realFs.rename(`${path}.swap`, path);
}

async function leftovers(dir: string): Promise<string[]> {
  return (await realFs.readdir(dir)).filter((name) => /\.(replacing|tmp|swap|lock)$/u.test(name));
}

describe('must 1: replacing a saved login never overwrites a file put there after the check', () => {
  it('the login swapped for another file right before the replace: that file stays', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeMoveAside = () => writeRaw(path, OTHER_FILE);
    await expect(writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('the login rewritten in place right before the replace: the rewritten file stays', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeMoveAside = () => realFs.appendFile(path, ' ');
    await expect(writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' })))
      .rejects.toMatchObject({ code: 'login_changed' });
    const text = await realFs.readFile(path, 'utf8');
    expect(text).toMatch(/fake-refresh-token/u);
    expect(text.endsWith(' ')).toBe(true);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('the login removed right before the replace: nothing is put there', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeMoveAside = () => realFs.rm(path);
    await expect(writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readdir(dir)).toEqual([]);
  });

  it('a file created at the empty path after the move aside stays', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeLinkNew = () => realFs.writeFile(path, OTHER_FILE, { flag: 'wx' });
    await expect(writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' })))
      .rejects.toMatchObject({ code: 'login_changed' });
    expect(await realFs.readFile(path, 'utf8')).toBe(OTHER_FILE);
    expect(await leftovers(dir)).toEqual([]);
  });

  it('a link that fails for another reason puts the checked login back', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    hooks.beforeLinkNew = async () => {
      throw Object.assign(new Error('fake I/O failure'), { code: 'EIO' });
    };
    await expect(writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' })))
      .rejects.toMatchObject({ code: 'EIO' });
    expect((await readCredentials(path))?.refresh_token).toBe('fake-refresh-token');
    expect(await leftovers(dir)).toEqual([]);
  });

  it('an unchanged login is replaced, and nothing is left beside it', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    await writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' }));
    expect((await readCredentials(path))?.refresh_token).toBe('fake-next-refresh');
    expect(await realFs.readdir(dir)).toEqual(['credentials.json']);
    expect((await realFs.stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe('a read without the lock while a login is being replaced', () => {
  it('waits for the save and reads the new login instead of finding none', async () => {
    const dir = await root();
    const path = join(dir, 'credentials.json');
    await writeCredentials(path, saved());
    let during: Promise<BrainbaseCredentials | null> | undefined;
    hooks.beforeLinkNew = async () => {
      during = readCredentials(path);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    await writeCredentials(path, saved({ refresh_token: 'fake-next-refresh' }));
    expect((await during)?.refresh_token).toBe('fake-next-refresh');
  });

  it('finds no login at once when no save is running', async () => {
    const dir = await root();
    const started = Date.now();
    expect(await readCredentials(join(dir, 'credentials.json'))).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
