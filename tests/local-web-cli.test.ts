import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { initializePersonalOs } from '../src/ssot.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-web-cli-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function capture(signal?: AbortSignal) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
      signal
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('brainbase web:serve', () => {
  for (const command of ['web:serve', 'review:serve']) {
    it(`${command} opens the local Web host with every screen on a loopback port`, async () => {
      const dataDir = join(directory, 'personal-os');
      await initializePersonalOs(dataDir);
      const controller = new AbortController();
      const output = capture(controller.signal);
      const running = runCli([command, '--dir', dataDir, '--journal', join(directory, 'journal'), '--port', '0'], output.io);
      try {
        await waitFor(() => output.stdout().includes('終了: Ctrl+C'));
        const origin = /Brainbase: (http:\/\/127\.0\.0\.1:\d+)\//u.exec(output.stdout())?.[1];
        expect(origin).toBeDefined();
        expect(output.stdout()).toContain(`- 今日（判断の見返し）: ${origin}/#today`);
        expect(output.stdout()).toContain(`- 目的と現状: ${origin}/#objectives`);
        expect(output.stdout()).toContain(`- プロジェクトと関係者: ${origin}/#projects`);
        expect(output.stdout()).toContain(`- 情報と関係: ${origin}/#graph`);
        const projects = await (await fetch(`${origin}/api/graph/projects`)).json();
        expect(projects).toMatchObject({ status: 'ok', projects: [], absenceConfirmed: true });
        const shell = await (await fetch(`${origin}/`)).text();
        expect(shell).toContain('<meta name="brainbase-web-token"');
        expect(shell).toContain('/ui/local-web-shell.css');
        const status = await (await fetch(`${origin}/api/local/status`)).json();
        expect(status).toMatchObject({ data_dir: dataDir, graph: { status: 'ready', format: 'v2' } });
        expect((await fetch(`${origin}/api/value-proofs/home`)).status).toBe(200);
      } finally {
        controller.abort();
      }
      await expect(running).resolves.toBe(0);
    });
  }

  it('names the command when the port is invalid', async () => {
    const output = capture();
    await expect(runCli(['review:serve', '--dir', directory, '--port', '70000'], output.io)).resolves.toBe(1);
    expect(output.stderr()).toContain('review:serve requires --port');
  });

  it('lists web:serve and keeps review:serve as its alias in the help', async () => {
    const output = capture();
    await runCli(['--help'], output.io);
    expect(output.stdout()).toContain('brainbase web:serve [--dir path] [--journal path] [--port n]');
    expect(output.stdout()).toContain('brainbase review:serve [--dir path] [--journal path] [--port n]  （web:serveの別名）');
  });
});
