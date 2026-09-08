import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selfHostedLinuxRunner = ['self-hosted', 'Linux', 'X64', 'wsl-linux'];

function loadWorkflow() {
  return yaml.load(fs.readFileSync(
    path.join(repoRoot, '.github/workflows/vibepro-score-run.yml'),
    'utf8',
  ));
}

describe('VibePro Minimal Core Actions workflow contract', () => {
  it('Linuxセルフホストrunnerで最小権限・排他・キャッシュ無効を固定する', () => {
    const workflow = loadWorkflow();
    const job = workflow.jobs['minimal-core-contract'];

    expect(workflow.name).toBe('VibePro Minimal Core Contract');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}-${{ github.event_name == 'push' && github.sha || 'latest' }}",
      'cancel-in-progress': true,
    });
    expect(workflow.on.pull_request.branches).toEqual(['main', 'develop']);
    expect(workflow.on.push.branches).toEqual(['main', 'develop', 'session/**']);
    expect(workflow.on.pull_request.paths).toContain('.claude/skills/vibepro-*/**');
    expect(workflow.on.pull_request.paths).not.toContain('docs/internal/vibepro-dogfood/runs/**');

    expect(job['runs-on']).toEqual(selfHostedLinuxRunner);
    expect(job['timeout-minutes']).toBe(10);
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
    expect(commands).toContain('vibepro-minimal-core-contract.test.js');
    expect(commands).not.toContain('vibepro:score-verify');
    expect(commands).not.toContain('vibepro:development-dag');
    expect(commands).not.toContain('vibepro:doc-trace');
  });
});
