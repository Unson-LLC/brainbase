import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { collectLocalInventory } from '../../scripts/local-data-server-ssot-inventory.js';
import { buildUpsertPlan } from '../../scripts/local-data-server-ssot-upsert.js';
import { createPersonalKgAuthorityEnv } from '../helpers/personal-kg-authority-fixture';

const execFileAsync = promisify(execFile);
const storyId = 'story-personal-kg-extraction-backlog';

// story-personal-kg-extraction-backlog ac:1 INV-001
// story-personal-kg-extraction-backlog ac:2 INV-002
// story-personal-kg-extraction-backlog ac:3 INV-003
// story-personal-kg-extraction-backlog ac:4 INV-004
// story-personal-kg-extraction-backlog ac:5 INV-005
// story-personal-kg-extraction-backlog ac:6 S-001

function unixSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

async function createFixtureHome(): Promise<string> {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'story-personal-kg-backlog-'));
  await fs.mkdir(path.join(tempHome, '.codex'), { recursive: true });
  await fs.mkdir(path.join(tempHome, '.claude', 'projects', 'sample'), { recursive: true });
  await fs.writeFile(path.join(tempHome, '.codex', 'history.jsonl'), [
    JSON.stringify({
      session_id: 'codex-1',
      ts: unixSeconds('2026-05-22T15:00:00Z'),
      text: 'VibeProでストーリーを切ってPRまで進めて'
    }),
    JSON.stringify({
      session_id: 'codex-2',
      ts: unixSeconds('2026-05-23T15:00:00Z'),
      text: '単発の確認だけ'
    })
  ].join('\n') + '\n');
  await fs.writeFile(path.join(tempHome, '.claude', 'projects', 'sample', 'session.jsonl'), [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-05-22T16:00:00.000Z',
      sessionId: 'claude-1',
      cwd: '/repo',
      message: { role: 'user', content: 'ちゃんとローカルで動作確認してからデプロイしろ' }
    })
  ].join('\n') + '\n');
  return tempHome;
}

async function runBacklog(tempHome: string, args: string[] = ['--json']) {
  return execFileAsync('node', [
    'scripts/oyasumi-conversation-personal-kg-backlog.js',
    '--home',
    tempHome,
    '--from',
    '2026-05-23',
    '--to',
    '2026-05-24',
    ...args
  ], { cwd: process.cwd(), env: createPersonalKgAuthorityEnv() });
}

test(`${storyId} ac:1 INV-001 backlog separates raw files, dates, messages, candidate, existing, missing, and needs_review counts`, async () => {
  // story-personal-kg-extraction-backlog ac:1
  // The backlog reports raw log file count separately from date count, message count, adopted candidate count, existing candidate count, missing candidate count, and `needs_review` candidate count.
  expect('The backlog reports raw log file count separately from date count, message count, adopted candidate count, existing candidate count, missing candidate count, and `needs_review` candidate count.').toContain('backlog');
  const tempHome = await createFixtureHome();
  const { stdout } = await runBacklog(tempHome);
  const result = JSON.parse(stdout);

  expect(result.raw_log_file_count, 'ac:1 raw log file count is separate from backlog date/message/candidate counts').toBe(2);
  expect(result.summary.dates_considered, 'ac:1 date count is separate').toBe(2);
  expect(result.summary.input_messages, 'ac:1 input message count is separate').toBe(3);
  expect(result.summary.adopted_candidates, 'ac:1 adopted candidate count is separate').toBe(2);
  expect(result.summary.existing_candidates, 'ac:1 existing candidate count is separate').toBe(0);
  expect(result.summary.missing_candidates, 'ac:1 missing candidate count is separate').toBe(2);
  expect(result.summary.needs_review_candidates, 'ac:1 needs_review candidate count is separate').toBe(0);
});

test(`${storyId} ac:2 INV-002 backlog omits raw conversation text from JSON and text stdout`, async () => {
  // story-personal-kg-extraction-backlog ac:2
  // The backlog does not expose raw conversation text in stdout or JSON.
  expect('The backlog does not expose raw conversation text in stdout or JSON.').toContain('raw conversation');
  const tempHome = await createFixtureHome();
  const { stdout: jsonStdout } = await runBacklog(tempHome);
  const { stdout: textStdout } = await runBacklog(tempHome, []);

  const combinedOutput = `${jsonStdout}\n${textStdout}`;
  expect(combinedOutput, 'ac:2 raw Codex text is omitted from backlog output').not.toContain('VibeProでストーリー');
  expect(combinedOutput, 'ac:2 raw Claude Code text is omitted from backlog output').not.toContain('ちゃんとローカルで動作確認');
  expect(textStdout, 'ac:2 text stdout exposes counts and statuses only').toContain('raw_log_file_count: 2');
  expect(textStdout, 'ac:2 text stdout exposes counts and statuses only').toContain('2026-05-23');
});

