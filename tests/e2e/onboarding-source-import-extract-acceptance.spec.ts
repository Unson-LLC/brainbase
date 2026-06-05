import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadPersonalOs } from '../../src/ssot.js';
import { getContext, searchAll } from '../../src/tools.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-ie-'));
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

const gmailFixture = JSON.stringify([
  {
    id: 'm1',
    threadId: 't1',
    from: { email: 'otawara@cursorvers.com', name: '大田原正幸' },
    to: [{ email: 'k.sato.unson@gmail.com', name: '佐藤圭吾' }],
    subject: 'Re: brainbaseご提案',
    date: '2026-06-05',
    labelIds: ['INBOX'],
    snippet: 'ありがとうございます',
    body: 'SECRET BODY MUST NOT LEAK'
  },
  {
    id: 'm2',
    from: '大田原正幸 <otawara@cursorvers.com>',
    to: 'k.sato.unson@gmail.com',
    subject: '契約書の確認をお願いします',
    snippet: '確認ください'
  }
]);

const calendarFixture = JSON.stringify({
  events: [
    {
      id: 'e1',
      summary: 'Cursorvers AI駆動経営 定例',
      start: { dateTime: '2026-06-06T10:00:00+09:00' },
      organizer: { email: 'otawara@cursorvers.com', displayName: '大田原正幸' },
      attendees: [{ email: 'k.sato.unson@gmail.com' }],
      description: 'PRIVATE EVENT NOTES MUST NOT LEAK'
    },
    {
      id: 'e2',
      summary: 'Cursorvers AI駆動経営 定例',
      start: { dateTime: '2026-06-13T10:00:00+09:00' },
      attendees: [{ email: 'otawara@cursorvers.com' }]
    }
  ]
});

const driveFixture = JSON.stringify({
  files: [
    { id: 'f1', name: 'Cursorvers提案書', mimeType: 'application/vnd.google-apps.document', owners: [{ emailAddress: 'otawara@cursorvers.com', displayName: '大田原正幸' }], parents: ['folder-1'] }
  ]
});

const localFixture = JSON.stringify([
  { path: '/Users/otawara/Notes/todo.md', title: 'todo', excerpt: '- [ ] 契約書を送付する\nメモ: 雑談' }
]);

