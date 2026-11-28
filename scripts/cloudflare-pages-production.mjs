#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROJECT = 'brainbase';
const PUBLIC_HOSTNAME = 'https://brainbase.pages.dev';
const MAIN_REF = 'refs/heads/main';
const SAFE_BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/u;
const SAFE_ACCOUNT = /^[A-Za-z0-9]{16,64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function productionBranchFromProject(payload) {
  const branch = payload?.result?.production_branch;
  if (typeof branch !== 'string' || !SAFE_BRANCH.test(branch)) {
    throw new Error(
      `Cloudflare Pages project ${PROJECT} has no usable production_branch (got ${JSON.stringify(branch ?? null)}). ` +
      `Refusing to deploy. --branch=main publishes a preview when it is not the production branch, so ${PUBLIC_HOSTNAME} stays on the previous build.`
    );
  }
  return branch;
}

function deployRequested(manualDeploy) {
  return manualDeploy === true || manualDeploy === 'true';
}

export function decideProductionDeploy({ eventName, ref, manualDeploy }) {
  if (eventName === 'workflow_dispatch' && deployRequested(manualDeploy)) {
    if (ref !== MAIN_REF) {
      return {
        action: 'fail',
        error: new Error(
          `Refusing production deploy: workflow_dispatch with deploy=true is only allowed from ${MAIN_REF} (got ${ref || 'unknown'}). ` +
          `Checkout, --commit-hash, and public readback must be that same main commit. ` +
          `Dispatch this workflow on main, or set deploy to false.`
        )
      };
    }
    return { action: 'deploy' };
  }
  if (eventName === 'push' && ref === MAIN_REF) return { action: 'deploy' };
  return { action: 'skip' };
}

export function checkoutRef({ eventName, ref, sha, manualDeploy }) {
  if (eventName === 'workflow_dispatch') {
    if (deployRequested(manualDeploy) && ref === MAIN_REF) {
      if (typeof sha !== 'string' || !COMMIT_SHA.test(sha)) {
        throw new Error('workflow_dispatch deploy from main requires the triggering 40-character commit SHA');
      }
      return sha;
    }
    return 'main';
  }
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error('checkout requires github.ref');
  }
  return ref;
}

export function classifyCreatedDeployment(payload, commitSha, deploymentId) {
  if (typeof deploymentId !== 'string' || !DEPLOYMENT_ID.test(deploymentId)) {
    return {
      action: 'fail',
      error: new Error(
        `This run did not record a Pages deployment id (got ${JSON.stringify(deploymentId ?? null)}). ` +
        `Refusing to judge any other deployment of the same commit, including an older preview.`
      )
    };
  }
  if (typeof commitSha !== 'string' || !COMMIT_SHA.test(commitSha)) {
    return {
      action: 'fail',
      error: new Error('assert-deployment requires a 40-character commit SHA')
    };
  }
  if (!payload || payload.success === false || payload.result == null || Array.isArray(payload.result)) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
      : '';
    return {
      action: 'fail',
      error: new Error(
        `Refusing to scan the deployment list for commit ${commitSha}. ` +
        `Only the deployment id created by this run (${deploymentId}) may be judged. ` +
        `${message ? `API said: ${message}. ` : 'The deployment response was not a single deployment. '}` +
        `An older preview of this commit is a different deployment and is not a reason to fail or to pass.`
      )
    };
  }
  const deployment = payload.result;
  if (deployment.id !== deploymentId) {
    return {
      action: 'fail',
      error: new Error(
        `Cloudflare returned deployment ${JSON.stringify(deployment.id ?? null)} instead of this run's deployment ${deploymentId}. ` +
        `Refusing to judge any other deployment of commit ${commitSha}.`
      )
    };
  }
  const recordedSha = deployment.deployment_trigger?.metadata?.commit_hash ?? null;
  if (recordedSha !== commitSha) {
    return {
      action: 'fail',
      error: new Error(
        `Deployment ${deploymentId} records commit ${recordedSha ?? 'none'}, not ${commitSha}. ` +
        `Checkout, --commit-hash, and public readback must be this same commit.`
      )
    };
  }
  if (deployment.environment !== 'production') {
    const branch = deployment.deployment_trigger?.metadata?.branch ?? 'unknown';
    const aliases = Array.isArray(deployment.aliases) && deployment.aliases.length > 0
      ? deployment.aliases.join(', ')
      : 'none';
    return {
      action: 'fail',
      error: new Error(
        `Deployment ${deploymentId} created by this run is a ${deployment.environment} deployment on branch "${branch}" (aliases: ${aliases}), not production. ` +
        `${PUBLIC_HOSTNAME} was not updated by this deployment. ` +
        `An older preview of commit ${commitSha} is a different deployment and is not used for this check. ` +
        `Deploy with the project production_branch. --branch=main is only a preview when that setting is not main, and npm publish does not promote the preview.`
      )
    };
  }
  return { action: 'ok', deployment };
}

