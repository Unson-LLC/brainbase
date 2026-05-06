import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIBEPRO_RUN_PREFIX = 'docs/internal/vibepro-dogfood/runs/';
export const ENFORCED_RUN_DATE = '20260427';

export const REQUIRED_DEVELOPMENT_DAG_NODES = [
  'requirement',
  'story',
  'architecture',
  'spec',
  'test_design',
  'implementation',
  'verification',
  'run_evidence',
  'score_gate',
];

export const DEVELOPMENT_DAG_METRICS = [
  '開発DAG合致率',
  '証跡欠落率',
  'ゲート前進違反率',
  '残リスク回収率',
  'Story-to-Ship閉鎖率',
];

function readGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function normalizeChangedFiles(files) {
  return [...new Set((files ?? [])
    .map((file) => String(file || '').trim())
    .filter(Boolean)
    .map((file) => file.replace(/^"|"$/g, '')))];
}

function parsePorcelainPath(line) {
  if (!line) return '';
  const rawPath = line.slice(3).trim();
  const normalizedPath = rawPath.includes(' -> ')
    ? rawPath.split(' -> ').at(-1)
    : rawPath;
  return normalizedPath?.replace(/^"|"$/g, '') ?? '';
}

function readWorkingTreeChangedFiles(cwd) {
  return normalizeChangedFiles(
    readGit(['status', '--porcelain=v1'], cwd)
      .split('\n')
      .map(parsePorcelainPath),
  );
}

function isAllZeroSha(value) {
  return Boolean(value) && /^0+$/.test(value);
}

export function collectChangedFilesForDevelopmentDag(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (options.changedFiles) {
    return normalizeChangedFiles(options.changedFiles);
  }

  const env = options.env ?? process.env;
  if (env.VIBEPRO_DEVELOPMENT_DAG_CHANGED_FILES) {
    return normalizeChangedFiles(env.VIBEPRO_DEVELOPMENT_DAG_CHANGED_FILES.split(/\r?\n/));
  }
  if (env.VIBEPRO_TRACE_CHANGED_FILES) {
    return normalizeChangedFiles(env.VIBEPRO_TRACE_CHANGED_FILES.split(/\r?\n/));
  }
  if (env.GITHUB_EVENT_NAME === 'schedule' || env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return [];
  }

  const baseRef = options.baseRef ?? env.VIBEPRO_TRACE_BASE_REF
    ?? (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null);
  const beforeSha = options.beforeSha ?? env.GITHUB_EVENT_BEFORE ?? null;

  if (baseRef) {
    return normalizeChangedFiles([
      ...readGit(['diff', '--name-only', `${baseRef}...HEAD`], cwd).split('\n'),
      ...readWorkingTreeChangedFiles(cwd),
    ]);
  }

  if (beforeSha && !isAllZeroSha(beforeSha)) {
    return normalizeChangedFiles([
      ...readGit(['diff', '--name-only', `${beforeSha}...HEAD`], cwd).split('\n'),
      ...readWorkingTreeChangedFiles(cwd),
    ]);
  }

  return normalizeChangedFiles([
    ...readGit(['diff', '--name-only', 'HEAD~1...HEAD'], cwd).split('\n'),
    ...readWorkingTreeChangedFiles(cwd),
  ]);
}

export function extractDogfoodRunIds(changedFiles) {
  return [...new Set(normalizeChangedFiles(changedFiles)
    .filter((file) => file.startsWith(VIBEPRO_RUN_PREFIX))
    .map((file) => file.slice(VIBEPRO_RUN_PREFIX.length).split('/')[0])
    .filter(Boolean))]
    .sort();
}

export function isDevelopmentDagEnforcedRun(runId) {
  const dateMatch = String(runId).match(/(\d{8})/);
  if (!dateMatch) return true;
  return dateMatch[1] >= ENFORCED_RUN_DATE;
}

function normalizeNodes(developmentDag) {
  const rawNodes = developmentDag?.nodes ?? developmentDag;
  if (Array.isArray(rawNodes)) {
    return rawNodes
      .filter((node) => node && typeof node === 'object' && node.id)
      .map((node) => ({
        ...node,
        depends_on: Array.isArray(node.depends_on) ? node.depends_on : [],
      }));
  }
  if (rawNodes && typeof rawNodes === 'object') {
    return Object.entries(rawNodes).map(([id, node]) => ({
      id,
      ...(node && typeof node === 'object' ? node : {}),
      depends_on: Array.isArray(node?.depends_on) ? node.depends_on : [],
    }));
  }
  return [];
}

function isPassedStatus(status) {
  return ['passed', 'completed'].includes(String(status || '').toLowerCase());
}

function hasEvidence(node) {
  if (!node) return false;
  if (Array.isArray(node.evidence)) return node.evidence.length > 0;
  return typeof node.evidence === 'string' && node.evidence.trim().length > 0;
}

function ratio(numerator, denominator) {
  if (denominator === 0) return 'not_applicable';
  return numerator / denominator;
}

function calculateResidualRiskRecovery(developmentRun, nodesById) {
  const configured = developmentRun.development_dag?.residual_risk_recovery;
  if (configured && Number.isFinite(configured.recovered_count) && Number.isFinite(configured.previous_residual_risk_count)) {
    return ratio(configured.recovered_count, configured.previous_residual_risk_count);
  }

  const recoveryNode = nodesById.get('residual_risk_recovery');
  if (recoveryNode) {
    return isPassedStatus(recoveryNode.status) ? 1 : 0;
  }

  return 'not_applicable';
}

