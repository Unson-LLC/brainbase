import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const CORE_METRICS = [
  '本番化ギャップ捕捉率',
  '本番化ギャップ的中率',
  'ゲート違反流出率',
];

const DOGFOOD_PREFIX = 'docs/internal/vibepro-dogfood/';
const REQUIRED_RUN_OUTPUTS = [
  'observation.json',
  'diagnosis.json',
  'outcome.json',
  'labels.json',
  'score.json',
  'feedback.md',
  'report.md',
];

const GENERATED_RUN_OUTPUTS = [
  'outcome.json',
  'labels.json',
  'score.json',
  'feedback.md',
  'report.md',
];

const VIBEPRO_SCOPE_FILES = new Set([
  '.claude/scripts/hooks/enforce-nocodb-lookup.ts',
  '.github/workflows/vibepro-graph-ssot.yml',
  '.github/workflows/vibepro-score-run.yml',
  'docs/guides/github-actions-cicd-operating-guide.md',
  'docs/architecture/vibepro-brainbase-dogfood-architecture.md',
  'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
  'docs/stories/vibepro-brainbase-dogfood-story.md',
  'package.json',
  'scripts/vibepro-component-style-check.mjs',
  'scripts/vibepro-development-dag-check.mjs',
  'scripts/vibepro-doc-trace-check.mjs',
  'scripts/vibepro-graph-ssot-check.mjs',
  'scripts/vibepro-score-run.mjs',
  'tests/unit/vibepro-development-dag-check.test.js',
  'tests/unit/vibepro-doc-trace-check.test.js',
  'tests/unit/vibepro-graph-ssot-check.test.js',
  'tests/unit/vibepro-score-run.test.js',
  'vitest.config.js',
]);

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

