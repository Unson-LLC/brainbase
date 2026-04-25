import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_METRICS = [
  '本番化ギャップ捕捉率',
  '本番化ギャップ的中率',
  'ゲート違反流出率',
];

const DOGFOOD_PREFIX = 'docs/internal/vibepro-dogfood/';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function parseAheadBehind(value) {
  const [aheadRaw, behindRaw] = value.split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw || '0', 10) || 0,
    behind: Number.parseInt(behindRaw || '0', 10) || 0,
  };
}

function parseStatusLine(line) {
  const status = line.slice(0, 2).trim() || line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const filePath = rawPath.replace(/^"|"$/g, '');
  return {
    path: filePath,
    status,
    category: categorizeChangedFile(filePath),
  };
}

function categorizeChangedFile(filePath) {
  if (filePath.startsWith(DOGFOOD_PREFIX) || filePath === 'scripts/vibepro-score-run.mjs') {
    return 'vibepro_dogfood';
  }
  if (filePath.startsWith('.claude/skills/')) return 'skill';
  if (filePath.startsWith('.claude/commands/')) return 'unrelated';
  return 'other';
}

export function collectObservedFacts(repo) {
  const facts = [];
  const unrelatedFiles = (repo.changed_files ?? [])
    .filter((file) => file.category === 'unrelated' || file.category === 'other')
    .map((file) => file.path);

  if (repo.run_count_before_current === 0) {
    facts.push({
      fact_id: 'fact.vibepro.no_previous_runs',
      kind: 'evaluation_ssot',
      severity: 'high',
      summary: 'VibePro dogfood has no previous run history',
      evidence: ['run_count_before_current = 0'],
    });
  }

  if ((repo.behind ?? 0) > 0) {
    facts.push({
      fact_id: 'fact.repo.behind_origin',
      kind: 'operational_freshness',
      severity: 'medium',
      summary: `${repo.branch || 'current branch'} is behind ${repo.upstream || 'upstream'} by ${repo.behind} commits`,
      evidence: [`behind = ${repo.behind}`],
    });
  }

  if (unrelatedFiles.length > 0) {
    facts.push({
      fact_id: 'fact.repo.unrelated_dirty_files',
      kind: 'change_control',
      severity: 'medium',
      summary: 'There are dirty files outside the VibePro dogfood scope',
      evidence: unrelatedFiles,
    });
  }

  if (repo.scorer_exists === true && repo.scorer_workflow_exists !== true) {
    facts.push({
      fact_id: 'fact.vibepro.scorer_manual_only',
      kind: 'automation',
      severity: 'medium',
      summary: 'The VibePro scorer exists but is not connected to an automatic workflow',
      evidence: ['scripts/vibepro-score-run.mjs exists', 'no scorer workflow detected'],
    });
  }

  return facts;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function countPreviousRuns(runDir) {
  const runsDir = path.dirname(runDir);
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name !== path.basename(runDir)).length;
  } catch {
    return 0;
  }
}

export async function collectObservation(runDir, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const upstream = readGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot);
  const aheadBehind = upstream
    ? parseAheadBehind(readGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], repoRoot))
    : { ahead: 0, behind: 0 };
  const statusOutput = readGit(['status', '--porcelain=v1'], repoRoot);
  const changedFiles = statusOutput
    .split('\n')
    .filter(Boolean)
    .map(parseStatusLine);
  const scorerExists = await pathExists(path.join(repoRoot, 'scripts/vibepro-score-run.mjs'));
  const scorerWorkflowExists = await pathExists(path.join(repoRoot, '.github/workflows/vibepro-score-run.yml'));

  const repo = {
    branch,
    upstream,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    changed_files: changedFiles,
    run_count_before_current: await countPreviousRuns(runDir),
    scorer_exists: scorerExists,
    scorer_workflow_exists: scorerWorkflowExists,
  };

  return {
    run_id: path.basename(runDir),
    target_project: 'brainbase',
    frame_id: 'frm_vibepro',
    observed_at: new Date().toISOString(),
    repo,
    observed_facts: collectObservedFacts(repo),
  };
}

export function generateOutcomeFromObservation(observation) {
  return {
    run_id: observation.run_id,
    status: 'generated',
    generated_from: 'observation.json',
    actual_gaps: (observation.observed_facts ?? []).map((fact) => ({
      actual_gap_id: `actual.gap.${fact.fact_id.replace(/^fact\./, '')}`,
      fact_ids: [fact.fact_id],
      severity: fact.severity,
      category: fact.kind,
      reason: fact.summary,
    })),
    gate_violations: [],
    intervention_outcomes: [],
  };
}

