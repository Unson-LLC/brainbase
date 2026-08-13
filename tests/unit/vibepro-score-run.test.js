import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildFeedbackMarkdown,
  buildReportMarkdown,
  calculateScore,
  collectCoverageHealth,
  collectDogfoodRunHealth,
  collectChangedFilesForScoreVerify,
  collectObservedFacts,
  collectStoryToShipHealth,
  collectWorkflowHealth,
  deriveLabelsFromOutcome,
  extractDogfoodRunIds,
  extractCoverageIncludesFromVitestConfig,
  generateDiagnosisFromObservation,
  generateOutcomeFromObservation,
  parseGitStatusLine,
  runAutomationPipeline,
  runEvaluationPipeline,
  scoreRunDirectory,
  verifyRunDirectory,
  validateObservationCompleteness,
  validateScoreGate,
} from '../../scripts/vibepro-score-run.mjs';

describe('vibepro-score-run', () => {
  it('outcomeとdiagnosisをfact_idで照合してlabelsを機械生成する', () => {
    const labels = deriveLabelsFromOutcome(
      {
        run_id: 'run-1',
        detected_gaps: [
          {
            gap_id: 'gap.repo.behind-origin',
            evidence_fact_ids: ['fact.repo.behind_origin'],
          },
        ],
      },
      {
        run_id: 'run-1',
        actual_gaps: [
          {
            actual_gap_id: 'actual.repo.behind_origin',
            fact_ids: ['fact.repo.behind_origin'],
          },
        ],
        gate_violations: [],
        intervention_outcomes: [],
      },
    );

    expect(labels.status).toBe('generated');
    expect(labels.actual_gaps[0]).toEqual({
      actual_gap_id: 'actual.repo.behind_origin',
      matched_detected_gap_id: 'gap.repo.behind-origin',
      judgment: 'true_positive',
    });
  });

  it('正解ラベル確定時_本番化ギャップ捕捉率と的中率とゲート違反流出率を計算できる', () => {
    const score = calculateScore(
      {
        run_id: 'run-1',
        detected_gaps: [
          { gap_id: 'gap.a' },
          { gap_id: 'gap.b' },
          { gap_id: 'gap.c' },
        ],
      },
      {
        status: 'generated',
        actual_gaps: [
          { actual_gap_id: 'actual.1', matched_detected_gap_id: 'gap.a' },
          { actual_gap_id: 'actual.2', matched_detected_gap_id: null },
        ],
        gate_violations: [
          { violation_id: 'gate.1', escaped: true },
          { violation_id: 'gate.2', escaped: false },
        ],
        intervention_outcomes: [],
      },
    );

    expect(score.metrics['本番化ギャップ捕捉率']).toBe(0.5);
    expect(score.metrics['本番化ギャップ的中率']).toBe(1 / 3);
    expect(score.metrics['ゲート違反流出率']).toBe(0.5);
    expect(score.feedback.missed_gaps).toEqual(['actual.2']);
    expect(score.feedback.over_detected_gaps).toEqual(['gap.b', 'gap.c']);
  });

  it('observationからoutcomeとCI用diagnosisを自動生成する', () => {
    const observation = {
      run_id: 'run-1',
      target_project: 'brainbase',
      frame_id: 'frm_vibepro',
      observed_facts: [
        {
          fact_id: 'fact.vibepro.scorer_manual_only',
          kind: 'automation',
          severity: 'medium',
          summary: 'scorer exists but is not connected to workflow',
        },
      ],
    };

    expect(generateOutcomeFromObservation(observation).actual_gaps[0]).toEqual(
      expect.objectContaining({
        actual_gap_id: 'actual.gap.vibepro.scorer_manual_only',
        fact_ids: ['fact.vibepro.scorer_manual_only'],
      }),
    );
    expect(generateDiagnosisFromObservation(observation).detected_gaps[0]).toEqual(
      expect.objectContaining({
        gap_id: 'gap.vibepro.scorer-manual-only',
        evidence_fact_ids: ['fact.vibepro.scorer_manual_only'],
      }),
    );
  });

  it('git porcelainの1文字statusでもパス先頭を欠落させない', () => {
    expect(parseGitStatusLine('M scripts/vibepro-score-run.mjs')).toEqual(
      expect.objectContaining({
        path: 'scripts/vibepro-score-run.mjs',
        status: 'M',
      }),
    );
    expect(parseGitStatusLine(' M scripts/vibepro-score-run.mjs')).toEqual(
      expect.objectContaining({
        path: 'scripts/vibepro-score-run.mjs',
        status: 'M',
      }),
    );
  });

  it('changed filesから同じrun idを重複なく抽出する', () => {
    expect(extractDogfoodRunIds([
      'docs/internal/vibepro-dogfood/runs/run-1/observation.json',
      'docs/internal/vibepro-dogfood/runs/run-1/score.json',
      'docs/internal/vibepro-dogfood/runs/run-2/development-run.json',
    ])).toEqual(['run-1', 'run-2']);
  });

  it('pushのbefore SHAから複数コミット分の変更を収集する', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-score-push-'));
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'VibePro Test');
    git('config', 'user.email', 'vibepro-test@example.com');

    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    git('add', 'base.txt');
    git('commit', '-m', 'base');
    const before = git('rev-parse', 'HEAD');

    await fs.writeFile(path.join(repo, 'first.txt'), 'first\n');
    git('add', 'first.txt');
    git('commit', '-m', 'first');
    await fs.writeFile(path.join(repo, 'second.txt'), 'second\n');
    git('add', 'second.txt');
    git('commit', '-m', 'second');

    expect(collectChangedFilesForScoreVerify({
      cwd: repo,
      env: { GITHUB_EVENT_BEFORE: before },
    })).toEqual(['first.txt', 'second.txt']);
  });

  it('VibePro関連ファイルはdogfood scopeとしてdirty factから除外し_security configは別factにする', () => {
    const facts = collectObservedFacts({
      branch: 'develop',
      changed_files: [
        parseGitStatusLine('M docs/stories/vibepro-brainbase-dogfood-story.md'),
        parseGitStatusLine('M docs/guides/github-actions-cicd-operating-guide.md'),
        parseGitStatusLine('M .github/workflows/vibepro-score-run.yml'),
        parseGitStatusLine('M .mcp.json'),
        parseGitStatusLine('M server/unrelated.js'),
      ],
      run_count_before_current: 1,
      scorer_exists: true,
      scorer_workflow_exists: true,
    });

    expect(facts).toEqual([
      expect.objectContaining({
        fact_id: 'fact.repo.unrelated_dirty_files',
        evidence: ['server/unrelated.js'],
      }),
      expect.objectContaining({
        fact_id: 'fact.repo.dirty_security_config_files',
        evidence: ['.mcp.json'],
      }),
    ]);
  });

  it('過去runの必須成果物欠落を評価不能ギャップとして抽出する', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-runs-'));
    const runsDir = path.join(tempRoot, 'docs/internal/vibepro-dogfood/runs');
    await fs.mkdir(runsDir, { recursive: true });
    const completeRun = path.join(runsDir, 'run-complete');
    const incompleteRun = path.join(runsDir, 'run-incomplete');
    await fs.mkdir(completeRun);
    await fs.mkdir(incompleteRun);
    for (const fileName of ['observation.json', 'diagnosis.json', 'outcome.json', 'labels.json', 'score.json', 'feedback.md', 'report.md']) {
      await fs.writeFile(path.join(completeRun, fileName), '{}');
    }
    await fs.writeFile(path.join(incompleteRun, 'observation.json'), '{}');

    const dogfood = await collectDogfoodRunHealth(path.join(runsDir, 'run-current'));

    expect(dogfood.incomplete_previous_runs).toEqual([
      expect.objectContaining({
        run_id: 'run-incomplete',
        missing_outputs: expect.arrayContaining(['diagnosis.json', 'score.json', 'report.md']),
      }),
    ]);
  });

  it('dogfood runs配下ではないrunDirでは過去run欠落を評価しない', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-ci-parent-'));
    await fs.mkdir(path.join(tempDir, 'unrelated-dir'));

    const dogfood = await collectDogfoodRunHealth(path.join(tempDir, 'current-run'));

    expect(dogfood.incomplete_previous_runs).toEqual([]);
  });

  it('workflowとStory-to-Shipとcoverageの状態を観測factに接続する', () => {
    const workflows = collectWorkflowHealth(['.github/workflows/vibepro-score-run.yml']);
    const storyHealth = collectStoryToShipHealth({
      vibeproStoryStatus: 'draft',
      hasShipEvidence: false,
    });
    const coverageHealth = collectCoverageHealth({
      coverageIncludes: ['public/modules/**/*.js'],
      scorerPath: 'scripts/vibepro-score-run.mjs',
    });

    const facts = collectObservedFacts(
      {
        branch: 'develop',
        changed_files: [],
        run_count_before_current: 1,
        scorer_exists: true,
        scorer_workflow_exists: true,
      },
      {
        workflows,
        story_to_ship: storyHealth,
        coverage: coverageHealth,
      },
    );

    expect(facts.map((fact) => fact.fact_id)).toEqual([
      'fact.graph.ssot_not_automatically_verified',
      'fact.story_to_ship.vibepro_dogfood_unshipped',
      'fact.ci.vibepro_scorer_outside_coverage_scope',
    ]);
  });

  it('vitest configのcoverage includeからexact file pathも抽出する', () => {
    const includes = extractCoverageIncludesFromVitestConfig(`
      coverage: {
        include: ['public/modules/**/*.js', 'lib/**/*.js', 'scripts/vibepro-score-run.mjs'],
      },
    `);

    expect(includes).toEqual([
      'public/modules/**/*.js',
      'lib/**/*.js',
      'scripts/vibepro-score-run.mjs',
    ]);
  });

  it('runディレクトリ指定時_outcome_labels_score_feedback_reportを書き出す', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-score-run-'));
    await fs.writeFile(
      path.join(runDir, 'observation.json'),
      JSON.stringify({
        run_id: 'run-1',
        observed_facts: [
          {
            fact_id: 'fact.repo.behind_origin',
            kind: 'operational_freshness',
            severity: 'medium',
            summary: 'behind origin',
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(runDir, 'diagnosis.json'),
      JSON.stringify({
        run_id: 'run-1',
        detected_gaps: [
          {
            gap_id: 'gap.repo.behind-origin',
            evidence_fact_ids: ['fact.repo.behind_origin'],
          },
        ],
      }),
    );

    const score = await runEvaluationPipeline(runDir);
    expect(JSON.parse(await fs.readFile(path.join(runDir, 'outcome.json'), 'utf8')).actual_gaps).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(path.join(runDir, 'labels.json'), 'utf8')).actual_gaps[0].judgment).toBe('true_positive');
    expect(score.status).toBe('scored');
    expect(await fs.readFile(path.join(runDir, 'feedback.md'), 'utf8')).toContain('## 指標');
    expect(await fs.readFile(path.join(runDir, 'report.md'), 'utf8')).toContain('## 評価分離');
  });

  it('auto-runはobserveからscoreまで人手なしで完了する', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-auto-run-'));

    const score = await runAutomationPipeline(runDir, {
      repoRoot: process.cwd(),
    });

    const outputFiles = await fs.readdir(runDir);
    expect(outputFiles).toEqual(expect.arrayContaining([
      'observation.json',
      'diagnosis.json',
      'outcome.json',
      'labels.json',
      'score.json',
      'feedback.md',
      'report.md',
    ]));
    expect(score.status).toBe('scored');
  });

  it('gateはnot_applicable指標だけでなく観測正常性も検査する', () => {
    const score = {
      metrics: {
        本番化ギャップ捕捉率: 'not_applicable',
        本番化ギャップ的中率: 'not_applicable',
        ゲート違反流出率: 0,
      },
    };
    const validObservation = {
      repo: {
        branch: 'develop',
        changed_files: [],
        scorer_exists: true,
        scorer_workflow_exists: true,
      },
      dogfood: {},
      workflows: { workflow_count: 2 },
      story_to_ship: { dogfood_story_unshipped: false },
      coverage: { scorer_in_coverage_scope: true },
    };

    expect(validateObservationCompleteness(validObservation).status).toBe('passed');
    expect(validateScoreGate({ observation: validObservation, score }).status).toBe('passed');
    expect(validateScoreGate({ observation: { repo: {} }, score })).toEqual(
      expect.objectContaining({
        status: 'failed',
        failures: ['observation_completeness_failed'],
      }),
    );
  });

  it('feedbackとreportは採点結果から日本語で生成される', async () => {
    const score = {
      run_id: 'run-1',
      status: 'scored',
      metrics: {
        本番化ギャップ捕捉率: 1,
        本番化ギャップ的中率: 0.5,
        ゲート違反流出率: 0,
      },
      feedback: {
        detected_correctly: ['gap.a'],
        missed_gaps: [],
        over_detected_gaps: ['gap.b'],
        escaped_gate_violations: [],
        effective_interventions: [],
        weak_interventions: [],
        next_rule_updates: ['過検出の証跡条件を厳しくする'],
      },
    };

    expect(buildFeedbackMarkdown(score)).toContain('本番化ギャップ的中率: 0.5');
    expect(buildReportMarkdown(score)).toContain('評価分離');

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-score-run-'));
    await fs.writeFile(path.join(runDir, 'diagnosis.json'), JSON.stringify({
      run_id: 'run-1',
      detected_gaps: [{ gap_id: 'gap.a' }],
    }));
    await fs.writeFile(path.join(runDir, 'labels.json'), JSON.stringify({
      status: 'generated',
      actual_gaps: [{ actual_gap_id: 'actual.1', matched_detected_gap_id: 'gap.a' }],
      gate_violations: [],
      intervention_outcomes: [],
    }));
    expect((await scoreRunDirectory(runDir)).metrics['本番化ギャップ捕捉率']).toBe(1);
  });

  it('verifyはscore成果物を書き換えずに不整合を検出する', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-score-verify-'));
    await fs.writeFile(path.join(runDir, 'observation.json'), JSON.stringify({
      run_id: 'run-1',
      repo: {
        branch: 'develop',
        changed_files: [],
        scorer_exists: true,
        scorer_workflow_exists: true,
      },
      dogfood: {},
      workflows: { workflow_count: 2 },
      story_to_ship: { dogfood_story_unshipped: false },
      coverage: { scorer_in_coverage_scope: true },
      observed_facts: [
        {
          fact_id: 'fact.repo.behind_origin',
          kind: 'operational_freshness',
          severity: 'medium',
          summary: 'behind origin',
        },
      ],
    }));
    await fs.writeFile(path.join(runDir, 'diagnosis.json'), JSON.stringify({
      run_id: 'run-1',
      detected_gaps: [
        {
          gap_id: 'gap.repo.behind-origin',
          evidence_fact_ids: ['fact.repo.behind_origin'],
        },
      ],
    }));
    await runEvaluationPipeline(runDir);
    const originalScore = await fs.readFile(path.join(runDir, 'score.json'), 'utf8');

    expect(await verifyRunDirectory(runDir)).toEqual(
      expect.objectContaining({
        status: 'passed',
        failures: [],
      }),
    );

    await fs.writeFile(path.join(runDir, 'score.json'), '{"status":"stale"}\n');
    const failed = await verifyRunDirectory(runDir);

    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        failures: ['score.json_out_of_date'],
      }),
    );
    expect(await fs.readFile(path.join(runDir, 'score.json'), 'utf8')).toBe('{"status":"stale"}\n');

    await fs.writeFile(path.join(runDir, 'score.json'), originalScore);
    expect((await verifyRunDirectory(runDir)).status).toBe('passed');
  });
});
