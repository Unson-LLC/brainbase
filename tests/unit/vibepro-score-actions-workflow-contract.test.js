import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadWorkflow() {
  return yaml.load(fs.readFileSync(
    path.join(repoRoot, '.github/workflows/vibepro-score-run.yml'),
    'utf8',
  ));
}

describe('VibePro Score Actions workflow contract', () => {
  it('GitHub-hosted runnerで最小権限・push履歴を保つ排他・キャッシュ無効を固定する', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['score-evidence'];

    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}-${{ github.event_name == 'push' && github.sha || 'latest' }}",
      'cancel-in-progress': true,
    });
    expect(workflow.on.pull_request.branches).toEqual(['main', 'develop']);
    expect(workflow.on.push.branches).toEqual(['main', 'develop', 'session/**']);
    expect(workflow.on.pull_request.paths).toContain('docs/guides/github-actions-cicd-operating-guide.md');
    expect(workflow.on.pull_request.paths).not.toContain('_codex/common/ops/scheduled-jobs.md');

    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(10);
    expect(job.env.GITHUB_EVENT_BEFORE).toBe('${{ github.event.before }}');
    const checkout = job.steps.find((step) => step.uses === 'actions/checkout@v5');
    expect(checkout).toBeDefined();
    expect(checkout.with['persist-credentials']).toBe(false);

    const setupNode = job.steps.find((step) => step.uses === 'actions/setup-node@v5');
    expect(setupNode).toBeDefined();
    expect(setupNode.with.cache).toBeUndefined();
    expect(setupNode.with['package-manager-cache']).toBe(false);

    const commands = job.steps.map((step) => step.run).filter(Boolean).join('\n');
    expect(commands).toContain('vibepro-score-actions-workflow-contract.test.js');
    expect(commands).toContain('vibepro-graph-actions-workflow-contract.test.js');
    expect(commands).toContain('vibepro:score-verify');
    expect(commands).toContain('vibepro:development-dag');
    expect(commands).toContain('vibepro:doc-trace');
  });
});
