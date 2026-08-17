import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    expect(plan.writes.canonicalEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'participates_in' }),
      expect.objectContaining({ relation: 'governs' })
    ]));
    expect(plan.writes.canonicalEdges.find((edge) => edge.fromId.startsWith('person-'))).toMatchObject({
      relation: 'participates_in',
      role: 'user'
    });
    expect(plan.writes.canonicalEdges.every((edge) => edge.relation === 'participates_in' || edge.relation === 'governs')).toBe(true);

    const repeated = buildProjectRegistrationPlan({
      name: '大田原さんBrainbase導入',
      goal: '個人ローカルMCPで仕事文脈を渡せるようにする',
      status: 'オンボーディング設計中',
      role: '導入支援',
      stakeholders: [parseProjectStakeholder('大田原さん|user|個人利用から開始する')],
      sources: [parseProjectSource('drive|提案フォルダ|folder-123')],
      taskSources: ['Calendar follow-ups'],
      decisionPrinciples: ['ソース由来の推測は候補に留める']
    });
    expect(repeated.writes.canonicalEdges).toEqual(plan.writes.canonicalEdges);
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

  it('writes stable project ID edges idempotently on Graph v2', async () => {
    const dir = await tempDir();
    const output = capture();
    const args = [
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
    ];
    const code = await runCli(args, output.io);

    expect(code).toBe(0);
    const first = await loadPersonalOs(dir);
    expect(first.graph.version).toBe(2);
    if (first.graph.version === 2) {
      expect(first.graph.edges).toHaveLength(2);
      expect(first.graph.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: 'participates_in', role: 'reviewer' }),
        expect.objectContaining({ relation: 'governs' })
      ]));
    }
    expect(first.relationships.relationships).toHaveLength(1);
    expect(first.decisions).toHaveLength(1);

    expect(await runCli(args, capture().io)).toBe(0);
    const repeated = await loadPersonalOs(dir);
    expect(repeated.graph).toEqual(first.graph);
    expect(repeated.relationships.relationships).toHaveLength(1);
    expect(repeated.decisions).toHaveLength(1);
    expect(repeated.personalKg).toHaveLength(1);
  });

  it('fails loudly on a legacy Graph v1 fixture without partial writes', async () => {
    const dir = await tempDir();
    await runCli(['onboard:init', '--dir', dir], capture().io);
    await writeFile(join(dir, 'graph.json'), `${JSON.stringify({ version: 1, owner: {}, entities: [] }, null, 2)}\n`);
    const output = capture();

    const code = await runCli([
      'onboard:projects', '--dir', dir, '--name', 'Legacy Project',
      '--stakeholder', 'Partner|reviewer|Reviews project decisions',
      '--decision-principle', 'Prefer reviewed project facts', '--write'
    ], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toMatch(/migration_required.*Graph v1/i);
    const os = await loadPersonalOs(dir);
    expect(os.graph).toMatchObject({ version: 1, entities: [] });
    expect(os.relationships.relationships).toEqual([]);
    expect(os.decisions).toEqual([]);
    expect(await readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).toBe('');
  });
});
