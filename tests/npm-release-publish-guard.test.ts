import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { assertSerializedPublicationContext } from '../scripts/npm-release.mjs';

// Runs the real publish guard with the environment the npm-publish workflow
// supplies, so a workflow change that drops the OIDC request variables fails
// here instead of at publish time.

async function publishJob() {
  const workflow = await readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
  return workflow.slice(workflow.indexOf('  publish:'));
}

function publishStepEnv(job: string) {
  const step = job.slice(job.indexOf('- name: Publish and verify npm package'));
  const envBlock = step.slice(step.indexOf('env:\n') + 'env:\n'.length, step.indexOf('        run:'));
  const env: Record<string, string> = {};
  for (const line of envBlock.split('\n')) {
    const match = line.match(/^ {10}([A-Z0-9_]+): (.+)$/u);
    if (!match) continue;
    const literal = match[2].match(/^'(.*)'$/u);
    // Expressions are resolved by Actions at run time; give them placeholder values.
    env[match[1]] = literal ? literal[1] : `resolved-${match[1].toLowerCase()}`;
  }
  return env;
}

function oidcToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'brainbase-npm-publish',
    repository: 'Unson-LLC/brainbase',
    run_id: '4242',
    workflow_ref: 'Unson-LLC/brainbase/.github/workflows/npm-publish.yml@refs/heads/main',
    ref: 'refs/heads/main'
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

// What the runner provides on its own, plus the OIDC request variables that
// GitHub Actions only injects when the job grants `id-token: write`.
function runnerEnv(job: string) {
  const env: Record<string, string> = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'Unson-LLC/brainbase',
    GITHUB_RUN_ID: '4242'
  };
  if (/^      id-token: write$/mu.test(job)) {
    env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://pipelines.actions.githubusercontent.com/oidc/token';
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'mock-request-token';
  }
  return env;
}

describe('npm publish guard with the workflow-supplied environment', () => {
  it('passes the OIDC guard for the publish step as configured', async () => {
    const job = await publishJob();
    const stepEnv = publishStepEnv(job);
    expect(stepEnv.BRAINBASE_NPM_PUBLISH_SERIALIZED).toBe('true');
    expect(stepEnv.NPM_CONFIG_PROVENANCE).toBeUndefined();
    expect(job).toMatch(/^          --provenance$/mu);
    const request = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('audience')).toBe('brainbase-npm-publish');
      return new Response(JSON.stringify({ value: oidcToken() }), { status: 200 });
    });
    await expect(assertSerializedPublicationContext({ ...runnerEnv(job), ...stepEnv }, request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('throws when the job does not receive the OIDC request variables', async () => {
    const job = await publishJob();
    const env = { ...runnerEnv(job), ...publishStepEnv(job) };
    delete env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    const request = vi.fn();
    await expect(assertSerializedPublicationContext(env, request)).rejects.toThrow(/serialized GitHub Actions workflow/u);
    expect(request).not.toHaveBeenCalled();
  });
});
