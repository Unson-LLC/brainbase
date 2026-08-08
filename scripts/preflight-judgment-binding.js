#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  computeRequestDigest,
} from '../server/services/judgment-resolution-service.js';

function required(value, name) {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

export function buildJudgmentBindingProbe({
  bindingSecret,
  adapterId = 'brainbase-mcp',
  adapterVersion = '1',
  issuedAt = new Date().toISOString(),
  turnId = `judgment-preflight-${randomUUID()}`,
} = {}) {
  required(bindingSecret, 'BRAINBASE_JUDGMENT_BINDING_SECRET');
  const body = {
    request: 'この文章の意味を説明して',
    turn_id: turnId,
    classification_proposal: {
      intent: 'answer',
      domains: ['general'],
      action_kind: 'none',
      risk: 'low',
      confidence: 'confirmed',
      signals: [],
    },
  };
  const requestDigest = computeRequestDigest(body);
  const signaturePayload = canonicalJson([
    'brainbase-judgment-binding-v1',
    adapterId,
    adapterVersion,
    turnId,
    issuedAt,
    requestDigest,
  ]);
  return {
    body,
    requestDigest,
    headers: {
      'x-brainbase-judgment-adapter': adapterId,
      'x-brainbase-judgment-version': adapterVersion,
      'x-brainbase-judgment-issued-at': issuedAt,
      'x-brainbase-judgment-request-digest': requestDigest,
      'x-brainbase-judgment-signature': createHmac('sha256', bindingSecret)
        .update(signaturePayload)
        .digest('hex'),
    },
  };
}

export async function preflightJudgmentBinding({
  apiUrl,
  taskApiToken,
  bindingSecret,
  adapterId,
  adapterVersion,
  now = () => new Date(),
  id = () => randomUUID(),
  fetchImpl = fetch,
} = {}) {
  const baseUrl = required(apiUrl, 'BRAINBASE_API_URL');
  const token = required(taskApiToken, 'BRAINBASE_TASK_API_TOKEN');
  const probe = buildJudgmentBindingProbe({
    bindingSecret,
    adapterId,
    adapterVersion,
    issuedAt: now().toISOString(),
    turnId: `judgment-preflight-${id()}`,
  });
  const response = await fetchImpl(`${baseUrl.replace(/\/$/u, '')}/api/judgment/resolve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...probe.headers,
    },
    body: JSON.stringify(probe.body),
  });
  if (!response.ok) {
    throw new Error(`judgment binding probe returned HTTP ${response.status}`);
  }
  let receipt;
  try {
    receipt = await response.json();
  } catch {
    throw new Error('judgment binding probe returned invalid JSON');
  }
  const binding = receipt?.host_binding;
  if (
    receipt?.request_digest !== probe.requestDigest
    || binding?.adapter_id !== (adapterId || 'brainbase-mcp')
    || binding?.adapter_version !== (adapterVersion || '1')
    || binding?.status !== 'managed'
    || binding?.enforcement_level !== 'host_contract'
  ) {
    throw new Error('judgment binding probe returned an untrusted receipt');
  }
  return { status: 'managed', adapter_id: binding.adapter_id, adapter_version: binding.adapter_version };
}

export function resolveBrainbaseApiUrl(env = process.env) {
  return env.BRAINBASE_RESOLVED_API_URL
    || env.BRAINBASE_GRAPH_API_URL
    || env.BRAINBASE_API_URL
    || env.BRAINBASE_API_BASE_URL;
}

async function main() {
  try {
    const result = await preflightJudgmentBinding({
      apiUrl: resolveBrainbaseApiUrl(),
      taskApiToken: process.env.BRAINBASE_TASK_API_TOKEN,
      bindingSecret: process.env.BRAINBASE_JUDGMENT_BINDING_SECRET,
      adapterId: process.env.BRAINBASE_JUDGMENT_ADAPTER_ID,
      adapterVersion: process.env.BRAINBASE_JUDGMENT_ADAPTER_VERSION,
    });
    process.stderr.write(`BRAINBASE_JUDGMENT_BINDING_AVAILABLE: ${result.adapter_id}@${result.adapter_version}\n`);
  } catch (error) {
    process.stderr.write(`BRAINBASE_MCP_UNAVAILABLE: ${error.message}\n`);
    process.exitCode = 78;
  }
}

if (
  process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
) {
  await main();
}
