import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-cli-'));
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

describe('onboarding CLI', () => {
  it('S-1 onboard:init creates the minimum files', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:init', '--dir', dir], output.io);

    expect(code).toBe(0);
    await expect(readFile(join(dir, 'graph.json'), 'utf8')).resolves.toContain('"version": 1');
    await expect(readFile(join(dir, 'personal-kg.jsonl'), 'utf8')).resolves.toBe('');
    await expect(access(join(dir, 'sources', 'gmail'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'calendar'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'drive'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sources', 'tasks'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'candidates'))).resolves.toBeUndefined();
    expect((await loadPersonalOs(dir)).sourceCount).toBe(0);
    expect(output.stdout()).toContain('Initialized');
  });

  it('S-2 onboard:seed updates self, work, and relationships', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:seed',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex'
    ], output.io);

    expect(code).toBe(0);
    const os = await loadPersonalOs(dir);
    expect(os.graph.owner?.name).toBe('Owner');
    expect(os.graph.entities.some((entity) => entity.name === 'MCP Onboarding')).toBe(true);
    expect(os.relationships.relationships[0]?.person).toBe('Otawara');
    expect(os.personalKg.some((entry) => entry.text === 'Local facts first')).toBe(true);
  });

  it('S-3 onboard:install --target codex --dry-run prints valid Codex TOML config', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('[mcp_servers.brainbase]');
    expect(output.stdout()).toContain(`[mcp_servers.brainbase.env]`);
    expect(output.stdout()).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(output.stdout()).toMatch(/args = \[".*src\/index\.js"\]/);
    expect(output.stdout()).toContain(`BRAINBASE_PERSONAL_OS_DIR = ${JSON.stringify(dir)}`);
  });

  it.each(['claude', 'codecode'])('S-3 onboard:install --target %s --dry-run prints valid MCP JSON config', async (target) => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', target, '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(0);
    const config = JSON.parse(output.stdout());
    expect(config.mcpServers.brainbase.command).toBe(process.execPath);
    expect(config.mcpServers.brainbase.args[0]).toMatch(/src\/index\.js$/);
    expect(config.mcpServers.brainbase.env.BRAINBASE_PERSONAL_OS_DIR).toBe(dir);
  });

  it('S-3 onboard:install writes a new snippet file and refuses to overwrite existing client config', async () => {
    const dir = await tempDir();
    const outputPath = join(dir, 'brainbase-codex-snippet.toml');
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], output.io);

    expect(code).toBe(0);
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('[mcp_servers.brainbase]');

    const second = capture();
    const secondCode = await runCli(['onboard:install', '--target', 'codex', '--dir', dir, '--output', outputPath], second.io);

    expect(secondCode).toBe(1);
    expect(second.stderr()).toContain('Refusing to overwrite existing MCP config snippet');
  });

  it('S-3 fails loudly for unsupported install targets', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:install', '--target', 'unknown', '--dir', dir, '--dry-run'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('onboard:install requires --target codex|claude|codecode');
  });

  it('S-9 onboard:agent --format json prints the Codex and Claude Code interview protocol', async () => {
    const output = capture();
    const code = await runCli(['onboard:agent', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const protocol = JSON.parse(output.stdout());
    expect(protocol.goal).toContain('Codex');
    expect(protocol.interviewSections.map((section: { id: string }) => section.id)).toEqual([
      'email',
      'calendar',
      'drive',
      'tasks',
      'projects',
      'permissions',
      'approval'
    ]);
    expect(protocol.safetyRules.join('\n')).toContain('Do not ask the user to paste OAuth tokens');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:recommend');
    expect(protocol.nextCommands.join('\n')).toContain('brainbase onboard:projects');
  });

  it('S-10 onboard:recommend maps Google tools to metadata-first GoG source staging', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:recommend',
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'notion',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const recommendations = JSON.parse(output.stdout()).recommendations;
    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'email',
        recommendation: expect.stringContaining('GoG Gmail'),
        sourcePath: 'sources/gmail/threads.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'calendar',
        recommendation: expect.stringContaining('GoG Google Calendar'),
        sourcePath: 'sources/calendar/events.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'drive',
        recommendation: expect.stringContaining('GoG Drive'),
        sourcePath: 'sources/drive/files.jsonl',
        importMode: 'metadata-first'
      }),
      expect.objectContaining({
        area: 'tasks',
        recommendation: expect.stringContaining('Notion'),
        sourcePath: 'sources/tasks/tasks.jsonl',
        importMode: 'export-first'
      })
    ]));
  });

  it('S-10 onboard:recommend handles no task tool deterministically', async () => {
    const output = capture();
    const code = await runCli(['onboard:recommend', '--tasks', 'none', '--format', 'json'], output.io);

    expect(code).toBe(0);
    const tasks = JSON.parse(output.stdout()).recommendations.find((recommendation: { area: string }) => recommendation.area === 'tasks');
    expect(tasks).toMatchObject({
      area: 'tasks',
      input: 'none',
      importMode: 'not-configured'
    });
  });

  it('S-11 onboard:diagnose-sources reports Google GoG readiness and Drive allowlists', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--tasks', 'notion',
      '--assume-gog',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const diagnostics = JSON.parse(output.stdout()).diagnostics;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        area: 'email',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/gmail/threads.jsonl'
      }),
      expect.objectContaining({
        area: 'calendar',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/calendar/events.jsonl'
      }),
      expect.objectContaining({
        area: 'drive',
        status: 'ready',
        collector: 'gog',
        importMode: 'metadata-first',
        sourcePath: 'sources/drive/files.jsonl'
      })
    ]));
    const drive = diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'drive');
    expect(drive.setupCommands.join('\n')).toContain('gog drive ls folder-123');
    expect(drive.safetyNotes.join('\n')).toContain('Do not scan the whole Drive by default');
  });

  it('S-12 onboard:diagnose-sources fails visibly when GoG is not available', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--gog-command', '__missing_brainbase_gog__',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const diagnostics = JSON.parse(output.stdout()).diagnostics;
    expect(diagnostics.filter((diagnostic: { collector: string; status: string }) => diagnostic.collector === 'gog').map((diagnostic: { status: string }) => diagnostic.status)).toEqual([
      'needs_setup',
      'needs_setup',
      'needs_setup'
    ]);
    expect(JSON.stringify(diagnostics)).toContain('Install or configure local GoG command');

    const markdown = capture();
    const markdownCode = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--email', 'gmail',
      '--drive', 'google-drive',
      '--gog-command', '__missing_brainbase_gog__'
    ], markdown.io);

    expect(markdownCode).toBe(0);
    expect(markdown.stdout()).toContain('# Brainbase Source Diagnosis');
    expect(markdown.stdout()).toContain('- Status: needs_setup');
    expect(markdown.stdout()).toContain('Install or configure local GoG command: __missing_brainbase_gog__');
    expect(markdown.stdout()).toContain('- Required user input:');
    expect(markdown.stdout()).toContain('- Setup commands:');
  });

  it('S-13 onboard:diagnose-sources requires a Drive folder allowlist even when GoG is ready', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--drive', 'google-drive',
      '--assume-gog',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const drive = JSON.parse(output.stdout()).diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'drive');
    expect(drive.status).toBe('needs_input');
    expect(drive.requiredUserInput.join('\n')).toContain('At least one allowed Google Drive folder id');

    const markdown = capture();
    const markdownCode = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--drive', 'google-drive',
      '--assume-gog'
    ], markdown.io);

    expect(markdownCode).toBe(0);
    expect(markdown.stdout()).toContain('- Status: needs_input');
    expect(markdown.stdout()).toContain('At least one allowed Google Drive folder id');
    expect(markdown.stdout()).toContain('gog drive ls <allowed-folder-id>');
  });

  it.each(['notion', 'todoist', 'linear', 'github-issues', 'nocodb', 'csv', 'none'])('S-14 onboard:diagnose-sources maps task source %s deterministically', async (taskInput) => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:diagnose-sources',
      '--dir', dir,
      '--tasks', taskInput,
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const tasks = JSON.parse(output.stdout()).diagnostics.find((diagnostic: { area: string }) => diagnostic.area === 'tasks');
    expect(tasks).toMatchObject({
      area: 'tasks',
      input: taskInput,
      sourcePath: 'sources/tasks/tasks.jsonl'
    });
    expect(JSON.stringify(tasks)).toContain('Do not paste secrets');
  });

  it('S-15 onboard:candidates writes review candidates without canonical SSOT writes', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli([
      'onboard:candidates',
      '--dir', dir,
      '--name', 'Owner',
      '--value', 'Local facts first',
      '--project', 'MCP Onboarding',
      '--relationship', 'Otawara|partner|Needs local MCP from Codex',
      '--decision-principle', 'Promote only reviewed candidates',
      '--write',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const candidateSet = JSON.parse(output.stdout());
    expect(candidateSet.canonicalWrites).toBe(false);
    expect(candidateSet.candidates.map((candidate: { kind: string }) => candidate.kind)).toEqual([
      'self',
      'value',
      'project',
      'decision',
      'relationship'
    ]);
    await expect(readFile(candidateSet.candidatePath, 'utf8')).resolves.toContain('Otawara');

    const os = await loadPersonalOs(dir);
    expect(os.graph.entities).toHaveLength(0);
    expect(os.personalKg).toHaveLength(0);
    expect(os.relationships.relationships).toHaveLength(0);

    const doctorOutput = capture();
    const doctorCode = await runCli(['doctor', '--dir', dir], doctorOutput.io);
    expect(doctorCode).toBe(0);
    expect(JSON.parse(doctorOutput.stdout()).missing).toEqual(['self', 'work', 'relationships']);
  });

  it('S-16 onboard:plan maps Google Workspace local answers into a no-write setup plan', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:plan',
      '--profile', 'google-workspace-local',
      '--host', 'mac-mini',
      '--email', 'google-workspace',
      '--secondary-email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--drive-folder', 'folder-123',
      '--local-folder', '/Users/owner/Notes',
      '--tasks', 'scattered-calendar-notes',
      '--inactive-task-tool', 'notion',
      '--format', 'json'
    ], output.io);

    expect(code).toBe(0);
    const plan = JSON.parse(output.stdout());
    expect(plan.profile).toBe('google-workspace-local');
    expect(plan.canonicalWrites).toBe(false);
    expect(plan.host).toMatchObject({
      input: 'mac-mini',
      role: expect.stringContaining('local Brainbase MCP runtime host')
    });
    expect(plan.host.boundary).toContain('not a hosted backend');
    expect(plan.safetyRules.join('\n')).toContain('bb.unson.jp sync are out of scope');

    const email = plan.sources.find((source: { area: string }) => source.area === 'email');
    expect(email).toMatchObject({
      collector: 'gog gmail',
      importMode: 'metadata-first',
      sourcePath: 'sources/gmail/threads.jsonl'
    });
    expect(email.accounts).toEqual(['<google-workspace-account>', '<gmail-account>']);

    const drive = plan.sources.find((source: { area: string }) => source.area === 'drive');
    expect(drive.allowlists).toEqual(['folder-123']);
    expect(drive.notes.join('\n')).toContain('Do not scan the whole Drive');

    const localFiles = plan.sources.find((source: { area: string }) => source.area === 'local_files');
    expect(localFiles.allowlists).toEqual(['/Users/owner/Notes']);
    expect(localFiles.notes.join('\n')).toContain('Do not scan the full home directory');

    const tasks = plan.sources.find((source: { area: string }) => source.area === 'tasks');
    expect(tasks.collector).toBe('calendar-and-notes-candidates');
    expect(tasks.notes.join('\n')).toContain('Inactive task tools: notion');
    expect(tasks.notes.join('\n')).toContain('candidate inputs');

    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:diagnose-sources');
    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:candidates');
    expect(plan.nextCommands.join('\n')).toContain('brainbase onboard:install');
    expect(plan.nextCommands.join('\n')).toContain('brainbase doctor');
  });

  it('S-17 onboard:plan markdown surfaces missing Drive and local allowlists', async () => {
    const output = capture();
    const code = await runCli([
      'onboard:plan',
      '--profile', 'google-workspace-local',
      '--host', 'mac-mini',
      '--email', 'google-workspace',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'scattered-calendar-notes',
      '--inactive-task-tool', 'notion'
    ], output.io);

    expect(code).toBe(0);
    expect(output.stdout()).toContain('# Brainbase Local Onboarding Plan');
    expect(output.stdout()).toContain('- Input: mac-mini');
    expect(output.stdout()).toContain('not a hosted backend');
    expect(output.stdout()).toContain('At least one allowed Google Drive folder id');
    expect(output.stdout()).toContain('At least one allowed local folder for notes or work files');
    expect(output.stdout()).toContain('Allowed local notes folder if notes should be included');
    expect(output.stdout()).toContain('Inactive task tools: notion');
    expect(output.stdout()).toContain('gog drive ls --parent <allowed-google-drive-folder-id>');
  });

  it('S-2 fails loudly for malformed relationship seeds', async () => {
    const dir = await tempDir();
    const output = capture();
    const code = await runCli(['onboard:seed', '--dir', dir, '--relationship', 'Otawara||'], output.io);

    expect(code).toBe(1);
    expect(output.stderr()).toContain('relationship must be');
  });
});
