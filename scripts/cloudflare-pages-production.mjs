#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const PROJECT = 'brainbase';
const PUBLIC_HOSTNAME = 'https://brainbase.pages.dev';
const SAFE_BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/u;
const SAFE_ACCOUNT = /^[A-Za-z0-9]{16,64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

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

export function findDeploymentByCommit(payload, commitSha) {
  const list = Array.isArray(payload?.result) ? payload.result : [];
  return list.find((deployment) => deployment?.deployment_trigger?.metadata?.commit_hash === commitSha) ?? null;
}

export function classifyDeployment(payload, commitSha) {
  if (!payload || payload.success === false || !Array.isArray(payload.result)) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
      : '';
    return {
      action: 'fail',
      error: new Error(
        `Cloudflare Pages deployment list was rejected${message ? `: ${message}` : ''}. ${PUBLIC_HOSTNAME} was not verified.`
      )
    };
  }
  const deployment = findDeploymentByCommit(payload, commitSha);
  if (!deployment) {
    return { action: 'retry' };
  }
  if (deployment.environment !== 'production') {
    const branch = deployment.deployment_trigger?.metadata?.branch ?? 'unknown';
    const aliases = Array.isArray(deployment.aliases) && deployment.aliases.length > 0
      ? deployment.aliases.join(', ')
      : 'none';
    return {
      action: 'fail',
      error: new Error(
        `Cloudflare Pages deployment of ${commitSha} is a ${deployment.environment} deployment on branch "${branch}" (aliases: ${aliases}), not production. ` +
        `${PUBLIC_HOSTNAME} was not updated. Deploy with the project production_branch. --branch=main is only a preview when that setting is not main, and npm publish does not promote the preview.`
      )
    };
  }
  return { action: 'ok', deployment };
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
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
      : response.statusText;
    throw new Error(`Cloudflare Pages API failed (${response.status}): ${message}`);
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

async function assertProduction(commitSha) {
  if (!COMMIT_SHA.test(commitSha)) {
    throw new Error('assert-production requires a 40-character commit SHA');
  }
  const attempts = 6;
  const delayMs = 5000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payload = await cloudflareGet(`/pages/projects/${PROJECT}/deployments`);
    const decision = classifyDeployment(payload, commitSha);
    if (decision.action === 'ok') {
      process.stdout.write(`${JSON.stringify({
        status: 'pages_production_deployment',
        sha: commitSha,
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
    `Cloudflare Pages has no deployment recording commit ${commitSha} on the first deployments page after ${attempts} attempts. ` +
    `${PUBLIC_HOSTNAME} was not verified as this commit. A preview alias is not enough.`
  );
}

async function main() {
  const [command, sha] = process.argv.slice(2);
  if (command === 'print-branch') {
    await printBranch();
    return;
  }
  if (command === 'assert-production') {
    await assertProduction(sha);
    return;
  }
  throw new Error('Usage: node scripts/cloudflare-pages-production.mjs print-branch|assert-production <sha>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
