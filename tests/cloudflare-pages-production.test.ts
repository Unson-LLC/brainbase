import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  checkoutRef,
  classifyCreatedDeployment,
  classifyCreatedDeploymentAttempt,
  decideProductionDeploy,
  productionBranchFromProject
} from '../scripts/cloudflare-pages-production.mjs';

const sha = '75809ef899410fb3ed204628935f4cfa504b8314';
const deploymentId = '11111111-1111-4111-8111-111111111111';
const olderPreviewId = '22222222-2222-4222-8222-222222222222';

function createdDeployment(environment: 'production' | 'preview', branch: string, id = deploymentId) {
  return {
    success: true,
    result: {
      id,
      environment,
      aliases: environment === 'preview' ? [`https://${branch}.brainbase.pages.dev`] : [],
      deployment_trigger: {
        metadata: {
          branch,
          commit_hash: sha
        }
      }
    }
  };
}

describe('Cloudflare Pages production deploy target', () => {
  it('reads the project production branch and refuses an unusable name', () => {
    expect(productionBranchFromProject({ result: { production_branch: 'production' } })).toBe('production');
    expect(() => productionBranchFromProject({ result: { production_branch: 'main;rm' } }))
      .toThrow('no usable production_branch');
    expect(() => productionBranchFromProject({ result: {} }))
      .toThrow('--branch=main publishes a preview');
  });

  it('deploys only a main push, or a manual deploy dispatched from main', () => {
    expect(decideProductionDeploy({ eventName: 'push', ref: 'refs/heads/main', manualDeploy: '' }).action).toBe('deploy');
    expect(decideProductionDeploy({ eventName: 'push', ref: 'refs/heads/develop', manualDeploy: '' }).action).toBe('skip');
    expect(decideProductionDeploy({ eventName: 'pull_request', ref: 'refs/pull/902/merge', manualDeploy: '' }).action).toBe('skip');
    expect(decideProductionDeploy({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/main',
      manualDeploy: 'true'
    }).action).toBe('deploy');
    expect(decideProductionDeploy({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/develop',
      manualDeploy: 'false'
    }).action).toBe('skip');
    const refused = decideProductionDeploy({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/develop',
      manualDeploy: 'true'
    });
    expect(refused.action).toBe('fail');
    expect(refused.error?.message).toMatch(/Refusing production deploy/u);
    expect(refused.error?.message).toMatch(/refs\/heads\/main/u);
    expect(refused.error?.message).toMatch(/refs\/heads\/develop/u);
    expect(refused.error?.message).toMatch(/set deploy to false/u);
  });

  it('checks out the same commit that --commit-hash and readback record when a manual deploy is allowed', () => {
    expect(checkoutRef({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/main',
      sha,
      manualDeploy: 'true'
    })).toBe(sha);
    expect(checkoutRef({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/develop',
      sha,
      manualDeploy: 'true'
    })).toBe('main');
    expect(checkoutRef({
      eventName: 'push',
      ref: 'refs/heads/develop',
      sha,
      manualDeploy: ''
    })).toBe('refs/heads/develop');
  });

  it('fails when the deployment created by this run is a preview', () => {
    const decision = classifyCreatedDeployment(createdDeployment('preview', 'main'), sha, deploymentId);
    expect(decision.action).toBe('fail');
    expect(decision.error?.message).toMatch(new RegExp(deploymentId, 'u'));
    expect(decision.error?.message).toMatch(/preview deployment on branch "main"/u);
    expect(decision.error?.message).toMatch(/https:\/\/brainbase\.pages\.dev was not updated/u);
    expect(decision.error?.message).toMatch(/older preview of commit/u);
    expect(decision.error?.message).toMatch(/npm publish does not promote the preview/u);
  });

  it('accepts the production deployment created by this run and does not scan an older preview of the same commit', () => {
    expect(classifyCreatedDeployment(createdDeployment('production', 'production'), sha, deploymentId).action).toBe('ok');
    const listWithOlderPreviewFirst = {
      success: true,
      result: [
        {
          id: olderPreviewId,
          environment: 'preview',
          aliases: ['https://main.brainbase.pages.dev'],
          deployment_trigger: { metadata: { branch: 'main', commit_hash: sha } }
        },
        createdDeployment('production', 'production').result
      ]
    };
    const decision = classifyCreatedDeployment(listWithOlderPreviewFirst, sha, deploymentId);
    expect(decision.action).toBe('fail');
    expect(decision.error?.message).toMatch(/Refusing to scan the deployment list/u);
    expect(decision.error?.message).toMatch(/not a reason to fail or to pass/u);
  });

  it('retries only while this run\'s deployment id is unreadable, and fails a preview without retrying', () => {
    expect(classifyCreatedDeploymentAttempt({
      httpStatus: 404,
      payload: null,
      commitSha: sha,
      deploymentId
    }).action).toBe('retry');
    const preview = classifyCreatedDeploymentAttempt({
      httpStatus: 200,
      payload: createdDeployment('preview', 'main'),
      commitSha: sha,
      deploymentId
    });
    expect(preview.action).toBe('fail');
    expect(preview.error?.message).toMatch(/older preview/u);
  });

  it('refuses a missing deployment id instead of judging another deployment of the commit', () => {
    const decision = classifyCreatedDeployment(createdDeployment('production', 'production'), sha, '');
    expect(decision.action).toBe('fail');
    expect(decision.error?.message).toMatch(/did not record a Pages deployment id/u);
    expect(decision.error?.message).toMatch(/older preview/u);
  });

  it('keeps the public docs workflow on the production hostname and the existing readback budget', async () => {
    const workflow = await readFile(new URL('../.github/workflows/docs-cloudflare-pages.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/pull_request:\n    branches:\n      - develop\n      - main\n/u);
    expect(workflow).toContain('node scripts/cloudflare-pages-production.mjs print-branch');
    expect(workflow).toContain('node scripts/cloudflare-pages-production.mjs decide-deploy');
    expect(workflow).toContain('node scripts/cloudflare-pages-production.mjs assert-deployment');
    expect(workflow).not.toContain('assert-production');
    expect(workflow).toContain('pages-deployment-id');
    expect(workflow).toContain("inputs.deploy == true && github.ref == 'refs/heads/main' && github.sha");
    expect(workflow).toContain("github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'");
    expect(workflow).toContain('--commit-hash=${{ github.sha }}');
    expect(workflow).toContain('EXPECTED_BUILD_SHA: ${{ github.sha }}');
    expect(workflow).toContain('BRAINBASE_PUBLIC_URL: https://brainbase.pages.dev');
    expect(workflow).toContain("PUBLIC_READBACK_ATTEMPTS: '18'");
    expect(workflow).toContain("PUBLIC_READBACK_DELAY_MS: '5000'");
    expect(workflow).toContain('npm run docs:verify-public');
    expect(workflow).not.toContain('--branch=main');
    expect(workflow).not.toContain('--branch main');
    expect(workflow).toContain('runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]');
    expect(workflow).not.toMatch(/ubuntu-latest|windows-latest|macos-latest/u);
  });
});