function normalizeChangedFiles(files) {
  return unique((files ?? [])
    .map((file) => String(file || '').trim())
    .filter(Boolean)
    .map((file) => file.replace(/^"|"$/g, '')));
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

export function collectChangedFilesForScoreVerify(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  if (options.changedFiles) {
    return normalizeChangedFiles(options.changedFiles);
  }

  const env = options.env ?? process.env;
  if (env.VIBEPRO_SCORE_CHANGED_FILES) {
    return normalizeChangedFiles(env.VIBEPRO_SCORE_CHANGED_FILES.split(/\r?\n/));
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
  return unique(normalizeChangedFiles(changedFiles)
    .filter((file) => file.startsWith(`${DOGFOOD_PREFIX}runs/`))
    .map((file) => file.slice(`${DOGFOOD_PREFIX}runs/`.length).split('/')[0])
    .filter(Boolean))
    .sort();
}

export function parseGitStatusLine(line) {
  const match = line.match(/^(.{1,2})\s+(.+)$/);
  const status = (match?.[1] ?? line.slice(0, 2)).trim() || line.slice(0, 2).trim();
  const rawPath = (match?.[2] ?? line.slice(3)).trim();
  const filePath = rawPath.replace(/^"|"$/g, '');
  return {
    path: filePath,
    status,
    category: categorizeChangedFile(filePath),
  };
}

function categorizeChangedFile(filePath) {
  if (
    filePath.startsWith(DOGFOOD_PREFIX)
    || VIBEPRO_SCOPE_FILES.has(filePath)
  ) {
    return 'vibepro_dogfood';
  }
  if (filePath === '.mcp.json') return 'security_config';
  if (filePath.startsWith('.claude/skills/')) return 'skill';
  if (filePath.startsWith('.claude/commands/')) return 'unrelated';
  return 'other';
}

export function collectObservedFacts(repo, system = {}) {
  const facts = [];
  const unrelatedFiles = (repo.changed_files ?? [])
    .filter((file) => file.category === 'unrelated' || file.category === 'other')
    .map((file) => file.path);
  const dirtySecurityConfigFiles = (repo.changed_files ?? [])
    .filter((file) => file.category === 'security_config')
    .map((file) => file.path);
  const incompleteRuns = system.dogfood?.incomplete_previous_runs ?? [];
  const missingWorkflows = system.workflows?.missing_workflows ?? [];
  const dogfoodStoryUnshipped = system.story_to_ship?.dogfood_story_unshipped === true;
  const scorerInCoverageScope = system.coverage?.scorer_in_coverage_scope;

  if (repo.run_count_before_current === 0) {
    facts.push({
      fact_id: 'fact.vibepro.no_previous_runs',
      kind: 'evaluation_ssot',
      severity: 'high',
      summary: 'VibePro dogfood has no previous run history',
      evidence: ['run_count_before_current = 0'],
    });
  }

  if (repo.branch === 'HEAD') {
    facts.push({
      fact_id: 'fact.repo.detached_head',
      kind: 'change_control',
      severity: 'medium',
      summary: 'Repository is currently on detached HEAD',
      evidence: ['git rev-parse --abbrev-ref HEAD returned HEAD'],
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

  if (dirtySecurityConfigFiles.length > 0) {
    facts.push({
      fact_id: 'fact.repo.dirty_security_config_files',
      kind: 'security_change_control',
      severity: 'medium',
      summary: 'Security-sensitive config files are dirty and need explicit review',
      evidence: dirtySecurityConfigFiles,
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

  if (incompleteRuns.length > 0) {
    facts.push({
      fact_id: 'fact.vibepro.incomplete_run_outputs',
      kind: 'evaluation_unavailable',
      severity: 'medium',
      summary: `${incompleteRuns.length} previous VibePro dogfood runs are missing required outputs`,
      evidence: incompleteRuns.map((run) => `${run.run_id}: missing ${run.missing_outputs.join(', ')}`),
    });
  }

  if (missingWorkflows.includes('vibepro-score-run.yml')) {
    facts.push({
      fact_id: 'fact.workflows.vibepro_score_not_automated',
      kind: 'automation',
      severity: 'medium',
      summary: 'VibePro score workflow is not present',
      evidence: ['.github/workflows/vibepro-score-run.yml missing'],
    });
  }

  if (missingWorkflows.includes('vibepro-graph-ssot.yml')) {
    facts.push({
      fact_id: 'fact.graph.ssot_not_automatically_verified',
      kind: 'ssot_integrity',
      severity: 'medium',
      summary: 'Graph SSOT projection is not automatically verified',
      evidence: ['.github/workflows/vibepro-graph-ssot.yml missing'],
    });
  }

  if (dogfoodStoryUnshipped) {
    facts.push({
      fact_id: 'fact.story_to_ship.vibepro_dogfood_unshipped',
      kind: 'story_to_ship_gap',
      severity: 'medium',
      summary: 'VibePro dogfood story has not reached shipped evidence',
      evidence: ['story status is not shipped or ship evidence is missing'],
    });
  }

  if (scorerInCoverageScope === false) {
    facts.push({
      fact_id: 'fact.ci.vibepro_scorer_outside_coverage_scope',
      kind: 'ci_evaluation_gap',
      severity: 'medium',
      summary: 'VibePro scorer is tested but not included in coverage scope',
      evidence: ['coverage include does not match scripts/vibepro-score-run.mjs'],
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

function extractFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  return content.slice(4, end);
}

function extractYamlField(markdown, fieldName) {
  const frontmatter = extractFrontmatter(markdown);
  if (frontmatter === null) return null;
  try {
    const parsed = yaml.load(frontmatter) ?? {};
    return parsed[fieldName] ?? null;
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath, fallback = '') {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function collectDogfoodRunHealth(runDir) {
  const runsDir = path.dirname(runDir);
  if (!runsDir.endsWith('docs/internal/vibepro-dogfood/runs')) {
    return {
      previous_run_count: 0,
      incomplete_previous_runs: [],
    };
  }
  let entries;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch {
    return {
      previous_run_count: 0,
      incomplete_previous_runs: [],
    };
  }

  const incomplete = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    if (entry.name === path.basename(runDir)) continue;
    const candidateDir = path.join(runsDir, entry.name);
    const missingOutputs = [];
    for (const output of REQUIRED_RUN_OUTPUTS) {
      if (!(await pathExists(path.join(candidateDir, output)))) {
        missingOutputs.push(output);
      }
    }
    if (missingOutputs.length > 0) {
      incomplete.push({
        run_id: entry.name,
        missing_outputs: missingOutputs,
      });
    }
  }

  return {
    previous_run_count: entries.filter((entry) => entry.isDirectory() && entry.name !== path.basename(runDir)).length,
    incomplete_previous_runs: incomplete.sort((a, b) => a.run_id.localeCompare(b.run_id)),
  };
}

async function listWorkflowFiles(repoRoot) {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join('.github/workflows', entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function collectWorkflowHealth(workflowFiles) {
  const basenames = new Set(workflowFiles.map((filePath) => path.basename(filePath)));
  const required = ['vibepro-score-run.yml', 'vibepro-graph-ssot.yml'];
  return {
    workflow_count: workflowFiles.length,
    missing_workflows: required.filter((workflow) => !basenames.has(workflow)),
  };
}

export function collectStoryToShipHealth(input) {
  return {
    vibepro_story_status: input.vibeproStoryStatus ?? 'unknown',
    has_ship_evidence: input.hasShipEvidence === true,
    dogfood_story_unshipped: input.vibeproStoryStatus !== 'shipped' || input.hasShipEvidence !== true,
  };
}

function globMayMatchPath(globPattern, filePath) {
  if (globPattern === filePath) return true;
  if (globPattern.endsWith('/**/*')) {
    return filePath.startsWith(globPattern.slice(0, -4));
  }
  if (globPattern.includes('**/*')) {
    const [prefix, suffix] = globPattern.split('**/*');
    return filePath.startsWith(prefix) && filePath.endsWith(suffix.replace('*', ''));
  }
  if (globPattern.includes('*')) {
    const [prefix, suffix] = globPattern.split('*');
    return filePath.startsWith(prefix) && filePath.endsWith(suffix);
  }
  return false;
}

export function collectCoverageHealth(input) {
  const coverageIncludes = input.coverageIncludes ?? [];
  const scorerPath = input.scorerPath ?? 'scripts/vibepro-score-run.mjs';
  return {
    coverage_includes: coverageIncludes,
    scorer_path: scorerPath,
    scorer_in_coverage_scope: coverageIncludes.some((pattern) => globMayMatchPath(pattern, scorerPath)),
  };
}

export function extractCoverageIncludesFromVitestConfig(configText) {
  return unique(
    [...configText.matchAll(/['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((value) => (
        value.includes('*')
        || /\.(?:cjs|js|mjs|ts)$/.test(value)
      )),
  );
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
    .map(parseGitStatusLine);
  const scorerExists = await pathExists(path.join(repoRoot, 'scripts/vibepro-score-run.mjs'));
  const scorerWorkflowExists = await pathExists(path.join(repoRoot, '.github/workflows/vibepro-score-run.yml'));

  const [dogfood, workflowFiles, storyText, vitestConfigText] = await Promise.all([
    collectDogfoodRunHealth(runDir),
    listWorkflowFiles(repoRoot),
    readTextIfExists(path.join(repoRoot, 'docs/stories/vibepro-brainbase-dogfood-story.md')),
    readTextIfExists(path.join(repoRoot, 'vitest.config.js')),
  ]);

  const workflows = collectWorkflowHealth(workflowFiles);
  const story_to_ship = collectStoryToShipHealth({
    vibeproStoryStatus: extractYamlField(storyText, 'status') ?? 'unknown',
    hasShipEvidence: await pathExists(path.join(repoRoot, 'docs/internal/vibepro-dogfood/ship.md')),
  });
  const coverage = collectCoverageHealth({
    coverageIncludes: extractCoverageIncludesFromVitestConfig(vitestConfigText),
    scorerPath: 'scripts/vibepro-score-run.mjs',
  });

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
    dogfood,
    workflows,
    story_to_ship,
    coverage,
    observed_facts: collectObservedFacts(repo, {
      dogfood,
      workflows,
      story_to_ship,
      coverage,
    }),
  };
}

export function validateObservationCompleteness(observation) {
  const requiredObjectKeys = ['repo', 'dogfood', 'workflows', 'story_to_ship', 'coverage'];
  const missingKeys = requiredObjectKeys.filter((key) => (
    !observation[key] || typeof observation[key] !== 'object'
  ));
  const repo = observation.repo ?? {};
  const missingRepoKeys = ['branch', 'changed_files', 'scorer_exists', 'scorer_workflow_exists']
    .filter((key) => repo[key] === undefined || repo[key] === null);
  const checks = {
    has_required_sections: missingKeys.length === 0,
    has_repo_minimum_fields: missingRepoKeys.length === 0,
    has_workflow_inventory: Number.isInteger(observation.workflows?.workflow_count),
    has_story_to_ship_result: typeof observation.story_to_ship?.dogfood_story_unshipped === 'boolean',
    has_coverage_result: typeof observation.coverage?.scorer_in_coverage_scope === 'boolean',
  };

  return {
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    checks,
    missing_keys: missingKeys,
    missing_repo_keys: missingRepoKeys,
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

function factIdToGapId(factId) {
  return `gap.${factId.replace(/^fact\./, '').replaceAll('_', '-')}`;
}

export function generateDiagnosisFromObservation(observation) {
  return {
    run_id: observation.run_id,
    target_project: observation.target_project ?? 'brainbase',
    frame_id: observation.frame_id ?? 'frm_vibepro',
    status: 'generated',
    generated_from: 'observation.json',
    diagnosed_at: new Date().toISOString(),
    scope: unique((observation.observed_facts ?? []).map((fact) => fact.kind)),
    detected_gaps: (observation.observed_facts ?? []).map((fact) => ({
      gap_id: factIdToGapId(fact.fact_id),
      evidence_fact_ids: [fact.fact_id],
      severity: fact.severity,
      reason: fact.summary,
    })),
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

export function validateScoreGate({ observation, score }) {
  const observationCheck = validateObservationCompleteness(observation);
  const metrics = score.metrics ?? {};
  const recall = metrics['本番化ギャップ捕捉率'];
  const precision = metrics['本番化ギャップ的中率'];
  const escapedGateRate = metrics['ゲート違反流出率'];
  const failures = [];

  if (observationCheck.status !== 'passed') {
    failures.push('observation_completeness_failed');
  }
  if (recall !== 'not_applicable' && recall < 1) {
    failures.push('本番化ギャップ捕捉率_below_gate');
  }
  if (precision !== 'not_applicable' && precision < 1) {
    failures.push('本番化ギャップ的中率_below_gate');
  }
  if (escapedGateRate !== 0) {
    failures.push('ゲート違反流出率_nonzero');
  }

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    observation_check: observationCheck,
    metrics,
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

function jsonText(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function readTextOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

export async function observeRunDirectory(runDir, options = {}) {
  await fs.mkdir(runDir, { recursive: true });
  const observation = await collectObservation(runDir, options);
  await writeJson(path.join(runDir, 'observation.json'), observation);
  return observation;
}

export async function generateDiagnosisDirectory(runDir) {
  const observation = await readJson(path.join(runDir, 'observation.json'));
  const diagnosis = generateDiagnosisFromObservation(observation);
  await writeJson(path.join(runDir, 'diagnosis.json'), diagnosis);
  return diagnosis;
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

export async function buildExpectedGeneratedRunOutputs(runDir) {
  const [observation, diagnosis] = await Promise.all([
    readJson(path.join(runDir, 'observation.json')),
    readJson(path.join(runDir, 'diagnosis.json')),
  ]);
  const outcome = generateOutcomeFromObservation(observation);
  const labels = deriveLabelsFromOutcome(diagnosis, outcome);
  const score = calculateScore(diagnosis, labels);

  return {
    'outcome.json': jsonText(outcome),
    'labels.json': jsonText(labels),
    'score.json': jsonText(score),
    'feedback.md': buildFeedbackMarkdown(score),
    'report.md': buildReportMarkdown(score),
  };
}

export async function verifyRunDirectory(runDir) {
  const failures = [];
  const missingInputs = [];
  for (const fileName of ['observation.json', 'diagnosis.json']) {
    if (!(await pathExists(path.join(runDir, fileName)))) {
      missingInputs.push(fileName);
    }
  }
  if (missingInputs.length > 0) {
    return {
      run_id: path.basename(runDir),
      status: 'failed',
      failures: missingInputs.map((fileName) => `${fileName}_missing`),
      checked_outputs: [],
    };
  }

  let expectedOutputs;
  try {
    expectedOutputs = await buildExpectedGeneratedRunOutputs(runDir);
  } catch (error) {
    return {
      run_id: path.basename(runDir),
      status: 'failed',
      failures: [`expected_outputs_unavailable:${error instanceof Error ? error.message : String(error)}`],
      checked_outputs: [],
    };
  }

  for (const fileName of GENERATED_RUN_OUTPUTS) {
    const actualText = await readTextOrNull(path.join(runDir, fileName));
    if (actualText === null) {
      failures.push(`${fileName}_missing`);
    } else if (actualText !== expectedOutputs[fileName]) {
      failures.push(`${fileName}_out_of_date`);
    }
  }

  if (failures.length === 0) {
    const gateResult = validateScoreGate({
      observation: await readJson(path.join(runDir, 'observation.json')),
      score: JSON.parse(expectedOutputs['score.json']),
    });
    if (gateResult.status !== 'passed') {
      failures.push(...gateResult.failures.map((failure) => `score_gate:${failure}`));
    }
  }

  return {
    run_id: path.basename(runDir),
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    checked_outputs: GENERATED_RUN_OUTPUTS,
  };
}

export async function verifyChangedDogfoodScoreRuns(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const changedFiles = collectChangedFilesForScoreVerify(options);
  const runIds = extractDogfoodRunIds(changedFiles);
  const runs = [];

  for (const runId of runIds) {
    runs.push(await verifyRunDirectory(path.join(repoRoot, DOGFOOD_PREFIX, 'runs', runId)));
  }

  const failures = runs
    .filter((result) => result.status !== 'passed')
    .flatMap((result) => result.failures.map((failure) => `${result.run_id}:${failure}`));

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    checked_files: changedFiles,
    checked_run_ids: runIds,
    failures,
    runs,
  };
}

export async function runEvaluationPipeline(runDir) {
  await generateOutcomeDirectory(runDir);
  await generateLabelsDirectory(runDir);
  return scoreRunDirectory(runDir);
}

export async function runAutomationPipeline(runDir, options = {}) {
  await observeRunDirectory(runDir, options);
  await generateDiagnosisDirectory(runDir);
  return runEvaluationPipeline(runDir);
}

export async function gateRunDirectory(runDir) {
  const [observation, score] = await Promise.all([
    readJson(path.join(runDir, 'observation.json')),
    readJson(path.join(runDir, 'score.json')),
  ]);
  return validateScoreGate({ observation, score });
}

async function main() {
  const [command, runDir] = process.argv.slice(2);
  if (!command || (command !== 'verify-changed' && !runDir)) {
    console.error('Usage: node scripts/vibepro-score-run.mjs <observe|generate-diagnosis|generate-outcome|generate-labels|score|run|auto-run|gate|verify|verify-changed> <run-dir>');
    process.exitCode = 1;
    return;
  }

  let result;
  if (command === 'observe') {
    result = await observeRunDirectory(runDir);
  } else if (command === 'generate-diagnosis') {
    result = await generateDiagnosisDirectory(runDir);
  } else if (command === 'generate-outcome') {
    result = await generateOutcomeDirectory(runDir);
  } else if (command === 'generate-labels') {
    result = await generateLabelsDirectory(runDir);
  } else if (command === 'score') {
    result = await scoreRunDirectory(runDir);
  } else if (command === 'run') {
    result = await runEvaluationPipeline(runDir);
  } else if (command === 'auto-run') {
    result = await runAutomationPipeline(runDir);
  } else if (command === 'gate') {
    result = await gateRunDirectory(runDir);
  } else if (command === 'verify') {
    result = await verifyRunDirectory(runDir);
  } else if (command === 'verify-changed') {
    result = await verifyChangedDogfoodScoreRuns();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  console.log(JSON.stringify({
    run_id: result.run_id,
    status: result.status ?? 'generated',
    metrics: result.metrics,
    failures: result.failures,
    checked_run_ids: result.checked_run_ids,
  }, null, 2));
  if ((command === 'gate' || command === 'verify' || command === 'verify-changed') && result.status !== 'passed') {
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
