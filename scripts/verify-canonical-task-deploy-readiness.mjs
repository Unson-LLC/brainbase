#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import { setCanonicalTaskReadiness } from './set-canonical-task-readiness.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:55123';

export function parseCanonicalTaskDeployReadinessArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base-url') parsed.baseUrl = argv[++index];
    else if (argument === '--evidence') parsed.evidencePath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function probeCanonicalTaskMutationReadiness({
  baseUrl = DEFAULT_BASE_URL,
  internalApiSecret,
  fetchImpl = fetch,
}) {
  if (!internalApiSecret) throw new Error('INTERNAL_API_SECRET is required for the Canonical Task readiness probe');
  const endpoint = new URL('/api/companion/tasks', baseUrl).toString();
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'deploy-readiness-invalid-probe-v1',
      'x-internal-api-key': internalApiSecret,
    },
    body: '{}',
  });
  const body = await responseBody(response);

  if (response.status === 422 && body?.code === 'validation_failed') {
    return { ready: true, status: response.status, code: body.code };
  }
  if (response.status === 503 && body?.code === 'canonical_task_mutation_not_ready') {
    return {
      ready: false,
      status: response.status,
      code: body.code,
      reason: body?.details?.reason || 'unspecified',
    };
  }
  throw new Error(`Unexpected Canonical Task readiness probe response: status=${response.status} code=${body?.code || 'unknown'}`);
}

export async function verifyCanonicalTaskDeployReadiness({
  baseUrl = DEFAULT_BASE_URL,
  evidencePath = null,
  internalApiSecret = process.env.INTERNAL_API_SECRET,
  fetchImpl = fetch,
  enableReadiness = setCanonicalTaskReadiness,
  rootDir = process.cwd(),
} = {}) {
  const initial = await probeCanonicalTaskMutationReadiness({ baseUrl, internalApiSecret, fetchImpl });
  if (initial.ready) return { ready: true, reenabled: false, probe: initial };

  if (!evidencePath) {
    throw new Error(`Canonical Task mutation is disabled (${initial.reason}); current before-enable evidence is required to re-enable it`);
  }

  await enableReadiness({
    argv: ['--enable', '--evidence', evidencePath],
    rootDir,
  });
  const readback = await probeCanonicalTaskMutationReadiness({ baseUrl, internalApiSecret, fetchImpl });
  if (!readback.ready) {
    throw new Error(`Canonical Task mutation remains disabled after re-enable (${readback.reason})`);
  }
  return { ready: true, reenabled: true, probe: readback };
}

async function main() {
  const args = parseCanonicalTaskDeployReadinessArgs(process.argv.slice(2));
  const result = await verifyCanonicalTaskDeployReadiness(args);
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
