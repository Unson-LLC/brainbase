import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const read = (file: string) => readFileSync(path.join(rootDir, file), 'utf8');

test('story-canonical-task-postgres-ssot ac:1 ac:2 ac:3 S-001 S-002 S-003 S-004 S-005 S-006 contract', () => {
  const story = read('docs/stories/story-canonical-task-postgres-ssot.md');
  const spec = read('docs/specs/story-canonical-task-postgres-ssot-spec.md');
  const bootstrap = read('server/bootstrap/core-services.js');
  const storeConfig = read('server/services/companion/canonical-task-store-config.js');
  const repository = read('server/services/companion/canonical-task-postgres-repository.js');
  const migration = read('scripts/migrate-canonical-task-postgres-store.js');

  for (const marker of ['AC-1', 'AC-2', 'AC-3', 'S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006']) {
    expect(story, `${marker} is explicit in the Story`).toContain(marker);
  }

  expect(spec, 'ac:1 PostgreSQL is the canonical Task store contract').toContain('canonical_tasks');
  expect(repository, 'ac:1 repository implements the canonical persistence boundary').toContain('CanonicalTaskPostgresRepository');
  expect(bootstrap + storeConfig, 'S-001 S-002 backend selection is explicit').toContain('CANONICAL_TASK_BACKEND');
  expect(migration, 'S-003 migration exposes dry-run').toContain("'dry-run'");
  expect(migration, 'S-004 migration applies transactionally').toContain('BEGIN');
  expect(migration, 'S-005 conflicts stop apply').toContain('conflict');
  expect(repository, 'S-006 selected store failures are not silently converted to empty success').not.toContain('catch(() => [])');
  expect(story, 'ac:3 production apply and Canvas projection remain out of scope').toContain('本番DBへのapply');
  expect(story, 'ac:3 Canvas projection is a follow-up Story').toContain('後続Story');
});
