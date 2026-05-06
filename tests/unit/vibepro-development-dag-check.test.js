import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  calculateDevelopmentDagScore,
  collectChangedFilesForDevelopmentDag,
  extractDogfoodRunIds,
  isDevelopmentDagEnforcedRun,
  validateChangedDogfoodRuns,
  validateDevelopmentDagRun,
} from '../../scripts/vibepro-development-dag-check.mjs';

function completeRun(overrides = {}) {
  const nodes = {
    requirement: { status: 'passed', evidence: ['request.raw'] },
    story: { status: 'passed', evidence: ['docs/stories/vibepro-brainbase-dogfood-story.md'], depends_on: ['requirement'] },
    architecture: { status: 'passed', evidence: ['docs/architecture/vibepro-brainbase-dogfood-architecture.md'], depends_on: ['story'] },
    spec: { status: 'passed', evidence: ['docs/specs/vibepro-brainbase-self-evaluation-spec.md'], depends_on: ['architecture'] },
    test_design: { status: 'passed', evidence: ['tests/unit/vibepro-development-dag-check.test.js'], depends_on: ['spec'] },
    implementation: { status: 'passed', evidence: ['scripts/vibepro-development-dag-check.mjs'], depends_on: ['test_design'] },
    verification: { status: 'passed', evidence: ['npm -s exec vitest run tests/unit/vibepro-development-dag-check.test.js'], depends_on: ['implementation'] },
    run_evidence: { status: 'passed', evidence: ['docs/internal/vibepro-dogfood/runs/run-1/development-run.json'], depends_on: ['verification'] },
    score_gate: { status: 'passed', evidence: ['npm run vibepro:development-dag'], depends_on: ['run_evidence'] },
    ship: { status: 'passed', evidence: ['docs/internal/vibepro-dogfood/ship.md'], depends_on: ['score_gate'] },
  };

  return {
    run_id: 'vibepro-brainbase-20260427-120000-development-dag',
    status: 'completed',
    development_dag: { nodes },
    outcome: {
      residual_risks: [],
      next_actions: [],
    },
    ...overrides,
  };
}

describe('vibepro-development-dag-check', () => {
  it('完全なdevelopment_dagは全指標がgateを満たす', () => {
    const result = validateDevelopmentDagRun(completeRun());

    expect(result.status).toBe('passed');
    expect(result.metrics).toEqual(expect.objectContaining({
      開発DAG合致率: 1,
      証跡欠落率: 0,
      ゲート前進違反率: 0,
      'Story-to-Ship閉鎖率': 1,
    }));
  });

  it('Specノード欠落時は開発DAG合致率と証跡欠落率で失敗する', () => {
    const run = completeRun();
    delete run.development_dag.nodes.spec;

    const result = validateDevelopmentDagRun(run);

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      '開発DAG合致率_below_gate',
      '証跡欠落率_nonzero',
    ]));
    expect(result.node_checks.missing_required_nodes).toEqual(['spec']);
  });

  it('依存元が失敗しているのに下流がpassedならゲート前進違反として失敗する', () => {
    const run = completeRun();
    run.development_dag.nodes.spec.status = 'failed';

    const result = validateDevelopmentDagRun(run);

    expect(result.status).toBe('failed');
    expect(result.failures).toContain('ゲート前進違反率_nonzero');
    expect(result.node_checks.gate_forward_violations).toEqual(expect.arrayContaining([
      'test_design',
    ]));
  });

  it('completed_with_residual_riskは残リスクとnext actionがあれば許可する', () => {
    const run = completeRun({
      status: 'completed_with_residual_risk',
      outcome: {
        residual_risks: ['実ブラウザ確認は未実施'],
        next_actions: ['次runでPlaywright確認する'],
      },
    });
    run.development_dag.nodes.ship.status = 'skipped';

    const result = validateDevelopmentDagRun(run);

    expect(result.status).toBe('passed');
    expect(result.metrics['Story-to-Ship閉鎖率']).toBe(0);
  });

  it('completed_with_residual_riskで残リスク説明がなければ失敗する', () => {
    const run = completeRun({
      status: 'completed_with_residual_risk',
      outcome: {
        residual_risks: [],
        next_actions: [],
      },
    });

    const result = validateDevelopmentDagRun(run);

    expect(result.failures).toContain('completed_with_residual_risk_without_residual_risks_or_next_actions');
  });

  it('completedなのにshipまで閉じていなければStory-to-Ship閉鎖率で失敗する', () => {
    const run = completeRun();
    run.development_dag.nodes.ship.status = 'skipped';

    const result = validateDevelopmentDagRun(run);

    expect(result.status).toBe('failed');
    expect(result.failures).toContain('Story-to-Ship閉鎖率_below_gate_for_completed_run');
  });

  it('残リスク回収率は明示された回収数から計算する', () => {
    const run = completeRun();
    run.development_dag.residual_risk_recovery = {
      previous_residual_risk_count: 2,
      recovered_count: 1,
    };

    expect(calculateDevelopmentDagScore(run).metrics['残リスク回収率']).toBe(0.5);
  });

  it('changed filesからdogfood run idを抽出し_20260427以降だけ強制対象にする', () => {
    expect(extractDogfoodRunIds([
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-120000-run/score.json',
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-120000-run/feedback.md',
      'docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-120000-run/score.json',
      'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
    ])).toEqual([
      'vibepro-brainbase-20260426-120000-run',
      'vibepro-brainbase-20260427-120000-run',
    ]);
    expect(isDevelopmentDagEnforcedRun('vibepro-brainbase-20260426-120000-run')).toBe(false);
    expect(isDevelopmentDagEnforcedRun('vibepro-brainbase-20260427-120000-run')).toBe(true);
  });

  it('環境変数の改行区切りchanged filesを正規化して使える', () => {
    const files = collectChangedFilesForDevelopmentDag({
      env: {
        VIBEPRO_DEVELOPMENT_DAG_CHANGED_FILES: [
          'docs/internal/vibepro-dogfood/runs/run-1/score.json',
          '',
          'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
        ].join('\n'),
      },
    });

    expect(files).toEqual([
      'docs/internal/vibepro-dogfood/runs/run-1/score.json',
      'docs/specs/vibepro-brainbase-self-evaluation-spec.md',
    ]);
  });

  it('新しいdogfood runのdevelopment-run.jsonがなければ失敗する', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-dag-'));
    const runId = 'vibepro-brainbase-20260427-120000-missing';

    const result = await validateChangedDogfoodRuns({
      repoRoot: tempRoot,
      changedFiles: [`docs/internal/vibepro-dogfood/runs/${runId}/score.json`],
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual([
      `${runId}:development_run_json_missing_for_enforced_run`,
    ]);
  });

  it('新しいdogfood runのdevelopment-run.jsonを検証する', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepro-dag-'));
    const runId = 'vibepro-brainbase-20260427-120000-complete';
    const runDir = path.join(tempRoot, 'docs/internal/vibepro-dogfood/runs', runId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'development-run.json'), JSON.stringify({
      ...completeRun(),
      run_id: runId,
    }));

    const result = await validateChangedDogfoodRuns({
      repoRoot: tempRoot,
      changedFiles: [`docs/internal/vibepro-dogfood/runs/${runId}/development-run.json`],
    });

    expect(result.status).toBe('passed');
    expect(result.runs[0].metrics['開発DAG合致率']).toBe(1);
  });
});
