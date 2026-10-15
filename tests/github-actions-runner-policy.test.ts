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
    expect(guide).toContain('CLOUDFLARE_API_TOKEN');
    expect(guide).toContain('persist-credentials: false');
    expect(guide).toContain('http.extraheader');
    expect(guide).toContain('40文字のcommit SHA');
  });

  it('AC-005 keeps secrets out of job env and on the steps that use them', async () => {
    const workflows = await Promise.all(workflowPaths.map((path) => readRepoFile(path)));
    for (const [index, workflow] of workflows.entries()) {
      for (const block of jobLevelEnvBlocks(workflow)) {
        expect(block, workflowPaths[index]).not.toMatch(/secrets\./u);
      }
    }

    const docsWorkflow = workflows[workflowPaths.indexOf('.github/workflows/docs-cloudflare-pages.yml')];
    const jobHeader = docsWorkflow.slice(docsWorkflow.indexOf('  validate-and-publish:'), docsWorkflow.indexOf('    steps:'));
    expect(jobHeader).not.toMatch(/^\s*env:/mu);
    const validateStep = sliceStep(docsWorkflow, 'Validate bounded Worker secret target', 'Sync and verify Worker service token');
    const syncStep = sliceStep(docsWorkflow, 'Sync and verify Worker service token', 'Decide whether to deploy');
    const requireStep = sliceStep(docsWorkflow, 'Require Cloudflare deployment credentials', 'Deploy verified build to Cloudflare Pages');
    const deployStep = sliceStep(docsWorkflow, 'Deploy verified build to Cloudflare Pages', 'Read back the public site');
    for (const step of [validateStep, syncStep, requireStep]) {
      expect(step).toMatch(/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/u);
      expect(step).toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
    }
    expect(validateStep).toMatch(/BRAINBASE_SERVICE_JWT: \$\{\{ secrets\.BRAINBASE_SERVICE_JWT \}\}/u);
    expect(syncStep).toMatch(/BRAINBASE_SERVICE_JWT: \$\{\{ secrets\.BRAINBASE_SERVICE_JWT \}\}/u);
    expect(requireStep).not.toMatch(/BRAINBASE_SERVICE_JWT/u);
    expect(deployStep).toMatch(/apiToken: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
    expect(deployStep).toMatch(/accountId: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/u);
    expect(deployStep).not.toMatch(/BRAINBASE_SERVICE_JWT/u);
  });

  it('AC-006 sets persist-credentials false on every checkout', async () => {
    const workflows = await Promise.all(workflowPaths.map((path) => readRepoFile(path)));
    const checkouts = workflows.flatMap((workflow) => checkoutSections(workflow));
    expect(checkouts).toHaveLength(5);
    for (const section of checkouts) {
      expect(section).toMatch(/persist-credentials: false/u);
    }
    const promotion = workflows[workflowPaths.indexOf('.github/workflows/public-message-promotion.yml')];
    expect(promotion).toMatch(/git -c http\.extraheader="AUTHORIZATION: bearer \$\{GH_TOKEN\}" push --set-upstream origin "\$BRANCH_NAME"/u);
  });

  it('AC-007 pins every action use to a 40-character SHA and tag comment', async () => {
    const workflows = await Promise.all(workflowPaths.map((path) => readRepoFile(path)));
    const uses = workflows.flatMap((workflow) => workflow.match(/^[ \t]*-?[ \t]*uses:.*$/gmu) ?? []);
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40} # v\d+(?:\.\d+)*$/u);
    }
  });
});

function jobLevelEnvBlocks(workflow: string): string[] {
  const lines = workflow.split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^    env:\s*$/u.test(lines[index])) continue;
    const block = [lines[index]];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === '' || lines[next].startsWith('      ')) {
        block.push(lines[next]);
        continue;
      }
      break;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function checkoutSections(workflow: string): string[] {
  return workflow.split(/uses: actions\/checkout@/u).slice(1).map((part) => part.split(/\n[ \t]*- /u)[0]);
}

function sliceStep(workflow: string, startName: string, endName: string): string {
  const start = workflow.indexOf(`      - name: ${startName}`);
  const end = workflow.indexOf(`      - name: ${endName}`);
  return workflow.slice(start, end);
}