describe('Onboarding source import and candidate extraction acceptance', () => {
  it('covers every Story acceptance criterion through the real import->extract->apply loop', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'personal-os');
    await runCli(['onboard:init', '--dir', dataDir], capture().io);

    const gmailPath = join(dir, 'gmail.json');
    const calendarPath = join(dir, 'calendar.json');
    const drivePath = join(dir, 'drive.json');
    const localPath = join(dir, 'local.json');
    await writeFile(gmailPath, gmailFixture);
    await writeFile(calendarPath, calendarFixture);
    await writeFile(drivePath, driveFixture);
    await writeFile(localPath, localFixture);

    // ac:1 import normalizes provider JSON into sources/<provider>/*.jsonl
    const importGmail = JSON.parse(await cli(['onboard:import', '--source', 'gmail', '--from', gmailPath, '--dir', dataDir, '--format', 'json']));
    expect(importGmail.sourcePath, 'onboarding-source-import-extract ac:1 onboard:import normalizes provider JSON from gog output or an export file into metadata-first records under the matching sources/<provider>/*.jsonl path.').toContain('sources/gmail/threads.jsonl');
    expect(importGmail.count, 'onboarding-source-import-extract ac:1 onboard:import normalizes provider JSON into metadata-first records under sources/<provider>/*.jsonl.').toBe(2);
    await cli(['onboard:import', '--source', 'calendar', '--from', calendarPath, '--dir', dataDir]);
    await cli(['onboard:import', '--source', 'drive', '--from', drivePath, '--dir', dataDir]);
    await cli(['onboard:import', '--source', 'local', '--from', localPath, '--dir', dataDir]);

    // ac:2 import is metadata-first: no bodies/full descriptions/file contents
    const gmailSource = await readFile(join(dataDir, 'sources/gmail/threads.jsonl'), 'utf8');
    const calendarSource = await readFile(join(dataDir, 'sources/calendar/events.jsonl'), 'utf8');
    expect(gmailSource, 'onboarding-source-import-extract ac:2 Import is metadata-first: it keeps participants, subjects, dates, labels, folders, and snippets, and never copies full mail bodies into sources/.').not.toContain('SECRET BODY MUST NOT LEAK');
    expect(calendarSource, 'onboarding-source-import-extract ac:2 Import is metadata-first and never copies full event descriptions into sources/.').not.toContain('PRIVATE EVENT NOTES MUST NOT LEAK');

    // ac:3 extract reads sources and writes reviewable candidate set with provenance counts
    const extracted = JSON.parse(await cli(['onboard:extract', '--dir', dataDir, '--self-email', 'k.sato.unson@gmail.com', '--write', '--format', 'json']));
    const kinds = new Set(extracted.candidates.map((candidate: { kind: string }) => candidate.kind));
    expect(kinds.has('person') && kinds.has('org') && kinds.has('project') && kinds.has('relationship'), 'onboarding-source-import-extract ac:3 onboard:extract reads existing sources/*.jsonl and writes a reviewable candidate set under candidates/ containing person, org, project, relationship, and next-action candidates with provenance counts.').toBe(true);
    expect(extracted.candidates[0].provenance.count, 'onboarding-source-import-extract ac:3 candidate set contains provenance counts.').toBeGreaterThanOrEqual(1);

    // ac:4 extraction is deterministic and heuristic
    const extractedAgain = JSON.parse(await cli(['onboard:extract', '--dir', dataDir, '--self-email', 'k.sato.unson@gmail.com', '--format', 'json']));
    expect(JSON.stringify(extractedAgain.candidates), 'onboarding-source-import-extract ac:4 Extraction is deterministic: the same sources/ input always yields the same candidate set using code heuristics rather than model judgment.').toBe(JSON.stringify(extracted.candidates));

    // ac:6 apply refuses unselected and supports --select allowlist; ac:5 dry-run by default
    const personId = extracted.candidates.find((candidate: { kind: string }) => candidate.kind === 'person').id;
    const dryRun = JSON.parse(await cli(['onboard:apply', '--from', extracted.candidatePath, '--dir', dataDir, '--select', personId, '--format', 'json']));
    expect(dryRun.canonicalWrites, 'onboarding-source-import-extract ac:5 onboard:apply is dry-run by default; canonical files change only with --write.').toBe(false);
    expect(dryRun.applied.map((item: { id: string }) => item.id), 'onboarding-source-import-extract ac:6 onboard:apply supports --select allowlists and refuses to promote anything that is not explicitly selected.').toEqual([personId]);
    const afterDryRun = await loadPersonalOs(dataDir);
    expect(afterDryRun.graph.entities.length, 'onboarding-source-import-extract ac:5 without --write the command is a dry-run that changes no canonical file.').toBe(0);

    // ac:5 apply with --write promotes into canonical SSOT
    await cli(['onboard:apply', '--from', extracted.candidatePath, '--dir', dataDir, '--all', '--write']);
    const os = await loadPersonalOs(dataDir);
    expect(os.graph.entities.some((entity) => entity.name === '大田原正幸'), 'onboarding-source-import-extract ac:5 onboard:apply promotes selected candidates into graph.json, personal-kg.jsonl, relationships.json, and decisions.jsonl with --write.').toBe(true);
    expect(os.relationships.relationships.length, 'onboarding-source-import-extract ac:5 onboard:apply promotes relationship candidates into relationships.json.').toBeGreaterThanOrEqual(1);

    // ac:7 doctor reflects imported sources and applied canonical entities
    const doctor = JSON.parse(await cli(['doctor', '--dir', dataDir]));
    expect(doctor.counts.rawSources, 'onboarding-source-import-extract ac:7 doctor reflects imported raw sources after the loop runs.').toBeGreaterThanOrEqual(4);
    expect(doctor.counts.graphEntities, 'onboarding-source-import-extract ac:7 doctor reflects applied canonical entities after the loop runs.').toBeGreaterThanOrEqual(3);

    // ac:8 get_context and search return canonical entities through MCP tooling
    const context = getContext(os);
    expect(JSON.stringify(context.relationships), 'onboarding-source-import-extract ac:8 running import -> extract -> apply produces canonical entities that get_context can return through MCP.').toContain('大田原正幸');
    const search = searchAll(os, '大田原', 5);
    expect(search.some((result) => result.title === '大田原正幸'), 'onboarding-source-import-extract ac:8 running import -> extract -> apply produces canonical entities that search can return through MCP.').toBe(true);
  });

  it('ac:9 import and extract never write canonical SSOT files', async () => {
    const dir = await tempDir();
    const dataDir = join(dir, 'personal-os');
    await runCli(['onboard:init', '--dir', dataDir], capture().io);
    const gmailPath = join(dir, 'gmail.json');
    await writeFile(gmailPath, gmailFixture);

    await cli(['onboard:import', '--source', 'gmail', '--from', gmailPath, '--dir', dataDir]);
    await cli(['onboard:extract', '--dir', dataDir, '--self-email', 'k.sato.unson@gmail.com', '--write']);

    const os = await loadPersonalOs(dataDir);
    expect(os.graph.entities.length, 'onboarding-source-import-extract ac:9 import/extract never write canonical SSOT files; only apply --write changes canonical state.').toBe(0);
    expect(os.relationships.relationships.length, 'onboarding-source-import-extract ac:9 import/extract never write canonical SSOT files.').toBe(0);
    expect(os.personalKg.length, 'onboarding-source-import-extract ac:9 import/extract never write canonical SSOT files.').toBe(0);
  });
});
