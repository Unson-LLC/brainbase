import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-skills-e2e-'));
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

describe('Onboarding skills installer acceptance', () => {
  it('covers the Story acceptance criteria for built-in public skills', async () => {
    const codex = JSON.parse(await cli(['onboard:skills', '--target', 'codex', '--format', 'json']));
    expect(codex.skills.map((skill: { id: string }) => skill.id), 'onboarding-skills-installer ac:1 exposes the four built-in public Brainbase skills.').toEqual([
      'brainbase-personal-onboarding',
      'brainbase-source-import',
      'brainbase-candidate-review',
      'brainbase-daily-routines'
    ]);
    expect(codex.skills[0].recommendedPath, 'onboarding-skills-installer ac:2 --target codex changes recommended install paths.').toBe('~/.agents/skills/brainbase-personal-onboarding/SKILL.md');

    const claude = JSON.parse(await cli(['onboard:skills', '--target', 'claude', '--format', 'json']));
    expect(claude.skills[0].recommendedPath, 'onboarding-skills-installer ac:2 --target claude changes recommended install paths.').toBe('.claude/skills/brainbase-personal-onboarding/SKILL.md');

    const portable = JSON.parse(await cli(['onboard:skills', '--target', 'portable', '--format', 'json']));
    expect(portable.skills[0].recommendedPath, 'onboarding-skills-installer ac:2 --target portable changes recommended install paths.').toBe('skills/brainbase-personal-onboarding/SKILL.md');

    const subset = JSON.parse(await cli([
      'onboard:skills',
      '--target', 'portable',
      '--skills', 'brainbase-candidate-review,brainbase-source-import',
      '--format', 'json'
    ]));
    expect(subset.skills.map((skill: { id: string }) => skill.id), 'onboarding-skills-installer ac:4 --skills selects a deterministic subset.').toEqual([
      'brainbase-source-import',
      'brainbase-candidate-review'
    ]);

    const markdown = await cli(['onboard:skills', '--target', 'codex']);
    expect(markdown, 'onboarding-skills-installer ac:3 dry-run prints a manifest and SKILL.md contents.').toContain('# Brainbase公開オンボーディングSkills');
    expect(markdown).toContain('```markdown');
    expect(markdown, 'generated SKILL.md content should be Japanese for the first adopter audience.').toContain('## 目的');

    const lowered = JSON.stringify(codex.skills).toLowerCase();
    for (const banned of ['slack', 'sns', 'nocodb', 'vibepro', 'hosted backend', 'infisical', 'server operations', 'unson']) {
      expect(lowered, `onboarding-skills-installer ac:5 public skills must not reference ${banned}.`).not.toContain(banned);
    }
    expect(lowered, 'onboarding-skills-installer ac:6 skills must tell agents not to ask users to paste secrets.').toContain('oauthトークン');
    expect(lowered, 'onboarding-skills-installer ac:6 skills must tell agents not to ask users to paste secrets.').toContain('チャットに貼るようユーザーに依頼しない');

    const again = await cli(['onboard:skills', '--target', 'codex']);
    expect(again, 'onboarding-skills-installer ac:8 markdown output is deterministic.').toBe(markdown);
  });

  it('is generation-only: writes only with --out, refuses overwrite, and never writes canonical SSOT', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'personal-os');
    await runCli(['onboard:init', '--dir', dataDir], capture().io);
    const graphBefore = await readFile(join(dataDir, 'graph.json'), 'utf8');

    await cli(['onboard:skills', '--target', 'portable']);
    await expect(access(join(dir, 'skills'))).rejects.toThrow();

    const outDir = join(dir, 'skills');
    await cli(['onboard:skills', '--target', 'portable', '--skills', 'brainbase-daily-routines', '--out', outDir]);
    const skillFile = await readFile(join(outDir, 'brainbase-daily-routines', 'SKILL.md'), 'utf8');
    expect(skillFile, 'onboarding-skills-installer ac:3 --out writes selected SKILL.md files.').toContain('name: brainbase-daily-routines');
    expect(skillFile, 'generated SKILL.md content is Japanese.').toContain('# Brainbase日次ルーティン');

    const second = capture();
    const secondCode = await runCli(['onboard:skills', '--target', 'portable', '--skills', 'brainbase-daily-routines', '--out', outDir], second.io);
    expect(secondCode, 'onboarding-skills-installer ac:3 refuses to overwrite existing SKILL.md files.').toBe(1);
    expect(second.stderr()).toContain('Refusing to overwrite existing skill file');

    const graphAfter = await readFile(join(dataDir, 'graph.json'), 'utf8');
    expect(graphAfter, 'onboarding-skills-installer ac:7 command never writes canonical SSOT files.').toBe(graphBefore);
  });
});
