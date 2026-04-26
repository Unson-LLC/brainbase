import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://bb.unson.jp';
const REQUIRED_METRIC_TERMS = [
  '本番化ギャップ捕捉率',
  '本番化ギャップ的中率',
  'ゲート違反流出率',
];
const REQUIRED_DECISION_ID = 'dec_vibepro_ai_self_evaluation_metrics_japanese_ssot';

export function normalizeGraphRecords(responseBody, fallbackType) {
  return (responseBody.records ?? responseBody.entities ?? []).map((record) => ({
    ...record,
    entity_id: record.entity_id ?? record.id,
    entity_type: record.entity_type ?? fallbackType,
    payload: record.payload ?? {},
  }));
}

export function buildGraphRequestHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-brainbase-role': process.env.BRAINBASE_ROLE || 'gm',
    'x-brainbase-projects': process.env.BRAINBASE_PROJECTS || 'brainbase',
    'x-brainbase-clearance': process.env.BRAINBASE_CLEARANCE || 'internal,restricted,finance,hr,contract',
  };
}

async function readTokenFromFile(tokenFile) {
  const content = await fs.readFile(tokenFile, 'utf8');
  const tokenData = JSON.parse(content);
  return tokenData.access_token;
}

export async function resolveGraphToken(options = {}) {
  if (options.token) return options.token;
  if (process.env.BRAINBASE_GRAPH_API_TOKEN) return process.env.BRAINBASE_GRAPH_API_TOKEN;
  if (process.env.BB_ACCESS_TOKEN) return process.env.BB_ACCESS_TOKEN;

  const tokenFile = options.tokenFile ?? path.join(os.homedir(), '.brainbase', 'tokens.json');
  try {
    return await readTokenFromFile(tokenFile);
  } catch {
    return null;
  }
}

async function fetchJson({ fetchImpl, baseUrl, token, endpoint }) {
  const response = await fetchImpl(`${baseUrl}${endpoint}`, {
    headers: buildGraphRequestHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Graph request failed: ${endpoint} returned ${response.status}`);
  }
  return response.json();
}

async function fetchGraphRecords({ fetchImpl, baseUrl, token, type }) {
  const body = await fetchJson({
    fetchImpl,
    baseUrl,
    token,
    endpoint: `/api/info/graph/entities?type=${encodeURIComponent(type)}&limit=500`,
  });
  return normalizeGraphRecords(body, type);
}

function passed(id, summary, evidence = []) {
  return {
    id,
    status: 'passed',
    summary,
    evidence,
  };
}

function failed(id, summary, evidence = []) {
  return {
    id,
    status: 'failed',
    summary,
    evidence,
  };
}

export async function checkVibeProGraphSsot(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? process.env.BRAINBASE_GRAPH_API_URL ?? process.env.BB_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const token = await resolveGraphToken(options);

  if (!fetchImpl) {
    throw new Error('fetch is not available in this Node runtime');
  }
  if (!token) {
    throw new Error('BRAINBASE_GRAPH_API_TOKEN or ~/.brainbase/tokens.json is required');
  }

  const [contextBody, frames, glossaryTerms, decisions] = await Promise.all([
    fetchJson({
      fetchImpl,
      baseUrl,
      token,
      endpoint: '/api/info/context?project=brainbase&types=project&includePhilosophy=true&scope=automation&objectType=frame&operation=read',
    }),
    fetchGraphRecords({ fetchImpl, baseUrl, token, type: 'frame' }),
    fetchGraphRecords({ fetchImpl, baseUrl, token, type: 'glossary_term' }),
    fetchGraphRecords({ fetchImpl, baseUrl, token, type: 'decision' }),
  ]);

  const checks = [];
  const philosophyPrompt = contextBody.philosophy_context?.prompt_block ?? '';
  checks.push(
    philosophyPrompt.includes('Brainbase Philosophy Context')
      ? passed('graph.philosophy_context.automation', 'Brainbase Philosophy Context is available for automation scope')
      : failed('graph.philosophy_context.automation', 'Brainbase Philosophy Context is missing for automation scope'),
  );

  const vibeproFrame = frames.find((record) => (
    record.entity_id === 'frm_vibepro'
    || record.payload.code === 'frm_vibepro'
    || record.payload.name === 'VibePro operating philosophy'
  ));
  checks.push(
    vibeproFrame
      ? passed('graph.frame.frm_vibepro', 'VibePro frame exists in Graph SSOT', [vibeproFrame.entity_id])
      : failed('graph.frame.frm_vibepro', 'VibePro frame is missing from Graph SSOT'),
  );

  const glossaryTermSet = new Set(glossaryTerms.map((record) => record.payload.term).filter(Boolean));
  const missingTerms = REQUIRED_METRIC_TERMS.filter((term) => !glossaryTermSet.has(term));
  checks.push(
    missingTerms.length === 0
      ? passed('graph.glossary.self_evaluation_metrics_japanese', 'Japanese self-evaluation metric terms exist in Graph SSOT', REQUIRED_METRIC_TERMS)
      : failed('graph.glossary.self_evaluation_metrics_japanese', 'Japanese self-evaluation metric terms are missing from Graph SSOT', missingTerms),
  );

  const metricsDecision = decisions.find((record) => (
    record.entity_id === REQUIRED_DECISION_ID
    || record.payload.decision_id === REQUIRED_DECISION_ID
  ));
  checks.push(
    metricsDecision
      ? passed('graph.decision.vibepro_metrics_ssot', 'VibePro metrics decision exists in Graph SSOT', [metricsDecision.entity_id])
      : failed('graph.decision.vibepro_metrics_ssot', 'VibePro metrics decision is missing from Graph SSOT'),
  );

  return {
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    checks,
  };
}

async function main() {
  const result = await checkVibeProGraphSsot();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') {
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
