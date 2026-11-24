// Review 7064679784 (PR #1042 at b2cbc30): an option judgment:install --target
// claude-code did not read was ignored, so the scope, the project or the
// preview was lost while the install still wrote. Each case must stop before
// touching a file.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
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

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (chunk: string) => { stdout += chunk; } }, stderr: { write: (chunk: string) => { stderr += chunk; } } },
    stdout: () => stdout, stderr: () => stderr,
  };
}

async function home() {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'brainbase-claude-round9-')));
  dirs.push(dir);
  process.env.HOME = dir;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const settings = join(dir, 'settings.json');
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo kept' }] }] } };
  await writeFile(settings, JSON.stringify(existing));
  return { dir, settings, existing };
}

const base = ['judgment:install', '--target', 'claude-code', '--origin', 'https://mcp.example.net', '--server', 'https://api.example.net'];

describe('judgment:install --target claude-code refuses options it would otherwise drop', () => {
  for (const [extra, message] of [
    [['--repositories=github.com/acme/app'], /--repositories=… の形は使えません/],
    [['--project=brainbase'], /--project=… の形は使えません/],
    [['--project'], /--project には値が要ります/],
    [['--project', '--repositories', 'github.com/acme/app'], /--project には値が要ります/],
    [['--project', ''], /--project には値が要ります/],
    [['--project', '   '], /--project must match/],
    [['--project', 'a', '--project', 'b'], /--project は1回だけ/],
    [['--dry-run=true'], /--dry-run=… の形は使えません/],
    [['--dry-run', 'true'], /--dry-run は値をとりません/],
    [['--remove=yes'], /--remove=… の形は使えません/],
    [['--repository', 'github.com/acme/app'], /--repository を知りません/],
    [['--dryrun'], /--dryrun を知りません/],
  ] as const) {
    it(`refuses ${JSON.stringify(extra)} and writes nothing`, async () => {
      const { dir, settings, existing } = await home();
      const out = capture();
      expect(await runCli([...base, ...extra], out.io)).toBe(1);
      expect(out.stderr()).toMatch(message);
      expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(existing);
      expect(await readdir(dir)).toEqual(['settings.json']);
    });
  }

  it('still installs with --project and --repositories written with a space', async () => {
    const { dir } = await home();
    const config = join(dir, 'hook.json');
    const out = capture();
    expect(await runCli([...base, '--project', 'brainbase', '--repositories', 'github.com/acme/app', '--config', config], out.io)).toBe(0);
    const saved = JSON.parse(await readFile(config, 'utf8'));
    expect(saved.project_code).toBe('brainbase');
    expect(saved.repositories).toEqual(['github.com/acme/app']);
  });

  it('a bare --dry-run still previews without writing', async () => {
    const { dir, settings, existing } = await home();
    const out = capture();
    expect(await runCli([...base, '--project', 'brainbase', '--dry-run'], out.io)).toBe(0);
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(existing);
    expect(await readdir(dir)).toEqual(['settings.json']);
  });
});
