import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fixtureRoot = path.resolve('tests/fixtures/local-ssot-upsert');
const codexRoot = path.join(fixtureRoot, '_codex');
const wikiRoot = path.join(fixtureRoot, 'wiki');
const homeDir = path.join(fixtureRoot, 'home');
const serverIndexPath = path.join(fixtureRoot, 'server-index.json');

function expectCommandToFail(command: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    execFileSync(command[0], command.slice(1), {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...env }
    });
  } catch (error) {
    return String((error as { stderr?: Buffer | string }).stderr || '');
  }
  throw new Error(`Expected command to fail: ${command.join(' ')}`);
}

function runFixturePlan() {
  const stdout = execFileSync('node', [
    'scripts/local-data-server-ssot-upsert.js',
    '--json',
    '--server-index-json',
    serverIndexPath,
    '--codex-root',
    codexRoot,
    '--wiki-root',
    wikiRoot,
    '--home',
    homeDir,
    '--no-workspace-content'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      INFO_SSOT_DATABASE_URL: '',
      INFO_SSOT_DB_URL: '',
      DATABASE_URL: ''
    }
  });
  return JSON.parse(stdout);
}

test('story-local-ssot-additive-upsert CLI keeps Wave 1 insert-only and guarded', async () => {
  const storyId = 'story-local-ssot-additive-upsert';
  const ac1 = '`scripts/local-data-server-ssot-upsert.js` は既定でdry-runし、DBへ書き込まない。';
  const ac2 = 'upsert planは `migration_status=local_only` かつ `target_table=graph_entities|wiki_pages` のみをinsert対象にする。';
  const ac3 = '`_codex/common/meta/customers/**` は `graph_entities:customer` のlocal-only catalog候補としてinsert対象にできる。';
  const ac4 = '`needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。';
  const ac5 = 'execute modeは `--execute --confirm-additive-upsert` とDB接続情報を要求する。';
  const ac6 = 'execute modeは `--max-writes` を超える場合に停止する。';
  const ac7 = 'DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。';
  const ac8 = 'tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior.';
    const output = runFixturePlan();

    // story-local-ssot-additive-upsert ac:1
    expect(output.mode, `${storyId} ac:1 ${ac1} default dry-run`).toBe('dry_run');
    expect(output.apply_result, `${storyId} ac:1 ${ac1} no database writes`).toEqual(expect.objectContaining({ dry_run: true, inserted: 0 }));

    // story-local-ssot-additive-upsert ac:2
    expect(output.operations, `${storyId} ac:2 ${ac2} only local_only graph/wiki operations`).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_table: 'graph_entities', target_type: 'customer', source_path: 'common/meta/customers/hotel_m.md' }),
      expect.objectContaining({ target_table: 'wiki_pages', target_type: 'wiki_page', source_path: 'brainbase/page' })
    ]));
    expect(output.operations.every((operation: Record<string, unknown>) => ['graph_entities', 'wiki_pages'].includes(String(operation.target_table))), `${storyId} ac:2 ${ac2} target table allowlist`).toBe(true);

    // story-local-ssot-additive-upsert ac:3
    expect(output.operations, `${storyId} ac:3 ${ac3} common meta customer eligible`).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_table: 'graph_entities', target_type: 'customer' })
    ]));

    // story-local-ssot-additive-upsert ac:4
    expect(output.skips, `${storyId} ac:4 ${ac4} skip exact server match and raw logs`).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_path: 'projects/brainbase/existing.md', reason: 'status:existing_server_match' }),
      expect.objectContaining({ source_path: '.codex/history.jsonl', reason: 'status:needs_extraction' })
    ]));

    // story-local-ssot-additive-upsert ac:5
    const missingConfirm = expectCommandToFail([
      'node',
      'scripts/local-data-server-ssot-upsert.js',
      '--execute',
      '--allow-offline-plan',
      '--codex-root',
      codexRoot,
      '--wiki-root',
      wikiRoot,
      '--home',
      homeDir,
      '--no-workspace-content'
    ]);
    expect(missingConfirm, `${storyId} ac:5 ${ac5} confirm guard`).toContain('confirm-additive-upsert');

    // story-local-ssot-additive-upsert ac:6
    const maxWritesFailure = expectCommandToFail([
      'node',
      'scripts/local-data-server-ssot-upsert.js',
      '--execute',
      '--confirm-additive-upsert',
      '--allow-offline-plan',
      '--max-writes',
      '0',
      '--codex-root',
      codexRoot,
      '--wiki-root',
      wikiRoot,
      '--home',
      homeDir,
      '--no-workspace-content'
    ], { DATABASE_URL: 'postgres://example.invalid/brainbase' });
    expect(maxWritesFailure, `${storyId} ac:6 ${ac6} max writes guard`).toContain('exceed --max-writes');

    // story-local-ssot-additive-upsert ac:7
    const script = fs.readFileSync('scripts/local-data-server-ssot-upsert.js', 'utf8');
    expect(script, `${storyId} ac:7 ${ac7} conflict skip no update clause`).toContain('ON CONFLICT (path) DO NOTHING');
    expect(script, `${storyId} ac:7 ${ac7} graph insert no update clause`).toContain('ON CONFLICT (id) DO NOTHING');
    expect(script, `${storyId} ac:7 ${ac7} no delete statement`).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(script, `${storyId} ac:7 ${ac7} no update statement`).not.toMatch(/\bDO\s+UPDATE\b/iu);

    // story-local-ssot-additive-upsert ac:8
    const unitTest = fs.readFileSync('tests/unit/local-data-server-ssot-upsert.test.js', 'utf8');
    expect(unitTest, `${storyId} ac:8 ${ac8} unit tests cover plan filtering`).toContain('plans only local-only graph and wiki inserts');
    expect(unitTest, `${storyId} ac:8 ${ac8} unit tests cover insert-only`).toContain('executes insert-only SQL');
});

