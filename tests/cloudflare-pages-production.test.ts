import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  classifyDeployment,
  productionBranchFromProject
} from '../scripts/cloudflare-pages-production.mjs';

const sha = '75809ef899410fb3ed204628935f4cfa504b8314';

function deployment(environment: 'production' | 'preview', branch: string) {
  return {
    success: true,
    result: [
      {
        environment,
        aliases: environment === 'preview' ? [`https://${branch}.brainbase.pages.dev`] : [],
        deployment_trigger: {
          metadata: {
            branch,
            commit_hash: sha
          }
        }
      }
    ]
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

  it('fails immediately when the recorded deployment is a preview', () => {
    const decision = classifyDeployment(deployment('preview', 'main'), sha);
    expect(decision.action).toBe('fail');
    expect(decision.error?.message).toMatch(/preview deployment on branch "main"/u);
    expect(decision.error?.message).toMatch(/https:\/\/brainbase\.pages\.dev was not updated/u);
    expect(decision.error?.message).toMatch(/npm publish does not promote the preview/u);
  });

  it('accepts a production deployment of the same commit and retries when it is not listed yet', () => {
    expect(classifyDeployment(deployment('production', 'production'), sha).action).toBe('ok');
    expect(classifyDeployment({ success: true, result: [] }, sha).action).toBe('retry');
  });

  it('keeps the public docs workflow on the production hostname and the existing readback budget', async () => {
    const workflow = await readFile(new URL('../.github/workflows/docs-cloudflare-pages.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/pull_request:\n    branches:\n      - develop\n      - main\n/u);
    expect(workflow).toContain('node scripts/cloudflare-pages-production.mjs print-branch');
    expect(workflow).toContain('node scripts/cloudflare-pages-production.mjs assert-production');
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