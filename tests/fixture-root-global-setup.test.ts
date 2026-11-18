import { existsSync, rmSync, statfsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config.mjs';
import { chooseFixtureRoot } from './helpers/fixture-root.global-setup.mjs';

const TMPFS_MAGIC = 0x01021994;
const shmIsTmpfs = (() => {
  try {
    return statfsSync('/dev/shm').type === TMPFS_MAGIC;
  } catch {
    return false;
  }
})();

describe('fixture root for file-heavy tests', () => {
  it('is wired into the Vitest config', () => {
    expect(config.test?.globalSetup).toContain('./tests/helpers/fixture-root.global-setup.mjs');
  });

  it('keeps a root the caller already chose', () => {
    expect(chooseFixtureRoot({ BRAINBASE_TEST_FIXTURE_ROOT: '/somewhere/else' })).toBeUndefined();
  });

  it('falls back to os.tmpdir() when the candidate is not memory-backed or does not exist', () => {
    expect(chooseFixtureRoot({}, process.cwd())).toBeUndefined();
    expect(chooseFixtureRoot({}, '/no/such/brainbase/fixture/root')).toBeUndefined();
  });

  it.skipIf(!shmIsTmpfs)('creates a fresh directory on /dev/shm when it is tmpfs', () => {
    const root = chooseFixtureRoot({});
    try {
      expect(root).toMatch(/^\/dev\/shm\/brainbase-vitest-/);
      expect(existsSync(root)).toBe(true);
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!shmIsTmpfs)('is what this test run uses', () => {
    expect(process.env.BRAINBASE_TEST_FIXTURE_ROOT).toBeTruthy();
  });
});
