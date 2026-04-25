import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildFeedbackMarkdown,
  buildReportMarkdown,
  calculateScore,
  collectObservedFacts,
  deriveLabelsFromOutcome,
  generateOutcomeFromObservation,
  runEvaluationPipeline,
  scoreRunDirectory,
} from '../../scripts/vibepro-score-run.mjs';

describe('vibepro-score-run', () => {
  it('outcomeとdiagnosisをfact_idで照合してlabelsを機械生成する', () => {
    const diagnosis = {
      run_id: 'run-1',
      detected_gaps: [
        {
          gap_id: 'gap.repo.behind-origin',
          evidence_fact_ids: ['fact.repo.behind_origin'],
        },
      ],
    };
    const outcome = {
      run_id: 'run-1',
      actual_gaps: [
        {
          actual_gap_id: 'actual.repo.behind_origin',
          fact_ids: ['fact.repo.behind_origin'],
        },
      ],
      gate_violations: [],
      intervention_outcomes: [],
    };

    const labels = deriveLabelsFromOutcome(diagnosis, outcome);

    expect(labels.status).toBe('generated');
    expect(labels.actual_gaps).toEqual([
      {
        actual_gap_id: 'actual.repo.behind_origin',
        matched_detected_gap_id: 'gap.repo.behind-origin',
        judgment: 'true_positive',
      },
    ]);
  });

  it('outcomeに実ギャップがありdiagnosisが拾っていない場合_missedになる', () => {
    const labels = deriveLabelsFromOutcome(
      { run_id: 'run-1', detected_gaps: [] },
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

    expect(labels.actual_gaps[0]).toEqual({
      actual_gap_id: 'actual.repo.behind_origin',
      matched_detected_gap_id: null,
      judgment: 'missed',
    });
  });

  it('正解ラベル確定時_本番化ギャップ捕捉率と的中率とゲート違反流出率を計算できる', () => {
    const diagnosis = {
      run_id: 'run-1',
      detected_gaps: [
        { gap_id: 'gap.a' },
        { gap_id: 'gap.b' },
        { gap_id: 'gap.c' },
      ],
    };
    const labels = {
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
    };

    const score = calculateScore(diagnosis, labels);

    expect(score.status).toBe('scored');
    expect(score.metrics['本番化ギャップ捕捉率']).toBe(0.5);
    expect(score.metrics['本番化ギャップ的中率']).toBe(1 / 3);
    expect(score.metrics['ゲート違反流出率']).toBe(0.5);
    expect(score.feedback.missed_gaps).toEqual(['actual.2']);
    expect(score.feedback.over_detected_gaps).toEqual(['gap.b', 'gap.c']);
  });

  it('observationの機械観測からoutcomeを診断非依存で生成する', () => {
    const observation = {
      run_id: 'run-1',
      observed_facts: [
        {
          fact_id: 'fact.repo.behind_origin',
          kind: 'operational_freshness',
          severity: 'medium',
          summary: 'develop is behind origin/develop by 2 commits',
        },
        {
          fact_id: 'fact.vibepro.scorer_manual_only',
          kind: 'automation',
          severity: 'medium',
          summary: 'scorer exists but is not connected to workflow',
        },
      ],
    };

    const outcome = generateOutcomeFromObservation(observation);

    expect(outcome.actual_gaps).toEqual([
      expect.objectContaining({
        actual_gap_id: 'actual.gap.repo.behind_origin',
        fact_ids: ['fact.repo.behind_origin'],
      }),
      expect.objectContaining({
        actual_gap_id: 'actual.gap.vibepro.scorer_manual_only',
        fact_ids: ['fact.vibepro.scorer_manual_only'],
      }),
    ]);
  });

  it('git状態から観測factを決定論的に抽出する', () => {
    const facts = collectObservedFacts({
      branch: 'develop',
      upstream: 'origin/develop',
      ahead: 0,
      behind: 2,
      changed_files: [
        { path: '.claude/commands/retro.md', status: 'M', category: 'unrelated' },
        {
          path: 'docs/internal/vibepro-dogfood/runs/run-1/diagnosis.json',
          status: 'A',
          category: 'vibepro_dogfood',
        },
      ],
      run_count_before_current: 0,
      scorer_exists: true,
      scorer_workflow_exists: false,
    });

    expect(facts.map((fact) => fact.fact_id)).toEqual([
      'fact.vibepro.no_previous_runs',
      'fact.repo.behind_origin',
      'fact.repo.unrelated_dirty_files',
      'fact.vibepro.scorer_manual_only',
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
    const outcome = JSON.parse(await fs.readFile(path.join(runDir, 'outcome.json'), 'utf8'));
    const labels = JSON.parse(await fs.readFile(path.join(runDir, 'labels.json'), 'utf8'));
    const scoreFile = JSON.parse(await fs.readFile(path.join(runDir, 'score.json'), 'utf8'));
    const feedback = await fs.readFile(path.join(runDir, 'feedback.md'), 'utf8');
    const report = await fs.readFile(path.join(runDir, 'report.md'), 'utf8');

    expect(outcome.actual_gaps).toHaveLength(1);
    expect(labels.actual_gaps[0].judgment).toBe('true_positive');
    expect(score.status).toBe('scored');
    expect(scoreFile.metrics['本番化ギャップ捕捉率']).toBe(1);
    expect(feedback).toContain('## 指標');
    expect(report).toContain('## 評価分離');
  });

  it('feedbackとreportは採点結果から日本語で生成される', () => {
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
  });

  it('scoreRunDirectoryは既存labelsを採点できる', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-score-run-'));
    await fs.writeFile(
      path.join(runDir, 'diagnosis.json'),
      JSON.stringify({
        run_id: 'run-1',
        detected_gaps: [{ gap_id: 'gap.a' }],
      }),
    );
    await fs.writeFile(
      path.join(runDir, 'labels.json'),
      JSON.stringify({
        status: 'generated',
        actual_gaps: [
          { actual_gap_id: 'actual.1', matched_detected_gap_id: 'gap.a' },
        ],
        gate_violations: [],
        intervention_outcomes: [],
      }),
    );

    const score = await scoreRunDirectory(runDir);

    expect(score.metrics['本番化ギャップ捕捉率']).toBe(1);
  });
});