export function deriveLabelsFromOutcome(diagnosis, outcome) {
  const detectedGaps = diagnosis.detected_gaps ?? [];

  return {
    run_id: outcome.run_id ?? diagnosis.run_id,
    status: 'generated',
    generated_from: ['diagnosis.json', 'outcome.json'],
    actual_gaps: (outcome.actual_gaps ?? []).map((actualGap) => {
      const factIds = new Set(actualGap.fact_ids ?? []);
      const matched = detectedGaps.find((gap) => (
        (gap.evidence_fact_ids ?? []).some((factId) => factIds.has(factId))
      ));
      return {
        actual_gap_id: actualGap.actual_gap_id,
        matched_detected_gap_id: matched?.gap_id ?? null,
        judgment: matched ? 'true_positive' : 'missed',
      };
    }),
    gate_violations: outcome.gate_violations ?? [],
    intervention_outcomes: outcome.intervention_outcomes ?? [],
  };
}

function ratio(numerator, denominator) {
  if (denominator === 0) return 'not_applicable';
  return numerator / denominator;
}

function metricBlock(value = 'not_applicable') {
  return Object.fromEntries(CORE_METRICS.map((metric) => [metric, value]));
}

export function calculateScore(diagnosis, labels) {
  const runId = diagnosis.run_id ?? labels.run_id ?? 'unknown-run';
  if (labels.status === 'pending_human_review') {
    return {
      run_id: runId,
      status: 'not_applicable',
      reason: 'labels.jsonがpending_human_reviewのため、AI自走指標はまだ確定できない',
      metrics: metricBlock(),
      feedback: emptyFeedback(['正解ラベルを確定してから採点する']),
    };
  }

  const detectedGapIds = unique((diagnosis.detected_gaps ?? []).map((gap) => gap.gap_id));
  const detectedGapIdSet = new Set(detectedGapIds);
  const actualGaps = labels.actual_gaps ?? [];
  const gateViolations = labels.gate_violations ?? [];
  const interventionOutcomes = labels.intervention_outcomes ?? [];
  const matchedDetectedGapIds = unique(
    actualGaps
      .map((gap) => gap.matched_detected_gap_id)
      .filter((gapId) => detectedGapIdSet.has(gapId)),
  );
  const missedGaps = actualGaps
    .filter((gap) => !detectedGapIdSet.has(gap.matched_detected_gap_id))
    .map((gap) => gap.actual_gap_id);
  const overDetectedGaps = detectedGapIds.filter((gapId) => !matchedDetectedGapIds.includes(gapId));
  const escapedGateViolations = gateViolations
    .filter((violation) => violation.escaped === true)
    .map((violation) => violation.violation_id);
  const effectiveInterventions = interventionOutcomes
    .filter((outcome) => outcome.kpi_delta > 0)
    .map((outcome) => outcome.intervention_id);
  const weakInterventions = interventionOutcomes
    .filter((outcome) => outcome.kpi_delta <= 0)
    .map((outcome) => outcome.intervention_id);

  return {
    run_id: runId,
    status: 'scored',
    metrics: {
      本番化ギャップ捕捉率: ratio(matchedDetectedGapIds.length, actualGaps.length),
      本番化ギャップ的中率: ratio(matchedDetectedGapIds.length, detectedGapIds.length),
      ゲート違反流出率: gateViolations.length === 0
        ? 0
        : escapedGateViolations.length / gateViolations.length,
    },
    feedback: {
      detected_correctly: matchedDetectedGapIds,
      missed_gaps: missedGaps,
      over_detected_gaps: overDetectedGaps,
      escaped_gate_violations: escapedGateViolations,
      effective_interventions: effectiveInterventions,
      weak_interventions: weakInterventions,
      next_rule_updates: buildRuleUpdates({
        missedGaps,
        overDetectedGaps,
        escapedGateViolations,
        weakInterventions,
      }),
    },
  };
}

function emptyFeedback(nextRuleUpdates = []) {
  return {
    detected_correctly: [],
    missed_gaps: [],
    over_detected_gaps: [],
    escaped_gate_violations: [],
    effective_interventions: [],
    weak_interventions: [],
    next_rule_updates: nextRuleUpdates,
  };
}

function buildRuleUpdates({
  missedGaps,
  overDetectedGaps,
  escapedGateViolations,
  weakInterventions,
}) {
  const updates = [];
  if (missedGaps.length > 0) {
    updates.push('未検出の本番化ギャップを次回診断の探索観点に追加する');
  }
  if (overDetectedGaps.length > 0) {
    updates.push('過検出された本番化ギャップの証跡条件を厳しくする');
  }
  if (escapedGateViolations.length > 0) {
    updates.push('人間ゲート条件を昇格ゲートより前に評価する');
  }
  if (weakInterventions.length > 0) {
    updates.push('KPI改善が弱い介入ルートを再評価する');
  }
  if (updates.length === 0) {
    updates.push('現在の診断ルールを維持し、次runで再測定する');
  }
  return updates;
}

