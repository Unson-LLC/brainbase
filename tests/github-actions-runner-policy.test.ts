import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const selfHostedRunner = 'runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]';
const workflowPaths = [
  '.github/workflows/test.yml',
  '.github/workflows/npm-publish.yml',
  '.github/workflows/docs-cloudflare-pages.yml',
  '.github/workflows/public-message-promotion.yml'
] as const;

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('public CI self-hosted runner policy', () => {
  it('AC-001 runs every workflow job on the EVO-X2 self-hosted labels', async () => {
    const workflows = await Promise.all(workflowPaths.map((path) => readRepoFile(path)));
    for (const [index, workflow] of workflows.entries()) {
      const runsOn = workflow.match(/^[ \t]*runs-on:.*$/gmu) ?? [];
      expect(runsOn, workflowPaths[index]).not.toHaveLength(0);
      expect(runsOn.every((line) => line.trim() === selfHostedRunner), workflowPaths[index]).toBe(true);
      expect(workflow, workflowPaths[index]).not.toMatch(/ubuntu-latest|windows-latest|macos-latest/u);
    }
  });

  it('AC-002 runs pull_request jobs only for a head in this repository', async () => {
    const testWorkflow = await readRepoFile('.github/workflows/test.yml');
    const docsWorkflow = await readRepoFile('.github/workflows/docs-cloudflare-pages.yml');
    const testJob = testWorkflow.slice(testWorkflow.indexOf('  build-and-test:'));
    const docsJob = docsWorkflow.slice(docsWorkflow.indexOf('  validate-and-publish:'));

    expect(testJob).toMatch(
      /if: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}/u
    );
    expect(docsJob).toMatch(
      /if: \$\{\{ github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository \}\}/u
    );
    expect(testWorkflow).not.toMatch(/pull_request_target:/u);
    expect(docsWorkflow).not.toMatch(/pull_request_target:/u);
  });

  it('AC-003 keeps npm publish off the pull request head and limits the npm token', async () => {
    const workflow = await readRepoFile('.github/workflows/npm-publish.yml');
    const validationJob = workflow.slice(workflow.indexOf('  validate:'), workflow.indexOf('  publish:'));
    const publishJob = workflow.slice(workflow.indexOf('  publish:'));

    expect(workflow).toMatch(/pull_request_target:/u);
    expect(workflow).not.toMatch(/github\.event\.pull_request\.head\.(sha|ref)/u);
    expect(workflow).not.toMatch(/ref: \$\{\{ github\.event\.pull_request\.head/u);
    expect(validationJob).toMatch(/ref: develop/u);
    expect(publishJob).toMatch(/ref: develop/u);
    expect(validationJob).not.toMatch(/NODE_AUTH_TOKEN/u);
    expect(validationJob).not.toMatch(/secrets\.NPM_TOKEN/u);
    expect(publishJob).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/u);
    expect(workflow.match(/NODE_AUTH_TOKEN/gu)).toHaveLength(1);
  });

  it('AC-004 documents the runner labels and the fork pull request boundary', async () => {
    const guide = await readRepoFile('docs/guides/github-actions-cicd-operating-guide.md');
    expect(guide).toContain('GitHub-hosted runnerを使わない');
    expect(guide).toContain(selfHostedRunner);
    expect(guide).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(guide).toContain('author_association');
    expect(guide).toContain('pull requestのheadをcheckoutしない');
  });
});
