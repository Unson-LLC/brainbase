import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadPersonalOs } from '../../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-agent-onboarding-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

describe('agent-assisted source onboarding acceptance', () => {
  it('covers the Story acceptance criteria for agent-assisted source onboarding', async () => {
    const agentMarkdown = await cli(['onboard:agent']);
    expect(agentMarkdown, 'agent-assisted-source-onboarding ac:1 `brainbase onboard:agent` outputs a reusable agent prompt that tells Codex / Claude Code what to ask and what not to do.').toContain('Codex');
    expect(agentMarkdown, 'agent-assisted-source-onboarding ac:1 `brainbase onboard:agent` outputs a reusable agent prompt that tells Codex / Claude Code what to ask and what not to do.').toContain('Claude Code');
    expect(agentMarkdown, 'agent-assisted-source-onboarding ac:1 `brainbase onboard:agent` outputs a reusable agent prompt that tells Codex / Claude Code what to ask and what not to do.').toContain('Do not ask the user to paste OAuth tokens');

    const agentJson = JSON.parse(await cli(['onboard:agent', '--format', 'json']));
    expect(agentJson.interviewSections.map((section: { id: string }) => section.id), 'agent-assisted-source-onboarding ac:2 `brainbase onboard:agent --format json` returns structured interview sections for mail, calendar, drive/docs, tasks, permissions, and approval.').toEqual([
      'email',
      'calendar',
      'drive',
      'tasks',
      'permissions',
      'approval'
    ]);
    expect(agentJson.safetyRules.join('\n'), 'agent-assisted-source-onboarding ac:2 `brainbase onboard:agent --format json` returns structured interview sections for mail, calendar, drive/docs, tasks, permissions, and approval.').toContain('Body excerpts require explicit user approval');

    const recommendationSet = JSON.parse(await cli([
      'onboard:recommend',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'notion',
      '--format', 'json'
    ]));
    expect(recommendationSet.recommendations.map((item: { area: string }) => item.area), 'agent-assisted-source-onboarding ac:3 `brainbase onboard:recommend` accepts tool answers for `--email`, `--calendar`, `--drive`, and `--tasks`.').toEqual([
      'email',
      'calendar',
      'drive',
      'tasks'
    ]);
    expect(recommendationSet.recommendations, 'agent-assisted-source-onboarding ac:4 Gmail, Google Calendar, and Google Drive answers recommend local GoG-style collection with metadata-first source staging.').toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'email', recommendation: expect.stringContaining('GoG Gmail'), importMode: 'metadata-first', sourcePath: 'sources/gmail/threads.jsonl' }),
      expect.objectContaining({ area: 'calendar', recommendation: expect.stringContaining('GoG Google Calendar'), importMode: 'metadata-first', sourcePath: 'sources/calendar/events.jsonl' }),
      expect.objectContaining({ area: 'drive', recommendation: expect.stringContaining('GoG Drive'), importMode: 'metadata-first', sourcePath: 'sources/drive/files.jsonl' })
    ]));
    expect(recommendationSet.canonicalization.join('\n'), 'agent-assisted-source-onboarding ac:6 Recommendations always keep imported material in `sources/` and require approval before canonical SSOT writes.').toContain('Store imported source material under sources/');
    expect(recommendationSet.canonicalization.join('\n'), 'agent-assisted-source-onboarding ac:6 Recommendations always keep imported material in `sources/` and require approval before canonical SSOT writes.').toContain('Promote only user-approved');

    const taskInputs = ['notion', 'todoist', 'linear', 'github-issues', 'nocodb', 'csv', 'none'];
    for (const taskInput of taskInputs) {
      const tasks = JSON.parse(await cli(['onboard:recommend', '--tasks', taskInput, '--format', 'json']))
        .recommendations
        .find((item: { area: string }) => item.area === 'tasks');
      expect(tasks, `agent-assisted-source-onboarding ac:5 Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and \`none\` task answers produce deterministic recommendations. ${taskInput} produces deterministic task recommendation.`).toMatchObject({
        area: 'tasks',
        input: taskInput,
        sourcePath: 'sources/tasks/tasks.jsonl'
      });
    }

    const dir = await tempDir();
    await cli(['onboard:init', '--dir', dir]);
    await expect(access(join(dir, 'sources', 'gmail')), 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'calendar')), 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'drive')), 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'tasks')), 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').resolves.toBeUndefined();
    await expect(access(join(dir, 'candidates')), 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').resolves.toBeUndefined();
    expect((await loadPersonalOs(dir)).sourceCount, 'agent-assisted-source-onboarding ac:7 `onboard:init` creates `sources/gmail`, `sources/calendar`, `sources/drive`, `sources/tasks`, and `candidates` without increasing raw source counts before files exist.').toBe(0);

    const readme = await readFile('README.md', 'utf8');
    expect(readme.indexOf('## Agent-assisted Onboarding'), 'agent-assisted-source-onboarding ac:8 README explains the agent-assisted onboarding path before the manual seed path.').toBeGreaterThanOrEqual(0);
    expect(readme.indexOf('## Agent-assisted Onboarding'), 'agent-assisted-source-onboarding ac:8 README explains the agent-assisted onboarding path before the manual seed path.').toBeLessThan(readme.indexOf('## 30 Minute Setup'));
  });
});
