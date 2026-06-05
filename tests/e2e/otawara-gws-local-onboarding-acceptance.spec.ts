import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';

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

describe('Otawara Google Workspace local onboarding acceptance', () => {
  it('covers the Story acceptance criteria for Google Workspace local planning', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme, 'otawara-gws-local-onboarding ac:1 README includes a Google Workspace local onboarding example for an always-on Mac mini, Workspace mail/calendar/drive, a secondary Gmail account, local files, and scattered Calendar/notes tasks.').toContain('Google Workspace local-first adopter');
    expect(readme, 'otawara-gws-local-onboarding ac:1 README includes a Google Workspace local onboarding example for an always-on Mac mini, Workspace mail/calendar/drive, a secondary Gmail account, local files, and scattered Calendar/notes tasks.').toContain('--host mac-mini');
    expect(readme, 'otawara-gws-local-onboarding ac:1 README includes a Google Workspace local onboarding example for an always-on Mac mini, Workspace mail/calendar/drive, a secondary Gmail account, local files, and scattered Calendar/notes tasks.').toContain('--tasks scattered-calendar-notes');

    const plan = JSON.parse(await cli([
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
    ]));

    expect(plan.profile, 'otawara-gws-local-onboarding ac:2 `brainbase onboard:plan` accepts `--profile google-workspace-local`, `--host`, `--email`, `--secondary-email`, `--calendar`, `--drive`, `--drive-folder`, `--local-folder`, `--tasks`, and `--inactive-task-tool`.').toBe('google-workspace-local');
    expect(plan.host.input, 'otawara-gws-local-onboarding ac:2 `brainbase onboard:plan` accepts `--profile google-workspace-local`, `--host`, `--email`, `--secondary-email`, `--calendar`, `--drive`, `--drive-folder`, `--local-folder`, `--tasks`, and `--inactive-task-tool`.').toBe('mac-mini');
    expect(JSON.stringify(plan), 'otawara-gws-local-onboarding ac:2 `brainbase onboard:plan` accepts `--profile google-workspace-local`, `--host`, `--email`, `--secondary-email`, `--calendar`, `--drive`, `--drive-folder`, `--local-folder`, `--tasks`, and `--inactive-task-tool`.').toContain('scattered-calendar-notes');

    expect(plan.host.role, 'otawara-gws-local-onboarding ac:3 The plan separates a local SSH runtime host from hosted backend/server operations and states that hosted sync remains out of scope.').toContain('local Brainbase MCP runtime host');
    expect(plan.host.boundary, 'otawara-gws-local-onboarding ac:3 The plan separates a local SSH runtime host from hosted backend/server operations and states that hosted sync remains out of scope.').toContain('not a hosted backend');
    expect(plan.safetyRules.join('\n'), 'otawara-gws-local-onboarding ac:3 The plan separates a local SSH runtime host from hosted backend/server operations and states that hosted sync remains out of scope.').toContain('bb.unson.jp sync are out of scope');

    const email = plan.sources.find((source: { area: string }) => source.area === 'email');
    const calendar = plan.sources.find((source: { area: string }) => source.area === 'calendar');
    const drive = plan.sources.find((source: { area: string }) => source.area === 'drive');
    expect(email.collector, 'otawara-gws-local-onboarding ac:4 Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.').toBe('gog gmail');
    expect(email.importMode, 'otawara-gws-local-onboarding ac:4 Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.').toBe('metadata-first');
    expect(email.accounts, 'otawara-gws-local-onboarding ac:4 Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.').toEqual(['<google-workspace-account>', '<gmail-account>']);
    expect(calendar.collector, 'otawara-gws-local-onboarding ac:4 Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.').toBe('gog calendar');
    expect(drive.collector, 'otawara-gws-local-onboarding ac:4 Google Workspace mail, secondary Gmail, Google Calendar, and Google Drive are mapped to metadata-first read-only GoG collection steps.').toBe('gog drive');

    const localFiles = plan.sources.find((source: { area: string }) => source.area === 'local_files');
    expect(drive.allowlists, 'otawara-gws-local-onboarding ac:5 Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.').toEqual(['folder-123']);
    expect(drive.notes.join('\n'), 'otawara-gws-local-onboarding ac:5 Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.').toContain('Do not scan the whole Drive');
    expect(localFiles.allowlists, 'otawara-gws-local-onboarding ac:5 Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.').toEqual(['/Users/owner/Notes']);
    expect(localFiles.notes.join('\n'), 'otawara-gws-local-onboarding ac:5 Google Drive and local file collection require explicit allowlists and must not recommend scanning all Drive or the full home directory.').toContain('Do not scan the full home directory');

    const tasks = plan.sources.find((source: { area: string }) => source.area === 'tasks');
    expect(tasks.collector, 'otawara-gws-local-onboarding ac:6 Scattered tasks in Google Calendar and local notes are treated as candidate extraction inputs, while abandoned Notion is marked inactive and not used as a required connector.').toBe('calendar-and-notes-candidates');
    expect(tasks.notes.join('\n'), 'otawara-gws-local-onboarding ac:6 Scattered tasks in Google Calendar and local notes are treated as candidate extraction inputs, while abandoned Notion is marked inactive and not used as a required connector.').toContain('Inactive task tools: notion');
    expect(tasks.notes.join('\n'), 'otawara-gws-local-onboarding ac:6 Scattered tasks in Google Calendar and local notes are treated as candidate extraction inputs, while abandoned Notion is marked inactive and not used as a required connector.').toContain('candidate inputs');

    expect(plan.nextCommands.join('\n'), 'otawara-gws-local-onboarding ac:7 The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.').toContain('brainbase onboard:diagnose-sources');
    expect(plan.nextCommands.join('\n'), 'otawara-gws-local-onboarding ac:7 The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.').toContain('brainbase onboard:candidates');
    expect(plan.nextCommands.join('\n'), 'otawara-gws-local-onboarding ac:7 The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.').toContain('brainbase onboard:install');
    expect(plan.nextCommands.join('\n'), 'otawara-gws-local-onboarding ac:7 The plan includes next commands for `onboard:diagnose-sources`, `onboard:candidates`, `onboard:install`, and `doctor`.').toContain('brainbase doctor');

    const markdown = await cli([
      'onboard:plan',
      '--profile', 'google-workspace-local',
      '--host', 'mac-mini',
      '--email', 'google-workspace',
      '--secondary-email', 'gmail',
      '--calendar', 'google-calendar',
      '--drive', 'google-drive',
      '--tasks', 'scattered-calendar-notes',
      '--inactive-task-tool', 'notion'
    ]);
    expect(plan.canonicalWrites, 'otawara-gws-local-onboarding ac:8 JSON and markdown output are deterministic and do not write canonical SSOT files.').toBe(false);
    expect(markdown, 'otawara-gws-local-onboarding ac:8 JSON and markdown output are deterministic and do not write canonical SSOT files.').toContain('# Brainbase Local Onboarding Plan');
    expect(markdown, 'otawara-gws-local-onboarding ac:8 JSON and markdown output are deterministic and do not write canonical SSOT files.').toContain('- Canonical writes: false');
  });
});

