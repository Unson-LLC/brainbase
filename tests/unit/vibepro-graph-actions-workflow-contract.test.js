import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selfHostedLinuxRunner = ['self-hosted', 'Linux', 'X64', 'wsl-linux'];

function loadWorkflow(name) {
  return yaml.load(fs.readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8'));
}

function expectNodeActionsWithoutPackageCache(job) {
  const checkout = job.steps.find((step) => step.uses === 'actions/checkout@v5');
  expect(checkout).toBeDefined();
  expect(checkout.with['persist-credentials']).toBe(false);
  const setupNode = job.steps.find((step) => step.uses === 'actions/setup-node@v5');
  expect(setupNode).toBeDefined();
  expect(setupNode.with.cache).toBeUndefined();
  expect(setupNode.with['package-manager-cache']).toBe(false);
}

describe('VibePro Graph Actions workflow contract', () => {
  it('GraphifyのPR証跡Gateを廃止した状態を固定する', () => {
    expect(fs.existsSync(path.join(repoRoot, '.github/workflows/vibepro-graphify-impact.yml'))).toBe(false);
  });

  it('Graph SSOTのPR・push・定期実行を別責務に分け、同一pushの履歴検証を中断しない', () => {
    const workflow = loadWorkflow('vibepro-graph-ssot.yml');
    const prJob = workflow.jobs['pr-graph-ssot'];
    const pushJob = workflow.jobs['post-merge-ontology'];
    const driftJob = workflow.jobs['scheduled-graph-ssot'];

    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}-${{ github.event_name == 'push' && github.sha || 'latest' }}",
      'cancel-in-progress': true,
    });
    expect(workflow.on.pull_request.branches).toEqual(['main', 'develop']);
    expect(workflow.on.push.branches).toEqual(['main', 'develop', 'session/**']);

    for (const job of [prJob, pushJob, driftJob]) {
      expect(job['runs-on']).toEqual(selfHostedLinuxRunner);
      expect(job['timeout-minutes']).toBe(10);
      expectNodeActionsWithoutPackageCache(job);
    }

    expect(prJob.if).toBe("github.event_name == 'pull_request'");
    expect(pushJob.if).toBe("github.event_name == 'push'");
    expect(driftJob.if).toBe("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");

    const pushCommands = pushJob.steps.map((step) => step.run).filter(Boolean).join('\n');
    expect(pushCommands).toContain('ontology:verify');
    expect(pushCommands).not.toContain('vibepro:graph-ssot');

    const driftCommands = driftJob.steps.map((step) => step.run).filter(Boolean).join('\n');
    expect(driftCommands).toContain('vibepro:graph-ssot');
    expect(driftCommands).not.toContain('ontology:verify');

    for (const job of [prJob, driftJob]) {
      expect(job.env?.BRAINBASE_GRAPH_API_TOKEN).toBeUndefined();
      const tokenSteps = job.steps.filter((step) => step.env?.BRAINBASE_GRAPH_API_TOKEN);
      expect(tokenSteps.map((step) => step.name)).toEqual([
        'Require Graph API token',
        'Verify VibePro Graph SSOT',
      ]);
    }
  });
});
