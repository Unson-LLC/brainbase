import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('story-local-ssot-root-priority CLI keeps _codex source before workspace duplicate', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ssot-root-priority-e2e-'));
  try {
    const codexRoot = path.join(tmp, '_codex');
    const workspaceRoot = path.join(tmp, 'workspace');
    const homeDir = path.join(tmp, 'home');
    write(path.join(codexRoot, 'sns/rules.md'), '# SNS Rules\n\nshared codex is the SSOT\n');
    write(path.join(workspaceRoot, 'sns/rules.md'), '# Old SNS Rules\n\nworkspace duplicate\n');

    const stdout = execFileSync('node', [
      'scripts/local-data-server-ssot-inventory.js',
      '--json',
      '--codex-root',
      codexRoot,
      '--workspace-root',
      workspaceRoot,
      '--workspace-content-dir',
      'sns',
      '--wiki-root',
      path.join(tmp, 'missing-wiki'),
      '--home',
      homeDir,
      '--no-conversation-logs'
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

    // story-local-ssot-root-priority ac:1 Inventory dedupes duplicate local roots by `target_table|target_type|source_path`.
    expect(output.summary.total, 'story-local-ssot-root-priority ac:1 Inventory dedupes duplicate local roots by `target_table|target_type|source_path`.').toBe(2);
    // story-local-ssot-root-priority ac:3 Suppressed lower-priority duplicates are visible as `needs_review` with duplicate metadata.
    expect(output.summary.by_status, 'story-local-ssot-root-priority ac:3 Suppressed lower-priority duplicates are visible as `needs_review` with duplicate metadata.').toEqual({
      local_only: 1,
      needs_review: 1
    });
    // story-local-ssot-root-priority ac:2 `_codex` wins over workspace content for the same target key.
    expect(output.items, 'story-local-ssot-root-priority ac:2 `_codex` wins over workspace content for the same target key.').toEqual([
      expect.objectContaining({
        source_path: 'sns/rules.md',
        source_root: codexRoot,
        title: 'SNS Rules'
      }),
      expect.objectContaining({
        source_path: 'sns/rules.md',
        source_root: workspaceRoot,
        migration_status: 'needs_review',
        duplicate_of_source_root: codexRoot,
        duplicate_resolution: 'suppressed_by_root_priority'
      })
    ]);

    const unitTest = fs.readFileSync('tests/unit/local-data-server-ssot-inventory.test.js', 'utf8');
    // story-local-ssot-root-priority ac:4 A unit test covers the duplicate root case.
    expect(unitTest, 'story-local-ssot-root-priority ac:4 A unit test covers the duplicate root case.').toContain('prefers codex root items and reports workspace duplicates for review');

    const serverIndexPath = path.join(tmp, 'server-index.json');
    fs.writeFileSync(serverIndexPath, JSON.stringify([{
      target_id: 'doc_sns_rules',
      target_table: 'graph_entities',
      target_type: 'document',
      source_path: 'sns/rules.md',
      content_hash: output.items[0].content_hash
    }]));
    const upsertStdout = execFileSync('node', [
      'scripts/local-data-server-ssot-upsert.js',
      '--json',
      '--server-index-json',
      serverIndexPath,
      '--codex-root',
      codexRoot,
      '--workspace-root',
      workspaceRoot,
      '--workspace-content-dir',
      'sns',
      '--wiki-root',
      path.join(tmp, 'missing-wiki'),
      '--home',
      homeDir,
      '--no-conversation-logs'
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
    const upsertOutput = JSON.parse(upsertStdout);
    // story-local-ssot-root-priority ac:5 Production compare inventory reports no `conflict` caused by the known SNS duplicate roots.
    expect(upsertOutput.summary.by_skip_reason, 'story-local-ssot-root-priority ac:5 Production compare inventory reports no `conflict` caused by the known SNS duplicate roots.').toEqual({
      'status:existing_server_match': 1,
      'status:needs_review': 1
    });
    expect(upsertOutput.summary.by_skip_reason['status:conflict'], 'story-local-ssot-root-priority ac:5 Production compare inventory reports no `conflict` caused by the known SNS duplicate roots. no conflict').toBeUndefined();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