export function classifyCreatedDeploymentAttempt({ httpStatus, payload, commitSha, deploymentId }) {
  if (httpStatus === 404) return { action: 'retry' };
  if (httpStatus !== 200) {
    return {
      action: 'fail',
      error: new Error(
        `Cloudflare Pages deployment ${deploymentId} request failed (${httpStatus}). ${PUBLIC_HOSTNAME} was not verified.`
      )
    };
  }
  return classifyCreatedDeployment(payload, commitSha, deploymentId);
}

function requireEnv(name, pattern) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${name} is missing or has an unexpected shape`);
  }
  return value;
}

async function cloudflareGet(path) {
  const account = requireEnv('CLOUDFLARE_ACCOUNT_ID', SAFE_ACCOUNT);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('CLOUDFLARE_API_TOKEN is missing or has an unexpected shape');
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error'
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.success === false) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
      : response.statusText;
    const error = new Error(`Cloudflare Pages API failed (${response.status}): ${message}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printBranch() {
  const payload = await cloudflareGet(`/pages/projects/${PROJECT}`);
  process.stdout.write(`${productionBranchFromProject(payload)}\n`);
}

async function decideDeployCommand() {
  const decision = decideProductionDeploy({
    eventName: process.env.EVENT_NAME ?? '',
    ref: process.env.GITHUB_REF ?? '',
    manualDeploy: process.env.MANUAL_DEPLOY ?? ''
  });
  if (decision.action === 'fail') throw decision.error;
  const line = `should_deploy=${decision.action === 'deploy'}\n`;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (typeof outputPath === 'string' && outputPath.length > 0) {
    appendFileSync(outputPath, line);
    return;
  }
  process.stdout.write(line);
}

async function assertCreatedDeployment(deploymentId, commitSha) {
  const invalid = classifyCreatedDeployment(
    { success: true, result: { id: deploymentId, environment: 'production', deployment_trigger: { metadata: { commit_hash: commitSha } } } },
    commitSha,
    deploymentId
  );
  if (invalid.action === 'fail' && (
    !DEPLOYMENT_ID.test(deploymentId ?? '') || !COMMIT_SHA.test(commitSha ?? '')
  )) {
    throw invalid.error;
  }
  const attempts = 6;
  const delayMs = 5000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let httpStatus = 200;
    let payload = null;
    try {
      payload = await cloudflareGet(`/pages/projects/${PROJECT}/deployments/${deploymentId}`);
    } catch (error) {
      if (error?.status === 404) {
        httpStatus = 404;
      } else {
        throw error;
      }
    }
    const decision = classifyCreatedDeploymentAttempt({ httpStatus, payload, commitSha, deploymentId });
    if (decision.action === 'ok') {
      process.stdout.write(`${JSON.stringify({
        status: 'pages_production_deployment',
        sha: commitSha,
        deployment_id: deploymentId,
        environment: decision.deployment.environment,
        branch: decision.deployment.deployment_trigger?.metadata?.branch ?? null,
        attempt
      })}\n`);
      return;
    }
    if (decision.action === 'fail') throw decision.error;
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(
    `Cloudflare Pages deployment ${deploymentId} was not readable after ${attempts} attempts. ` +
    `${PUBLIC_HOSTNAME} was not verified as this run. An older preview of commit ${commitSha} does not satisfy this check.`
  );
}

async function main() {
  const [command, deploymentId, sha] = process.argv.slice(2);
  if (command === 'print-branch') {
    await printBranch();
    return;
  }
  if (command === 'decide-deploy') {
    await decideDeployCommand();
    return;
  }
  if (command === 'assert-deployment') {
    await assertCreatedDeployment(deploymentId, sha);
    return;
  }
  throw new Error('Usage: node scripts/cloudflare-pages-production.mjs print-branch|decide-deploy|assert-deployment <id> <sha>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
