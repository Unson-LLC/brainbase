import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import {
  ALL_BRAINBASE_SKILLS,
  assertPublicSafeSkillBundle,
  buildSkillBundle,
  parseSkillIds,
  parseSkillTarget,
  renderSkillsMarkdown
} from '../src/skills.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-skills-'));
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

describe('parseSkillTarget', () => {
  it('accepts supported targets and rejects unsupported targets', () => {
    expect(parseSkillTarget('codex')).toBe('codex');
    expect(parseSkillTarget('claude')).toBe('claude');
    expect(parseSkillTarget('portable')).toBe('portable');
    expect(() => parseSkillTarget('launchd')).toThrow(/codex\|claude\|portable/);
  });
});

describe('parseSkillIds', () => {
  it('INV-2 defaults to all skills in canonical order', () => {
    expect(parseSkillIds(undefined)).toEqual(ALL_BRAINBASE_SKILLS);
  });

  it('S-4 selects a deterministic subset in canonical order', () => {
    expect(parseSkillIds('brainbase-candidate-review,brainbase-source-import')).toEqual([
      'brainbase-source-import',
      'brainbase-candidate-review'
    ]);
  });

  it('rejects unknown skill ids loudly', () => {
    expect(() => parseSkillIds('brainbase-source-import,internal-ops')).toThrow(/Unknown Brainbase skill id/);
  });
});

describe('buildSkillBundle', () => {
  it('S-1/S-2/S-3 maps target install paths while keeping portable SKILL.md files', () => {
    expect(buildSkillBundle('codex').skills[0].recommendedPath).toBe('~/.agents/skills/brainbase-personal-onboarding/SKILL.md');
    expect(buildSkillBundle('claude').skills[0].recommendedPath).toBe('.claude/skills/brainbase-personal-onboarding/SKILL.md');
    expect(buildSkillBundle('portable').skills[0].recommendedPath).toBe('skills/brainbase-personal-onboarding/SKILL.md');
    expect(buildSkillBundle('portable').skills.every((skill) => skill.relativePath.endsWith('/SKILL.md'))).toBe(true);
  });

  it('INV-2 renders deterministic markdown for identical inputs', () => {
    const first = renderSkillsMarkdown(buildSkillBundle('codex', ['brainbase-source-import']));
    const second = renderSkillsMarkdown(buildSkillBundle('codex', ['brainbase-source-import']));
    expect(second).toBe(first);
  });

  it('INV-5/INV-6 keeps built-in skills public-safe and no-secrets scoped', () => {
    const bundle = buildSkillBundle('codex');
    expect(() => assertPublicSafeSkillBundle(bundle)).not.toThrow();
    const joined = bundle.skills.map((skill) => skill.content).join('\n').toLowerCase();
    for (const banned of ['slack', 'sns', 'nocodb', 'vibepro', 'infisical', 'lightsail', 'hosted backend', 'server operations', 'unson']) {
      expect(joined, `public skills must not contain ${banned}`).not.toContain(banned);
    }
    expect(joined).toContain('never ask the user to paste oauth tokens');
  });
});

describe('onboard:skills CLI', () => {
  it('S-7 emits deterministic JSON manifest with file contents', async () => {
    const output = capture();
    const code = await runCli(['onboard:skills', '--target', 'portable', '--skills', 'brainbase-source-import', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const manifest = JSON.parse(output.stdout());
    expect(manifest.target).toBe('portable');
    expect(manifest.canonicalWrites).toBe(false);
    expect(manifest.liveConfigWrites).toBe(false);
    expect(manifest.skills.map((skill: { id: string }) => skill.id)).toEqual(['brainbase-source-import']);
    expect(manifest.skills[0].content).toContain('name: brainbase-source-import');
  });

  it('S-5 writes selected skills with --out and S-6 refuses overwrite', async () => {
    const dir = await tempDir();
    const first = capture();
    const firstCode = await runCli([
      'onboard:skills',
      '--target', 'claude',
      '--skills', 'brainbase-candidate-review',
      '--out', dir
    ], first.io);

    expect(firstCode).toBe(0);
    await expect(readFile(join(dir, 'brainbase-candidate-review', 'SKILL.md'), 'utf8')).resolves.toContain('name: brainbase-candidate-review');

    const second = capture();
    const secondCode = await runCli([
      'onboard:skills',
      '--target', 'claude',
      '--skills', 'brainbase-candidate-review',
      '--out', dir
    ], second.io);

    expect(secondCode).toBe(1);
    expect(second.stderr()).toContain('Refusing to overwrite existing skill file');
  });
});
