import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [name, expected] of [['valid', 0], ['released', 0], ['missing-heading', 1], ['version-mismatch', 1], ['duplicate-marker', 1], ['wrong-marker', 1], ['missing-marker', 1]]) {
  test(`release notes fixture: ${name}`, () => {
    const result = spawnSync(process.execPath, ['scripts/check-public-docs.mjs', '--release-notes-fixture', `tests/fixtures/release-notes/${name}.json`], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stderr);
    if (!expected) assert.equal(JSON.parse(result.stdout).status, 'release_notes_fixture_valid');
    else assert.ok(result.stderr.trim());
  });
}
