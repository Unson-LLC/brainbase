import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadPersonalOs } from '../../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-source-diagnosis-'));
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

describe('source diagnosis and candidate onboarding acceptance', () => {
  it('covers the Story acceptance criteria for source diagnosis and candidate onboarding', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme, 'source-diagnosis-candidates-onboarding ac:1 README explains that the coding agent should run an interview, source diagnosis, candidate drafting, and only then canonical seed promotion.').toContain('diagnose the local source setup');
    expect(readme, 'source-diagnosis-candidates-onboarding ac:1 README explains that the coding agent should run an interview, source diagnosis, candidate drafting, and only then canonical seed promotion.').toContain('Review candidates with the user, then promote only approved facts');

    const dir = await tempDir();
    const diagnosis = JSON.parse(await cli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--tasks', 'notion',
      '--assume-gog',
      '--format', 'json'
    ]));
    expect(diagnosis.diagnostics.map((item: { area: string }) => item.area), 'source-diagnosis-candidates-onboarding ac:2 `brainbase onboard:diagnose-sources` accepts `--email`, `--calendar`, `--drive`, and `--tasks` answers and returns provider-specific local readiness.').toEqual([
      'email',
      'calendar',
      'drive',
      'tasks'
    ]);
    expect(diagnosis.diagnostics, 'source-diagnosis-candidates-onboarding ac:3 Gmail, Google Calendar, and Google Drive diagnosis requires GoG-style metadata-first collection; Drive diagnosis requires an explicit folder allowlist.').toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'email', collector: 'gog', status: 'ready', importMode: 'metadata-first' }),
      expect.objectContaining({ area: 'calendar', collector: 'gog', status: 'ready', importMode: 'metadata-first' }),
      expect.objectContaining({ area: 'drive', collector: 'gog', status: 'ready', importMode: 'metadata-first' })
    ]));
    expect(JSON.stringify(diagnosis), 'source-diagnosis-candidates-onboarding ac:3 Gmail, Google Calendar, and Google Drive diagnosis requires GoG-style metadata-first collection; Drive diagnosis requires an explicit folder allowlist.').toContain('gog drive ls folder-123');

    const missingGog = JSON.parse(await cli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--gog-command', '__missing_brainbase_gog__',
      '--format', 'json'
    ]));
    expect(missingGog.diagnostics.filter((item: { collector: string }) => item.collector === 'gog').map((item: { status: string }) => item.status), 'source-diagnosis-candidates-onboarding ac:4 Missing local GoG tooling is reported as `needs_setup`, not as a successful import path.').toEqual([
      'needs_setup',
      'needs_setup',
      'needs_setup'
    ]);

    for (const taskInput of ['notion', 'todoist', 'linear', 'github-issues', 'nocodb', 'csv', 'none']) {
      const taskDiagnosis = JSON.parse(await cli([
        'onboard:diagnose-sources',
        '--dir', dir,
        '--tasks', taskInput,
        '--format', 'json'
      ])).diagnostics.find((item: { area: string }) => item.area === 'tasks');
      expect(JSON.stringify(taskDiagnosis), `source-diagnosis-candidates-onboarding ac:5 Task diagnosis covers Notion, Todoist, Linear, GitHub Issues, NocoDB, CSV/manual, and \`none\` without asking for secrets in chat. ${taskInput} is deterministic.`).toContain('Do not paste secrets');
      expect(taskDiagnosis.sourcePath).toBe('sources/tasks/tasks.jsonl');
    }

    const candidatesJson = JSON.parse(await cli([
      'onboard:candidates',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex',
      '--decision-principle', 'Promote only reviewed candidates',
      '--write',
      '--format', 'json'
    ]));
    expect(candidatesJson.canonicalWrites, 'source-diagnosis-candidates-onboarding ac:6 `brainbase onboard:candidates` turns agent interview answers into candidate records under `candidates/` without writing canonical SSOT files.').toBe(false);
    await expect(access(candidatesJson.candidatePath), 'source-diagnosis-candidates-onboarding ac:6 `brainbase onboard:candidates` turns agent interview answers into candidate records under `candidates/` without writing canonical SSOT files.').resolves.toBeUndefined();
    expect(candidatesJson.nextCommands.join('\n'), 'source-diagnosis-candidates-onboarding ac:7 Candidate output supports markdown and JSON and includes explicit review/promote next steps.').toContain('Review the candidate file');
    const candidatesMarkdown = await cli(['onboard:candidates', '--dir', dir, '--name', 'Owner']);
    expect(candidatesMarkdown, 'source-diagnosis-candidates-onboarding ac:7 Candidate output supports markdown and JSON and includes explicit review/promote next steps.').toContain('# Brainbase Onboarding Candidates');

    const os = await loadPersonalOs(dir);
    expect(os.graph.entities, 'source-diagnosis-candidates-onboarding ac:8 `brainbase doctor` still reports missing canonical seed areas until the user promotes candidates with `onboard:seed` or an equivalent reviewed flow.').toHaveLength(0);
    const doctor = JSON.parse(await cli(['doctor', '--dir', dir]));
    expect(doctor.missing, 'source-diagnosis-candidates-onboarding ac:8 `brainbase doctor` still reports missing canonical seed areas until the user promotes candidates with `onboard:seed` or an equivalent reviewed flow.').toEqual(['self', 'work', 'relationships']);
  });
});