test('story-local-ssot-additive-upsert ac:4 `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。', async () => {
  const output = runFixturePlan();

  expect(output.skips, 'story-local-ssot-additive-upsert ac:4 `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。 existing_server_match').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: 'projects/brainbase/existing.md', reason: 'status:existing_server_match' })
  ]));
  expect(output.skips, 'story-local-ssot-additive-upsert ac:4 `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。 conflict').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: 'projects/brainbase/conflict.md', reason: 'status:conflict' })
  ]));
  expect(output.skips, 'story-local-ssot-additive-upsert ac:4 `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。 existing_server_path_only').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: 'projects/brainbase/path-only.md', reason: 'status:existing_server_path_only' })
  ]));
  expect(output.skips, 'story-local-ssot-additive-upsert ac:4 `needs_extraction`, `conflict`, `existing_server_match`, `existing_server_path_only` はskip reason付きで対象外にする。 needs_extraction').toEqual(expect.arrayContaining([
    expect.objectContaining({ source_path: '.codex/history.jsonl', reason: 'status:needs_extraction' })
  ]));
});

test('story-local-ssot-additive-upsert ac:5 execute modeは `--execute --confirm-additive-upsert` とDB接続情報を要求する。', async () => {
  const missingConfirm = expectCommandToFail([
    'node',
    'scripts/local-data-server-ssot-upsert.js',
    '--execute',
    '--allow-offline-plan',
    '--codex-root',
    codexRoot,
    '--wiki-root',
    wikiRoot,
    '--home',
    homeDir,
    '--no-workspace-content'
  ]);
  expect(missingConfirm, 'story-local-ssot-additive-upsert ac:5 execute modeは `--execute --confirm-additive-upsert` とDB接続情報を要求する。 confirmation').toContain('confirm-additive-upsert');

  const missingDb = expectCommandToFail([
    'node',
    'scripts/local-data-server-ssot-upsert.js',
    '--execute',
    '--confirm-additive-upsert',
    '--allow-offline-plan',
    '--max-writes',
    '10',
    '--codex-root',
    codexRoot,
    '--wiki-root',
    wikiRoot,
    '--home',
    homeDir,
    '--no-workspace-content'
  ], { INFO_SSOT_DATABASE_URL: '', INFO_SSOT_DB_URL: '', DATABASE_URL: '' });
  expect(missingDb, 'story-local-ssot-additive-upsert ac:5 execute modeは `--execute --confirm-additive-upsert` とDB接続情報を要求する。 DB接続情報').toContain('requires INFO_SSOT_DATABASE_URL');
});

test('story-local-ssot-additive-upsert ac:7 DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。', async () => {
  const moduleUrl = pathToFileURL(path.resolve('scripts/local-data-server-ssot-upsert.js')).href;
  const { applyUpsertPlan, buildUpsertPlan } = await import(moduleUrl);
  const plan = buildUpsertPlan([
    {
      source_path: 'common/meta/customers/hotel_m.md',
      absolute_path: path.join(codexRoot, 'common/meta/customers/hotel_m.md'),
      source_root: codexRoot,
      source_kind: 'codex',
      source_subtype: 'common_meta_customer',
      target_table: 'graph_entities',
      target_type: 'customer',
      target_key: 'cus_hotel_m',
      title: 'HOTEL m',
      content_hash: 'fixture-hash',
      migration_status: 'local_only'
    },
    {
      source_path: 'brainbase/page',
      absolute_path: path.join(wikiRoot, 'brainbase/page.md'),
      source_root: wikiRoot,
      source_kind: 'wiki',
      source_subtype: 'wiki_page',
      target_table: 'wiki_pages',
      target_type: 'wiki_page',
      target_key: 'wiki:brainbase/page',
      title: 'Brainbase Wiki',
      content_hash: 'fixture-wiki-hash',
      migration_status: 'local_only'
    }
  ]);
  const sql: string[] = [];
  const client = {
    async query(statement: string) {
      sql.push(statement);
      return { rows: [{ id: 'inserted' }] };
    }
  };

  await applyUpsertPlan(plan, { execute: true, client });

  expect(sql.every((statement) => /^\s*INSERT\b/iu.test(statement)), 'story-local-ssot-additive-upsert ac:7 DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。 INSERT only').toBe(true);
  expect(sql.join('\n'), 'story-local-ssot-additive-upsert ac:7 DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。 DELETE').not.toMatch(/\bDELETE\s+FROM\b/iu);
  expect(sql.join('\n'), 'story-local-ssot-additive-upsert ac:7 DB操作はINSERT onlyで、DELETE/UPDATE/UPSERT update句を使わない。 UPDATE').not.toMatch(/\bDO\s+UPDATE\b/iu);
});

test('story-local-ssot-additive-upsert ac:8 tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior.', async () => {
  const unitTest = fs.readFileSync('tests/unit/local-data-server-ssot-upsert.test.js', 'utf8');

  expect(unitTest, 'story-local-ssot-additive-upsert ac:8 tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior. plan filtering').toContain('plans only local-only graph and wiki inserts');
  expect(unitTest, 'story-local-ssot-additive-upsert ac:8 tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior. execute guard').toContain('requires explicit confirmation, connection string, and max write guard');
  expect(unitTest, 'story-local-ssot-additive-upsert ac:8 tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior. dry-run no-write').toContain('does not query the database in dry-run apply');
  expect(unitTest, 'story-local-ssot-additive-upsert ac:8 tests cover plan filtering, execute guard, dry-run no-write, and insert-only behavior. insert-only behavior').toContain('executes insert-only SQL');
});
