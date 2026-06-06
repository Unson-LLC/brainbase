import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadPersonalOs } from '../../src/ssot.js';
import { getContext, listEntities, searchAll } from '../../src/tools.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-projects-e2e-'));
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

describe('Onboarding project registration acceptance', () => {
  it('covers the Story acceptance criteria for agent-assisted project registration', async () => {
    const dir = await tempDir();

    const dryRun = JSON.parse(await cli([
      'onboard:projects',
      '--dir', dir,
      '--name', '大田原さんBrainbase導入',
      '--goal', '個人ローカルMCPで仕事文脈を渡せるようにする',
      '--status', 'オンボーディング設計中',
      '--role', '導入支援',
      '--stakeholder', '大田原さん|user|個人利用から開始する',
      '--source', 'drive|提案フォルダ|gdrive-folder-id',
      '--task-source', 'Calendar follow-ups',
      '--decision-principle', 'ソース由来の推測は候補に留める',
      '--format', 'json'
    ]));

    expect(dryRun.project.name, 'onboarding-project-registration ac:1 command registers project context from interview answers without requiring connected external sources.').toBe('大田原さんBrainbase導入');
    expect(dryRun.project.goal, 'onboarding-project-registration ac:2 command captures project goal.').toBe('個人ローカルMCPで仕事文脈を渡せるようにする');
    expect(dryRun.project.status, 'onboarding-project-registration ac:2 command captures current status.').toBe('オンボーディング設計中');
    expect(dryRun.project.role, 'onboarding-project-registration ac:2 command captures user role.').toBe('導入支援');
    expect(dryRun.stakeholders[0].person, 'onboarding-project-registration ac:2 command captures stakeholders.').toBe('大田原さん');
    expect(dryRun.project.sources[0], 'onboarding-project-registration ac:2 command captures source allowlists.').toMatchObject({ area: 'drive', label: '提案フォルダ', ref: 'gdrive-folder-id' });
    expect(dryRun.project.taskSources, 'onboarding-project-registration ac:2 command captures task sources.').toEqual(['Calendar follow-ups']);
    expect(dryRun.project.decisionPrinciples, 'onboarding-project-registration ac:2 command captures project-specific decision principles.').toEqual(['ソース由来の推測は候補に留める']);
    expect(dryRun.canonicalWrites, 'onboarding-project-registration ac:3 dry-run by default.').toBe(false);

    const osAfterDryRun = await loadPersonalOs(dir);
    expect(osAfterDryRun.graph.entities, 'onboarding-project-registration ac:3 dry-run does not write canonical SSOT.').toHaveLength(0);
    expect(osAfterDryRun.sourceCount, 'onboarding-project-registration ac:4 source references are metadata only and no source files are read or written.').toBe(0);

    const markdown = await cli([
      'onboard:projects',
      '--dir', dir,
      '--name', '大田原さんBrainbase導入',
      '--goal', '個人ローカルMCPで仕事文脈を渡せるようにする'
    ]);
    const markdownAgain = await cli([
      'onboard:projects',
      '--dir', dir,
      '--name', '大田原さんBrainbase導入',
      '--goal', '個人ローカルMCPで仕事文脈を渡せるようにする'
    ]);
    expect(markdownAgain, 'onboarding-project-registration ac:9 markdown output is deterministic for identical dry-run inputs.').toBe(markdown);

    await cli([
      'onboard:projects',
      '--dir', dir,
      '--name', '大田原さんBrainbase導入',
      '--goal', '個人ローカルMCPで仕事文脈を渡せるようにする',
      '--status', 'オンボーディング設計中',
      '--role', '導入支援',
      '--stakeholder', '大田原さん|user|個人利用から開始する',
      '--source', 'drive|提案フォルダ|gdrive-folder-id',
      '--task-source', 'Calendar follow-ups',
      '--decision-principle', 'ソース由来の推測は候補に留める',
      '--write'
    ]);

    const os = await loadPersonalOs(dir);
    expect(os.graph.entities.some((entity) => entity.type === 'project' && entity.name === '大田原さんBrainbase導入'), 'onboarding-project-registration ac:3 writes canonical project only with --write.').toBe(true);
    expect(os.relationships.relationships[0]?.person, 'onboarding-project-registration ac:5 stakeholders are linked as relationship context only after --write.').toBe('大田原さん');
    expect(os.decisions[0]?.decision, 'onboarding-project-registration ac:6 project-specific decision principles are promoted only after --write.').toBe('ソース由来の推測は候補に留める');

    const context = getContext(os);
    expect(JSON.stringify(context), 'onboarding-project-registration ac:7 get_context returns registered project context.').toContain('個人ローカルMCP');
    expect(JSON.stringify(listEntities(os, 'project')), 'onboarding-project-registration ac:7 list_entities returns registered project entity.').toContain('大田原さんBrainbase導入');
    expect(searchAll(os, '提案フォルダ', 10).some((result) => result.title === '大田原さんBrainbase導入'), 'onboarding-project-registration ac:7 search returns project context from canonical metadata.').toBe(true);

    const agentProtocol = await cli(['onboard:agent', '--format', 'json']);
    expect(agentProtocol, 'onboarding-project-registration ac:8 onboard:agent mentions project registration as part of the assisted onboarding flow.').toContain('projects');
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme, 'onboarding-project-registration ac:8 README documents project registration.').toContain('Register active projects');
    const skills = await cli(['onboard:skills', '--target', 'portable', '--skills', 'brainbase-personal-onboarding']);
    expect(skills, 'onboarding-project-registration ac:8 generated onboarding skill mentions project registration.').toContain('onboard:projects');
  });
});
