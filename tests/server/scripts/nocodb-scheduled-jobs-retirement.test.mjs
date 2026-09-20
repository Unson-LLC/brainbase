import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflowDirectory = path.join(repositoryRoot, '.github/workflows');
const operatingGuide = path.join(
  repositoryRoot,
  'docs/guides/github-actions-cicd-operating-guide.md',
);
const retirementWorkflow = path.join(
  workflowDirectory,
  'retired-state-boundary.yml',
);

const retiredPaths = [
  'scripts/daily-snapshot.js',
  'scripts/send-story-alerts.js',
  'scripts/send-story-progress-to-slack.js',
  '.github/workflows/daily-snapshot.yml',
  '.github/workflows/daily-story-alerts.yml',
  '.github/workflows/weekly-story-progress.yml',
];

const retiredInvocations = [
  /\bnode\s+scripts\/daily-snapshot\.js\b/,
  /\bnode\s+scripts\/send-story-alerts\.js\b/,
  /\bnode\s+scripts\/send-story-progress-to-slack\.js\b/,
];
const retirementTestPath = 'tests/server/scripts/nocodb-scheduled-jobs-retirement.test.mjs';

test('removes the dedicated legacy NocoDB scheduled jobs', () => {
  for (const target of retiredPaths) {
    assert.equal(
      existsSync(path.join(repositoryRoot, target)),
      false,
      `retired path still exists: ${target}`,
    );
  }
});

test('keeps the current shared server task surface', () => {
  for (const target of [
    'server.js',
    'server/services/companion/canonical-task-service.js',
    'server/routes/companion.js',
  ]) {
    assert.equal(
      existsSync(path.join(repositoryRoot, target)),
      true,
      `shared server path is missing: ${target}`,
    );
  }
});

test('does not leave the retired jobs executable from active workflows', () => {
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

  for (const workflowFile of workflowFiles) {
    const contents = readFileSync(path.join(workflowDirectory, workflowFile), 'utf8');
    for (const invocation of retiredInvocations) {
      assert.doesNotMatch(
        contents,
        invocation,
        `${workflowFile} still invokes a retired scheduled job`,
      );
    }
  }
});

test('documents the retirement and runs this contract in CI', () => {
  const guide = readFileSync(operatingGuide, 'utf8');
  assert.match(
    guide,
    /NocoDB専用のスナップショット・ストーリー通知・進捗通知の定期処理は退役済みです。/,
  );

  const workflow = readFileSync(retirementWorkflow, 'utf8');
  assert.match(workflow, new RegExp(retirementTestPath.replaceAll('/', '\\/')));
  assert.match(
    workflow,
    new RegExp(`node --test\\s+${retirementTestPath.replaceAll('/', '\\/')}`),
  );
});
