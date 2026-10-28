import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

for (const [name, expected] of [['valid', 0], ['released', 0], ['missing-heading', 1], ['version-mismatch', 1], ['duplicate-marker', 1], ['wrong-marker', 1], ['missing-marker', 1]]) {
  it(`release notes fixture: ${name}`, () => {
    const result = spawnSync(process.execPath, ['scripts/check-public-docs.mjs', '--release-notes-fixture', `tests/fixtures/release-notes/${name}.json`], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(expected);
    if (!expected) expect(JSON.parse(result.stdout).status).toBe('release_notes_fixture_valid');
    else expect(result.stderr.trim()).toBeTruthy();
  });
}
