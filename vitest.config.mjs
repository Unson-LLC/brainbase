import { defineConfig } from 'vitest/config';
import { LptSequencer } from './tests/helpers/lpt-sequencer.mjs';

// CI runs on one self-hosted machine that several repositories share. Under that load,
// ordinary tests took up to 14s and setup hooks over 10s, so the Vitest defaults failed
// at random. Give CI more time; keep the defaults locally so a real hang shows quickly.
export function sharedRunnerTimeouts(env) {
  const onCi = env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
  return onCi ? { testTimeout: 30_000, hookTimeout: 60_000 } : { testTimeout: 5_000, hookTimeout: 10_000 };
}

// Tests that call vi.mock() on shared modules/node builtins require fresh module
// isolation per file. All other tests are stateless with respect to module graphs
// and run significantly faster with isolate: false by reusing imported modules.
const ISOLATED_TEST_PATTERNS = [
  'tests/ui/world-*.test.mjs',
  'tests/judgment-history-scan-cache.test.ts',
  'tests/judgment-value-proof-journal-cache.test.ts',
  'tests/build-stage3b-candidate-bundle.test.ts',
];

// Tests that change the working directory need their own process: worker threads
// do not support process.chdir(). They also vi.mock() node:fs/promises, so each
// file gets a fresh module graph too.
const FORKED_TEST_PATTERNS = [
  'tests/brainbase-login-durability.test.ts',
  'tests/brainbase-login-round11.test.ts',
];

const timeouts = sharedRunnerTimeouts(process.env);

function cliExcludes(argv = process.argv) {
  const excludes = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--exclude' && argv[index + 1]) {
      excludes.push(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--exclude=')) {
      excludes.push(arg.slice('--exclude='.length));
    }
  }
  return excludes;
}

const extraExcludes = cliExcludes();

export default defineConfig({
  test: {
    ...timeouts,
    // Threads avoid per-worker process-fork overhead and share memory more efficiently
    // on the multi-runner self-hosted CI host.
    pool: 'threads',
    sequence: {
      sequencer: LptSequencer,
    },
    // Puts fixture-heavy tests' throwaway data on memory-backed /dev/shm when it
    // exists, so they do not wait on a disk that other CI jobs are writing to.
    globalSetup: ['./tests/helpers/fixture-root.global-setup.mjs'],
    projects: [
      {
        test: {
          name: 'default',
          ...timeouts,
          pool: 'threads',
          isolate: false,
          include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            ...ISOLATED_TEST_PATTERNS,
            ...FORKED_TEST_PATTERNS,
            ...extraExcludes,
          ],
        },
      },
      {
        test: {
          name: 'isolated',
          ...timeouts,
          pool: 'threads',
          isolate: true,
          include: ISOLATED_TEST_PATTERNS,
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            ...extraExcludes,
          ],
        },
      },
      {
        test: {
          name: 'forked',
          ...timeouts,
          pool: 'forks',
          isolate: true,
          include: FORKED_TEST_PATTERNS,
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            ...extraExcludes,
          ],
        },
      },
    ],
  },
});
