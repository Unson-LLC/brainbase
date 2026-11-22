import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

// Linux tmpfs magic number from statfs(2).
const TMPFS_MAGIC = 0x01021994;
// Require at least 512 MiB free on /dev/shm before routing throwaway test tmpdir there.
const MIN_TMPFS_FREE_BYTES = 512 * 1024 * 1024;

/**
 * Chooses where fixture-heavy tests create their throwaway data directories.
 *
 * Tests such as persona-onboarding-ux and company-os-hotel-pilot perform tens of
 * thousands of small file operations (lock directories, atomic renames, reads of the
 * four canonical files). On the shared CI machine, 16 to 20 jobs write to the same
 * disk, so each of those operations waits behind the other jobs and the tests ran 10
 * to 30 times slower than on an idle machine. The fixtures are deleted after each
 * test and need no durability, so they go to memory-backed /dev/shm when it exists.
 *
 * A value already set in BRAINBASE_TEST_FIXTURE_ROOT wins. Without /dev/shm (macOS,
 * Windows) the tests keep using os.tmpdir().
 */
export function chooseFixtureRoot(env = process.env, candidate = '/dev/shm') {
  if (env.BRAINBASE_TEST_FIXTURE_ROOT) return undefined;
  try {
    const stats = statfsSync(candidate);
    if (stats.type !== TMPFS_MAGIC) return undefined;
    if (stats.bavail * stats.bsize < MIN_TMPFS_FREE_BYTES) return undefined;
    return mkdtempSync(join(candidate, 'brainbase-vitest-'));
  } catch {
    return undefined;
  }
}

export default function setup() {
  const root = chooseFixtureRoot();
  // One line in the CI log shows which disk the fixtures used.
  process.stderr.write(`[fixture-root] ${root ?? process.env.BRAINBASE_TEST_FIXTURE_ROOT ?? 'os.tmpdir() (no tmpfs /dev/shm)'}\n`);
  if (!root) return undefined;
  // Test workers start after global setup and inherit this environment.
  // Routing TMPDIR to the same memory-backed root also moves the 100+ tests that
  // call os.tmpdir() off the shared CI disk without changing individual test files.
  const previousTmpdir = process.env.TMPDIR;
  process.env.BRAINBASE_TEST_FIXTURE_ROOT = root;
  process.env.TMPDIR = root;
  return () => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.BRAINBASE_TEST_FIXTURE_ROOT;
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  };
}
