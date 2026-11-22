import path from 'node:path';
import { BaseSequencer } from 'vitest/node';

// Schedule the slowest integration/smoke files first (Longest Processing Time First)
// so small-file-size heavy tests (git-commit consumer smoke, modern-web scan, tarball
// consumer smokes) start at t=0 instead of sitting alone as tail stragglers.
const PRIORITY_ORDER = [
  'tests/git-commit-consumer-smoke.integration.test.ts',
  'tests/ui/modern-web-legacy-scan.test.mjs',
  'tests/npm-consumer-smoke.integration.test.ts',
  'tests/queue-task-tools-consumer.test.ts',
  'tests/judgment-harness-consumer-smoke.integration.test.ts',
  'tests/company-os-hotel-pilot.test.ts',
  'tests/persona-onboarding-ux.test.ts',
  'tests/stage3-oss-package-exports.test.ts',
  'tests/ui/graph-projects-view.test.mjs',
  'tests/canonical-task-postgres-service.integration.test.ts',
  'tests/queue-task-tools-transport.test.ts',
  'tests/graph-foundation-public.integration.test.ts',
  'tests/foundation-graph-history-sql.test.ts',
  'tests/npm-release-validation.integration.test.ts',
  'tests/meeting-minutes-list-pagination.test.ts',
  'tests/brainbase-login-lock.test.ts',
  'tests/durable-waits.test.ts',
  'tests/meeting-minutes.test.ts',
];

const PRIORITY_INDEX = new Map(PRIORITY_ORDER.map((entry, index) => [entry, index]));

function relativeTestPath(spec) {
  const root = spec.project?.config?.root ?? process.cwd();
  return path.relative(root, spec.moduleId).split(path.sep).join('/');
}

export class LptSequencer extends BaseSequencer {
  async sort(files) {
    const baseSorted = await super.sort(files);
    const prioritized = [];
    const rest = [];
    for (const spec of baseSorted) {
      const rank = PRIORITY_INDEX.get(relativeTestPath(spec));
      if (rank !== undefined) prioritized.push({ rank, spec });
      else rest.push(spec);
    }
    prioritized.sort((left, right) => left.rank - right.rank);
    return [...prioritized.map((entry) => entry.spec), ...rest];
  }
}
