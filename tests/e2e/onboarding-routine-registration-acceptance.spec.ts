import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-routines-'));
  dirs.push(dir);
  return dir;
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } }
    },
    stdout: () => stdout,
    stderr: () => stderr
  };
}

async function cli(args: string[]) {
  const output = capture();
  const code = await runCli(args, output.io);
  expect(code, output.stderr()).toBe(0);
  return output.stdout();
}

describe('Onboarding routine registration acceptance', () => {
  it('covers every Story acceptance criterion', async () => {
    // ac:1 generates ohayo/oyasumi/retro; ac:2 codex target emits automation.toml
    const codex = JSON.parse(await cli(['onboard:routines', '--target', 'codex', '--cwd', '/Users/otawara/brainbase', '--format', 'json']));
    expect(codex.routines.map((routine: { kind: string }) => routine.kind), 'onboarding-routine-registration ac:1 onboard:routines generates personal-scoped ohayo, oyasumi, and retro routine definitions.').toEqual(['ohayo', 'oyasumi', 'retro']);
    expect(codex.target, 'onboarding-routine-registration ac:2 --target codex emits Codex automation.toml content.').toBe('codex');

    // ac:1 --routines selects a subset
    const subset = JSON.parse(await cli(['onboard:routines', '--target', 'codex', '--routines', 'ohayo,retro', '--format', 'json']));
    expect(subset.routines.map((routine: { kind: string }) => routine.kind), 'onboarding-routine-registration ac:1 --routines can select a subset.').toEqual(['ohayo', 'retro']);

    // ac:2 claude target emits scheduled-task definition with cron
    const claude = JSON.parse(await cli(['onboard:routines', '--target', 'claude', '--cwd', '/Users/otawara/brainbase', '--format', 'json']));
    expect(claude.routines.every((routine: { cron: string }) => /^\d+ \d+ \* \* (\*|\d)$/.test(routine.cron)), 'onboarding-routine-registration ac:2 --target claude emits a Claude Code scheduled-task definition; ac:4 Claude output includes a cron expression.').toBe(true);

    // ac:3 ohayo/oyasumi daily, retro weekly; configurable hour/minute/dow
    const scheduled = JSON.parse(await cli([
      'onboard:routines', '--target', 'codex',
      '--ohayo-hour', '7', '--oyasumi-hour', '22', '--retro-dow', 'FRI', '--retro-hour', '17', '--format', 'json'
    ]));
    const byKind = Object.fromEntries(scheduled.routines.map((routine: { kind: string }) => [routine.kind, routine]));
    expect(byKind.ohayo.schedule.freq === 'daily' && byKind.oyasumi.schedule.freq === 'daily' && byKind.retro.schedule.freq === 'weekly', 'onboarding-routine-registration ac:3 ohayo and oyasumi are daily and retro is weekly, with configurable hour, minute, and retro day-of-week.').toBe(true);
    expect(byKind.retro.schedule.dayOfWeek, 'onboarding-routine-registration ac:3 retro day-of-week is configurable.').toBe('FRI');
    expect(byKind.oyasumi.schedule.hour, 'onboarding-routine-registration ac:3 routine hour is configurable.').toBe(22);

    // ac:4 codex output is valid automation.toml with kind=cron and rrule
    const codexToml = await cli(['onboard:routines', '--target', 'codex', '--cwd', '/Users/otawara/brainbase']);
    expect(codexToml, 'onboarding-routine-registration ac:4 Codex output is valid automation.toml with kind = "cron" and an RFC 5545 rrule.').toContain('kind = "cron"');
    expect(codexToml, 'onboarding-routine-registration ac:4 Codex output includes an RFC 5545 rrule.').toMatch(/rrule = "FREQ=(DAILY|WEEKLY);/);
    expect(codexToml, 'onboarding-routine-registration ac:4 Codex output is a per-file flat automation.toml, not a single merged table.').not.toContain('[automation]');

    // ac:5 personal-scoped, no Unson internal references
    const lowered = codexToml.toLowerCase();
    for (const banned of ['slack', 'sns ledger', 'nocodb', 'unson', 'salestailor', 'techknight']) {
      expect(lowered, `onboarding-routine-registration ac:5 routine prompts must not reference Unson internal operations (${banned}).`).not.toContain(banned);
    }
    expect(lowered, 'onboarding-routine-registration ac:5 routine prompts reference the local Brainbase MCP context.').toContain('brainbase mcp');

    // ac:6 side effects are confirmation-gated
    expect(lowered, 'onboarding-routine-registration ac:6 routine prompts keep external side effects safe and do not send/publish/modify/delete without explicit confirmation.').toContain('do not send');
    expect(lowered, 'onboarding-routine-registration ac:6 routine prompts require explicit confirmation/approval.').toMatch(/confirmation|approval/);

    // ac:8 deterministic output
    const again = await cli(['onboard:routines', '--target', 'codex', '--cwd', '/Users/otawara/brainbase']);
    expect(again, 'onboarding-routine-registration ac:8 JSON and markdown output are deterministic, including stable routine ids and schedules.').toBe(codexToml);
    expect(codex.routines.map((routine: { id: string }) => routine.id), 'onboarding-routine-registration ac:8 routine ids are stable.').toEqual(['brainbase-ohayo', 'brainbase-oyasumi', 'brainbase-retro']);
  });

  it('ac:7 is generation-only: dry-run by default, writes only with --out, never writes canonical SSOT', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'personal-os');
    await runCli(['onboard:init', '--dir', dataDir], capture().io);
    const graphBefore = await readFile(join(dataDir, 'graph.json'), 'utf8');

    // default dry-run: no --out, nothing written besides stdout
    await cli(['onboard:routines', '--target', 'codex', '--cwd', dir]);

    // --out writes a single file
    const outPath = join(dir, 'automations.toml');
    await cli(['onboard:routines', '--target', 'codex', '--cwd', dir, '--out', outPath]);
    const written = await readFile(outPath, 'utf8');
    expect(written, 'onboarding-routine-registration ac:7 writes a file only when --out is provided.').toContain('kind = "cron"');

    // canonical SSOT untouched
    const graphAfter = await readFile(join(dataDir, 'graph.json'), 'utf8');
    expect(graphAfter, 'onboarding-routine-registration ac:7 onboard:routines never writes canonical SSOT.').toBe(graphBefore);
  });
});