function linesForList(items) {
  if (!items || items.length === 0) return ['- なし'];
  return items.map((item) => `- ${item}`);
}

function formatMetricValue(value) {
  return typeof value === 'number' ? Number(value.toFixed(6)).toString() : value;
}

export function buildFeedbackMarkdown(score) {
  const metrics = score.metrics ?? {};
  const feedback = score.feedback ?? {};
  const lines = [
    `# VibePro Brainbase Dogfood Feedback: ${score.run_id}`,
    '',
    '## 状態',
    '',
    score.status === 'scored'
      ? '正解ラベルに基づいて採点済み。'
      : score.reason ?? '未採点。',
    '',
    '## 指標',
    '',
    ...CORE_METRICS.map((metric) => `- ${metric}: ${formatMetricValue(metrics[metric])}`),
    '',
    '## 正しく検出できた本番化ギャップ',
    '',
    ...linesForList(feedback.detected_correctly),
    '',
    '## 未検出本番化ギャップ',
    '',
    ...linesForList(feedback.missed_gaps),
    '',
    '## 過検出本番化ギャップ',
    '',
    ...linesForList(feedback.over_detected_gaps),
    '',
    '## 流出したゲート違反',
    '',
    ...linesForList(feedback.escaped_gate_violations),
    '',
    '## 次回診断ルール更新候補',
    '',
    ...linesForList(feedback.next_rule_updates),
  ];

  return `${lines.join('\n')}\n`;
}

export function buildReportMarkdown(score) {
  const metrics = score.metrics ?? {};
  const lines = [
    `# VibePro Brainbase Evaluation Report: ${score.run_id}`,
    '',
    '## 評価分離',
    '',
    '`diagnosis.json` は VibePro の判断、`outcome.json` は機械観測から生成した事後事実、`labels.json` は両者の照合結果として扱う。',
    '',
    '## 指標',
    '',
    ...CORE_METRICS.map((metric) => `- ${metric}: ${formatMetricValue(metrics[metric])}`),
    '',
    '## 判定',
    '',
    score.status === 'scored'
      ? '評価分離ループは採点まで完了した。'
      : score.reason ?? '評価分離ループは未完了。',
  ];

  return `${lines.join('\n')}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function observeRunDirectory(runDir, options = {}) {
  await fs.mkdir(runDir, { recursive: true });
  const observation = await collectObservation(runDir, options);
  await writeJson(path.join(runDir, 'observation.json'), observation);
  return observation;
}

export async function generateOutcomeDirectory(runDir) {
  const observation = await readJson(path.join(runDir, 'observation.json'));
  const outcome = generateOutcomeFromObservation(observation);
  await writeJson(path.join(runDir, 'outcome.json'), outcome);
  return outcome;
}

export async function generateLabelsDirectory(runDir) {
  const [diagnosis, outcome] = await Promise.all([
    readJson(path.join(runDir, 'diagnosis.json')),
    readJson(path.join(runDir, 'outcome.json')),
  ]);
  const labels = deriveLabelsFromOutcome(diagnosis, outcome);
  await writeJson(path.join(runDir, 'labels.json'), labels);
  return labels;
}

export async function scoreRunDirectory(runDir) {
  const [diagnosis, labels] = await Promise.all([
    readJson(path.join(runDir, 'diagnosis.json')),
    readJson(path.join(runDir, 'labels.json')),
  ]);
  const score = calculateScore(diagnosis, labels);
  await Promise.all([
    writeJson(path.join(runDir, 'score.json'), score),
    fs.writeFile(path.join(runDir, 'feedback.md'), buildFeedbackMarkdown(score)),
    fs.writeFile(path.join(runDir, 'report.md'), buildReportMarkdown(score)),
  ]);
  return score;
}

export async function runEvaluationPipeline(runDir) {
  await generateOutcomeDirectory(runDir);
  await generateLabelsDirectory(runDir);
  return scoreRunDirectory(runDir);
}

async function main() {
  const [command, runDir] = process.argv.slice(2);
  if (!command || !runDir) {
    console.error('Usage: node scripts/vibepro-score-run.mjs <observe|generate-outcome|generate-labels|score|run> <run-dir>');
    process.exitCode = 1;
    return;
  }

  let result;
  if (command === 'observe') {
    result = await observeRunDirectory(runDir);
  } else if (command === 'generate-outcome') {
    result = await generateOutcomeDirectory(runDir);
  } else if (command === 'generate-labels') {
    result = await generateLabelsDirectory(runDir);
  } else if (command === 'score') {
    result = await scoreRunDirectory(runDir);
  } else if (command === 'run') {
    result = await runEvaluationPipeline(runDir);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify({
    run_id: result.run_id,
    status: result.status ?? 'generated',
    metrics: result.metrics,
  }, null, 2));
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
