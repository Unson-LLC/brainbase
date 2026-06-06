import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import {
  buildProjectRegistrationPlan,
  parseProjectSource,
  parseProjectStakeholder,
  renderProjectRegistrationMarkdown
} from '../src/projects.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-projects-'));
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

describe('project registration parsing', () => {
  it('S-2 parses stakeholders and rejects incomplete values', () => {
    expect(parseProjectStakeholder('大田原さん|partner|Brainbase導入を相談する相手')).toEqual({
      person: '大田原さん',
      role: 'partner',
      context: 'Brainbase導入を相談する相手'
    });
    expect(parseProjectStakeholder('大田原さん||意思決定者')).toEqual({
      person: '大田原さん',
      role: undefined,
      context: '意思決定者'
    });
    expect(() => parseProjectStakeholder('大田原さん|partner')).toThrow(/stakeholder/);
  });

  it('S-3 parses source allowlist metadata without reading sources', () => {
    expect(parseProjectSource('drive|提案フォルダ|gdrive-folder-id')).toEqual({
      area: 'drive',
      label: '提案フォルダ',
      ref: 'gdrive-folder-id'
    });
    expect(() => parseProjectSource('slack|internal|workspace')).toThrow(/mail\|calendar\|drive\|tasks\|local\|other/);
  });
});

describe('buildProjectRegistrationPlan', () => {
  it('INV-1/S-1 builds from interview answers without connectors', () => {
    const plan = buildProjectRegistrationPlan({
      name: '大田原さんBrainbase導入',
      goal: '個人ローカルMCPで仕事文脈を渡せるようにする',
      status: 'オンボーディング設計中',
      role: '導入支援',
      stakeholders: [parseProjectStakeholder('大田原さん|user|個人利用から開始する')],
      sources: [parseProjectSource('drive|提案フォルダ|folder-123')],
      taskSources: ['Calendar follow-ups'],
      decisionPrinciples: ['ソース由来の推測は候補に留める']
    });

    expect(plan.canonicalWrites).toBe(false);
    expect(plan.project.name).toBe('大田原さんBrainbase導入');
    expect(plan.project.sources[0]).toMatchObject({ area: 'drive', ref: 'folder-123' });
    expect(plan.writes.graphEntities.some((entity) => entity.type === 'project')).toBe(true);
    expect(plan.writes.relationships[0].person).toBe('大田原さん');
    expect(plan.writes.decisions[0].decision).toBe('ソース由来の推測は候補に留める');
  });

  it('INV-5 renders deterministic dry-run markdown for identical inputs', () => {
    const input = {
      name: 'Project A',
      goal: 'Create local context',
      sources: [parseProjectSource('mail|Gmail|account@example.com')]
    };
    const first = renderProjectRegistrationMarkdown(buildProjectRegistrationPlan(input), false, '/tmp/os');
    const second = renderProjectRegistrationMarkdown(buildProjectRegistrationPlan(input), false, '/tmp/os');
    expect(second).toBe(first);
  });
});

describe('onboard:projects CLI', () => {
  it('INV-2 dry-run does not write canonical SSOT', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:projects',
      '--dir', dir,
      '--name', 'Dry Run Project',
      '--goal', 'Review only',
      '--source', 'drive|Folder|folder-1',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const json = JSON.parse(output.stdout());
    expect(json.canonicalWrites).toBe(false);
    const os = await loadPersonalOs(dir);
    expect(os.graph.entities).toHaveLength(0);
    expect(os.personalKg).toHaveLength(0);
  });

  it('S-2/S-4 writes project, stakeholders, task sources, and decision principles only with --write', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:projects',
      '--dir', dir,
      '--name', 'Write Project',
      '--goal', 'Canonical project context',
      '--status', 'active',
      '--role', 'owner',
      '--stakeholder', 'Partner|reviewer|Reviews project decisions',
      '--source', 'tasks|Linear project|LIN-123',
      '--task-source', 'Linear',
      '--decision-principle', 'Prefer reviewed project facts',
      '--write',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const os = await loadPersonalOs(dir);
    const project = os.graph.entities.find((entity) => entity.type === 'project');
    expect(project?.name).toBe('Write Project');
    expect(project?.metadata?.taskSources).toEqual(['Linear']);
    expect(os.relationships.relationships[0].person).toBe('Partner');
    expect(os.decisions[0].decision).toBe('Prefer reviewed project facts');
    expect(await readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).toContain('Canonical project context');
  });
});