export function calculateDevelopmentDagScore(developmentRun) {
  const nodes = normalizeNodes(developmentRun.development_dag);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const requiredNodes = REQUIRED_DEVELOPMENT_DAG_NODES.map((nodeId) => nodesById.get(nodeId));
  const requiredPassed = requiredNodes.filter((node) => isPassedStatus(node?.status)).length;
  const requiredMissingEvidence = requiredNodes.filter((node) => !hasEvidence(node)).length;
  const passedNodes = nodes.filter((node) => isPassedStatus(node.status));
  const gateForwardViolations = passedNodes.filter((node) => (
    (node.depends_on ?? []).some((dependencyId) => !isPassedStatus(nodesById.get(dependencyId)?.status))
  ));
  const shipNode = nodesById.get('ship');
  const storyToShipClosure = isPassedStatus(shipNode?.status) ? 1 : 0;

  return {
    metrics: {
      開発DAG合致率: ratio(requiredPassed, REQUIRED_DEVELOPMENT_DAG_NODES.length),
      証跡欠落率: ratio(requiredMissingEvidence, REQUIRED_DEVELOPMENT_DAG_NODES.length),
      ゲート前進違反率: passedNodes.length === 0 ? 0 : gateForwardViolations.length / passedNodes.length,
      残リスク回収率: calculateResidualRiskRecovery(developmentRun, nodesById),
      'Story-to-Ship閉鎖率': storyToShipClosure,
    },
    node_checks: {
      required_node_count: REQUIRED_DEVELOPMENT_DAG_NODES.length,
      required_passed_count: requiredPassed,
      missing_required_nodes: REQUIRED_DEVELOPMENT_DAG_NODES.filter((nodeId) => !nodesById.has(nodeId)),
      missing_evidence_nodes: REQUIRED_DEVELOPMENT_DAG_NODES.filter((nodeId) => !hasEvidence(nodesById.get(nodeId))),
      gate_forward_violations: gateForwardViolations.map((node) => node.id),
    },
  };
}

export function validateDevelopmentDagRun(developmentRun) {
  const failures = [];
  if (!developmentRun || typeof developmentRun !== 'object') {
    return {
      status: 'failed',
      failures: ['development_run_missing_or_invalid'],
      metrics: Object.fromEntries(DEVELOPMENT_DAG_METRICS.map((metric) => [metric, 'not_applicable'])),
      node_checks: {},
    };
  }

  if (!developmentRun.development_dag) {
    return {
      run_id: developmentRun.run_id,
      status: 'failed',
      failures: ['development_dag_missing'],
      metrics: Object.fromEntries(DEVELOPMENT_DAG_METRICS.map((metric) => [metric, 'not_applicable'])),
      node_checks: {},
    };
  }

  const score = calculateDevelopmentDagScore(developmentRun);
  const metrics = score.metrics;

  if (metrics['開発DAG合致率'] !== 1) failures.push('開発DAG合致率_below_gate');
  if (metrics['証跡欠落率'] !== 0) failures.push('証跡欠落率_nonzero');
  if (metrics['ゲート前進違反率'] !== 0) failures.push('ゲート前進違反率_nonzero');

  if (developmentRun.status === 'completed' && metrics['Story-to-Ship閉鎖率'] !== 1) {
    failures.push('Story-to-Ship閉鎖率_below_gate_for_completed_run');
  }

  if (developmentRun.status === 'completed_with_residual_risk') {
    const residualRisks = developmentRun.outcome?.residual_risks ?? [];
    const nextActions = developmentRun.outcome?.next_actions ?? [];
    if (residualRisks.length === 0 || nextActions.length === 0) {
      failures.push('completed_with_residual_risk_without_residual_risks_or_next_actions');
    }
  }

  return {
    run_id: developmentRun.run_id,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    metrics,
    node_checks: score.node_checks,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function validateChangedDogfoodRuns(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const changedFiles = collectChangedFilesForDevelopmentDag(options);
  const runIds = extractDogfoodRunIds(changedFiles)
    .filter(isDevelopmentDagEnforcedRun);
  const runResults = [];

  for (const runId of runIds) {
    const developmentRunPath = path.join(repoRoot, VIBEPRO_RUN_PREFIX, runId, 'development-run.json');
    const developmentRun = await readJsonIfExists(developmentRunPath);
    if (!developmentRun) {
      runResults.push({
        run_id: runId,
        status: 'failed',
        failures: ['development_run_json_missing_for_enforced_run'],
        metrics: Object.fromEntries(DEVELOPMENT_DAG_METRICS.map((metric) => [metric, 'not_applicable'])),
        node_checks: {},
      });
      continue;
    }
    runResults.push(validateDevelopmentDagRun(developmentRun));
  }

  const failures = runResults
    .filter((result) => result.status !== 'passed')
    .flatMap((result) => result.failures.map((failure) => `${result.run_id}:${failure}`));

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    checked_files: changedFiles,
    checked_run_ids: runIds,
    failures,
    runs: runResults,
  };
}

async function validateRunDirectory(runDir) {
  const developmentRun = await readJsonIfExists(path.join(runDir, 'development-run.json'));
  if (!developmentRun) {
    return {
      run_id: path.basename(runDir),
      status: 'failed',
      failures: ['development_run_json_missing_for_run_directory'],
      metrics: Object.fromEntries(DEVELOPMENT_DAG_METRICS.map((metric) => [metric, 'not_applicable'])),
      node_checks: {},
    };
  }
  return validateDevelopmentDagRun(developmentRun);
}

async function main() {
  const [commandOrRunDir, maybeRunDir] = process.argv.slice(2);
  let result;
  if (!commandOrRunDir) {
    result = await validateChangedDogfoodRuns();
  } else if (commandOrRunDir === 'check-run') {
    result = await validateRunDirectory(maybeRunDir);
  } else {
    result = await validateRunDirectory(commandOrRunDir);
  }

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
