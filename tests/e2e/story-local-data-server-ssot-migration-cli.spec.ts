import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('story-local-data-server-ssot-migration CLI inventories local sources without server writes', async () => {
  const storyId = 'story-local-data-server-ssot-migration';
  const ac1 = '`scripts/local-data-server-ssot-inventory.js --json` でローカル移行候補のdry-run inventoryを出せる。';
  const ac2 = '`--compare-server` 指定時に、サーバ側SSOTとの差分を非破壊で分類できる。';
  const ac3 = 'inventory resultは各itemに `source_path`, `source_kind`, `target_table`, `target_type`, `content_hash`, `migration_status` を持つ。';
  const ac4 = 'raw conversation logs are classified as `needs_extraction`, not Graph-ready.';
  const ac5 = 'migration architecture and spec define non-destructive behavior, dedupe keys, and review boundaries.';
  const ac6 = 'tests cover classification, hash-based duplicate detection, and raw conversation log boundary.';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ssot-e2e-'));
  try {
    const codexRoot = path.join(tmp, '_codex');
    const wikiRoot = path.join(tmp, 'wiki');
    const homeDir = path.join(tmp, 'home');
    write(path.join(codexRoot, 'common/meta/people/ota_shi.md'), '# 大田氏\n');
    write(path.join(wikiRoot, 'brainbase/page.md'), '# Brainbase Page\n');
    write(path.join(homeDir, '.codex/history.jsonl'), '{"text":"GraphSSOTを綺麗にする"}\n');

    const stdout = execFileSync('node', [
      'scripts/local-data-server-ssot-inventory.js',
      '--json',
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

    const output = JSON.parse(stdout);
    // story-local-data-server-ssot-migration ac:1
    expect(output.mode, `${storyId} ac:1 ${ac1} scripts local-data-server-ssot-inventory json dry-run`).toBe('inventory_only');
    expect(output.summary.total, `${storyId} ac:1 ${ac1} ローカル移行候補 dry-run inventory`).toBe(3);

    // story-local-data-server-ssot-migration ac:3
    for (const item of output.items) {
      expect(Object.keys(item), `${storyId} ac:3 ${ac3} source_path source_kind target_table target_type content_hash migration_status`).toEqual(expect.arrayContaining([
        'source_path',
        'source_kind',
        'target_table',
        'target_type',
        'content_hash',
        'migration_status'
      ]));
    }
    expect(output.items, `${storyId} ac:3 ${ac3} inventory result item contract`).toEqual(expect.arrayContaining([
      expect.objectContaining({ target_table: 'graph_entities', target_type: 'person', source_path: 'common/meta/people/ota_shi.md' }),
      expect.objectContaining({ target_table: 'wiki_pages', target_type: 'wiki_page', source_path: 'brainbase/page' }),
      expect.objectContaining({ target_table: 'memory_candidates', migration_status: 'needs_extraction', source_path: '.codex/history.jsonl' })
    ]));

    // story-local-data-server-ssot-migration ac:4
    const rawLogItem = output.items.find((item: Record<string, unknown>) => item.source_path === '.codex/history.jsonl');
    expect(rawLogItem, `${storyId} ac:4 raw conversation logs are classified as needs_extraction not Graph-ready`).toEqual(expect.objectContaining({
      target_table: 'memory_candidates',
      migration_status: 'needs_extraction'
    }));

    const inventoryModuleUrl = pathToFileURL(path.resolve('scripts/local-data-server-ssot-inventory.js')).href;
    const { compareWithServer } = await import(inventoryModuleUrl);
    const personItem = output.items.find((item: Record<string, unknown>) => item.source_path === 'common/meta/people/ota_shi.md');
    const wikiItem = output.items.find((item: Record<string, unknown>) => item.source_path === 'brainbase/page');
    const compared = compareWithServer([personItem, wikiItem, rawLogItem], [
      {
        target_id: 'server-person-1',
        target_table: personItem.target_table,
        target_type: personItem.target_type,
        source_path: personItem.source_path,
        content_hash: personItem.content_hash
      },
      {
        target_id: 'server-wiki-1',
        target_table: wikiItem.target_table,
        target_type: wikiItem.target_type,
        source_path: wikiItem.source_path,
        content_hash: 'different-server-hash'
      }
    ]);

    // story-local-data-server-ssot-migration ac:2
    expect(compared, `${storyId} ac:2 ${ac2} compare-server サーバ側SSOT 差分 非破壊 分類`).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_path: personItem.source_path, migration_status: 'existing_server_match' }),
      expect.objectContaining({ source_path: wikiItem.source_path, migration_status: 'conflict' }),
      expect.objectContaining({ source_path: rawLogItem.source_path, migration_status: 'needs_extraction' })
    ]));

    // story-local-data-server-ssot-migration ac:5
    expect(fs.existsSync('docs/architecture/local-data-server-ssot-migration-architecture.md'), `${storyId} ac:5 migration architecture and spec define non-destructive behavior dedupe keys and review boundaries`).toBe(true);
    expect(fs.readFileSync('docs/specs/local-data-server-ssot-migration-spec.md', 'utf8'), `${storyId} ac:5 migration architecture and spec define non-destructive behavior dedupe keys and review boundaries`).toContain('non-destructive');

    // story-local-data-server-ssot-migration ac:6
    const unitTest = fs.readFileSync('tests/unit/local-data-server-ssot-inventory.test.js', 'utf8');
    expect(unitTest, `${storyId} ac:6 tests cover classification hash-based duplicate detection and raw conversation log boundary`).toContain('compareWithServer');
    expect(unitTest, `${storyId} ac:6 tests cover classification hash-based duplicate detection and raw conversation log boundary`).toContain('needs_extraction');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
