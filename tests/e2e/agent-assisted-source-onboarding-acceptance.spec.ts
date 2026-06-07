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
    expect(agentMarkdown, 'value-first-onboarding ac:1 `brainbase onboard:agent` starts by asking for the repeated context the user wants Brainbase to remember.').toContain('What do you not want to explain repeatedly');
    expect(agentMarkdown, 'value-first-onboarding ac:1 `brainbase onboard:agent` starts by asking for the repeated context the user wants Brainbase to remember.').toContain('Codex');
    expect(agentMarkdown, 'value-first-onboarding ac:1 `brainbase onboard:agent` starts by asking for the repeated context the user wants Brainbase to remember.').toContain('Claude Code');
    expect(agentMarkdown, 'value-first-onboarding ac:1 `brainbase onboard:agent` starts by asking for the repeated context the user wants Brainbase to remember.').toContain('Do not ask the user to paste OAuth tokens');

    const agentJson = JSON.parse(await cli(['onboard:agent', '--format', 'json']));
    expect(agentJson.interviewSections.map((section: { id: string }) => section.id), 'value-first-onboarding ac:2 `brainbase onboard:agent --format json` returns value-first sections for value target, hypothesis, approval, minimum seed, first value demo, and optional sources.').toEqual([
      'value_target',
      'hypothesis',
      'approval',
      'minimum_seed',
      'first_value_demo',
      'optional_sources'
    ]);
    expect(agentJson.nextCommands.indexOf('brainbase onboard:demo --scenario "<real request that should now work>"'), 'value-first-onboarding ac:2 `brainbase onboard:agent --format json` returns value-first sections for value target, hypothesis, approval, minimum seed, first value demo, and optional sources.').toBeLessThan(
      agentJson.nextCommands.indexOf('brainbase onboard:diagnose-sources --email gmail --calendar google-calendar --drive google-drive --drive-folder "<folder-id>" --tasks notion')
    );
    expect(agentJson.safetyRules.join('\n'), 'value-first-onboarding ac:2 `brainbase onboard:agent --format json` returns value-first sections for value target, hypothesis, approval, minimum seed, first value demo, and optional sources.').toContain('Do not treat raw source diagnosis');
    expect(agentJson.nextCommands.join('\n'), 'agent-assisted-source-onboarding ac:2 project registration is part of the structured onboarding flow.').toContain('brainbase onboard:projects');

    const missingDir = await tempDir();
    const missingDemo = JSON.parse(await cli(['onboard:demo', '--dir', missingDir, '--format', 'json']));
    expect(missingDemo, 'value-first-onboarding ac:3 `brainbase onboard:demo --format json` reports `ready: false` with missing canonical areas when self, work, or relationships are absent.').toMatchObject({
      ready: false,
      missing: ['self', 'work', 'relationships'],
      completionSignal: 'needs_seed'
    });

    const demoDir = await tempDir();
    await cli([
      'onboard:seed',
      '--dir', demoDir,
      '--name', 'Owner',
      '--value', 'Do not re-explain the AI Dojo premise.',
      '--project', 'AI Dojo',
      '--relationship', 'Yamamoto Rikiya|CSO|Owns CSO perspective for AI Dojo decisions.'
    ]);
    const readyDemo = JSON.parse(await cli([
      'onboard:demo',
      '--dir', demoDir,
      '--scenario', 'Draft the first note to Yamamoto about AI Dojo.',
      '--format', 'json'
    ]));
    expect(readyDemo.ready, 'value-first-onboarding ac:4 After seeding self, work, and a relationship, `brainbase onboard:demo --scenario "<real request>" --format json` reports `ready: true` and produces an answer that uses the saved relationship context.').toBe(true);
    expect(readyDemo.contextUsed.selectedRelationship, 'value-first-onboarding ac:4 After seeding self, work, and a relationship, `brainbase onboard:demo --scenario "<real request>" --format json` reports `ready: true` and produces an answer that uses the saved relationship context.').toMatchObject({
      person: 'Yamamoto Rikiya',
      role: 'CSO'
    });
    expect(readyDemo.answer, 'value-first-onboarding ac:4 After seeding self, work, and a relationship, `brainbase onboard:demo --scenario "<real request>" --format json` reports `ready: true` and produces an answer that uses the saved relationship context.').toContain('Owns CSO perspective');

    const status = JSON.parse(await cli(['doctor', '--dir', demoDir]));
    expect(status.valueDemo, 'value-first-onboarding ac:5 `doctor` exposes a `valueDemo` readiness block so onboarding completion is not reduced to connector setup.').toMatchObject({
      ready: true,
      missing: [],
      completionSignal: 'first_value_demo_ready'
    });

    const guidedDir = await tempDir();
    const guided = JSON.parse(await cli([
      'onboard:start',
      '--dir', guidedDir,
      '--target', 'codex',
      '--name', 'Owner',
      '--value', 'Do not re-explain the AI Dojo premise.',
      '--project', 'AI Dojo',
      '--goal', 'Prove Brainbase onboarding value',
      '--status', 'first run',
      '--role', 'owner',
      '--stakeholder', 'Yamamoto Rikiya|CSO|Owns CSO perspective for AI Dojo decisions.',
      '--format', 'json'
    ]));
    const guidedCommandIds = guided.nextCommands.map((item: { id: string }) => item.id);
    expect(guided.interview.map((section: { id: string }) => section.id), 'value-first-onboarding ac:1 primary `onboard:start` path asks value target before source setup.').toEqual([
      'value_target',
      'self',
      'project',
      'approval',
      'first_value_demo',
      'sources'
    ]);
    expect(guidedCommandIds.indexOf('first-value-demo'), 'value-first-onboarding ac:6 primary `onboard:start` path presents first value demo before source diagnosis or candidate files.').toBeLessThan(guidedCommandIds.indexOf('source-diagnosis'));
    expect(guided.nextCommands.find((item: { id: string }) => item.id === 'first-value-demo').command, 'value-first-onboarding ac:6 primary `onboard:start` path presents first value demo before source diagnosis or candidate files.').toContain('brainbase onboard:demo');
    expect(guided.nextCommands.find((item: { id: string }) => item.id === 'self-seed').command, 'value-first-onboarding ac:4 primary `onboard:start` path seeds relationship context before the first demo.').toContain('--relationship');

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
    expect(readme.indexOf('brainbase onboard:demo'), 'value-first-onboarding ac:6 README presents the first value demo before source diagnosis or candidate files.').toBeLessThan(readme.indexOf('brainbase onboard:diagnose-sources'));
  });
});