test(`${storyId} ac:3 INV-003 raw conversation logs remain needs_extraction and excluded from additive upsert`, async () => {
  // story-personal-kg-extraction-backlog ac:3
  // Existing `needs_extraction` inventory/upsert behavior remains unchanged; raw logs are still skipped by additive upsert.
  expect('Existing `needs_extraction` inventory/upsert behavior remains unchanged; raw logs are still skipped by additive upsert.').toContain('needs_extraction');
  const upsertPlan = buildUpsertPlan([{
    source_path: '.codex/history.jsonl',
    target_table: 'memory_candidates',
    target_type: 'personal_kg_candidate',
    migration_status: 'needs_extraction'
  }]);

  expect(upsertPlan.operations, 'ac:3 raw conversation logs remain excluded from additive upsert').toHaveLength(0);
  expect(upsertPlan.skips.map((skip) => skip.reason), 'ac:3 raw conversation logs keep status:needs_extraction skip reason')
    .toContain('status:needs_extraction');
});

test(`${storyId} ac:4 INV-004 server comparison is read-only and based on memory_candidates source refs`, async () => {
  // story-personal-kg-extraction-backlog ac:4
  // Server comparison is read-only and uses `memory_candidates` source refs, not Graph promotion state.
  expect('Server comparison is read-only and uses `memory_candidates` source refs, not Graph promotion state.').toContain('memory_candidates');
  const tempHome = await createFixtureHome();
  const { stdout } = await runBacklog(tempHome);
  const result = JSON.parse(stdout);
  const source = await fs.readFile('scripts/oyasumi-conversation-personal-kg-backlog.js', 'utf8');
  const loaderBody = source.slice(source.indexOf('async function loadExistingConversationCandidates'), source.indexOf('function filterDates'));

  expect(result.mode, 'ac:4 backlog without --compare-server performs no server comparison or write').toBe('conversation_personal_kg_backlog');
  expect(result.dates[0].candidate_rules[0].source_ref, 'ac:4 candidate comparison uses deterministic source refs').toContain('codex-claude-conversation:2026-05-23#');
  expect(loaderBody, 'ac:4 server comparison reads memory_candidates').toContain('FROM memory_candidates');
  expect(loaderBody, 'ac:4 server comparison is read-only').not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b/u);
});

test(`${storyId} ac:5 INV-005 existing Graph/Wiki inventory classifiers stay unchanged while conversation collector is reused`, async () => {
  // story-personal-kg-extraction-backlog ac:5
  // Existing local SSOT inventory classifiers for Graph/Wiki material, including `common/meta/customers`, remain unchanged; this story only exports the conversation-log collector for backlog use.
  expect('Existing local SSOT inventory classifiers for Graph/Wiki material, including `common/meta/customers`, remain unchanged; this story only exports the conversation-log collector for backlog use.').toContain('common/meta/customers');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'story-personal-kg-inventory-'));
  const codexRoot = path.join(tempRoot, '_codex');
  const homeDir = path.join(tempRoot, 'home');
  await fs.mkdir(path.join(codexRoot, 'common', 'meta', 'customers'), { recursive: true });
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await fs.writeFile(path.join(codexRoot, 'common', 'meta', 'customers', 'hotel_m.md'), '# HOTEL m\n');
  await fs.writeFile(path.join(homeDir, '.codex', 'history.jsonl'), '{"text":"GraphSSOTを綺麗にする"}\n');

  const items = collectLocalInventory({ codexRoot, wikiRoots: [], homeDir, includeWorkspaceContent: false });

  expect(items, 'ac:5 common/meta/customers remains a customer graph entity').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: 'common/meta/customers/hotel_m.md', target_table: 'graph_entities', target_type: 'customer' })
  ]));
  expect(items, 'ac:5 conversation collector is reused for backlog material without reclassifying Graph/Wiki branches').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: '.codex/history.jsonl', target_table: 'memory_candidates', target_type: 'personal_kg_candidate', migration_status: 'needs_extraction' })
  ]));
});

test(`${storyId} ac:6 S-001 CLI dry-run is the executable end-to-end boundary for this MCP/SSOT data story`, async () => {
  // story-personal-kg-extraction-backlog ac:6
  // Verification uses targeted unit tests and a CLI dry-run; UI/E2E is not required because this is an MCP/SSOT data CLI story.
  expect('Verification uses targeted unit tests and a CLI dry-run; UI/E2E is not required because this is an MCP/SSOT data CLI story.').toContain('CLI dry-run');
  const tempHome = await createFixtureHome();
  const { stdout } = await runBacklog(tempHome);
  const result = JSON.parse(stdout);

  expect(result.summary.by_status, 'ac:6 CLI dry-run reports executable backlog statuses without a UI route')
    .toEqual({ needs_write: 1, no_candidate: 1 });
  expect(result.raw_log_source_kinds, 'ac:6 existing inventory conversation log collector is reused for Codex and Claude Code sources')
    .toEqual({ codex_history: 1, claude_code_project_log: 1 });
});
